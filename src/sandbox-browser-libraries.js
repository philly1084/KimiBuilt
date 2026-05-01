const fs = require('fs');
const path = require('path');

const NODE_MODULES_ROOT = process.env.KIMIBUILT_NODE_MODULES
  || path.resolve(__dirname, '..', 'node_modules');

const LIBRARIES = Object.freeze([
  {
    id: 'chartjs',
    label: 'Chart.js',
    packageName: 'chart.js',
    category: 'charts',
    purpose: 'Accessible bar, line, pie, radar, and mixed dashboard charts.',
    globals: ['Chart'],
    aliases: ['chart', 'chart.js'],
    assets: [
      {
        publicPath: 'chart.umd.js',
        packagePaths: ['dist/chart.umd.js'],
        type: 'script',
      },
    ],
    snippets: [
      '<script src="/api/sandbox-libraries/chartjs/chart.umd.js"></script>',
    ],
    cdn: [
      'https://cdn.jsdelivr.net/npm/chart.js/dist/chart.umd.js',
    ],
  },
  {
    id: 'd3',
    label: 'D3',
    packageName: 'd3',
    category: 'charts',
    purpose: 'Custom data visualizations, scales, axes, maps, and force layouts.',
    globals: ['d3'],
    aliases: ['d3.js'],
    assets: [
      {
        publicPath: 'd3.min.js',
        packagePaths: ['dist/d3.min.js'],
        type: 'script',
      },
    ],
    snippets: [
      '<script src="/api/sandbox-libraries/d3/d3.min.js"></script>',
    ],
    cdn: [
      'https://cdn.jsdelivr.net/npm/d3/dist/d3.min.js',
    ],
  },
  {
    id: 'three',
    label: 'Three.js',
    packageName: 'three',
    category: '3d',
    purpose: 'WebGL scenes, 3D models, particles, shaders, cameras, and spatial UI.',
    globals: [],
    aliases: ['threejs', 'three.js'],
    assets: [
      {
        publicPath: 'three.module.js',
        packagePaths: ['build/three.module.js'],
        type: 'module',
      },
      {
        publicPrefix: 'addons/',
        packagePrefix: 'examples/jsm/',
        type: 'module',
      },
    ],
    snippets: [
      '<script type="importmap">{"imports":{"three":"/api/sandbox-libraries/three/three.module.js","three/addons/":"/api/sandbox-libraries/three/addons/"}}</script>',
      '<script type="module">import * as THREE from "three";</script>',
    ],
    cdn: [
      'https://cdn.jsdelivr.net/npm/three/build/three.module.js',
      'https://cdn.jsdelivr.net/npm/three/examples/jsm/',
    ],
  },
  {
    id: 'mermaid',
    label: 'Mermaid',
    packageName: 'mermaid',
    category: 'diagrams',
    purpose: 'Flowcharts, sequence diagrams, state diagrams, timelines, and Gantt diagrams.',
    globals: ['mermaid'],
    aliases: [],
    assets: [
      {
        publicPath: 'mermaid.min.js',
        packagePaths: ['dist/mermaid.min.js'],
        type: 'script',
      },
    ],
    snippets: [
      '<script src="/api/sandbox-libraries/mermaid/mermaid.min.js"></script>',
    ],
    cdn: [
      'https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js',
    ],
  },
  {
    id: 'cytoscape',
    label: 'Cytoscape.js',
    packageName: 'cytoscape',
    category: 'graphs',
    purpose: 'Interactive network graphs, dependency maps, and relationship diagrams.',
    globals: ['cytoscape'],
    aliases: ['cytoscape.js'],
    assets: [
      {
        publicPath: 'cytoscape.min.js',
        packagePaths: ['dist/cytoscape.min.js'],
        type: 'script',
      },
    ],
    snippets: [
      '<script src="/api/sandbox-libraries/cytoscape/cytoscape.min.js"></script>',
    ],
    cdn: [
      'https://cdn.jsdelivr.net/npm/cytoscape/dist/cytoscape.min.js',
    ],
  },
  {
    id: 'plotly',
    label: 'Plotly',
    packageName: 'plotly.js-dist-min',
    category: 'charts',
    purpose: 'Publication-grade interactive scientific, statistical, 3D, and financial charts.',
    globals: ['Plotly'],
    aliases: ['plotly.js', 'plotly.js-dist-min'],
    assets: [
      {
        publicPath: 'plotly.min.js',
        packagePaths: ['plotly.min.js'],
        type: 'script',
      },
    ],
    snippets: [
      '<script src="/api/sandbox-libraries/plotly/plotly.min.js"></script>',
    ],
    cdn: [
      'https://cdn.jsdelivr.net/npm/plotly.js-dist-min/plotly.min.js',
    ],
  },
  {
    id: 'echarts',
    label: 'Apache ECharts',
    packageName: 'echarts',
    category: 'charts',
    purpose: 'Dense dashboards, geo charts, timelines, treemaps, gauges, and animated analytics.',
    globals: ['echarts'],
    aliases: ['apache-echarts'],
    assets: [
      {
        publicPath: 'echarts.min.js',
        packagePaths: ['dist/echarts.min.js'],
        type: 'script',
      },
    ],
    snippets: [
      '<script src="/api/sandbox-libraries/echarts/echarts.min.js"></script>',
    ],
    cdn: [
      'https://cdn.jsdelivr.net/npm/echarts/dist/echarts.min.js',
    ],
  },
  {
    id: 'vis-network',
    label: 'vis-network',
    packageName: 'vis-network',
    category: 'graphs',
    purpose: 'Quick interactive node-link graphs and hierarchical networks.',
    globals: ['vis'],
    aliases: ['vis', 'vis.js'],
    assets: [
      {
        publicPath: 'vis-network.min.js',
        packagePaths: [
          'dist/vis-network.min.js',
          'standalone/umd/vis-network.min.js',
        ],
        type: 'script',
      },
      {
        publicPath: 'vis-network.min.css',
        packagePaths: [
          'dist/vis-network.min.css',
          'styles/vis-network.min.css',
          'standalone/umd/vis-network.min.css',
        ],
        type: 'style',
      },
    ],
    snippets: [
      '<script src="/api/sandbox-libraries/vis-network/vis-network.min.js"></script>',
      '<link rel="stylesheet" href="/api/sandbox-libraries/vis-network/vis-network.min.css">',
    ],
    cdn: [
      'https://cdn.jsdelivr.net/npm/vis-network/standalone/umd/vis-network.min.js',
      'https://cdn.jsdelivr.net/npm/vis-network/styles/vis-network.min.css',
    ],
  },
  {
    id: 'gsap',
    label: 'GSAP',
    packageName: 'gsap',
    category: 'animation',
    purpose: 'High-quality motion, transitions, scroll-linked animation, and UI choreography.',
    globals: ['gsap'],
    aliases: [],
    assets: [
      {
        publicPath: 'gsap.min.js',
        packagePaths: ['dist/gsap.min.js'],
        type: 'script',
      },
    ],
    snippets: [
      '<script src="/api/sandbox-libraries/gsap/gsap.min.js"></script>',
    ],
    cdn: [
      'https://cdn.jsdelivr.net/npm/gsap/dist/gsap.min.js',
    ],
  },
  {
    id: 'matter',
    label: 'Matter.js',
    packageName: 'matter-js',
    category: 'simulation',
    purpose: '2D physics, collision, constraints, and playful interactive mechanics.',
    globals: ['Matter'],
    aliases: ['matter-js', 'matter.js'],
    assets: [
      {
        publicPath: 'matter.min.js',
        packagePaths: ['build/matter.min.js'],
        type: 'script',
      },
    ],
    snippets: [
      '<script src="/api/sandbox-libraries/matter/matter.min.js"></script>',
    ],
    cdn: [
      'https://cdn.jsdelivr.net/npm/matter-js/build/matter.min.js',
    ],
  },
  {
    id: 'p5',
    label: 'p5.js',
    packageName: 'p5',
    category: 'creative-coding',
    purpose: 'Generative drawing, interactive sketches, procedural visuals, and simple simulations.',
    globals: ['p5'],
    aliases: ['p5.js'],
    assets: [
      {
        publicPath: 'p5.min.js',
        packagePaths: ['lib/p5.min.js'],
        type: 'script',
      },
    ],
    snippets: [
      '<script src="/api/sandbox-libraries/p5/p5.min.js"></script>',
    ],
    cdn: [
      'https://cdn.jsdelivr.net/npm/p5/lib/p5.min.js',
    ],
  },
  {
    id: 'rough',
    label: 'Rough.js',
    packageName: 'roughjs',
    category: 'drawing',
    purpose: 'Hand-drawn styled SVG/canvas diagrams, annotations, and sketches.',
    globals: ['rough'],
    aliases: ['roughjs', 'rough.js'],
    assets: [
      {
        publicPath: 'rough.js',
        packagePaths: ['bundled/rough.js'],
        type: 'script',
      },
    ],
    snippets: [
      '<script src="/api/sandbox-libraries/rough/rough.js"></script>',
    ],
    cdn: [
      'https://cdn.jsdelivr.net/npm/roughjs/bundled/rough.js',
    ],
  },
  {
    id: 'force-graph',
    label: 'Force Graph',
    packageName: 'force-graph',
    category: 'graphs',
    purpose: 'Canvas-based force-directed graph explorers.',
    globals: ['ForceGraph'],
    aliases: ['forcegraph'],
    assets: [
      {
        publicPath: 'force-graph.min.js',
        packagePaths: ['dist/force-graph.min.js'],
        type: 'script',
      },
    ],
    snippets: [
      '<script src="/api/sandbox-libraries/force-graph/force-graph.min.js"></script>',
    ],
    cdn: [
      'https://cdn.jsdelivr.net/npm/force-graph/dist/force-graph.min.js',
    ],
  },
  {
    id: 'force-graph-3d',
    label: '3D Force Graph',
    packageName: '3d-force-graph',
    category: '3d',
    purpose: 'Three.js-powered 3D network graph explorers.',
    globals: ['ForceGraph3D'],
    aliases: ['3d-force-graph', 'forcegraph3d'],
    assets: [
      {
        publicPath: '3d-force-graph.min.js',
        packagePaths: ['dist/3d-force-graph.min.js'],
        type: 'script',
      },
    ],
    snippets: [
      '<script src="/api/sandbox-libraries/force-graph-3d/3d-force-graph.min.js"></script>',
    ],
    cdn: [
      'https://cdn.jsdelivr.net/npm/3d-force-graph/dist/3d-force-graph.min.js',
    ],
  },
]);

