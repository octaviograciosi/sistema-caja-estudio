import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abrirDb } from '../src/db.js';
import { crearApp } from '../src/app.js';
import { hoyAR } from '../src/rendicion.js';

async function montar(opts) {
  const srv = crearApp(abrirDb(':memory:'), opts).listen(0);
  const base = `http://localhost:${srv.address().port}/api`;
  const j = (u, o = {}, ck) => fetch(base + u, { ...o, headers: { 'Content-Type': 'application/json', ...(ck && { Cookie: ck }) }, body: o.body && JSON.stringify(o.body) });
  await j('/usuarios', { method: 'POST', body: { nombre: 'ana', password: 'secreto1' } });
  const ck = (await j('/login', { method: 'POST', body: { nombre: 'ana', password: 'secreto1' } })).headers.get('set-cookie').split(';')[0];
  const mov = (body) => j('/cajas/1/movimientos', { method: 'POST', body }, ck);
  return { srv, j, ck, mov };
}
const dest = { to: ['octavio@ej.com'], cc: ['mariano@ej.com', 'agostina@ej.com'] };

test('rendición: envía email, registra el retiro y respeta el saldo', async () => {
  const enviados = [];
  const { srv, j, ck, mov } = await montar({ mailer: { send: async (m) => enviados.push(m) }, destinatarios: dest });
  try {
    await mov({ fecha: '2026-10-01', concepto: 'COBRO UNO', importe: 1000000 });
    await mov({ fecha: '2026-10-02', concepto: 'GASTO LIBRERIA', importe: -100000, categoria_id: 6 });
    const pv = await (await j('/cajas/1/rendicion/preview', {}, ck)).json();
    assert.equal(pv.saldo, 900000); assert.equal(pv.ingresos, 1); assert.equal(pv.destinatarios.length, 3);
    assert.equal((await j('/cajas/1/rendicion', { method: 'POST', body: { importe: 900001 } }, ck)).status, 400);
    const r = await j('/cajas/1/rendicion', { method: 'POST', body: { importe: 900000, nota: 'semana 1' } }, ck);
    assert.equal(r.status, 201);
    assert.equal(enviados.length, 1);
    assert.deepEqual(enviados[0].to, dest.to); assert.deepEqual(enviados[0].cc, dest.cc);
    assert.match(enviados[0].subject, /^Rendición de honorarios - \d\d\/\d\d\/\d{4}$/);
    assert.match(enviados[0].text, /COBRO UNO/); assert.match(enviados[0].text, /recibido/);
    const lista = await (await j('/cajas/1/movimientos', {}, ck)).json();
    assert.equal(lista[0].importe, -900000); assert.equal(lista[0].categoria, 'Rendiciones'); assert.equal(lista[0].saldo, 0);
    const h = await (await j('/cajas/1/rendiciones', {}, ck)).json();
    assert.equal(h.length, 1); assert.equal(h[0].estado, 'enviada');
    assert.equal((await j(`/rendiciones/${h[0].id}/recibida`, { method: 'POST' }, ck)).status, 200);
    // la siguiente vista parte de la última rendición
    await mov({ fecha: hoyAR(), concepto: 'COBRO DOS', importe: 50000 });
    const pv2 = await (await j('/cajas/1/rendicion/preview', {}, ck)).json();
    assert.equal(pv2.ingresos, 1); assert.equal(pv2.total_ingresos, 50000);
  } finally { srv.close(); }
});

test('rendición: si el email falla o no hay correo configurado no registra nada', async () => {
  for (const [opts, status] of [[{ mailer: { send: async () => { throw new Error('smtp'); } }, destinatarios: dest }, 502], [{ mailer: null, destinatarios: dest }, 503]]) {
    const { srv, j, ck, mov } = await montar(opts);
    try {
      await mov({ fecha: '2026-10-01', concepto: 'COBRO', importe: 100000 });
      assert.equal((await j('/cajas/1/rendicion', { method: 'POST', body: { importe: 100000 } }, ck)).status, status);
      assert.equal((await (await j('/cajas/1/movimientos', {}, ck)).json()).length, 1);
      assert.equal((await (await j('/cajas/1/rendiciones', {}, ck)).json()).length, 0);
    } finally { srv.close(); }
  }
});
