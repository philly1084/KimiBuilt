'use strict';

const { spawn } = require('child_process');

const EVENT_PREFIX = 'KIMIBUILT_INGRESS_EVENT ';
const DEFAULT_BASE_DOMAIN = 'demoserver2.buzz';
const DEFAULT_INGRESS_CLASS = 'traefik';
const DEFAULT_TLS_CLUSTER_ISSUER = 'letsencrypt-prod';
const DEFAULT_ACME_EMAIL = 'philly1084@gmail.com';
const MANAGED_BY = 'kimibuilt-ingress';

class IngressGuardError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'IngressGuardError';
    this.code = details.code || 'INGRESS_GUARD_FAILED';
    this.details = details;
  }
}

function normalizeText(value = '') {
  return String(value ?? '').trim();
}

function normalizeLowerText(value = '') {
  return normalizeText(value).toLowerCase();
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function toBoolean(value, fallback = false) {
  if (value === true || value === false) {
    return value;
  }
  const normalized = normalizeLowerText(value);
  if (!normalized) {
    return fallback;
  }
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
}

function normalizeHost(value = '') {
  let normalized = normalizeLowerText(value);
  if (!normalized) {
    return '';
  }

  normalized = normalized.replace(/^https?:\/\//, '');
  normalized = normalized.split('/')[0].split(':')[0].replace(/\.$/, '');
  return normalized;
}

function normalizeKubernetesName(value = '', fieldName = 'name') {
  const normalized = normalizeLowerText(value);
  if (!normalized) {
    throw new IngressGuardError(`${fieldName} is required.`, {
      code: 'MISSING_REQUIRED_FIELD',
      field: fieldName,
    });
  }
  if (!/^[a-z0-9]([-.a-z0-9]*[a-z0-9])?$/.test(normalized) || normalized.length > 253) {
    throw new IngressGuardError(`${fieldName} must be a Kubernetes DNS label/name.`, {
      code: 'INVALID_KUBERNETES_NAME',
      field: fieldName,
      value,
    });
  }
  return normalized;
}

function normalizeDnsLabel(value = '', fieldName = 'label') {
  const normalized = normalizeLowerText(value);
  if (!normalized) {
    throw new IngressGuardError(`${fieldName} is required.`, {
      code: 'MISSING_REQUIRED_FIELD',
      field: fieldName,
    });
  }
  if (!/^[a-z0-9]([-.a-z0-9]*[a-z0-9])?$/.test(normalized)) {
    throw new IngressGuardError(`${fieldName} must contain only DNS label characters.`, {
      code: 'INVALID_DNS_LABEL',
      field: fieldName,
      value,
    });
  }
  return normalized;
}

function normalizePath(value = '/') {
  const normalized = normalizeText(value || '/');
  if (!normalized.startsWith('/')) {
    throw new IngressGuardError('path must start with /.', {
      code: 'INVALID_PATH',
      field: 'path',
      value,
    });
  }
  if (/[\0\r\n]/.test(normalized)) {
    throw new IngressGuardError('path must be a single path value.', {
      code: 'INVALID_PATH',
      field: 'path',
      value,
    });
  }
  return normalized;
}

function normalizePathType(value = 'Prefix') {
  const normalized = normalizeText(value || 'Prefix');
  const allowed = new Set(['Prefix', 'Exact', 'ImplementationSpecific']);
  if (!allowed.has(normalized)) {
    throw new IngressGuardError('pathType must be Prefix, Exact, or ImplementationSpecific.', {
      code: 'INVALID_PATH_TYPE',
      field: 'pathType',
      value,
    });
  }
  return normalized;
}

function parseServicePort(value, fieldName = 'servicePort') {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new IngressGuardError(`${fieldName} is required.`, {
      code: 'MISSING_REQUIRED_FIELD',
      field: fieldName,
    });
  }

  if (/^\d+$/.test(normalized)) {
    const parsed = Number(normalized);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      throw new IngressGuardError(`${fieldName} must be a TCP port from 1 to 65535.`, {
        code: 'INVALID_SERVICE_PORT',
        field: fieldName,
        value,
      });
    }
    return {
      type: 'number',
      value: parsed,
      raw: String(parsed),
    };
  }

  if (!/^[a-z0-9]([-.a-z0-9]*[a-z0-9])?$/.test(normalized) || normalized.length > 63) {
    throw new IngressGuardError(`${fieldName} must be a numeric service port or named service port.`, {
      code: 'INVALID_SERVICE_PORT',
      field: fieldName,
      value,
    });
  }

  return {
    type: 'name',
    value: normalized,
    raw: normalized,
  };
}

