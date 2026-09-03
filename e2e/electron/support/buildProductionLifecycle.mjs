import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { build as viteBuild } from 'vite';

const supportDirectory = path.dirname(fileURLToPath(import.meta.url));
const electronRoot = path.resolve(supportDirectory, '..');
const repositoryRoot = path.resolve(electronRoot, '../..');
const artifactDirectory = path.resolve(electronRoot, '.artifacts');

// Keep the production harness aligned with the repository's ordered tsconfig
// path fallbacks. Vite aliases do not support fallback arrays, so the two
// source-only utility modules must precede the package-level utility alias.
const projectAliases = [
  {
    find: '@/const/locale',
    replacement: path.resolve(repositoryRoot, 'src/const/locale.ts'),
  },
  {
    find: '@/utils/agentDocumentContextMapping',
    replacement: path.resolve(repositoryRoot, 'src/utils/agentDocumentContextMapping.ts'),
  },
  {
    find: '@/utils/electron/ipc',
    replacement: path.resolve(repositoryRoot, 'src/utils/electron/ipc.ts'),
  },
  {
    find: '@/utils/navigation',
    replacement: path.resolve(repositoryRoot, 'src/utils/navigation.ts'),
  },
  { find: '@/const', replacement: path.resolve(repositoryRoot, 'packages/const/src') },
  { find: '@/utils', replacement: path.resolve(repositoryRoot, 'packages/utils/src') },
  { find: '@/types', replacement: path.resolve(repositoryRoot, 'packages/types/src') },
  { find: '@/envs', replacement: path.resolve(repositoryRoot, 'packages/env/src') },
  { find: '@/libs/trpc', replacement: path.resolve(repositoryRoot, 'packages/trpc/src') },
  { find: '@/config', replacement: path.resolve(repositoryRoot, 'packages/app-config/src') },
  { find: '@/locales', replacement: path.resolve(repositoryRoot, 'packages/locales/src') },
  {
    find: '@/business/server',
    replacement: path.resolve(repositoryRoot, 'packages/business-server/src'),
  },
  { find: '@/server', replacement: path.resolve(repositoryRoot, 'apps/server/src') },
  { find: '@', replacement: path.resolve(repositoryRoot, 'src') },
];

const transpile = async ({ outputName, sourcePath }) => {
  const source = await readFile(sourcePath, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2023,
    },
    fileName: sourcePath,
    reportDiagnostics: true,
  });

  const errors = output.diagnostics?.filter(
    ({ category }) => category === ts.DiagnosticCategory.Error,
  );
  if (errors?.length) {
    throw new Error(
      errors
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
        .join('\n'),
    );
  }

  await writeFile(path.resolve(artifactDirectory, `${outputName}.mjs`), output.outputText, 'utf8');
};

