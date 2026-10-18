import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { configuration } from '../server/config.mjs';
import { fixture } from './fixtures.mjs';

test('Neon direct connection takes precedence over its pooled URL', () => {
  const env = { VERCEL: '1', APP_URL: 'https://example.vercel.app', DATABASE_URL_UNPOOLED: 'postgres://direct', DATABASE_URL: 'postgres://pooled' };
  assert.equal(configuration(env).databaseUrl, 'postgres://direct');
  delete env.DATABASE_URL;
  assert.equal(configuration(env).databaseUrl, 'postgres://direct');
  delete env.DATABASE_URL_UNPOOLED;
  env.DATABASE_URL = 'postgres://custom-direct';
  assert.equal(configuration(env).databaseUrl, 'postgres://custom-direct');
});

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