function normalizeBaseDomain(value = '') {
  return normalizeHost(value || process.env.KIMIBUILT_INGRESS_BASE_DOMAIN || process.env.MANAGED_APPS_BASE_DOMAIN || DEFAULT_BASE_DOMAIN);
}

function buildHost({ host = '', subdomain = '', baseDomain = DEFAULT_BASE_DOMAIN } = {}) {
  const normalizedBase = normalizeBaseDomain(baseDomain);
  const normalizedHost = normalizeHost(host);
  if (normalizedHost) {
    return normalizedHost;
  }

  const normalizedSubdomain = normalizeDnsLabel(subdomain, 'subdomain');
  return `${normalizedSubdomain}.${normalizedBase}`;
}

function toDnsLabel(value = '', fallback = 'route') {
  const normalized = normalizeLowerText(value)
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
  const candidate = normalized || fallback;
  return candidate.length <= 63
    ? candidate
    : candidate.slice(0, 63).replace(/-+$/g, '') || fallback;
}

function buildDefaultTlsSecretName(host = '') {
  return toDnsLabel(`${normalizeHost(host).replace(/\./g, '-')}-tls`, 'route-tls');
}

function validateHostDomain(host = '', baseDomain = '', allowExternalHost = false) {
  if (!host) {
    throw new IngressGuardError('host or subdomain is required.', {
      code: 'MISSING_REQUIRED_FIELD',
      field: 'host',
    });
  }
  if (host.startsWith('*.')) {
    throw new IngressGuardError('Do not create wildcard Ingress rules here. Use a concrete host like app.demoserver2.buzz; wildcard DNS already points hostnames at Traefik.', {
      code: 'WILDCARD_HOST_REFUSED',
      field: 'host',
      value: host,
    });
  }
  if (!/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(host)) {
    throw new IngressGuardError('host must be a fully-qualified DNS name.', {
      code: 'INVALID_HOST',
      field: 'host',
      value: host,
    });
  }
  if (!allowExternalHost && baseDomain && host !== baseDomain && !host.endsWith(`.${baseDomain}`)) {
    throw new IngressGuardError(`host must be ${baseDomain} or a subdomain of ${baseDomain}. Pass allowExternalHost only for deliberate non-standard routing.`, {
      code: 'HOST_OUTSIDE_BASE_DOMAIN',
      field: 'host',
      value: host,
      baseDomain,
    });
  }
}

