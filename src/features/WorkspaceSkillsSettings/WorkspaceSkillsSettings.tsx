'use client';

import { isDesktop } from '@lobechat/const';
import type { ProjectWorkspaceSkillPolicy } from '@lobechat/types/src/projectWorkspace';
import { Flexbox, Text } from '@lobehub/ui';
import { Button, Select, Switch } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SkillSection, SkillsList, useProjectSkills } from '@/features/SkillsList';
import type { ProjectWorkspaceItem } from '@/services/projectWorkspace';
import { useElectronStore } from '@/store/electron';
import { useProjectWorkspaceStore } from '@/store/projectWorkspace';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    display: flex;
    flex-direction: column;
    gap: 16px;

    width: 100%;
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
  `,
  description: css`
    margin: 2px 0 0;
    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
  `,
  error: css`
    font-size: 12px;
    color: ${cssVar.colorErrorText};
  `,
  policy: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 10px 16px;
    align-items: center;
  `,
  select: css`
    width: min(100%, 260px);
  `,
  status: css`
    font-size: 12px;
    color: ${cssVar.colorSuccessText};
  `,
  title: css`
    margin: 0;
    font-size: 16px;
    line-height: 1.4;
  `,
}));

type MaterializationMode = NonNullable<ProjectWorkspaceSkillPolicy['materializeForHeteroCli']>;

interface NormalizedPolicy {
  includeAgentSkills: boolean;
  includeProjectSkills: boolean;
  includeUserSkills: boolean;
  materializeForHeteroCli: MaterializationMode;
  pinned: string[];
}

const normalizePolicy = (policy?: ProjectWorkspaceSkillPolicy): NormalizedPolicy => ({
  includeAgentSkills: policy?.includeAgentSkills ?? true,
  includeProjectSkills: policy?.includeProjectSkills ?? true,
  includeUserSkills: policy?.includeUserSkills ?? true,
  materializeForHeteroCli: policy?.materializeForHeteroCli ?? 'off',
  pinned: [...(policy?.pinned ?? [])],
});

export interface WorkspaceSkillsSettingsProps {
  deviceId: string;
  workspace: ProjectWorkspaceItem;
}

const WorkspaceSkillsSettings = memo<WorkspaceSkillsSettingsProps>(({ deviceId, workspace }) => {
  const { t: translate } = useTranslation('setting');
  const t = translate as unknown as (key: string) => string;
  const currentDeviceId = useElectronStore((state) => state.gatewayDeviceInfo?.deviceId);
  const remoteDeviceId = !isDesktop || currentDeviceId !== deviceId ? deviceId : undefined;
  const updateWorkspace = useProjectWorkspaceStore((state) => state.updateWorkspace);

  const persistedPolicy = useMemo(
    () => normalizePolicy(workspace.skillPolicy),
    [workspace.skillPolicy],
  );
  const [policy, setPolicy] = useState<NormalizedPolicy>(persistedPolicy);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setPolicy(persistedPolicy);
    setError(false);
  }, [persistedPolicy, workspace.id]);

  const projectSkills = useProjectSkills(
    policy.includeProjectSkills ? workspace.rootPath : undefined,
    remoteDeviceId,
  );
  const dirty = JSON.stringify(policy) !== JSON.stringify(persistedPolicy);

  const setFlag = (
    key: 'includeAgentSkills' | 'includeProjectSkills' | 'includeUserSkills',
    checked: boolean,
  ) => {
    setPolicy((current) => ({ ...current, [key]: checked }));
    setSaved(false);
  };

  const save = async () => {
    if (!dirty || isSaving) return;
    setIsSaving(true);
    setError(false);
    setSaved(false);
    const result = await updateWorkspace(workspace.id, { skillPolicy: policy });
    if (result.ok) setSaved(true);
    else setError(true);
    setIsSaving(false);
  };

  const options = [
    { label: t('workspaceSkills.materialize.off'), value: 'off' },
    { label: t('workspaceSkills.materialize.project'), value: 'project' },
    { label: t('workspaceSkills.materialize.user'), value: 'user' },
  ];

  return (
    <section aria-labelledby={`workspace-skills-${workspace.id}`} className={styles.card}>
      <div>
        <h3 className={styles.title} id={`workspace-skills-${workspace.id}`}>
          {t('workspaceSkills.title')}
        </h3>
        <p className={styles.description}>{t('workspaceSkills.description')}</p>
      </div>

      <div className={styles.policy}>
        <Text>{t('workspaceSkills.includeProject')}</Text>
        <Switch
          aria-label={t('workspaceSkills.includeProject')}
          checked={policy.includeProjectSkills}
          onChange={(checked) => setFlag('includeProjectSkills', checked)}
        />
        <Text>{t('workspaceSkills.includeUser')}</Text>
        <Switch
          aria-label={t('workspaceSkills.includeUser')}
          checked={policy.includeUserSkills}
          onChange={(checked) => setFlag('includeUserSkills', checked)}
        />
        <Text>{t('workspaceSkills.includeAgent')}</Text>
        <Switch
          aria-label={t('workspaceSkills.includeAgent')}
          checked={policy.includeAgentSkills}
          onChange={(checked) => setFlag('includeAgentSkills', checked)}
        />
      </div>

      <Flexbox gap={6}>
        <Text>{t('workspaceSkills.materialize.label')}</Text>
        <Select
          className={styles.select}
          options={options}
          value={policy.materializeForHeteroCli}
          onChange={(value) => {
            setPolicy((current) => ({
              ...current,
              materializeForHeteroCli: value as MaterializationMode,
            }));
            setSaved(false);
          }}
        />
        <p className={styles.description}>{t('workspaceSkills.materialize.description')}</p>
      </Flexbox>

      <Flexbox horizontal align={'center'} gap={8}>
        <Button disabled={!dirty} loading={isSaving} type={'primary'} onClick={() => void save()}>
          {t('workspaceSkills.save')}
        </Button>
        {saved && (
          <span aria-live={'polite'} className={styles.status} role={'status'}>
            {t('workspaceSkills.saveSuccess')}
          </span>
        )}
        {error && (
          <span className={styles.error} role={'alert'}>
            {t('workspaceSkills.saveError')}
          </span>
        )}
      </Flexbox>

      <SkillSection
        emptyText={t('workspaceSkills.empty')}
        isEmpty={!projectSkills.isLoading && projectSkills.items.length === 0}
        isLoading={projectSkills.isLoading}
        sectionHeader={{
          count: projectSkills.items.length,
          defaultExpanded: false,
          title: t('workspaceSkills.discovered'),
        }}
      >
        <SkillsList
          getRowActions={projectSkills.getRowActions}
          items={projectSkills.items}
          onOpenFile={projectSkills.onOpenFile}
          onOpenSkill={projectSkills.onOpenSkill}
        />
      </SkillSection>
    </section>
  );
});

WorkspaceSkillsSettings.displayName = 'WorkspaceSkillsSettings';

export default WorkspaceSkillsSettings;
