/**
 * Codigo.gs — Web App, menú, disparadores, exportación e importación.
 * Toda la lógica de negocio está en Logica.gs; aquí solo hay entrada/salida
 * con Google (hojas, Drive, UrlFetch, propiedades).
 */

var HOJA_DIARIO = 'Diario';
var HOJA_CONFIG = 'Config';
var HOJA_TASAS = 'TasasBCV';
var HOJA_LOG = 'Log';
var CARPETA_BANCO = 'Banco';
var CARPETA_DIARIO = 'Diario';
var ARCHIVO_CSV = 'diario.csv';
var ARCHIVO_CONCILIACION = 'conciliacion_estado.csv';

var PROP_TOKEN = 'TOKEN';
var PROP_CARPETA = 'DIARIO_FOLDER_ID';
var PROP_CSV = 'DIARIO_CSV_ID';
var PROP_HOJA = 'SPREADSHEET_ID';
var PROP_CONCILIACION = 'CONCILIACION_ULTIMA';

var MANEJADORES = ['tareaDiariaTasas', 'tareaDiariaConciliacion', 'alEditarHoja'];

/* ------------------------------------------------------------------ */
/* Web App                                                             */
/* ------------------------------------------------------------------ */

function doGet() {
  return json_({ ok: true, app: 'finanzas-diario', version: VERSION_BACKEND, mensaje: 'Usa POST.' });
}

function doPost(e) {
  var cuerpo = e && e.postData ? e.postData.contents : '';
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    return json_({ ok: false, error: 'ocupado, reintenta' });
  }
  try {
    var r = manejarPeticion(cuerpo, almacenHoja_(), new Date());
    if (r.cambio) exportarSeguro_();
    return json_(r.respuesta);
  } catch (err) {
    registrarLog_('doPost', err);
    return json_({ ok: false, error: 'error interno' });
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------------------------ */
/* Acceso a la hoja                                                    */
/* ------------------------------------------------------------------ */

function libro_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;
  var id = PropertiesService.getScriptProperties().getProperty(PROP_HOJA);
  if (!id) throw new Error('Corre setup() desde el editor primero.');
  return SpreadsheetApp.openById(id);
}

function hoja_(nombre) {
  var h = libro_().getSheetByName(nombre);
  if (!h) throw new Error('Falta la hoja "' + nombre + '". Corre setup().');
  return h;
}

/** Valor de celda → valor de Logica (Date → texto local de Caracas). */
function deCelda_(v) {
  if (v instanceof Date) return aFechaCaracas(v);
  return v;
}

/** Valor de Logica → celda. */
function aCelda_(campo, v) {
  if (v === null || v === undefined) return '';
  if (CAMPOS_FECHA_HORA.indexOf(campo) >= 0 && v) return parsearFecha(v) || v;
  if (CAMPOS_BOOLEANOS.indexOf(campo) >= 0) return esVerdadero(v);
  // Evita que un texto que empieza con "=" se interprete como fórmula.
  if (typeof v === 'string' && /^[=+@]/.test(v)) return "'" + v;
  return v;
}

/** Implementa el "almacén" que espera manejarPeticion(). */
function almacenHoja_() {
  var cacheFilas = null, cacheEnc = null;
  var diario = hoja_(HOJA_DIARIO);

  function encabezados() {
    if (!cacheEnc) cacheEnc = diario.getRange(1, 1, 1, diario.getLastColumn()).getValues()[0].map(String);
    return cacheEnc;
  }
  function aArreglo(fila) {
    return encabezados().map(function (h) { return aCelda_(h, fila[h]); });
  }
  return {
    token: function () { return PropertiesService.getScriptProperties().getProperty(PROP_TOKEN) || ''; },
    leerFilas: function () {
      if (!cacheFilas) cacheFilas = leerFilasDiario_(diario);
      return cacheFilas;
    },
    agregarFilas: function (filas) {
      if (!filas.length) return;
      var desde = diario.getLastRow() + 1;
      var faltan = desde + filas.length - 1 - diario.getMaxRows();
      if (faltan > 0) diario.insertRowsAfter(diario.getMaxRows(), faltan + 50);
      diario.getRange(desde, 1, filas.length, encabezados().length).setValues(filas.map(aArreglo));
      if (cacheFilas) Array.prototype.push.apply(cacheFilas, filas);
    },
    actualizarFila: function (indice, fila) {
      diario.getRange(indice + 2, 1, 1, encabezados().length).setValues([aArreglo(fila)]);
      if (cacheFilas) cacheFilas[indice] = fila;
    },
    leerTasas: function () { return leerTasas_(); },
    leerConfig: function () { return leerConfig_(); }
  };
}

