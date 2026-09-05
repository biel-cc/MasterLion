const expected = {
  APP_URL: 'https://mlai-test.bielcrystal.com',
  DEVICE_GATEWAY_URL: 'http://masterino-device-gateway:8788',
};

// Inspect only environment addresses, never include Secret values in errors/reports.
// undefined means a referenced value cannot be established from rendered manifests.
export function validateContainerAddresses(documents: any[]) {
  const resource = (kind: string, name: string, namespace: string) =>
    documents.find(
      (d) =>
        d?.kind === kind &&
        d.metadata?.name === name &&
        (d.metadata.namespace || 'masterino-test') === namespace,
    );
  const dataFor = (kind: string, name: string, namespace: string) => {
    const doc = resource(kind, name, namespace);
    if (!doc) return undefined;
    if (kind === 'ConfigMap') return doc.data || {};
    return {
      ...Object.fromEntries(
        Object.entries(doc.data || {}).map(([k, v]) => [
          k,
          Buffer.from(String(v), 'base64').toString('utf8'),
        ]),
      ),
      ...doc.stringData,
    };
  };
  for (const doc of documents) {
    const pod =
      doc?.kind === 'Pod'
        ? doc.spec
        : doc?.spec?.template?.spec || doc?.spec?.jobTemplate?.spec?.template?.spec;
    const namespace = doc?.metadata?.namespace || 'masterino-test';
    for (const container of [...(pod?.containers || []), ...(pod?.initContainers || [])]) {
      const values = new Map<string, string | undefined>();
      let application = false;
      for (const source of container.envFrom || []) {
        const kind = source.configMapRef ? 'ConfigMap' : 'Secret';
        const ref = source.configMapRef || source.secretRef;
        const data = ref && dataFor(kind, ref.name, namespace);
        const prefix = source.prefix || '';
        if (source.configMapRef?.name === 'masterino-config' && !prefix) application = true;
        for (const name of Object.keys(expected)) {
          if (!name.startsWith(prefix)) continue;
          const key = name.slice(prefix.length);
          if (data === undefined) values.set(name, undefined);
          else if (Object.hasOwn(data, key)) {
            application = true;
            values.set(name, data[key]);
          }
        }
      }
      // Kubernetes applies explicit env after all envFrom entries.
      for (const item of container.env || []) {
        if (!Object.hasOwn(expected, item.name)) continue;
        application = true;
        if (item.value !== undefined) values.set(item.name, item.value);
        else {
          const ref = item.valueFrom?.configMapKeyRef || item.valueFrom?.secretKeyRef;
          const kind = item.valueFrom?.configMapKeyRef ? 'ConfigMap' : 'Secret';
          values.set(item.name, ref ? dataFor(kind, ref.name, namespace)?.[ref.key] : undefined);
        }
      }
      if (!application) continue;
      for (const [name, value] of values) {
        if (value === undefined)
          throw new Error(
            `Cannot resolve test ${name} for ${doc.metadata?.name}/${container.name}.`,
          );
        if (value !== expected[name as keyof typeof expected])
          throw new Error(
            `Unexpected effective test ${name} for ${doc.metadata?.name}/${container.name}.`,
          );
      }
    }
  }
}
