#!/usr/bin/env node
'use strict';

process.env.KIMIBUILT_SUPPRESS_SETTINGS_LOG = process.env.KIMIBUILT_SUPPRESS_SETTINGS_LOG || 'true';

const {
  DEFAULT_ACME_EMAIL,
  DEFAULT_BASE_DOMAIN,
  DEFAULT_INGRESS_CLASS,
  DEFAULT_TLS_CLUSTER_ISSUER,
  IngressGuardError,
  applyIngressRoute,
  buildIngressEvent,
  describeBackend,
  formatIngressEvent,
  normalizeRouteSpec,
  upsertIngressRoute,
  verifyIngressRoute,
} = require('../src/k8s/ingress-manager');

function getClusterStateRegistry() {
  return require('../src/cluster-state-registry').clusterStateRegistry;
}

function camelCase(value = '') {
  return String(value)
    .replace(/^--?/, '')
    .replace(/-([a-z0-9])/g, (_match, char) => char.toUpperCase());
}

function parseValue(value = '') {
  const normalized = String(value).trim().toLowerCase();
  if (['true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return value;
}

function parseArgs(argv = []) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      options._.push(arg);
      continue;
    }

    if (arg.startsWith('--no-')) {
      options[camelCase(arg.slice(5))] = false;
      continue;
    }

    const eqIndex = arg.indexOf('=');
    if (eqIndex !== -1) {
      options[camelCase(arg.slice(2, eqIndex))] = parseValue(arg.slice(eqIndex + 1));
      continue;
    }

    const key = camelCase(arg.slice(2));
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      options[key] = true;
      continue;
    }
    options[key] = parseValue(next);
    index += 1;
  }

  if (options.class) {
    options.ingressClass = options.class;
  }
  if (options.tlsSecret) {
    options.tlsSecretName = options.tlsSecret;
  }
  if (options.expectCurrentService) {
    options.expectCurrentServiceName = options.expectCurrentService;
  }
  if (options.expectService) {
    options.expectCurrentServiceName = options.expectService;
  }
  if (options.expectPort) {
    options.expectCurrentServicePort = options.expectPort;
  }
  if (options.email) {
    options.acmeEmail = options.email;
  }

  return options;
}

function printHelp() {
  console.log([
    'kimibuilt-ingress: guarded Traefik/cert-manager Ingress route manager',
    '',
    'Commands:',
    '  plan    Validate inputs and print the Ingress manifest that would be applied',
    '  apply   Preflight the cluster, safely upsert one host/path route, and emit a registry event',
    '  verify  Verify the managed route, TLS secret/certificate, and HTTPS reachability',
    '  list    List recorded edge routes from the local cluster registry',
    '',
    'Required for plan/apply/verify:',
    '  --namespace <ns> --ingress <name> --host <fqdn>|--subdomain <label>',
    '  --service <name> --service-port <port-or-name>',
    '',
    'Defaults:',
    `  --base-domain ${DEFAULT_BASE_DOMAIN}`,
    `  --class ${DEFAULT_INGRESS_CLASS}`,
    `  --issuer ${DEFAULT_TLS_CLUSTER_ISSUER}`,
    `  --email ${DEFAULT_ACME_EMAIL}`,
    '',
    'Examples:',
    '  node bin/kimibuilt-ingress.js plan --namespace kimibuilt --ingress kimibuilt-ingress --subdomain kimibuilt --service backend --service-port 3000',
    '  node bin/kimibuilt-ingress.js apply --namespace app-demo --ingress app-demo --subdomain demo --service web --service-port 80',
    '  node bin/kimibuilt-ingress.js verify --namespace app-demo --ingress app-demo --subdomain demo --service web --service-port 80',
    '',
    'Safety gates:',
    '  Existing host/path backend changes require --expect-current-service and --expect-current-service-port.',
    '  nginx/non-Traefik ingress classes are refused unless --allow-non-traefik is explicit.',
    '  Hosts outside demoserver2.buzz are refused unless --allow-external-host is explicit.',
  ].join('\n'));
}

function printResult(data, options = {}) {
  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const spec = data.spec || {};
  const route = `${spec.host || '(host)'}${spec.path || '/'}`;
  const servicePort = spec.servicePort?.raw || '';
  const backend = `${spec.namespace || '(namespace)'}/${spec.serviceName || '(service)'}:${servicePort}`;
  if (data.action === 'plan') {
    console.log(`Plan OK: ${route} -> ${backend} via ${spec.namespace}/${spec.ingressName} (${spec.ingressClassName}, issuer ${spec.tlsClusterIssuer}).`);
  } else if (data.action === 'apply') {
    console.log(`${data.dryRun ? 'Dry-run OK' : 'Applied'}: ${route} -> ${backend} via ${spec.namespace}/${spec.ingressName}.`);
    if (data.previousBackend) {
      console.log(`Previous backend: ${describeBackend(data.previousBackend)}.`);
    }
  } else if (data.action === 'verify') {
    const v = data.verification || {};
    console.log(`Verify: ingress=${v.ingress ? 'yes' : 'no'} tls=${v.tls ? 'yes' : 'no'} certificateReady=${v.certificateReady ? 'yes' : 'no'} https=${v.https ? 'yes' : 'no'}`);
    (v.details || []).forEach((detail) => console.log(`- ${detail}`));
  }

  if (options.printManifest && data.manifest) {
    console.log(JSON.stringify(data.manifest, null, 2));
  }
}

