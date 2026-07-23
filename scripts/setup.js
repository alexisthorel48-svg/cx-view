require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    const schema = fs.readFileSync(path.join(__dirname, '../sql/schema.sql'), 'utf8');
    const statements = schema.split(';').map(s => s.trim()).filter(s => s.length > 0);
    for (const stmt of statements) {
      try { await client.query(stmt); } catch(e) { if (!e.message.includes('already exists')) console.warn('⚠️ ', e.message.substring(0,60)); }
    }
    console.log('✅ Tables vérifiées');

    const mediaRoot = process.env.MEDIA_ROOT || path.join(__dirname, '../storage');
    ['', 'uploads', 'thumbs'].forEach(sub => {
      const dir = path.join(mediaRoot, sub);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });
    console.log('✅ Dossiers de stockage vérifiés');

    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    if (!email || !password || password === 'CHANGE_ME') {
      console.log('⚠️  ADMIN_EMAIL et ADMIN_PASSWORD doivent être renseignés dans .env');
      return;
    }
    const hash = await bcrypt.hash(password, 12);
    await client.query(
      `INSERT INTO cx_users (email, password_hash, display_name, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role`,
      [email, hash, 'Super Admin', 'SUPER_ADMIN']
    );
    console.log('✅ Compte admin vérifié :', email);
    console.log('🚀 CX-View V1.3 prêt');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
