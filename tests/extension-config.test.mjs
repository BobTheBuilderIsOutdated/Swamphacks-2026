import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { DEFAULT_SERVER, loadServerConfig, serverOrigin } from '../extension/config.js';

test('fresh install uses production without a settings step', async () => {
  const config = await loadServerConfig({ get: async () => ({}) }, async (url, options) => {
    assert.equal(url, `${DEFAULT_SERVER}/api/config`);
    assert.ok(options.signal);
    return Response.json({ appUrl: DEFAULT_SERVER, extensionClientId: 'public-id' });
  });
  assert.equal(config.extensionClientId, 'public-id');
});
test('custom installations retain their server; mismatched configuration is rejected', async () => {
  const storage = { get: async () => ({ apiBase: 'http://localhost:3000' }) };
  await assert.rejects(loadServerConfig(storage, async () => Response.json({ appUrl: DEFAULT_SERVER })), /does not match/);
  const result = await loadServerConfig(storage, async url => {
    assert.equal(url, 'http://localhost:3000/api/config');
    return Response.json({ appUrl: 'http://localhost:3000' });
  });
  assert.equal(result.appUrl, 'http://localhost:3000');
});
test('invalid server URLs cannot receive requests', () => {
  for (const url of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com?x=1']) assert.throws(() => serverOrigin(url));
});
test('manifest has production permission and the registered stable test identity', async () => {
  const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url)));
  assert.ok(manifest.host_permissions.includes(`${DEFAULT_SERVER}/*`));
  const id = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0,32).replace(/[0-9a-f]/g, c => String.fromCharCode(97 + parseInt(c,16)));
  assert.equal(id, 'akhpkkmdedkkpffmaacbogcickkflamp');
});
