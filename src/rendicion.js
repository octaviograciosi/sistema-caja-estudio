// Rendición de caja: arma el resumen desde la última rendición y el email que se envía.
// Formato tomado de los emails de rendición del estudio: CONCEPTO / INGRESOS / EGRESOS / SALDO corrido.
const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
export const pesos = (c) => money.format(c / 100);
const fechaAR = (iso) => iso.split('-').reverse().join('/');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const hoyAR = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });

// Lo cobrado y gastado desde el último movimiento de tipo "Rendiciones" de la caja,
// con el saldo corrido que arranca en el saldo anterior.
export function previsualizar(db, cajaId) {
  const caja = db.prepare('SELECT id, nombre FROM cajas WHERE id = ?').get(cajaId);
  const rend = db.prepare("SELECT id FROM categorias WHERE nombre = 'Rendiciones'").get().id;
  const todos = db.prepare('SELECT id, fecha, concepto, importe, categoria_id FROM movimientos WHERE caja_id = ? ORDER BY fecha, orden, id').all(cajaId);
  const ultima = todos.map((m) => m.categoria_id).lastIndexOf(rend);
  const desde = todos.slice(ultima + 1);
  const ingresos = desde.filter((m) => m.importe > 0);
  const egresos = desde.filter((m) => m.importe < 0);
  const saldo = todos.reduce((a, m) => a + m.importe, 0);
  const total_ingresos = ingresos.reduce((a, m) => a + m.importe, 0);
  const total_egresos = -egresos.reduce((a, m) => a + m.importe, 0);
  const saldo_anterior = saldo - (total_ingresos - total_egresos);
  let acum = saldo_anterior;
  const periodo = desde.map((m) => ({ ...m, saldo: (acum += m.importe) }));
  return { caja, desde: ultima >= 0 ? todos[ultima].fecha : null, saldo, saldo_anterior, periodo, ingresos, egresos, total_ingresos, total_egresos };
}

export const MAX_FILAS_EMAIL = 300;
export function armarEmail({ pv, importe, fecha, usuario, nota }) {
  const hora = Number(new Date().toLocaleString('en-GB', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', hour12: false }));
  const saludo = hora < 12 ? 'Buenos días' : hora < 20 ? 'Buenas tardes' : 'Buenas noches';
  const nombre = pv.caja.nombre.toLowerCase();
  const restante = pv.saldo - importe;
  const filas = pv.periodo.slice(-MAX_FILAS_EMAIL);
  const recorte = pv.periodo.length > filas.length ? `Se muestran los últimos ${filas.length} de ${pv.periodo.length} movimientos del período.` : '';
  const desdeTxt = pv.desde ? `la última rendición (${fechaAR(pv.desde)})` : 'el inicio';
  const ing = (m) => (m.importe > 0 ? pesos(m.importe) : '');
  const egr = (m) => (m.importe < 0 ? pesos(-m.importe) : '');

  const col = (t, n, der) => (der ? String(t).padStart(n) : String(t).slice(0, n).padEnd(n));
  const linea = (f, c, i, e, s) => `${col(f, 10)}  ${col(c, 46)}  ${col(i, 17, 1)}  ${col(e, 17, 1)}  ${col(s, 17, 1)}`;
  const txt = [
    `${saludo},`, '',
    `Se realizó la rendición de ${nombre} del ${fechaAR(fecha)} por ${pesos(importe)}.`,
    ...(nota ? ['', `Nota: ${nota}`] : []), '',
    `Movimientos desde ${desdeTxt}:`,
    linea('FECHA', 'CONCEPTO', 'INGRESOS', 'EGRESOS', 'SALDO'),
    linea('', 'Saldo anterior', '', '', pesos(pv.saldo_anterior)),
    ...filas.map((m) => linea(fechaAR(m.fecha), m.concepto, ing(m), egr(m), pesos(m.saldo))),
    ...(recorte ? [recorte] : []), '',
    `Subtotal en caja: ${pesos(pv.saldo)}`,
    `Rendición de hoy: ${pesos(importe)}`,
    `Saldo que queda en caja: ${pesos(restante)}`, '',
    'Por favor responder "recibido" a este email para dejar constancia.', '',
    `Registrada por ${usuario} en Sistema Caja Estudio.`,
  ].join('\n');

  const td = (v, der, extra = '') => `<td style="padding:6px 8px;border-bottom:1px solid #e3e6ea;${der ? 'text-align:right;white-space:nowrap;' : ''}${extra}">${v}</td>`;
  const th = (v, der) => `<th style="padding:6px 8px;background:#082043;color:#fff;font-size:12px;text-align:${der ? 'right' : 'left'}">${v}</th>`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2326"><p>${saludo},</p>
<p>Se realizó la rendición de <b>${esc(nombre)}</b> del ${fechaAR(fecha)} por <b>${pesos(importe)}</b>.</p>${nota ? `<p>Nota: ${esc(nota)}</p>` : ''}
<p><b>Movimientos desde ${esc(desdeTxt)}</b></p>
<table cellspacing="0" style="border-collapse:collapse;width:100%;font-size:13px"><thead><tr>${th('FECHA')}${th('CONCEPTO')}${th('INGRESOS', 1)}${th('EGRESOS', 1)}${th('SALDO', 1)}</tr></thead><tbody>
<tr>${td('')}${td('<i>Saldo anterior</i>')}${td('', 1)}${td('', 1)}${td(pesos(pv.saldo_anterior), 1)}</tr>
${filas.map((m) => `<tr>${td(fechaAR(m.fecha))}${td(esc(m.concepto))}${td(ing(m), 1, 'color:#0f7b4f')}${td(egr(m), 1, 'color:#d6221f')}${td(pesos(m.saldo), 1)}</tr>`).join('\n')}
</tbody></table>${recorte ? `<p style="color:#5f6872;font-size:12px">${recorte}</p>` : ''}
<table cellspacing="0" style="border-collapse:collapse;margin:14px 0 0 auto;font-size:14px"><tr>${td('Subtotal en caja')}${td(pesos(pv.saldo), 1)}</tr><tr>${td('Rendición de hoy')}${td('<b>' + pesos(importe) + '</b>', 1)}</tr><tr>${td('<b>Saldo que queda en caja</b>')}${td('<b>' + pesos(restante) + '</b>', 1)}</tr></table>
<p>Por favor responder <b>"recibido"</b> a este email para dejar constancia.</p><p style="color:#5f6872;font-size:13px">Registrada por ${esc(usuario)} en Sistema Caja Estudio.</p></div>`;
  return { subject: `Rendición de ${nombre} - ${fechaAR(fecha)}`, text: txt, html };
}
