require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async () => {
  try {
    await pool.query(`ALTER TABLE cx_screens ADD COLUMN IF NOT EXISTS protocol_version INTEGER NOT NULL DEFAULT 1`);
    await pool.query(`ALTER TABLE cx_screens ADD COLUMN IF NOT EXISTS last_config_hash TEXT`);
    await pool.query(`ALTER TABLE cx_screens ADD COLUMN IF NOT EXISTS last_config_at TIMESTAMPTZ`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_cx_schedule_screen_active_priority ON cx_screen_schedule_rules(screen_id,active,zone,priority DESC)`);
    console.log('✅ Migration V0.18.0 Core Engine terminée');
  } catch (error) {
    console.error('❌ Migration V0.18.0 échouée:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
