'use strict';

const {
  IngressGuardError,
  buildIngressEvent,
  formatIngressEvent,
  normalizeRouteSpec,
  parseIngressEvents,
  upsertIngressRoute,
} = require('./ingress-manager');

describe('ingress-manager', () => {
  test('normalizes a concrete route from a wildcard-domain subdomain', () => {
    const spec = normalizeRouteSpec({
      namespace: 'demo',
      ingress: 'demo',
      subdomain: 'site',
      service: 'web',
      servicePort: '80',
    });

    expect(spec).toEqual(expect.objectContaining({
      namespace: 'demo',
      ingressName: 'demo',
      host: 'site.demoserver2.buzz',
      baseDomain: 'demoserver2.buzz',
      serviceName: 'web',
      ingressClassName: 'traefik',
      tlsClusterIssuer: 'letsencrypt-prod',
      acmeEmail: 'philly1084@gmail.com',
    }));
    expect(spec.servicePort).toEqual(expect.objectContaining({
      type: 'number',
      value: 80,
    }));
  });

  test('refuses nginx ingress class by default', () => {
    expect(() => normalizeRouteSpec({
      namespace: 'demo',
      ingress: 'demo',
      host: 'site.demoserver2.buzz',
      service: 'web',
      servicePort: '80',
      ingressClass: 'nginx',
    })).toThrow(IngressGuardError);
  });

  test('refuses wildcard ingress hosts because wildcard DNS is only the routing base', () => {
    expect(() => normalizeRouteSpec({
      namespace: 'demo',
      ingress: 'demo',
      host: '*.demoserver2.buzz',
      service: 'web',
      servicePort: '80',
    })).toThrow(/concrete host/);
  });

  test('requires an expectation before changing an existing host path backend', () => {
    const existing = {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'Ingress',
      metadata: {
        name: 'demo',
        namespace: 'demo',
      },
      spec: {
        ingressClassName: 'traefik',
        rules: [{
          host: 'site.demoserver2.buzz',
          http: {
            paths: [{
              path: '/',
              pathType: 'Prefix',
              backend: {
                service: {
                  name: 'old-web',
                  port: { number: 80 },
                },
              },
            }],
          },
        }],
      },
    };
    const spec = normalizeRouteSpec({
      namespace: 'demo',
      ingress: 'demo',
      host: 'site.demoserver2.buzz',
      service: 'new-web',
      servicePort: '80',
    });

    expect(() => upsertIngressRoute(existing, spec)).toThrow(/expect-current-service/);
  });

  test('updates an existing route when the current backend is acknowledged', () => {
    const existing = {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'Ingress',
      metadata: {
        name: 'demo',
        namespace: 'demo',
        resourceVersion: '123',
      },
      status: {
        loadBalancer: {},
      },
      spec: {
        ingressClassName: 'traefik',
        tls: [{
          hosts: ['site.demoserver2.buzz'],
          secretName: 'site-tls',
        }],
        rules: [{
          host: 'site.demoserver2.buzz',
          http: {
            paths: [{
              path: '/',
              pathType: 'Prefix',
              backend: {
                service: {
                  name: 'old-web',
                  port: { number: 80 },
                },
              },
            }],
          },
        }],
      },
    };
    const spec = normalizeRouteSpec({
      namespace: 'demo',
      ingress: 'demo',
      host: 'site.demoserver2.buzz',
      service: 'new-web',
      servicePort: '80',
      expectCurrentService: 'old-web',
      expectCurrentServicePort: '80',
    });

    const result = upsertIngressRoute(existing, spec);

    expect(result.changedRoute).toBe(true);
    expect(result.manifest.status).toBeUndefined();
    expect(result.manifest.metadata.resourceVersion).toBeUndefined();
    expect(result.manifest.spec.rules[0].http.paths[0].backend.service.name).toBe('new-web');
    expect(result.manifest.spec.tls[0].secretName).toBe('site-tls');
    expect(result.manifest.metadata.annotations).toEqual(expect.objectContaining({
      'cert-manager.io/cluster-issuer': 'letsencrypt-prod',
      'kimibuilt.dev/managed-by': 'kimibuilt-ingress',
    }));
  });

  test('formats parseable registry events', () => {
    const spec = normalizeRouteSpec({
      namespace: 'demo',
      ingress: 'demo',
      subdomain: 'site',
      service: 'web',
      servicePort: '80',
    });
    const event = buildIngressEvent({
      action: 'apply',
      status: 'succeeded',
      spec,
      verification: { ingress: true },
    });

    expect(parseIngressEvents(formatIngressEvent(event))).toEqual([
      expect.objectContaining({
        eventType: 'kimibuilt-ingress',
        action: 'apply',
        host: 'site.demoserver2.buzz',
      }),
    ]);
  });
});
