require('dotenv').config();
const {Pool}=require('pg');
const pool=new Pool({connectionString:process.env.DATABASE_URL});
(async()=>{try{await pool.query(`
CREATE TABLE IF NOT EXISTS cx_integration_clients(
 id SERIAL PRIMARY KEY,
 name TEXT NOT NULL,
 api_key_hash TEXT NOT NULL,
 active BOOLEAN NOT NULL DEFAULT true,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 last_used_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS cx_integration_tasks(
 id BIGSERIAL PRIMARY KEY,
 client_id INTEGER NOT NULL REFERENCES cx_integration_clients(id) ON DELETE CASCADE,
 external_task_id TEXT NOT NULL,
 type TEXT NOT NULL,
 payload JSONB NOT NULL DEFAULT '{}',
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','PROCESSING','DONE','FAILED')),
 result JSONB NOT NULL DEFAULT '{}',
 error_message TEXT,
 attempts INTEGER NOT NULL DEFAULT 0,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cx_integration_tasks_client_external ON cx_integration_tasks(client_id, external_task_id);
CREATE INDEX IF NOT EXISTS idx_cx_integration_tasks_status ON cx_integration_tasks(status, created_at);
`);console.log('✅ Migration V3.6 (intégrations entrantes) terminée');}catch(e){console.error(e);process.exitCode=1;}finally{await pool.end();}})();
