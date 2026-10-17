const { apiBase = 'http://localhost:3000' } = await chrome.storage.local.get('apiBase');
document.querySelector('#server').value = apiBase;
document.querySelector('#identity').textContent = `Extension origin: chrome-extension://${chrome.runtime.id} · Auth0 callback: ${chrome.identity.getRedirectURL('auth0')}`;
document.querySelector('#settings-form').onsubmit = async event => {
  event.preventDefault();
  try {
    const url = new URL(document.querySelector('#server').value);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('Use HTTPS, or localhost for local development.');
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Enter only the server origin, without paths or credentials.');
    const granted = await chrome.permissions.request({ origins: [`${url.origin}/*`] });
    if (!granted) throw new Error('Server permission was not granted.');
    await chrome.storage.local.set({ apiBase: url.origin }); await chrome.storage.session.clear();
    document.querySelector('#status').textContent = 'Saved. Sign in from the Nudge extension.';
  } catch (error) { document.querySelector('#status').textContent = error.message; }
};
