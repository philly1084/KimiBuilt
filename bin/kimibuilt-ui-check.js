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
    'Captures Playwright screenshots and writes a JSON UI/UX check report with layout, image, error, and text-contrast checks.',
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
  return /^[a-z][a-z0-9+.-]*:/i.test(normalized) ? normalized : `https://${normalized}`;
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

  if (process.platform === 'win32') {
    const programFiles = process.env.ProgramFiles || '';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || '';
    const localAppData = process.env.LOCALAPPDATA || '';
    candidates.push(
      path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    );
  }

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
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const parseCssColor = (value) => {
      const normalized = String(value || '').trim().toLowerCase();
      if (!normalized || normalized === 'transparent') {
        return { r: 0, g: 0, b: 0, a: 0 };
      }

      const match = normalized.match(/^rgba?\(([^)]+)\)$/);
      if (!match) {
        return null;
      }

      const parts = match[1].split(',').map((part) => part.trim());
      const parseChannel = (part) => {
        const numeric = Number.parseFloat(part);
        if (!Number.isFinite(numeric)) {
          return 0;
        }
        return part.endsWith('%') ? (numeric / 100) * 255 : numeric;
      };

      const alpha = parts[3] === undefined ? 1 : Number.parseFloat(parts[3]);
      return {
        r: clamp(parseChannel(parts[0]), 0, 255),
        g: clamp(parseChannel(parts[1]), 0, 255),
        b: clamp(parseChannel(parts[2]), 0, 255),
        a: clamp(Number.isFinite(alpha) ? alpha : 1, 0, 1),
      };
    };
    const blendColor = (top, bottom) => {
      const topAlpha = clamp(top?.a ?? 1, 0, 1);
      const bottomAlpha = clamp(bottom?.a ?? 1, 0, 1);
      const alpha = topAlpha + bottomAlpha * (1 - topAlpha);
      if (alpha <= 0) {
        return { r: 255, g: 255, b: 255, a: 1 };
      }
      return {
        r: ((top.r * topAlpha) + (bottom.r * bottomAlpha * (1 - topAlpha))) / alpha,
        g: ((top.g * topAlpha) + (bottom.g * bottomAlpha * (1 - topAlpha))) / alpha,
        b: ((top.b * topAlpha) + (bottom.b * bottomAlpha * (1 - topAlpha))) / alpha,
        a: alpha,
      };
    };
    const relativeLuminance = (color) => {
      const channel = (value) => {
        const normalizedValue = clamp(value, 0, 255) / 255;
        return normalizedValue <= 0.03928
          ? normalizedValue / 12.92
          : ((normalizedValue + 0.055) / 1.055) ** 2.4;
      };
      return (0.2126 * channel(color.r)) + (0.7152 * channel(color.g)) + (0.0722 * channel(color.b));
    };
    const contrastRatio = (foreground, background) => {
      const first = relativeLuminance(foreground);
      const second = relativeLuminance(background);
      const lighter = Math.max(first, second);
      const darker = Math.min(first, second);
      return (lighter + 0.05) / (darker + 0.05);
    };
    const colorToHex = (color) => {
      const toHex = (value) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0');
      return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
    };
    const getEffectiveBackground = (element) => {
      const colors = [];
      let current = element;
      while (current && current.nodeType === 1) {
        const parsed = parseCssColor(window.getComputedStyle(current).backgroundColor);
        if (parsed && parsed.a > 0) {
          colors.push(parsed);
        }
        current = current.parentElement;
      }

      let background = { r: 255, g: 255, b: 255, a: 1 };
      for (let index = colors.length - 1; index >= 0; index -= 1) {
        background = blendColor(colors[index], background);
      }
      return background;
    };
    const hasDirectText = (element) => Array.from(element.childNodes || [])
      .some((node) => node.nodeType === Node.TEXT_NODE && normalize(node.textContent).length > 0);
    const isTextContrastCandidate = (element) => {
      const tag = element.tagName.toLowerCase();
      if (['script', 'style', 'noscript', 'template', 'svg', 'path'].includes(tag) || element.closest('svg')) {
        return false;
      }
      if (['input', 'textarea', 'select', 'button'].includes(tag)) {
        return true;
      }
      return hasDirectText(element);
    };
    const measureTextContrast = (element) => {
      const style = window.getComputedStyle(element);
      const opacity = Number.parseFloat(style.opacity);
      if (Number.isFinite(opacity) && opacity < 0.5) {
        return null;
      }

      const textColor = parseCssColor(style.color);
      if (!textColor || textColor.a <= 0) {
        return null;
      }

      const background = getEffectiveBackground(element);
      const visibleTextColor = textColor.a < 1 ? blendColor(textColor, background) : textColor;
      const ratio = contrastRatio(visibleTextColor, background);
      const fontSize = Number.parseFloat(style.fontSize) || 16;
      const fontWeight = Number.parseInt(style.fontWeight, 10) || 400;
      const isLargeText = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
      const required = isLargeText ? 3 : 4.5;
      const rect = element.getBoundingClientRect();

      return {
        tag: element.tagName.toLowerCase(),
        id: element.id || '',
        className: normalize(element.className || '').slice(0, 80),
        text: normalize(element.innerText || element.textContent || element.getAttribute('aria-label') || element.getAttribute('placeholder') || '').slice(0, 120),
        contrast: Math.round(ratio * 100) / 100,
        required,
        color: colorToHex(visibleTextColor),
        background: colorToHex(background),
        fontSize: Math.round(fontSize * 10) / 10,
        fontWeight,
        largeText: isLargeText,
        top: Math.round(rect.top),
        left: Math.round(rect.left),
      };
    };
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
    const textContrastSamples = visibleElements
      .filter(isTextContrastCandidate)
      .map(measureTextContrast)
      .filter(Boolean);
    const lowContrastText = textContrastSamples
      .filter((sample) => sample.contrast < sample.required)
      .slice(0, 16);
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
      textContrast: {
        checked: textContrastSamples.length,
        lowContrastCount: textContrastSamples.filter((sample) => sample.contrast < sample.required).length,
        lowContrast: lowContrastText,
      },
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
            ...(metrics.textContrast?.lowContrastCount > 0 ? ['low-contrast-text'] : []),
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