function leerFilasDiario_(diario) {
  diario = diario || hoja_(HOJA_DIARIO);
  var ult = diario.getLastRow(), col = diario.getLastColumn();
  if (ult < 1) return [];
  var valores = diario.getRange(1, 1, ult, col).getValues();
  var enc = valores[0].map(String);
  var filas = [];
  for (var r = 1; r < valores.length; r++) {
    if (valores[r][0] === '' || valores[r][0] === null) continue; // fila sin id
    var o = {};
    ENCABEZADOS_DIARIO.forEach(function (h) {
      var i = enc.indexOf(h);
      o[h] = i >= 0 ? deCelda_(valores[r][i]) : '';
    });
    o._fila = r + 1;
    filas.push(o);
  }
  // Las filas sin id se saltan; el índice debe coincidir con la fila real.
  return conIndiceReal_(filas);
}

/**
 * manejarPeticion usa índices 0..n-1 y actualizarFila escribe en indice+2.
 * Si hay filas vacías intermedias eso fallaría, así que devolvemos un
 * arreglo cuya posición = fila real - 2 (huecos como filas "fantasma").
 */
function conIndiceReal_(filas) {
  var r = [];
  filas.forEach(function (f) {
    while (r.length < f._fila - 2) r.push({ id: '', anulado: true, fecha: '' });
    delete f._fila;
    r.push(f);
  });
  return r;
}

function leerTasas_() {
  var h = hoja_(HOJA_TASAS);
  var ult = h.getLastRow();
  if (ult < 2) return [];
  return h.getRange(2, 1, ult - 1, 3).getValues().map(function (f) {
    return { fecha: f[0] instanceof Date ? hoyCaracas(f[0]) : String(f[0]), usd: f[1], eur: f[2] };
  });
}

function leerConfig_() {
  return leerConfigDeValores(hoja_(HOJA_CONFIG).getDataRange().getValues());
}

/* ------------------------------------------------------------------ */
/* Menú                                                                */
/* ------------------------------------------------------------------ */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Finanzas')
    .addItem('Exportar CSV ahora', 'menuExportar')
    .addItem('Actualizar tasas', 'menuTasas')
    .addItem('Importar estado de conciliación', 'menuImportar')
    .addSeparator()
    .addItem('Generar enlace del teléfono', 'menuEnlace')
    .addItem('Regenerar token', 'menuRegenerarToken')
    .addSeparator()
    .addItem('Configurar todo (setup)', 'setup')
    .addToUi();
}

