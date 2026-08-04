import { type UpdateInfo, type UpdaterState } from '@lobechat/electron-client-ipc';
import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { Button, Flexbox, Icon, Markdown } from '@lobehub/ui';
import { Modal } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { CircleFadingArrowUp } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { autoUpdateService } from '@/services/electron/autoUpdate';
import { electronSystemService } from '@/services/electron/system';

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
}));

export const UpdateNotification: React.FC = () => {
  const { t } = useTranslation('electron');
  const [updaterState, setUpdaterState] = useState<UpdaterState>({ stage: 'idle' });
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
    setUpdaterState({ stage: 'downloaded', updateInfo: info });
    setDetailVisible(false);
  });

  useWatchBroadcast('updateWillInstallLater', () => {
    setUpdaterState({ stage: 'idle' });
    setDetailVisible(false);
  });

  const updateAvailable = updaterState.stage === 'available';
  const updateDownloaded = updaterState.stage === 'downloaded';
  const updateInfo = updaterState.updateInfo;

  if (!updateAvailable && !updateDownloaded) return null;

  const dismiss = () => {
    setUpdaterState({ stage: 'idle' });
    setDetailVisible(false);
  };

  const runPrimaryAction = async () => {
    setIsActing(true);
    try {
      if (updateAvailable) {
        if (updaterState.downloadUrl) {
          await electronSystemService.openExternalLink(updaterState.downloadUrl);
        }
        return;
      }

      await autoUpdateService.installNow();
    } finally {
      setIsActing(false);
    }
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
            {t(updateAvailable ? 'updater.newVersionAvailable' : 'updater.updateReady')}
            {updateInfo?.version ? ` · ${updateInfo.version}` : ''}
          </div>
          <div style={{ flex: 1 }} />
          <Button size="small" type="text" onClick={dismiss}>
            {t('updater.later')}
          </Button>
          <Button
            disabled={updateAvailable && !updaterState.downloadUrl}
            loading={isActing}
            size="small"
            type="primary"
            onClick={() => void runPrimaryAction()}
          >
            {t(updateAvailable ? 'updater.downloadNewVersion' : 'updater.upgradeNow')}
          </Button>
        </div>
      </div>

      <Modal
        footer={null}
        open={detailVisible}
        title={t(updateAvailable ? 'updater.newVersionAvailable' : 'updater.updateReady')}
        width={520}
        onCancel={() => setDetailVisible(false)}
      >
        <Flexbox gap={12} style={{ maxWidth: 480 }}>
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
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button size="small" onClick={dismiss}>
              {t('updater.later')}
            </Button>
            <Button
              disabled={updateAvailable && !updaterState.downloadUrl}
              loading={isActing}
              size="small"
              type="primary"
              onClick={() => void runPrimaryAction()}
            >
              {t(updateAvailable ? 'updater.downloadNewVersion' : 'updater.restartAndInstall')}
            </Button>
          </div>
        </Flexbox>
      </Modal>
    </>
  );
};
