require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async()=>{const q=(s,p=[])=>pool.query(s,p);try{
await q(`CREATE TABLE IF NOT EXISTS cx_player_releases(
 id BIGSERIAL PRIMARY KEY, version TEXT NOT NULL UNIQUE, channel TEXT NOT NULL DEFAULT 'STABLE',
 status TEXT NOT NULL DEFAULT 'DRAFT', file_name TEXT NOT NULL, original_name TEXT, mime_type TEXT,
 bytes BIGINT NOT NULL DEFAULT 0, sha256 TEXT NOT NULL, release_notes TEXT, mandatory BOOLEAN NOT NULL DEFAULT FALSE,
 created_by BIGINT REFERENCES cx_users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 published_at TIMESTAMPTZ, archived_at TIMESTAMPTZ
)`);
await q(`CREATE TABLE IF NOT EXISTS cx_player_deployments(
 id BIGSERIAL PRIMARY KEY, release_id BIGINT NOT NULL REFERENCES cx_player_releases(id) ON DELETE CASCADE,
 target_type TEXT NOT NULL, target_id BIGINT, status TEXT NOT NULL DEFAULT 'QUEUED', rollout_mode TEXT NOT NULL DEFAULT 'IMMEDIATE',
 scheduled_at TIMESTAMPTZ, created_by BIGINT REFERENCES cx_users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ,
 notes TEXT
)`);
await q(`CREATE TABLE IF NOT EXISTS cx_player_deployment_targets(
 id BIGSERIAL PRIMARY KEY, deployment_id BIGINT NOT NULL REFERENCES cx_player_deployments(id) ON DELETE CASCADE,
 screen_id BIGINT NOT NULL REFERENCES cx_screens(id) ON DELETE CASCADE,
 command_id BIGINT REFERENCES cx_player_commands(id) ON DELETE SET NULL,
 status TEXT NOT NULL DEFAULT 'PENDING', progress INTEGER NOT NULL DEFAULT 0,
 from_version TEXT, to_version TEXT, error_message TEXT, started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ,
 UNIQUE(deployment_id,screen_id)
)`);
await q(`ALTER TABLE cx_screens ADD COLUMN IF NOT EXISTS update_channel TEXT NOT NULL DEFAULT 'STABLE'`);
await q(`ALTER TABLE cx_screens ADD COLUMN IF NOT EXISTS update_status TEXT`);
await q(`ALTER TABLE cx_screens ADD COLUMN IF NOT EXISTS update_progress INTEGER NOT NULL DEFAULT 0`);
await q(`ALTER TABLE cx_screens ADD COLUMN IF NOT EXISTS update_target_version TEXT`);
await q(`ALTER TABLE cx_screens ADD COLUMN IF NOT EXISTS update_last_error TEXT`);
await q(`CREATE INDEX IF NOT EXISTS idx_player_releases_channel_status ON cx_player_releases(channel,status)`);
await q(`CREATE INDEX IF NOT EXISTS idx_deployment_targets_screen ON cx_player_deployment_targets(screen_id,created_at DESC)`);
console.log('Migration V0.17 terminée');
}catch(e){console.error(e);process.exitCode=1;}finally{await pool.end();}})();
