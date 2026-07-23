require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  await pool.query('BEGIN');
  try {
    await pool.query(`
      ALTER TABLE cx_screens
        ADD COLUMN IF NOT EXISTS display_mode VARCHAR(16) NOT NULL DEFAULT 'WINDOW',
        ADD COLUMN IF NOT EXISTS monitor_id INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS player_version VARCHAR(32)
    `);
    await pool.query(`
      ALTER TABLE cx_playlist_items
        ADD COLUMN IF NOT EXISTS play_forever BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cx_player_updates (
        id SERIAL PRIMARY KEY,
        version VARCHAR(32) NOT NULL UNIQUE,
        file_name TEXT NOT NULL,
        original_name TEXT,
        file_size BIGINT NOT NULL DEFAULT 0,
        sha256 CHAR(64) NOT NULL,
        notes TEXT,
        mandatory BOOLEAN NOT NULL DEFAULT FALSE,
        published BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        published_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`UPDATE cx_screens SET display_mode='WINDOW' WHERE display_mode IS NULL`);
    await pool.query(`UPDATE cx_screens SET monitor_id=0 WHERE monitor_id IS NULL`);
    await pool.query('COMMIT');
    console.log('Migration CX-View V1.5 / mises à jour automatiques terminée.');
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Migration échouée :', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
migrate();
