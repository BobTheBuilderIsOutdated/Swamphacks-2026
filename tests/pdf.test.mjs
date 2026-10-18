import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extractDocument } from '../server/app.mjs';

test('PDF resume extracts text in Node without browser globals', async () => {
  assert.equal(globalThis.DOMMatrix, undefined);
  const buffer = await readFile(new URL('./documents/fictional-resume.pdf', import.meta.url));
  const result = await extractDocument({ originalname: 'resume.pdf', buffer });
  assert.match(result.text, /Alex Morgan/);
  assert.match(result.text, /2,000 synthetic survey records/);
  assert.match(result.text, /Python, pandas, JavaScript/);
});

test('invalid PDF is rejected before parsing', async () => {
  await assert.rejects(extractDocument({ originalname: 'resume.pdf', buffer: Buffer.from('not a pdf') }), /Invalid PDF/);
});
