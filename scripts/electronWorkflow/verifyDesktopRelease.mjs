import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((arg) => arg.split('='))
    .filter(([key, value]) => key?.startsWith('--') && value),
);

const releaseDir = path.resolve(args['--release-dir'] || 'release');
const version = args['--version'];
const channel = args['--channel'];

if (!version || !channel) {
  throw new Error(
    'Usage: node verifyDesktopRelease.mjs --release-dir=release --version=1.1.2 --channel=canary',
  );
}

const manifests = [`${channel}.yml`, `${channel}-mac.yml`];
const verifiedFiles = new Set();

const unquote = (value) => value.trim().replaceAll(/^['"]|['"]$/g, '');

for (const manifestName of manifests) {
  const manifestPath = path.join(releaseDir, manifestName);
  if (!fs.existsSync(manifestPath)) throw new Error(`Missing manifest: ${manifestName}`);

  const content = fs.readFileSync(manifestPath, 'utf8');
  const lines = content.split(/\r?\n/);
  const manifestUrls = new Set();
  const versionLine = lines.find((line) => line.startsWith('version:'));
  const manifestVersion = unquote(versionLine?.slice('version:'.length) || '');
  if (manifestVersion !== version) {
    throw new Error(
      `${manifestName} has version ${manifestVersion || '(missing)'}, expected ${version}`,
    );
  }

  for (let index = 0; index < lines.length; index++) {
    const currentLine = lines[index].trim();
    if (!currentLine.startsWith('- url:')) continue;

    const url = unquote(currentLine.slice('- url:'.length));
    if (manifestUrls.has(url)) {
      throw new Error(`${manifestName} contains a duplicate URL: ${url}`);
    }
    manifestUrls.add(url);

    if (!url.startsWith(`${version}/`)) {
      throw new Error(`${manifestName} contains a non-versioned URL: ${url}`);
    }

    let sha512;
    let size;
    for (let cursor = index + 1; cursor < lines.length; cursor++) {
      const propertyLine = lines[cursor].trim();
      if (propertyLine.startsWith('- url:')) break;
      if (!sha512 && propertyLine.startsWith('sha512:')) {
        sha512 = propertyLine.slice('sha512:'.length);
      }
      if (!size && propertyLine.startsWith('size:')) {
        size = propertyLine.slice('size:'.length);
      }
      if (sha512 && size) break;
    }

    const fileName = path.basename(url);
    const filePath = path.join(releaseDir, fileName);
    if (!fs.existsSync(filePath)) throw new Error(`${manifestName} references missing ${fileName}`);

    const file = fs.readFileSync(filePath);
    const actualSha512 = createHash('sha512').update(file).digest('base64');
    if (unquote(sha512 || '') !== actualSha512) {
      throw new Error(`${manifestName} has an invalid SHA512 for ${fileName}`);
    }
    if (Number(size) !== file.byteLength) {
      throw new Error(`${manifestName} has an invalid size for ${fileName}`);
    }

    verifiedFiles.add(fileName);
  }
}

if (verifiedFiles.size === 0) throw new Error('No release files were referenced by the manifests');

console.info(`Verified ${verifiedFiles.size} release files across ${manifests.join(', ')}`);
