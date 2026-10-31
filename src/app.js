import express from 'express';
import { hashPassword, verificar, crearSesion, requiereLogin } from './auth.js';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export function crearApp(db) {
  const app = express();
  app.use(express.json());
  app.use(express.static(new URL('../public', import.meta.url).pathname));

  // Primer usuario: se crea sin login; después sólo lo crea un usuario autenticado.
  const auth = requiereLogin(db);
  app.post('/api/usuarios', (req, res, next) => {
    const hay = db.prepare('SELECT COUNT(*) n FROM usuarios').get().n;
    return hay ? auth(req, res, next) : next();
  }, (req, res) => {
    const { nombre, password } = req.body || {};
    if (!nombre || !password || password.length < 6) return res.status(400).json({ error: 'Nombre y contraseña (mín. 6) requeridos' });
    try {
      db.prepare('INSERT INTO usuarios(nombre, hash) VALUES (?, ?)').run(nombre, hashPassword(password));
    } catch { return res.status(409).json({ error: 'El usuario ya existe' }); }
    res.status(201).json({ ok: true });
  });

  app.post('/api/login', (req, res) => {
    const { nombre, password } = req.body || {};
    const u = db.prepare('SELECT * FROM usuarios WHERE nombre = ?').get(nombre || '');
    if (!u || !verificar(password || '', u.hash)) return res.status(401).json({ error: 'Credenciales inválidas' });
    const token = crearSesion(db, u.id);
    res.setHeader('Set-Cookie', `sesion=${token}; HttpOnly; SameSite=Strict; Path=/`);
    res.json({ nombre: u.nombre });
  });

  app.get('/api/estado', (req, res) => {
    res.json({ hayUsuarios: db.prepare('SELECT COUNT(*) n FROM usuarios').get().n > 0 });
  });

  app.use('/api', auth);

  app.get('/api/cajas', (_req, res) => {
    res.json(db.prepare(`SELECT c.id, c.nombre, COALESCE(SUM(m.importe),0) saldo
      FROM cajas c LEFT JOIN movimientos m ON m.caja_id = c.id GROUP BY c.id`).all());
  });
  app.get('/api/categorias', (_req, res) => res.json(db.prepare('SELECT * FROM categorias ORDER BY id').all()));

  // Movimientos con saldo acumulado calculado por el sistema (ya no hay fórmulas que se rompan).
  app.get('/api/cajas/:id/movimientos', (req, res) => {
    const { desde, hasta, q } = req.query;
    const rows = db.prepare(`SELECT m.*, c.nombre categoria,
        SUM(m.importe) OVER (ORDER BY m.fecha, m.orden, m.id) saldo
      FROM movimientos m LEFT JOIN categorias c ON c.id = m.categoria_id
      WHERE m.caja_id = ? ORDER BY m.fecha, m.orden, m.id`).all(req.params.id);
    res.json(rows.filter((r) =>
      (!desde || r.fecha >= desde) && (!hasta || r.fecha <= hasta)
      && (!q || r.concepto.toLowerCase().includes(String(q).toLowerCase()))).reverse().slice(0, 1000));
  });

  app.post('/api/cajas/:id/movimientos', (req, res) => {
    const { fecha, concepto, importe, categoria_id } = req.body || {};
    if (!FECHA.test(fecha || '') || !concepto || !Number.isInteger(importe) || importe === 0) {
      return res.status(400).json({ error: 'fecha (YYYY-MM-DD), concepto e importe (centavos, entero ≠ 0) requeridos' });
    }
    if (importe > 0 && categoria_id) return res.status(400).json({ error: 'Sólo los egresos llevan tipo de egreso' });
    const caja = db.prepare('SELECT id FROM cajas WHERE id = ?').get(req.params.id);
    if (!caja) return res.status(404).json({ error: 'Caja inexistente' });
    const r = db.prepare(`INSERT INTO movimientos(caja_id, fecha, orden, concepto, importe, categoria_id, usuario_id)
      VALUES (?, ?, (SELECT COALESCE(MAX(orden),0)+1 FROM movimientos WHERE caja_id = ? AND fecha = ?), ?, ?, ?, ?)`)
      .run(caja.id, fecha, caja.id, fecha, concepto.trim(), importe, categoria_id || null, req.usuario.id);
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  });

  app.delete('/api/movimientos/:id', (req, res) => {
    const r = db.prepare('DELETE FROM movimientos WHERE id = ?').run(req.params.id);
    res.status(r.changes ? 200 : 404).json({ ok: !!r.changes });
  });

  // Cierre de caja: compara el saldo del sistema con lo contado a esa fecha.
  app.post('/api/cajas/:id/cierres', (req, res) => {
    const { fecha, saldo_contado } = req.body || {};
    if (!FECHA.test(fecha || '') || !Number.isInteger(saldo_contado)) return res.status(400).json({ error: 'fecha y saldo_contado (centavos) requeridos' });
    const { s } = db.prepare('SELECT COALESCE(SUM(importe),0) s FROM movimientos WHERE caja_id = ? AND fecha <= ?').get(req.params.id, fecha);
    db.prepare(`INSERT INTO cierres(caja_id, fecha, saldo_sistema, saldo_contado, usuario_id) VALUES (?,?,?,?,?)
      ON CONFLICT(caja_id, fecha) DO UPDATE SET saldo_sistema=excluded.saldo_sistema, saldo_contado=excluded.saldo_contado, usuario_id=excluded.usuario_id`)
      .run(req.params.id, fecha, s, saldo_contado, req.usuario.id);
    res.json({ saldo_sistema: s, saldo_contado, diferencia: saldo_contado - s });
  });
  app.get('/api/cajas/:id/cierres', (req, res) => {
    res.json(db.prepare('SELECT * FROM cierres WHERE caja_id = ? ORDER BY fecha DESC LIMIT 100').all(req.params.id));
  });

  // Reemplaza "Suma gastos por mes": egresos por tipo y mes.
  app.get('/api/reportes/gastos-por-mes', (req, res) => {
    const { caja_id } = req.query;
    res.json(db.prepare(`SELECT substr(m.fecha,1,7) mes, COALESCE(c.nombre,'Sin tipo') categoria, -SUM(m.importe) total
      FROM movimientos m LEFT JOIN categorias c ON c.id = m.categoria_id
      WHERE m.importe < 0 AND (? IS NULL OR m.caja_id = ?)
      GROUP BY mes, categoria ORDER BY mes DESC, categoria`).all(caja_id || null, caja_id || null));
  });

  return app;
}
