import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { build as viteBuild } from 'vite';

const supportDirectory = path.dirname(fileURLToPath(import.meta.url));
const electronRoot = path.resolve(supportDirectory, '..');
const repositoryRoot = path.resolve(electronRoot, '../..');
const artifactDirectory = path.resolve(electronRoot, '.artifacts');

// Ordered mirror of the repository tsconfig `paths` fallback lists. Vite's
// `resolve.alias` cannot express an ordered fallback, so a hand-maintained
// alias list used to be needed for every source-only module (`@/const/topic`,
// `@/utils/navigation`, …). Resolving the fallbacks properly keeps the harness
// honest as the production module graph grows.
const TSCONFIG_PATH_GROUPS = [
  ['@/database/', ['packages/database/src']],
  ['@/business/server/', ['packages/business-server/src', 'src/business/server']],
  ['@/libs/trpc/', ['packages/trpc/src', 'src/libs/trpc']],
  ['@/const/', ['packages/const/src', 'src/const']],
  ['@/utils/', ['packages/utils/src', 'src/utils']],
  ['@/types/', ['packages/types/src', 'src/types']],
  ['@/envs/', ['packages/env/src', 'src/envs']],
  ['@/config/', ['packages/app-config/src', 'src/config']],
  ['@/locales/', ['packages/locales/src', 'src/locales']],
  ['@/server/', ['apps/server/src', 'src/server']],
  ['@/', ['src']],
];

const MODULE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'];

const isFile = (candidate) => {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
};

const resolveModuleFile = (basePath) => {
  if (isFile(basePath)) return basePath;
  for (const extension of MODULE_EXTENSIONS) {
    if (isFile(`${basePath}${extension}`)) return `${basePath}${extension}`;
  }
  for (const extension of MODULE_EXTENSIONS) {
    const candidate = path.join(basePath, `index${extension}`);
    if (isFile(candidate)) return candidate;
  }
  return undefined;
};

/** Resolves `@/…` specifiers through the tsconfig fallback order. */
const workspacePathsPlugin = () => ({
  enforce: 'pre',
  name: 'masterino-e2e-tsconfig-path-fallbacks',
  resolveId(source) {
    if (!source.startsWith('@/')) return;

    for (const [prefix, roots] of TSCONFIG_PATH_GROUPS) {
      if (!source.startsWith(prefix)) continue;
      const rest = source.slice(prefix.length);
      for (const root of roots) {
        const resolved = resolveModuleFile(path.resolve(repositoryRoot, root, rest));
        if (resolved) return resolved;
      }
    }
  },
});

/**
 * Local copies of the production renderer plugins (`plugins/vite/*`). They are
 * inlined rather than imported because this harness module is plain ESM loaded
 * by Playwright's Node runtime, which does not transpile the `.ts` originals.
 */
const nodeModuleStubPlugin = () => {
  const stubbed = new Set(['node:stream', 'node-fetch']);
  const VIRTUAL_PREFIX = '\0node-stub:';

  return {
    enforce: 'pre',
    load(id) {
      return id.startsWith(VIRTUAL_PREFIX) ? 'export default {};' : null;
    },
    name: 'masterino-e2e-node-module-stub',
    resolveId(source) {
      if (!stubbed.has(source)) return null;
      return { id: `${VIRTUAL_PREFIX}${source}`, moduleSideEffects: false };
    },
  };
};

const markdownImportPlugin = () => {
  const QUERY = 'lobe-md-import';

  return {
    enforce: 'pre',
    async load(id) {
      if (!new URLSearchParams(id.split('?')[1] ?? '').has(QUERY)) return null;
      return `export default ${JSON.stringify(await readFile(id.replace(/[?#].*$/, ''), 'utf8'))};`;
    },
    name: 'masterino-e2e-markdown-import',
    async resolveId(source, importer, options) {
      if (!importer || source.includes('?') || !source.endsWith('.md')) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved) return null;
      return { id: `${resolved.id}?${QUERY}`, moduleSideEffects: false };
    },
  };
};

/** Mirrors `vitePlatformResolve('desktop')` — the Electron renderer's variant order. */
const platformResolvePlugin = () => {
  const suffixes = ['.desktop', '.vite'];
  const EXT_RE = /\.(ts|tsx|js|jsx)$/;
  const PLATFORM_RE = /\.(?:vite|web|mobile|desktop|auth)\.(?:ts|tsx|js|jsx)$/;

  return {
    enforce: 'pre',
    name: 'masterino-e2e-platform-resolve',
    async resolveId(source, importer, options) {
      if (!importer || importer.includes('node_modules')) return null;

      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved) return null;

      const id = resolved.id.split('?')[0];
      const extMatch = id.match(EXT_RE);
      if (!extMatch || PLATFORM_RE.test(id)) return null;

      const basePath = id.slice(0, -extMatch[0].length);
      for (const suffix of suffixes) {
        const candidate = `${basePath}${suffix}${extMatch[0]}`;
        try {
          await access(candidate);
          return candidate;
        } catch {
          // Not found, try the next suffix.
        }
      }

      return null;
    },
  };
};

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

const buildOnce = async () => {
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
    plugins: [workspacePathsPlugin()],
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
    // Same compile-time switches the packaged Electron renderer builds with
    // (`sharedRendererDefine({ isElectron: true, isMobile: false })`), so the
    // production stores and hooks take their real desktop branches.
    define: {
      '__CI__': 'false',
      '__DEV__': 'false',
      '__ELECTRON__': 'true',
      '__MOBILE__': 'false',
      '__TEST__': 'false',
      'process.env': '{}',
      'process.env.NODE_ENV': JSON.stringify('test'),
    },
    logLevel: 'warn',
    plugins: [
      {
        /**
         * Shell-only UI substitutions. These are presentation affordances the
         * Topic navigation contract does not cover (row/section overflow menus,
         * filter + grouping toggles, the "all topics" drawer, thread lists).
         * They pull heavy portal/menu surfaces into a headless Electron window
         * without adding coverage. Every data and placement dependency —
         * stores, actions, selectors, SWR, services — stays production code.
         */
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
      // Order matters: the platform-variant resolver has to see a specifier
      // before the path resolver answers it, so it can look for the
      // `.desktop` / `.vite` sibling of whatever the path fallbacks pick.
      platformResolvePlugin(),
      workspacePathsPlugin(),
      markdownImportPlugin(),
      nodeModuleStubPlugin(),
    ],
    resolve: {
      // The only data-chain substitution: the TRPC transport. Production
      // stores, actions, selectors, SWR hooks and services are all real.
      alias: [
        {
          find: '@/libs/trpc/client',
          replacement: path.resolve(electronRoot, 'production-app/workspaceRuntimeTrpcClient.ts'),
        },
      ],
      dedupe: ['react', 'react-dom'],
      tsconfigPaths: true,
    },
  });
};

let buildPromise;

/**
 * Building the production module graph is expensive and every Electron spec
 * needs the same artifacts, so the work is shared across specs in a worker.
 */
export const buildProductionLifecycle = async () => {
  buildPromise ??= buildOnce();
  return buildPromise;
};
