import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';
import { build as viteBuild, loadConfigFromFile } from 'vite';

const supportDirectory = path.dirname(fileURLToPath(import.meta.url));
const electronRoot = path.resolve(supportDirectory, '..');
const repositoryRoot = path.resolve(electronRoot, '../..');
const artifactDirectory = path.resolve(electronRoot, '.artifacts');
const pluginArtifactDirectory = path.resolve(artifactDirectory, 'production-plugins');

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

/**
 * Read the repository `tsconfig.json` `paths` map instead of restating it.
 * Vite's `resolve.alias` cannot express an ordered fallback list, so the
 * fallbacks are resolved here — but the list itself has a single source of
 * truth, so adding a `@/…` alias upstream needs no change in this harness.
 */
const readTsconfigPathGroups = async () => {
  const tsconfig = JSON.parse(
    await readFile(path.resolve(repositoryRoot, 'tsconfig.json'), 'utf8'),
  );
  const paths = tsconfig.compilerOptions?.paths ?? {};

  return Object.entries(paths)
    .map(([pattern, targets]) => ({
      // '@/database/*' → '@/database/'; '~test-utils' stays exact.
      prefix: pattern.endsWith('/*') ? pattern.slice(0, -1) : pattern,
      roots: targets.map((target) =>
        (target.endsWith('/*') ? target.slice(0, -2) : target).replace(/^\.\//, ''),
      ),
      wildcard: pattern.endsWith('/*'),
    }))
    .sort((left, right) => right.prefix.length - left.prefix.length);
};

/** Resolves tsconfig-mapped specifiers through their declared fallback order. */
const workspacePathsPlugin = (groups) => ({
  enforce: 'pre',
  name: 'masterino-e2e-tsconfig-path-fallbacks',
  resolveId(source) {
    for (const group of groups) {
      if (group.wildcard) {
        if (!source.startsWith(group.prefix)) continue;
        const rest = source.slice(group.prefix.length);
        for (const root of group.roots) {
          const resolved = resolveModuleFile(path.resolve(repositoryRoot, root, rest));
          if (resolved) return resolved;
        }
        continue;
      }

      if (source !== group.prefix) continue;
      for (const root of group.roots) {
        const resolved = resolveModuleFile(path.resolve(repositoryRoot, root));
        if (resolved) return resolved;
      }
    }
  },
});

const transpile = async ({ outputDirectory = artifactDirectory, outputName, sourcePath }) => {
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

  const outputPath = path.resolve(outputDirectory, `${outputName}.mjs`);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, output.outputText, 'utf8');
  return outputPath;
};

/**
 * The renderer plugins are the production implementations from
 * `plugins/vite/*`. They are TypeScript and this harness module is plain ESM
 * loaded by Playwright's Node runtime, so each one is transpiled 1:1 into
 * `.artifacts/production-plugins` and imported from there. Nothing is
 * re-implemented, so a change to the production plugin reaches this harness
 * without a second copy to maintain.
 */
const PRODUCTION_PLUGIN_MODULES = ['markdownImport', 'nodeModuleStub', 'platformResolve'];

const loadProductionRendererPlugins = async () => {
  const entries = await Promise.all(
    PRODUCTION_PLUGIN_MODULES.map(async (name) => {
      const outputPath = await transpile({
        outputDirectory: pluginArtifactDirectory,
        outputName: name,
        sourcePath: path.resolve(repositoryRoot, 'plugins/vite', `${name}.ts`),
      });
      return import(pathToFileURL(outputPath).href);
    }),
  );
  const [{ viteMarkdownImport }, { viteNodeModuleStub }, { vitePlatformResolve }] = entries;

  return { viteMarkdownImport, viteNodeModuleStub, vitePlatformResolve };
};

/**
 * Native / WebAssembly runtime packages that must stay outside the bundle:
 * PGlite ships its own `postgres.wasm` assets next to its entry, and `pg` may
 * load a native binding, so both have to be loaded by Node from their real
 * install location. pnpm keeps them out of the repository-root `node_modules`,
 * so they are symlinked next to the artifacts and imported by bare specifier —
 * that way Node applies the package's own export conditions instead of this
 * harness guessing an entry file.
 */
const NODE_RUNTIME_PACKAGES = [
  { from: 'packages/database/package.json', name: '@electric-sql/pglite' },
  { from: 'package.json', name: '@napi-rs/canvas' },
  { from: 'package.json', name: 'pg' },
  { from: 'package.json', name: 'sharp' },
];

