import { describe, expect, it, vi } from 'vitest';

const lifecycle = vi.hoisted(() => [] as string[]);

vi.mock('./pre-app-init', () => ({}));
vi.mock('fix-path', () => ({
  default: () => lifecycle.push('fix-path'),
}));
vi.mock('./core/App', () => ({
  App: class {
    constructor() {
      lifecycle.push('create-app');
    }

    bootstrap() {
      lifecycle.push('bootstrap');
    }
  },
}));

describe('desktop main environment bootstrap', () => {
  it('restores the login-shell PATH before App snapshots and extends the environment', async () => {
    await import('./index');

    expect(lifecycle).toEqual(['fix-path', 'create-app', 'bootstrap']);
  });
});
