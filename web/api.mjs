import { Auth0Client } from '@auth0/auth0-spa-js';
import { readResponse } from './response.mjs';
import { startAuthSession } from './auth-session.mjs';

export const extension = Boolean(globalThis.chrome?.runtime?.id);
let auth, config;
export async function initialize() {
  if (document.querySelector('meta[name="nudge-hosting"]')?.content === 'github-pages') {
    config = { hosting: 'github-pages', appUrl: new URL('.', location.href).href.replace(/\/$/, ''), readiness: { auth0: false, encryption: false, gemini: false, gmail: false, sending: false } };
    return config;
  }
  if (extension) {
    const result = await chrome.runtime.sendMessage({ type: 'config' });
    if (result.error) throw new Error(result.error);
    config = result.config;
  } else {
    config = await readResponse(await fetch('/api/config', { signal: AbortSignal.timeout(15000) }));
    if (config.readiness.auth0) {
      auth = await startAuthSession(Auth0Client, config, location, history);
    }
  }
  return config;
}
export async function signedIn() {
  if (extension) return (await chrome.runtime.sendMessage({ type: 'session' })).authenticated;
  return Boolean(auth && await auth.isAuthenticated());
}
export async function login() {
  if (extension) {
    const result = await chrome.runtime.sendMessage({ type: 'login' });
    if (result.error) throw new Error(result.error);
    return;
  }
  if (!auth) throw new Error('Auth0 needs to be configured before sign-in works.');
  await auth.loginWithRedirect();
}
export async function logout() {
  sessionStorage.setItem('nudge-signed-out', '1');
  try {
    if (extension) { await chrome.runtime.sendMessage({ type: 'logout' }); location.reload(); }
    else await auth.logout({ logoutParams: { returnTo: location.origin } });
  } catch (error) { sessionStorage.removeItem('nudge-signed-out'); throw error; }
}
export async function api(route, { method = 'GET', body } = {}) {
  const token = extension ? (await chrome.runtime.sendMessage({ type: 'token' })).token : await auth.getTokenSilently();
  if (!token) throw new Error('Sign in again to continue.');
  const isForm = body instanceof FormData;
  const response = await fetch(`${extension ? config.appUrl : ''}/api${route}`, {
    method, headers: { Authorization: `Bearer ${token}`, ...(!isForm && body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: isForm ? body : JSON.stringify(body) } : {}),
  });
  return readResponse(response);
}