/**
 * The package entry *and* every subpath export of it.
 *
 * `ssr.external` only accepts exact package names, so `@electric-sql/pglite`
 * stayed external while `@electric-sql/pglite/vector` was inlined — a second,
 * bundled copy of the extension whose `bundlePath` is
 * `new URL('../vector.tar.gz', import.meta.url)`. Inlined, that URL points next
 * to the emitted artifact instead of the package's `dist/`, so
 * `CREATE EXTENSION IF NOT EXISTS vector` failed on the first migration
 * statement. Rollup/Rolldown `external` accepts patterns, so the whole package
 * — entry and subpaths — resolves at runtime from the single symlinked
 * physical installation.
 */
const NODE_RUNTIME_EXTERNAL_PATTERNS = [
  ...NODE_RUNTIME_PACKAGES.map(
    ({ name }) =>
      new RegExp(`^${name.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`)}(?:/.+)?$`),
  ),
  // @discordjs/ws imports this optional native compressor dynamically and
  // already falls back when it is absent. Keep the unresolved optional edge
  // out of the acceptance bundle just as a normal Node runtime would.
  /^zlib-sync$/,
];

let primaryCheckout;

/**
 * A graph worktree intentionally reuses the primary checkout's installed
 * dependencies (the same strategy `electronTestApp` uses for the Electron
 * runtime). Resolve it through git's common directory without assuming a
 * sibling directory name.
 */
const getPrimaryCheckout = () => {
  if (primaryCheckout !== undefined) return primaryCheckout;
  try {
    const commonDirectory = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: repositoryRoot, encoding: 'utf8' },
    ).trim();
    primaryCheckout = path.dirname(commonDirectory);
  } catch {
    primaryCheckout = '';
  }
  return primaryCheckout;
};

const resolvePackageDirectoryFrom = (base, requireFrom, name) => {
  const require = createRequire(path.resolve(base, requireFrom));
  try {
    return path.dirname(require.resolve(`${name}/package.json`));
  } catch {
    // Packages whose `exports` map hides `./package.json`.
    let current = path.dirname(require.resolve(name));
    while (current !== path.dirname(current)) {
      if (isFile(path.join(current, 'package.json'))) return current;
      current = path.dirname(current);
    }
    throw new Error(`Could not locate the installed package directory for ${name}`);
  }
};

const resolvePackageDirectory = (requireFrom, name) => {
  const failures = [];
  for (const base of [repositoryRoot, getPrimaryCheckout()].filter(Boolean)) {
    try {
      return resolvePackageDirectoryFrom(base, requireFrom, name);
    } catch (error) {
      failures.push(`${base}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(
    `Could not resolve ${name} for the Electron acceptance seams\n${failures.join('\n')}`,
  );
};

const linkNodeRuntimePackages = async () => {
  for (const { from, name } of NODE_RUNTIME_PACKAGES) {
    const target = resolvePackageDirectory(from, name);
    const link = path.resolve(artifactDirectory, 'node_modules', name);
    await mkdir(path.dirname(link), { recursive: true });
    await rm(link, { force: true, recursive: true });
    await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  }
};

/**
 * Restores the CommonJS `__dirname` / `__filename` of each bundled source file.
 * `packages/database/src/core/getTestDB.ts` locates the real migration folder
 * relative to its own directory, and the acceptance database has to run those
 * real migrations.
 */
const nodeDirnameShimPlugin = () => ({
  enforce: 'post',
  name: 'masterino-e2e-node-dirname-shim',
  transform(code, id) {
    const file = id.split('?')[0];
    // The enlarged production-service graph includes CommonJS dependencies
    // whose transformed ESM still references a module-local `__dirname`.
    // Inject it for every real bundled file; Rollup scopes/renames each
    // declaration, preserving the dependency's own directory semantics.
    if (file.startsWith('\0') || !file.startsWith(repositoryRoot)) return null;
    if (!/\b__(?:dirname|filename)\b/.test(code)) return null;
    if (/(?:const|let|var|function)\s+__(?:dirname|filename)\b/.test(code)) return null;

    return {
      code:
        `const __filename = ${JSON.stringify(file)};\n` +
        `const __dirname = ${JSON.stringify(path.dirname(file))};\n${code}`,
      map: null,
    };
  },
});

/**
 * Load the desktop renderer's production compile-time contract instead of
 * restating it in the harness. This keeps NEXT_PUBLIC_* projection and every
 * future shared switch identical to the packaged application.
 */
const loadRendererDefine = async (mode) => {
  // The real Electron config loads mode-specific .env files directly into
  // process.env. Snapshot the whole environment so production-only keys cannot
  // leak into the development define (or into the launched test application).
  const previousEnvironment = { ...process.env };
  process.env.NODE_ENV = mode;
  try {
    const loaded = await loadConfigFromFile(
      { command: 'build', mode },
      path.resolve(repositoryRoot, 'apps/desktop/electron.vite.config.ts'),
      repositoryRoot,
    );
    const define = loaded?.config?.renderer?.define;
    if (!define) throw new Error(`${mode} Electron renderer define was not resolved`);
    return { ...define, 'process.env.NODE_ENV': JSON.stringify(mode) };
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in previousEnvironment)) delete process.env[key];
    }
    Object.assign(process.env, previousEnvironment);
  }
};

