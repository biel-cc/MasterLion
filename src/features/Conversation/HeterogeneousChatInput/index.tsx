'use client';

import {
  HETEROGENEOUS_TYPE_LABELS,
  isRemoteHeterogeneousType,
} from '@lobechat/heterogeneous-agents';
import { Alert, Flexbox, Skeleton } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import urlJoin from 'url-join';

import { useHeteroAgentCloudConfig } from '@/business/client/hooks/useHeteroAgentCloudConfig';
import { type ActionKeys } from '@/features/ChatInput';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useEffectiveWorkspace } from '@/hooks/useEffectiveWorkspace';
import { useRemoteAgentDeviceGuard } from '@/hooks/useRemoteAgentDeviceGuard';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { useProjectWorkspaceStore } from '@/store/projectWorkspace';

import ChatInput from '../ChatInput';
import { contextSelectors, useConversationStore } from '../store';
import HeteroControlBar from './HeteroControlBar';

// Heterogeneous agents (e.g. Claude Code) bring their own toolchain, memory,
// and model, so LobeHub-side pickers don't apply. Typo is kept so the user
// can still toggle the rich-text formatting bar.
const leftActions: ActionKeys[] = ['typo'];
const rightActions: ActionKeys[] = [];

/**
 * HeterogeneousChatInput
 *
 * Simplified ChatInput for heterogeneous agents (Claude Code, etc.).
 * Keeps only: text input, typo toggle, send button, and a working-directory
 * picker — no model/tools/memory/KB/MCP/runtime-mode/upload.
 *
 * In cloud (web) mode, shows a configuration prompt and disables the input
 * until the user sets up their cloud credentials in agent profile.
 */
