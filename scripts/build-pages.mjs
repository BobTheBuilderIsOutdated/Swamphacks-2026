import './build.mjs';
import { mkdir, cp, readFile, writeFile } from 'node:fs/promises';
await mkdir('pages-dist', { recursive: true });
await cp('public', 'pages-dist', { recursive: true });
const html = (await readFile('web/index.html', 'utf8'))
  .replace('<head>', '<head><meta name="nudge-hosting" content="github-pages">')
  .replaceAll('href="/', 'href="./').replaceAll('src="/', 'src="./');
await writeFile('pages-dist/index.html', html);
await writeFile('pages-dist/.nojekyll', '');
console.log('Built GitHub Pages website. Backend features remain explicitly unconfigured.');
