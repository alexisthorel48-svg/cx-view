require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async()=>{
  const q=(sql,p=[])=>pool.query(sql,p);
  try {
    await q(`ALTER TABLE cx_sites ALTER COLUMN client_id DROP NOT NULL`);
    await q(`ALTER TABLE cx_screen_groups ALTER COLUMN client_id DROP NOT NULL`);

    await q(`DO $$
    DECLARE r record;
    BEGIN
      FOR r IN
        SELECT conname, conrelid::regclass AS tbl
        FROM pg_constraint
        WHERE contype='f'
          AND conrelid IN ('cx_sites'::regclass,'cx_screen_groups'::regclass)
          AND pg_get_constraintdef(oid) ILIKE '%(client_id)%'
      LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
      END LOOP;
    END $$`);

    await q(`ALTER TABLE cx_sites
      ADD CONSTRAINT cx_sites_client_id_fkey
      FOREIGN KEY (client_id) REFERENCES cx_clients(id) ON DELETE SET NULL`);
    await q(`ALTER TABLE cx_screen_groups
      ADD CONSTRAINT cx_screen_groups_client_id_fkey
      FOREIGN KEY (client_id) REFERENCES cx_clients(id) ON DELETE SET NULL`);

    await q(`CREATE UNIQUE INDEX IF NOT EXISTS ux_cx_sites_internal_name
      ON cx_sites (LOWER(name)) WHERE client_id IS NULL`);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS ux_cx_groups_internal_name
      ON cx_screen_groups (LOWER(name)) WHERE client_id IS NULL`);

    console.log('Migration V0.7.3 terminée');
  } catch(e) {
    console.error('Migration V0.7.3 échouée:', e);
    process.exitCode=1;
  } finally { await pool.end(); }
})();