function normalizeLibraryId(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';

  const direct = LIBRARIES.find((library) => library.id === normalized);
  if (direct) return direct.id;

  const aliased = LIBRARIES.find((library) => (
    Array.isArray(library.aliases) && library.aliases.includes(normalized)
  ));
  return aliased?.id || '';
}

function normalizeAssetPath(value = '') {
  const normalized = String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .trim();

  if (!normalized || normalized.includes('\0')) {
    return '';
  }

  const safePath = path.posix.normalize(normalized);
  if (!safePath || safePath === '.' || safePath.startsWith('../') || safePath.includes('/../')) {
    return '';
  }

  return safePath;
}

function getPackageRoot(packageName = '') {
  return path.join(NODE_MODULES_ROOT, ...String(packageName || '').split('/').filter(Boolean));
}

function resolvePackagePath(packageName = '', packagePath = '') {
  const packageRoot = getPackageRoot(packageName);
  const resolved = path.resolve(packageRoot, ...String(packagePath || '').split('/').filter(Boolean));
  const relative = path.relative(packageRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return '';
  }
  return resolved;
}

function findExistingPackageAsset(packageName = '', packagePaths = []) {
  for (const packagePath of packagePaths) {
    const resolved = resolvePackagePath(packageName, packagePath);
    if (resolved && fs.existsSync(resolved)) {
      return {
        filePath: resolved,
        packagePath,
      };
    }
  }

  return null;
}

