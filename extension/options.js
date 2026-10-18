import { DEFAULT_SERVER, serverOrigin } from './config.js';
const { apiBase = DEFAULT_SERVER } = await chrome.storage.local.get('apiBase');
document.querySelector('#server').value = apiBase;
document.querySelector('#identity').textContent = `Extension origin: chrome-extension://${chrome.runtime.id} · Auth0 callback: ${chrome.identity.getRedirectURL('auth0')}`;
document.querySelector('#reset').onclick = async () => {
  await chrome.storage.local.remove('apiBase');
  await chrome.storage.session.clear();
  document.querySelector('#server').value = DEFAULT_SERVER;
  document.querySelector('#status').textContent = 'Connected to the standard Nudge server. Sign in from the extension.';
};
document.querySelector('#settings-form').onsubmit = async event => {
  event.preventDefault();
  try {
    const url = new URL(serverOrigin(document.querySelector('#server').value));
    const granted = await chrome.permissions.request({ origins: [`${url.origin}/*`] });
    if (!granted) throw new Error('Server permission was not granted.');
    await chrome.storage.local.set({ apiBase: url.origin }); await chrome.storage.session.clear();
    document.querySelector('#status').textContent = 'Saved. Sign in from the Nudge extension.';
  } catch (error) { document.querySelector('#status').textContent = error.message; }
};
