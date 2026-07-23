const fs = require('fs');
const path = require('path');

const appRoot = path.resolve(__dirname, '..');
const server = path.join(appRoot, 'server.js');
const html = path.join(appRoot, 'public', 'app.html');
const moduleFile = path.join(appRoot, 'modules', 'cx_view_v31.js');
const uiFile = path.join(appRoot, 'public', 'js', 'cx_view_v31.js');

for (const file of [server, html, moduleFile, uiFile]) {
  if (!fs.existsSync(file)) throw new Error(`Fichier absent : ${file}`);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
for (const file of [server, html]) fs.copyFileSync(file, `${file}.backup_v3_1_${stamp}`);

let source = fs.readFileSync(server, 'utf8');
if (!source.includes("require('./modules/cx_view_v31')")) {
  source = source.replace(
    'const app = express();',
    "const app = express();\nconst cxViewV31 = require('./modules/cx_view_v31');"
  );
}
if (!source.includes('cxViewV31.register({')) {
  const marker = '// ─── FOLDERS';
  if (!source.includes(marker)) throw new Error('Point de raccordement FOLDERS introuvable dans server.js.');
  source = source.replace(
    marker,
    "cxViewV31.register({ app, q, auth, adminOnly, notifyPlayer, notifyScreens, MEDIA_ROOT, PUBLIC_BASE_URL });\n\n" + marker
  );
}
fs.writeFileSync(server, source, 'utf8');

let page = fs.readFileSync(html, 'utf8');
if (!page.includes('/js/cx_view_v31.js')) {
  page = page.replace('</body>', '<script src="/js/cx_view_v31.js"></script>\n</body>');
  fs.writeFileSync(html, page, 'utf8');
}

console.log('Raccordement V3.1 appliqué. Exécutez ensuite : node scripts/migrate_v3_1.js');
