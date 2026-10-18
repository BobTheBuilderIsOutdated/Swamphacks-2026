import { createAuth0Client } from '@auth0/auth0-spa-js';
import { readResponse } from './response.mjs';

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
    config = await readResponse(await fetch('/api/config'));
    if (config.readiness.auth0) {
      auth = await createAuth0Client({ domain: config.authDomain, clientId: config.clientId,
        authorizationParams: { audience: config.audience, redirect_uri: `${location.origin}/auth/callback`, scope: 'openid profile email' },
        cacheLocation: 'memory',
      });
      if (location.pathname === '/auth/callback' && location.search.includes('code=')) {
        await auth.handleRedirectCallback(); history.replaceState({}, '', '/dashboard');
      }
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
  if (extension) { await chrome.runtime.sendMessage({ type: 'logout' }); location.reload(); }
  else await auth.logout({ logoutParams: { returnTo: location.origin } });
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
