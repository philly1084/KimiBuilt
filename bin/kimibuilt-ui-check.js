#!/usr/bin/env node
'use strict';

const fs = require('fs/promises');
const path = require('path');

const DEFAULT_BROWSER_ARGS = [
  '--disable-gpu',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-background-networking',
  '--disable-features=Translate,BackForwardCache',
  '--allow-running-insecure-content',
  '--ignore-certificate-errors',
];

const DEFAULT_VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 960 },
  { name: 'mobile', width: 390, height: 844, isMobile: true },
];

function normalizeText(value = '') {
  return String(value || '').trim();
}

function printUsage() {
  console.error([
    'Usage: kimibuilt-ui-check <url> [--out ui-checks] [--wait selector] [--timeout ms] [--viewports desktop:1440x960,mobile:390x844]',
    '',
    'Captures Playwright screenshots and writes a JSON UI/UX check report.',
  ].join('\n'));
}

function parseArgs(argv = []) {
  const args = {
    url: '',
    outDir: 'ui-checks',
    waitForSelector: '',
    timeout: 30000,
    fullPage: true,
    viewports: DEFAULT_VIEWPORTS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--help' || value === '-h') {
      args.help = true;
      continue;
    }
    if (value === '--out') {
      args.outDir = normalizeText(argv[index + 1] || args.outDir) || args.outDir;
      index += 1;
      continue;
    }
    if (value === '--wait' || value === '--wait-for-selector') {
      args.waitForSelector = normalizeText(argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (value === '--timeout') {
      args.timeout = Math.max(1000, Number(argv[index + 1]) || args.timeout);
      index += 1;
      continue;
    }
    if (value === '--full-page') {
      args.fullPage = !/^(?:0|false|no)$/i.test(normalizeText(argv[index + 1] || 'true'));
      if (argv[index + 1] && !argv[index + 1].startsWith('--')) {
        index += 1;
      }
      continue;
    }
    if (value === '--viewports') {
      args.viewports = parseViewports(argv[index + 1] || '') || args.viewports;
      index += 1;
      continue;
    }
    if (!value.startsWith('--') && !args.url) {
      args.url = value;
    }
  }

  args.url = normalizeUrl(args.url || process.env.PUBLIC_URL || process.env.PUBLIC_HOST || '');
  return args;
}

function parseViewports(value = '') {
  const entries = normalizeText(value).split(',').map((entry) => entry.trim()).filter(Boolean);
  const parsed = entries
    .map((entry) => {
      const match = entry.match(/^([a-z0-9_-]+):(\d{2,5})x(\d{2,5})$/i);
      if (!match) {
        return null;
      }
      return {
        name: match[1].toLowerCase(),
        width: Number(match[2]),
        height: Number(match[3]),
        isMobile: /mobile|phone/i.test(match[1]),
      };
    })
    .filter((entry) => entry && entry.width > 0 && entry.height > 0);

  return parsed.length > 0 ? parsed : null;
}

function normalizeUrl(value = '') {
  const normalized = normalizeText(value);
  if (!normalized) {
    return '';
  }
  return /^[a-z]+:\/\//i.test(normalized) ? normalized : `https://${normalized}`;
}

async function fileExists(filePath = '') {
  try {
    await fs.access(filePath);
    return true;
  } catch (_error) {
    return false;
  }
}

async function resolveBrowserExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_EXECUTABLE_PATH,
    process.env.ARTIFACT_BROWSER_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.BROWSER_EXECUTABLE_PATH,
    process.env.CHROME_BIN,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/snap/bin/chromium',
  ].map((entry) => normalizeText(entry)).filter(Boolean);

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return '';
}

function loadPlaywright() {
  const moduleNames = ['playwright', 'playwright-core'];
  for (const moduleName of moduleNames) {
    try {
      const loaded = require(moduleName);
      if (loaded?.chromium) {
        return {
          moduleName,
          chromium: loaded.chromium,
        };
      }
    } catch (error) {
      const missingModule = error?.code === 'MODULE_NOT_FOUND'
        && String(error.message || '').includes(moduleName);
      if (!missingModule) {
        throw error;
      }
    }
  }

  throw new Error('Playwright is not installed. Install playwright or playwright-core in the runner image.');
}

function slugify(value = 'page') {
  return normalizeText(value || 'page')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'page';
}

