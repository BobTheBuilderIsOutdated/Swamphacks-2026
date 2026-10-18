import { loadServerConfig } from './config.js';
const bytes = size => crypto.getRandomValues(new Uint8Array(size));
const b64 = value => btoa(String.fromCharCode(...value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
async function serverConfig() {
  return loadServerConfig(chrome.storage.local);
}
async function session() {
  const { auth } = await chrome.storage.session.get('auth');
  return auth && auth.expiresAt > Date.now() + 30000 ? auth : null;
}
async function login() {
  const config = await serverConfig();
  if (!config.extensionClientId || !config.authDomain) throw new Error('Extension sign-in is not enabled by the Nudge administrator yet. You can continue using the website.');
  const verifier = b64(bytes(32)), state = b64(bytes(32));
  const challenge = b64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const redirectUri = chrome.identity.getRedirectURL('auth0');
  const url = new URL(`https://${config.authDomain}/authorize`);
  url.search = new URLSearchParams({ response_type: 'code', client_id: config.extensionClientId,
    redirect_uri: redirectUri, audience: config.audience, scope: 'openid profile email',
    code_challenge: challenge, code_challenge_method: 'S256', state }).toString();
  const returned = new URL(await chrome.identity.launchWebAuthFlow({ url: url.href, interactive: true }));
  if (returned.origin + returned.pathname !== redirectUri || returned.searchParams.get('state') !== state || !returned.searchParams.get('code')) throw new Error('Sign-in response did not match this request.');
  const response = await fetch(`https://${config.authDomain}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'authorization_code', client_id: config.extensionClientId, code: returned.searchParams.get('code'), code_verifier: verifier, redirect_uri: redirectUri }) });
  if (!response.ok) throw new Error('Auth0 could not finish extension sign-in. Check callback and origin settings.');
  const tokens = await response.json();
  if (!tokens.access_token || !tokens.expires_in) throw new Error('Auth0 did not return a usable access token.');
  await chrome.storage.session.set({ auth: { token: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 }, notified: [] });
  try { await call('/extension/heartbeat', { method: 'POST' }); }
  catch (error) { await chrome.storage.session.remove('auth'); throw error; }
  await chrome.alarms.create('nudge-check', { periodInMinutes: 1 });
  return { ok: true };
}
async function call(route, { method = 'GET', body } = {}) {
  const auth = await session(); if (!auth) throw new Error('Sign in to Nudge again.');
  const config = await serverConfig();
  const response = await fetch(`${config.appUrl}/api${route}`, { method, headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Nudge request failed.'); return result;
}
async function notify() {
  if (!await session()) return;
  const data = await call('/dashboard');
  const { notified = [] } = await chrome.storage.session.get('notified');
  for (const event of data.events.filter(e => ['positive', 'sensitive', 'review_needed', 'send_uncertain'].includes(e.kind))) {
    if (notified.includes(event.id)) continue;
    await chrome.notifications.create(`nudge-${event.id}`, { type: 'basic', iconUrl: 'icon.png', title: event.kind === 'positive' ? 'A promising reply' : 'Nudge needs your attention', message: 'Open your Nudge conversations to see the next step.' });
    notified.push(event.id);
  }
  await chrome.storage.session.set({ notified: notified.slice(-1000) });
}
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'nudge-check') notify().catch(() => {}); });
chrome.notifications.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL('app.html') }));
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  (async () => {
    switch (message.type) {
      case 'config': return { config: await serverConfig() };
      case 'session': return { authenticated: Boolean(await session()) };
      case 'token': return { token: (await session())?.token || null };
      case 'login': return login();
      case 'logout': await chrome.storage.session.clear(); await chrome.alarms.clearAll(); return { ok: true };
      case 'dashboard': return call('/dashboard');
      case 'run': return call('/run', { method: 'POST' });
      case 'pause': return call(`/campaigns/${encodeURIComponent(message.id)}/control`, { method: 'POST', body: { action: 'pause' } });
      case 'source': return call('/research/page', { method: 'POST', body: { url: message.url, campaignId: message.campaignId, document: message.document } });
      default: throw new Error('Unknown extension action.');
    }
  })().then(sendResponse).catch(error => sendResponse({ error: error.message }));
  return true;
});
