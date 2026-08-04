'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Canonical layout names used by the V2.4.2 admin and Player 0.13.4.
    await client.query(`
      ALTER TABLE cx_screens DROP CONSTRAINT IF EXISTS cx_screens_layout_check;
      UPDATE cx_screens SET layout='VERTICAL' WHERE layout='DOUBLE_H';
      UPDATE cx_screens SET layout='HORIZONTAL' WHERE layout='DOUBLE_V';
      UPDATE cx_screens SET layout='SINGLE' WHERE layout IS NULL OR layout NOT IN ('SINGLE','VERTICAL','HORIZONTAL');
      ALTER TABLE cx_screens
        ADD CONSTRAINT cx_screens_layout_check
        CHECK (layout IN ('SINGLE','VERTICAL','HORIZONTAL'));
    `);

    // QR-to-screen session fields. ADD COLUMN IF NOT EXISTS keeps the migration repeatable.
    await client.query(`
      CREATE TABLE IF NOT EXISTS cx_qr_sessions(
        token TEXT PRIMARY KEY,
        screen_id INTEGER NOT NULL REFERENCES cx_screens(id) ON DELETE CASCADE,
        playlist_id INTEGER REFERENCES cx_playlists(id) ON DELETE SET NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE cx_qr_sessions ADD COLUMN IF NOT EXISTS duration_seconds INTEGER NOT NULL DEFAULT 30;
      ALTER TABLE cx_qr_sessions ADD COLUMN IF NOT EXISTS max_uses INTEGER NOT NULL DEFAULT 20;
      ALTER TABLE cx_qr_sessions ADD COLUMN IF NOT EXISTS use_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE cx_qr_sessions ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;
      CREATE INDEX IF NOT EXISTS idx_cx_qr_sessions_screen_expires ON cx_qr_sessions(screen_id,expires_at DESC);
    `);

    await client.query('COMMIT');
    console.log('✅ Migration CX View 1.3.1 : split screen + QR-to-screen appliquée');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration CX View 1.3.1:', error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
