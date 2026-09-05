import { describe, expect, it } from 'vitest';
import { kubectlEnvironment, validateTestManifests } from './check.mjs';
const config = () => ({
  kind: 'ConfigMap',
  metadata: { name: 'masterino-config', namespace: 'masterino-test' },
  data: {
    APP_URL: 'https://mlai-test.bielcrystal.com',
    DEVICE_GATEWAY_URL: 'http://masterino-device-gateway:8788',
  },
});

const deployment = (container: Record<string, unknown>) => ({
  kind: 'Deployment',
  metadata: { name: 'masterino', namespace: 'masterino-test' },
  spec: { template: { spec: { containers: [{ name: 'app', ...container }] } } },
});
const fromConfig = { configMapRef: { name: 'masterino-config' } };

describe('effective container configuration', () => {
  it('rejects explicit localhost and production overrides of both protected addresses', () => {
    for (const name of ['APP_URL', 'DEVICE_GATEWAY_URL'])
      for (const value of ['http://localhost:3010', 'https://masterino.bielcrystal.com'])
        expect(() =>
          validateTestManifests([
            config(),
            deployment({
              envFrom: [fromConfig],
              env: [{ name, value }],
            }),
          ]),
        ).toThrow(`effective test ${name}`);
  });
  it('applies envFrom order, then explicit env precedence', () => {
    const override = {
      ...config(),
      metadata: { name: 'override', namespace: 'masterino-test' },
      data: { APP_URL: 'http://localhost:3010' },
    };
    const fromOverride = { configMapRef: { name: 'override' } };
    expect(() =>
      validateTestManifests([
        config(),
        override,
        deployment({ envFrom: [fromConfig, fromOverride] }),
      ]),
    ).toThrow('APP_URL');
    expect(() =>
      validateTestManifests([
        config(),
        override,
        deployment({ envFrom: [fromOverride, fromConfig] }),
      ]),
    ).not.toThrow();
    expect(() =>
      validateTestManifests([
        config(),
        override,
        deployment({
          envFrom: [fromConfig, fromOverride],
          env: [{ name: 'APP_URL', value: config().data.APP_URL }],
        }),
      ]),
    ).not.toThrow();
  });
  it('resolves key references and rejects unresolved or dynamically expanded addresses', () => {
    const env = [
      {
        name: 'APP_URL',
        valueFrom: { configMapKeyRef: { name: 'masterino-config', key: 'APP_URL' } },
      },
    ];
    expect(() =>
      validateTestManifests([config(), deployment({ envFrom: [fromConfig], env })]),
    ).not.toThrow();
    for (const item of [
      { name: 'APP_URL', valueFrom: { secretKeyRef: { name: 'external', key: 'url' } } },
      { name: 'APP_URL', value: '$(OTHER_URL)' },
    ])
      expect(() =>
        validateTestManifests([config(), deployment({ envFrom: [fromConfig], env: [item] })]),
      ).toThrow('APP_URL');
  });
  it('does not assume an unresolved later envFrom leaves the ConfigMap address intact', () => {
    const external = { secretRef: { name: 'external-secret' } };
    expect(() =>
      validateTestManifests([config(), deployment({ envFrom: [fromConfig, external] })]),
    ).toThrow('Cannot resolve');
    expect(() =>
      validateTestManifests([config(), deployment({ envFrom: [external, fromConfig] })]),
    ).not.toThrow();
  });
  it('checks init containers and envFrom prefixes without printing secret values', () => {
    const secret = {
      kind: 'Secret',
      metadata: { name: 'addresses', namespace: 'masterino-test' },
      stringData: { URL: 'private-invalid-address' },
    };
    const d = deployment({});
    Object.assign(d.spec.template.spec, {
      initContainers: [
        {
          name: 'init',
          envFrom: [fromConfig, { secretRef: { name: 'addresses' }, prefix: 'APP_' }],
        },
      ],
    });
    expect(() => validateTestManifests([config(), secret, d])).toThrow('effective test APP_URL');
    try {
      validateTestManifests([config(), secret, d]);
    } catch (error) {
      expect(String(error)).not.toContain('private-invalid-address');
    }
  });
});

it('preserves an explicit KUBECONFIG for kubectl without forwarding application credentials', () => {
  expect(
    kubectlEnvironment({
      PATH: '/bin',
      KUBECONFIG: '/tmp/test cluster.yaml:/tmp/shared.yaml',
      DATABASE_URL: 'private',
      NODE_OPTIONS: '--require private',
    }),
  ).toEqual({ PATH: '/bin', KUBECONFIG: '/tmp/test cluster.yaml:/tmp/shared.yaml' });
  expect(kubectlEnvironment({ PATH: '/bin' })).toEqual({ PATH: '/bin' });
});
describe('test environment boundary', () => {
  it('accepts the isolated test application and internal gateway', () => {
    expect(validateTestManifests([config()]).environment).toBe('test');
  });
  it('rejects a local or production callback', () => {
    for (const url of ['http://localhost:3010', 'https://masterino.bielcrystal.com']) {
      const c = config();
      c.data.APP_URL = url;
      expect(() => validateTestManifests([c])).toThrow('APP_URL');
    }
  });
  it('rejects development authentication and other namespaces', () => {
    expect(() =>
      validateTestManifests([config(), { kind: 'ConfigMap', data: { ENABLE_MOCK_DEV_USER: '1' } }]),
    ).toThrow('identity');
    expect(() =>
      validateTestManifests([config(), { metadata: { namespace: 'production' } }]),
    ).toThrow('namespace');
  });
});
