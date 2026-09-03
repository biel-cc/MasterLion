/** Workspace execution-environment copy. Kept value-free so the UI never implies secret access. */
export default {
  'workspaceEnv.configured': 'Configured',
  'workspaceEnv.configuredList': 'Configured environment variables',
  'workspaceEnv.configuredValueLabel': '{{key}} is configured',
  'workspaceEnv.description':
    'These variables are resolved for agent commands in this workspace. Saved secrets stay masked.',
  'workspaceEnv.empty': 'No environment variables yet',
  'workspaceEnv.formLabel': 'Add or replace an environment variable',
  'workspaceEnv.invalidKey':
    'Start with a letter or underscore, then use only letters, numbers, and underscores.',
  'workspaceEnv.keyLabel': 'Name',
  'workspaceEnv.keyPlaceholder': 'EXAMPLE_VARIABLE',
  'workspaceEnv.loadError': 'Could not load environment variables.',
  'workspaceEnv.loading': 'Loading environment variables',
  'workspaceEnv.maskedValueLabel': '{{key}} is a masked secret',
  'workspaceEnv.retry': 'Retry',
  'workspaceEnv.revoke': 'Revoke',
  'workspaceEnv.revokeConfirmDescription':
    '{{key}} will no longer be available to new agent commands in this workspace.',
  'workspaceEnv.revokeConfirmTitle': 'Revoke environment variable?',
  'workspaceEnv.revokeLabel': 'Revoke {{key}}',
  'workspaceEnv.revokeSuccess': '{{key}} was revoked.',
  'workspaceEnv.save': 'Save',
  'workspaceEnv.saveError': 'Could not save the environment change.',
  'workspaceEnv.saveSuccess': 'Environment variable saved.',
  'workspaceEnv.secret': 'Secret',
  'workspaceEnv.secretLabel': 'Store as a secret',
  'workspaceEnv.title': 'Workspace environment',
  'workspaceEnv.valueLabel': 'Value',
  'workspaceEnv.valuePlaceholder': 'Enter a value',
};