function serializeLibrary(library) {
  return {
    id: library.id,
    label: library.label,
    packageName: library.packageName,
    category: library.category,
    purpose: library.purpose,
    globals: library.globals,
    aliases: library.aliases,
    snippets: library.snippets,
    cdn: library.cdn,
    assets: library.assets.map((asset) => {
      if (asset.publicPath) {
        const existing = findExistingPackageAsset(library.packageName, asset.packagePaths || []);
        return {
          publicPath: asset.publicPath,
          url: `/api/sandbox-libraries/${library.id}/${asset.publicPath}`,
          type: asset.type,
          available: Boolean(existing),
          packagePath: existing?.packagePath || asset.packagePaths?.[0] || '',
        };
      }

      return {
        publicPrefix: asset.publicPrefix,
        urlPrefix: `/api/sandbox-libraries/${library.id}/${asset.publicPrefix}`,
        type: asset.type,
        available: fs.existsSync(resolvePackagePath(library.packageName, asset.packagePrefix || '')),
        packagePrefix: asset.packagePrefix,
      };
    }),
  };
}

function getSandboxBrowserLibraryCatalog() {
  return LIBRARIES.map(serializeLibrary);
}

function resolveSandboxBrowserLibraryAsset(libraryId = '', requestedPath = '') {
  const normalizedLibraryId = normalizeLibraryId(libraryId);
  const library = LIBRARIES.find((entry) => entry.id === normalizedLibraryId);
  const assetPath = normalizeAssetPath(requestedPath);

  if (!library || !assetPath) {
    return null;
  }

  for (const asset of library.assets) {
    if (asset.publicPath && asset.publicPath === assetPath) {
      const existing = findExistingPackageAsset(library.packageName, asset.packagePaths || []);
      if (!existing) return null;
      return {
        ...existing,
        library: serializeLibrary(library),
        publicPath: asset.publicPath,
        type: asset.type,
      };
    }

    if (asset.publicPrefix && assetPath.startsWith(asset.publicPrefix)) {
      const relativeAssetPath = normalizeAssetPath(assetPath.slice(asset.publicPrefix.length));
      if (!relativeAssetPath) return null;
      const packagePath = path.posix.join(asset.packagePrefix || '', relativeAssetPath);
      const resolved = resolvePackagePath(library.packageName, packagePath);
      if (!resolved || !fs.existsSync(resolved)) return null;
      return {
        filePath: resolved,
        packagePath,
        library: serializeLibrary(library),
        publicPath: assetPath,
        type: asset.type,
      };
    }
  }

  return null;
}

