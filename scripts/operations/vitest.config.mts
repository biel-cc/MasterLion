export default {
  test: {
    environment: 'node',
    include: [
      'scripts/operations/verifyAckTestManifests.test.ts',
      'src/app/(backend)/api/healthz/route.test.ts',
    ],
  },
};
