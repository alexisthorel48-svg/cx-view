require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async()=>{
  const q=(sql,p=[])=>pool.query(sql,p);
  try {
    await q(`CREATE TABLE IF NOT EXISTS cx_sites (
      id SERIAL PRIMARY KEY,
      client_id INTEGER REFERENCES cx_clients(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      address TEXT,
      city TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(client_id,name)
    )`);
    await q(`CREATE TABLE IF NOT EXISTS cx_screen_groups (
      id SERIAL PRIMARY KEY,
      client_id INTEGER REFERENCES cx_clients(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(client_id,name)
    )`);
    await q(`ALTER TABLE cx_sites ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE`);
    await q(`ALTER TABLE cx_screen_groups ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE`);
    await q(`ALTER TABLE cx_screen_groups ADD COLUMN IF NOT EXISTS description TEXT`);
    await q(`ALTER TABLE cx_screens ADD COLUMN IF NOT EXISTS site_id INTEGER REFERENCES cx_sites(id) ON DELETE SET NULL`);
    await q(`ALTER TABLE cx_screens ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES cx_screen_groups(id) ON DELETE SET NULL`);
    await q(`ALTER TABLE cx_screens ADD COLUMN IF NOT EXISTS location_label TEXT`);
    await q(`ALTER TABLE cx_screens ADD COLUMN IF NOT EXISTS screen_type TEXT NOT NULL DEFAULT 'FIXED'`);
    await q(`ALTER TABLE cx_screens ADD COLUMN IF NOT EXISTS sync_version INTEGER NOT NULL DEFAULT 0`);
    await q(`ALTER TABLE cx_users DROP CONSTRAINT IF EXISTS cx_users_role_check`);
    await q(`ALTER TABLE cx_users ADD CONSTRAINT cx_users_role_check CHECK (role IN ('SUPER_ADMIN','ADMIN','CLIENT','EDITOR','VIEWER'))`);
    await q(`CREATE INDEX IF NOT EXISTS idx_cx_screens_site ON cx_screens(site_id)`);
    await q(`CREATE INDEX IF NOT EXISTS idx_cx_screens_group ON cx_screens(group_id)`);
    console.log('Migration V0.7.1 terminée');
  } catch(e) {
    console.error('Migration V0.7.1 échouée:', e);
    process.exitCode=1;
  } finally { await pool.end(); }
})();
