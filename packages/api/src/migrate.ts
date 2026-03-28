import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findMigrationsDir(): string {
  const candidates = [
    path.resolve(__dirname, '../migrations'),
    path.resolve(__dirname, '../../migrations'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  throw new Error(`Migrations directory not found. Searched: ${candidates.join(', ')}`);
}

export async function runMigrations(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const migrationsDir = findMigrationsDir();
  const applied = await query<{ name: string }>('SELECT name FROM _migrations ORDER BY name');
  const appliedSet = new Set(applied.rows.map(r => r.name));

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (appliedSet.has(file)) continue;
    try {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      await query(sql);
      await query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      console.log(`Migration applied: ${file}`);
    } catch (err) {
      console.error(`Failed to apply migration ${file}:`, err);
      throw err;
    }
  }
}
