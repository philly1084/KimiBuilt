const { ToolManager } = require('./index');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');

describe('ToolManager image tools', () => {
  test('normalizes markdown-wrapped image URLs before validation', async () => {
    const toolManager = new ToolManager();
    await toolManager.initialize();

    const result = await toolManager.executeTool('image-from-url', {
      url: '![Hero image](https://images.unsplash.com/photo-12345?fit=crop&w=1200).',
    });

    expect(result.success).toBe(true);
    expect(result.data.image.url).toBe('https://images.unsplash.com/photo-12345?fit=crop&w=1200');
    expect(result.data.markdownImage).toContain('https://images.unsplash.com/photo-12345?fit=crop&w=1200');
  });

  test('accepts file-write content aliases and writes the file body', async () => {
    const toolManager = new ToolManager();
    await toolManager.initialize();

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kimibuilt-file-write-'));
    try {
      const targetPath = path.join(tempDir, 'sample.html');

      const result = await toolManager.executeTool('file-write', {
        path: targetPath,
        html: '<!DOCTYPE html><html><body><h1>Hello</h1></body></html>',
      });

      const written = await fs.readFile(targetPath, 'utf8');

      expect(result.success).toBe(true);
      expect(result.data.path).toBe(targetPath);
      expect(written).toContain('<h1>Hello</h1>');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test('returns a helpful error when file-write is called without content', async () => {
    const toolManager = new ToolManager();
    await toolManager.initialize();

    const result = await toolManager.executeTool('file-write', {
      path: 'missing-content.txt',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('file-write requires a `content` string');
  });
});
