import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { build as viteBuild } from 'vite';

const supportDirectory = path.dirname(fileURLToPath(import.meta.url));
const electronRoot = path.resolve(supportDirectory, '..');
const repositoryRoot = path.resolve(electronRoot, '../..');
const artifactDirectory = path.resolve(electronRoot, '.artifacts');

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
        { find: '@/utils', replacement: path.resolve(repositoryRoot, 'packages/utils/src') },
        { find: '@', replacement: path.resolve(repositoryRoot, 'src') },
      ],
      dedupe: ['react', 'react-dom'],
      tsconfigPaths: true,
    },
  });

  await viteBuild({
    build: {
      emptyOutDir: false,
      lib: {
        entry: path.resolve(
          repositoryRoot,
          'apps/desktop/src/main/core/executionContext/ExecutionContextManager.ts',
        ),
        fileName: () => 'ExecutionContextManager.mjs',
        formats: ['es'],
      },
      minify: false,
      outDir: artifactDirectory,
      rollupOptions: { external: [/^node:/] },
      sourcemap: false,
    },
    configFile: false,
    logLevel: 'warn',
    resolve: { tsconfigPaths: true },
  });
};