function avisar_(titulo, mensaje) {
  Logger.log(titulo + ': ' + mensaje);
  try { SpreadsheetApp.getUi().alert(titulo, mensaje, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) { /* sin UI */ }
}

function conLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(60000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function menuExportar() {
  var r = conLock_(exportarCsv);
  avisar_('Exportación', 'Se escribió ' + ARCHIVO_CSV + ' con ' + r.filas + ' filas en Banco/Diario.');
}

function menuTasas() {
  var r = actualizarTasas_({ dias: 30 });
  avisar_('Tasas BCV', r.resumen);
}

function menuImportar() {
  var r = importarConciliacion_(true);
  avisar_('Conciliación', r.resumen);
}

function menuEnlace() {
  var enlace = escribirEnlace_();
  avisar_('Enlace del teléfono', enlace.ok
    ? 'Listo. Está en Config (enlace_telefono). Ábrelo en el teléfono:\n\n' + enlace.enlace
    : enlace.error);
}

function menuRegenerarToken() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { /* sin UI */ }
  if (ui) {
    var resp = ui.alert('Regenerar token',
      'Los teléfonos configurados dejarán de poder anotar hasta que abras el enlace nuevo. ¿Continuar?',
      ui.ButtonSet.YES_NO);
    if (resp !== ui.Button.YES) return;
  }
  PropertiesService.getScriptProperties().setProperty(PROP_TOKEN, generarToken_());
  menuEnlace();
}

/* ------------------------------------------------------------------ */
/* setup()                                                             */
/* ------------------------------------------------------------------ */

/** Se puede correr varias veces: solo crea lo que falta. */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Este script debe estar vinculado a la hoja (Extensiones → Apps Script).');
  var props = PropertiesService.getScriptProperties();
  props.setProperty(PROP_HOJA, ss.getId());
  ss.setSpreadsheetTimeZone(ZONA_HORARIA);
  var pasos = [];

  // Hojas y encabezados
  var diario = asegurarHoja_(ss, HOJA_DIARIO, ENCABEZADOS_DIARIO);
  formatearDiario_(diario);
  var tasas = asegurarHoja_(ss, HOJA_TASAS, ENCABEZADOS_TASAS);
  tasas.getRange('A:A').setNumberFormat('@');
  tasas.getRange('B:C').setNumberFormat('0.00######');
  tasas.getRange('E:E').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  asegurarHoja_(ss, HOJA_LOG, ENCABEZADOS_LOG).getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  asegurarConfig_(ss);
  borrarHojaVaciaPorDefecto_(ss);
  pasos.push('Hojas listas: Diario, Config, TasasBCV, Log.');

  // Token
  if (!props.getProperty(PROP_TOKEN)) {
    props.setProperty(PROP_TOKEN, generarToken_());
    pasos.push('Token generado.');
  } else pasos.push('Token existente conservado.');

  // Carpeta Banco/Diario
  var carpeta = carpetaDiario_();
  pasos.push('Carpeta: Banco/' + carpeta.getName() + ' (id guardado).');

  // Disparadores
  instalarDisparadores_();
  pasos.push('Disparadores diarios: tasas ~18:30 y conciliación ~06:00 (hora de Caracas).');

  // Tasas (relleno inicial) y CSV
  try {
    pasos.push(actualizarTasas_({ dias: 400 }).resumen);
  } catch (e) {
    registrarLog_('setup/tasas', e);
    pasos.push('No se pudieron traer tasas ahora (se reintentará a diario).');
  }
  conLock_(exportarCsv);
  pasos.push('diario.csv exportado.');

  // Enlace del teléfono
  var enlace = escribirEnlace_();
  pasos.push(enlace.ok ? 'Enlace del teléfono escrito en Config.' : enlace.error);

  avisar_('Finanzas Diario: setup terminado', pasos.join('\n'));
}

function asegurarHoja_(ss, nombre, encabezados) {
  var h = ss.getSheetByName(nombre) || ss.insertSheet(nombre);
  var ancho = Math.max(h.getLastColumn(), 1);
  var actuales = h.getRange(1, 1, 1, ancho).getValues()[0].map(String);
  if (actuales.join('') === '') {
    h.getRange(1, 1, 1, encabezados.length).setValues([encabezados]);
  } else {
    var faltan = encabezados.filter(function (e) { return actuales.indexOf(e) < 0; });
    if (faltan.length) h.getRange(1, actuales.length + 1, 1, faltan.length).setValues([faltan]);
  }
  h.setFrozenRows(1);
  h.getRange(1, 1, 1, h.getLastColumn()).setFontWeight('bold');
  return h;
}

