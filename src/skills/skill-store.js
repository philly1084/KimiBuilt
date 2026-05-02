const fs = require('fs');
const path = require('path');

const DEFAULT_SKILL_ROOT = path.join(__dirname, '..', '..', 'data', 'skills');
const DEFAULT_MAX_CONTEXT_CHARS = 1800;
const DEFAULT_MATCH_LIMIT = 4;
const RESERVED_WINDOWS_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

function normalizeWhitespace(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function slugifySkillId(value = '') {
  const normalized = normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  if (!normalized || RESERVED_WINDOWS_NAMES.has(normalized)) {
    return '';
  }

  return normalized;
}

function normalizeStringList(value = []) {
  const rawList = Array.isArray(value) ? value : [value];
  const seen = new Set();
  return rawList
    .map((entry) => normalizeWhitespace(entry))
    .filter(Boolean)
    .filter((entry) => {
      const key = entry.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 40);
}

function truncate(value = '', limit = DEFAULT_MAX_CONTEXT_CHARS) {
  const text = String(value || '').trim();
  if (!text || text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(0, limit - 24)).trim()}...[truncated]`;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_error) {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

class SkillStore {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.KIMIBUILT_SKILLS_DIR || DEFAULT_SKILL_ROOT);
  }

  ensureRoot() {
    ensureDir(this.rootDir);
    return this.rootDir;
  }

  resolveSkillDir(id = '') {
    const normalizedId = slugifySkillId(id);
    if (!normalizedId) {
      throw new Error('Skill id must contain letters or numbers.');
    }

    const skillDir = path.resolve(this.rootDir, normalizedId);
    const relative = path.relative(this.rootDir, skillDir);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Skill path escapes the registered skill root.');
    }

    return skillDir;
  }

  buildManifest(input = {}, existing = null) {
    const now = new Date().toISOString();
    const id = slugifySkillId(input.id || input.name || existing?.id || '');
    if (!id) {
      throw new Error('Skill id or name is required.');
    }

    const title = normalizeWhitespace(input.name || input.title || existing?.name || id.replace(/-/g, ' '));
    const description = normalizeWhitespace(input.description || existing?.description || '');
    const body = String(input.body || input.instructions || input.content || existing?.body || '').trim();
    const tools = normalizeStringList(input.tools || input.toolIds || existing?.tools || []);
    const triggerPatterns = normalizeStringList(input.triggerPatterns || input.triggers || input.keywords || existing?.triggerPatterns || []);
    const chain = Array.isArray(input.chain || input.steps)
      ? (input.chain || input.steps)
        .map((step) => (step && typeof step === 'object' ? step : { instruction: normalizeWhitespace(step) }))
        .filter((step) => Object.keys(step).length > 0)
        .slice(0, 16)
      : (Array.isArray(existing?.chain) ? existing.chain : []);

    if (!description && !body) {
      throw new Error('Skill needs a description or instructions body.');
    }

    return {
      id,
      name: title || id,
      description,
      version: normalizeWhitespace(input.version || existing?.version || '1.0.0'),
      enabled: input.enabled !== undefined ? input.enabled !== false : existing?.enabled !== false,
      tools,
      triggerPatterns,
      chain,
      contextPolicy: {
        maxChars: Math.max(300, Math.min(Number(input.contextPolicy?.maxChars || existing?.contextPolicy?.maxChars || DEFAULT_MAX_CONTEXT_CHARS), 6000)),
        exposeBody: input.contextPolicy?.exposeBody !== undefined
          ? input.contextPolicy.exposeBody !== false
          : existing?.contextPolicy?.exposeBody !== false,
      },
      body,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
  }

  serializeSkill(manifest = {}, options = {}) {
    const includeBody = options.includeBody !== false;
    return {
      ...manifest,
      root: this.rootDir,
      manifestPath: path.join(this.resolveSkillDir(manifest.id), 'skill.json'),
      bodyPath: path.join(this.resolveSkillDir(manifest.id), 'SKILL.md'),
      ...(includeBody ? {} : { body: undefined }),
    };
  }

  readSkill(id = '', options = {}) {
    const skillDir = this.resolveSkillDir(id);
    const manifestPath = path.join(skillDir, 'skill.json');
    const manifest = readJsonFile(manifestPath, null);
    if (!manifest) {
      return null;
    }

    const bodyPath = path.join(skillDir, 'SKILL.md');
    const body = fs.existsSync(bodyPath) ? fs.readFileSync(bodyPath, 'utf8').trim() : manifest.body || '';
    return this.serializeSkill({ ...manifest, body }, options);
  }

  listSkills(options = {}) {
    this.ensureRoot();
    const search = normalizeWhitespace(options.search || '').toLowerCase();
    const includeDisabled = options.includeDisabled === true;
    return fs.readdirSync(this.rootDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => this.readSkill(entry.name, { includeBody: options.includeBody === true }))
      .filter(Boolean)
      .filter((skill) => includeDisabled || skill.enabled !== false)
      .filter((skill) => {
        if (!search) {
          return true;
        }
        const haystack = [
          skill.id,
          skill.name,
          skill.description,
          ...(skill.triggerPatterns || []),
          ...(skill.tools || []),
        ].join(' ').toLowerCase();
        return haystack.includes(search);
      })
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  }

  upsertSkill(input = {}, options = {}) {
    this.ensureRoot();
    const provisionalId = slugifySkillId(input.id || input.name || '');
    const existing = provisionalId ? this.readSkill(provisionalId, { includeBody: true }) : null;
    if (options.createOnly && existing) {
      throw new Error(`Skill already exists: ${provisionalId}`);
    }
    if (options.updateOnly && !existing) {
      throw new Error(`Skill not found: ${provisionalId || input.id}`);
    }

    const manifest = this.buildManifest(input, existing);
    const skillDir = this.resolveSkillDir(manifest.id);
    ensureDir(skillDir);

    const { body, ...manifestWithoutBody } = manifest;
    writeJsonFile(path.join(skillDir, 'skill.json'), manifestWithoutBody);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `${body || manifest.description}\n`, 'utf8');

    return this.readSkill(manifest.id, { includeBody: true });
  }

  deleteSkill(id = '') {
    const skillDir = this.resolveSkillDir(id);
    if (!fs.existsSync(skillDir)) {
      return false;
    }

    fs.rmSync(skillDir, { recursive: true, force: true });
    return true;
  }

  scoreSkill(skill = {}, text = '') {
    const normalizedText = normalizeWhitespace(text).toLowerCase();
    if (!normalizedText) {
      return 0;
    }

    let score = 0;
    const exactFields = [skill.id, skill.name, ...(skill.tools || [])];
    exactFields.forEach((field) => {
      const normalized = normalizeWhitespace(field).toLowerCase();
      if (normalized && normalizedText.includes(normalized)) {
        score += 4;
      }
    });

    (skill.triggerPatterns || []).forEach((trigger) => {
      const normalized = normalizeWhitespace(trigger).toLowerCase();
      if (!normalized) {
        return;
      }
      if (normalizedText.includes(normalized)) {
        score += 6;
      } else {
        normalized.split(' ').forEach((word) => {
          if (word.length > 3 && normalizedText.includes(word)) {
            score += 1;
          }
        });
      }
    });

    return score;
  }

  selectRelevantSkills({ text = '', toolIds = [], limit = DEFAULT_MATCH_LIMIT } = {}) {
    const requestedTools = new Set(normalizeStringList(toolIds).map((tool) => tool.toLowerCase()));
    return this.listSkills({ includeBody: true })
      .map((skill) => {
        const toolScore = (skill.tools || []).some((tool) => requestedTools.has(String(tool || '').toLowerCase())) ? 5 : 0;
        return {
          skill,
          score: this.scoreSkill(skill, text) + toolScore,
        };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(Number(limit) || DEFAULT_MATCH_LIMIT, 8)))
      .map((entry) => entry.skill);
  }

  buildContextBlock({ text = '', toolIds = [], selectedSkillIds = [], limit = DEFAULT_MATCH_LIMIT } = {}) {
    const explicitSkills = normalizeStringList(selectedSkillIds)
      .map((id) => this.readSkill(id, { includeBody: true }))
      .filter(Boolean);
    const explicitIds = new Set(explicitSkills.map((skill) => skill.id));
    const matchedSkills = this.selectRelevantSkills({ text, toolIds, limit })
      .filter((skill) => !explicitIds.has(skill.id));
    const skills = [...explicitSkills, ...matchedSkills].slice(0, Math.max(1, Math.min(Number(limit) || DEFAULT_MATCH_LIMIT, 8)));

    if (skills.length === 0) {
      return '';
    }

    const lines = [
      '<registered_skills>',
      'Use these compact, registered skills as reusable low-context procedures. They complement tools: choose the skill for the workflow shape, then call tools only for concrete effects. Do not expose unrelated skills.',
    ];

    skills.forEach((skill) => {
      const maxChars = skill.contextPolicy?.maxChars || DEFAULT_MAX_CONTEXT_CHARS;
      const summary = [
        `id=${skill.id}`,
        `name=${skill.name}`,
        skill.description ? `description=${skill.description}` : '',
        (skill.tools || []).length ? `tools=${skill.tools.join(', ')}` : '',
        (skill.chain || []).length ? `chain=${JSON.stringify(skill.chain)}` : '',
        skill.contextPolicy?.exposeBody !== false && skill.body
          ? `instructions=${truncate(skill.body, maxChars)}`
          : '',
      ].filter(Boolean).join('\n');
      lines.push(`<skill>\n${summary}\n</skill>`);
    });

    lines.push('</registered_skills>');
    return lines.join('\n');
  }

  getSummary() {
    return {
      root: this.ensureRoot(),
      count: this.listSkills({ includeDisabled: true }).length,
    };
  }
}

const skillStore = new SkillStore();

module.exports = {
  SkillStore,
  skillStore,
  slugifySkillId,
};
