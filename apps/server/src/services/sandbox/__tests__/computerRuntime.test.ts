import type { ServiceResult } from '@lobechat/tool-runtime';
import { ComputerRuntime } from '@lobechat/tool-runtime';
import { describe, expect, it } from 'vitest';

class TestComputerRuntime extends ComputerRuntime {
  constructor(private readonly serviceResult: ServiceResult) {
    super();
  }

  protected async callService(): Promise<ServiceResult> {
    return this.serviceResult;
  }
}

describe('ComputerRuntime command status mapping', () => {
  it('reports command failure and preserves output when transport succeeds with a non-zero exit code', async () => {
    const runtime = new TestComputerRuntime({
      result: {
        exitCode: 2,
        stderr: 'failed',
        stdout: 'partial',
        success: false,
      },
      success: true,
    });

    const result = await runtime.runCommand({ command: 'exit 2' });

    expect(result).toMatchObject({
      state: {
        exitCode: 2,
        stderr: 'failed',
        stdout: 'partial',
        success: false,
      },
      success: false,
    });
  });

  it('uses command output result success when background task transport succeeds', async () => {
    const runtime = new TestComputerRuntime({
      result: {
        output: 'failed',
        running: false,
        success: false,
      },
      success: true,
    });

    const result = await runtime.getCommandOutput({ commandId: 'task-1' });

    expect(result).toMatchObject({
      state: {
        newOutput: 'failed',
        running: false,
        success: false,
      },
      success: true,
    });
  });
});