function routeSpecForFailure(options = {}) {
  try {
    return normalizeRouteSpec(options);
  } catch (_error) {
    return {
      namespace: options.namespace || '',
      ingressName: options.ingressName || options.ingress || options.name || '',
      host: options.host || options.publicHost || options.domain || '',
      subdomain: options.subdomain || '',
      baseDomain: options.baseDomain || DEFAULT_BASE_DOMAIN,
      path: options.path || '/',
      pathType: options.pathType || 'Prefix',
      serviceName: options.serviceName || options.service || options.backendService || '',
      servicePort: { raw: options.servicePort || options.port || options.backendPort || '' },
      deployment: options.deployment || '',
      ingressClassName: options.ingressClassName || options.ingressClass || DEFAULT_INGRESS_CLASS,
      tlsClusterIssuer: options.tlsClusterIssuer || options.issuer || DEFAULT_TLS_CLUSTER_ISSUER,
      tlsSecretName: options.tlsSecretName || options.tlsSecret || '',
      acmeEmail: options.acmeEmail || options.email || DEFAULT_ACME_EMAIL,
    };
  }
}

function recordEvent(event) {
  try {
    const clusterStateRegistry = getClusterStateRegistry();
    const state = clusterStateRegistry.getState();
    clusterStateRegistry.recordIngressRouteEvent({
      state,
      event,
      toolId: 'kimibuilt-ingress',
      target: null,
    });
    clusterStateRegistry.saveState();
  } catch (error) {
    console.warn(`[kimibuilt-ingress] Failed to record cluster registry event: ${error.message}`);
  }
}

async function run() {
  const [command = 'help', ...rest] = process.argv.slice(2);
  const options = parseArgs(rest);
  if (command === 'help' || options.help) {
    printHelp();
    return 0;
  }

  if (command === 'list') {
    const clusterStateRegistry = getClusterStateRegistry();
    const routes = clusterStateRegistry.listEdgeRoutes();
    if (options.json) {
      console.log(JSON.stringify(routes, null, 2));
      return 0;
    }
    if (routes.length === 0) {
      console.log('No recorded edge routes.');
      return 0;
    }
    routes.forEach((route) => {
      console.log(`${route.hostName}${route.path} -> ${route.namespace}/${route.serviceName}:${route.servicePort} via ${route.namespace}/${route.ingressName} tls=${route.verification?.tls ? 'yes' : 'no'} https=${route.verification?.https ? 'yes' : 'no'}`);
    });
    return 0;
  }

  if (!['plan', 'apply', 'verify'].includes(command)) {
    throw new IngressGuardError(`Unknown command '${command}'.`, {
      code: 'UNKNOWN_COMMAND',
      command,
    });
  }

  if (command === 'plan') {
    const spec = normalizeRouteSpec(options);
    const route = upsertIngressRoute(null, spec);
    const result = {
      action: 'plan',
      spec,
      manifest: route.manifest,
    };
    printResult(result, {
      ...options,
      printManifest: options.printManifest !== false,
    });
    return 0;
  }

  if (command === 'apply') {
    const result = await applyIngressRoute(options, {
      dryRun: options.dryRun === true,
      skipClusterChecks: options.skipClusterChecks === true,
      timeoutMs: Number(options.timeoutMs) || 30000,
    });
    const event = buildIngressEvent({
      action: 'apply',
      status: 'succeeded',
      spec: result.spec,
      verification: { ingress: true },
      message: result.dryRun ? 'Dry-run plan generated.' : 'Ingress route applied.',
    });
    if (!result.dryRun) {
      console.log(formatIngressEvent(event));
      recordEvent(event);
    }
    printResult(result, options);
    return 0;
  }

  const result = await verifyIngressRoute(options, {
    checkHttps: options.https !== false,
    httpsTimeoutSeconds: Number(options.httpsTimeoutSeconds) || 20,
  });
  const requiredHttpsOk = options.https === false || result.verification.https;
  const ok = result.verification.ingress && result.verification.tls && requiredHttpsOk;
  const event = buildIngressEvent({
    action: 'verify',
    status: ok ? 'succeeded' : 'failed',
    spec: result.spec,
    verification: result.verification,
    message: ok ? 'Ingress route verified.' : 'Ingress route verification failed.',
    error: ok ? '' : (result.verification.details || []).join(' '),
  });
  console.log(formatIngressEvent(event));
  recordEvent(event);
  printResult(result, options);
  return ok ? 0 : 2;
}

run().then((exitCode) => {
  process.exitCode = exitCode;
}).catch((error) => {
  const options = parseArgs(process.argv.slice(3));
  const command = process.argv[2] || 'unknown';
  const spec = routeSpecForFailure(options);
  const event = buildIngressEvent({
    action: command,
    status: 'failed',
    spec,
    error: error.message,
  });
  if (['apply', 'verify'].includes(command)) {
    console.error(formatIngressEvent(event));
    recordEvent(event);
  }
  if (error instanceof IngressGuardError) {
    console.error(`[kimibuilt-ingress] ${error.message}`);
    if (error.details && Object.keys(error.details).length > 0) {
      console.error(JSON.stringify(error.details, null, 2));
    }
  } else {
    console.error(error.stack || error.message);
  }
  process.exitCode = 1;
});
