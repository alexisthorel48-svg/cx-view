
const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
const copy=(a,b)=>{fs.mkdirSync(path.dirname(b),{recursive:true});fs.copyFileSync(a,b)};
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
for(const file of ['server.js','public/app.html','public/css/app.css']){const p=path.join(root,file);if(!fs.existsSync(p))throw new Error('Fichier absent: '+p);fs.copyFileSync(p,p+'.backup_v3_'+stamp)}
copy(path.join(root,'modules/cx_view_v3.js'),path.join(root,'modules/cx_view_v3.js'));
copy(path.join(root,'public/js/cx_view_v3.js'),path.join(root,'public/js/cx_view_v3.js'));
let s=fs.readFileSync(path.join(root,'server.js'),'utf8');
if(!s.includes("cx_view_v3")){
 s=s.replace("const app = express();","const app = express();\nconst cxViewV3 = require('./modules/cx_view_v3');");
 s=s.replace("// ─── API PLAYER","cxViewV3.register({app,q,auth,adminOnly,superOnly,notifyPlayer,notifyScreens,PUBLIC_BASE_URL,MEDIA_ROOT});\n\n// ─── API PLAYER");
 fs.writeFileSync(path.join(root,'server.js'),s);
}
let h=fs.readFileSync(path.join(root,'public/app.html'),'utf8');
if(!h.includes('cx_view_v3.js')){h=h.replace('</body>','<script src="/js/cx_view_v3.js"></script>\n</body>');fs.writeFileSync(path.join(root,'public/app.html'),h);}
let c=fs.readFileSync(path.join(root,'public/css/app.css'),'utf8');
if(!c.includes('CX-View V3')){c+='\n/* CX-View V3 */ .v3-tree{max-height:230px;overflow:auto;padding:8px;background:var(--surface2);border-radius:6px}.v3-tree div{padding:5px}.v3-note{font-size:.82rem;color:var(--text2);margin-bottom:12px}.v3-tree small{color:var(--text2)}\n';fs.writeFileSync(path.join(root,'public/css/app.css'),c);}
console.log('Raccordement V3 appliqué. Exécutez : node scripts/migrate_v3.js');