const HeterogeneousChatInput = memo(() => {
  const { t } = useTranslation('chat');
  // Scope every hetero check to the conversation's agent and effective topic
  // execution context instead of the global (hijack-prone) active agent.
  const agentId = useConversationStore(contextSelectors.agentId);
  const { isConfigured, goToConfig } = useHeteroAgentCloudConfig(agentId);
  const params = useParams<{ aid: string }>();
  const navigate = useNavigate();

  const agencyConfig = useAgentStore(
    (s) => agentSelectors.getAgentConfigById(agentId)(s)?.agencyConfig,
  );
  const providerType = agencyConfig?.heterogeneousProvider?.type;
  const isRemoteAgent = !!providerType && isRemoteHeterogeneousType(providerType);

  // The effective contract includes the current draft intent / topic snapshot.
  // Do not re-resolve from agent defaults here: that would make the send gate
  // disagree with the target switcher and the eventual dispatcher.
  const effective = useEffectiveWorkspace(agentId);

  // Until the first evidence requests (devices, gateway, workspaces, topic
  // state) settle, the projection reports a provisional `unbound`/`unrouted`
  // that is indistinguishable from a real one. Showing a gate here would flash
  // an error the user never caused and that disappears on its own a tick later,
  // so hold a deterministic placeholder instead.
  const isResolvingWorkspace = Boolean(effective.loading);

  // A run goes to an `lh connect` device when the provider is a remote-only type
  // (openclaw / hermes) OR a local-CLI type (claude-code / codex) resolves to a
  // bound device (including desktop "local" opened from web). Either way the
  // bound device must be online before we let the user send — guard it here
  // instead of failing at dispatch time.
  const isDeviceExecution =
    isRemoteAgent ||
    effective.context.plan.kind === 'device' ||
    effective.context.plan.kind === 'device-unrouted';

  const { status, refresh } = useRemoteAgentDeviceGuard({
    agentId,
    deviceId: effective.targetDeviceId,
    enabled: isDeviceExecution,
  });

  // Heterogeneous agents bring their own toolchain and must have a formal
  // workspace before the first send / resume. `unbound` and `unrouted` come
  // straight from the accepted execution context; native chat input never
  // applies this gate.
  const focusWorkspacePicker = useProjectWorkspaceStore((s) => s.focusWorkspacePicker);
  const workspaceBlocked = !isResolvingWorkspace && effective.state !== 'bound';
  const tw = t as unknown as (key: string, options?: Record<string, unknown>) => string;

  const goToAgentProfile = () => {
    if (params.aid) navigate(urlJoin('/agent', params.aid, 'profile'));
  };

  const deviceBlocked =
    !isResolvingWorkspace &&
    isDeviceExecution &&
    (status === 'device-offline' || status === 'platform-unavailable' || status === 'no-device');

  const renderDeviceGuard = () => {
    if (!deviceBlocked) return null;

    let title: string;
    let desc: string;

    if (status === 'no-device') {
      title = t('platformAgent.deviceGuard.noDevice.title');
      desc = t('platformAgent.deviceGuard.noDevice.desc');
    } else if (status === 'device-offline') {
      title = t('platformAgent.deviceGuard.deviceOffline.title');
      desc = t('platformAgent.deviceGuard.deviceOffline.desc');
    } else {
      // `platform-unavailable` only arises for remote-typed agents (the guard's
      // capability check), so providerType is always set here — fall back safely.
      const name = (providerType && HETEROGENEOUS_TYPE_LABELS[providerType]) || providerType || '';
      title = t('platformAgent.deviceGuard.platformUnavailable.title', { name });
      desc = t('platformAgent.deviceGuard.platformUnavailable.desc', { name });
    }

    return (
      <WideScreenContainer>
        <Flexbox align={'center'} paddingBlock={'0 8px'} paddingInline={12}>
          <Alert
            description={desc}
            style={{ maxWidth: 880, width: '100%' }}
            title={title}
            type={'warning'}
            action={
              <Flexbox horizontal gap={6}>
                <Button size={'small'} onClick={refresh}>
                  {t('platformAgent.deviceGuard.refresh')}
                </Button>
                <Button size={'small'} type={'primary'} onClick={goToAgentProfile}>
                  {t('platformAgent.deviceGuard.configure')}
                </Button>
              </Flexbox>
            }
          />
        </Flexbox>
      </WideScreenContainer>
    );
  };

  // `isDeviceExecution` is derived from the same provisional plan, so the cloud
  // gate has to wait for the projection too — otherwise a device-bound agent
  // flashes "configure your cloud credentials" before routing resolves.
  const cloudConfigBlocked = !isResolvingWorkspace && !isConfigured && !isDeviceExecution;

  const renderCloudConfigGuard = () => {
    if (!cloudConfigBlocked) return null;

    return (
      <WideScreenContainer>
        <Flexbox align={'center'} paddingBlock={'0 8px'} paddingInline={12}>
          <Alert
            description={t('heteroAgent.cloudNotConfigured.desc')}
            style={{ maxWidth: 880, width: '100%' }}
            title={t('heteroAgent.cloudNotConfigured.title')}
            type={'warning'}
            action={
              <Button size={'small'} type={'primary'} onClick={goToConfig}>
                {t('heteroAgent.cloudNotConfigured.action')}
              </Button>
            }
          />
        </Flexbox>
      </WideScreenContainer>
    );
  };

  const renderWorkspaceGuard = () => {
    if (!workspaceBlocked || deviceBlocked) return null;
    const isUnrouted = effective.state === 'unrouted';
    const isScratch = effective.state === 'scratch';
    return (
      <WideScreenContainer>
        <Flexbox align={'center'} paddingBlock={'0 8px'} paddingInline={12}>
          <Alert
            data-testid="hetero-workspace-guard"
            style={{ maxWidth: 880, width: '100%' }}
            type={'warning'}
            action={
              <Button size={'small'} type={'primary'} onClick={() => focusWorkspacePicker()}>
                {tw('workspaceRuntime.hetero.gate.action')}
              </Button>
            }
            description={
              isUnrouted
                ? tw(
                    `workspaceRuntime.hetero.gate.unrouted.${effective.unroutedReason ?? 'no-bound-device'}`,
                  )
                : isScratch
                  ? tw('workspaceRuntime.hetero.gate.scratchDesc')
                  : tw('workspaceRuntime.hetero.gate.desc')
            }
            title={
              isUnrouted
                ? tw('workspaceRuntime.hetero.gate.unroutedTitle')
                : isScratch
                  ? tw('workspaceRuntime.hetero.gate.scratchTitle')
                  : tw('workspaceRuntime.hetero.gate.title')
            }
          />
        </Flexbox>
      </WideScreenContainer>
    );
  };

  const renderResolvingPlaceholder = () => {
    if (!isResolvingWorkspace) return null;

    return (
      <WideScreenContainer>
        <Flexbox
          align={'center'}
          data-testid="hetero-workspace-resolving"
          paddingBlock={'0 8px'}
          paddingInline={12}
        >
          <Skeleton.Button active block size={'small'} style={{ maxWidth: 880 }} />
        </Flexbox>
      </WideScreenContainer>
    );
  };

  // Device execution doesn't use the cloud sandbox, so it doesn't need cloud
  // credentials — only the sandbox path gates on `isConfigured`. Sending is held
  // while the projection resolves: the target is not known yet.
  const inputDisabled =
    isResolvingWorkspace || cloudConfigBlocked || deviceBlocked || workspaceBlocked;
  const hasGuard = isResolvingWorkspace || deviceBlocked || cloudConfigBlocked || workspaceBlocked;

  return (
    <Flexbox>
      {renderResolvingPlaceholder()}
      {renderCloudConfigGuard()}
      {renderDeviceGuard()}
      {renderWorkspaceGuard()}
      <ChatInput
        controlBarSlot={<HeteroControlBar />}
        disableSend={inputDisabled}
        leftActions={leftActions}
        rightActions={rightActions}
        skipScrollMarginWithList={!hasGuard}
        sendButtonProps={{
          disabled: inputDisabled,
          onDisabledSend: workspaceBlocked ? () => focusWorkspacePicker() : undefined,
          shape: 'round',
        }}
        onEditorReady={(instance) => {
          // Sync to global ChatStore for compatibility with other features
          useChatStore.setState({ mainInputEditor: instance });
        }}
      />
    </Flexbox>
  );
});

HeterogeneousChatInput.displayName = 'HeterogeneousChatInput';

export default HeterogeneousChatInput;
