import { build } from 'esbuild';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { ZipArchive } from 'archiver';
import { deflateSync } from 'node:zlib';
await mkdir('public/assets', { recursive: true }); await mkdir('extension/build', { recursive: true });
await build({ entryPoints: ['web/app.mjs'], outfile: 'public/assets/app.js', bundle: true, format: 'esm', target: 'es2022', minify: true });
await copyFile('public/assets/app.js', 'extension/build/app.js');
await copyFile('web/app.css', 'public/assets/app.css'); await copyFile('web/app.css', 'extension/build/app.css');
await copyFile('web/index.html', 'public/index.html');
await writeFile('public/favicon.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#2857e7"/><path d="M18 46L46 18M22 18h24v24" fill="none" stroke="white" stroke-width="6"/></svg>');
function crc32(buffer) { let crc = -1; for (const b of buffer) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ -1) >>> 0; }
function chunk(type, data) { const name = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4); length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data]))); return Buffer.concat([length, name, data, crc]); }
const width = 128, pixels = Buffer.alloc((width * 3 + 1) * width);
for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
  const offset = y * (width * 3 + 1) + 1 + x * 3;
  const arrow = (Math.abs(x + y - 127) < 6 && x > 28 && x < 99) || (y > 25 && y < 35 && x > 47 && x < 102) || (x > 93 && x < 103 && y > 25 && y < 80);
  pixels.set(arrow ? [255, 255, 255] : [40, 87, 231], offset);
}
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(width, 4); ihdr[8] = 8; ihdr[9] = 2;
await writeFile('extension/icon.png', Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]));
await new Promise((resolve, reject) => {
  const output = createWriteStream('public/nudge-extension.zip'), archive = new ZipArchive({ zlib: { level: 9 } });
  output.on('close', resolve); output.on('error', reject); archive.on('error', reject);
  archive.pipe(output); archive.directory('extension/', false); archive.finalize();
});
console.log('Built website and sideloadable Chrome extension.');
