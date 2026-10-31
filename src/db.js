import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const CATEGORIAS = [
  'Alquiler', 'Expensas', 'Diligencias (cadete)', 'Diligencias (tickets organismos, etc.)',
  'Servicio de limpieza', 'Librería', 'Tóners', 'Productos de limpieza y varios',
  'Servicios (luz, internet, etc.)', 'Otros', 'Extracciones', 'Rendiciones',
  'Devoluciones',
];

export function abrirDb(ruta = process.env.DB_PATH || 'data/caja.db') {
  if (ruta !== ':memory:') mkdirSync(dirname(ruta), { recursive: true });
  const db = new DatabaseSync(ruta);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS cajas (
      id INTEGER PRIMARY KEY, nombre TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS categorias (
      id INTEGER PRIMARY KEY, nombre TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY, nombre TEXT NOT NULL UNIQUE, hash TEXT NOT NULL,
      rol TEXT NOT NULL DEFAULT 'operador' CHECK (rol IN ('admin','operador'))
    );
    CREATE TABLE IF NOT EXISTS usuario_cajas (
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      caja_id INTEGER NOT NULL REFERENCES cajas(id),
      PRIMARY KEY (usuario_id, caja_id)
    );
    CREATE TABLE IF NOT EXISTS sesiones (
      token TEXT PRIMARY KEY, usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      creada TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    -- importe en centavos; positivo = ingreso, negativo = egreso
    CREATE TABLE IF NOT EXISTS movimientos (
      id INTEGER PRIMARY KEY,
      caja_id INTEGER NOT NULL REFERENCES cajas(id),
      fecha TEXT NOT NULL,            -- YYYY-MM-DD
      orden INTEGER NOT NULL DEFAULT 0,
      concepto TEXT NOT NULL,
      importe INTEGER NOT NULL,
      categoria_id INTEGER REFERENCES categorias(id),
      usuario_id INTEGER REFERENCES usuarios(id),
      creado TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_mov_caja_fecha ON movimientos(caja_id, fecha, orden, id);
    CREATE TABLE IF NOT EXISTS cierres (
      id INTEGER PRIMARY KEY,
      caja_id INTEGER NOT NULL REFERENCES cajas(id),
      fecha TEXT NOT NULL,
      saldo_sistema INTEGER NOT NULL,
      saldo_contado INTEGER NOT NULL,
      usuario_id INTEGER REFERENCES usuarios(id),
      UNIQUE(caja_id, fecha)
    );
  `);
  const ins = db.prepare('INSERT OR IGNORE INTO cajas(nombre) VALUES (?)');
  ['Honorarios', 'Empresa'].forEach((n) => ins.run(n));
  const insCat = db.prepare('INSERT OR IGNORE INTO categorias(nombre) VALUES (?)');
  CATEGORIAS.forEach((n) => insCat.run(n));
  return db;
}

export const pesos = (centavos) => centavos / 100;