function normalizeRouteSpec(input = {}) {
  const baseDomain = normalizeBaseDomain(input.baseDomain);
  const host = buildHost({
    host: input.host || input.publicHost || input.domain,
    subdomain: input.subdomain,
    baseDomain,
  });
  const allowExternalHost = toBoolean(input.allowExternalHost, false);
  validateHostDomain(host, baseDomain, allowExternalHost);

  const namespace = normalizeKubernetesName(input.namespace, 'namespace');
  const ingressName = normalizeKubernetesName(input.ingressName || input.ingress || input.name, 'ingressName');
  const serviceName = normalizeKubernetesName(input.serviceName || input.service || input.backendService, 'serviceName');
  const servicePort = parseServicePort(input.servicePort || input.port || input.backendPort, 'servicePort');
  const ingressClassName = normalizeKubernetesName(
    input.ingressClassName || input.ingressClass || process.env.KIMIBUILT_DEPLOY_INGRESS_CLASS || DEFAULT_INGRESS_CLASS,
    'ingressClassName',
  );
  const allowNonTraefik = toBoolean(input.allowNonTraefik, false);
  if (ingressClassName !== DEFAULT_INGRESS_CLASS && !allowNonTraefik) {
    throw new IngressGuardError(`ingressClassName '${ingressClassName}' refused. This cluster is managed through k3s Traefik; do not use nginx unless an operator explicitly allows it.`, {
      code: 'NON_TRAEFIK_INGRESS_REFUSED',
      field: 'ingressClassName',
      value: ingressClassName,
    });
  }

  const tlsClusterIssuer = normalizeKubernetesName(
    input.tlsClusterIssuer || input.issuer || process.env.KIMIBUILT_DEPLOY_TLS_CLUSTER_ISSUER || DEFAULT_TLS_CLUSTER_ISSUER,
    'tlsClusterIssuer',
  );
  const tlsSecretNameExplicit = Boolean(normalizeText(input.tlsSecretName || input.tlsSecret));
  const tlsSecretName = normalizeKubernetesName(input.tlsSecretName || input.tlsSecret || buildDefaultTlsSecretName(host), 'tlsSecretName');
  const path = normalizePath(input.path || '/');
  const pathType = normalizePathType(input.pathType || 'Prefix');
  const acmeEmail = normalizeText(input.acmeEmail || input.email || process.env.KIMIBUILT_ACME_EMAIL || DEFAULT_ACME_EMAIL);

  return {
    namespace,
    ingressName,
    host,
    subdomain: normalizeText(input.subdomain),
    baseDomain,
    path,
    pathType,
    serviceName,
    servicePort,
    deployment: normalizeLowerText(input.deployment),
    ingressClassName,
    tlsClusterIssuer,
    tlsSecretName,
    tlsSecretNameExplicit,
    acmeEmail,
    allowExternalHost,
    allowNonTraefik,
    allowHostTakeover: toBoolean(input.allowHostTakeover, false),
    allowIngressClassChange: toBoolean(input.allowIngressClassChange, false),
    allowTlsSecretChange: toBoolean(input.allowTlsSecretChange, false),
    expectCurrentServiceName: normalizeLowerText(input.expectCurrentServiceName || input.expectCurrentService || input.expectService || input.currentService),
    expectCurrentServicePort: normalizeText(input.expectCurrentServicePort || input.expectPort || input.currentPort)
      ? parseServicePort(input.expectCurrentServicePort || input.expectPort || input.currentPort, 'expectCurrentServicePort')
      : null,
    dryRun: toBoolean(input.dryRun, false),
  };
}

function servicePortToBackendPort(servicePort) {
  return servicePort.type === 'name'
    ? { name: servicePort.value }
    : { number: servicePort.value };
}

function backendRef(serviceName, servicePort) {
  return {
    serviceName,
    servicePort,
  };
}

function backendFromIngressPath(pathEntry = {}) {
  const service = pathEntry.backend?.service || {};
  const port = service.port || {};
  if (!service.name) {
    return null;
  }
  if (hasOwn(port, 'number')) {
    return backendRef(service.name, parseServicePort(port.number, 'servicePort'));
  }
  if (hasOwn(port, 'name')) {
    return backendRef(service.name, parseServicePort(port.name, 'servicePort'));
  }
  return null;
}

function backendRefsEqual(left = null, right = null) {
  if (!left || !right) {
    return false;
  }
  return normalizeLowerText(left.serviceName) === normalizeLowerText(right.serviceName)
    && left.servicePort?.type === right.servicePort?.type
    && String(left.servicePort?.value) === String(right.servicePort?.value);
}

function describeBackend(backend = null) {
  if (!backend) {
    return '(none)';
  }
  return `${backend.serviceName}:${backend.servicePort?.raw || backend.servicePort?.value || ''}`;
}

