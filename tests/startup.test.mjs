import test from 'node:test';
import assert from 'node:assert/strict';
import { publicConfiguration } from '../server/config.mjs';
import handler from '../api/index.mjs';
import { readResponse } from '../web/response.mjs';

test('public configuration works before database setup and omits secrets', () => {
  const result = publicConfiguration({ VERCEL: '1', GEMINI_API_KEY: 'private-key', GOOGLE_CLIENT_SECRET: 'private-secret' });
  assert.equal(result.readiness.auth0, false);
  assert.equal(result.readiness.gemini, true);
  assert.doesNotMatch(JSON.stringify(result), /private-key|private-secret/);
});
test('Vercel public config does not initialize database or document parsers', async () => {
  const res = { headers: {}, setHeader(k,v) { this.headers[k] = v; }, end(body) { this.body = body; } };
  await handler({ method: 'GET', url: '/api/config' }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(JSON.parse(res.body).readiness);
  assert.equal(res.headers['Cache-Control'], 'no-store');
});
test('plain-text platform errors produce an actionable message', async () => {
  await assert.rejects(readResponse(new Response('A server error has occurred', { status: 500 })), /server is unavailable/);
  await assert.rejects(readResponse(Response.json({ error: 'Backend setup is incomplete' }, { status: 503 })), /Backend setup is incomplete/);
});
