import express from 'express';
import { identityManager } from './identity.mjs';
import multer from 'multer';
import mammoth from 'mammoth';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import path from 'node:path';
import { authentication } from './auth.mjs';
import { campaignSchema } from './contracts.mjs';
import { hash, token, equal } from './crypto.mjs';
import { readiness } from './config.mjs';
import { conversation } from './gmail.mjs';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 10, fieldSize: 500000 } });
const requireValue = (condition, message, status = 400) => { if (!condition) throw Object.assign(new Error(message), { status }); };

export async function extractDocument(file) {
  const name = path.basename(file.originalname).slice(0, 150);
  let text;
  if (/\.pdf$/i.test(name)) {
    requireValue(file.buffer.subarray(0, 5).toString() === '%PDF-', 'Invalid PDF file.');
    // Load native geometry explicitly before PDF.js evaluates its DOMMatrix usage.
    // Its optional, dynamic canvas require can be omitted by serverless tracing.
    const { DOMMatrix, ImageData, Path2D } = await import('@napi-rs/canvas');
    globalThis.DOMMatrix ??= DOMMatrix;
    globalThis.ImageData ??= ImageData;
    globalThis.Path2D ??= Path2D;
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(file.buffer) });
    try { text = (await parser.getText()).text; } finally { await parser.destroy(); }
  } else if (/\.docx$/i.test(name)) {
    text = (await mammoth.extractRawText({ buffer: file.buffer })).value;
  } else if (/\.(txt|md)$/i.test(name)) text = file.buffer.toString('utf8');
  else throw Object.assign(new Error('Upload PDF, DOCX, TXT, or Markdown documents.'), { status: 400 });
  requireValue(text.trim().length >= 30, `${name} has too little readable text. Scanned PDFs need OCR first.`);
  requireValue(text.length <= 200000, `${name} is too long. Upload a smaller document.`);
  return { name, text };
}

