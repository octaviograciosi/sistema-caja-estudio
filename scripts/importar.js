// Uso: node scripts/importar.js honorarios <valores.json>   |   node scripts/importar.js empresa <valores.json>
// <valores.json> = {"values": [[...]]} tal como lo devuelve la API de Google Sheets.
import { readFileSync } from 'node:fs';
import { abrirDb } from '../src/db.js';

const [tipo, archivo] = process.argv.slice(2);
if (!['honorarios', 'empresa'].includes(tipo) || !archivo) {
  console.error('Uso: importar.js <honorarios|empresa> <valores.json>'); process.exit(1);
}

export const centavos = (s) => {
  if (s == null || String(s).trim() === '') return null;
  const n = Number(String(s).replace(/[$\s.]/g, '').replace(',', '.'));
  return Number.isNaN(n) ? null : Math.round(n * 100);
};
export const fechaISO = (s) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s || '').trim());
  return m && m[3] > 1950 ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
};

const db = abrirDb();
const caja = db.prepare('SELECT id FROM cajas WHERE nombre = ?').get(tipo === 'honorarios' ? 'Honorarios' : 'Empresa').id;
const cats = new Map(db.prepare('SELECT id, nombre FROM categorias').all().map((c) => [c.nombre.toLowerCase(), c.id]));
const { values } = JSON.parse(readFileSync(archivo, 'utf8'));

// Columnas: honorarios -> A fecha, E tipo, F concepto, G ingreso, H egreso | empresa -> A fecha, B concepto, C importe
const ins = db.prepare('INSERT INTO movimientos(caja_id, fecha, orden, concepto, importe, categoria_id) VALUES (?,?,?,?,?,?)');
let fecha = null, orden = 0, n = 0, omitidas = 0;
db.exec('BEGIN');
for (const r of values.slice(1)) {
  const f = fechaISO(r[0]);
  if (f) { fecha = f; orden = 0; }
  const concepto = (tipo === 'honorarios' ? r[5] : r[1])?.trim();
  if (!concepto || !fecha || /^INICIO$/i.test(concepto) || /^Hay en caja/i.test(concepto)) { omitidas++; continue; }
  let importe;
  if (tipo === 'honorarios') {
    const ing = centavos(r[6]) ?? 0, egr = centavos(r[7]) ?? 0;
    importe = ing - Math.abs(egr);
  } else importe = centavos(r[2]);
  if (!importe) { omitidas++; continue; }
  const cat = tipo === 'honorarios' && importe < 0 ? cats.get((r[4] || '').trim().toLowerCase()) ?? null : null;
  ins.run(caja, fecha, ++orden, concepto, importe, cat); n++;
}
db.exec('COMMIT');
const { s } = db.prepare('SELECT SUM(importe) s FROM movimientos WHERE caja_id = ?').get(caja);
console.log(`${tipo}: ${n} movimientos importados, ${omitidas} filas omitidas. Saldo calculado: ${s / 100}`);
