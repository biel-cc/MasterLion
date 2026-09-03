import { Icon } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { ChevronDown, ChevronRight, TriangleAlert } from 'lucide-react';
import { memo, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  ContextBudgetErrorViewModel,
  ContextBudgetUIAction,
} from '@/features/Conversation/utils/contextBudgetView';
import { formatIntergerNumber } from '@/utils/format';

/**
 * Loose `t` shape: the new `contextBudget.*` keys ship in `locales/{en-US,zh-CN}/error.json`
 * and are not yet part of the typed default resources (see integration wiring request).
 */
type LooseT = (key: string, vars?: Record<string, unknown>) => string;

const styles = createStaticStyles(({ css, cssVar }) => ({
  actions: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;

    width: 100%;

    @media (width <= 480px) {
      flex-direction: column;

      & > * {
        width: 100%;
      }
    }
  `,
  card: css`
    display: flex;
    flex-direction: column;
    gap: 12px;

    width: 100%;
    padding: 16px;
    border: 1px solid ${cssVar.colorSplit};
    border-radius: 12px;

    color: ${cssVar.colorText};

    background: ${cssVar.colorBgContainer};
  `,
  desc: css`
    margin: 0;
    font-size: 13px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
  `,
  diagnostics: css`
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 4px 12px;

    margin: 0;
    padding: 12px;
    border-radius: 8px;

    font-size: 12px;
    line-height: 1.5;

    background: ${cssVar.colorFillQuaternary};

    dt {
      color: ${cssVar.colorTextTertiary};
    }

    dd {
      margin: 0;
      overflow-wrap: anywhere;
    }

    @media (width <= 480px) {
      grid-template-columns: minmax(0, 1fr);

      dd {
        margin-block-end: 4px;
      }
    }
  `,
  header: css`
    display: flex;
    gap: 8px;
    align-items: center;
    color: ${cssVar.colorWarning};
  `,
  hints: css`
    margin: 0;
    padding-inline-start: 18px;

    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
  `,
  largest: css`
    margin: 0;
    font-size: 12px;
    font-weight: 500;
    line-height: 1.5;
  `,
  note: css`
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
  `,
  reason: css`
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextTertiary};
  `,
  title: css`
    margin: 0;

    font-size: 14px;
    font-weight: 600;
    line-height: 1.4;
    color: ${cssVar.colorText};
  `,
  toggle: css`
    align-self: flex-start;
  `,
  windowWarning: css`
    color: ${cssVar.colorWarningText};
  `,
}));

export interface ContextBudgetErrorCardProps {
  /** Action currently running; its button shows a loading state and the rest stay clickable. */
  loadingAction?: ContextBudgetUIAction;
  onAction: (action: ContextBudgetUIAction) => void;
  viewModel: ContextBudgetErrorViewModel;
}

const formatTokens = (tokens: number) => formatIntergerNumber(tokens);
const formatShare = (share: number) => `${Math.round(share * 100)}%`;

/**
 * Presentational terminal-failure card. It only reads the redacted view model and reports
 * actions through `onAction`; it never touches stores or the shared executor.
 */
const ContextBudgetErrorCard = memo<ContextBudgetErrorCardProps>(
  ({ loadingAction, onAction, viewModel }) => {
    const { t } = useTranslation('error');
    const tr = t as unknown as LooseT;
    const baseId = useId();
    const titleId = `${baseId}-title`;
    const diagnosticsId = `${baseId}-diagnostics`;
    const reasonId = `${baseId}-reason`;
    const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

    const { actions, diagnostics, largestSource } = viewModel;
    const disabledReason = actions.find((action) => action.disabledReasonKey)?.disabledReasonKey;

    return (
      <section aria-labelledby={titleId} className={styles.card} role={'alert'}>
        <div className={styles.header}>
          <Icon aria-hidden icon={TriangleAlert} size={18} />
          <h4 className={styles.title} id={titleId}>
            {tr(viewModel.titleKey)}
          </h4>
        </div>

        <p className={styles.desc}>{tr(viewModel.descKey)}</p>

        {viewModel.code === 'TAIL_TOO_LARGE' && largestSource && (
          <p className={styles.largest}>
            {tr('contextBudget.largestSource', {
              source: tr(largestSource.labelKey),
              tokens: formatTokens(largestSource.estimatedTokens),
            })}
          </p>
        )}

        {viewModel.noteKey && <p className={styles.note}>{tr(viewModel.noteKey)}</p>}

        {viewModel.hintKeys.length > 0 && (
          <ul aria-label={tr('contextBudget.hintsLabel')} className={styles.hints}>
            {viewModel.hintKeys.map((hintKey) => (
              <li key={hintKey}>{tr(hintKey)}</li>
            ))}
          </ul>
        )}

        {actions.length > 0 && (
          <div aria-label={tr('contextBudget.actionsLabel')} className={styles.actions} role={'group'}>
            {actions.map((action) => (
              <Button
                aria-describedby={action.disabledReasonKey ? reasonId : undefined}
                disabled={action.disabled}
                key={action.id}
                loading={loadingAction === action.id}
                size={'small'}
                type={action.primary ? 'primary' : 'default'}
                onClick={() => {
                  if (action.disabled) return;
                  onAction(action.id);
                }}
              >
                {tr(action.labelKey)}
              </Button>
            ))}
          </div>
        )}

        {disabledReason && (
          <p className={styles.reason} id={reasonId}>
            {tr(disabledReason)}
          </p>
        )}

        {diagnostics.hasDiagnostics && (
          <>
            <Button
              aria-controls={diagnosticsId}
              aria-expanded={diagnosticsOpen}
              className={styles.toggle}
              icon={<Icon icon={diagnosticsOpen ? ChevronDown : ChevronRight} size={14} />}
              size={'small'}
              type={'text'}
              onClick={() => setDiagnosticsOpen((open) => !open)}
            >
              {tr('contextBudget.diagnostics.toggle')}
            </Button>

            {diagnosticsOpen && (
              <dl className={styles.diagnostics} id={diagnosticsId}>
                {(diagnostics.modelId || diagnostics.providerId) && (
                  <>
                    <dt>{tr('contextBudget.diagnostics.model')}</dt>
                    <dd>
                      {[diagnostics.providerId, diagnostics.modelId].filter(Boolean).join(' / ')}
                    </dd>
                  </>
                )}
                {diagnostics.windowTokens !== undefined && (
                  <>
                    <dt>{tr('contextBudget.diagnostics.window')}</dt>
                    <dd>
                      {tr('contextBudget.diagnostics.windowValue', {
                        source: diagnostics.windowSourceLabelKey
                          ? tr(diagnostics.windowSourceLabelKey)
                          : (diagnostics.windowSource ?? '-'),
                        tokens: formatTokens(diagnostics.windowTokens),
                      })}
                      {diagnostics.windowUnknown && (
                        <>
                          {' '}
                          <span className={styles.windowWarning}>
                            {tr('contextBudget.diagnostics.windowUnknown')}
                          </span>
                        </>
                      )}
                    </dd>
                  </>
                )}
                {diagnostics.estimatedPromptTokens !== undefined && (
                  <>
                    <dt>{tr('contextBudget.diagnostics.estimatedPrompt')}</dt>
                    <dd>
                      {tr('contextBudget.diagnostics.tokens', {
                        tokens: formatTokens(diagnostics.estimatedPromptTokens),
                      })}
                    </dd>
                  </>
                )}
                {diagnostics.attempt !== undefined && (
                  <>
                    <dt>{tr('contextBudget.diagnostics.attempt')}</dt>
                    <dd>
                      {tr('contextBudget.diagnostics.attemptValue', {
                        attempt: diagnostics.attempt,
                        limit: diagnostics.attemptLimit,
                      })}
                    </dd>
                  </>
                )}
                {diagnostics.dominantSources.length > 0 && (
                  <>
                    <dt>{tr('contextBudget.diagnostics.dominantSources')}</dt>
                    <dd>
                      {diagnostics.dominantSources
                        .map((item) =>
                          tr('contextBudget.diagnostics.sourceShare', {
                            share: formatShare(item.share),
                            source: tr(item.labelKey),
                            tokens: formatTokens(item.estimatedTokens),
                          }),
                        )
                        .join(' · ')}
                    </dd>
                  </>
                )}
              </dl>
            )}
          </>
        )}
      </section>
    );
  },
);

ContextBudgetErrorCard.displayName = 'ContextBudgetErrorCard';

export default ContextBudgetErrorCard;