function desiredBackendFromSpec(spec) {
  return backendRef(spec.serviceName, spec.servicePort);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function stripKubernetesRuntimeFields(resource = {}) {
  const clone = cloneJson(resource);
  delete clone.status;
  if (clone.metadata) {
    [
      'uid',
      'resourceVersion',
      'generation',
      'creationTimestamp',
      'managedFields',
      'selfLink',
    ].forEach((key) => {
      delete clone.metadata[key];
    });
  }
  return clone;
}

function createIngressManifest(spec) {
  return {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'Ingress',
    metadata: {
      name: spec.ingressName,
      namespace: spec.namespace,
      labels: {
        'app.kubernetes.io/managed-by': MANAGED_BY,
      },
      annotations: {},
    },
    spec: {
      ingressClassName: spec.ingressClassName,
      tls: [],
      rules: [],
    },
  };
}

function ensureIngressMetadata(manifest, spec) {
  manifest.apiVersion = 'networking.k8s.io/v1';
  manifest.kind = 'Ingress';
  manifest.metadata = manifest.metadata || {};
  manifest.metadata.name = spec.ingressName;
  manifest.metadata.namespace = spec.namespace;
  manifest.metadata.labels = {
    ...(manifest.metadata.labels || {}),
    'app.kubernetes.io/managed-by': MANAGED_BY,
  };
  manifest.metadata.annotations = {
    ...(manifest.metadata.annotations || {}),
    'kubernetes.io/ingress.class': spec.ingressClassName,
    'traefik.ingress.kubernetes.io/router.entrypoints': 'web,websecure',
    'traefik.ingress.kubernetes.io/router.tls': 'true',
    'cert-manager.io/cluster-issuer': spec.tlsClusterIssuer,
    'kimibuilt.dev/managed-by': MANAGED_BY,
    'kimibuilt.dev/base-domain': spec.baseDomain,
    'kimibuilt.dev/last-route-host': spec.host,
    'kimibuilt.dev/last-route-path': spec.path,
  };
  manifest.spec = manifest.spec || {};
  manifest.spec.ingressClassName = spec.ingressClassName;
  manifest.spec.rules = Array.isArray(manifest.spec.rules) ? manifest.spec.rules : [];
  manifest.spec.tls = Array.isArray(manifest.spec.tls) ? manifest.spec.tls : [];
}

function findHostRule(manifest, host) {
  return (manifest.spec?.rules || []).find((rule) => normalizeHost(rule.host) === host) || null;
}

function findPathEntry(rule, path) {
  const paths = rule?.http?.paths || [];
  return paths.find((entry) => entry.path === path) || null;
}

function assertRouteChangeAllowed(existingBackend, desiredBackend, spec) {
  if (!existingBackend || backendRefsEqual(existingBackend, desiredBackend)) {
    return;
  }

  if (!spec.expectCurrentServiceName || !spec.expectCurrentServicePort) {
    throw new IngressGuardError(`Existing route ${spec.host}${spec.path} points to ${describeBackend(existingBackend)}. To change it to ${describeBackend(desiredBackend)}, pass --expect-current-service ${existingBackend.serviceName} --expect-current-service-port ${existingBackend.servicePort.raw}.`, {
      code: 'ROUTE_BACKEND_CHANGE_REQUIRES_EXPECTATION',
      host: spec.host,
      path: spec.path,
      existingBackend: describeBackend(existingBackend),
      desiredBackend: describeBackend(desiredBackend),
    });
  }

  const expectedBackend = backendRef(spec.expectCurrentServiceName, spec.expectCurrentServicePort);
  if (!backendRefsEqual(existingBackend, expectedBackend)) {
    throw new IngressGuardError(`Expected current backend ${describeBackend(expectedBackend)} did not match live route ${describeBackend(existingBackend)}.`, {
      code: 'ROUTE_BACKEND_EXPECTATION_MISMATCH',
      host: spec.host,
      path: spec.path,
      existingBackend: describeBackend(existingBackend),
      expectedBackend: describeBackend(expectedBackend),
    });
  }
}

function ensureTlsHost(manifest, spec) {
  const tlsEntries = manifest.spec.tls || [];
  let existing = tlsEntries.find((entry) => Array.isArray(entry.hosts) && entry.hosts.map(normalizeHost).includes(spec.host));
  if (existing && existing.secretName && existing.secretName !== spec.tlsSecretName) {
    if (!spec.tlsSecretNameExplicit) {
      spec.tlsSecretName = existing.secretName;
      return;
    }
    if (!spec.allowTlsSecretChange) {
      throw new IngressGuardError(`Existing TLS host ${spec.host} uses secret ${existing.secretName}. Pass --allow-tls-secret-change only if rotating it intentionally.`, {
        code: 'TLS_SECRET_CHANGE_REFUSED',
        host: spec.host,
        existingSecretName: existing.secretName,
        desiredSecretName: spec.tlsSecretName,
      });
    }
  }

  if (!existing) {
    existing = {
      hosts: [],
      secretName: spec.tlsSecretName,
    };
    tlsEntries.push(existing);
    manifest.spec.tls = tlsEntries;
  }

  existing.hosts = Array.from(new Set([...(existing.hosts || []).map(normalizeHost), spec.host])).filter(Boolean);
  existing.secretName = spec.tlsSecretName;
}

function upsertIngressRoute(existingIngress, spec) {
  const manifest = existingIngress
    ? stripKubernetesRuntimeFields(existingIngress)
    : createIngressManifest(spec);
  ensureIngressMetadata(manifest, spec);

  if (existingIngress) {
    const existingClass = normalizeLowerText(existingIngress.spec?.ingressClassName || existingIngress.metadata?.annotations?.['kubernetes.io/ingress.class']);
    if (existingClass && existingClass !== spec.ingressClassName && !spec.allowIngressClassChange) {
      throw new IngressGuardError(`Existing ingress ${spec.namespace}/${spec.ingressName} uses ingress class ${existingClass}, not ${spec.ingressClassName}.`, {
        code: 'INGRESS_CLASS_CHANGE_REFUSED',
        existingClass,
        desiredClass: spec.ingressClassName,
      });
    }
  }

  let rule = findHostRule(manifest, spec.host);
  if (!rule) {
    rule = {
      host: spec.host,
      http: {
        paths: [],
      },
    };
    manifest.spec.rules.push(rule);
  }
  rule.http = rule.http || {};
  rule.http.paths = Array.isArray(rule.http.paths) ? rule.http.paths : [];

  const desiredBackend = desiredBackendFromSpec(spec);
  let pathEntry = findPathEntry(rule, spec.path);
  const previousBackend = pathEntry ? backendFromIngressPath(pathEntry) : null;
  assertRouteChangeAllowed(previousBackend, desiredBackend, spec);

  if (!pathEntry) {
    pathEntry = {
      path: spec.path,
      pathType: spec.pathType,
      backend: {},
    };
    rule.http.paths.push(pathEntry);
  }

  pathEntry.path = spec.path;
  pathEntry.pathType = spec.pathType;
  pathEntry.backend = {
    service: {
      name: spec.serviceName,
      port: servicePortToBackendPort(spec.servicePort),
    },
  };

  ensureTlsHost(manifest, spec);

  return {
    manifest,
    previousBackend,
    changedRoute: !backendRefsEqual(previousBackend, desiredBackend),
  };
}

function serviceHasPort(service, servicePort) {
  const ports = service?.spec?.ports || [];
  return ports.some((entry) => {
    if (servicePort.type === 'number') {
      return Number(entry.port) === servicePort.value;
    }
    return normalizeLowerText(entry.name) === servicePort.value;
  });
}

function summarizeServicePorts(service) {
  return (service?.spec?.ports || [])
    .map((entry) => entry.name ? `${entry.name}:${entry.port}` : String(entry.port))
    .join(', ');
}

function buildIngressEvent({ action = '', status = '', spec = {}, verification = {}, message = '', error = '' } = {}) {
  return {
    eventType: 'kimibuilt-ingress',
    timestamp: new Date().toISOString(),
    action: normalizeLowerText(action),
    status: normalizeLowerText(status),
    namespace: spec.namespace || '',
    ingressName: spec.ingressName || '',
    host: spec.host || '',
    baseDomain: spec.baseDomain || '',
    path: spec.path || '/',
    pathType: spec.pathType || 'Prefix',
    serviceName: spec.serviceName || '',
    servicePort: spec.servicePort?.raw || '',
    deployment: spec.deployment || '',
    ingressClassName: spec.ingressClassName || '',
    tlsClusterIssuer: spec.tlsClusterIssuer || '',
    tlsSecretName: spec.tlsSecretName || '',
    acmeEmail: spec.acmeEmail || '',
    verification: {
      ingress: verification.ingress === true,
      tls: verification.tls === true,
      certificateReady: verification.certificateReady === true,
      https: verification.https === true,
    },
    message: normalizeText(message),
    error: normalizeText(error),
  };
}

function formatIngressEvent(event = {}) {
  return `${EVENT_PREFIX}${JSON.stringify(event)}`;
}

function parseIngressEventLine(line = '') {
  const source = String(line || '');
  const index = source.indexOf(EVENT_PREFIX);
  if (index === -1) {
    return null;
  }

  try {
    const parsed = JSON.parse(source.slice(index + EVENT_PREFIX.length));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function parseIngressEvents(text = '') {
  return String(text || '')
    .split(/\r?\n/)
    .map(parseIngressEventLine)
    .filter(Boolean);
}

function createKubectlExecutor({ kubectl = process.env.KUBECTL || 'kubectl', env = process.env } = {}) {
  return function executeKubectl(args = [], options = {}) {
    return new Promise((resolve) => {
      let child;
      try {
        child = spawn(kubectl, args, {
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (error) {
        resolve({
          exitCode: 127,
          stdout: '',
          stderr: error.message,
          error,
        });
        return;
      }

      let stdout = '';
      let stderr = '';
      let settled = false;
      const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 30000);
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        child.kill('SIGTERM');
        resolve({
          exitCode: 124,
          stdout,
          stderr: `${stderr}\nkubectl timed out after ${timeoutMs}ms`.trim(),
        });
      }, timeoutMs);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve({
          exitCode: 127,
          stdout,
          stderr: `${stderr}\n${error.message}`.trim(),
          error,
        });
      });
      child.on('close', (exitCode) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve({
          exitCode,
          stdout,
          stderr,
        });
      });

      if (options.input) {
        child.stdin.write(options.input);
      }
      child.stdin.end();
    });
  };
}