const buildOnce = async () => {
  await mkdir(artifactDirectory, { recursive: true });
  // Node loads `.artifacts/*` as ESM, including any code-split chunk the
  // bundler names `.js`. The browser bundles are loaded with
  // `<script type="module">` and are unaffected.
  await writeFile(
    path.resolve(artifactDirectory, 'package.json'),
    `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`,
    'utf8',
  );

  // Config loading temporarily scopes process.env, so keep the two modes
  // sequential instead of racing those mutations.
  const productionRendererDefine = await loadRendererDefine('production');
  const developmentRendererDefine = await loadRendererDefine('development');
  const [pathGroups, productionPlugins] = await Promise.all([
    readTsconfigPathGroups(),
    loadProductionRendererPlugins(),
    linkNodeRuntimePackages(),
  ]);
  const { viteMarkdownImport, viteNodeModuleStub, vitePlatformResolve } = productionPlugins;

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

  // ─── Electron main-process acceptance seams ───────────────────────────────
  // Real production services over a real isolated PGlite database and a real
  // temporary filesystem. Built for Node (not the browser) and loaded by
  // `app/main.cjs`, so the seams execute in the Electron main process and are
  // reached from the renderer through the preload IPC bridge.
  await viteBuild({
    build: {
      emptyOutDir: false,
      lib: {
        entry: path.resolve(electronRoot, 'production-app/workspaceRuntimeSeams.ts'),
        fileName: () => 'workspaceRuntimeSeams.mjs',
        formats: ['es'],
      },
      minify: false,
      outDir: artifactDirectory,
      rollupOptions: { external: NODE_RUNTIME_EXTERNAL_PATTERNS },
      sourcemap: false,
      ssr: true,
      target: 'node20',
    },
    configFile: false,
    // Main-process compile-time switches. `process.env` is deliberately left
    // alone: the database layer reads it at runtime.
    define: {
      __CI__: 'false',
      __DEV__: 'false',
      __ELECTRON__: 'true',
      __MOBILE__: 'false',
      __TEST__: 'false',
    },
    logLevel: 'warn',
    plugins: [workspacePathsPlugin(pathGroups), viteMarkdownImport(), nodeDirnameShimPlugin()],
    resolve: { tsconfigPaths: true },
    ssr: {
      // Workspace packages publish TypeScript sources, so nothing may stay a
      // bare runtime import except the native/WASM packages linked above.
      // Subpath exports of those packages are held external by
      // `NODE_RUNTIME_EXTERNAL_PATTERNS` on `rollupOptions`.
      external: NODE_RUNTIME_PACKAGES.map(({ name }) => name),
      noExternal: true,
      target: 'node',
    },
  });

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
    define: productionRendererDefine,
    logLevel: 'warn',
    plugins: [workspacePathsPlugin(pathGroups)],
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

  const rendererPlugins = () => [
    // Order matters: the platform-variant resolver has to see a specifier
    // before the path resolver answers it, so it can look for the
    // `.desktop` / `.vite` sibling of whatever the path fallbacks pick.
    vitePlatformResolve('desktop'),
    workspacePathsPlugin(pathGroups),
    viteMarkdownImport(),
    viteNodeModuleStub(),
  ];

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
    define: productionRendererDefine,
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
      ...rendererPlugins(),
    ],
    resolve: {
      // The only data-chain substitution: the TRPC transport. Production
      // stores, actions, selectors, SWR hooks and services are all real.
      alias: [
        {
          find: '@/libs/trpc/client/lambda',
          replacement: path.resolve(electronRoot, 'production-app/workspaceRuntimeTrpcClient.ts'),
        },
        {
          find: '@/libs/trpc/client',
          replacement: path.resolve(electronRoot, 'production-app/workspaceRuntimeTrpcClient.ts'),
        },
      ],
      dedupe: ['react', 'react-dom'],
      tsconfigPaths: true,
    },
  });

  // ─── AC-M03: the same production model rows, compiled in development mode ──
  // The only difference from the bundle above is `sharedRendererDefine`'s dev
  // switches, so a label that changes with dev mode fails the comparison.
  await viteBuild({
    build: {
      emptyOutDir: false,
      lib: {
        entry: path.resolve(electronRoot, 'production-app/workspaceRuntimeDevModels.tsx'),
        fileName: () => 'workspaceRuntimeDevModels.js',
        formats: ['es'],
      },
      minify: false,
      outDir: artifactDirectory,
      sourcemap: false,
    },
    configFile: false,
    define: developmentRendererDefine,
    logLevel: 'warn',
    plugins: rendererPlugins(),
    resolve: { dedupe: ['react', 'react-dom'], tsconfigPaths: true },
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
