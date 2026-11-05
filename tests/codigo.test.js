// Prueba Codigo.gs + Logica.gs con imitaciones mínimas de los servicios de
// Google (hojas en memoria, Drive en memoria, UrlFetch con respuestas fijas).
// No reemplaza probar en Google, pero atrapa errores de lógica y de API.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const leer = (f) => readFileSync(fileURLToPath(new URL('../apps-script/' + f, import.meta.url)), 'utf8');

function crearGoogle({ tasasRemotas = {}, fuenteCaida = false } = {}) {
  /* ---------------- Hojas ---------------- */
  class Rango {
    constructor(hoja, f, c, nf, nc) { Object.assign(this, { hoja, f, c, nf, nc }); }
    getValues() {
      const r = [];
      for (let i = 0; i < this.nf; i++) {
        const fila = [];
        for (let j = 0; j < this.nc; j++) {
          const v = (this.hoja.datos[this.f - 1 + i] || [])[this.c - 1 + j];
          fila.push(v === undefined ? '' : v);
        }
        r.push(fila);
      }
      return r;
    }
    setValues(v) {
      if (v.length !== this.nf || v.some((f) => f.length !== this.nc)) throw new Error('dimensiones incorrectas');
      if (this.f + this.nf - 1 > this.hoja.maxFilas) throw new Error('Those rows are out of bounds');
      v.forEach((fila, i) => fila.forEach((x, j) => this.hoja.poner(this.f + i, this.c + j, x)));
      return this;
    }
    setValue(x) { this.hoja.poner(this.f, this.c, x); return this; }
    sort(col) {
      const filas = this.getValues().sort((a, b) => (String(a[col - this.c]) < String(b[col - this.c]) ? -1 : 1));
      this.setValues(filas);
    }
    getSheet() { return this.hoja; }
    setNumberFormat() { return this; }
    setFontWeight() { return this; }
    setDataValidation() { return this; }
    setWrap() { return this; }
  }
  class Hoja {
    constructor(nombre) { this.nombre = nombre; this.datos = []; this.maxFilas = 1000; }
    poner(f, c, x) {
      while (this.datos.length < f) this.datos.push([]);
      if (typeof x === 'string' && x.startsWith("'")) x = x.slice(1);
      this.datos[f - 1][c - 1] = x;
    }
    getName() { return this.nombre; }
    getLastRow() {
      for (let i = this.datos.length; i > 0; i--) if ((this.datos[i - 1] || []).some((v) => v !== '' && v !== undefined)) return i;
      return 0;
    }
    getLastColumn() { return Math.max(0, ...this.datos.map((f) => { let n = 0; f.forEach((v, j) => { if (v !== '' && v !== undefined) n = j + 1; }); return n; })); }
    getMaxRows() { return this.maxFilas; }
    insertRowsAfter(_, n) { this.maxFilas += n; }
    getRange(a, b, c, d) {
      if (typeof a === 'string') return new Rango(this, 1, 1, 1, 1); // solo formato
      return new Rango(this, a, b, c || 1, d || 1);
    }
    getDataRange() { return new Rango(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
    appendRow(f) { const r = this.getLastRow() + 1; f.forEach((x, j) => this.poner(r, j + 1, x)); }
    deleteRows(desde, n) { this.datos.splice(desde - 1, n); }
    setFrozenRows() {}
    setColumnWidth() {}
  }
  const libro = {
    hojas: [new Hoja('Hoja 1')],
    getId: () => 'ID_HOJA',
    getSheetByName(n) { return this.hojas.find((h) => h.nombre === n) || null; },
    insertSheet(n) { const h = new Hoja(n); this.hojas.push(h); return h; },
    deleteSheet(h) { this.hojas = this.hojas.filter((x) => x !== h); },
    getSheets() { return this.hojas; },
    setSpreadsheetTimeZone(z) { this.zona = z; }
  };
  const builder = () => new Proxy({}, { get: (t, k) => (k === 'build' ? () => ({}) : () => builder()) });
  const SpreadsheetApp = {
    getActiveSpreadsheet: () => libro,
    openById: () => libro,
    newDataValidation: builder,
    getUi: () => { throw new Error('Cannot call SpreadsheetApp.getUi() from this context.'); }
  };

  /* ---------------- Drive ---------------- */
  let sec = 0;
  class Archivo {
    constructor(nombre, contenido) { this.id = 'f' + ++sec; this.nombre = nombre; this.contenido = contenido; this.actualizado = new Date(); }
    getId() { return this.id; }
    isTrashed() { return false; }
    setContent(c) { this.contenido = c; this.actualizado = new Date(Date.now() + ++sec); return this; }
    getLastUpdated() { return this.actualizado; }
    getBlob() { return { getDataAsString: () => this.contenido }; }
  }
  const iter = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
  class Carpeta {
    constructor(nombre) { this.id = 'd' + ++sec; this.nombre = nombre; this.carpetas = []; this.archivos = []; }
    getId() { return this.id; }
    getName() { return this.nombre; }
    isTrashed() { return false; }
    getFoldersByName(n) { return iter(this.carpetas.filter((c) => c.nombre === n)); }
    createFolder(n) { const c = new Carpeta(n); this.carpetas.push(c); todos.set(c.id, c); return c; }
    getFilesByName(n) { return iter(this.archivos.filter((a) => a.nombre === n)); }
    createFile(n, c) { const a = new Archivo(n, c); this.archivos.push(a); todos.set(a.id, a); return a; }
  }
  const raiz = new Carpeta('Mi unidad');
  const todos = new Map();
  const DriveApp = {
    getRootFolder: () => raiz,
    getFolderById: (id) => { if (!todos.has(id)) throw new Error('no existe'); return todos.get(id); },
    getFileById: (id) => { if (!todos.has(id)) throw new Error('no existe'); return todos.get(id); }
  };

  /* ---------------- Otros ---------------- */
  const props = new Map();
  const PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v) }) };
  const LockService = { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) };
  const disparadores = [];
  const cadena = (registro) => new Proxy({}, { get: (t, k) => (k === 'create' ? () => { disparadores.push(registro); return registro; } : (...a) => { registro[k] = a; return cadena(registro); }) });
  const ScriptApp = {
    getProjectTriggers: () => [...disparadores],
    deleteTrigger: (t) => disparadores.splice(disparadores.indexOf(t), 1),
    newTrigger: (fn) => cadena({ getHandlerFunction: () => fn }),
    getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/PRUEBA/exec' })
  };
  const resp = (codigo, cuerpo) => ({ getResponseCode: () => codigo, getContentText: () => cuerpo });
  const pedidas = [];
  const responder = (url) => {
    pedidas.push(url);
    if (fuenteCaida) return resp(503, 'caído');
    const m = /history\/(\d{4}-\d{2}-\d{2})\.json$/.exec(url);
    if (m) return tasasRemotas[m[1]] ? resp(200, JSON.stringify(tasasRemotas[m[1]])) : resp(404, 'no');
    if (/history\.json$/.test(url)) return resp(200, JSON.stringify(Object.values(tasasRemotas)));
    return resp(404, 'no');
  };
  const UrlFetchApp = { fetch: (u) => responder(u), fetchAll: (reqs) => reqs.map((r) => responder(r.url)) };
  const Utilities = {
    getUuid: () => crypto.randomUUID(),
    Charset: { UTF_8: 'utf8' },
    base64EncodeWebSafe: (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
  };
  const ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ texto: t, setMimeType() { return this; } }) };

  const ctx = {
    SpreadsheetApp, DriveApp, PropertiesService, LockService, ScriptApp, UrlFetchApp, Utilities, ContentService,
    MimeType: { CSV: 'text/csv' }, Logger: { log() {} }, console
  };
  vm.createContext(ctx);
  vm.runInContext(leer('Logica.gs') + '\n' + leer('Codigo.gs'), ctx, { filename: 'apps-script' });
  return { ctx, libro, raiz, props, disparadores, pedidas };
}