async function kubectlJson(executeKubectl, args = [], options = {}) {
  const result = await executeKubectl([...args, '-o', 'json'], {
    timeoutMs: options.timeoutMs || 30000,
  });
  if (result.exitCode !== 0) {
    if (options.allowMissing) {
      return null;
    }
    throw new IngressGuardError(`kubectl ${args.join(' ')} failed: ${result.stderr || result.stdout}`.trim(), {
      code: 'KUBECTL_FAILED',
      args,
      stderr: result.stderr,
      stdout: result.stdout,
    });
  }

  try {
    return JSON.parse(result.stdout || '{}');
  } catch (error) {
    throw new IngressGuardError(`kubectl ${args.join(' ')} returned invalid JSON: ${error.message}`, {
      code: 'KUBECTL_INVALID_JSON',
      args,
      stdout: result.stdout,
    });
  }
}

async function preflightIngressRoute(spec, options = {}) {
  if (options.skipClusterChecks) {
    return {
      skipped: true,
      existingIngress: null,
      checks: [],
      warnings: ['Cluster checks skipped.'],
    };
  }

  const executeKubectl = options.executeKubectl || createKubectlExecutor(options);
  const checks = [];
  const warnings = [];

  const namespace = await kubectlJson(executeKubectl, ['get', 'namespace', spec.namespace], { allowMissing: true });
  if (!namespace) {
    throw new IngressGuardError(`Namespace ${spec.namespace} does not exist. Create it before applying an ingress route.`, {
      code: 'NAMESPACE_NOT_FOUND',
      namespace: spec.namespace,
    });
  }
  checks.push(`namespace/${spec.namespace}`);

  const ingressClass = await kubectlJson(executeKubectl, ['get', 'ingressclass', spec.ingressClassName], { allowMissing: true });
  if (!ingressClass) {
    throw new IngressGuardError(`IngressClass ${spec.ingressClassName} does not exist. This cluster should use k3s Traefik.`, {
      code: 'INGRESS_CLASS_NOT_FOUND',
      ingressClassName: spec.ingressClassName,
    });
  }
  checks.push(`ingressclass/${spec.ingressClassName}`);

  const clusterIssuer = await kubectlJson(executeKubectl, ['get', 'clusterissuer', spec.tlsClusterIssuer], { allowMissing: true });
  if (!clusterIssuer) {
    throw new IngressGuardError(`ClusterIssuer ${spec.tlsClusterIssuer} does not exist. Apply k8s/cluster-issuer.yaml or create a cert-manager ClusterIssuer with ACME email ${spec.acmeEmail}.`, {
      code: 'CLUSTER_ISSUER_NOT_FOUND',
      tlsClusterIssuer: spec.tlsClusterIssuer,
      acmeEmail: spec.acmeEmail,
    });
  }
  checks.push(`clusterissuer/${spec.tlsClusterIssuer}`);

  const service = await kubectlJson(executeKubectl, ['get', 'service', spec.serviceName, '-n', spec.namespace], { allowMissing: true });
  if (!service) {
    throw new IngressGuardError(`Service ${spec.namespace}/${spec.serviceName} does not exist.`, {
      code: 'SERVICE_NOT_FOUND',
      namespace: spec.namespace,
      serviceName: spec.serviceName,
    });
  }
  if (!serviceHasPort(service, spec.servicePort)) {
    throw new IngressGuardError(`Service ${spec.namespace}/${spec.serviceName} does not expose port ${spec.servicePort.raw}. Available ports: ${summarizeServicePorts(service) || '(none)'}.`, {
      code: 'SERVICE_PORT_NOT_FOUND',
      namespace: spec.namespace,
      serviceName: spec.serviceName,
      servicePort: spec.servicePort.raw,
      availablePorts: summarizeServicePorts(service),
    });
  }
  checks.push(`service/${spec.serviceName}:${spec.servicePort.raw}`);

  const existingIngress = await kubectlJson(executeKubectl, ['get', 'ingress', spec.ingressName, '-n', spec.namespace], { allowMissing: true });
  const ingressList = await kubectlJson(executeKubectl, ['get', 'ingress', '-A'], { allowMissing: true });
  const collisions = (ingressList?.items || [])
    .filter((item) => {
      const itemNamespace = normalizeText(item.metadata?.namespace);
      const itemName = normalizeText(item.metadata?.name);
      if (itemNamespace === spec.namespace && itemName === spec.ingressName) {
        return false;
      }
      return (item.spec?.rules || []).some((rule) => normalizeHost(rule.host) === spec.host);
    })
    .map((item) => `${item.metadata?.namespace}/${item.metadata?.name}`);
  if (collisions.length > 0 && !spec.allowHostTakeover) {
    throw new IngressGuardError(`Host ${spec.host} is already routed by ${collisions.join(', ')}. Refusing to update a different ingress without --allow-host-takeover.`, {
      code: 'HOST_ALREADY_ROUTED',
      host: spec.host,
      collisions,
    });
  }
  if (collisions.length > 0) {
    warnings.push(`Host takeover allowed for ${spec.host}; existing routes: ${collisions.join(', ')}.`);
  }

  return {
    skipped: false,
    existingIngress,
    checks,
    warnings,
  };
}

