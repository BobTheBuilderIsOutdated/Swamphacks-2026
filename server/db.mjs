import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

export async function database(url, localPath = './data/nudge') {
  if (!url && localPath !== 'memory://') await mkdir(path.dirname(localPath), { recursive: true });
  const pg = Boolean(url), driver = pg ? new Pool({ connectionString: url, max: 4, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000 }) : new (await import('@electric-sql/pglite')).PGlite(localPath);
  const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  if (pg) await driver.query(schema); else await driver.exec(schema);
  let busy = false;
  return {
    query: (sql, params = []) => driver.query(sql, params),
    async one(sql, params = []) { return (await driver.query(sql, params)).rows[0]; },
    async event(subject, kind, detail = {}, leadId = null, campaignId = null) {
      await driver.query('INSERT INTO events(id,subject,kind,detail,lead_id,campaign_id) VALUES($1,$2,$3,$4,$5,$6)',
        [randomUUID(), subject, kind, JSON.stringify(detail), leadId, campaignId]);
    },
    async exclusive(work) {
      if (!pg) {
        if (busy) return false;
        busy = true;
        try { await work(); return true; } finally { busy = false; }
      }
      const client = await driver.connect();
      let acquired = false;
      try {
        acquired = (await client.query("SELECT pg_try_advisory_lock(718450221) AS acquired")).rows[0].acquired;
        if (!acquired) return false;
        await work();
        return true;
      } finally {
        if (acquired) await client.query('SELECT pg_advisory_unlock(718450221)');
        client.release();
      }
    },
    close: () => pg ? driver.end() : driver.close(),
  };
}
