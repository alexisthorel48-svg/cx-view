require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  await pool.query('BEGIN');
  try {
    await pool.query(`
      ALTER TABLE cx_folders
        ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES cx_folders(id) ON DELETE CASCADE,
        ADD COLUMN IF NOT EXISTS path TEXT;

      ALTER TABLE cx_screen_groups
        ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES cx_screen_groups(id) ON DELETE SET NULL;

      ALTER TABLE cx_screens
        ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES cx_screen_groups(id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS idx_cx_folders_parent ON cx_folders(parent_id);
      CREATE INDEX IF NOT EXISTS idx_cx_folders_client ON cx_folders(client_id);
      CREATE INDEX IF NOT EXISTS idx_cx_media_folder ON cx_media(folder_id);
      CREATE INDEX IF NOT EXISTS idx_cx_screens_group ON cx_screens(group_id);
      CREATE INDEX IF NOT EXISTS idx_cx_schedule_screen_active ON cx_screen_schedule_rules(screen_id, active);
    `);
    await pool.query(`
      UPDATE cx_folders
      SET path = COALESCE(path, name)
      WHERE path IS NULL OR path = ''
    `);
    await pool.query('COMMIT');
    console.log('Migration CX-View V3.1 terminée.');
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Migration V3.1 échouée :', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
run();
