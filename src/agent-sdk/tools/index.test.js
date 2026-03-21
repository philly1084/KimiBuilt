const { ToolManager } = require('./index');

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
});
