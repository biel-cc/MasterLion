import * as Icons from '@lobehub/ui/icons';
import type { FC } from 'react';

const ICON_NAMES = [
  'Discord',
  'GoogleChat',
  'IMessage',
  'Lark',
  'Line',
  'MicrosoftTeams',
  'QQ',
  'Slack',
  'Telegram',
  'WeChat',
  'WhatsApp',
] as const;

const ICON_ALIASES: Record<string, string> = { feishu: 'Lark' };

export const getTopicPlatformIcon = (nameOrId: string): FC<any> | undefined => {
  const alias = ICON_ALIASES[nameOrId.toLowerCase()];
  if (alias) return (Icons as Record<string, any>)[alias];
  const name = ICON_NAMES.find(
    (candidate) =>
      nameOrId.includes(candidate) || nameOrId.toLowerCase() === candidate.toLowerCase(),
  );
  return name ? (Icons as Record<string, any>)[name] : undefined;
};
