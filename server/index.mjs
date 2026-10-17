import { configuration } from './config.mjs';
import { vault as createVault } from './crypto.mjs';
import { database } from './db.mjs';
import { intelligence } from './ai.mjs';
import { gmail } from './gmail.mjs';
import { scrape } from './web.mjs';
import { engine as createEngine } from './engine.mjs';
import { application } from './app.mjs';

const config = configuration();
const db = await database(config.databaseUrl);
const vault = createVault(config.encryptionKey), ai = intelligence(config), mail = gmail(config, db, vault);
const engine = createEngine({ db, vault, ai, mail, scrape, config });
const app = application({ db, vault, ai, mail, engine, scrape, config });
const server = app.listen(config.port, () => console.log(`Nudge: ${config.appUrl}`));
const timer = config.workerEnabled ? setInterval(() => engine.tick().catch(error => console.error('Worker failed:', error.name)), config.workerInterval * 1000) : null;
timer?.unref();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  if (timer) clearInterval(timer);
  server.close(async () => { await db.close(); process.exit(0); });
});
