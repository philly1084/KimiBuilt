const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const PHASES = [
  {
    id: 'ignition',
    label: 'Ignition',
    from: '2026-03-04',
    to: '2026-03-11',
    summary: 'The first backend, frontends, Rancher/k3s path, Docker publishing, and document generation pieces came online.',
  },
  {
    id: 'notes-admin',
    label: 'Notes + Admin Spine',
    from: '2026-03-12',
    to: '2026-03-18',
    summary: 'Notes became a real working surface while admin, auth, chat continuity, PDFs, and crash recovery kept getting repaired.',
  },
  {
    id: 'runtime',
    label: 'Agent Runtime',
    from: '2026-03-19',
    to: '2026-03-25',
    summary: 'Tool calls, memory, artifacts, remote command routing, and conversation orchestration turned Lilly into an agent platform.',
  },
  {
    id: 'remote-builds',
    label: 'Remote Builds',
    from: '2026-03-26',
    to: '2026-04-18',
    summary: 'The system learned to build, deploy, repair, and continue work across local, remote, and generated artifact paths.',
  },
  {
    id: 'polish-pipeline',
    label: 'Polish Pipeline',
    from: '2026-04-19',
    to: '2026-04-25',
    summary: 'Session polish, document workflows, voxel/web UI improvements, remote runners, and artifact handling tightened into a bigger loop.',
  },
  {
    id: 'media-symphony',
    label: 'Media + Symphony',
    from: '2026-04-26',
    to: '2026-05-01',
    summary: 'Podcast, video, image gateways, Symphony orchestration, GitLab, and diagnostics became major growth branches.',
  },
  {
    id: 'live-learning',
    label: 'Live Learning',
    from: '2026-05-02',
    to: '2099-12-31',
    summary: 'Kokoro, k3s proof loops, skills, frontend standards, and prompt state machines made the platform more durable and self-aware.',
  },
];

const CATEGORY_RULES = [
  { id: 'repair', label: 'Repair', pattern: /\b(fix|harden|restore|stabilize|recover|crash|fallback|retry|prevent|patch)\b/i },
  { id: 'growth', label: 'Growth', pattern: /\b(add|implement|enable|support|introduce|create|expand|include)\b/i },
  { id: 'interface', label: 'Interface', pattern: /\b(ui|frontend|web chat|web-chat|notes|canvas|dashboard|visual|theme|voxel|cli)\b/i },
  { id: 'ops', label: 'Ops', pattern: /\b(k3s|docker|rancher|gitlab|runner|deploy|ingress|secret|pvc|remote|kube|ghcr)\b/i },
  { id: 'media', label: 'Media + Docs', pattern: /\b(podcast|audio|tts|image|video|pdf|pptx|document|docx|template)\b/i },
  { id: 'intelligence', label: 'Intelligence', pattern: /\b(memory|orchestration|agent|model|tool|planner|symphony|prompt|skills?)\b/i },
];

function getPhaseForDate(date) {
  return PHASES.find((phase) => date >= phase.from && date <= phase.to) || PHASES[0];
}

function getTags(subject = '') {
  const tags = CATEGORY_RULES
    .filter((rule) => rule.pattern.test(subject))
    .map((rule) => rule.id);

  return tags.length ? tags : ['maintenance'];
}

function parseGitLog(stdout = '') {
  return String(stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [hash, date, ...subjectParts] = line.split('\t');
      const subject = subjectParts.join('\t').trim();
      const phase = getPhaseForDate(date);
      const tags = getTags(subject);

      return {
        hash,
        shortHash: String(hash || '').slice(0, 7),
        date,
        subject,
        phase: phase.id,
        tags,
        primaryTag: tags[0],
      };
    });
}

function summarizeCommits(commits = []) {
  const totalPulls = commits.length;
  const mergedPullRequests = commits.filter((commit) => /^Merge pull request #/i.test(commit.subject)).length;
  const repairPulls = commits.filter((commit) => commit.tags.includes('repair')).length;
  const growthPulls = commits.filter((commit) => commit.tags.includes('growth')).length;
  const firstDate = commits[commits.length - 1]?.date || null;
  const lastDate = commits[0]?.date || null;

  const categories = CATEGORY_RULES.map((rule) => ({
    id: rule.id,
    label: rule.label,
    count: commits.filter((commit) => commit.tags.includes(rule.id)).length,
  })).filter((category) => category.count > 0);

  const phases = PHASES.map((phase) => {
    const phaseCommits = commits.filter((commit) => commit.phase === phase.id);
    const tagCounts = CATEGORY_RULES.map((rule) => ({
      id: rule.id,
      label: rule.label,
      count: phaseCommits.filter((commit) => commit.tags.includes(rule.id)).length,
    })).filter((item) => item.count > 0);

    return {
      ...phase,
      count: phaseCommits.length,
      repairCount: phaseCommits.filter((commit) => commit.tags.includes('repair')).length,
      growthCount: phaseCommits.filter((commit) => commit.tags.includes('growth')).length,
      tagCounts,
      highlights: phaseCommits.slice(0, 5),
    };
  }).filter((phase) => phase.count > 0);

  return {
    totalPulls,
    mergedPullRequests,
    repairPulls,
    growthPulls,
    firstDate,
    lastDate,
    categories,
    phases,
    tiles: commits.map((commit, index) => ({
      index: totalPulls - index,
      shortHash: commit.shortHash,
      date: commit.date,
      subject: commit.subject,
      phase: commit.phase,
      primaryTag: commit.primaryTag,
    })),
    recent: commits.slice(0, 48),
  };
}

async function getCodexSessionSummary() {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const sessionsPath = path.join(codexHome, 'sessions');

  try {
    const files = [];
    const stack = [sessionsPath];
    while (stack.length) {
      const current = stack.pop();
      const entries = fs.readdirSync(current, { withFileTypes: true });
      entries.forEach((entry) => {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
          return;
        }
        if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          const stat = fs.statSync(fullPath);
          files.push({ modifiedAt: stat.mtime.toISOString(), bytes: stat.size });
        }
      });
    }

    files.sort((a, b) => String(b.modifiedAt).localeCompare(String(a.modifiedAt)));

    return {
      available: true,
      count: files.length,
      latestAt: files[0]?.modifiedAt || null,
      totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    };
  } catch (error) {
    return {
      available: false,
      count: 0,
      latestAt: null,
      totalBytes: 0,
      message: error.code === 'ENOENT' ? 'Codex session logs were not found on this server.' : error.message,
    };
  }
}

async function buildLillyHistory({ cwd = process.cwd(), maxCount = 900 } = {}) {
  const { stdout } = await execFileAsync('git', [
    'log',
    '--all',
    '--format=%H%x09%ad%x09%s',
    '--date=short',
    `--max-count=${maxCount}`,
  ], { cwd, maxBuffer: 1024 * 1024 * 4 });

  const commits = parseGitLog(stdout);
  const summary = summarizeCommits(commits);
  const codexSessions = await getCodexSessionSummary();

  return {
    generatedAt: new Date().toISOString(),
    source: 'git log --all plus optional Codex session count',
    ...summary,
    codexSessions,
  };
}

module.exports = {
  CATEGORY_RULES,
  PHASES,
  buildLillyHistory,
  getTags,
  parseGitLog,
  summarizeCommits,
};
