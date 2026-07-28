require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async()=>{
  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    await c.query(`
      CREATE TABLE IF NOT EXISTS cx_screen_schedule_rules(
        id SERIAL PRIMARY KEY,
        screen_id INTEGER NOT NULL REFERENCES cx_screens(id) ON DELETE CASCADE,
        zone CHAR(1) NOT NULL DEFAULT 'A',
        playlist_id INTEGER NOT NULL REFERENCES cx_playlists(id) ON DELETE CASCADE,
        name VARCHAR(180), priority INTEGER NOT NULL DEFAULT 100,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        start_date DATE, end_date DATE, days VARCHAR(64) NOT NULL DEFAULT 'all',
        time_from TIME, time_to TIME, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE cx_screen_schedule_rules ADD COLUMN IF NOT EXISTS color VARCHAR(7) DEFAULT '#6D5DFB';
      ALTER TABLE cx_screen_schedule_rules ADD COLUMN IF NOT EXISTS notes TEXT;
      ALTER TABLE cx_screen_schedule_rules ADD COLUMN IF NOT EXISTS timezone VARCHAR(80) NOT NULL DEFAULT 'Europe/Brussels';
      ALTER TABLE cx_screen_schedule_rules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      CREATE INDEX IF NOT EXISTS idx_cx_schedule_screen_active ON cx_screen_schedule_rules(screen_id,active);
      CREATE INDEX IF NOT EXISTS idx_cx_schedule_dates ON cx_screen_schedule_rules(start_date,end_date);
      CREATE INDEX IF NOT EXISTS idx_cx_schedule_priority ON cx_screen_schedule_rules(screen_id,zone,priority DESC);
    `);
    await c.query('COMMIT');
    console.log('Migration CX View V0.5 terminée.');
  }catch(e){await c.query('ROLLBACK');console.error(e);process.exitCode=1;}
  finally{c.release();await pool.end();}
})();