const hoy = new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10);
const dia = (n) => new Date(Date.parse(hoy + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const remotas = () => Object.fromEntries([-3, -2, -1, 0].map((n, i) => [dia(n), { USD: 400 + i, EUR: 450 + i, effective_date: dia(n), date: dia(n) }]));

function post(g, cuerpo) {
  const salida = g.ctx.doPost({ postData: { contents: JSON.stringify(cuerpo) } });
  return JSON.parse(salida.texto);
}
const csvDe = (g) => g.raiz.carpetas[0].carpetas[0].archivos.find((a) => a.nombre === 'diario.csv');

describe('Codigo.gs con servicios simulados', () => {
  test('setup crea todo y es idempotente', () => {
    const g = crearGoogle({ tasasRemotas: remotas() });
    g.ctx.setup();
    const nombres = g.libro.hojas.map((h) => h.nombre);
    assert.deepEqual(nombres.sort(), ['Config', 'Diario', 'Log', 'TasasBCV']);
    const diario = g.libro.getSheetByName('Diario');
    assert.equal(diario.datos[0].join(','), g.ctx.ENCABEZADOS_DIARIO.join(','));
    assert.equal(g.libro.zona, 'America/Caracas');
    const token = g.props.get('TOKEN');
    assert.equal(token.length, 64);
    assert.equal(g.raiz.carpetas[0].nombre, 'Banco');
    assert.equal(g.raiz.carpetas[0].carpetas[0].nombre, 'Diario');
    assert.equal(g.disparadores.length, 3);
    assert.equal(g.libro.getSheetByName('TasasBCV').getLastRow(), 5, '4 tasas + encabezado');
    assert.ok(csvDe(g), 'diario.csv creado');
    // Config: url_webapp detectada, enlace pendiente porque falta url_pwa
    const cfg = g.ctx.leerConfig_();
    assert.equal(cfg.ajustes.url_webapp, 'https://script.google.com/macros/s/PRUEBA/exec');
    assert.match(cfg.ajustes.enlace_telefono, /url_pwa/);
    assert.equal(cfg.categorias.length, 18);

    // Segunda vez: no duplica nada y conserva token/carpeta
    g.ctx.escribirAjuste_('url_pwa', 'https://usuario.github.io/finanzas-diario');
    g.libro.getSheetByName('Config').poner(20, 1, 'Mascotas');
    g.ctx.setup();
    assert.equal(g.props.get('TOKEN'), token);
    assert.equal(g.raiz.carpetas.length, 1);
    assert.equal(g.disparadores.length, 3);
    assert.equal(g.libro.getSheetByName('Diario').getLastRow(), 1);
    assert.equal(g.libro.getSheetByName('TasasBCV').getLastRow(), 5);
    const cfg2 = g.ctx.leerConfig_();
    assert.ok(cfg2.categorias.some((c) => c.nombre === 'Mascotas'), 'no pisa la Config editada');
    const enlace = cfg2.ajustes.enlace_telefono;
    assert.match(enlace, /^https:\/\/usuario\.github\.io\/finanzas-diario\/#cfg=/);
    const datos = JSON.parse(Buffer.from(enlace.split('#cfg=')[1], 'base64url').toString());
    assert.deepEqual(datos, { url: 'https://script.google.com/macros/s/PRUEBA/exec', token });
  });

  test('doPost: registrar, idempotencia, exportación, editar, anular', () => {
    const g = crearGoogle({ tasasRemotas: remotas() });
    g.ctx.setup();
    const token = g.props.get('TOKEN');
    assert.deepEqual(post(g, { accion: 'config', token: 'x' }), { ok: false, error: 'no autorizado' });
    const mov = { id: 'aaaaaaaa-1111', fecha: dia(0) + 'T10:00:00-04:00', tipo: 'Gasto', categoria: 'Alimentos', cuenta: 'Banesco Corriente', monto: 806, moneda: 'Bs', descripcion: '=SUMA(A1)', referencia: '000123' };
    const r = post(g, { accion: 'registrar', token, movimientos: [mov] });
    assert.deepEqual(r.guardados, [mov.id]);
    post(g, { accion: 'registrar', token, movimientos: [mov] });
    const diario = g.libro.getSheetByName('Diario');
    assert.equal(diario.getLastRow(), 2, 'sin duplicado');
    const enc = diario.datos[0];
    const fila = Object.fromEntries(enc.map((h, i) => [h, diario.datos[1][i]]));
    assert.equal(typeof fila.fecha.getTime, 'function', 'fecha guardada como fecha');
    assert.equal(fila.monto_usd, -2);
    assert.equal(fila.tasa_provisional, false);
    assert.equal(fila.descripcion, '=SUMA(A1)', 'texto, no fórmula');
    assert.equal(fila.referencia, '000123');
    const csv = csvDe(g).contenido;
    assert.match(csv, new RegExp(`^aaaaaaaa-1111,${dia(0)}T10:00:00-04:00,Gasto,`, 'm'));
    assert.match(csv, /,000123,/);

    const e = post(g, { accion: 'editar', token, id: mov.id, cambios: { monto: 1612 } });
    assert.equal(e.fila.monto_usd, -4);
    const a = post(g, { accion: 'anular', token, id: mov.id });
    assert.equal(a.ok, true);
    assert.equal(diario.getLastRow(), 2);
    assert.match(csvDe(g).contenido, /,true,,\n$/);
    const u = post(g, { accion: 'ultimos', token, n: 5 });
    assert.equal(u.filas[0].fecha, dia(0) + 'T10:00:00');
    const c = post(g, { accion: 'config', token });
    assert.equal(c.tasa.fecha, dia(0));
    assert.equal(c.config.ajustes, undefined);
  });

  test('tasas: si la fuente cae nada se rompe; cuando vuelve, rellena provisionales', () => {
    const g = crearGoogle({ fuenteCaida: true });
    g.ctx.setup();
    const token = g.props.get('TOKEN');
    const mov = { id: 'bbbbbbbb-2222', fecha: dia(0) + 'T09:00', tipo: 'Ingreso', categoria: 'Salarios', cuenta: 'Banesco Corriente', monto: 403, moneda: 'Bs' };
    assert.equal(post(g, { accion: 'registrar', token, movimientos: [mov] }).ok, true);
    let f = post(g, { accion: 'ultimos', token }).filas[0];
    assert.equal(f.tasa_bcv_usd, '');
    assert.equal(f.monto_usd, '');
    assert.equal(f.tasa_provisional, true);
    assert.ok(g.libro.getSheetByName('Log').getLastRow() >= 2, 'el error quedó en Log');

    const g2 = g; // la fuente vuelve
    g2.ctx.UrlFetchApp.fetchAll = (reqs) => reqs.map((r) => {
      const d = /(\d{4}-\d{2}-\d{2})\.json$/.exec(r.url)[1];
      const t = remotas()[d];
      return { getResponseCode: () => (t ? 200 : 404), getContentText: () => JSON.stringify(t) };
    });
    g2.ctx.tareaDiariaTasas();
    f = post(g, { accion: 'ultimos', token }).filas[0];
    assert.equal(f.tasa_bcv_usd, 403);
    assert.equal(f.monto_usd, 1);
    assert.equal(f.tasa_provisional, false);
  });

  test('importar conciliacion_estado.csv', () => {
    const g = crearGoogle({ tasasRemotas: remotas() });
    g.ctx.setup();
    const token = g.props.get('TOKEN');
    const base = { fecha: dia(0) + 'T09:00', tipo: 'Gasto', categoria: 'Ocio', cuenta: 'Banesco Corriente', monto: 1, moneda: 'Bs' };
    post(g, { accion: 'registrar', token, movimientos: [{ ...base, id: 'id-00000001' }, { ...base, id: 'id-00000002' }] });
    const carpeta = g.raiz.carpetas[0].carpetas[0];
    assert.match(g.ctx.importarConciliacion_(false).resumen, /No hay/);
    carpeta.createFile('conciliacion_estado.csv', '﻿id,estado_conciliacion,conciliado_con\r\nid-00000002,conciliado,"BAN 2026-11-04, ref 55"\r\nno-existe,conciliado,x\r\n');
    assert.match(g.ctx.importarConciliacion_(false).resumen, /^1 anotaciones actualizadas\. 1 ids no existen/);
    assert.match(g.ctx.importarConciliacion_(false).resumen, /Sin cambios/);
    const filas = post(g, { accion: 'ultimos', token }).filas;
    const f2 = filas.find((f) => f.id === 'id-00000002');
    assert.equal(f2.estado_conciliacion, 'conciliado');
    assert.equal(f2.conciliado_con, 'BAN 2026-11-04, ref 55');
    assert.match(csvDe(g).contenido, /"BAN 2026-11-04, ref 55"/);
  });

  test('crece la hoja cuando se llena', () => {
    const g = crearGoogle({ tasasRemotas: remotas() });
    g.ctx.setup();
    const token = g.props.get('TOKEN');
    g.libro.getSheetByName('Diario').maxFilas = 3;
    const movs = Array.from({ length: 5 }, (_, i) => ({ id: `lleno-000${i}`, fecha: dia(0) + 'T09:00', tipo: 'Gasto', categoria: 'Ocio', cuenta: 'Efectivo Bs', monto: 1, moneda: 'Bs' }));
    assert.equal(post(g, { accion: 'registrar', token, movimientos: movs }).guardados.length, 5);
    assert.equal(g.libro.getSheetByName('Diario').getLastRow(), 6);
  });
});
