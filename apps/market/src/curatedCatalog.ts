import type { ResourceType } from './contracts.js';

export const CURATED_SEED_BATCH = 'masterino-community-v1';

export interface CuratedResource {
  artifact?: { files: Record<string, string> };
  resource: Record<string, any> & { identifier: string; version: string };
  type: ResourceType;
}

const skill = (input: {
  category: string;
  description: string;
  identifier: string;
  instructions: string;
  name: string;
  sourceAuthor: string;
  sourceIdentifier: string;
  sourceUrl: string;
}): CuratedResource => {
  const skillMd = `---
name: ${input.name}
description: ${input.description}
---

${input.instructions.trim()}
`;
  return {
    artifact: { files: { 'SKILL.md': skillMd } },
    resource: {
      category: input.category,
      description: input.description,
      identifier: input.identifier,
      manifest: {
        files: [{ path: 'SKILL.md', type: 'file' }],
        name: input.name,
        description: input.description,
      },
      metadata: {
        adaptation: 'internal-rewrite',
        isFeatured: true,
        isOfficial: true,
        license: 'Masterino-internal',
        reviewedAt: '2026-08-07T00:00:00.000Z',
        seedBatchId: CURATED_SEED_BATCH,
        sourceCatalog: 'skillhub.cn',
        sourceAuthor: input.sourceAuthor,
        sourceIdentifier: input.sourceIdentifier,
        sourceUrl: input.sourceUrl,
        sourceVersion: 'catalog-snapshot-2026-08-07',
      },
      name: input.name,
      tags: ['Masterino 精选', 'SkillHub 热门方向'],
      version: '1.0.0',
    },
    type: 'skill',
  };
};

const agent = (
  identifier: string,
  name: string,
  description: string,
  systemRole: string,
  skills: string[] = [],
): CuratedResource => ({
  resource: {
    category: 'productivity',
    config: { skills, systemRole },
    description,
    identifier,
    metadata: { isFeatured: true, isOfficial: true, seedBatchId: CURATED_SEED_BATCH },
    name,
    tags: ['Masterino 官方', '企业效率'],
    version: '1.0.0',
  },
  type: 'agent',
});

const mcp = (input: {
  auth: 'none' | 'oauth2';
  category: string;
  description: string;
  identifier: string;
  name: string;
  url: string;
}): CuratedResource => ({
  resource: {
    category: input.category,
    config: { connectionType: 'http' },
    description: input.description,
    identifier: input.identifier,
    manifest: {
      deploymentOptions: [
        {
          connection: {
            auth: { type: input.auth },
            type: 'http',
            url: input.url,
          },
          isRecommended: true,
        },
      ],
      identifier: input.identifier,
      meta: { description: input.description, title: input.name },
      type: 'mcp',
      version: '1.0.0',
    },
    metadata: {
      isFeatured: true,
      isOfficial: true,
      seedBatchId: CURATED_SEED_BATCH,
      sourceUrl: input.url,
    },
    name: input.name,
    tags: ['官方 MCP', '远程 HTTP'],
    version: '1.0.0',
  },
  type: 'mcp',
});