async function applyIngressRoute(input = {}, options = {}) {
  const spec = normalizeRouteSpec(input);
  const preflight = await preflightIngressRoute(spec, options);
  const route = upsertIngressRoute(preflight.existingIngress, spec);
  if (input.dryRun || options.dryRun) {
    return {
      action: 'apply',
      dryRun: true,
      spec,
      preflight,
      manifest: route.manifest,
      previousBackend: route.previousBackend,
      changedRoute: route.changedRoute,
      apply: null,
    };
  }

  const executeKubectl = options.executeKubectl || createKubectlExecutor(options);
  const apply = await executeKubectl(['apply', '-f', '-'], {
    input: JSON.stringify(route.manifest, null, 2),
    timeoutMs: options.timeoutMs || 30000,
  });
  if (apply.exitCode !== 0) {
    throw new IngressGuardError(`kubectl apply failed: ${apply.stderr || apply.stdout}`.trim(), {
      code: 'KUBECTL_APPLY_FAILED',
      stderr: apply.stderr,
      stdout: apply.stdout,
    });
  }

  return {
    action: 'apply',
    dryRun: false,
    spec,
    preflight,
    manifest: route.manifest,
    previousBackend: route.previousBackend,
    changedRoute: route.changedRoute,
    apply,
  };
}