function resolveSandboxBrowserLibraryContentType(filePath = '') {
  const extension = path.extname(String(filePath || '').toLowerCase());
  switch (extension) {
  case '.css':
    return 'text/css; charset=utf-8';
  case '.json':
  case '.map':
    return 'application/json; charset=utf-8';
  case '.mjs':
  case '.js':
    return 'text/javascript; charset=utf-8';
  case '.wasm':
    return 'application/wasm';
  default:
    return 'application/octet-stream';
  }
}

function buildSandboxBrowserLibraryInstructions() {
  const catalog = getSandboxBrowserLibraryCatalog();
  const primarySnippets = catalog
    .filter((library) => library.assets.some((asset) => asset.available))
    .map((library) => `${library.label}: ${library.snippets[0]}`)
    .join('; ');
  const fallbackSnippets = catalog
    .filter((library) => !library.assets.some((asset) => asset.available))
    .map((library) => `${library.label}: ${library.cdn[0]}`)
    .join('; ');

  return [
    'Sandbox HTML/browser library defaults are available from local routes under `/api/sandbox-libraries/` when the npm packages are installed in the backend image.',
    'Use these local routes for generated HTML documents, dashboards, graph-heavy pages, and sandbox previews before reaching for external CDNs; keep designs static-safe and browser-runnable without a build step.',
    'Three.js module setup: add `<script type="importmap">{"imports":{"three":"/api/sandbox-libraries/three/three.module.js","three/addons/":"/api/sandbox-libraries/three/addons/"}}</script>`, then use `import * as THREE from "three"` inside a module script.',
    primarySnippets ? `Available local library paths in this runtime: ${primarySnippets}.` : '',
    fallbackSnippets ? `CDN fallback library paths when local routes are unavailable: ${fallbackSnippets}.` : '',
    'If a local library route is unavailable in a development environment, fall back to the matching jsDelivr CDN for that package.',
  ].filter(Boolean).join('\n');
}

module.exports = {
  buildSandboxBrowserLibraryInstructions,
  getSandboxBrowserLibraryCatalog,
  normalizeAssetPath,
  normalizeLibraryId,
  resolveSandboxBrowserLibraryAsset,
  resolveSandboxBrowserLibraryContentType,
};
