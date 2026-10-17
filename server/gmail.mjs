import { load } from 'cheerio';

export function header(message, name) {
  return message.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}
export function address(value) {
  return (value.match(/<?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>?/i)?.[1] || '').toLowerCase();
}
export function textBody(payload) {
  if (payload.mimeType === 'text/plain' && payload.body?.data) return Buffer.from(payload.body.data, 'base64url').toString('utf8');
  const plain = (payload.parts || []).map(textBody).filter(Boolean);
  if (plain.length) return plain.join('\n');
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    const $ = load(Buffer.from(payload.body.data, 'base64url').toString('utf8'));
    $('script,style').remove(); return $.text();
  }
  return '';
}
export function conversation(thread) {
  return (thread.messages || []).map(m => ({
    id: m.id, rfcId: header(m, 'Message-ID'), from: address(header(m, 'From')), to: header(m, 'To'),
    subject: header(m, 'Subject'), date: Number(m.internalDate), auto: header(m, 'Auto-Submitted'),
    body: textBody(m.payload || {}).slice(0, 40000), sent: (m.labelIds || []).includes('SENT'),
  })).sort((a, b) => a.date - b.date);
}
export function rawMessage({ from, to, subject, body, rfcId, replyTo }) {
  for (const v of [from, to, subject, rfcId, replyTo || '']) if (/[\r\n]/.test(v)) throw new Error('Invalid email header.');
  if (address(from) !== from.toLowerCase() || address(to) !== to.toLowerCase()) throw new Error('Invalid sender or recipient.');
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`;
  const lines = [`From: ${from}`, `To: ${to}`, `Subject: ${encodedSubject}`, `Message-ID: ${rfcId}`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64'];
  if (replyTo) lines.push(`In-Reply-To: ${replyTo}`, `References: ${replyTo}`);
  lines.push('', Buffer.from(body).toString('base64').match(/.{1,76}/g)?.join('\r\n') || '');
  return Buffer.from(lines.join('\r\n')).toString('base64url');
}

export function gmail(config, db, vault) {
  async function access(subject) {
    const mailbox = await db.one('SELECT * FROM mailboxes WHERE subject=$1', [subject]);
    if (!mailbox) throw new Error('Connect Gmail before starting outreach.');
    const secrets = vault.open(mailbox.secrets, subject);
    if (secrets.expiresAt > Date.now() + 60000) return { token: secrets.access_token, email: mailbox.email };
    const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
      body: new URLSearchParams({ client_id: config.googleClientId, client_secret: config.googleSecret,
        refresh_token: secrets.refresh_token, grant_type: 'refresh_token' }), signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('Gmail connection expired or was revoked. Reconnect Gmail.');
    const fresh = await response.json();
    await db.query('UPDATE mailboxes SET secrets=$2,updated_at=now() WHERE subject=$1', [subject,
      vault.seal({ ...secrets, ...fresh, expiresAt: Date.now() + fresh.expires_in * 1000 }, subject)]);
    return { token: fresh.access_token, email: mailbox.email };
  }
  async function request(subject, path, options = {}) {
    const auth = await access(subject);
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
      ...options, headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Gmail request failed (${response.status}).`);
    return response.status === 204 ? {} : response.json();
  }
  return {
    async exchange(code) {
      const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({
        code, client_id: config.googleClientId, client_secret: config.googleSecret, redirect_uri: `${config.appUrl}/api/gmail/callback`, grant_type: 'authorization_code',
      }), signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('Google authorization could not be completed.');
      const tokens = await response.json();
      const granted = (tokens.scope || '').split(' ');
      if (!granted.includes('https://www.googleapis.com/auth/gmail.modify')) throw new Error('Gmail read/send/label permission was not granted.');
      if (!tokens.refresh_token) throw new Error('Google did not grant offline access. Reconnect and approve access.');
      const profile = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(20000) });
      if (!profile.ok) throw new Error('Could not verify the Gmail account.');
      return { email: (await profile.json()).emailAddress, secrets: { ...tokens, expiresAt: Date.now() + tokens.expires_in * 1000 } };
    },
    thread: (subject, id) => request(subject, `threads/${encodeURIComponent(id)}?format=full`),
    async existingThread(subject, email) {
      const result = await request(subject, `messages?maxResults=1&q=${encodeURIComponent(`in:sent to:${email}`)}`);
      return result.messages?.[0]?.threadId || null;
    },
    async *sentSamples(subject) {
      let pageToken;
      do {
        const params = new URLSearchParams({ q: 'in:sent newer_than:30d', maxResults: '100' });
        if (pageToken) params.set('pageToken', pageToken);
        const page = await request(subject, `messages?${params}`);
        for (const item of page.messages || []) {
          const message = await request(subject, `messages/${encodeURIComponent(item.id)}?format=full`);
          const text = textBody(message.payload || {}).split(/\nOn .+wrote:|\nFrom:/)[0].trim();
          if (text) yield text.slice(0, 20000);
        }
        pageToken = page.nextPageToken;
      } while (pageToken);
    },
    async findSent(subject, rfcId) {
      const result = await request(subject, `messages?q=${encodeURIComponent(`in:sent rfc822msgid:${rfcId}`)}`);
      return result.messages?.[0] || null;
    },
    async send(subject, lead, content, rfcId) {
      const auth = await access(subject);
      return request(subject, 'messages/send', { method: 'POST', body: JSON.stringify({
        raw: rawMessage({ from: auth.email, to: lead.email, ...content, rfcId }),
        ...(lead.thread_id ? { threadId: lead.thread_id } : {}),
      }) });
    },
    async label(subject, threadId, state) {
      const names = ['Nudge', 'Nudge/Positive', 'Nudge/Handoff'];
      const existing = await request(subject, 'labels');
      const ids = {};
      for (const name of names) {
        let label = existing.labels.find(l => l.name === name);
        if (!label) label = await request(subject, 'labels', { method: 'POST', body: JSON.stringify({ name, labelListVisibility: 'labelShow', messageListVisibility: 'show' }) });
        ids[name] = label.id;
      }
      const selected = state === 'positive' ? 'Nudge/Positive' : state === 'handoff' ? 'Nudge/Handoff' : 'Nudge';
      await request(subject, `threads/${encodeURIComponent(threadId)}/modify`, { method: 'POST', body: JSON.stringify({
        addLabelIds: [...new Set([ids.Nudge, ids[selected]])], removeLabelIds: names.filter(n => n !== 'Nudge' && n !== selected).map(n => ids[n]),
      }) });
    },
    async revoke(subject) {
      const box = await db.one('SELECT secrets FROM mailboxes WHERE subject=$1', [subject]);
      if (!box) return;
      const secrets = vault.open(box.secrets, subject);
      const response = await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST',
        body: new URLSearchParams({ token: secrets.refresh_token }), signal: AbortSignal.timeout(20000) });
      if (!response.ok && response.status !== 400) throw new Error('Google token revocation failed. Try again.');
    },
  };
}