async function collectUiMetrics(page) {
  return page.evaluate(() => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const viewportWidth = window.innerWidth;
    const doc = document.documentElement;
    const body = document.body;
    const scrollWidth = Math.max(doc?.scrollWidth || 0, body?.scrollWidth || 0);
    const scrollHeight = Math.max(doc?.scrollHeight || 0, body?.scrollHeight || 0);
    const visibleElements = Array.from(document.body?.querySelectorAll('*') || [])
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 1
          && rect.height > 1
          && style.visibility !== 'hidden'
          && style.display !== 'none';
      });
    const overflowing = visibleElements
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left < -2 || rect.right > viewportWidth + 2;
      })
      .slice(0, 12)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          id: element.id || '',
          className: normalize(element.className || '').slice(0, 80),
          text: normalize(element.innerText || element.textContent || '').slice(0, 80),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      });
    const images = Array.from(document.querySelectorAll('img'))
      .map((element) => ({
        src: element.currentSrc || element.src || '',
        alt: element.getAttribute('alt') || '',
        complete: element.complete,
        naturalWidth: element.naturalWidth,
        naturalHeight: element.naturalHeight,
        renderedWidth: Math.round(element.getBoundingClientRect().width),
        renderedHeight: Math.round(element.getBoundingClientRect().height),
      }));

    return {
      title: normalize(document.title),
      url: window.location.href,
      viewport: {
        width: viewportWidth,
        height: window.innerHeight,
      },
      scrollWidth,
      scrollHeight,
      horizontalOverflow: scrollWidth > viewportWidth + 2,
      overflowingElements: overflowing,
      bodyTextLength: normalize(document.body?.innerText || '').length,
      headings: Array.from(document.querySelectorAll('h1, h2, h3'))
        .map((element) => normalize(element.innerText || element.textContent || ''))
        .filter(Boolean)
        .slice(0, 16),
      interactiveControls: document.querySelectorAll('a[href], button, input, select, textarea, [role="button"], [tabindex]').length,
      images: {
        count: images.length,
        broken: images.filter((image) => image.complete === false || image.naturalWidth <= 0).slice(0, 8),
        missingAltCount: images.filter((image) => !image.alt).length,
      },
    };
  });
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.url) {
    printUsage();
    process.exit(args.help ? 0 : 2);
  }

  const { chromium, moduleName } = loadPlaywright();
  const executablePath = await resolveBrowserExecutable();
  if (!executablePath && moduleName === 'playwright-core') {
    throw new Error('playwright-core is installed, but no browser executable was found. Set PLAYWRIGHT_EXECUTABLE_PATH or ARTIFACT_BROWSER_PATH.');
  }

  await fs.mkdir(args.outDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    timeout: args.timeout,
    args: DEFAULT_BROWSER_ARGS,
    ...(executablePath ? { executablePath } : {}),
  });

  const checks = [];
  try {
    for (const viewport of args.viewports) {
      const consoleMessages = [];
      const pageErrors = [];
      const failedRequests = [];
      const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        viewport: {
          width: viewport.width,
          height: viewport.height,
        },
        isMobile: viewport.isMobile === true,
        userAgent: 'KimiBuilt-UI-Check/1.0',
      });
      const page = await context.newPage();

      page.on('console', (message) => {
        if (['error', 'warning'].includes(message.type())) {
          consoleMessages.push({
            type: message.type(),
            text: message.text().slice(0, 500),
          });
        }
      });
      page.on('pageerror', (error) => {
        pageErrors.push(String(error?.message || error).slice(0, 500));
      });
      page.on('requestfailed', (request) => {
        failedRequests.push({
          url: request.url(),
          failure: request.failure()?.errorText || '',
        });
      });

      try {
        await page.goto(args.url, {
          waitUntil: 'domcontentloaded',
          timeout: args.timeout,
        });
        await page.waitForLoadState('networkidle', {
          timeout: Math.min(args.timeout, 8000),
        }).catch(() => {});
        if (args.waitForSelector) {
          await page.waitForSelector(args.waitForSelector, {
            timeout: args.timeout,
            state: 'visible',
          });
        }

        const metrics = await collectUiMetrics(page);
        const titleSlug = slugify(metrics.title || new URL(page.url()).hostname);
        const screenshotPath = path.resolve(args.outDir, `${titleSlug}-${viewport.name}.png`);
        await page.screenshot({
          path: screenshotPath,
          type: 'png',
          fullPage: args.fullPage,
        });

        checks.push({
          viewport,
          ok: true,
          screenshotPath,
          metrics,
          consoleMessages: consoleMessages.slice(0, 20),
          pageErrors: pageErrors.slice(0, 20),
          failedRequests: failedRequests.slice(0, 20),
          issues: [
            ...(metrics.horizontalOverflow ? ['horizontal-overflow'] : []),
            ...(metrics.bodyTextLength === 0 ? ['empty-body-text'] : []),
            ...(pageErrors.length > 0 ? ['page-errors'] : []),
            ...(failedRequests.length > 0 ? ['failed-requests'] : []),
          ],
        });
      } catch (error) {
        checks.push({
          viewport,
          ok: false,
          error: error.message,
          consoleMessages: consoleMessages.slice(0, 20),
          pageErrors: pageErrors.slice(0, 20),
          failedRequests: failedRequests.slice(0, 20),
          issues: ['check-failed'],
        });
      } finally {
        await page.close().catch(() => {});
        await context.close().catch(() => {});
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const report = {
    tool: 'kimibuilt-ui-check',
    url: args.url,
    generatedAt: new Date().toISOString(),
    playwrightModule: moduleName,
    browserExecutable: executablePath || '',
    checks,
    summary: {
      ok: checks.every((check) => check.ok && check.issues.length === 0),
      checkedViewports: checks.length,
      screenshotPaths: checks.map((check) => check.screenshotPath).filter(Boolean),
      issues: Array.from(new Set(checks.flatMap((check) => check.issues || []))),
    },
  };
  const reportPath = path.resolve(args.outDir, 'ui-check-report.json');
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`UI_CHECK_REPORT=${reportPath}`);
  for (const screenshotPath of report.summary.screenshotPaths) {
    console.log(`UI_SCREENSHOT=${screenshotPath}`);
  }
  console.log(`KIMIBUILT_UI_CHECK_RESULT=${JSON.stringify(report.summary)}`);
}

run().catch((error) => {
  console.error(`[kimibuilt-ui-check] ${error.message}`);
  process.exit(1);
});
