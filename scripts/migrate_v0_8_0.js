require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async()=>{try{
 await pool.query('CREATE INDEX IF NOT EXISTS idx_cx_logs_played_at ON cx_logs(played_at DESC)');
 await pool.query('CREATE INDEX IF NOT EXISTS idx_cx_logs_screen_played ON cx_logs(screen_id,played_at DESC)');
 await pool.query('CREATE INDEX IF NOT EXISTS idx_cx_logs_media_played ON cx_logs(media_id,played_at DESC)');
 console.log('Migration V0.8.0 terminée.');
}catch(e){console.error(e);process.exitCode=1}finally{await pool.end()}})();