function formatearDiario_(h) {
  var enc = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0].map(String);
  function col(nombre) { return enc.indexOf(nombre) + 1; }
  function letra(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; }
  function rango(nombre) { var l = letra(col(nombre)); return h.getRange(l + '2:' + l); }
  CAMPOS_TEXTO.forEach(function (c) { rango(c).setNumberFormat('@'); });
  CAMPOS_FECHA_HORA.forEach(function (c) { rango(c).setNumberFormat('yyyy-mm-dd hh:mm:ss'); });
  ['monto', 'monto_bs', 'monto_usd'].forEach(function (c) { rango(c).setNumberFormat('#,##0.00##'); });
  ['tasa_bcv_usd', 'tasa_usada'].forEach(function (c) { rango(c).setNumberFormat('0.00######'); });
  rango('tipo').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(TIPOS, true).setAllowInvalid(false).build());
  CAMPOS_BOOLEANOS.forEach(function (c) {
    rango(c).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  });
}

function asegurarConfig_(ss) {
  var h = ss.getSheetByName(HOJA_CONFIG) || ss.insertSheet(HOJA_CONFIG);
  Object.keys(CONFIG_TABLAS).forEach(function (k) {
    var def = CONFIG_TABLAS[k];
    var enc = h.getRange(1, def.col, 1, def.encabezados.length);
    var vacia = enc.getValues()[0].join('') === '';
    if (vacia) {
      enc.setValues([def.encabezados]).setFontWeight('bold');
      var filas = CONFIG_INICIAL[k];
      if (filas.length) h.getRange(2, def.col, filas.length, def.encabezados.length).setValues(filas);
    } else if (k === 'ajustes') {
      // Agrega claves nuevas sin tocar las existentes.
      var ult = Math.max(h.getLastRow(), 1);
      var claves = h.getRange(1, def.col, ult, 1).getValues().map(function (f) { return String(f[0]); });
      CONFIG_INICIAL.ajustes.forEach(function (par) {
        if (claves.indexOf(par[0]) < 0) {
          var fila = primeraFilaVacia_(h, def.col);
          h.getRange(fila, def.col, 1, 2).setValues([par]);
          claves.push(par[0]);
        }
      });
    }
  });
  h.setFrozenRows(1);
  var monedas = h.getRange(2, CONFIG_TABLAS.monedas.col, 50, 1);
  h.getRange(2, CONFIG_TABLAS.cuentas.col + 1, 100, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInRange(monedas, true).setAllowInvalid(true).build());
  h.getRange(2, CONFIG_TABLAS.cuentas.col + 2, 100, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['Sí', 'No'], true).setAllowInvalid(true).build());
  h.getRange(2, CONFIG_TABLAS.categorias.col + 1, 200, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(TIPOS, true).setAllowInvalid(true)
      .setHelpText('Vacío = sirve para cualquier tipo').build());
  h.getRange(1, CONFIG_TABLAS.ajustes.col + 1, 20, 1).setWrap(true);
  h.setColumnWidth(CONFIG_TABLAS.ajustes.col + 1, 420);
  // url_webapp: si ya hay una implementación, la detecta.
  try {
    var url = ScriptApp.getService().getUrl();
    if (url && /\/exec$/.test(url) && !leerAjuste_('url_webapp')) escribirAjuste_('url_webapp', url);
  } catch (e) { /* aún no implementado */ }
}

function primeraFilaVacia_(h, col) {
  var ult = Math.max(h.getLastRow(), 1);
  var vals = h.getRange(1, col, ult + 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) if (vals[i][0] === '') return i + 1;
  return ult + 1;
}

function leerAjuste_(clave) {
  return leerConfig_().ajustes[clave] || '';
}

function escribirAjuste_(clave, valor) {
  var h = hoja_(HOJA_CONFIG);
  var col = CONFIG_TABLAS.ajustes.col;
  var ult = Math.max(h.getLastRow(), 1);
  var vals = h.getRange(1, col, ult, 1).getValues();
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][0]) === clave) { h.getRange(i + 1, col + 1).setValue(valor); return; }
  }
  h.getRange(primeraFilaVacia_(h, col), col, 1, 2).setValues([[clave, valor]]);
}

