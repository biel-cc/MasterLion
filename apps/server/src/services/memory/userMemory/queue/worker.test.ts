import { describe, expect, it } from 'vitest';

import { hasExhaustedMemoryJobAttempts } from './worker';

describe('memory queue worker retry status', () => {
  it('does not mark a retryable failure as final', () => {
    expect(
      hasExhaustedMemoryJobAttempts({
        attemptsMade: 1,
        opts: { attempts: 3 },
      }),
    ).toBe(false);
  });

  it('marks a failure after all configured attempts are exhausted', () => {
    expect(
      hasExhaustedMemoryJobAttempts({
        attemptsMade: 3,
        opts: { attempts: 3 },
      }),
    ).toBe(true);
  });

  it('treats a missing job as a final worker failure', () => {
    expect(hasExhaustedMemoryJobAttempts(undefined)).toBe(true);
  });
});
