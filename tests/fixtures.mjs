import { randomUUID } from 'node:crypto';
import { database } from '../server/db.mjs';
import { vault as createVault } from '../server/crypto.mjs';
import { engine as createEngine } from '../server/engine.mjs';
import { application } from '../server/app.mjs';
import { campaignSchema } from '../server/contracts.mjs';

export const profile = { name: 'Test Applicant', summary: 'Research student', education: ['University'], skills: ['Python'], experiences: ['Built a research tool.'], interests: ['Research'],
  evidence: [{ fact: 'Built a research tool.', document: 'resume.txt', quote: 'Built a research tool.' }], writingStyle: { tone: 'Direct', sentenceStyle: 'Short', greeting: 'Hello', closing: 'Thanks', avoid: [] } };
export const leadResearch = { name: 'Test Researcher', email: 'researcher@example.org', organization: 'Example Lab', title: 'PI', location: 'Gainesville', distanceMiles: 3, remote: false,
  fit: 'Python research', matchedSkills: ['Python'], angle: 'Research tools', contactSource: 'https://example.org/team', sources: [{ url: 'https://example.org/team', title: 'Example Lab', excerpt: 'We build research tools.' }] };
export const goal = campaignSchema.parse({ name: 'Test campaign', objective: 'Find a research position', role: 'research', sectors: 'Computer science', location: 'Gainesville', radiusMiles: 50, remote: false, mode: 'autonomous', positiveMode: 'continue' });

export async function fixture(overrides = {}) {
  const db = await database(null, 'memory://'), vault = createVault(Buffer.alloc(32, 7).toString('base64'));
  const config = { appUrl: 'http://localhost:3000', sendingEnabled: true, authDomain: 'example.auth0.com', clientId: 'client', audience: 'api', extensionClientId: 'native', extensionOrigins: ['chrome-extension://test'],
    encryptionKey: Buffer.alloc(32, 7).toString('base64'), geminiKey: 'fixture', googleClientId: 'fixture', googleSecret: 'fixture', cronSecret: 'test-secret', ...overrides };
  const sent = [], threadMessages = [], faults = { send: false }, stats = { drafts: 0, research: 0 };
  const ai = {
    profile: async () => profile,
    research: async () => { stats.research++; return { leads: [leadResearch], searchSummary: 'Test research', grounding: {} }; },
    draft: async () => { stats.drafts++; return { subject: 'Your research tools', body: 'Hello, I built a research tool and would like to discuss your work.', missingFacts: [], needsHuman: false, reason: '', usedProfileFacts: ['Built a research tool.'], usedSourceUrls: ['https://example.org/team'] }; },
    verify: async () => ({ supported: true, issues: [] }), verifyLead: async () => ({ eligible: true }),
    classify: async () => ({ intent: 'question', confidence: 0.95, summary: 'A question', nextStep: 'Respond' }),
  };
  const mail = {
    thread: async () => ({ messages: threadMessages }), label: async () => {}, revoke: async () => {},
    exchange: async () => ({ email: 'applicant@example.org', secrets: { refresh_token: 'fixture' } }),
    findSent: async (_subject, rfc) => sent.find(s => s.rfcId === rfc) || null,
    send: async (_subject, _lead, content, rfcId) => {
      const result = { id: `sent-${sent.length + 1}`, threadId: 'gmail-thread', rfcId };
      sent.push(result);
      threadMessages.push({ id: result.id, internalDate: String(Date.now()), labelIds: ['SENT'], payload: { mimeType: 'text/plain', body: { data: Buffer.from(content.body).toString('base64url') }, headers: [
        { name: 'From', value: 'applicant@example.org' }, { name: 'Subject', value: content.subject }, { name: 'Message-ID', value: rfcId },
      ] } });
      if (faults.send) throw new Error('Transport interrupted after provider accepted message.');
      return result;
    },
  };
  const scrape = async () => ({ emails: ['researcher@example.org'], text: 'Test Researcher. We build research tools.', title: 'Example Lab' });
  const engine = createEngine({ db, vault, ai, mail, scrape, config });
  const authenticate = (req, res, next) => { if (!req.headers['x-test-user']) return res.status(401).json({ error: 'Test identity required' }); req.subject = req.headers['x-test-user']; next(); };
  const app = application({ db, vault, ai, mail, engine, scrape, config, authenticate });
  async function seed(subject = 'user-a', settings = {}) {
    await db.query('INSERT INTO accounts(subject,profile,extension_seen_at) VALUES($1,$2,now()) ON CONFLICT(subject) DO NOTHING', [subject, vault.seal(profile, subject)]);
    await db.query('INSERT INTO mailboxes(subject,email,secrets) VALUES($1,$2,$3) ON CONFLICT(subject) DO NOTHING', [subject, `${subject}@example.org`, vault.seal({ refresh_token: 'fixture' }, subject)]);
    const id = randomUUID();
    await db.query("INSERT INTO campaigns(id,subject,goal,status,authorized_at) VALUES($1,$2,$3,'active',now())", [id, subject, JSON.stringify({ ...goal, ...settings })]);
    return id;
  }
  function inbound(body = 'Could you tell me more?', id = 'inbound-1') {
    threadMessages.push({ id, internalDate: String(Date.now() + 1000), labelIds: ['INBOX'], payload: { mimeType: 'text/plain', body: { data: Buffer.from(body).toString('base64url') }, headers: [
      { name: 'From', value: leadResearch.email }, { name: 'Subject', value: 'Your research tools' }, { name: 'Message-ID', value: `<${id}@example.org>` },
    ] } });
  }
  return { db, vault, config, sent, faults, stats, threadMessages, ai, mail, engine, app, seed, inbound };
}
