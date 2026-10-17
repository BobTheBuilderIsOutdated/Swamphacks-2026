import { configuration } from './config.mjs';
import { vault as createVault } from './crypto.mjs';
import { database } from './db.mjs';
import { intelligence } from './ai.mjs';
import { gmail } from './gmail.mjs';
import { scrape } from './web.mjs';
import { engine as createEngine } from './engine.mjs';
import { application } from './app.mjs';

export async function runtime(config = configuration()) {
  const db = await database(config.databaseUrl);
  try {
    const vault = createVault(config.encryptionKey), ai = intelligence(config), mail = gmail(config, db, vault);
    const engine = createEngine({ db, vault, ai, mail, scrape, config });
    return { app: application({ db, vault, ai, mail, engine, scrape, config }), db, engine, config };
  } catch (error) { await db.close(); throw error; }
}
