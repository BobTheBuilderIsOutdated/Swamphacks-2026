import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { fixture, goal } from './fixtures.mjs';
import { publicAddress, publicUrl } from '../server/web.mjs';
import { rawMessage } from '../server/gmail.mjs';
import { vault } from '../server/crypto.mjs';
import { authentication } from '../server/auth.mjs';

test('private addresses, metadata IPs, alternate schemes and credentials are blocked', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.1.1', '::1', '::ffff:127.0.0.1']) assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress('8.8.8.8'), true);
  for (const url of ['file:///etc/passwd', 'http://localhost/a', 'https://user:pass@example.com', 'http://127.1/', 'http://[::1]/']) assert.throws(() => publicUrl(url));
});
test('encrypted profile is bound to its owner and detects tampering', () => {
  const v = vault(Buffer.alloc(32, 9).toString('base64')), encrypted = v.seal({ private: 'style' }, 'a');
  assert.deepEqual(v.open(encrypted, 'a'), { private: 'style' }); assert.throws(() => v.open(encrypted, 'b'));
  const bytes = Buffer.from(encrypted, 'base64'); bytes[35] ^= 1; assert.throws(() => v.open(bytes.toString('base64'), 'a'));
});
test('MIME headers cannot inject extra recipients; unicode round-trips', () => {
  assert.throws(() => rawMessage({ from: 'a@example.org', to: 'b@example.org\r\nBcc: other@example.org', subject: 'hi', body: 'hello', rfcId: '<id@example.org>' }));
  const text = Buffer.from(rawMessage({ from: 'a@example.org', to: 'b@example.org', subject: 'Research', body: 'Hello — café', rfcId: '<id@example.org>', replyTo: '<reply@example.org>' }), 'base64url').toString();
  assert.match(text, /In-Reply-To: <reply@example.org>/); assert.match(text, /References: <reply@example.org>/);
  assert.equal(Buffer.from(text.split('\r\n\r\n')[1], 'base64').toString(), 'Hello — café');
});
test('API isolates accounts and never returns the private writing signature', async t => {
  const f = await fixture(); t.after(() => f.db.close()); const id = await f.seed(); await f.engine.tick();
  const a = await request(f.app).get('/api/dashboard').set('x-test-user', 'user-a'); assert.equal(a.status, 200);
  assert.equal(a.body.profile.writingStyle, undefined); assert.equal(a.body.profile.evidence, undefined);
  const b = await request(f.app).get('/api/dashboard').set('x-test-user', 'user-b'); assert.deepEqual(b.body.leads, []);
  const lead = await f.db.one('SELECT id FROM leads');
  assert.equal((await request(f.app).get(`/api/threads/${lead.id}`).set('x-test-user', 'user-b')).status, 404);
  assert.equal((await request(f.app).post(`/api/campaigns/${id}/control`).set('x-test-user', 'user-b').send({ action: 'activate', authorized: true })).status, 404);
  assert.equal((await request(f.app).get('/api/dashboard')).status, 401);
});
test('campaign activation requires explicit authorization; auto-authorize defaults off', async t => {
  const f = await fixture(); t.after(() => f.db.close()); await f.seed();
  const created = await request(f.app).post('/api/campaigns').set('x-test-user', 'user-a').send(goal);
  const id = created.body.id; assert.equal((await f.db.one('SELECT status FROM campaigns WHERE id=$1', [id])).status, 'paused');
  assert.equal((await request(f.app).post(`/api/campaigns/${id}/control`).set('x-test-user', 'user-a').send({ action: 'activate' })).status, 400);
  await request(f.app).post('/api/settings').set('x-test-user', 'user-a').send({ autoAuthorize: true, acknowledged: true }).expect(200);
  const next = await request(f.app).post('/api/campaigns').set('x-test-user', 'user-a').send(goal);
  assert.equal((await f.db.one('SELECT status FROM campaigns WHERE id=$1', [next.body.id])).status, 'active');
});
test('taking over a campaign from a thread pauses it and cancels unsent mail', async t => {
  const f = await fixture({ sendingEnabled: false }); t.after(() => f.db.close()); await f.seed(); await f.engine.tick(); await f.engine.tick();
  const lead = await f.db.one('SELECT id FROM leads');
  await request(f.app).post(`/api/threads/${lead.id}/control`).set('x-test-user', 'user-a').send({ status: 'handoff', pauseCampaign: true }).expect(200);
  assert.equal((await f.db.one('SELECT status FROM campaigns')).status, 'paused');
  assert.equal((await f.db.one('SELECT status FROM messages')).status, 'cancelled');
});
test('public config never exposes secret keys and missing Auth0 never bypasses authentication', async t => {
  const f = await fixture(); t.after(() => f.db.close());
  const response = await request(f.app).get('/api/config');
  assert.equal(response.body.geminiKey, undefined); assert.equal(response.body.googleSecret, undefined); assert.equal(response.body.encryptionKey, undefined);
  let status; await authentication({})({}, { status: n => { status = n; return { json: () => {} }; } }, () => assert.fail('Must not bypass auth'));
  assert.equal(status, 503);
});
