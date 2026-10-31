import { abrirDb } from './db.js';
import { crearApp } from './app.js';

const port = process.env.PORT || 3000;
crearApp(abrirDb()).listen(port, () => console.log(`Sistema Caja Estudio en http://localhost:${port}`));
