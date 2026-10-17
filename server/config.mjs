export function configuration(env = process.env) {
  const production = env.NODE_ENV === 'production' || env.VERCEL === '1';
  const appUrl = (env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  if (production && !appUrl.startsWith('https://')) throw new Error('Production APP_URL must use HTTPS.');
  if (production && !env.DATABASE_URL) throw new Error('Production requires DATABASE_URL.');
  return {
    production, serverless: env.VERCEL === '1', appUrl, port: Number(env.PORT || 3000), databaseUrl: env.DATABASE_URL,
    authDomain: env.AUTH0_DOMAIN || '', clientId: env.AUTH0_CLIENT_ID || '',
    extensionClientId: env.AUTH0_EXTENSION_CLIENT_ID || '', audience: env.AUTH0_AUDIENCE || '',
    extensionOrigins: (env.EXTENSION_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean),
    encryptionKey: env.DATA_ENCRYPTION_KEY || '', geminiKey: env.GEMINI_API_KEY || '',
    model: env.GEMINI_MODEL || 'gemini-3.8-flash', googleClientId: env.GOOGLE_CLIENT_ID || '',
    googleSecret: env.GOOGLE_CLIENT_SECRET || '', sendingEnabled: env.EMAIL_SENDING_ENABLED === 'true',
    workerEnabled: env.WORKER_ENABLED !== 'false', workerInterval: Math.max(15, Number(env.WORKER_INTERVAL_SECONDS || 60)),
    cronSecret: env.CRON_SECRET || '',
  };
}

export function readiness(config) {
  return {
    auth0: Boolean(config.authDomain && config.clientId && config.audience),
    encryption: Buffer.from(config.encryptionKey, 'base64').length === 32,
    gemini: Boolean(config.geminiKey), gmail: Boolean(config.googleClientId && config.googleSecret),
    sending: config.sendingEnabled,
  };
}
