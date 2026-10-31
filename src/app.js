import express from 'express';
import { unlinkSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword, verificar, crearSesion, requiereLogin, soloAdmin, cajasDe } from './auth.js';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const COOKIE_EXTRA = process.env.NODE_ENV === 'production' ? '; Secure' : '';

export function crearApp(db) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(express.static(new URL('../public', import.meta.url).pathname));

  const auth = requiereLogin(db);
  // Acceso a una caja: admin a todas, operador sólo a las asignadas.
  const conCaja = (req, res, next) => {
    const id = Number(req.params.id ?? req.query.caja_id);
    if (!cajasDe(db, req.usuario).includes(id)) return res.status(403).json({ error: 'Sin acceso a esa caja' });
    req.cajaId = id; next();
  };

  const guardarUsuario = (nombre, password, rol, cajas) => {
    if (!nombre || !password || password.length < 6 || !['admin', 'operador'].includes(rol)) return null;
    const r = db.prepare('INSERT INTO usuarios(nombre, hash, rol) VALUES (?,?,?)').run(nombre, hashPassword(password), rol);
    const id = Number(r.lastInsertRowid);
    for (const c of cajas || []) db.prepare('INSERT OR IGNORE INTO usuario_cajas VALUES (?,?)').run(id, c);
    return id;
  };

  // El primer usuario se crea sin login y es admin; después sólo un admin crea usuarios.
  app.post('/api/usuarios', (req, res, next) => {
    if (db.prepare('SELECT COUNT(*) n FROM usuarios').get().n) return auth(req, res, () => soloAdmin(req, res, next));
    req.primero = true; next();
  }, (req, res) => {
    const { nombre, password, rol, cajas } = req.body || {};
    try {
      const id = guardarUsuario(nombre?.trim(), password, req.primero ? 'admin' : rol, cajas);
      if (!id) return res.status(400).json({ error: 'Nombre, contraseña (mín. 6) y rol válidos requeridos' });
      res.status(201).json({ id });
    } catch { res.status(409).json({ error: 'El usuario ya existe' }); }
  });

  app.post('/api/login', (req, res) => {
    const { nombre, password } = req.body || {};
    const u = db.prepare('SELECT * FROM usuarios WHERE nombre = ?').get(nombre || '');
    if (!u || !verificar(password || '', u.hash)) return res.status(401).json({ error: 'Credenciales inválidas' });
    res.setHeader('Set-Cookie', `sesion=${crearSesion(db, u.id)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${COOKIE_EXTRA}`);
    res.json({ nombre: u.nombre, rol: u.rol });
  });
  app.get('/api/estado', (_req, res) => res.json({ hayUsuarios: db.prepare('SELECT COUNT(*) n FROM usuarios').get().n > 0 }));

  app.use('/api', auth);
  app.get('/api/me', (req, res) => res.json(req.usuario));
  app.post('/api/logout', (req, res) => {
    db.prepare('DELETE FROM sesiones WHERE usuario_id = ?').run(req.usuario.id); res.json({ ok: true });
  });

  // Administración de usuarios
  app.get('/api/usuarios', soloAdmin, (_req, res) => {
    const us = db.prepare('SELECT id, nombre, rol FROM usuarios ORDER BY id').all();
    const uc = db.prepare('SELECT usuario_id, caja_id FROM usuario_cajas').all();
    res.json(us.map((u) => ({ ...u, cajas: uc.filter((x) => x.usuario_id === u.id).map((x) => x.caja_id) })));
  });
  app.put('/api/usuarios/:id', soloAdmin, (req, res) => {
    const { rol, cajas, password } = req.body || {};
    const id = Number(req.params.id);
    if (id === req.usuario.id && rol && rol !== 'admin') return res.status(400).json({ error: 'No podés quitarte el rol de admin' });
    if (rol) db.prepare('UPDATE usuarios SET rol = ? WHERE id = ?').run(rol, id);
    if (password) {
      if (password.length < 6) return res.status(400).json({ error: 'Contraseña de mín. 6 caracteres' });
      db.prepare('UPDATE usuarios SET hash = ? WHERE id = ?').run(hashPassword(password), id);
      db.prepare('DELETE FROM sesiones WHERE usuario_id = ?').run(id);
    }
    if (Array.isArray(cajas)) {
      db.prepare('DELETE FROM usuario_cajas WHERE usuario_id = ?').run(id);
      for (const c of cajas) db.prepare('INSERT OR IGNORE INTO usuario_cajas VALUES (?,?)').run(id, c);
    }
    res.json({ ok: true });
  });

  app.get('/api/cajas', (req, res) => {
    const ids = cajasDe(db, req.usuario);
    res.json(db.prepare(`SELECT c.id, c.nombre, COALESCE(SUM(m.importe),0) saldo
      FROM cajas c LEFT JOIN movimientos m ON m.caja_id = c.id GROUP BY c.id`).all().filter((c) => ids.includes(c.id)));
  });
  app.get('/api/categorias', (_req, res) => res.json(db.prepare('SELECT * FROM categorias ORDER BY id').all()));

  app.get('/api/cajas/:id/movimientos', conCaja, (req, res) => {
    const { desde, hasta, q } = req.query;
    const rows = db.prepare(`SELECT m.*, c.nombre categoria,
        SUM(m.importe) OVER (ORDER BY m.fecha, m.orden, m.id) saldo
      FROM movimientos m LEFT JOIN categorias c ON c.id = m.categoria_id
      WHERE m.caja_id = ? ORDER BY m.fecha, m.orden, m.id`).all(req.cajaId);
    res.json(rows.filter((r) =>
      (!desde || r.fecha >= desde) && (!hasta || r.fecha <= hasta)
      && (!q || r.concepto.toLowerCase().includes(String(q).toLowerCase()))).reverse().slice(0, 1000));
  });

  app.post('/api/cajas/:id/movimientos', conCaja, (req, res) => {
    const { fecha, concepto, importe, categoria_id } = req.body || {};
    if (!FECHA.test(fecha || '') || !concepto?.trim() || !Number.isInteger(importe) || importe === 0) {
      return res.status(400).json({ error: 'fecha (YYYY-MM-DD), concepto e importe (centavos, entero ≠ 0) requeridos' });
    }
    if (importe > 0 && categoria_id) return res.status(400).json({ error: 'Sólo los egresos llevan tipo de egreso' });
    const r = db.prepare(`INSERT INTO movimientos(caja_id, fecha, orden, concepto, importe, categoria_id, usuario_id)
      VALUES (?, ?, (SELECT COALESCE(MAX(orden),0)+1 FROM movimientos WHERE caja_id = ? AND fecha = ?), ?, ?, ?, ?)`)
      .run(req.cajaId, fecha, req.cajaId, fecha, concepto.trim(), importe, categoria_id || null, req.usuario.id);
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  });

  app.delete('/api/movimientos/:id', soloAdmin, (req, res) => {
    const r = db.prepare('DELETE FROM movimientos WHERE id = ?').run(req.params.id);
    res.status(r.changes ? 200 : 404).json({ ok: !!r.changes });
  });

  app.post('/api/cajas/:id/cierres', conCaja, (req, res) => {
    const { fecha, saldo_contado } = req.body || {};
    if (!FECHA.test(fecha || '') || !Number.isInteger(saldo_contado)) return res.status(400).json({ error: 'fecha y saldo_contado (centavos) requeridos' });
    const { s } = db.prepare('SELECT COALESCE(SUM(importe),0) s FROM movimientos WHERE caja_id = ? AND fecha <= ?').get(req.cajaId, fecha);
    db.prepare(`INSERT INTO cierres(caja_id, fecha, saldo_sistema, saldo_contado, usuario_id) VALUES (?,?,?,?,?)
      ON CONFLICT(caja_id, fecha) DO UPDATE SET saldo_sistema=excluded.saldo_sistema, saldo_contado=excluded.saldo_contado, usuario_id=excluded.usuario_id`)
      .run(req.cajaId, fecha, s, saldo_contado, req.usuario.id);
    res.json({ saldo_sistema: s, saldo_contado, diferencia: saldo_contado - s });
  });
  app.get('/api/cajas/:id/cierres', conCaja, (req, res) => {
    res.json(db.prepare('SELECT * FROM cierres WHERE caja_id = ? ORDER BY fecha DESC LIMIT 100').all(req.cajaId));
  });

  app.get('/api/reportes/gastos-por-mes', conCaja, (req, res) => {
    res.json(db.prepare(`SELECT substr(m.fecha,1,7) mes, COALESCE(c.nombre,'Sin tipo') categoria, -SUM(m.importe) total
      FROM movimientos m LEFT JOIN categorias c ON c.id = m.categoria_id
      WHERE m.importe < 0 AND m.caja_id = ?
      GROUP BY mes, categoria ORDER BY mes DESC, categoria`).all(req.cajaId));
  });

  // Respaldo consistente de la base completa (sólo admin).
  app.get('/api/respaldo', soloAdmin, (_req, res) => {
    const f = join(mkdtempSync(join(tmpdir(), 'resp-')), 'caja.db');
    db.exec(`VACUUM INTO '${f}'`);
    res.download(f, `caja-${new Date().toISOString().slice(0, 10)}.db`, () => unlinkSync(f));
  });

  return app;
}