export function application({ db, vault, ai, mail, engine, scrape, config, identity = identityManager(config), authenticate = authentication(config) }) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.set('X-Frame-Options', 'DENY');
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    const origin = req.headers.origin;
    if (origin && (origin === config.appUrl || config.extensionOrigins.includes(origin))) {
      res.set('Access-Control-Allow-Origin', origin); res.vary('Origin');
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.get('/api/config', (_req, res) => res.json({
    appUrl: config.appUrl, authDomain: config.authDomain, clientId: config.clientId,
    extensionClientId: config.extensionClientId, audience: config.audience, readiness: readiness(config),
  }));
  app.get('/api/health', (_req, res) => res.json({ ok: true, workerRunning: engine.running }));
  const cron = async (req, res) => {
    requireValue(config.cronSecret && equal(req.headers.authorization, `Bearer ${config.cronSecret}`), 'Unauthorized scheduler.', 401);
    await engine.tick(); res.json({ ok: true });
  };
  app.post('/api/cron', cron);
  app.get('/api/cron', cron);

  app.get('/api/gmail/callback', async (req, res) => {
    const state = await db.one('DELETE FROM oauth_states WHERE digest=$1 AND expires_at>now() RETURNING subject', [hash(String(req.query.state || ''))]);
    requireValue(state, 'This Google connection request expired. Start again.', 400);
    requireValue(typeof req.query.code === 'string' && !req.query.error, 'Google access was not granted.');
    const connected = await mail.exchange(req.query.code);
    const existing = await db.one('SELECT email FROM mailboxes WHERE subject=$1', [state.subject]);
    // Switching mailboxes invalidates Gmail thread IDs; require explicit disconnection first.
    requireValue(!existing || existing.email.toLowerCase() === connected.email.toLowerCase(), 'Disconnect the current mailbox before connecting a different address.');
    await db.query(`INSERT INTO mailboxes(subject,email,secrets) VALUES($1,$2,$3)
      ON CONFLICT(subject) DO UPDATE SET email=excluded.email,secrets=excluded.secrets,updated_at=now()`,
    [state.subject, connected.email.toLowerCase(), vault.seal(connected.secrets, state.subject)]);
    await db.event(state.subject, 'mailbox_connected');
    res.redirect('/dashboard?connected=gmail');
  });

  app.use('/api', authenticate, async (req, _res, next) => {
    const deleted = await db.one('SELECT digest FROM deleted_identities WHERE digest=$1', [hash(req.subject)]);
    requireValue(!deleted || (req.method === 'DELETE' && req.path === '/account/data'), 'This Nudge account has been deleted. Sign out.', 401);
    if (deleted) return next();
    await db.query('INSERT INTO accounts(subject) VALUES($1) ON CONFLICT(subject) DO NOTHING', [req.subject]);
    next();
  });
  const rates = new Map();
  app.use('/api', (req, res, next) => {
    const now = Date.now();
    for (const [key, value] of rates) if (value.until < now) rates.delete(key);
    const key = `${req.subject}:${req.path === '/api/profile' ? 'profile' : 'api'}`;
    const value = rates.get(key) || { n: 0, until: now + 60000 }; value.n++; rates.set(key, value);
    if (value.n > (key.endsWith(':profile') ? 6 : 120)) return res.status(429).json({ error: 'Too many requests. Please try again in a minute.' });
    next();
  });

  app.get('/api/dashboard', async (req, res) => {
    const account = await db.one('SELECT * FROM accounts WHERE subject=$1', [req.subject]);
    const full = vault.open(account.profile, req.subject);
    const profile = full ? { name: full.name, summary: full.summary, skills: full.skills, experiences: full.experiences, education: full.education } : null;
    const [campaigns, leads, pending, events, mailbox, sent] = await Promise.all([
      db.query('SELECT * FROM campaigns WHERE subject=$1 ORDER BY created_at DESC', [req.subject]),
      db.query('SELECT * FROM leads WHERE subject=$1 ORDER BY created_at DESC', [req.subject]),
      db.query("SELECT id,lead_id,status,created_at FROM messages WHERE subject=$1 AND status IN ('review','needs_input','uncertain') ORDER BY created_at", [req.subject]),
      db.query('SELECT * FROM events WHERE subject=$1 ORDER BY created_at DESC LIMIT 100', [req.subject]),
      db.one('SELECT email FROM mailboxes WHERE subject=$1', [req.subject]),
      db.one("SELECT count(*)::int AS n FROM messages WHERE subject=$1 AND status='sent'", [req.subject]),
    ]);
    res.json({ profile, campaigns: campaigns.rows, leads: leads.rows, pending: pending.rows, events: events.rows,
      mailbox: mailbox?.email || null, extensionConnected: Boolean(account.extension_seen_at), autoAuthorize: account.auto_authorize, sent: sent.n, readiness: readiness(config) });
  });
  app.post('/api/settings', async (req, res) => {
    const body = z.object({ autoAuthorize: z.boolean(), acknowledged: z.boolean() }).parse(req.body);
    requireValue(body.acknowledged, 'Confirm the automation setting.');
    await db.query('UPDATE accounts SET auto_authorize=$2 WHERE subject=$1', [req.subject, body.autoAuthorize]);
    await db.event(req.subject, 'authorization_preference', { autoAuthorize: body.autoAuthorize });
    res.json({ ok: true });
  });
  app.post('/api/profile', upload.array('documents'), async (req, res) => {
    requireValue(req.files?.length, 'Upload your résumé or supporting documents.');
    const documents = await Promise.all(req.files.map(extractDocument));
    if (req.body.writingSample?.trim()) documents.push({ name: 'User-provided writing sample', text: req.body.writingSample.slice(0, 50000) });
    const account = await db.one('SELECT profile FROM accounts WHERE subject=$1', [req.subject]);
    const extracted = await ai.profile(documents, vault.open(account.profile, req.subject));
    await db.query('UPDATE accounts SET profile=$2 WHERE subject=$1', [req.subject, vault.seal(extracted, req.subject)]);
    // Raw upload bytes and writing samples are never persisted.
    await db.event(req.subject, 'profile_updated', { documents: documents.map(d => d.name) });
    res.json({ ok: true, skills: extracted.skills });
  });
  app.post('/api/extension/heartbeat', async (req, res) => {
    requireValue(config.extensionOrigins.includes(req.headers.origin), 'Register this extension origin on the server.', 403);
    await db.query('UPDATE accounts SET extension_seen_at=now() WHERE subject=$1', [req.subject]);
    res.json({ ok: true });
  });
  app.post('/api/profile/learn-style', async (req, res) => {
    requireValue(req.body.authorized === true, 'Authorize temporary analysis of sent mail first.');
    const account = await db.one('SELECT profile FROM accounts WHERE subject=$1', [req.subject]);
    const profile = vault.open(account.profile, req.subject);
    requireValue(profile, 'Upload your résumé first.');
    let count = 0;
    // Message text stays in process memory; only a synthesized style is retained.
    for await (const sample of mail.sentSamples(req.subject)) {
      profile.writingStyle = await ai.style(profile.writingStyle, sample); count++;
    }
    await db.query('UPDATE accounts SET profile=$2 WHERE subject=$1', [req.subject, vault.seal(profile, req.subject)]);
    await db.event(req.subject, 'writing_style_learned', { messageCount: count });
    res.json({ ok: true, count });
  });
  app.post('/api/gmail/connect', async (req, res) => {
    requireValue(readiness(config).gmail && readiness(config).encryption, 'Configure Google OAuth and encryption first.', 503);
    const state = token();
    await db.query('DELETE FROM oauth_states WHERE expires_at<now()');
    await db.query("INSERT INTO oauth_states(digest,subject,expires_at) VALUES($1,$2,now()+interval '10 minutes')", [hash(state), req.subject]);
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({ client_id: config.googleClientId, redirect_uri: `${config.appUrl}/api/gmail/callback`,
      response_type: 'code', scope: 'https://www.googleapis.com/auth/gmail.modify', access_type: 'offline', prompt: 'consent', state }).toString();
    res.json({ url: url.href });
  });
  app.delete('/api/gmail', async (req, res) => {
    await db.query("UPDATE campaigns SET status='paused' WHERE subject=$1", [req.subject]);
    await mail.revoke(req.subject);
    await db.query('DELETE FROM mailboxes WHERE subject=$1', [req.subject]);
    await db.query("UPDATE leads SET status='handoff' WHERE subject=$1 AND status IN ('active','positive')", [req.subject]);
    await db.event(req.subject, 'mailbox_disconnected');
    res.json({ ok: true });
  });
  app.post('/api/campaigns', async (req, res) => {
    const goal = campaignSchema.parse(req.body), id = randomUUID();
    if (goal.target) { goal.mode = 'review'; goal.positiveMode = 'handoff'; goal.dailyLimit = 1; }
    await db.query('INSERT INTO campaigns(id,subject,goal) VALUES($1,$2,$3)', [id, req.subject, JSON.stringify(goal)]);
    const account = await db.one('SELECT * FROM accounts WHERE subject=$1', [req.subject]);
    const ready = readiness(config);
    if (!goal.target && account.auto_authorize && account.profile && account.extension_seen_at && ready.gemini && ready.encryption &&
        await db.one('SELECT subject FROM mailboxes WHERE subject=$1', [req.subject])) {
      await db.query("UPDATE campaigns SET status='active',authorized_at=now() WHERE id=$1", [id]);
      await db.event(req.subject, 'campaign_auto_authorized', {}, null, id);
    }
    await db.event(req.subject, 'campaign_created', {}, null, id);
    res.json({ id });
  });
  app.post('/api/campaigns/:id/control', async (req, res) => {
    const campaign = await db.one('SELECT * FROM campaigns WHERE id=$1 AND subject=$2', [req.params.id, req.subject]);
    requireValue(campaign, 'Campaign not found.', 404);
    const body = z.object({ action: z.enum(['activate', 'pause']), authorized: z.boolean().optional() }).parse(req.body);
    if (body.action === 'activate') {
      const account = await db.one('SELECT * FROM accounts WHERE subject=$1', [req.subject]);
      requireValue(body.authorized === true, 'Explicit campaign authorization is required.');
      requireValue(account.profile && account.extension_seen_at, 'Upload your résumé and connect the extension first.');
      requireValue(await db.one('SELECT subject FROM mailboxes WHERE subject=$1', [req.subject]), 'Connect Gmail first.');
      requireValue(readiness(config).gemini && readiness(config).encryption, 'Configure Gemini and encryption first.', 503);
      await db.query("UPDATE campaigns SET status='active',authorized_at=now() WHERE id=$1", [campaign.id]);
    } else await db.query("UPDATE campaigns SET status='paused' WHERE id=$1", [campaign.id]);
    await db.event(req.subject, `campaign_${body.action}`, { mode: campaign.goal.mode }, null, campaign.id);
    res.json({ ok: true });
  });
  app.post('/api/run', async (req, res) => {
    if (config.serverless) {
      const completed = await engine.tick(req.subject);
      return res.json({ ok: true, completed });
    }
    engine.tick(req.subject).catch(error => console.error('Worker failed:', error.name));
    res.status(202).json({ ok: true });
  });
  app.get('/api/threads/:id', async (req, res) => {
    const lead = await db.one('SELECT * FROM leads WHERE id=$1 AND subject=$2', [req.params.id, req.subject]);
    requireValue(lead, 'Thread not found.', 404);
    const messages = (await db.query('SELECT * FROM messages WHERE lead_id=$1 AND subject=$2 ORDER BY created_at', [lead.id, req.subject])).rows;
    let history = [], mailboxError = null;
    if (lead.thread_id) {
      try { history = conversation(await mail.thread(req.subject, lead.thread_id)); }
      catch { mailboxError = 'Gmail is unavailable. Reconnect to load message bodies.'; }
    }
    const events = (await db.query('SELECT * FROM events WHERE lead_id=$1 AND subject=$2 ORDER BY created_at', [lead.id, req.subject])).rows;
    res.json({ lead, history, mailboxError, events, drafts: messages.map(m => ({ id: m.id, status: m.status,
      created_at: m.created_at, content: vault.open(m.content, req.subject) })) });
  });
  app.post('/api/threads/:id/control', async (req, res) => {
    const lead = await db.one('SELECT * FROM leads WHERE id=$1 AND subject=$2', [req.params.id, req.subject]);
    requireValue(lead, 'Thread not found.', 404);
    const status = z.enum(['active', 'handoff', 'closed']).parse(req.body.status);
    if (req.body.pauseCampaign === true) {
      await db.query("UPDATE campaigns SET status='paused' WHERE id=$1 AND subject=$2", [lead.campaign_id, req.subject]);
      await db.event(req.subject, 'campaign_taken_over', {}, lead.id, lead.campaign_id);
    }
    requireValue(!['unsubscribed', 'bounced'].includes(lead.status), 'This recipient is suppressed and cannot be reactivated.');
    await db.query('UPDATE leads SET status=$2 WHERE id=$1', [lead.id, status]);
    if (status === 'active') await db.query('UPDATE leads SET last_inbound_id=NULL,resume_requested=true WHERE id=$1', [lead.id]);
    if (status !== 'active') await db.query("UPDATE messages SET status='cancelled',content=NULL WHERE lead_id=$1 AND status IN ('review','ready','approved','needs_input')", [lead.id]);
    await db.event(req.subject, status === 'handoff' ? 'user_took_over' : 'thread_status', { status }, lead.id, lead.campaign_id);
    if (lead.thread_id) { try { await mail.label(req.subject, lead.thread_id, status); } catch {} }
    res.json({ ok: true });
  });
  app.post('/api/threads/:id/reply', async (req, res) => {
    const body = z.object({ body: z.string().trim().min(1).max(10000), requestId: z.string().uuid(), confirmed: z.literal(true) }).parse(req.body);
    requireValue(await db.one('SELECT id FROM leads WHERE id=$1 AND subject=$2', [req.params.id, req.subject]), 'Thread not found.', 404);
    res.json(await engine.manualReply(req.subject, req.params.id, body));
  });
  app.post('/api/messages/:id/approve', async (req, res) => {
    const message = await db.one('SELECT * FROM messages WHERE id=$1 AND subject=$2', [req.params.id, req.subject]);
    requireValue(message && ['review', 'needs_input'].includes(message.status), 'This draft is not available for approval.', 409);
    const body = z.object({ subject: z.string().min(1).max(180), body: z.string().min(1).max(10000) }).parse(req.body);
    requireValue(!/[\r\n]/.test(body.subject) && !/\[[^\]]+\]|\{\{[^}]+\}\}/.test(body.body), 'Resolve placeholders and invalid headers before approval.');
    const content = vault.open(message.content, req.subject);
    const lead = await db.one('SELECT * FROM leads WHERE id=$1 AND subject=$2', [message.lead_id, req.subject]);
    requireValue(lead && ['active', 'positive'].includes(lead.status), 'Resume this thread before approving a message.');
    await db.query("UPDATE messages SET content=$2,status='approved',updated_at=now() WHERE id=$1", [message.id,
      vault.seal({ ...content, ...body, ...(lead.thread_id ? { subject: content.subject } : {}), missingFacts: [], problems: [], needsHuman: false }, req.subject)]);
    await db.event(req.subject, 'draft_approved', {}, message.lead_id, lead.campaign_id);
    res.json({ ok: true });
  });
  app.post('/api/research/page', async (req, res) => {
    const body = z.object({ url: z.string().url(), campaignId: z.string().uuid(), document: z.string().max(60000).optional() }).parse(req.body);
    const campaign = await db.one('SELECT id FROM campaigns WHERE id=$1 AND subject=$2', [body.campaignId, req.subject]);
    requireValue(campaign, 'Campaign not found.', 404);
    const page = await scrape(body.url);
    // Public-page evidence is queued for the next research pass, not silently treated as user instructions.
    await db.event(req.subject, 'research_source_added', { url: page.url, title: page.title, excerpt: page.text.slice(0, 10000) }, null, campaign.id);
    await db.query('UPDATE campaigns SET researched_at=NULL WHERE id=$1', [campaign.id]);
    res.json({ ok: true });
  });
  app.delete('/api/account/data', async (req, res) => {
    requireValue(req.body.confirm === 'DELETE', 'Type DELETE to remove your Nudge data.');
    const removeIdentity = await identity.prepare();
    const completed = await db.exclusive(async () => {
      await db.query("UPDATE campaigns SET status='paused' WHERE subject=$1", [req.subject]);
      await mail.revoke(req.subject);
      await removeIdentity(req.subject);
      await db.query('INSERT INTO deleted_identities(digest) VALUES($1) ON CONFLICT DO NOTHING', [hash(req.subject)]);
      await db.query('DELETE FROM accounts WHERE subject=$1', [req.subject]);
    });
    requireValue(completed, 'A worker is finishing. Retry account deletion shortly.', 409);
    res.json({ ok: true });
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API route.' }));
  app.use(express.static('public', { etag: true }));
  app.get(['/dashboard', '/auth/callback'], (_req, res) => res.sendFile(path.resolve('public/index.html')));
  app.use((error, req, res, _next) => {
    const status = error instanceof z.ZodError || error instanceof multer.MulterError ? 400 : error.status || 500;
    if (status === 500) console.error('Request failed:', req.path, error.name);
    res.status(status).json({ error: error instanceof z.ZodError ? 'Check the required fields and limits.' : status === 500 ? 'The request could not finish. Check provider configuration and try again.' : error.message });
  });
  return app;
}