function borrarHojaVaciaPorDefecto_(ss) {
  ['Hoja 1', 'Hoja1', 'Sheet1'].forEach(function (n) {
    var h = ss.getSheetByName(n);
    if (h && h.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(h);
  });
}

function generarToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function escribirEnlace_() {
  var urlWeb = leerAjuste_('url_webapp').trim();
  var urlPwa = leerAjuste_('url_pwa').trim();
  if (!urlWeb || !urlPwa) {
    var msg = 'Falta completar en Config: ' + [!urlWeb ? 'url_webapp' : '', !urlPwa ? 'url_pwa' : '']
      .filter(String).join(' y ') + '. Luego usa Finanzas → Generar enlace del teléfono.';
    escribirAjuste_('enlace_telefono', msg);
    return { ok: false, error: msg };
  }
  var token = PropertiesService.getScriptProperties().getProperty(PROP_TOKEN);
  var datos = JSON.stringify({ url: urlWeb, token: token });
  var b64 = Utilities.base64EncodeWebSafe(datos, Utilities.Charset.UTF_8).replace(/=+$/, '');
  var enlace = urlPwa.replace(/#.*$/, '').replace(/\/?$/, '/') + '#cfg=' + b64;
  escribirAjuste_('enlace_telefono', enlace);
  return { ok: true, enlace: enlace };
}

/* ------------------------------------------------------------------ */
/* Disparadores                                                        */
/* ------------------------------------------------------------------ */

function instalarDisparadores_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (MANEJADORES.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('tareaDiariaTasas').timeBased().atHour(18).nearMinute(30)
    .everyDays(1).inTimezone(ZONA_HORARIA).create();
  ScriptApp.newTrigger('tareaDiariaConciliacion').timeBased().atHour(6)
    .everyDays(1).inTimezone(ZONA_HORARIA).create();
  ScriptApp.newTrigger('alEditarHoja').forSpreadsheet(libro_()).onEdit().create();
}

function tareaDiariaTasas() {
  try { actualizarTasas_({ dias: 10 }); } catch (e) { registrarLog_('tareaDiariaTasas', e); }
}

function tareaDiariaConciliacion() {
  try { importarConciliacion_(false); } catch (e) { registrarLog_('tareaDiariaConciliacion', e); }
}

/** Si editas el Diario a mano, el CSV se vuelve a exportar. */
function alEditarHoja(e) {
  try {
    if (!e || !e.range || e.range.getSheet().getName() !== HOJA_DIARIO) return;
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return;
    try { exportarCsv(); } finally { lock.releaseLock(); }
  } catch (err) { registrarLog_('alEditarHoja', err); }
}

/* ------------------------------------------------------------------ */
/* Drive: carpeta, exportación e importación                           */
/* ------------------------------------------------------------------ */

function carpetaDiario_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(PROP_CARPETA);
  if (id) {
    try {
      var f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (e) { /* se volvió a crear abajo */ }
  }
  var raiz = DriveApp.getRootFolder();
  var it = raiz.getFoldersByName(CARPETA_BANCO);
  var banco = it.hasNext() ? it.next() : raiz.createFolder(CARPETA_BANCO);
  var it2 = banco.getFoldersByName(CARPETA_DIARIO);
  var diario = it2.hasNext() ? it2.next() : banco.createFolder(CARPETA_DIARIO);
  props.setProperty(PROP_CARPETA, diario.getId());
  return diario;
}

/** Sobrescribe siempre el mismo diario.csv (mismo id) para que Drive para escritorio lo sincronice. */
function exportarCsv() {
  var filas = leerFilasDiario_().filter(function (f) { return f.id; });
  var csv = generarCsv(filas, ENCABEZADOS_DIARIO);
  var props = PropertiesService.getScriptProperties();
  var archivo = null;
  var id = props.getProperty(PROP_CSV);
  if (id) {
    try { archivo = DriveApp.getFileById(id); if (archivo.isTrashed()) archivo = null; } catch (e) { archivo = null; }
  }
  var carpeta = carpetaDiario_();
  if (!archivo) {
    var it = carpeta.getFilesByName(ARCHIVO_CSV);
    archivo = it.hasNext() ? it.next() : carpeta.createFile(ARCHIVO_CSV, csv, MimeType.CSV);
    props.setProperty(PROP_CSV, archivo.getId());
  }
  archivo.setContent(csv);
  return { filas: filas.length, id: archivo.getId() };
}

function exportarSeguro_() {
  try { exportarCsv(); } catch (e) { registrarLog_('exportarCsv', e); }
}

/** Lee Banco/Diario/conciliacion_estado.csv y actualiza estado_conciliacion y conciliado_con por id. */
function importarConciliacion_(forzar) {
  var carpeta = carpetaDiario_();
  var it = carpeta.getFilesByName(ARCHIVO_CONCILIACION);
  if (!it.hasNext()) return { resumen: 'No hay ' + ARCHIVO_CONCILIACION + ' en Banco/Diario.' };
  var archivo = it.next();
  var props = PropertiesService.getScriptProperties();
  var marca = archivo.getId() + '@' + archivo.getLastUpdated().getTime();
  if (!forzar && props.getProperty(PROP_CONCILIACION) === marca) return { resumen: 'Sin cambios desde la última importación.' };

  var texto = archivo.getBlob().getDataAsString('UTF-8');
  return conLock_(function () {
    var diario = hoja_(HOJA_DIARIO);
    var filas = leerFilasDiario_(diario);
    var r = aplicarConciliacion(parsearCsv(texto), filas);
    if (r.error) {
      registrarLog_('importarConciliacion', new Error(r.error));
      return { resumen: 'Error: ' + r.error };
    }
    if (r.cambios.length) {
      var enc = diario.getRange(1, 1, 1, diario.getLastColumn()).getValues()[0].map(String);
      var cEst = enc.indexOf('estado_conciliacion') + 1, cCon = enc.indexOf('conciliado_con') + 1;
      var n = filas.length;
      var est = diario.getRange(2, cEst, n, 1).getValues();
      var con = diario.getRange(2, cCon, n, 1).getValues();
      r.cambios.forEach(function (c) { est[c.indice][0] = c.estado_conciliacion; con[c.indice][0] = c.conciliado_con; });
      diario.getRange(2, cEst, n, 1).setValues(est);
      diario.getRange(2, cCon, n, 1).setValues(con);
      exportarCsv();
    }
    props.setProperty(PROP_CONCILIACION, marca);
    var resumen = r.cambios.length + ' anotaciones actualizadas.' +
      (r.desconocidos.length ? ' ' + r.desconocidos.length + ' ids no existen en el Diario.' : '');
    return { resumen: resumen };
  });
}

/* ------------------------------------------------------------------ */
/* Tasas BCV                                                           */
/* ------------------------------------------------------------------ */

/**
 * Trae las tasas que faltan de los últimos `dias` días (y de mañana, si el BCV
 * ya la publicó) más los días de filas provisionales; luego rellena esas filas.
 * Si la fuente falla, no se rompe nada: se registra en Log y se reintenta mañana.
 */
function actualizarTasas_(opciones) {
  var dias = (opciones && opciones.dias) || 10;
  var hoy = hoyCaracas(new Date());
  var existentes = normalizarTasas(leerTasas_()).map(function (t) { return t.fecha; });
  var faltan = diasFaltantes(existentes, sumarDias(hoy, -dias), sumarDias(hoy, 1));
  leerFilasDiario_().forEach(function (f) {
    if (!f.id || !esVerdadero(f.tasa_provisional)) return;
    var d = diaDe(f.fecha);
    if (d <= sumarDias(hoy, 1) && existentes.indexOf(d) < 0 && faltan.indexOf(d) < 0) faltan.push(d);
  });
  faltan.sort();

  var nuevas = faltan.length ? descargarTasas_(faltan) : [];
  if (nuevas.length) {
    var h = hoja_(HOJA_TASAS);
    var ahora = new Date();
    h.getRange(h.getLastRow() + 1, 1, nuevas.length, 5).setValues(nuevas.map(function (t) {
      return [t.fecha, t.usd, t.eur || '', t.fuente, ahora];
    }));
    if (h.getLastRow() > 2) h.getRange(2, 1, h.getLastRow() - 1, 5).sort(1);
  }

  var rellenadas = conLock_(function () {
    var tasas = normalizarTasas(leerTasas_());
    var alm = almacenHoja_();
    var cambios = rellenarProvisionales(alm.leerFilas(), tasas);
    cambios.forEach(function (c) { alm.actualizarFila(c.indice, c.fila); });
    if (cambios.length || nuevas.length) exportarCsv();
    return cambios.length;
  });
  return { resumen: nuevas.length + ' tasas nuevas; ' + rellenadas + ' anotaciones con tasa actualizada.' };
}

function descargarTasas_(dias) {
  var encontradas = {};
  var errores = [];
  if (dias.length > 15) {
    // Muchos días: un solo archivo con el historial (~5 años).
    for (var i = 0; i < FUENTES_BCV.length && !Object.keys(encontradas).length; i++) {
      try {
        var resp = UrlFetchApp.fetch(urlHistorial(FUENTES_BCV[i]), { muteHttpExceptions: true });
        if (resp.getResponseCode() === 200) {
          parsearHistorialBcv(JSON.parse(resp.getContentText())).forEach(function (t) { encontradas[t.fecha] = t; });
        } else errores.push(FUENTES_BCV[i] + ' HTTP ' + resp.getResponseCode());
      } catch (e) { errores.push(String(e)); }
    }
  }
  var pendientes = dias.filter(function (d) { return !encontradas[d]; });
  for (var f = 0; f < FUENTES_BCV.length && pendientes.length; f++) {
    var base = FUENTES_BCV[f];
    var respuestas;
    try {
      respuestas = UrlFetchApp.fetchAll(pendientes.map(function (d) {
        return { url: urlTasaDia(base, d), muteHttpExceptions: true };
      }));
    } catch (e) { errores.push(String(e)); continue; }
    respuestas.forEach(function (r, k) {
      var d = pendientes[k];
      var codigo = r.getResponseCode();
      if (codigo === 200) {
        try {
          var t = parsearTasaBcv(JSON.parse(r.getContentText()), d);
          if (t) encontradas[d] = t;
        } catch (e) { errores.push(d + ': JSON inválido'); }
      } else if (codigo !== 404) errores.push(d + ': HTTP ' + codigo);
      // 404 = ese día aún no existe en la fuente (p. ej. mañana o fin de semana): normal.
    });
    pendientes = pendientes.filter(function (d) { return !encontradas[d]; });
    if (!errores.length) break; // si solo hubo 404, no tiene sentido probar la otra fuente
  }
  if (errores.length) registrarLog_('descargarTasas', new Error(errores.slice(0, 10).join(' | ')));
  return dias.map(function (d) { return encontradas[d]; }).filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* Log                                                                 */
/* ------------------------------------------------------------------ */

function registrarLog_(funcion, err) {
  try {
    var h = libro_().getSheetByName(HOJA_LOG);
    if (!h) return;
    h.appendRow([new Date(), funcion, String(err && err.message || err).slice(0, 500),
      String(err && err.stack || '').slice(0, 1000)]);
    if (h.getLastRow() > 600) h.deleteRows(2, h.getLastRow() - 500);
  } catch (e) {
    Logger.log('No se pudo escribir el Log: ' + e);
  }
}
