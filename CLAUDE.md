# CLAUDE.md — Finanzas Diario

Notas para que otra sesión siga trabajando sin preguntar. El repositorio es **público**: nunca agregues datos personales (números de cuenta, nombres de personas, URL del Web App, token, enlaces `#cfg`). Las cuentas y categorías por defecto son genéricas y el usuario las cambia en la hoja.

## Qué es

Anotador personal de ingresos y gastos en bolívares (Venezuela). El usuario anota desde el teléfono en menos de 10 segundos, con o sin internet. Todo queda en una Google Sheet de su Drive y se exporta a un CSV que sus scripts de Python (en su PC, fuera de este repo) concilian contra los estados de cuenta del banco.

Requisitos que no se negocian: **costo 0 y mantenimiento 0**. Sin servidores, sin dominios, sin dependencias npm en tiempo de ejecución, sin GitHub Actions, sin bundler ni frameworks.

## Arquitectura

```
Teléfono (PWA en GitHub Pages, /docs)
   │  POST text/plain {accion, token, …}  (sin preflight CORS)
   ▼
Google Apps Script vinculado a la hoja "Finanzas – Diario" (Web App: ejecutar como yo, acceso: cualquiera)
   │  escribe hojas Diario / TasasBCV / Log; lee Config
   │  exporta tras cada cambio ──► Drive: Mi unidad/Banco/Diario/diario.csv ──► Drive para escritorio ──► scripts del PC
   │  importa (diario 06:00 o menú) ◄── Banco/Diario/conciliacion_estado.csv ◄── scripts del PC
   │  disparador diario ~18:30 Caracas ◄── tasas BCV (grupoclip/bcv-api)
```

| Carpeta | Contenido |
|---|---|
| `docs/` | PWA estática (GitHub Pages: Deploy from a branch → `main` → `/docs`). `.nojekyll` evita Jekyll. |
| `docs/js/app.js` | Interfaz (DOM). Único módulo no probado en Node; se cubre con la prueba E2E. |
| `docs/js/montos.js`, `fechas.js`, `datos.js` | Funciones puras (parseo de montos, hora de Caracas, chips/sugerencias, config por defecto). |
| `docs/js/cola.js` | Cola de envíos con almacén inyectable + `sincronizar()`. `idb.js` = almacén IndexedDB. |
| `docs/js/api.js` | `fetch` al Web App, errores `ErrorRed`/`ErrorAuth`, enlace `#cfg`. |
| `docs/sw.js` | Service worker con caché versionada (`VERSION`) y lista `ARCHIVOS`. |
| `apps-script/Logica.gs` | Funciones **puras** (sin servicios de Google). También se carga en Node vía `vm`. Contiene `manejarPeticion()` = toda la API. |
| `apps-script/Codigo.gs` | Solo E/S con Google: `doPost`, `setup`, menú, disparadores, exportar/importar, tasas, Log. |
| `apps-script/appsscript.json` | Zona `America/Caracas`, V8, Web App, scopes. |
| `tools/mock-server.js` | Servidor Node sin dependencias: imita el Web App usando `Logica.gs` y sirve `/docs`. |
| `tools/generar-iconos.js` | Rehace `docs/icons/*.png` desde `tools/icono.svg` con el Chromium de Playwright. |
| `tests/` | `node --test` (ver abajo). |

En Apps Script todos los `.gs` comparten el ámbito global: no repitas nombres entre `Codigo.gs` y `Logica.gs`. Al final de `Logica.gs` hay un `module.exports` condicional (en Apps Script `module` no existe).

## Hojas

