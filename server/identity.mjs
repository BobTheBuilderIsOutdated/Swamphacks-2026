// Management credentials stay server-side; the caller supplies only the verified JWT subject.
export function identityManager(config, fetcher = fetch) {
  const fail = message => Object.assign(new Error(message), { status: 503 });
  return {
    async prepare() {
      if (!config.managementClientId || !config.managementSecret || !/^[a-zA-Z0-9.-]+$/.test(config.authDomain))
        throw fail('Account deletion needs Auth0 Management API configuration. Ask the server owner to configure it. No account data was deleted.');
      const base = `https://${config.authDomain}`;
      const response = await fetcher(`${base}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000), body: JSON.stringify({ grant_type: 'client_credentials', client_id: config.managementClientId, client_secret: config.managementSecret, audience: `${base}/api/v2/`, scope: 'delete:users' }) });
      if (!response.ok) throw fail('Auth0 account deletion is unavailable. Check the Management API credentials and delete:users permission.');
      const { access_token } = await response.json();
      if (!access_token) throw fail('Auth0 did not authorize account deletion.');
      return async subject => {
        const deleted = await fetcher(`${base}/api/v2/users/${encodeURIComponent(subject)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(15000) });
        if (!deleted.ok && deleted.status !== 404) throw fail('Auth0 deletion did not finish. Your campaigns are paused; retry deletion.');
      };
    },
  };
}
