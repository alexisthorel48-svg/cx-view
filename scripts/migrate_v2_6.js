'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async()=>{
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cx_screen_telemetry (
        screen_id INTEGER PRIMARY KEY REFERENCES cx_screens(id) ON DELETE CASCADE,
        player_version TEXT,
        os_version TEXT,
        ip_address TEXT,
        cpu_percent NUMERIC(5,2),
        ram_percent NUMERIC(5,2),
        ram_used_mb INTEGER,
        ram_total_mb INTEGER,
        disk_percent NUMERIC(5,2),
        disk_free_mb BIGINT,
        disk_total_mb BIGINT,
        cpu_temperature NUMERIC(6,2),
        uptime_seconds BIGINT,
        current_playlist_id INTEGER REFERENCES cx_playlists(id) ON DELETE SET NULL,
        current_media_id INTEGER REFERENCES cx_media(id) ON DELETE SET NULL,
        current_zone TEXT,
        playback_state TEXT,
        eco_mode BOOLEAN NOT NULL DEFAULT false,
        last_sync_at TIMESTAMPTZ,
        last_error TEXT,
        extra JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_cx_screen_telemetry_updated ON cx_screen_telemetry(updated_at DESC);
    `);
    console.log('✅ Migration V2.6 Monitoring appliquée');
  } catch (error) {
    console.error('❌ Migration V2.6 Monitoring:', error.message);
    process.exitCode = 1;
  } finally { await pool.end(); }
})();