- **Diario**: una fila por anotación, columnas = contrato de `diario.csv` (abajo). `fecha`, `registrado`, `modificado` se guardan como fecha real; columnas de texto con formato `@` (conserva ceros a la izquierda en `referencia`); los textos que empiezan con `=`, `+` o `@` se escriben con apóstrofo para que no sean fórmulas.
- **Config**: tablas que edita el usuario; la app las lee con `{accion:"config"}`. Columnas (fila 1 = encabezados, se lee hasta la última fila con dato):
  - A–B `categoria | tipo` (tipo vacío = sirve para todos los tipos)
  - D–F `cuenta | moneda | bancaria` (Sí/No)
  - H `medio`
  - J `moneda`
  - L–M `clave | valor`: `url_webapp`, `url_pwa`, `enlace_telefono`, `nota`. **Nunca** se envían a la app (el enlace contiene el token).
- **TasasBCV**: `fecha | usd | eur | fuente | actualizado`; `fecha` como texto `AAAA-MM-DD`, una fila por día del calendario.
- **Log**: `fecha | funcion | mensaje | detalle`; se recorta a ~500 filas.

Script Properties: `TOKEN`, `SPREADSHEET_ID`, `DIARIO_FOLDER_ID`, `DIARIO_CSV_ID`, `CONCILIACION_ULTIMA`.

## Contrato `diario.csv`

UTF-8 **sin BOM**, separador coma, fin de línea `\n`, comillas RFC 4180 solo cuando hacen falta. Encabezados exactos, en este orden:

```
id,fecha,tipo,categoria,cuenta,cuenta_destino,descripcion,monto,moneda,medio,referencia,tasa_bcv_usd,tasa_usada,monto_bs,monto_usd,tasa_provisional,registrado,modificado,dispositivo,anulado,estado_conciliacion,conciliado_con
```

| Columna | Formato / significado |
|---|---|
| `id` | UUID generado en el teléfono. Único. |
| `fecha` | Fecha-hora real de la operación, ISO 8601 con zona de Caracas: `2026-11-04T14:30:00-04:00`. |
| `tipo` | `Gasto`, `Ingreso` o `Traspaso`. |
| `categoria`, `cuenta`, `medio`, `descripcion`, `referencia`, `dispositivo` | Texto. `referencia` puede tener ceros a la izquierda. |
| `cuenta_destino` | Solo en traspasos; vacío en los demás. |
| `monto` | Positivo, en `moneda`. Punto decimal, sin separador de miles. |
| `moneda` | `Bs`, `USD`, `EUR`, `USDT` (u otras de Config, sin conversión). |
| `tasa_bcv_usd` | Bs por USD del BCV para el día de `fecha` (vacío si no hay ninguna tasa). |
| `tasa_usada` | Bs por unidad de `moneda` usada para `monto_bs`: Bs=1, USD/USDT = tasa USD, EUR = tasa EUR. |
| `monto_bs`, `monto_usd` | Con signo: Gasto y Traspaso negativos, Ingreso positivo. Redondeo a 2 decimales. Vacíos si falta la tasa necesaria. |
| `tasa_provisional` | `true` si no había tasa del día exacto (se usó la última anterior o ninguna). El disparador diario la corrige. |
| `registrado`, `modificado` | Hora del servidor al recibir / al último cambio, mismo formato que `fecha`. |
| `anulado` | `true`/`false`. Las filas anuladas **siguen en el CSV**; los scripts deben ignorarlas. |
| `estado_conciliacion`, `conciliado_con` | Los escribe solo la importación de `conciliacion_estado.csv`. |

Booleanos siempre `true`/`false` en minúscula. Se sobrescribe siempre el mismo archivo (`setContent`, mismo id) para que Drive para escritorio lo sincronice.

## Contrato `conciliacion_estado.csv`

Lo escriben los scripts del PC en `Banco/Diario/`. UTF-8 (con o sin BOM), separador coma (también acepta `;`), encabezados (sin importar mayúsculas ni orden):

```
id,estado_conciliacion,conciliado_con
```

