const { Router } = require('express');
const fs = require('fs/promises');
const path = require('path');
const {
  injectBundleBaseHref,
  resolveFrontendBundleContentType,
  rewriteRootRelativeFrontendPaths,
} = require('../frontend-bundles');

const router = Router();
const SANDBOX_ROOT = path.resolve(process.cwd(), 'output', 'sandboxes');

function escapeHtmlAttribute(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function applyPreviewHeaders(res, contentType) {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Origin-Agent-Cluster', '?0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), accelerometer=(), gyroscope=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self' data: blob: https:",
      "img-src 'self' data: blob: https:",
      "media-src 'self' data: blob: https:",
      "font-src 'self' data: blob: https:",
      "style-src 'self' 'unsafe-inline' https:",
      "script-src 'self' 'unsafe-inline' https:",
      "connect-src 'self' data: blob: https:",
      "frame-src 'self' data: blob: https:",
      "worker-src 'self' blob:",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  );
}

function applyShellHeaders(res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Origin-Agent-Cluster', '?0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'none'",
      "style-src 'unsafe-inline'",
      "frame-src 'self'",
      "img-src data:",
      "base-uri 'none'",
      "form-action 'none'",
    ].join('; '),
  );
}

function normalizeWorkspaceId(value = '') {
  return String(value || '').trim().match(/^[a-z0-9._-]{1,140}$/i)?.[0] || '';
}

function resolveWorkspaceFile(workspaceId = '', requestedPath = '') {
  const safeWorkspaceId = normalizeWorkspaceId(workspaceId);
  if (!safeWorkspaceId) {
    return null;
  }

  const workspacePath = path.resolve(SANDBOX_ROOT, safeWorkspaceId);
  const normalizedRequest = String(requestedPath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .trim();
  const relativePath = normalizedRequest || 'index.html';
  const filePath = path.resolve(workspacePath, relativePath);
  const relativeCheck = path.relative(workspacePath, filePath);

  if (!relativeCheck || relativeCheck.startsWith('..') || path.isAbsolute(relativeCheck)) {
    return null;
  }

  return {
    workspacePath,
    filePath,
    relativePath,
  };
}

function buildSandboxShell(workspaceId = '') {
  const previewSrc = `/api/sandbox-workspaces/${encodeURIComponent(workspaceId)}/preview/`;
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sandbox Workspace Preview</title>
<style>
html, body { margin: 0; min-height: 100%; background: #0f172a; color: #e5e7eb; font-family: Arial, sans-serif; }
.sandbox-shell { min-height: 100vh; display: grid; grid-template-rows: minmax(0, 1fr); }
iframe { width: 100%; height: 100vh; border: 0; background: #fff; display: block; }
</style>
</head>
<body>
<main class="sandbox-shell">
  <iframe
    src="${escapeHtmlAttribute(previewSrc)}"
    title="Sandbox workspace preview"
    loading="eager"
    referrerpolicy="no-referrer"
    sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"
  ></iframe>
</main>
</body>
</html>`;
}

function buildPreviewBasePath(workspaceId = '') {
  return `/api/sandbox-workspaces/${encodeURIComponent(workspaceId)}/preview`;
}

function preparePreviewBuffer(workspaceId = '', relativePath = '', buffer = Buffer.alloc(0)) {
  if (!/\.(?:html?|css|svg|js|mjs)$/i.test(relativePath)) {
    return buffer;
  }

  const previewBasePath = buildPreviewBasePath(workspaceId);
  let content = rewriteRootRelativeFrontendPaths(buffer.toString('utf8'), previewBasePath);

  if (/\.html?$/i.test(relativePath)) {
    content = injectBundleBaseHref(content, `${previewBasePath}/`);
  }

  return Buffer.from(content, 'utf8');
}

router.get('/:workspaceId/sandbox', async (req, res, next) => {
  try {
    const workspaceId = normalizeWorkspaceId(req.params.workspaceId);
    if (!workspaceId) {
      return res.status(404).json({ error: { message: 'Sandbox workspace not found' } });
    }

    const workspacePath = path.resolve(SANDBOX_ROOT, workspaceId);
    await fs.access(workspacePath);
    applyShellHeaders(res);
    res.send(buildSandboxShell(workspaceId));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: { message: 'Sandbox workspace not found' } });
    }
    next(error);
  }
});

async function servePreviewFile(req, res, next) {
  try {
    const resolved = resolveWorkspaceFile(req.params.workspaceId, req.params[0] || '');
    if (!resolved) {
      return res.status(404).json({ error: { message: 'Preview file not found' } });
    }

    const rawBuffer = await fs.readFile(resolved.filePath);
    const buffer = preparePreviewBuffer(req.params.workspaceId, resolved.relativePath, rawBuffer);
    applyPreviewHeaders(res, resolveFrontendBundleContentType(resolved.relativePath));
    res.send(buffer);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') {
      return res.status(404).json({ error: { message: 'Preview file not found' } });
    }
    next(error);
  }
}

router.get('/:workspaceId/preview', servePreviewFile);
router.get('/:workspaceId/preview/*', servePreviewFile);

module.exports = router;
