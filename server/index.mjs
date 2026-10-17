import { runtime } from './runtime.mjs';
const { app, db, engine, config } = await runtime();
const server = app.listen(config.port, () => console.log(`Nudge: ${config.appUrl}`));
const timer = config.workerEnabled ? setInterval(() => engine.tick().catch(error => console.error('Worker failed:', error.name)), config.workerInterval * 1000) : null;
timer?.unref();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  if (timer) clearInterval(timer);
  server.close(async () => { await db.close(); process.exit(0); });
});
