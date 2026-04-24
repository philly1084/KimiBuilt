#!/usr/bin/env node
'use strict';

const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { WebSocket } = require('ws');

const {
  isApproved,
  isDangerousCommand,
  normalizeCommandJob,
  normalizeText,
  truncateText,
} = require('../src/remote-runner/protocol');

const backendUrl = normalizeText(process.env.KIMIBUILT_BACKEND_URL || process.env.API_BASE_URL || 'http://localhost:3000');
const token = normalizeText(process.env.KIMIBUILT_REMOTE_RUNNER_TOKEN || '');
const runnerId = normalizeText(process.env.KIMIBUILT_RUNNER_ID || `${os.hostname()}-${process.platform}-${process.arch}`);
const displayName = normalizeText(process.env.KIMIBUILT_RUNNER_NAME || `KimiBuilt Runner ${os.hostname()}`);
const allowedRoots = String(process.env.KIMIBUILT_RUNNER_ALLOWED_ROOTS || '/opt,/srv,/var/www,/tmp')
  .split(',')
  .map((entry) => normalizeText(entry))
  .filter(Boolean);
const capabilities = String(process.env.KIMIBUILT_RUNNER_CAPABILITIES || 'inspect,deploy,build')
  .split(',')
  .map((entry) => normalizeText(entry))
  .filter(Boolean);
const heartbeatMs = Math.max(5000, Number(process.env.KIMIBUILT_RUNNER_HEARTBEAT_MS) || 15000);
const maxOutputChars = Math.max(1000, Number(process.env.KIMIBUILT_RUNNER_MAX_OUTPUT_CHARS) || 120000);

if (!token) {
  console.error('[Runner] KIMIBUILT_REMOTE_RUNNER_TOKEN is required');
  process.exit(1);
}

function buildRunnerWsUrl() {
  const base = new URL(backendUrl.replace(/^http/i, 'ws').replace(/\/+$/, ''));
  base.pathname = '/ws/runners';
  base.searchParams.set('token', token);
  return base.toString();
}

function isPathAllowed(candidate = '') {
  const normalized = normalizeText(candidate);
  if (!normalized) {
    return true;
  }
  const resolved = path.resolve(normalized);
  return allowedRoots.some((root) => {
    const resolvedRoot = path.resolve(root);
    return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`);
  });
}

function buildHostIdentity() {
  return {
    hostname: os.hostname(),
    platform: process.platform,
    arch: process.arch,
    release: os.release(),
    user: os.userInfo().username,
    pid: process.pid,
  };
}

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function runCommand(job = {}) {
  const normalized = normalizeCommandJob(job);
  if (!isPathAllowed(normalized.cwd)) {
    return Promise.resolve({
      jobId: normalized.id,
      stdout: '',
      stderr: `Working directory is outside allowed roots: ${normalized.cwd}`,
      exitCode: 126,
      duration: 0,
      host: os.hostname(),
      error: 'Disallowed working directory',
    });
  }

  if (isDangerousCommand(normalized.command) && !isApproved(normalized)) {
    return Promise.resolve({
      jobId: normalized.id,
      stdout: '',
      stderr: 'Command requires explicit approval by runner policy.',
      exitCode: 126,
      duration: 0,
      host: os.hostname(),
      error: 'Command requires explicit approval by runner policy',
    });
  }

  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    const started = Date.now();
    const child = spawn(normalized.command, [], {
      cwd: normalized.cwd || process.cwd(),
      env: {
        ...process.env,
        ...normalized.environment,
      },
      shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/sh',
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      child.kill('SIGTERM');
      settled = true;
      resolve({
        jobId: normalized.id,
        stdout: truncateText(stdout, maxOutputChars),
        stderr: truncateText(`${stderr}\nCommand timed out after ${normalized.timeout}ms`, maxOutputChars),
        exitCode: 124,
        duration: Date.now() - started,
        host: os.hostname(),
        startedAt,
        finishedAt: new Date().toISOString(),
        error: `Command timed out after ${normalized.timeout}ms`,
      });
    }, normalized.timeout);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        jobId: normalized.id,
        stdout: truncateText(stdout, maxOutputChars),
        stderr: truncateText(stderr, maxOutputChars),
        exitCode: 127,
        duration: Date.now() - started,
        host: os.hostname(),
        startedAt,
        finishedAt: new Date().toISOString(),
        error: error.message,
      });
    });
    child.on('close', (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        jobId: normalized.id,
        stdout: truncateText(stdout, maxOutputChars),
        stderr: truncateText(stderr, maxOutputChars),
        exitCode: Number(exitCode || 0),
        duration: Date.now() - started,
        host: os.hostname(),
        startedAt,
        finishedAt: new Date().toISOString(),
      });
    });
  });
}

function connect() {
  const ws = new WebSocket(buildRunnerWsUrl());
  let heartbeatTimer = null;

  ws.on('open', () => {
    console.log(`[Runner] Connected as ${runnerId}`);
    send(ws, {
      type: 'register',
      runner: {
        runnerId,
        displayName,
        hostIdentity: buildHostIdentity(),
        capabilities,
        allowedRoots,
      },
    });
    heartbeatTimer = setInterval(() => {
      send(ws, {
        type: 'heartbeat',
        runnerId,
        payload: {
          hostIdentity: buildHostIdentity(),
          metadata: {
            uptimeSeconds: Math.floor(process.uptime()),
          },
        },
      });
    }, heartbeatMs);
  });

  ws.on('message', async (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch (error) {
      console.warn('[Runner] Invalid message:', error.message);
      return;
    }

    if (message.type !== 'job') {
      return;
    }

    const job = message.job || {};
    const result = await runCommand(job);
    send(ws, {
      type: 'job_result',
      result,
    });
  });

  ws.on('close', () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
    console.warn('[Runner] Disconnected; reconnecting in 5s');
    setTimeout(connect, 5000);
  });

  ws.on('error', (error) => {
    console.warn('[Runner] WebSocket error:', error.message);
  });
}

connect();
