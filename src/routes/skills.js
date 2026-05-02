const express = require('express');
const { skillStore } = require('../skills/skill-store');

const router = express.Router();

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

router.get('/', (req, res, next) => {
  try {
    const skills = skillStore.listSkills({
      search: req.query.search || req.query.q || '',
      includeDisabled: parseBoolean(req.query.includeDisabled, false),
      includeBody: parseBoolean(req.query.includeBody, false),
    });

    res.json({
      success: true,
      data: skills,
      meta: skillStore.getSummary(),
    });
  } catch (error) {
    next(error);
  }
});

router.get('/context', (req, res, next) => {
  try {
    const selectedSkillIds = String(req.query.skillIds || req.query.skills || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    const toolIds = String(req.query.toolIds || req.query.tools || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    const context = skillStore.buildContextBlock({
      text: req.query.q || req.query.text || '',
      toolIds,
      selectedSkillIds,
      limit: req.query.limit,
    });

    res.json({
      success: true,
      data: {
        context,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', (req, res, next) => {
  try {
    const skill = skillStore.readSkill(req.params.id, {
      includeBody: parseBoolean(req.query.includeBody, true),
    });

    if (!skill) {
      return res.status(404).json({ success: false, error: 'Skill not found' });
    }

    return res.json({ success: true, data: skill });
  } catch (error) {
    return next(error);
  }
});

router.post('/', (req, res, next) => {
  try {
    const skill = skillStore.upsertSkill(req.body || {}, { createOnly: true });
    res.status(201).json({ success: true, data: skill, meta: skillStore.getSummary() });
  } catch (error) {
    next(error);
  }
});

router.put('/:id', (req, res, next) => {
  try {
    const skill = skillStore.upsertSkill({
      ...(req.body || {}),
      id: req.params.id,
    });
    res.json({ success: true, data: skill, meta: skillStore.getSummary() });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', (req, res, next) => {
  try {
    const deleted = skillStore.deleteSkill(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Skill not found' });
    }

    return res.json({ success: true, data: { id: req.params.id, deleted: true }, meta: skillStore.getSummary() });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
