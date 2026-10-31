# Sistema Caja Estudio

Reemplaza las planillas "Honorarios Caja del Estudio" y "Empresa caja estudio": libro de caja por caja (Honorarios / Empresa), saldo calculado, tipos de egreso, cierre de caja con arqueo, reporte de gastos por mes y usuarios con roles (admin / operador por caja).

## Desarrollo
```bash
npm install
npm start        # http://localhost:3000 (el primer usuario que se crea es admin)
npm test
```

## Importar las planillas
Exportar los valores de cada hoja como JSON `{"values": [[...]]}` y ejecutar:
```bash
node scripts/importar.js honorarios honorarios.json
node scripts/importar.js empresa empresa.json
```
Los saldos resultantes se verificaron contra las planillas (Honorarios 3.571.400,00; Empresa 3.212.100,00).

## Despliegue (Railway / Render / Fly.io)
El `Dockerfile` ya está listo. Requisitos:
- Un **volumen persistente** montado en `/data` (la base es `/data/caja.db`, variable `DB_PATH`).
- Una sola instancia (SQLite).
- Variable `NODE_ENV=production` (cookies `Secure`; el servicio debe servir HTTPS).
- Respaldo: el admin descarga una copia desde la pestaña *Usuarios*, y conviene activar los snapshots del volumen del proveedor.

## Clasificación de egresos históricos
`src/clasificar.js` asigna el tipo de egreso por palabras clave del concepto (se aplica al importar). Para reaplicarlo sobre una base ya cargada: `node scripts/clasificar.js` (con `--ver` lista los que no matchean). ATP → sellados, Secheep → servicios (luz), Miguel → diligencias (cadete). Las **rendiciones** y **extracciones** son retiros de caja, no gastos: se clasifican aparte y el reporte "Gastos por mes" las excluye.