export const buildProductionLifecycle = async () => {
  await mkdir(artifactDirectory, { recursive: true });
  await Promise.all([
    transpile({
      outputName: 'ToolCallLifecycle',
      sourcePath: path.resolve(
        repositoryRoot,
        'src/store/chat/agents/toolCallLifecycle/ToolCallLifecycle.ts',
      ),
    }),
    transpile({
      outputName: 'retryPolicy',
      sourcePath: path.resolve(
        repositoryRoot,
        'src/store/chat/agents/toolCallLifecycle/retryPolicy.ts',
      ),
    }),
    transpile({
      outputName: 'AihubReadiness',
      sourcePath: path.resolve(
        repositoryRoot,
        'apps/server/src/services/newApi/readiness/index.ts',
      ),
    }),
  ]);

  await viteBuild({
    build: {
      emptyOutDir: false,
      lib: {
        entry: path.resolve(electronRoot, 'production-app/notebookRenderer.tsx'),
        fileName: () => 'notebookRenderer.js',
        formats: ['es'],
      },
      minify: false,
      outDir: artifactDirectory,
      sourcemap: false,
    },
    configFile: false,
    define: {
      'process.env.NODE_ENV': JSON.stringify('test'),
    },
    logLevel: 'warn',
    resolve: {
      alias: [
        {
          find: '@/libs/trpc/client',
          replacement: path.resolve(electronRoot, 'production-app/trpcClient.ts'),
        },
        {
          find: '@/store/chat',
          replacement: path.resolve(electronRoot, 'production-app/chatStore.ts'),
        },
        ...projectAliases,
      ],
      dedupe: ['react', 'react-dom'],
      tsconfigPaths: true,
    },
  });

  await viteBuild({
    build: {
      emptyOutDir: false,
      lib: {
        entry: path.resolve(electronRoot, 'production-app/workspaceRuntimeRenderer.tsx'),
        fileName: () => 'workspaceRuntimeRenderer.js',
        formats: ['es'],
      },
      minify: false,
      outDir: artifactDirectory,
      sourcemap: false,
    },
    configFile: false,
    define: {
      '__ELECTRON__': 'true',
      'process.env': '{}',
      'process.env.NODE_ENV': JSON.stringify('test'),
    },
    logLevel: 'warn',
    plugins: [
      {
        enforce: 'pre',
        name: 'workspace-runtime-product-boundaries',
        resolveId(source, importer) {
          if (!importer) return;
          const normalized = importer.split('?')[0];
          if (
            source === './useDropdownMenu' &&
            (normalized.endsWith('/features/AgentTopicSidebar/TopicItem/index.tsx') ||
              normalized.includes('/routes/(main)/agent/_layout/Sidebar/Topic/'))
          ) {
            return path.resolve(electronRoot, 'production-app/workspaceRuntimeDropdownMenu.ts');
          }
          if (
            ['./Actions', './Editing'].includes(source) &&
            normalized.endsWith('/features/AgentTopicSidebar/TopicItem/index.tsx')
          ) {
            return path.resolve(electronRoot, 'production-app/workspaceRuntimeEmptyComponent.tsx');
          }
          if (
            ['./Actions', './Filter', './ToggleGroups'].includes(source) &&
            normalized.endsWith('/routes/(main)/agent/_layout/Sidebar/Topic/index.tsx')
          ) {
            return path.resolve(electronRoot, 'production-app/workspaceRuntimeEmptyComponent.tsx');
          }
          if (
            source === '../AllTopicsDrawer' &&
            normalized.endsWith('/routes/(main)/agent/_layout/Sidebar/Topic/List/index.tsx')
          ) {
            return path.resolve(electronRoot, 'production-app/workspaceRuntimeEmptyComponent.tsx');
          }
          if (
            source === '../../TopicListContent/ThreadList' &&
            normalized.endsWith('/routes/(main)/agent/_layout/Sidebar/Topic/List/Item/index.tsx')
          ) {
            return path.resolve(electronRoot, 'production-app/workspaceRuntimeEmptyComponent.tsx');
          }
        },
      },
    ],
    resolve: {
      alias: [
        ...['agent', 'aiInfra', 'chat', 'electron', 'global', 'projectWorkspace', 'user'].map(
          (store) => ({
            find: new RegExp(`^@/store/${store}$`),
            replacement: path.resolve(electronRoot, 'production-app/workspaceRuntimeStores.ts'),
          }),
        ),
        ...['agent', 'chat', 'global', 'user'].map((store) => ({
          find: new RegExp(`^@/store/${store}/selectors$`),
          replacement: path.resolve(electronRoot, 'production-app/workspaceRuntimeSelectors.ts'),
        })),
        {
          find: '@/hooks/useFetchChatTopics',
          replacement: path.resolve(
            electronRoot,
            'production-app/workspaceRuntimeFetchChatTopics.ts',
          ),
        },
        {
          find: /^@\/libs\/swr$/,
          replacement: path.resolve(electronRoot, 'production-app/workspaceRuntimeSWR.ts'),
        },
        {
          find: /^@\/services\/task$/,
          replacement: path.resolve(electronRoot, 'production-app/workspaceRuntimeTaskService.ts'),
        },
        ...projectAliases,
      ],
      dedupe: ['react', 'react-dom'],
      tsconfigPaths: true,
    },
  });
};
