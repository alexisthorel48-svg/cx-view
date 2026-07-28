require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async()=>{
  try{
    await pool.query(`
      ALTER TABLE cx_screen_schedule_rules ADD COLUMN IF NOT EXISTS campaign_uid UUID;
      ALTER TABLE cx_screen_schedule_rules ADD COLUMN IF NOT EXISTS target_type VARCHAR(16) NOT NULL DEFAULT 'SCREEN';
      ALTER TABLE cx_screen_schedule_rules ADD COLUMN IF NOT EXISTS target_group_id INTEGER;
      ALTER TABLE cx_screen_schedule_rules ADD COLUMN IF NOT EXISTS target_label VARCHAR(180);
      CREATE INDEX IF NOT EXISTS idx_cx_schedule_campaign_uid ON cx_screen_schedule_rules(campaign_uid);
      CREATE INDEX IF NOT EXISTS idx_cx_schedule_target_group ON cx_screen_schedule_rules(target_group_id);
    `);
    console.log('✓ Migration campagnes V0.14 terminée');
  }catch(e){console.error(e);process.exitCode=1;}finally{await pool.end();}
})();
