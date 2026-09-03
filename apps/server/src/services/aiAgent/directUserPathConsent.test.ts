import { describe, expect, it } from 'vitest';

import {
  buildDirectUserMessageAccessRoots,
  extractDirectUserAbsolutePathCandidates,
} from './directUserPathConsent';

const base = {
  botConversation: false,
  evalRun: false,
  hasAttachments: false,
  headless: false,
  operationId: 'op-new',
  prompt: '请读取 /outside/docs',
  suppressUserMessage: false,
  topicId: 'topic-a',
};

describe('direct user path consent', () => {
  it('extracts at most three unique absolute paths from plain text', () => {
    expect(
      extractDirectUserAbsolutePathCandidates(
        '读 /one 和 "/two with space"，再读 C:\\three，重复 /one，忽略 /four',
      ),
    ).toEqual(['/one', '/two with space', 'c:/three']);
  });

  it('keeps an explicit home-relative path for device-side expansion and realpath', () => {
    expect(extractDirectUserAbsolutePathCandidates('读取 ~/.config/tool/settings.json')).toEqual([
      '~/.config/tool/settings.json',
    ]);
    expect(extractDirectUserAbsolutePathCandidates('不要猜测 ~someone/private')).toEqual([]);
  });

  it('ignores quote, fenced code, inline code, URL, and injected blocks', () => {
    expect(
      extractDirectUserAbsolutePathCandidates(`
> 引用 /quoted
\`\`\`sh
cat /code
\`\`\`
行内 \`/inline\`
https://example.com/not-a-path
<attachment>/attachment/path</attachment>
<refer_topic>/injected/path</refer_topic>
[markdown](/link/path)
直接读取 /direct/path
`),
    ).toEqual(['/direct/path']);
  });

  it('creates operation-scoped read-only candidates for a direct first-party turn', () => {
    expect(buildDirectUserMessageAccessRoots(base)).toEqual([
      {
        modes: ['read'],
        operationId: 'op-new',
        rootPath: '/outside/docs',
        scope: 'operation',
        source: 'direct-user-message',
        topicId: 'topic-a',
      },
    ]);
  });

  it.each([
    { botConversation: true },
    { cronJobId: 'cron-a' },
    { ephemeralUserMessage: 'injected' },
    { evalRun: true },
    { hasAttachments: true },
    { headless: true },
    { suppressUserMessage: true },
    { taskId: 'task-a' },
    { appScope: 'task' },
    { automationMode: 'schedule' },
    { prompt: '> 来自引用 /quoted\n直接 /direct' },
    { prompt: '```sh\ncat /code\n```\n直接 /direct' },
    { prompt: '<refer_topic name="/injected/path" id="topic-old" />\n读 /direct' },
    { trigger: 'cron' },
    { trigger: 'task' },
  ])('does not create candidates for excluded source %#', (override) => {
    expect(buildDirectUserMessageAccessRoots({ ...base, ...override })).toEqual([]);
  });
});
