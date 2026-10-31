import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

export function hashPassword(pass) {
  const sal = randomBytes(16);
  return `${sal.toString('hex')}:${scryptSync(pass, sal, 32).toString('hex')}`;
}

export function verificar(pass, hash) {
  const [sal, h] = hash.split(':');
  const calc = scryptSync(pass, Buffer.from(sal, 'hex'), 32);
  return timingSafeEqual(calc, Buffer.from(h, 'hex'));
}

export function crearSesion(db, usuarioId) {
  const token = randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sesiones(token, usuario_id) VALUES (?, ?)').run(token, usuarioId);
  return token;
}

export function leerCookie(req, nombre) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|; )${nombre}=([^;]*)`));
  return m ? m[1] : null;
}

export function requiereLogin(db) {
  return (req, res, next) => {
    const token = leerCookie(req, 'sesion');
    const u = token && db.prepare(
      'SELECT u.id, u.nombre FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id WHERE s.token = ?',
    ).get(token);
    if (!u) return res.status(401).json({ error: 'No autenticado' });
    req.usuario = u;
    next();
  };
}
