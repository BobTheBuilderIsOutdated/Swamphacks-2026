export const DEFAULT_SERVER = 'https://nudge-alpha-mocha.vercel.app';

export function serverOrigin(value = DEFAULT_SERVER) {
  const url = new URL(value);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('Use HTTPS, or localhost for local development.');
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Enter only the server origin, without paths or credentials.');
  return url.origin;
}

export async function loadServerConfig(storage, request = fetch) {
  const { apiBase } = await storage.get('apiBase');
  const origin = serverOrigin(apiBase);
  const response = await request(`${origin}/api/config`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Nudge is temporarily unavailable. Please try again.');
  const config = await response.json();
  if (serverOrigin(config.appUrl) !== origin) throw new Error('Server APP_URL does not match the configured address.');
  return { ...config, appUrl: origin };
}
