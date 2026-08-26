import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const supportDirectory = path.dirname(fileURLToPath(import.meta.url));
const electronRoot = path.resolve(supportDirectory, '..');
const repositoryRoot = path.resolve(electronRoot, '../..');
const artifactDirectory = path.resolve(electronRoot, '.artifacts');

const transpile = async (sourceName) => {
  const sourcePath = path.resolve(
    repositoryRoot,
    'src/store/chat/agents/toolCallLifecycle',
    `${sourceName}.ts`,
  );
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

  await writeFile(path.resolve(artifactDirectory, `${sourceName}.mjs`), output.outputText, 'utf8');
};

export const buildProductionLifecycle = async () => {
  await mkdir(artifactDirectory, { recursive: true });
  await Promise.all([transpile('ToolCallLifecycle'), transpile('retryPolicy')]);
};
