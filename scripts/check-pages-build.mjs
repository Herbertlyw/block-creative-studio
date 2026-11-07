import { access, readFile, readdir } from 'node:fs/promises';

const distDirectory = new URL('../dist/', import.meta.url);
const expectedBase = process.env.PAGES_BASE_PATH ?? '/block-creative-studio/';
const normalizedBase = expectedBase.endsWith('/') ? expectedBase : `${expectedBase}/`;
const indexHtml = await readFile(new URL('index.html', distDirectory), 'utf8');
const documentAssetUrls = [...indexHtml.matchAll(/(?:src|href)="([^"]+)"/gu)].map((match) => match[1]);

if (documentAssetUrls.length === 0) {
  throw new Error('Pages artifact validation found no script or stylesheet URLs in dist/index.html.');
}

const invalidDocumentUrls = documentAssetUrls.filter((url) => url?.startsWith('/') && !url.startsWith(normalizedBase));
if (invalidDocumentUrls.length > 0) {
  throw new Error(`Pages artifact contains URLs outside ${normalizedBase}: ${invalidDocumentUrls.join(', ')}`);
}

const assetsDirectory = new URL('assets/', distDirectory);
const topLevelAssets = await readdir(assetsDirectory);
const cssFiles = topLevelAssets.filter((name) => name.endsWith('.css'));
for (const cssFile of cssFiles) {
  const css = await readFile(new URL(cssFile, assetsDirectory), 'utf8');
  if (/url\((?:"|')?\/assets\//u.test(css)) {
    throw new Error(`Pages stylesheet ${cssFile} contains a root-relative /assets/ URL.`);
  }
}

await access(new URL('assets/taptile/classic-tile-surface-v1.png', distDirectory));
await access(new URL('assets/taptile/reference-hand-pointer-v1.svg', distDirectory));
const chainComboFaceDirectory = new URL('assets/taptile/faces/chain-combo-ui/', distDirectory);
const chainComboFaceFiles = (await readdir(chainComboFaceDirectory)).filter((name) => name.endsWith('.png'));
if (chainComboFaceFiles.length !== 14) {
  throw new Error(`Pages artifact must contain all 14 chain-combo face PNGs; found ${chainComboFaceFiles.length}.`);
}
console.log(`✓ Pages artifact uses ${normalizedBase} and contains the TapTile texture, pointer, and 14 chain-combo face assets`);