export const curatedResources: CuratedResource[] = [
  agent(
    'masterino-office-assistant',
    'Office 文档助手',
    '使用固定版本 OfficeCLI 创建、检查并交付 Word、Excel 和 PowerPoint。',
    '你是公司 Office 文档交付助手。先确认内容结构，再使用 Office Documents 技能生成、预览、校验并导出文件。不得跳过交付前校验。',
    ['office-documents'],
  ),
  agent(
    'masterino-data-analyst',
    '数据分析助手',
    '清洗表格、解释指标、制作图表并给出可执行结论。',
    '你是企业数据分析助手。先核对数据质量和口径，再完成计算、可视化和结论；明确区分事实、假设和建议。',
    ['curated-smart-charts', 'curated-excel-automation'],
  ),
  agent(
    'masterino-research-assistant',
    '资料研究助手',
    '检索可信资料、交叉核验来源并形成带出处的研究摘要。',
    '你是资料研究助手。优先使用权威一手来源，记录出处和日期，交叉核验关键结论，无法确认时明确说明不确定性。',
  ),
  agent(
    'masterino-meeting-assistant',
    '会议纪要助手',
    '整理会议记录、决策、负责人、截止时间和待办。',
    '你是会议纪要助手。输出会议目的、关键讨论、明确决策、行动项、负责人和截止时间；不要把建议误写成已决策事项。',
  ),
  agent(
    'masterino-bilingual-writer',
    '中英商务写作助手',
    '撰写自然、准确、符合公司语境的中英双语商务内容。',
    '你是中英商务写作助手。保留原意和事实，使用自然简洁的商务表达，术语前后一致，并根据受众调整语气。',
    ['curated-natural-writing'],
  ),
  skill({
    category: 'data-analytics',
    description: '从 CSV、Excel 或 JSON 数据生成摘要、推荐图表并输出可保存的可视化结果。',
    identifier: 'curated-smart-charts',
    instructions: `# 工作流

1. 读取用户数据并报告列名、类型、缺失值和异常值。
2. 询问或推断分析目标；推断时明确说明。
3. 选择最少且最能回答问题的图表，禁止使用误导性坐标轴。
4. 在 Onlyboxes 中生成自包含 HTML 图表和 PNG 预览。
5. 交付图表、数据口径、关键发现和限制。`,
    name: '智能图表',
    sourceAuthor: 'user_5b28ea14',
    sourceIdentifier: '@user_5b28ea14/smart-charts',
    sourceUrl: 'https://skillhub.cn/skills/smart-charts',
  }),
  skill({
    category: 'productivity-tasks',
    description: '清洗、合并和格式化 Excel/WPS 表格，并生成可复核的企业报表。',
    identifier: 'curated-excel-automation',
    instructions: `# 工作流

1. 保留原始文件，只在当前 Onlyboxes 工作目录创建新文件。
2. 检查工作表、公式、合并单元格、数据类型和空值。
3. 执行用户要求的清洗、合并、公式、冻结窗格、筛选和格式化。
4. 防止以 =、+、-、@ 开头的不可信文本形成公式注入。
5. 使用 Office Documents 校验并预览结果后再导出。`,
    name: 'Excel/WPS 表格自动化',
    sourceAuthor: 'user_7871dce1',
    sourceIdentifier: 'excel-auto-zh',
    sourceUrl: 'https://skillhub.cn/skills/excel-auto-zh',
  }),
  skill({
    category: 'pdf-documents',
    description: '从中英文 PDF 和图片提取文字，保留页码并标注低置信度内容。',
    identifier: 'curated-ocr-extractor',
    instructions: `# 工作流

1. 仅处理当前会话上传的 PDF 或图片。
2. 优先提取嵌入文本；无文本层时使用沙箱内固定版本 OCR。
3. 按页输出，保留标题、段落和表格的基本结构。
4. 对无法辨认的文字使用 [无法识别]，不得猜测。
5. 返回 Markdown 结果，并按需生成 Word 文档。`,
    name: 'PDF 与图片文字提取',
    sourceAuthor: 'user_5f9c21aa',
    sourceIdentifier: 'pdf-image-text-extractor',
    sourceUrl: 'https://skillhub.cn/skills/pdf-image-text-extractor',
  }),
  skill({
    category: 'productivity-tasks',
    description: '在不改变事实和专业含义的前提下，把商务文字改得自然、清楚、有温度。',
    identifier: 'curated-natural-writing',
    instructions: `# 工作流

1. 识别受众、目的和语气；信息不足时采用简洁专业语气。
2. 删除空泛套话、机械连接词、重复总结和不必要的标题层级。
3. 保留数字、日期、专有名词、承诺和风险提示。
4. 不捏造个人经历，不刻意规避 AI 检测。
5. 默认只返回润色稿；关键含义发生变化时附简短说明。`,
    name: '自然商务写作',
    sourceAuthor: 'user_ab5ae6ee',
    sourceIdentifier: 'unclecheng-reduce-ai-perception',
    sourceUrl: 'https://skillhub.cn/skills/unclecheng-reduce-ai-perception',
  }),
  skill({
    category: 'productivity-tasks',
    description: '把系统、业务流程和复杂知识转换为可维护的架构图、流程图或思维导图。',
    identifier: 'curated-architecture-diagrams',
    instructions: `# 工作流

1. 明确图的受众、边界、层级和核心问题。
2. 提取节点、关系、方向和分组，避免把段落直接堆入图中。
3. 优先生成 Mermaid；需要精细交付时生成 SVG。
4. 使用一致的形状、颜色和连线语义，并提供图例。
5. 在交付前检查孤立节点、交叉连线和移动端可读性。`,
    name: '架构图与流程图',
    sourceAuthor: 'user_bddf3fe6',
    sourceIdentifier: 'contextweave-interactive-architecture',
    sourceUrl: 'https://skillhub.cn/skills/contextweave-interactive-architecture',
  }),
  mcp({
    auth: 'oauth2',
    category: 'developer',
    description: 'GitHub 官方远程 MCP，用于按用户授权访问仓库、Issue 和 Pull Request。',
    identifier: 'github-official-mcp',
    name: 'GitHub MCP',
    url: 'https://api.githubcopilot.com/mcp/',
  }),
  mcp({
    auth: 'oauth2',
    category: 'developer',
    description: '检索最新的开源库文档和代码示例。',
    identifier: 'context7-mcp',
    name: 'Context7',
    url: 'https://mcp.context7.com/mcp/oauth',
  }),
  mcp({
    auth: 'none',
    category: 'science-education',
    description: '搜索并获取 Microsoft Learn 官方文档和代码示例。',
    identifier: 'microsoft-learn-mcp',
    name: 'Microsoft Learn',
    url: 'https://learn.microsoft.com/api/mcp',
  }),
  mcp({
    auth: 'none',
    category: 'news',
    description: '查询 Microsoft 365 Roadmap 和 Azure Updates 发布信息。',
    identifier: 'microsoft-release-communications-mcp',
    name: 'Microsoft Release Communications',
    url: 'https://www.microsoft.com/releasecommunications/mcp',
  }),
  mcp({
    auth: 'none',
    category: 'developer',
    description: '搜索 Cloudflare 官方产品文档。',
    identifier: 'cloudflare-docs-mcp',
    name: 'Cloudflare Docs',
    url: 'https://docs.mcp.cloudflare.com/mcp',
  }),
];
