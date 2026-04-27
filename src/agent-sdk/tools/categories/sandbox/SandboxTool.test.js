const { SandboxTool } = require('./SandboxTool');

describe('SandboxTool runtime configuration', () => {
  test('exposes Java and frontend project framework language options', () => {
    const tool = new SandboxTool();

    expect(tool.inputSchema.properties.language.enum).toEqual(expect.arrayContaining([
      'java',
      'react',
      'tailwind',
    ]));
  });

  test('builds dependency install commands for JavaScript and Python execution', () => {
    const tool = new SandboxTool();

    const javascript = tool.getDockerConfig('javascript', ['react', 'chart.js']).command('index.js');
    const python = tool.getDockerConfig('python', ['fastapi', 'uvicorn[standard]']).command('main.py');

    expect(javascript).toEqual([
      'sh',
      '-c',
      "npm init -y >/dev/null 2>&1 && npm install --no-audit --no-fund 'react' 'chart.js' && node 'index.js'",
    ]);
    expect(python).toEqual([
      'sh',
      '-c',
      "python -m pip install --no-cache-dir 'fastapi' 'uvicorn[standard]' && python 'main.py'",
    ]);
  });

  test('uses a Java 21 image and Main entrypoint for Java execution', () => {
    const tool = new SandboxTool();
    const config = tool.getDockerConfig('java', []);

    expect(config.image).toBe('eclipse-temurin:21-jdk-alpine');
    expect(config.command('Main.java')).toEqual([
      'sh',
      '-c',
      "javac 'Main.java' && java Main",
    ]);
  });

  test('normalizes React and Tailwind project fallback content to index.html', () => {
    const tool = new SandboxTool();

    expect(tool.normalizeProjectFiles({ language: 'react', code: '<div id="root"></div>' })[0].path).toBe('index.html');
    expect(tool.normalizeProjectFiles({ language: 'tailwind', code: '<main></main>' })[0].path).toBe('index.html');
  });

  test('drops unsafe dependency strings before building install commands', () => {
    const tool = new SandboxTool();

    expect(tool.normalizeDependencies(['fastapi', 'bad;rm -rf /', 'react && echo no'])).toEqual(['fastapi']);
  });
});
