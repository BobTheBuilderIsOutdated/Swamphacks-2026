import test from 'node:test';
import assert from 'node:assert/strict';
import { intelligence } from '../server/ai.mjs';

test('provider failures give actionable errors without leaking provider bodies', async t => {
  for (const [status, expected] of [[400, /rejected/], [403, /denied/], [404, /model is unavailable/], [429, /quota/], [503, /temporarily unavailable/]]) {
    t.mock.method(globalThis, 'fetch', async () => new Response('private resume and key', { status }));
    await assert.rejects(intelligence({ geminiKey: 'secret', model: 'test' }).profile([]), error => {
      assert.equal(error.status, 502);
      assert.match(error.message, expected);
      assert.doesNotMatch(error.message, /private resume|secret/);
      return true;
    });
    t.mock.restoreAll();
  }
});
