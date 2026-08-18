import { type UpdateInfo, type UpdaterState } from '@lobechat/electron-client-ipc';
import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { Button, copyToClipboard, Flexbox, Icon, Markdown } from '@lobehub/ui';
import { Modal } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { CircleFadingArrowUp, TriangleAlert } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { autoUpdateService } from '@/services/electron/autoUpdate';

import { UpdateDiagnostics } from './UpdateDiagnostics';

const MACOS_QUARANTINE_COMMAND = 'xattr -dr com.apple.quarantine /Applications/Masterino.app';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    position: fixed;
    z-index: 1000;
    inset-block-end: 16px;
    inset-inline-start: 16px;
  `,

  releaseNote: css`
    overflow: scroll;

    max-height: 300px;
    padding: 8px;
    border-radius: 8px;

    background: ${cssVar.colorFillQuaternary};
  `,

  unsignedWarning: css`
    padding: 12px;
    border: 1px solid ${cssVar.colorWarningBorder};
    border-radius: 8px;

    background: ${cssVar.colorWarningBg};
  `,

  command: css`
    overflow-x: auto;

    margin: 8px 0;
    padding: 8px;
    border-radius: 6px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    white-space: nowrap;

    background: ${cssVar.colorFillSecondary};
  `,
}));

export const UpdateNotification: React.FC = () => {
  const { t } = useTranslation('electron');
  const [updaterState, setUpdaterState] = useState<UpdaterState>({
    autoDownloadEnabled: true,
    stage: 'idle',
  });
  const [detailVisible, setDetailVisible] = useState(false);
  const [isActing, setIsActing] = useState(false);

  useEffect(() => {
    void autoUpdateService
      .getUpdaterState()
      .then(setUpdaterState)
      .catch(() => undefined);
  }, []);

  useWatchBroadcast('updaterStateChanged', setUpdaterState);

  useWatchBroadcast('updateDownloaded', (info: UpdateInfo) => {
    setUpdaterState((state) => ({ ...state, stage: 'downloaded', updateInfo: info }));
    setDetailVisible(false);
  });

  useWatchBroadcast('updateWillInstallLater', () => {
    setUpdaterState((state) => ({ ...state, stage: 'idle' }));
    setDetailVisible(false);
  });

  const updateAvailable = updaterState.stage === 'available';
  const updateDownloaded = updaterState.stage === 'downloaded';
  const updateInfo = updaterState.updateInfo;

  const updateDownloading = updaterState.stage === 'downloading';
  const updateFailed = updaterState.stage === 'error';

  if (!updateAvailable && !updateDownloaded && !updateDownloading && !updateFailed) return null;

  const dismiss = () => {
    setUpdaterState((state) => ({ ...state, stage: 'idle' }));
    setDetailVisible(false);
  };

  const runPrimaryAction = async () => {
    setIsActing(true);
    try {
      if (updateAvailable) {
        await autoUpdateService.downloadUpdate();
        return;
      }

      if (updateFailed) {
        if (updateInfo) await autoUpdateService.downloadUpdate();
        else await autoUpdateService.checkUpdate();
        return;
      }

      await autoUpdateService.applyDownloadedUpdate();
    } finally {
      setIsActing(false);
    }
  };

  const runCompactPrimaryAction = () => {
    if (updateDownloaded && updaterState.installMode === 'open-dmg') {
      setDetailVisible(true);
      return;
    }

    void runPrimaryAction();
  };

  return (
    <>
      <div className={styles.container}>
        <div
          style={{
            alignItems: 'center',
            background: cssVar.colorBgElevated,
            border: `1px solid ${cssVar.colorBorderSecondary}`,
            borderRadius: 12,
            boxShadow: cssVar.boxShadow,
            color: cssVar.colorText,
            display: 'flex',
            gap: 8,
            padding: '8px 10px',
          }}
        >
          <Icon icon={CircleFadingArrowUp} style={{ fontSize: 16 }} />
          <div style={{ cursor: 'pointer', fontSize: 12 }} onClick={() => setDetailVisible(true)}>
            {updateFailed
              ? t(`updater.error.${updaterState.errorCode ?? 'unknown'}`)
              : t(
                  updateDownloading
                    ? 'updater.downloadingUpdate'
                    : updateAvailable
                      ? 'updater.newVersionAvailable'
                      : 'updater.updateReady',
                )}
            {updateInfo?.version ? ` · ${updateInfo.version}` : ''}
            {updateDownloading && updaterState.progress
              ? ` · ${t('updater.downloadProgress', { percent: Math.round(updaterState.progress.percent) })}`
              : ''}
          </div>
          <div style={{ flex: 1 }} />
          <Button disabled={updateDownloading} size="small" type="text" onClick={dismiss}>
            {t('updater.later')}
          </Button>
          {updateDownloaded && updaterState.installMode === 'restart' && (
            <Button size="small" type="text" onClick={() => void autoUpdateService.installLater()}>
              {t('updater.installLater')}
            </Button>
          )}
          <Button
            disabled={updateDownloading}
            loading={isActing}
            size="small"
            type="primary"
            onClick={runCompactPrimaryAction}
          >
            {t(
              updateDownloading
                ? 'updater.downloadingUpdate'
                : updateFailed
                  ? 'updater.retry'
                  : updateAvailable
                    ? 'updater.downloadNewVersion'
                    : updaterState.installMode === 'open-dmg'
                      ? 'updater.openInstaller'
                      : 'updater.upgradeNow',
            )}
          </Button>
        </div>
      </div>

      <Modal
        footer={null}
        open={detailVisible}
        width={520}
        title={t(
          updateFailed
            ? 'updater.updateError'
            : updateAvailable
              ? 'updater.newVersionAvailable'
              : 'updater.updateReady',
        )}
        onCancel={() => setDetailVisible(false)}
      >
        <Flexbox gap={12} style={{ maxWidth: 480 }}>
          {updateFailed && <UpdateDiagnostics state={updaterState} />}
          <div style={{ color: cssVar.colorTextSecondary, fontSize: 12 }}>
            {updateInfo?.version}
          </div>
          {updateInfo?.releaseNotes &&
            (typeof updateInfo.releaseNotes === 'string' ? (
              <div className={styles.releaseNote}>
                <Markdown>{updateInfo.releaseNotes}</Markdown>
              </div>
            ) : (
              <div className={styles.releaseNote}>
                {updateInfo.releaseNotes.map((note) => (
                  <Markdown key={note.version}>{note.note ?? ''}</Markdown>
                ))}
              </div>
            ))}
          {updateDownloaded && updaterState.installMode === 'open-dmg' && (
            <Flexbox className={styles.unsignedWarning} gap={8}>
              <Flexbox horizontal align="center" gap={8}>
                <Icon icon={TriangleAlert} />
                <strong>{t('updater.unsignedMacWarningTitle')}</strong>
              </Flexbox>
              <div>{t('updater.unsignedMacWarningDescription')}</div>
              <ol style={{ margin: 0, paddingInlineStart: 20 }}>
                <li>{t('updater.unsignedMacStep1')}</li>
                <li>{t('updater.unsignedMacStep2')}</li>
                <li>{t('updater.unsignedMacStep3')}</li>
              </ol>
              <code className={styles.command}>{MACOS_QUARANTINE_COMMAND}</code>
              <Flexbox horizontal align="center" gap={8} justify="space-between">
                <span style={{ color: cssVar.colorTextSecondary, fontSize: 12 }}>
                  {t('updater.unsignedMacTrustedSourceOnly')}
                </span>
                <Button size="small" onClick={() => void copyToClipboard(MACOS_QUARANTINE_COMMAND)}>
                  {t('updater.copyInstallCommand')}
                </Button>
              </Flexbox>
            </Flexbox>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button disabled={updateDownloading} size="small" onClick={dismiss}>
              {t('updater.later')}
            </Button>
            {updateDownloaded && updaterState.installMode === 'restart' && (
              <Button size="small" onClick={() => void autoUpdateService.installLater()}>
                {t('updater.installLater')}
              </Button>
            )}
            <Button
              disabled={updateDownloading}
              loading={isActing}
              size="small"
              type="primary"
              onClick={() => void runPrimaryAction()}
            >
              {t(
                updateDownloading
                  ? 'updater.downloadingUpdate'
                  : updateFailed
                    ? 'updater.retry'
                    : updateAvailable
                      ? 'updater.downloadNewVersion'
                      : updaterState.installMode === 'open-dmg'
                        ? 'updater.openInstaller'
                        : 'updater.restartAndInstall',
              )}
            </Button>
          </div>
        </Flexbox>
      </Modal>
    </>
  );
};
