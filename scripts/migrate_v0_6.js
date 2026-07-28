require('dotenv').config();
const {Pool}=require('pg');
const pool=new Pool({connectionString:process.env.DATABASE_URL});
(async()=>{try{
 await pool.query(`CREATE TABLE IF NOT EXISTS cx_scenes(
  id SERIAL PRIMARY KEY,name VARCHAR(160) NOT NULL,description TEXT DEFAULT '',width INTEGER NOT NULL DEFAULT 1920,height INTEGER NOT NULL DEFAULT 1080,
  background VARCHAR(16) NOT NULL DEFAULT '#000000',active BOOLEAN NOT NULL DEFAULT true,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
 await pool.query(`CREATE TABLE IF NOT EXISTS cx_scene_zones(
  id SERIAL PRIMARY KEY,scene_id INTEGER NOT NULL REFERENCES cx_scenes(id) ON DELETE CASCADE,name VARCHAR(160) NOT NULL,
  content_type VARCHAR(32) NOT NULL DEFAULT 'playlist',playlist_id INTEGER REFERENCES cx_playlists(id) ON DELETE SET NULL,content_value TEXT DEFAULT '',
  x NUMERIC(7,3) NOT NULL DEFAULT 0,y NUMERIC(7,3) NOT NULL DEFAULT 0,width NUMERIC(7,3) NOT NULL DEFAULT 100,height NUMERIC(7,3) NOT NULL DEFAULT 100,
  layer INTEGER NOT NULL DEFAULT 0,muted BOOLEAN NOT NULL DEFAULT true,fit VARCHAR(16) NOT NULL DEFAULT 'contain',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
 await pool.query(`CREATE TABLE IF NOT EXISTS cx_screen_scenes(
  screen_id INTEGER PRIMARY KEY REFERENCES cx_screens(id) ON DELETE CASCADE,scene_id INTEGER NOT NULL REFERENCES cx_scenes(id) ON DELETE CASCADE,
  active BOOLEAN NOT NULL DEFAULT true,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
 await pool.query('CREATE INDEX IF NOT EXISTS idx_scene_zones_scene ON cx_scene_zones(scene_id)');
 await pool.query('CREATE INDEX IF NOT EXISTS idx_screen_scenes_scene ON cx_screen_scenes(scene_id)');
 console.log('✅ Migration CX View V0.6 terminée.');
}catch(e){console.error('❌ Migration V0.6:',e);process.exitCode=1}finally{await pool.end()}})();
