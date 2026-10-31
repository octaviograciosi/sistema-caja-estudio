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
    const id1 = lista.find((m) => m.concepto === 'Cobro').id;
    assert.equal((await j('/movimientos/' + id1, { method: 'PUT', body: { fecha: '2026-06-02', concepto: 'Cobro corregido', importe: 600000 } }, ck)).status, 200);
    assert.equal((await (await j('/cajas/1/movimientos', {}, ck)).json())[0].saldo, 480000);
    // operador: sólo ve su caja, no borra ni administra
    assert.equal((await j('/usuarios', { method: 'POST', body: { nombre: 'luis', password: 'clave123', rol: 'operador', cajas: [2] } }, ck)).status, 201);
    const ck2 = (await j('/login', { method: 'POST', body: { nombre: 'luis', password: 'clave123' } })).headers.get('set-cookie').split(';')[0];
    assert.deepEqual((await (await j('/cajas', {}, ck2)).json()).map((c) => c.id), [2]);
    assert.equal((await j('/cajas/1/movimientos', {}, ck2)).status, 403);
    assert.equal((await j('/cajas/2/movimientos', {}, ck2)).status, 403);
    assert.equal((await j('/cajas/2/movimientos', { method: 'POST', body: { fecha: '2026-06-02', concepto: 'x', importe: 100 } }, ck2)).status, 403);
    assert.equal((await j('/reportes/gastos-por-mes?caja_id=2', {}, ck2)).status, 403);
    assert.deepEqual(Object.keys((await (await j('/cajas', {}, ck2)).json())[0]).sort(), ['id', 'nombre', 'saldo']);
    const pvOp = await (await j('/cajas/2/rendicion/preview', {}, ck2)).json();
    assert.ok(Array.isArray(pvOp.movimientos) && pvOp.movimientos.every((m) => Object.keys(m).sort().join() === 'concepto,fecha,id,importe'));
    assert.equal((await j('/cajas/2/cierres', { method: 'POST', body: { fecha: '2026-06-03', saldo_contado: 0 } }, ck2)).status, 200);
    assert.equal((await j('/movimientos/1', { method: 'DELETE' }, ck2)).status, 403);
    assert.equal((await j('/movimientos/' + id1, { method: 'PUT', body: { fecha: '2026-06-02', concepto: 'x', importe: 1 } }, ck2)).status, 403);
    assert.equal((await j('/usuarios', {}, ck2)).status, 403);
    assert.equal((await j('/respaldo', {}, ck2)).status, 403);
    assert.equal((await j('/respaldo', {}, ck)).status, 200);
    const rep = await (await j('/reportes/gastos-por-mes?caja_id=1', {}, ck)).json();
    assert.deepEqual(rep, [{ mes: '2026-06', categoria: 'Alquiler', total: 120000 }]);
  } finally { srv.close(); }
});
