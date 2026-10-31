// Rendición de caja: arma el resumen desde la última rendición y el email que se envía.
const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
export const pesos = (c) => money.format(c / 100);
const fechaAR = (iso) => iso.split('-').reverse().join('/');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const hoyAR = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });

// Lo cobrado y gastado desde el último movimiento de tipo "Rendiciones" de la caja.
export function previsualizar(db, cajaId) {
  const caja = db.prepare('SELECT id, nombre FROM cajas WHERE id = ?').get(cajaId);
  const rend = db.prepare("SELECT id FROM categorias WHERE nombre = 'Rendiciones'").get().id;
  const todos = db.prepare('SELECT id, fecha, concepto, importe, categoria_id FROM movimientos WHERE caja_id = ? ORDER BY fecha, orden, id').all(cajaId);
  const ultima = todos.map((m) => m.categoria_id).lastIndexOf(rend);
  const desde = todos.slice(ultima + 1);
  const ingresos = desde.filter((m) => m.importe > 0);
  const egresos = desde.filter((m) => m.importe < 0);
  return {
    caja, desde: ultima >= 0 ? todos[ultima].fecha : null,
    saldo: todos.reduce((a, m) => a + m.importe, 0),
    ingresos, egresos,
    total_ingresos: ingresos.reduce((a, m) => a + m.importe, 0),
    total_egresos: -egresos.reduce((a, m) => a + m.importe, 0),
  };
}

const MAX_FILAS = 150;
export function armarEmail({ pv, importe, fecha, usuario, nota }) {
  const hora = Number(new Date().toLocaleString('en-GB', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', hour12: false }));
  const saludo = hora < 12 ? 'Buenos días' : hora < 20 ? 'Buenas tardes' : 'Buenas noches';
  const nombre = pv.caja.nombre;
  const restante = pv.saldo - importe;
  const filas = (l) => l.slice(-MAX_FILAS).map((m) => ({ f: fechaAR(m.fecha), c: m.concepto, i: pesos(Math.abs(m.importe)) }));
  const ing = filas(pv.ingresos), egr = filas(pv.egresos);
  const recorte = (l, n) => (l.length > n ? `(se muestran los últimos ${n} de ${l.length})` : '');
  const txt = [
    `${saludo},`, '',
    `Se realizó la rendición de ${nombre.toLowerCase()} del ${fechaAR(fecha)} por ${pesos(importe)}.`,
    ...(nota ? ['', `Nota: ${nota}`] : []), '',
    `Saldo de caja antes: ${pesos(pv.saldo)}`, `Importe rendido: ${pesos(importe)}`, `Saldo de caja después: ${pesos(restante)}`, '',
    `Cobros desde ${pv.desde ? 'la última rendición (' + fechaAR(pv.desde) + ')' : 'el inicio'}: ${pesos(pv.total_ingresos)}`,
    ...ing.map((m) => `  ${m.f}  ${m.c}  ${m.i}`), recorte(pv.ingresos, MAX_FILAS), '',
    `Egresos en el período: ${pesos(pv.total_egresos)}`,
    ...egr.map((m) => `  ${m.f}  ${m.c}  ${m.i}`), recorte(pv.egresos, MAX_FILAS), '',
    'Por favor responder "recibido" a este email para dejar constancia.', '',
    `Registrada por ${usuario} en Sistema Caja Estudio.`,
  ].filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n');
  const tabla = (l) => `<table cellpadding="6" style="border-collapse:collapse;font-size:14px">${l.map((m) => `<tr><td>${m.f}</td><td>${esc(m.c)}</td><td align="right">${m.i}</td></tr>`).join('')}</table>`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1f2326"><p>${saludo},</p>
<p>Se realizó la rendición de <b>${esc(nombre.toLowerCase())}</b> del ${fechaAR(fecha)} por <b>${pesos(importe)}</b>.</p>${nota ? `<p>Nota: ${esc(nota)}</p>` : ''}
<p>Saldo de caja antes: ${pesos(pv.saldo)}<br>Importe rendido: <b>${pesos(importe)}</b><br>Saldo de caja después: ${pesos(restante)}</p>
<p><b>Cobros</b> desde ${pv.desde ? 'la última rendición (' + fechaAR(pv.desde) + ')' : 'el inicio'}: ${pesos(pv.total_ingresos)}</p>${tabla(ing)}<small>${recorte(pv.ingresos, MAX_FILAS)}</small>
<p><b>Egresos</b> en el período: ${pesos(pv.total_egresos)}</p>${tabla(egr)}<small>${recorte(pv.egresos, MAX_FILAS)}</small>
<p>Por favor responder <b>"recibido"</b> a este email para dejar constancia.</p><p style="color:#5f6872;font-size:13px">Registrada por ${esc(usuario)} en Sistema Caja Estudio.</p></div>`;
  return { subject: `Rendición de ${nombre.toLowerCase()} - ${fechaAR(fecha)}`, text: txt, html };
}
