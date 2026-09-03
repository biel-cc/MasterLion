import type { ChatTopicStatus } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { confirmModal, type DropdownItem } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import {
  CheckCircle2,
  Circle,
  ExternalLink,
  FolderInput,
  FolderOpen,
  Hash,
  Link2,
  LucideCopy,
  PanelTop,
  PencilLine,
  Share2,
  Star,
  Trash,
  Wand2,
} from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { openRenameModal } from '@/components/RenameModal';
import { SESSION_CHAT_TOPIC_URL } from '@/const/url';
import { isDesktop } from '@/const/version';
import { createMoveTopicsModal } from '@/features/AgentTopicManager/MoveTopicsModal';
import { openShareModal } from '@/features/ShareModal';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { usePermission } from '@/hooks/usePermission';
import { localFileService } from '@/services/electron/localFileService';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { useElectronStore } from '@/store/electron';
import { useGlobalStore } from '@/store/global';

interface TopicItemDropdownMenuProps {
  fav?: boolean;
  id?: string;
  scratchWorkspace?: { rootPath: string };
  status?: ChatTopicStatus | null;
  title: string;
}

export const useTopicItemDropdownMenu = ({
  fav,
  id,
  scratchWorkspace,
  status,
  title,
}: TopicItemDropdownMenuProps) => {
  const { t } = useTranslation(['topic', 'common']);
  const tw = t as unknown as (key: string, options?: Record<string, unknown>) => string;
  const { message } = App.useApp();
  const navigate = useWorkspaceAwareNavigate();
  const { allowed: canCreateTopic } = usePermission('create_content');
  const { allowed: canEditTopic } = usePermission('edit_own_content');

  const openTopicInNewWindow = useGlobalStore((s) => s.openTopicInNewWindow);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const addTab = useElectronStore((s) => s.addTab);
  const appOrigin = useAppOrigin();

  const [
    autoRenameTopicTitle,
    duplicateTopic,
    removeTopic,
    favoriteTopic,
    markTopicCompleted,
    unmarkTopicCompleted,
    updateTopicTitle,
  ] = useChatStore((s) => [
    s.autoRenameTopicTitle,
    s.duplicateTopic,
    s.removeTopic,
    s.favoriteTopic,
    s.markTopicCompleted,
    s.unmarkTopicCompleted,
    s.updateTopicTitle,
  ]);

  const isCompleted = status === 'completed';
  const handleOpenShareModal = useCallback(() => {
    if (!id) return;

    openShareModal({ context: { threadId: null, topicId: id } });
  }, [id]);

  const dropdownMenu = useCallback(() => {
    if (!id) return [];

    return [
      {
        disabled: !canEditTopic,
        icon: <Icon icon={isCompleted ? Circle : CheckCircle2} />,
        key: 'markCompleted',
        label: isCompleted ? t('actions.unmarkCompleted') : t('actions.markCompleted'),
        onClick: () => {
          if (isCompleted) {
            unmarkTopicCompleted(id);
          } else {
            markTopicCompleted(id);
          }
        },
      },
      {
        type: 'divider' as const,
      },
      {
        disabled: !canEditTopic,
        icon: <Icon icon={Star} />,
        key: 'favorite',
        label: fav ? t('actions.unfavorite') : t('actions.favorite'),
        onClick: () => {
          favoriteTopic(id, !fav);
        },
      },
      {
        type: 'divider' as const,
      },
      {
        disabled: !canEditTopic,
        icon: <Icon icon={Wand2} />,
        key: 'autoRename',
        label: t('actions.autoRename'),
        onClick: () => {
          autoRenameTopicTitle(id);
        },
      },
      {
        disabled: !canEditTopic,
        icon: <Icon icon={PencilLine} />,
        key: 'rename',
        label: t('rename', { ns: 'common' }),
        onClick: () => {
          openRenameModal({
            defaultValue: title,
            description: t('renameModal.description', { ns: 'topic' }),
            onSave: async (newTitle) => {
              await updateTopicTitle(id, newTitle);
            },
            title: t('renameModal.title', { ns: 'topic' }),
          });
        },
      },
      {
        type: 'divider' as const,
      },
      ...(isDesktop
        ? [
            ...(scratchWorkspace
              ? [
                  {
                    icon: <Icon icon={FolderOpen} />,
                    key: 'openScratchWorkspace',
                    label: tw('workspaceRuntime.sidebar.openScratch', { ns: 'chat' }),
                    onClick: () => {
                      void localFileService.openLocalFileOrFolder(scratchWorkspace.rootPath, true);
                    },
                  },
                ]
              : []),
            {
              icon: <Icon icon={PanelTop} />,
              key: 'openInNewTab',
              label: t('actions.openInNewTab'),
              onClick: () => {
                if (!activeAgentId) return;
                const url = SESSION_CHAT_TOPIC_URL(activeAgentId, id);
                addTab(url);
                navigate(url);
              },
            },
            {
              icon: <Icon icon={ExternalLink} />,
              key: 'openInNewWindow',
              label: t('actions.openInNewWindow'),
              onClick: () => {
                if (activeAgentId) openTopicInNewWindow(activeAgentId, id);
              },
            },
            {
              type: 'divider' as const,
            },
          ]
        : []),
      {
        icon: <Icon icon={Hash} />,
        key: 'copySessionId',
        label: t('actions.copySessionId'),
        onClick: () => {
          navigator.clipboard.writeText(id);
          message.success(t('actions.copySessionIdSuccess'));
        },
      },
      {
        icon: <Icon icon={Link2} />,
        key: 'copyLink',
        label: t('actions.copyLink'),
        onClick: () => {
          if (!activeAgentId) return;
          const url = `${appOrigin}${SESSION_CHAT_TOPIC_URL(activeAgentId, id)}`;
          navigator.clipboard.writeText(url);
          message.success(t('actions.copyLinkSuccess'));
        },
      },
      {
        disabled: !canCreateTopic,
        icon: <Icon icon={LucideCopy} />,
        key: 'duplicate',
        label: t('actions.duplicate'),
        onClick: () => {
          duplicateTopic(id);
        },
      },
      {
        disabled: !canEditTopic,
        icon: <Icon icon={FolderInput} />,
        key: 'moveToAgent',
        label: t('actions.moveToAgent'),
        onClick: () => {
          createMoveTopicsModal({ sourceAgentId: activeAgentId, topicIds: [id] });
        },
      },
      {
        type: 'divider' as const,
      },
      {
        disabled: !canEditTopic,
        icon: <Icon icon={Share2} />,
        key: 'share',
        label: t('share', { ns: 'common' }),
        onClick: handleOpenShareModal,
      },
      {
        type: 'divider' as const,
      },
      {
        danger: true,
        disabled: !canEditTopic,
        icon: <Icon icon={Trash} />,
        key: 'delete',
        label: scratchWorkspace
          ? tw('workspaceRuntime.sidebar.cleanupScratch', { ns: 'chat' })
          : t('delete', { ns: 'common' }),
        onClick: () => {
          confirmModal({
            cancelText: t('cancel', { ns: 'common' }),
            content: scratchWorkspace
              ? tw('workspaceRuntime.sidebar.cleanupScratchConfirm', { ns: 'chat' })
              : t('actions.confirmRemoveTopic'),
            okButtonProps: { danger: true },
            okText: scratchWorkspace
              ? tw('workspaceRuntime.sidebar.cleanupScratch', { ns: 'chat' })
              : t('delete', { ns: 'common' }),
            onOk: async () => {
              await removeTopic(id);
            },
            title: scratchWorkspace
              ? tw('workspaceRuntime.sidebar.cleanupScratch', { ns: 'chat' })
              : t('delete', { ns: 'common' }),
          });
        },
      },
    ].filter(Boolean) as DropdownItem[];
  }, [
    id,
    fav,
    isCompleted,
    title,
    scratchWorkspace,
    canCreateTopic,
    canEditTopic,
    activeAgentId,
    appOrigin,
    autoRenameTopicTitle,
    duplicateTopic,
    favoriteTopic,
    markTopicCompleted,
    unmarkTopicCompleted,
    removeTopic,
    updateTopicTitle,
    openTopicInNewWindow,
    addTab,
    navigate,
    t,
    tw,
    message,
    handleOpenShareModal,
  ]);
  return { dropdownMenu };
};
