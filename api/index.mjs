import { configuration, publicConfiguration } from '../server/config.mjs';
let pending;
export default async function handler(req, res) {
  // Reuse initialization within an instance, but retry after a transient startup failure.
  try {
    if (req.method === 'GET' && new URL(req.url, 'http://localhost').pathname === '/api/config') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      return res.end(JSON.stringify(publicConfiguration()));
    }
    pending ??= (async () => {
      const config = configuration();
      const { runtime } = await import('../server/runtime.mjs');
      return runtime(config);
    })().catch(error => { pending = undefined; throw error; });
    const { app } = await pending;
    return app(req, res);
  } catch {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: 'Backend setup is incomplete or the database is unavailable. Check the server environment variables.' }));
  }
}
