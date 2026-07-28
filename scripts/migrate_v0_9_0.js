require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async()=>{
  await pool.query(`CREATE TABLE IF NOT EXISTS cx_player_logs(
    id BIGSERIAL PRIMARY KEY,
    screen_id INTEGER NOT NULL REFERENCES cx_screens(id) ON DELETE CASCADE,
    level VARCHAR(10) NOT NULL DEFAULT 'INFO',
    category VARCHAR(80) NOT NULL DEFAULT 'PLAYER',
    message TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_cx_player_logs_screen_time ON cx_player_logs(screen_id,occurred_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_cx_player_logs_level ON cx_player_logs(level)');
  console.log('Migration CX View V0.9.0 terminée.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>pool.end());
