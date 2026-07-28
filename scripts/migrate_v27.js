require('dotenv').config();
const {Pool}=require('pg');
const pool=new Pool({connectionString:process.env.DATABASE_URL});
(async()=>{try{await pool.query(`
ALTER TABLE cx_screens ADD COLUMN IF NOT EXISTS player_id UUID;
ALTER TABLE cx_screens ADD COLUMN IF NOT EXISTS player_token_hash TEXT;
ALTER TABLE cx_screens ADD COLUMN IF NOT EXISTS paired_at TIMESTAMPTZ;
ALTER TABLE cx_screens ADD COLUMN IF NOT EXISTS config_version BIGINT NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS cx_player_commands(
 id BIGSERIAL PRIMARY KEY,
 screen_id INTEGER NOT NULL REFERENCES cx_screens(id) ON DELETE CASCADE,
 type TEXT NOT NULL,
 payload JSONB NOT NULL DEFAULT '{}',
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','RECEIVED','RUNNING','COMPLETED','FAILED')),
 result JSONB NOT NULL DEFAULT '{}',
 error_message TEXT,
 requested_by INTEGER REFERENCES cx_users(id) ON DELETE SET NULL,
 source_type TEXT,
 source_id INTEGER,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 received_at TIMESTAMPTZ,
 started_at TIMESTAMPTZ,
 completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_cx_player_commands_screen_status ON cx_player_commands(screen_id,status,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cx_screens_player_id ON cx_screens(player_id) WHERE player_id IS NOT NULL;
`);console.log('✅ Migration V2.7 terminée');}catch(e){console.error(e);process.exitCode=1;}finally{await pool.end();}})();
