import { randomUUID } from 'node:crypto';
import { conversation } from './gmail.mjs';
import { draftProblems, matchesTarget } from './contracts.mjs';

const activeLead = status => ['active', 'positive'].includes(status);
const elapsedDays = date => (Date.now() - new Date(date).getTime()) / 86400000;

export function engine({ db, vault, ai, mail, scrape, config }) {
  let running = false;
  const event = (campaign, kind, detail = {}, lead = null) => db.event(campaign.subject, kind, detail, lead?.id, campaign.id);

  async function confirmSent(message, lead, sent) {
    // Both transitions are one database statement. An interrupted send remains reconcilable.
    await db.query(`WITH committed AS (
      UPDATE messages SET status='sent',provider_id=$2,content=NULL,updated_at=now() WHERE id=$1 RETURNING id
    ) UPDATE leads SET thread_id=$3,last_sent_at=now(),followups=followups+$4 WHERE id=$5 AND EXISTS(SELECT 1 FROM committed)`,
    [message.id, sent.id, sent.threadId, message.trigger_key.startsWith('followup:') ? 1 : 0, lead.id]);
    await db.event(lead.subject, 'sent', { messageId: sent.id }, lead.id, lead.campaign_id);
    try { await mail.label(lead.subject, sent.threadId, lead.status); }
    catch { await db.event(lead.subject, 'label_pending', {}, lead.id, lead.campaign_id); }
  }

  async function reconcile(campaign) {
    const pending = await db.query(`SELECT m.* FROM messages m JOIN leads l ON l.id=m.lead_id
      WHERE l.campaign_id=$1 AND m.status IN ('sending','uncertain')`, [campaign.id]);
    for (const message of pending.rows) {
      const lead = await db.one('SELECT * FROM leads WHERE id=$1', [message.lead_id]);
      const sent = await mail.findSent(campaign.subject, message.rfc_id);
      if (sent) await confirmSent(message, lead, sent);
      else if (message.status === 'sending') {
        await db.query("UPDATE messages SET status='uncertain',updated_at=now() WHERE id=$1", [message.id]);
        await event(campaign, 'send_uncertain', { instruction: 'Check Gmail. This message will not be retried automatically.' }, lead);
      }
    }
  }

  async function plan(campaign, lead, profile, history, key, purpose) {
    if (await db.one("SELECT id FROM messages WHERE subject=$1 AND lead_id=$2 AND trigger_key=$3 AND status<>'cancelled'", [campaign.subject, lead.id, key])) return;
    const unresolved = await db.one("SELECT id FROM messages WHERE lead_id=$1 AND status IN ('sending','uncertain')", [lead.id]);
    if (unresolved) return;
    const draft = await ai.draft(profile, lead.research, campaign.goal, history, purpose);
    const problems = draftProblems(draft, profile, lead.research);
    if (history.length) draft.subject = history[0].subject;
    const verification = await ai.verify(draft, profile, lead.research, history);
    if (!verification.supported) problems.push(...verification.issues);
    const content = { ...draft, problems, replyTo: history.at(-1)?.rfcId || null };
    const id = randomUUID(), status = problems.length ? 'needs_input' : campaign.goal.mode === 'autonomous' ? 'ready' : 'review';
    await db.query(`INSERT INTO messages(id,subject,lead_id,trigger_key,rfc_id,content,status) VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT(subject,lead_id,trigger_key) DO UPDATE SET content=excluded.content,status=excluded.status,updated_at=now() WHERE messages.status='cancelled'`, [id, campaign.subject, lead.id, key,
      `<nudge.${id}@${new URL(config.appUrl).hostname}>`, vault.seal(content, campaign.subject), status]);
    await event(campaign, status === 'ready' ? 'personalized' : 'review_needed', { reason: problems.join(' ') }, lead);
  }

  async function processLead(campaign, lead, profile) {
    if (!activeLead(lead.status)) return;
    let history = [];
    if (lead.thread_id) {
      history = conversation(await mail.thread(campaign.subject, lead.thread_id));
      const latest = history.at(-1);
      if (latest && !latest.sent && latest.id !== lead.last_inbound_id) {
        await db.query("UPDATE messages SET status='cancelled',content=NULL WHERE lead_id=$1 AND status IN ('ready','review','approved','needs_input')", [lead.id]);
        let classification;
        if (latest.from !== lead.email) classification = { intent: 'sensitive', confidence: 1, summary: 'A different sender joined the thread.', nextStep: 'Review sender identity.' };
        else if (/\b(unsubscribe|remove me|stop (emailing|contacting)|do not (email|contact))\b/i.test(latest.body)) classification = { intent: 'unsubscribe', confidence: 1, summary: 'Recipient requested no further contact.', nextStep: 'Stop.' };
        else if (latest.auto && latest.auto !== 'no') classification = { intent: 'out_of_office', confidence: 1, summary: 'Automatic response.', nextStep: 'Wait.' };
        else classification = await ai.classify(history);
        let status = lead.status;
        if (classification.confidence < 0.8 || classification.intent === 'sensitive') status = 'handoff';
        else if (classification.intent === 'unsubscribe') status = 'unsubscribed';
        else if (classification.intent === 'bounce') status = 'bounced';
        else if (classification.intent === 'rejected') status = 'closed';
        else if (classification.intent === 'positive') status = campaign.goal.positiveMode === 'continue' || lead.resume_requested ? 'positive' : 'handoff';
        await db.query('UPDATE leads SET status=$2 WHERE id=$1', [lead.id, status]);
        lead.status = status;
        if (activeLead(status) && classification.intent !== 'out_of_office') {
          await plan(campaign, lead, profile, history, `reply:${latest.id}`, 'Respond meaningfully to the latest reply and advance the applicant’s goal.');
        }
        await db.query('UPDATE leads SET last_inbound_id=$2,resume_requested=false WHERE id=$1', [lead.id, latest.id]);
        await event(campaign, classification.intent, { summary: classification.summary, nextStep: classification.nextStep }, lead);
        if (['positive', 'handoff'].includes(status)) {
          try { await mail.label(campaign.subject, lead.thread_id, status); } catch { await event(campaign, 'label_pending', {}, lead); }
        }
        return;
      }
      if (!latest || !latest.sent) return;
      if (lead.followups < campaign.goal.maxFollowups && elapsedDays(lead.last_sent_at) >= campaign.goal.followupDays) {
        await plan(campaign, lead, profile, history, `followup:${lead.followups + 1}`, 'Write a new, considerate follow-up that adds useful context; do not repeat the previous email.');
      }
    } else {
      const priorThread = await mail.existingThread?.(campaign.subject, lead.email);
      if (priorThread) {
        await db.query("UPDATE leads SET thread_id=$2,status='handoff' WHERE id=$1", [lead.id, priorThread]);
        await event(campaign, 'existing_conversation', { summary: 'You have already contacted this person. Review the existing conversation before resuming.' }, lead);
        return;
      }
      await plan(campaign, lead, profile, history, 'initial', 'Introduce the applicant to this person with a specific, well-researched reason to connect.');
    }
  }

  async function sendReady(campaign) {
    if (!config.sendingEnabled) return;
    const ready = await db.query(`SELECT m.* FROM messages m JOIN leads l ON l.id=m.lead_id
      WHERE l.campaign_id=$1 AND m.status IN ('ready','approved') ORDER BY m.created_at`, [campaign.id]);
    for (const message of ready.rows) {
      const current = await db.one('SELECT * FROM campaigns WHERE id=$1', [campaign.id]);
      const lead = await db.one('SELECT * FROM leads WHERE id=$1', [message.lead_id]);
      if (current.status !== 'active' || !current.authorized_at || !activeLead(lead.status)) continue;
      if (current.goal.mode !== 'autonomous' && message.status !== 'approved') continue;
      const count = await db.one(`SELECT count(*)::int AS n FROM messages WHERE subject=$1
        AND status IN ('sent','sending','uncertain') AND updated_at >= date_trunc('day',now())`, [campaign.subject]);
      if (count.n >= current.goal.dailyLimit) break;
      const content = vault.open(message.content, campaign.subject);
      if (!content || content.missingFacts?.length || /\[[^\]]+\]|\{\{[^}]+\}\}/.test(content.body)) continue;
      const changed = await db.query("UPDATE messages SET status='sending',updated_at=now() WHERE id=$1 AND status IN ('ready','approved') RETURNING id", [message.id]);
      if (!changed.rows.length) continue;
      try {
        const sent = await mail.send(campaign.subject, lead, { subject: content.subject, body: content.body, replyTo: content.replyTo }, message.rfc_id);
        await confirmSent(message, lead, sent);
      } catch {
        // Never retry an ambiguous provider request: it may already have delivered.
        await db.query("UPDATE messages SET status='uncertain',updated_at=now() WHERE id=$1 AND status='sending'", [message.id]);
        await event(campaign, 'send_uncertain', { instruction: 'Gmail may have accepted this message. Nudge will check sent mail before any next step.' }, lead);
      }
    }
  }

  async function discover(campaign, profile) {
    if (campaign.researched_at && Date.now() - new Date(campaign.researched_at).getTime() < 30 * 60000) return;
    if (campaign.goal.target && await db.one('SELECT id FROM leads WHERE campaign_id=$1', [campaign.id])) return;
    const existing = (await db.query('SELECT email FROM leads WHERE subject=$1', [campaign.subject])).rows.map(r => r.email);
    const seedSources = (await db.query("SELECT detail FROM events WHERE campaign_id=$1 AND kind='research_source_added' ORDER BY created_at", [campaign.id])).rows.map(r => r.detail);
    if (campaign.goal.target) {
      const page = await scrape(campaign.goal.target.sourceUrl);
      seedSources.push({ url: page.url, title: page.title, excerpt: page.text.slice(0, 10000) });
    }
    const research = await ai.research(profile, campaign.goal, campaign.cursor, existing, seedSources);
    for (const candidate of research.leads) {
      if (!matchesTarget(candidate, campaign.goal.target)) continue;
      if (!campaign.goal.target && !(campaign.goal.remote && candidate.remote) && (candidate.distanceMiles === null || candidate.distanceMiles > campaign.goal.radiusMiles)) continue;
      if (existing.includes(candidate.email.toLowerCase())) continue;
      try {
        const contact = await scrape(candidate.contactSource);
        if (!contact.emails.includes(candidate.email.toLowerCase())) continue;
        const sources = [];
        // Every cited source is fetched; there is no hard-coded total source limit.
        for (const source of candidate.sources) {
          const page = source.url === candidate.contactSource ? contact : await scrape(source.url);
          if (!source.excerpt.trim() || !page.text.toLowerCase().includes(source.excerpt.toLowerCase().replace(/\s+/g, ' '))) continue;
          sources.push({ url: source.url, title: page.title, excerpt: source.excerpt });
        }
        if (!sources.length) continue;
        if (!(await ai.verifyLead({ ...candidate, sources }, campaign.goal, contact.text)).eligible) continue;
        const id = randomUUID();
        const result = await db.query(`INSERT INTO leads(id,subject,campaign_id,email,research) VALUES($1,$2,$3,$4,$5)
          ON CONFLICT(subject,email) DO NOTHING RETURNING id`, [id, campaign.subject, campaign.id, candidate.email.toLowerCase(), JSON.stringify({ ...candidate, sources, verifiedAt: new Date().toISOString() })]);
        if (result.rows.length) {
          await event(campaign, 'lead_researched', { name: candidate.name, organization: candidate.organization }, { id });
          if (campaign.goal.target) break;
        }
      } catch {
        await event(campaign, 'source_unavailable', { url: candidate.contactSource });
      }
    }
    await db.query('UPDATE campaigns SET cursor=cursor+1,researched_at=now() WHERE id=$1', [campaign.id]);
    // Search grounding is retained as source metadata, not rendered as trusted HTML.
    await event(campaign, 'research_completed', { summary: research.searchSummary, grounding: research.grounding });
  }

  return {
    get running() { return running; },
    async manualReply(subject, leadId, input) {
      let result;
      const acquired = await db.exclusive(async () => {
        if (!config.sendingEnabled) throw new Error('Live sending is disabled on this server.');
        const lead = await db.one('SELECT * FROM leads WHERE id=$1 AND subject=$2', [leadId, subject]);
        if (!lead?.thread_id || ['unsubscribed', 'bounced'].includes(lead.status)) throw new Error('This conversation is unavailable for a reply.');
        const previous = await db.one('SELECT id,status FROM messages WHERE lead_id=$1 AND trigger_key=$2', [leadId, `manual:${input.requestId}`]);
        if (previous) { result = previous; return; }
        if (await db.one("SELECT id FROM messages WHERE lead_id=$1 AND status IN ('sending','uncertain')", [leadId])) throw new Error('Resolve the uncertain delivery before sending another message.');
        const history = conversation(await mail.thread(subject, lead.thread_id));
        if (!history.length) throw new Error('Could not load the conversation from Gmail.');
        const id = randomUUID(), rfcId = `<nudge.${id}@${new URL(config.appUrl).hostname}>`;
        const content = { subject: history[0].subject, body: input.body, replyTo: history.at(-1).rfcId };
        await db.query("UPDATE leads SET status='handoff' WHERE id=$1", [leadId]);
        await db.query("UPDATE messages SET status='cancelled',content=NULL WHERE lead_id=$1 AND status IN ('ready','approved','review','needs_input')", [leadId]);
        await db.query("INSERT INTO messages(id,subject,lead_id,trigger_key,rfc_id,content,status) VALUES($1,$2,$3,$4,$5,$6,'sending')", [id, subject, leadId, `manual:${input.requestId}`, rfcId, vault.seal(content, subject)]);
        const message = { id, trigger_key: `manual:${input.requestId}` };
        try {
          await confirmSent(message, { ...lead, status: 'handoff' }, await mail.send(subject, lead, content, rfcId));
          result = { id, status: 'sent' };
        } catch {
          await db.query("UPDATE messages SET status='uncertain' WHERE id=$1 AND status='sending'", [id]);
          result = { id, status: 'uncertain' };
        }
      });
      if (!acquired) throw new Error('The worker is processing a campaign. Please try your reply again shortly.');
      return result;
    },
    async tick(subject = null) {
      return db.exclusive(async () => {
        running = true;
        try {
          const unsettled = await db.query(`SELECT DISTINCT c.* FROM campaigns c JOIN leads l ON l.campaign_id=c.id JOIN messages m ON m.lead_id=l.id WHERE m.status IN ('sending','uncertain') ${subject ? 'AND c.subject=$1' : ''}`, subject ? [subject] : []);
          for (const c of unsettled.rows) { try { await reconcile(c); } catch { /* Retry reconciliation, never delivery, on the next pass. */ } }
          const campaigns = await db.query(`SELECT * FROM campaigns WHERE status='active' ${subject ? 'AND subject=$1' : ''} ORDER BY created_at`, subject ? [subject] : []);
          for (const campaign of campaigns.rows) {
            try {
              const account = await db.one('SELECT * FROM accounts WHERE subject=$1', [campaign.subject]);
              const profile = vault.open(account.profile, campaign.subject);
              if (!profile || !account.extension_seen_at || !campaign.authorized_at) continue;
              if (!await db.one('SELECT subject FROM mailboxes WHERE subject=$1', [campaign.subject])) continue;
              const leads = await db.query('SELECT * FROM leads WHERE campaign_id=$1 ORDER BY created_at', [campaign.id]);
              for (const lead of leads.rows) {
                try { await processLead(campaign, lead, profile); }
                catch (error) { await event(campaign, 'attention', { message: error.message }, lead); }
              }
              await sendReady(campaign);
              await discover(campaign, profile);
            } catch (error) { await event(campaign, 'attention', { message: error.message }); }
          }
        } finally { running = false; }
      });
    },
  };
}
