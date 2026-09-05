import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import chat from '../../../locales/en-US/chat.json';
import common from '../../../locales/en-US/common.json';
import components from '../../../locales/en-US/components.json';
import error from '../../../locales/en-US/error.json';
import plugin from '../../../locales/en-US/plugin.json';
import tool from '../../../locales/en-US/tool.json';
import topic from '../../../locales/en-US/topic.json';

/**
 * Shipped en-US namespaces, shared by the production-mode and
 * development-mode Electron bundles. Each bundle owns its own `i18next`
 * instance, so both call this once at start-up.
 */
export const createWorkspaceRuntimeI18n = () => {
  void i18n.use(initReactI18next).init({
    fallbackLng: 'en-US',
    interpolation: { escapeValue: false },
    lng: 'en-US',
    resources: { 'en-US': { chat, common, components, error, plugin, tool, topic } },
  });

  return i18n;
};
