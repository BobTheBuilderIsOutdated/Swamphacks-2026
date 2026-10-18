export async function startAuthSession(Client, config, location, history) {
  // Construct synchronously: createAuth0Client awaits an iframe-based silent
  // session check, which can block rendering when cross-site cookies are blocked.
  const client = new Client({ domain: config.authDomain, clientId: config.clientId,
    authorizationParams: { audience: config.audience, redirect_uri: `${location.origin}/auth/callback`, scope: 'openid profile email' },
    cacheLocation: 'memory', authorizeTimeoutInSeconds: 10, httpTimeoutInSeconds: 15,
  });
  const params = new URLSearchParams(location.search);
  if (location.pathname === '/auth/callback' && (params.has('code') || params.has('error'))) {
    await client.handleRedirectCallback();
    history.replaceState({}, '', '/dashboard');
  }
  // After a full reload the memory cache is empty. Explicit sign-in uses Auth0's
  // existing session through a top-level redirect rather than hidden iframes.
  return client;
}
