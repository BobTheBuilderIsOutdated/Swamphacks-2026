import { createRemoteJWKSet, jwtVerify } from 'jose';

export function authentication(config) {
  const issuer = `https://${config.authDomain}/`;
  const jwks = config.authDomain ? createRemoteJWKSet(new URL(`${issuer}.well-known/jwks.json`)) : null;
  return async (req, res, next) => {
    if (!jwks || !config.audience) return res.status(503).json({ error: 'Auth0 is not configured yet.' });
    const match = req.headers.authorization?.match(/^Bearer (\S+)$/);
    if (!match) return res.status(401).json({ error: 'Sign in to your Nudge account.' });
    try {
      const { payload } = await jwtVerify(match[1], jwks, { issuer, audience: config.audience, algorithms: ['RS256'] });
      if (typeof payload.sub !== 'string' || payload.sub.endsWith('@clients')) throw new Error('A user token is required.');
      req.subject = payload.sub;
      req.tokenIssuedAt = payload.iat;
      next();
    } catch { res.status(401).json({ error: 'Your session expired. Sign in again.' }); }
  };
}
