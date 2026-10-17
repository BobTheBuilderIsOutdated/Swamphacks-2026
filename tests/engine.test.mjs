import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixtures.mjs';

test('daily budget holds replies until the next sending day', async t => {
  const f = await fixture(); t.after(() => f.db.close()); await f.seed('user-a', { dailyLimit: 1 });
  await f.engine.tick(); await f.engine.tick(); f.inbound(); await f.engine.tick();
  assert.equal(f.sent.length, 1);
  assert.equal((await f.db.one("SELECT status FROM messages WHERE trigger_key='reply:inbound-1'")).status, 'ready');
  await f.db.query("UPDATE messages SET updated_at=now()-interval '2 days' WHERE status='sent'");
  await f.engine.tick(); assert.equal(f.sent.length, 2);
});
test('follow-ups respect their delay and maximum unanswered count', async t => {
  const f = await fixture(); t.after(() => f.db.close()); await f.seed('user-a', { followupDays: 2, maxFollowups: 1 });
  await f.engine.tick(); await f.engine.tick(); await f.engine.tick(); assert.equal(f.sent.length, 1);
  await f.db.query("UPDATE leads SET last_sent_at=now()-interval '3 days'");
  await f.engine.tick(); assert.equal(f.sent.length, 2);
  await f.db.query("UPDATE leads SET last_sent_at=now()-interval '3 days'");
  await f.engine.tick(); assert.equal(f.sent.length, 2);
});
test('explicit resume can respond after a positive handoff', async t => {
  const f = await fixture(); t.after(() => f.db.close()); await f.seed('user-a', { positiveMode: 'handoff' });
  await f.engine.tick(); await f.engine.tick();
  f.ai.classify = async () => ({ intent: 'positive', confidence: 0.99, summary: 'Interested', nextStep: 'Respond' });
  f.inbound('I am interested.'); await f.engine.tick(); assert.equal(f.sent.length, 1);
  await f.db.query("UPDATE leads SET status='active',last_inbound_id=NULL,resume_requested=true");
  await f.engine.tick(); assert.equal(f.sent.length, 2);
  assert.equal((await f.db.one('SELECT resume_requested FROM leads')).resume_requested, false);
});

test('discovers real-source candidates, sends once, clears body, and does not duplicate on another tick', async t => {
  const f = await fixture(); t.after(() => f.db.close()); await f.seed();
  await f.engine.tick(); assert.equal(f.sent.length, 0);
  await f.engine.tick(); assert.equal(f.sent.length, 1);
  assert.equal((await f.db.one('SELECT content FROM messages')).content, null);
  await f.engine.tick(); assert.equal(f.sent.length, 1);
});
test('review mode holds mail until approved', async t => {
  const f = await fixture(); t.after(() => f.db.close()); await f.seed('user-a', { mode: 'review' });
  await f.engine.tick(); await f.engine.tick(); assert.equal(f.sent.length, 0);
  assert.equal((await f.db.one('SELECT status FROM messages')).status, 'review');
  await f.db.query("UPDATE messages SET status='approved'"); await f.engine.tick(); assert.equal(f.sent.length, 1);
});
test('sending kill switch prevents delivery and pause prevents work', async t => {
  const f = await fixture({ sendingEnabled: false }); t.after(() => f.db.close()); await f.seed();
  await f.engine.tick(); await f.engine.tick(); assert.equal(f.sent.length, 0);
  await f.db.query("UPDATE campaigns SET status='paused'"); f.config.sendingEnabled = true;
  await f.engine.tick(); assert.equal(f.sent.length, 0);
});
test('a send accepted before timeout is reconciled, never repeated', async t => {
  const f = await fixture(); t.after(() => f.db.close()); await f.seed(); f.faults.send = true;
  await f.engine.tick(); await f.engine.tick(); assert.equal(f.sent.length, 1);
  assert.equal((await f.db.one('SELECT status FROM messages')).status, 'uncertain');
  await f.engine.tick(); assert.equal(f.sent.length, 1);
  assert.equal((await f.db.one('SELECT status FROM messages')).status, 'sent');
});
test('unresolved ambiguous send is never retried', async t => {
  const f = await fixture(); t.after(() => f.db.close()); await f.seed(); f.faults.send = true; f.mail.findSent = async () => null;
  await f.engine.tick(); await f.engine.tick(); await f.engine.tick(); await f.engine.tick();
  assert.equal(f.sent.length, 1); assert.equal((await f.db.one('SELECT status FROM messages')).status, 'uncertain');
});
test('incoming questions generate original replies in the same thread', async t => {
  const f = await fixture(); t.after(() => f.db.close()); await f.seed();
  await f.engine.tick(); await f.engine.tick(); f.inbound(); await f.engine.tick();
  assert.equal(f.sent.length, 2); assert.equal(f.stats.drafts, 2);
  assert.equal((await f.db.one('SELECT last_inbound_id FROM leads')).last_inbound_id, 'inbound-1');
});
test('unsubscribe wins over the model and stops all future outreach', async t => {
  const f = await fixture(); t.after(() => f.db.close()); await f.seed();
  await f.engine.tick(); await f.engine.tick(); f.inbound('Please stop contacting me.'); await f.engine.tick(); await f.engine.tick();
  assert.equal(f.sent.length, 1); assert.equal((await f.db.one('SELECT status FROM leads')).status, 'unsubscribed');
});
test('positive handoff and unsupported draft claims do not send autonomously', async t => {
  const f = await fixture(); t.after(() => f.db.close()); await f.seed('user-a', { positiveMode: 'handoff' });
  await f.engine.tick(); await f.engine.tick();
  f.ai.classify = async () => ({ intent: 'positive', confidence: 0.98, summary: 'Interested', nextStep: 'Schedule' });
  f.inbound('I am interested.'); await f.engine.tick();
  assert.equal((await f.db.one('SELECT status FROM leads')).status, 'handoff'); assert.equal(f.sent.length, 1);
});
test('independent claim audit holds unsupported drafts', async t => {
  const f = await fixture(); t.after(() => f.db.close()); await f.seed();
  f.ai.verify = async () => ({ supported: false, issues: ['Invented experience'] });
  await f.engine.tick(); await f.engine.tick();
  assert.equal(f.sent.length, 0); assert.equal((await f.db.one('SELECT status FROM messages')).status, 'needs_input');
});
test('concurrent workers cannot send the same queued email twice', async t => {
  const f = await fixture(); t.after(() => f.db.close()); await f.seed(); await f.engine.tick();
  await Promise.all([f.engine.tick(), f.engine.tick(), f.engine.tick()]); assert.equal(f.sent.length, 1);
});
test('manual takeover reply is idempotent and reconciles while paused', async t => {
  const f = await fixture(); t.after(() => f.db.close()); await f.seed(); await f.engine.tick(); await f.engine.tick();
  const lead = await f.db.one('SELECT id FROM leads'); await f.db.query("UPDATE campaigns SET status='paused'");
  f.faults.send = true;
  const input = { body: 'Thank you. I will follow up personally.', requestId: 'manual-test' };
  await f.engine.manualReply('user-a', lead.id, input); await f.engine.manualReply('user-a', lead.id, input);
  assert.equal(f.sent.length, 2); await f.engine.tick();
  assert.equal((await f.db.one("SELECT count(*)::int AS n FROM messages WHERE status='sent'")).n, 2);
  assert.equal((await f.db.one('SELECT status FROM leads')).status, 'handoff');
});
