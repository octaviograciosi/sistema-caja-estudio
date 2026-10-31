import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abrirDb } from '../src/db.js';
import { crearApp } from '../src/app.js';

test('flujo: usuario, movimientos, saldo, cierre y reporte', async () => {
  const srv = crearApp(abrirDb(':memory:')).listen(0);
  const base = `http://localhost:${srv.address().port}/api`;
  const j = (u, o = {}, ck) => fetch(base + u, { ...o, headers: { 'Content-Type': 'application/json', ...(ck && { Cookie: ck }) }, body: o.body && JSON.stringify(o.body) });
  try {
    assert.equal((await j('/cajas')).status, 401);
    assert.equal((await j('/usuarios', { method: 'POST', body: { nombre: 'ana', password: 'secreto1' } })).status, 201);
    assert.equal((await j('/usuarios', { method: 'POST', body: { nombre: 'x', password: 'secreto1' } })).status, 401);
    const lg = await j('/login', { method: 'POST', body: { nombre: 'ana', password: 'secreto1' } });
    const ck = lg.headers.get('set-cookie').split(';')[0];
    const mov = (body) => j('/cajas/1/movimientos', { method: 'POST', body }, ck);
    await mov({ fecha: '2026-06-02', concepto: 'Cobro', importe: 500000 });
    await mov({ fecha: '2026-06-03', concepto: 'Alquiler', importe: -120000, categoria_id: 1 });
    assert.equal((await mov({ fecha: '2026-06-03', concepto: 'mal', importe: 100, categoria_id: 1 })).status, 400);
    const lista = await (await j('/cajas/1/movimientos', {}, ck)).json();
    assert.equal(lista[0].saldo, 380000);
    const c = await (await j('/cajas/1/cierres', { method: 'POST', body: { fecha: '2026-06-03', saldo_contado: 370000 } }, ck)).json();
    assert.equal(c.diferencia, -10000);
    const rep = await (await j('/reportes/gastos-por-mes?caja_id=1', {}, ck)).json();
    assert.deepEqual(rep, [{ mes: '2026-06', categoria: 'Alquiler', total: 120000 }]);
  } finally { srv.close(); }
});
