'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async()=>{
  try {
    await pool.query(`
      ALTER TABLE cx_screen_telemetry ADD COLUMN IF NOT EXISTS hostname TEXT;
      ALTER TABLE cx_screen_telemetry ADD COLUMN IF NOT EXISTS platform TEXT;
      ALTER TABLE cx_screen_telemetry ADD COLUMN IF NOT EXISTS architecture TEXT;
      ALTER TABLE cx_screen_telemetry ADD COLUMN IF NOT EXISTS timezone TEXT;
      ALTER TABLE cx_screen_telemetry ADD COLUMN IF NOT EXISTS local_time TIMESTAMPTZ;
      ALTER TABLE cx_screen_telemetry ADD COLUMN IF NOT EXISTS local_ip TEXT;
      ALTER TABLE cx_screen_telemetry ADD COLUMN IF NOT EXISTS public_ip TEXT;
      ALTER TABLE cx_screen_telemetry ADD COLUMN IF NOT EXISTS network_state TEXT;
      ALTER TABLE cx_screen_telemetry ADD COLUMN IF NOT EXISTS server_latency_ms INTEGER;
      ALTER TABLE cx_screen_telemetry ADD COLUMN IF NOT EXISTS process_memory_mb INTEGER;
      ALTER TABLE cx_screen_telemetry ADD COLUMN IF NOT EXISTS screen_width_px INTEGER;
      ALTER TABLE cx_screen_telemetry ADD COLUMN IF NOT EXISTS screen_height_px INTEGER;
      ALTER TABLE cx_screen_telemetry ADD COLUMN IF NOT EXISTS screen_scale_factor NUMERIC(6,3);
      ALTER TABLE cx_screen_telemetry ADD COLUMN IF NOT EXISTS cache_files INTEGER;
      ALTER TABLE cx_screen_telemetry ADD COLUMN IF NOT EXISTS cache_bytes BIGINT;
      ALTER TABLE cx_screen_telemetry ADD COLUMN IF NOT EXISTS download_state TEXT;
      ALTER TABLE cx_screen_telemetry ADD COLUMN IF NOT EXISTS download_current INTEGER;
      ALTER TABLE cx_screen_telemetry ADD COLUMN IF NOT EXISTS download_total INTEGER;
      ALTER TABLE cx_screen_telemetry ADD COLUMN IF NOT EXISTS current_playlist_name TEXT;
      ALTER TABLE cx_screen_telemetry ADD COLUMN IF NOT EXISTS current_media_name TEXT;
      ALTER TABLE cx_screen_telemetry ADD COLUMN IF NOT EXISTS media_position_seconds NUMERIC(12,3);
      ALTER TABLE cx_screen_telemetry ADD COLUMN IF NOT EXISTS media_remaining_seconds NUMERIC(12,3);
      ALTER TABLE cx_screen_telemetry ADD COLUMN IF NOT EXISTS heartbeat_sequence BIGINT;
      ALTER TABLE cx_screen_telemetry ADD COLUMN IF NOT EXISTS boot_id TEXT;
      ALTER TABLE cx_screen_telemetry ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;

      CREATE TABLE IF NOT EXISTS cx_telemetry_samples (
        id BIGSERIAL PRIMARY KEY,
        screen_id INTEGER NOT NULL REFERENCES cx_screens(id) ON DELETE CASCADE,
        cpu_percent NUMERIC(5,2),
        ram_percent NUMERIC(5,2),
        disk_percent NUMERIC(5,2),
        server_latency_ms INTEGER,
        playback_state TEXT,
        current_media_id INTEGER REFERENCES cx_media(id) ON DELETE SET NULL,
        captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_cx_telemetry_samples_screen_time
        ON cx_telemetry_samples(screen_id,captured_at DESC);
    `);
    console.log('✅ Migration V0.16 Télémetrie Player appliquée');
  } catch (error) {
    console.error('❌ Migration V0.16:', error.message);
    process.exitCode = 1;
  } finally { await pool.end(); }
})();
