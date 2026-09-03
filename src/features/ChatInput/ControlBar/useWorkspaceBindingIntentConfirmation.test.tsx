import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceBindingIntentConfirmation } from './useWorkspaceBindingIntentConfirmation';

const { confirmModal } = vi.hoisted(() => ({ confirmModal: vi.fn() }));

vi.mock('@lobechat/const', () => ({ isDesktop: true }));
vi.mock('@lobehub/ui/base-ui', () => ({ confirmModal }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, values?: { path?: string }) => `${key}:${values?.path ?? ''}` }),
}));

const effective = { state: 'unbound' } as any;
const payload = {
  hasAttachments: false,
  message: '接下来几天持续在 /Users/matt/code/masterino 开发',
};

describe('useWorkspaceBindingIntentConfirmation', () => {
  beforeEach(() => {
    confirmModal.mockReset();
  });

  it('binds the formal workspace only after explicit confirmation', async () => {
    const select = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() =>
      useWorkspaceBindingIntentConfirmation(effective, { canSelect: true, select }),
    );

    let shouldSend!: Promise<boolean>;
    act(() => {
      shouldSend = result.current(payload);
    });

    expect(select).not.toHaveBeenCalled();
    expect(confirmModal).toHaveBeenCalledWith(
      expect.objectContaining({
        content:
          'workspaceRuntime.intent.confirmDescription:/Users/matt/code/masterino',
      }),
    );

    await act(async () => {
      await confirmModal.mock.calls[0][0].onOk();
    });
    await expect(shouldSend).resolves.toBe(true);
    expect(select).toHaveBeenCalledWith({ path: '/Users/matt/code/masterino' });
  });

  it('continues unbound without creating a workspace when confirmation is declined', async () => {
    const select = vi.fn();
    const { result } = renderHook(() =>
      useWorkspaceBindingIntentConfirmation(effective, { canSelect: true, select }),
    );

    const shouldSend = result.current(payload);
    act(() => confirmModal.mock.calls[0][0].onCancel());

    await expect(shouldSend).resolves.toBe(true);
    expect(select).not.toHaveBeenCalled();
  });

  it('preserves the unsent editor content when the confirmed bind fails', async () => {
    const select = vi.fn().mockResolvedValue(false);
    const { result } = renderHook(() =>
      useWorkspaceBindingIntentConfirmation(effective, { canSelect: true, select }),
    );

    const shouldSend = result.current(payload);
    await act(async () => {
      await confirmModal.mock.calls[0][0].onOk();
    });

    await expect(shouldSend).resolves.toBe(false);
  });

  it('does not open confirmation for ordinary reads or a topic already bound', async () => {
    const select = vi.fn();
    const { result, rerender } = renderHook(
      ({ state }) =>
        useWorkspaceBindingIntentConfirmation(
          { state } as any,
          { canSelect: state === 'unbound', select },
        ),
      { initialProps: { state: 'unbound' } },
    );

    await expect(
      result.current({ hasAttachments: false, message: '读取 /Users/matt/code/README.md' }),
    ).resolves.toBe(true);
    rerender({ state: 'bound' });
    await expect(result.current(payload)).resolves.toBe(true);
    expect(confirmModal).not.toHaveBeenCalled();
  });
});

