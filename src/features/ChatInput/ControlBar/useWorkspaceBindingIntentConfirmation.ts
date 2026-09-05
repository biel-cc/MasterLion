import { isDesktop } from '@lobechat/const';
import { confirmModal } from '@lobehub/ui/base-ui';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import type { BeforeSendPayload } from '@/features/Conversation/ChatInput';
import type { EffectiveWorkspace } from '@/hooks/useEffectiveWorkspace';

import type { BindWorkspaceOnce } from './useBindWorkspaceOnce';
import { confirmWorkspaceBindingIntent } from './workspaceBindingActions';

type ConfirmWorkspaceBindingIntent = (payload: BeforeSendPayload) => Promise<boolean>;

/**
 * Lightweight confirmation for a persistent-directory request in an unbound
 * native topic. Cancel means "send without binding"; accept must finish the
 * existing formal bind-once transaction before the message is sent.
 */
export const useWorkspaceBindingIntentConfirmation = (
  effective: EffectiveWorkspace,
  bind: Pick<BindWorkspaceOnce, 'canSelect' | 'select'>,
): ConfirmWorkspaceBindingIntent => {
  const { t } = useTranslation('chat');

  return useCallback(
    async (payload) => {
      if (!bind.canSelect) return true;

      return confirmWorkspaceBindingIntent({
        confirm: ({ bind: performBind, rootPath }) =>
          new Promise<boolean>((resolve) => {
            let settled = false;
            const finish = (value: boolean) => {
              if (settled) return;
              settled = true;
              resolve(value);
            };

            confirmModal({
              cancelText: t('workspaceRuntime.intent.keepUnbound'),
              content: t('workspaceRuntime.intent.confirmDescription', { path: rootPath }),
              okText: t('workspaceRuntime.intent.confirm'),
              onCancel: () => finish(true),
              onOk: async () => finish(await performBind()),
              title: t('workspaceRuntime.intent.confirmTitle'),
            });
          }),
        desktop: isDesktop,
        effective,
        payload,
        select: bind.select,
      });
    },
    [bind.canSelect, bind.select, effective.state, t],
  );
};
