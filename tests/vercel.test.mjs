import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { configuration } from '../server/config.mjs';
import { fixture } from './fixtures.mjs';

test('Vercel cannot silently fall back to ephemeral local storage', () => {
  assert.throws(() => configuration({ VERCEL: '1', APP_URL: 'https://example.vercel.app' }), /DATABASE_URL/);
  assert.throws(() => configuration({ VERCEL: '1', DATABASE_URL: 'postgres://example' }), /HTTPS/);
});

test('serverless manual work completes before the API response', async t => {
  const f = await fixture({ serverless: true }); t.after(() => f.db.close()); await f.seed();
  await request(f.app).post('/api/run').set('x-test-user', 'user-a').expect(200);
  await request(f.app).post('/api/run').set('x-test-user', 'user-a').expect(200);
  assert.equal(f.sent.length, 1);
  assert.equal((await f.db.one('SELECT status FROM messages')).status, 'sent');
});