async function verifyIngressRoute(input = {}, options = {}) {
  const spec = normalizeRouteSpec(input);
  const executeKubectl = options.executeKubectl || createKubectlExecutor(options);
  const ingress = await kubectlJson(executeKubectl, ['get', 'ingress', spec.ingressName, '-n', spec.namespace], { allowMissing: true });
  if (!ingress) {
    throw new IngressGuardError(`Ingress ${spec.namespace}/${spec.ingressName} does not exist.`, {
      code: 'INGRESS_NOT_FOUND',
      namespace: spec.namespace,
      ingressName: spec.ingressName,
    });
  }

  const rule = findHostRule(ingress, spec.host);
  const pathEntry = findPathEntry(rule, spec.path);
  const liveBackend = pathEntry ? backendFromIngressPath(pathEntry) : null;
  const desiredBackend = desiredBackendFromSpec(spec);
  const verification = {
    ingress: Boolean(rule && pathEntry && backendRefsEqual(liveBackend, desiredBackend)),
    tls: false,
    certificateReady: false,
    https: false,
    details: [],
  };
  if (!verification.ingress) {
    verification.details.push(`Route ${spec.host}${spec.path} is missing or points to ${describeBackend(liveBackend)} instead of ${describeBackend(desiredBackend)}.`);
  }

  const tlsEntry = (ingress.spec?.tls || []).find((entry) => (entry.hosts || []).map(normalizeHost).includes(spec.host));
  if (tlsEntry?.secretName) {
    const secret = await kubectlJson(executeKubectl, ['get', 'secret', tlsEntry.secretName, '-n', spec.namespace], { allowMissing: true });
    verification.tls = Boolean(secret);
    if (!secret) {
      verification.details.push(`TLS secret ${spec.namespace}/${tlsEntry.secretName} is referenced but not present yet.`);
    }
  } else {
    verification.details.push(`No TLS entry found for ${spec.host}.`);
  }

  const certificates = await kubectlJson(executeKubectl, ['get', 'certificate', '-n', spec.namespace], { allowMissing: true });
  const certificate = (certificates?.items || []).find((item) => {
    return item.spec?.secretName === (tlsEntry?.secretName || spec.tlsSecretName)
      || normalizeText(item.metadata?.name) === (tlsEntry?.secretName || spec.tlsSecretName);
  });
  if (certificate) {
    verification.certificateReady = (certificate.status?.conditions || [])
      .some((condition) => condition.type === 'Ready' && condition.status === 'True');
    if (!verification.certificateReady) {
      verification.details.push(`Certificate ${spec.namespace}/${certificate.metadata?.name} exists but is not Ready.`);
    }
  } else {
    verification.details.push(`No cert-manager Certificate found for secret ${tlsEntry?.secretName || spec.tlsSecretName}.`);
  }

  if (options.checkHttps !== false) {
    const httpsPath = spec.path === '/' ? '/' : spec.path;
    const curl = await spawnCommand(options.curl || 'curl', [
      '-fsSIL',
      '--max-time',
      String(Math.max(1, Number(options.httpsTimeoutSeconds) || 20)),
      `https://${spec.host}${httpsPath}`,
    ], {
      timeoutMs: Math.max(2000, (Number(options.httpsTimeoutSeconds) || 20) * 1000 + 1000),
    });
    verification.https = curl.exitCode === 0;
    if (!verification.https) {
      verification.details.push(`HTTPS check failed for https://${spec.host}${httpsPath}: ${curl.stderr || curl.stdout || `exit ${curl.exitCode}`}`.trim());
    }
  }

  return {
    action: 'verify',
    spec,
    verification,
  };
}

function spawnCommand(command, args = [], options = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        env: options.env || process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve({
        exitCode: 127,
        stdout: '',
        stderr: error.message,
      });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 30000);
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill('SIGTERM');
      resolve({
        exitCode: 124,
        stdout,
        stderr: `${stderr}\n${command} timed out after ${timeoutMs}ms`.trim(),
      });
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode: 127,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
      });
    });
    child.on('close', (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode,
        stdout,
        stderr,
      });
    });
  });
}

module.exports = {
  DEFAULT_ACME_EMAIL,
  DEFAULT_BASE_DOMAIN,
  DEFAULT_INGRESS_CLASS,
  DEFAULT_TLS_CLUSTER_ISSUER,
  EVENT_PREFIX,
  IngressGuardError,
  applyIngressRoute,
  buildDefaultTlsSecretName,
  buildIngressEvent,
  createKubectlExecutor,
  describeBackend,
  formatIngressEvent,
  normalizeRouteSpec,
  parseIngressEvents,
  preflightIngressRoute,
  upsertIngressRoute,
  verifyIngressRoute,
};
