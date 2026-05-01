const { Router } = require('express');
const fs = require('fs/promises');
const {
  buildSandboxBrowserLibraryInstructions,
  getSandboxBrowserLibraryCatalog,
  normalizeLibraryId,
  resolveSandboxBrowserLibraryAsset,
  resolveSandboxBrowserLibraryContentType,
} = require('../sandbox-browser-libraries');

const router = Router();

function applyLibraryHeaders(res, contentType = 'application/octet-stream') {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Origin-Agent-Cluster', '?0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

router.get('/', (_req, res) => {
  res.json({
    libraries: getSandboxBrowserLibraryCatalog(),
    guidance: buildSandboxBrowserLibraryInstructions(),
  });
});

router.get('/catalog.json', (_req, res) => {
  res.json({
    libraries: getSandboxBrowserLibraryCatalog(),
    guidance: buildSandboxBrowserLibraryInstructions(),
  });
});

router.get('/:libraryId', (req, res) => {
  const libraryId = normalizeLibraryId(req.params.libraryId);
  const library = getSandboxBrowserLibraryCatalog().find((entry) => entry.id === libraryId);
  if (!library) {
    return res.status(404).json({ error: { message: 'Sandbox library not found' } });
  }
  return res.json({ library });
});

router.get('/:libraryId/*', async (req, res, next) => {
  try {
    const resolved = resolveSandboxBrowserLibraryAsset(req.params.libraryId, req.params[0] || '');
    if (!resolved) {
      return res.status(404).json({ error: { message: 'Sandbox library asset not found' } });
    }

    const buffer = await fs.readFile(resolved.filePath);
    applyLibraryHeaders(res, resolveSandboxBrowserLibraryContentType(resolved.filePath));
    return res.send(buffer);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') {
      return res.status(404).json({ error: { message: 'Sandbox library asset not found' } });
    }
    return next(error);
  }
});

module.exports = router;
