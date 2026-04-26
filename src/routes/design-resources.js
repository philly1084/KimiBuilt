const { Router } = require('express');
const { designResourceIndex } = require('../design-resource-index');

const router = Router();

function parseLimit(value, fallback = 10) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.min(Math.floor(parsed), 50));
}

router.get('/', (req, res, next) => {
  try {
    const result = designResourceIndex.search({
      query: req.query.q || req.query.query || '',
      category: req.query.category || '',
      surface: req.query.surface || '',
      format: req.query.format || '',
      limit: parseLimit(req.query.limit, 10),
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/search', (req, res, next) => {
  try {
    const result = designResourceIndex.search({
      query: req.body?.query || req.body?.q || '',
      category: req.body?.category || '',
      surface: req.body?.surface || '',
      format: req.body?.format || '',
      limit: parseLimit(req.body?.limit, 10),
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/categories', (_req, res) => {
  res.json({
    categories: designResourceIndex.getCategories(),
  });
});

router.get('/approved-domains', (_req, res) => {
  res.json({
    approvedDomains: designResourceIndex.getApprovedDomains(),
  });
});

router.get('/:id', (req, res) => {
  const plan = designResourceIndex.getFetchPlan(req.params.id);
  if (!plan) {
    return res.status(404).json({
      error: { message: `Design resource not found: ${req.params.id}` },
    });
  }

  return res.json(plan);
});

router.post('/:id/fetch-plan', (req, res) => {
  const plan = designResourceIndex.getFetchPlan(req.params.id, {
    url: req.body?.url || '',
  });
  if (!plan) {
    return res.status(404).json({
      error: { message: `Design resource not found: ${req.params.id}` },
    });
  }

  return res.json(plan);
});

module.exports = router;