- Por cada `id` existente se reemplazan esas dos columnas en Diario. Si falta una de las dos columnas, esa no se toca.
- Los `id` que no existen se cuentan y se ignoran. Valores libres (p. ej. `conciliado`, `pendiente`, `diferencia`; `conciliado_con` = referencia del extracto).
- Se importa a diario (~06:00) solo si el archivo cambió, o siempre desde el menú. Después se reexporta `diario.csv`.

## Reglas de negocio

- **Tasa de un día D** = fila de TasasBCV con la mayor `fecha` ≤ D (relleno hacia adelante). `exacta` si hay fila con `fecha` = D; si no, `tasa_provisional = true`.
- **Fuente de tasas**: `https://raw.githubusercontent.com/grupoclip/bcv-api/main/api/v1/history/AAAA-MM-DD.json` (respaldo `https://bcv.today/api/v1/…`, mismo contenido). Convención verificada clonando el repo (rama `main`):
  - El **nombre del archivo es el día del calendario** (campo `date`), y su contenido es la tasa **vigente ese día**. `effective_date` = fecha valor del BCV.
  - Hay un archivo por cada día del calendario desde 2021-08-02, sin huecos. Fines de semana y feriados repiten la tasa anterior (`effective_date` apunta al último día hábil). Esos archivos de relleno se crean el mismo día.
  - El BCV publica ~16:30 la tasa del **siguiente** día hábil, así que el archivo de mañana suele existir desde la tarde anterior (por eso el disparador de 18:30 pide hasta hoy+1; un 404 es normal).
  - Campos: `USD`, `EUR`, `CNY`, `TRY`, `RUB`, `updated_at`, `effective_date`, `date`. Los históricos anteriores a 2026 (y el 2026-03-09) solo traen `USD`: en esos días `eur` queda vacío.
  - `api/v1/history.json` trae ~1830 días en un solo archivo: se usa cuando faltan más de 15 días (setup pide 400).
- Disparador diario `tareaDiariaTasas` (~18:30 Caracas): trae los días faltantes de los últimos 10 días + mañana + días con filas provisionales, y recalcula esas filas. Si la fuente falla, solo se escribe en Log; las filas quedan provisionales (o con tasa vacía si nunca hubo tasa) y la conciliación local puede completarlas.
- **Conversión**: Bs=1; USD = tasa USD; EUR = tasa EUR; USDT = 1 USD. Signos: Gasto −, Ingreso +, Traspaso − (desde la cuenta origen). Un traspaso guarda un solo monto en la moneda de origen.
- **Idempotencia**: `registrar` ignora ids existentes (y repetidos en el mismo lote) pero los reporta en `guardados` para que el teléfono los saque de la cola. Todo `doPost` corre con `LockService`.
- **Anular** = `anulado=true`. Nunca se borran filas del Diario.
- **Zona horaria**: `America/Caracas` (UTC−4 fijo) en `appsscript.json` y en la hoja; `Logica.gs` y la PWA calculan con offset fijo −04:00.
- Validación en servidor (`validarMovimiento`): id `[A-Za-z0-9_-]{8,64}`, tipo válido, monto > 0, fecha ISO, cuenta, categoría (en traspaso por defecto `Entre Cuentas`), destino ≠ origen, moneda en Config. Categorías/cuentas/medios **no** se validan contra Config (para no rechazar anotaciones viejas si se renombra algo).

## API del Web App

Todo por `POST` al `/exec`, cuerpo JSON como `text/plain`, respuesta JSON. Token inválido → `{ok:false, error:"no autorizado"}` sin más detalles.

