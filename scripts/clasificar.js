// Asigna tipo de egreso a los egresos sin tipo de una base ya cargada. Idempotente.
// Uso: node scripts/clasificar.js [--ver]   (--ver sólo lista los que quedan sin clasificar)
import { abrirDb } from '../src/db.js';
import { clasificar } from '../src/clasificar.js';

const db = abrirDb();
const cats = new Map(db.prepare('SELECT id, nombre FROM categorias').all().map((c) => [c.nombre, c.id]));
const rows = db.prepare('SELECT id, concepto FROM movimientos WHERE importe < 0 AND categoria_id IS NULL').all();
const upd = db.prepare('UPDATE movimientos SET categoria_id = ? WHERE id = ?');
let n = 0; const sin = [];
db.exec('BEGIN');
for (const r of rows) {
  const c = cats.get(clasificar(r.concepto));
  if (!c) { sin.push(r.concepto); continue; }
  if (!process.argv.includes('--ver')) upd.run(c, r.id);
  n++;
}
db.exec('COMMIT');
console.log(`${n} clasificados, ${sin.length} sin clasificar`);
if (process.argv.includes('--ver')) console.log(sin.slice(0, 60).join('\n'));
