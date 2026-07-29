#!/usr/bin/env node
/**
 * Generate the macOS tray template icon set from the Masterino IP artwork.
 *
 * Template images contain black pixels plus alpha only; macOS recolors them
 * automatically for the active menu-bar theme.
 *
 * Run: node apps/desktop/scripts/generate-tray-template.mjs
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(__dirname, '..', 'build', 'masterino-icon-small.png');
const outDir = path.resolve(__dirname, '..', 'resources');

const detailAlpha = (luminance, originalAlpha) => {
  const detail = 255 - luminance;
  const normalized =
    detail <= 10 ? 0 : detail >= 48 ? 255 : Math.round(((detail - 10) * 255) / 38);

  return Math.round((originalAlpha * normalized) / 255);
};

async function render(size, outFile) {
  const contentSize = Math.max(1, Math.round(size * 0.82));
  const horizontalPadding = size - contentSize;
  const verticalPadding = size - contentSize;
  const { data, info } = await sharp(source)
    .resize(contentSize, contentSize, {
      background: { alpha: 0, b: 0, g: 0, r: 0 },
      fit: 'contain',
    })
    .extend({
      background: { alpha: 0, b: 0, g: 0, r: 0 },
      bottom: verticalPadding - Math.floor(verticalPadding / 2),
      left: Math.floor(horizontalPadding / 2),
      right: horizontalPadding - Math.floor(horizontalPadding / 2),
      top: Math.floor(verticalPadding / 2),
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const output = Buffer.alloc(size * size * 4);

  for (let index = 0; index < size * size; index += 1) {
    const offset = index * info.channels;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const alpha = data[offset + 3];
    const luminance = Math.round(red * 0.299 + green * 0.587 + blue * 0.114);
    const outputOffset = index * 4;

    output[outputOffset] = 0;
    output[outputOffset + 1] = 0;
    output[outputOffset + 2] = 0;
    output[outputOffset + 3] = detailAlpha(luminance, alpha);
  }

  await sharp(output, { raw: { channels: 4, height: size, width: size } })
    .png()
    .toFile(outFile);
  console.log(`wrote ${path.relative(process.cwd(), outFile)} (${size}x${size})`);
}

async function main() {
  await mkdir(outDir, { recursive: true });
  await render(18, path.join(outDir, 'trayTemplate.png'));
  await render(36, path.join(outDir, 'trayTemplate@2x.png'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