| Petición | Respuesta |
|---|---|
| `{accion:"config", token}` | `{ok, version, ahora, config:{categorias:[{nombre,tipo}], cuentas:[{nombre,moneda,bancaria}], medios:[], monedas:[]}, tasa:{fecha,usd,eur}\|null, sugerencias:[{descripcion,n,ultimo,tipo,categoria,cuenta,medio,cuenta_destino}], uso:{categorias:{tipo:{nombre:n}}, cuentas:{tipo:{…}}, destinos:{}, medios:{}}}` |
| `{accion:"registrar", token, movimientos:[{id,fecha,tipo,categoria,cuenta,cuenta_destino,descripcion,monto,moneda,medio,referencia,dispositivo,anulado?}]}` | `{ok, guardados:[id], duplicados:[id], rechazados:[{id,error}]}` (máx. 500 por lote; la PWA manda 50) |
| `{accion:"editar", token, id, cambios:{…}}` | `{ok, fila}` o `{ok:false, error}`. Solo campos de `CAMPOS_EDITABLES`; recalcula tasas y montos. |
| `{accion:"anular", token, id}` | `{ok, fila}` |
| `{accion:"ultimos", token, n}` | `{ok, filas}` (n ≤ 200, ordenadas por fecha desc). |

`ok:false, error:"ocupado, reintenta"` si no obtuvo el lock en 30 s (la PWA lo trata como error de red).

## PWA

- Formulario: tipo → monto (foco inicial, `inputmode="decimal"`) → descripción con autocompletado → chips de cuenta / destino / categoría / medio → "Fecha y referencia" plegado → Guardar.
- Montos: coma = decimal; punto = decimal solo si le siguen 1 o 2 dígitos al final; si no, separador de miles (`parsearMonto`).
- Guardar **siempre** encola primero en IndexedDB y luego intenta enviar. Sincroniza al guardar, al evento `online`, al abrir/volver a la app y cada 60 s mientras haya pendientes. Elementos rechazados por validación quedan marcados con `error` y no se reintentan hasta editarlos.
- Editar/anular: si el movimiento sigue en la cola se cambia ahí; si ya está en el servidor se encola un `editar` (acumulativo) o `anular`. Si se edita mientras viaja, la diferencia se manda como `editar`.
- localStorage: `fd.ajustes` (url, token, dispositivo), `fd.config` (respuesta de config), `fd.local` (uso, últimas cuentas por tipo, medio por cuenta, sugerencias locales), `fd.ultimos`, `fd.sync`.
- Configuración por enlace `…/#cfg=<base64url de {"url","token"}>`: solo acepta `https://` (o `http://localhost` para el mock); pide confirmación si reemplaza otra URL; limpia el hash.
- **Al cambiar cualquier archivo de `docs/`**: sube `VERSION` en `docs/js/version.js` **y** `docs/sw.js`, y agrega archivos nuevos a `ARCHIVOS` en `sw.js` (las pruebas verifican ambas cosas).

## Pruebas

```bash
node --test                       # todo: Logica, Codigo (Google simulado), PWA, E2E
node --test tests/logica.test.js  # solo backend puro
node tools/mock-server.js         # PWA + API simulada en http://localhost:8787 (imprime el enlace #cfg)
```

- `tests/logica.test.js`: tasas, conversiones, validación, idempotencia, CSV, API.
- `tests/codigo.test.js`: `Codigo.gs` con imitaciones en memoria de SpreadsheetApp, DriveApp, UrlFetchApp, etc.
- `tests/pwa.test.js`: montos, fechas, cola, `#cfg`, coherencia de versión/manifest/precaché, config por defecto = la de `Logica.gs`.
- `tests/e2e.test.js`: Chromium (Playwright, si está instalado; si no, se salta) contra el mock: anotar sin red, recargar sin red, volver la red, respuesta perdida sin duplicar, autocompletar, editar, anular.

No hay dependencias npm: Playwright solo se usa si ya está instalado globalmente.

## Pendientes / ideas

- Traspasos entre monedas distintas (p. ej. Bs → USDT) guardan un solo monto en la moneda de origen.
- No hay Background Sync: si cierras la app sin red, lo pendiente se envía la próxima vez que la abras.
- Ediciones hechas a mano en la hoja no recalculan `monto_bs`/`monto_usd` (sí reexportan el CSV gracias a `alEditarHoja`).
