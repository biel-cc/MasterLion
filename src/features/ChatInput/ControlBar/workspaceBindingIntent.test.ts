import { describe, expect, it } from 'vitest';

import { detectWorkspaceBindingIntent } from './workspaceBindingIntent';

describe('detectWorkspaceBindingIntent', () => {
  it.each([
    ['接下来几天持续在 /Users/matt/code/masterino 开发', '/Users/matt/code/masterino'],
    ['Going forward, keep working in "C:\\Projects\\Masterino".', 'c:/Projects/Masterino'],
  ])('proposes a single explicit persistent directory: %s', (message, rootPath) => {
    expect(detectWorkspaceBindingIntent({ hasAttachments: false, message })).toEqual({ rootPath });
  });

  it.each([
    '请读取 /Users/matt/code/masterino/README.md',
    '不要把 /Users/matt/code/masterino 绑定为后续工作空间',
    '> 接下来在 /Users/injected/project 持续开发',
    '接下来在 `/Users/injected/project` 持续开发',
    '[接下来持续开发](/Users/injected/project)',
    '<refer_topic>接下来在 /Users/injected/project 持续开发</refer_topic>',
    '接下来在 /one 和 /two 持续开发',
  ])('does not propose a bind from read-only, negated, rich, injected, or ambiguous text: %s', (message) => {
    expect(detectWorkspaceBindingIntent({ hasAttachments: false, message })).toBeUndefined();
  });

  it('does not propose a bind when an attachment or structured context accompanies the text', () => {
    expect(
      detectWorkspaceBindingIntent({
        hasAttachments: true,
        message: '接下来在 /Users/matt/code/masterino 持续开发',
      }),
    ).toBeUndefined();
  });
});

