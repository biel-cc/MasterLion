import i18next from 'i18next';
import { describe, expect, it } from 'vitest';

import generatedEnglishMenu from '@/../../resources/locales/en/menu.json';
import simplifiedChineseMenu from '@/../../resources/locales/zh-CN/menu.json';
import defaultEnglishMenu from '@/locales/default/menu';

describe('desktop menu locale resources', () => {
  it('keeps generated English keys aligned with the default resource', () => {
    expect(Object.keys(generatedEnglishMenu).sort()).toEqual(Object.keys(defaultEnglishMenu).sort());
  });

  it('uses fully localized Simplified Chinese tray labels', () => {
    expect(simplifiedChineseMenu).toMatchObject({
      'tray.open': '打开 {{appName}}',
      'tray.openMiniToolbar': '快捷创作',
      'tray.quickChat': '快捷聊天',
      'tray.quit': '退出',
      'tray.settings': '设置',
    });
  });

  it('falls back to English instead of returning a missing translation key', async () => {
    const instance = i18next.createInstance();

    await instance.init({
      fallbackLng: 'en',
      lng: 'ja-JP',
      resources: {
        en: { menu: defaultEnglishMenu },
        'ja-JP': { menu: {} },
      },
    });

    expect(instance.t('tray.settings', { ns: 'menu' })).toBe('Settings');
  });
});
