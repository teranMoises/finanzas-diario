/**
 * Logica.gs — Funciones puras de Finanzas Diario.
 *
 * Aquí NO se usa ningún servicio de Google (SpreadsheetApp, DriveApp, …).
 * Por eso este archivo también se carga en Node para las pruebas
 * (tests/logica.test.js) y en el servidor simulado (tools/mock-server.js).
 *
 * Convenciones internas:
 *  - Una "fila" del Diario es un objeto con las claves de ENCABEZADOS_DIARIO.
 *  - Fechas-hora como texto local de Caracas: "AAAA-MM-DDTHH:mm:ss".
 *  - Días como texto: "AAAA-MM-DD".
 *  - Venezuela usa UTC-4 todo el año (sin horario de verano desde 2016).
 */

var VERSION_BACKEND = '1.0.0';
var ZONA_HORARIA = 'America/Caracas';
var OFFSET_CARACAS_MIN = -240;
var SUFIJO_OFFSET = '-04:00';

// Contrato con los scripts de conciliación: NO cambiar el orden ni los nombres.
var ENCABEZADOS_DIARIO = [
  'id', 'fecha', 'tipo', 'categoria', 'cuenta', 'cuenta_destino', 'descripcion',
  'monto', 'moneda', 'medio', 'referencia', 'tasa_bcv_usd', 'tasa_usada',
  'monto_bs', 'monto_usd', 'tasa_provisional', 'registrado', 'modificado',
  'dispositivo', 'anulado', 'estado_conciliacion', 'conciliado_con'
];
var CAMPOS_FECHA_HORA = ['fecha', 'registrado', 'modificado'];
var CAMPOS_BOOLEANOS = ['tasa_provisional', 'anulado'];
var CAMPOS_TEXTO = ['id', 'tipo', 'categoria', 'cuenta', 'cuenta_destino', 'descripcion',
  'moneda', 'medio', 'referencia', 'dispositivo', 'estado_conciliacion', 'conciliado_con'];
// Campos que el teléfono puede cambiar con {accion:"editar"}.
var CAMPOS_EDITABLES = ['fecha', 'tipo', 'categoria', 'cuenta', 'cuenta_destino', 'descripcion',
  'monto', 'moneda', 'medio', 'referencia'];

var ENCABEZADOS_TASAS = ['fecha', 'usd', 'eur', 'fuente', 'actualizado'];
var ENCABEZADOS_LOG = ['fecha', 'funcion', 'mensaje', 'detalle'];
var TIPOS = ['Gasto', 'Ingreso', 'Traspaso'];
var CATEGORIA_TRASPASO = 'Entre Cuentas';

// Fuente de tasas: repo público grupoclip/bcv-api, rama main.
// api/v1/history/AAAA-MM-DD.json = tasa vigente ese día del calendario.
var FUENTES_BCV = [
  'https://raw.githubusercontent.com/grupoclip/bcv-api/main/api/v1/',
  'https://bcv.today/api/v1/'
];

// Distribución de las tablas en la hoja Config (columna inicial, 1 = A).
var CONFIG_TABLAS = {
  categorias: { col: 1, encabezados: ['categoria', 'tipo'] },
  cuentas: { col: 4, encabezados: ['cuenta', 'moneda', 'bancaria'] },
  medios: { col: 8, encabezados: ['medio'] },
  monedas: { col: 10, encabezados: ['moneda'] },
  ajustes: { col: 12, encabezados: ['clave', 'valor'] }
};

var CONFIG_INICIAL = {
  categorias: [
    ['Alimentos', 'Gasto'], ['Transporte', 'Gasto'], ['Servicios', 'Gasto'],
    ['Bienestar', 'Gasto'], ['Ocio', 'Gasto'], ['Educación', 'Gasto'], ['Ropa', 'Gasto'],
    ['Regalos', ''], ['Herramientas', 'Gasto'], ['Retiros', ''], ['Comisiones', 'Gasto'],
    ['Impuestos', 'Gasto'], ['Préstamos', ''], ['Inversiones', ''],
    ['Entre Cuentas', 'Traspaso'], ['Salarios', 'Ingreso'], ['Aportes', 'Ingreso'],
    ['Depósitos', 'Ingreso']
  ],
  cuentas: [
    ['Banesco Corriente', 'Bs', 'Sí'], ['Mercantil Corriente', 'Bs', 'Sí'],
    ['Mercantil Ahorros', 'Bs', 'Sí'], ['Efectivo Bs', 'Bs', 'No'],
    ['Efectivo $', 'USD', 'No'], ['Binance', 'USDT', 'No']
  ],
  medios: [['Punto de venta'], ['Pago móvil'], ['Transferencia'], ['Efectivo'],
    ['Cashea inicial'], ['Cashea cuota'], ['Otro']],
  monedas: [['Bs'], ['USD'], ['EUR'], ['USDT']],
  ajustes: [
    ['url_webapp', ''],
    ['url_pwa', ''],
    ['enlace_telefono', ''],
    ['nota', 'No compartas esta hoja: el enlace del teléfono contiene el token.']
  ]
};

/* ------------------------------------------------------------------ */
/* Fechas                                                              */
/* ------------------------------------------------------------------ */

function dos_(n) { return (n < 10 ? '0' : '') + n; }

/** true si es un Date (también de otro contexto, p. ej. valores de la hoja). */
function esFecha_(v) {
  return !!v && typeof v === 'object' && typeof v.getTime === 'function' && typeof v.getUTCFullYear === 'function';
}

/** Date (instante) → "AAAA-MM-DDTHH:mm:ss" en hora de Caracas. */
function aFechaCaracas(fecha) {
  var t = new Date(fecha.getTime() + OFFSET_CARACAS_MIN * 60000);
  return t.getUTCFullYear() + '-' + dos_(t.getUTCMonth() + 1) + '-' + dos_(t.getUTCDate()) +
    'T' + dos_(t.getUTCHours()) + ':' + dos_(t.getUTCMinutes()) + ':' + dos_(t.getUTCSeconds());
}

var RE_FECHA_ = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * Convierte texto ISO (con o sin zona) o Date a un Date. Sin zona = hora de Caracas.
 * Devuelve null si no es una fecha válida.
 */
function parsearFecha(valor) {
  if (esFecha_(valor)) {
    var t0 = valor.getTime();
    return isNaN(t0) ? null : new Date(t0);
  }
  if (typeof valor !== 'string') return null;
  var m = RE_FECHA_.exec(valor.trim());
  if (!m) return null;
  var a = +m[1], me = +m[2], d = +m[3], h = +(m[4] || 0), mi = +(m[5] || 0), s = +(m[6] || 0);
  if (me < 1 || me > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  var utc = Date.UTC(a, me - 1, d, h, mi, s);
  var chequeo = new Date(utc);
  if (chequeo.getUTCDate() !== d || chequeo.getUTCMonth() !== me - 1) return null;
  var offsetMin = OFFSET_CARACAS_MIN;
  if (m[7]) {
    if (m[7] === 'Z') offsetMin = 0;
    else {
      var z = m[7].replace(':', '');
      offsetMin = (z[0] === '-' ? -1 : 1) * (+z.slice(1, 3) * 60 + +z.slice(3, 5));
    }
  }
  return new Date(utc - offsetMin * 60000);
}

/** Cualquier fecha aceptada → "AAAA-MM-DDTHH:mm:ss" de Caracas, o null. */
function normalizarFecha(valor) {
  var f = parsearFecha(valor);
  return f ? aFechaCaracas(f) : null;
}

function diaDe(fechaLocal) { return String(fechaLocal).slice(0, 10); }

function sumarDias(dia, n) {
  var p = dia.split('-');
  var t = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
  return t.getUTCFullYear() + '-' + dos_(t.getUTCMonth() + 1) + '-' + dos_(t.getUTCDate());
}

function hoyCaracas(ahora) { return diaDe(aFechaCaracas(ahora || new Date())); }

/** "AAAA-MM-DDTHH:mm:ss" (Caracas) → "AAAA-MM-DDTHH:mm:ss-04:00" para el CSV. */
function fechaIsoConZona(fechaLocal) {
  if (!fechaLocal) return '';
  return fechaLocal + SUFIJO_OFFSET;
}

/* ------------------------------------------------------------------ */
/* Tasas BCV                                                           */
/* ------------------------------------------------------------------ */

function numeroONull_(v) {
  if (v === '' || v === null || v === undefined) return null;
  var n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return isFinite(n) && n > 0 ? n : null;
}

/** Limpia y ordena ascendentemente una lista de tasas {fecha, usd, eur}. */
function normalizarTasas(lista) {
  var porFecha = {};
  (lista || []).forEach(function (t) {
    if (!t) return;
    var dia = esFecha_(t.fecha) ? hoyCaracas(t.fecha) : String(t.fecha || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return;
    var usd = numeroONull_(t.usd);
    if (!usd) return;
    porFecha[dia] = { fecha: dia, usd: usd, eur: numeroONull_(t.eur) };
  });
  return Object.keys(porFecha).sort().map(function (k) { return porFecha[k]; });
}

/**
 * Tasa de un día D = la fila con mayor fecha <= D (relleno hacia adelante).
 * `tasas` debe venir de normalizarTasas (ordenada). exacta = hay fila para D.
 */
function buscarTasa(tasas, dia) {
  var lo = 0, hi = tasas.length - 1, mejor = -1;
  while (lo <= hi) {
    var mid = (lo + hi) >> 1;
    if (tasas[mid].fecha <= dia) { mejor = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (mejor < 0) return null;
  var t = tasas[mejor];
  return { fecha: t.fecha, usd: t.usd, eur: t.eur, exacta: t.fecha === dia };
}

/** Días entre desde y hasta (inclusive) que no están en `fechasExistentes`. */
function diasFaltantes(fechasExistentes, desde, hasta) {
  var set = {};
  (fechasExistentes || []).forEach(function (f) { set[String(f).slice(0, 10)] = true; });
  var faltan = [];
  for (var d = desde; d <= hasta; d = sumarDias(d, 1)) if (!set[d]) faltan.push(d);
  return faltan;
}

function urlTasaDia(base, dia) { return base + 'history/' + dia + '.json'; }
function urlHistorial(base) { return base + 'history.json'; }

/**
 * JSON de bcv-api → {fecha, usd, eur, fuente}. `fecha` es el campo "date"
 * (= nombre del archivo = día del calendario). null si no sirve.
 */
function parsearTasaBcv(obj, diaEsperado) {
  if (!obj || typeof obj !== 'object') return null;
  var fecha = String(obj.date || diaEsperado || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
  if (diaEsperado && fecha !== diaEsperado) return null;
  var usd = numeroONull_(obj.USD);
  if (!usd) return null;
  return {
    fecha: fecha,
    usd: usd,
    eur: numeroONull_(obj.EUR),
    fuente: 'bcv-api' + (obj.effective_date ? ' (vigente desde ' + obj.effective_date + ')' : '')
  };
}

function parsearHistorialBcv(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(function (o) { return parsearTasaBcv(o, null); }).filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* Conversión                                                          */
/* ------------------------------------------------------------------ */

function redondear(x, dec) {
  var f = Math.pow(10, dec);
  var r = Math.sign(x) * Math.round(Math.abs(x) * f + 1e-9) / f;
  return r === 0 ? 0 : r;
}

function signoDe(tipo) { return tipo === 'Ingreso' ? 1 : -1; }

/**
 * Calcula tasas y montos con signo. Bs = 1; USD = tasa USD; EUR = tasa EUR;
 * USDT = 1 USD. Gasto y Traspaso negativos, Ingreso positivo.
 * Si falta la tasa, los campos que dependen de ella quedan vacíos ('').
 */
function calcularMontos(tipo, monto, moneda, tasa) {
  var s = signoDe(tipo);
  var usd = tasa && tasa.usd > 0 ? tasa.usd : null;
  var eur = tasa && tasa.eur > 0 ? tasa.eur : null;
  var r = {
    tasa_bcv_usd: usd || '', tasa_usada: '', monto_bs: '', monto_usd: '',
    tasa_provisional: !(tasa && tasa.exacta)
  };
  var m = Number(monto);
  if (moneda === 'Bs') {
    r.tasa_usada = 1;
    r.monto_bs = redondear(s * m, 2);
    if (usd) r.monto_usd = redondear(s * m / usd, 2);
  } else if (moneda === 'USD' || moneda === 'USDT') {
    r.monto_usd = redondear(s * m, 2);
    if (usd) { r.tasa_usada = usd; r.monto_bs = redondear(s * m * usd, 2); }
  } else if (moneda === 'EUR') {
    if (eur) { r.tasa_usada = eur; r.monto_bs = redondear(s * m * eur, 2); }
    if (eur && usd) r.monto_usd = redondear(s * m * eur / usd, 2);
    if (!eur) r.tasa_provisional = true;
  } else {
    r.tasa_provisional = true;
  }
  return r;
}

/* ------------------------------------------------------------------ */
/* Validación y construcción de filas                                  */
/* ------------------------------------------------------------------ */

function texto_(v, max) {
  if (v === null || v === undefined) return '';
  // eslint-disable-next-line no-control-regex
  var s = String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) : s;
}

function monedaDeCuenta(config, cuenta) {
  var c = ((config && config.cuentas) || []).filter(function (x) { return x.nombre === cuenta; })[0];
  return c ? c.moneda : '';
}

/**
 * Valida y normaliza un movimiento recibido del teléfono.
 * → {ok:true, mov} | {ok:false, error}
 */
function validarMovimiento(m, config) {
  if (!m || typeof m !== 'object') return { ok: false, error: 'movimiento vacío' };
  var id = texto_(m.id, 64);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) return { ok: false, error: 'id inválido' };
  var tipo = texto_(m.tipo, 20);
  if (TIPOS.indexOf(tipo) < 0) return { ok: false, error: 'tipo inválido' };
  var monto = typeof m.monto === 'number' ? m.monto : Number(String(m.monto || '').trim());
  if (!isFinite(monto) || monto <= 0 || monto >= 1e13) return { ok: false, error: 'monto inválido' };
  var fecha = normalizarFecha(m.fecha);
  if (!fecha) return { ok: false, error: 'fecha inválida' };
  var cuenta = texto_(m.cuenta, 80);
  if (!cuenta) return { ok: false, error: 'falta la cuenta' };
  var destino = '';
  if (tipo === 'Traspaso') {
    destino = texto_(m.cuenta_destino, 80);
    if (!destino) return { ok: false, error: 'falta la cuenta destino' };
    if (destino === cuenta) return { ok: false, error: 'la cuenta destino es igual a la de origen' };
  }
  var categoria = texto_(m.categoria, 80);
  if (!categoria && tipo === 'Traspaso') categoria = CATEGORIA_TRASPASO;
  if (!categoria) return { ok: false, error: 'falta la categoría' };
  var moneda = texto_(m.moneda, 10) || monedaDeCuenta(config, cuenta) || 'Bs';
  var monedas = (config && config.monedas) || [];
  if (monedas.length && monedas.indexOf(moneda) < 0) return { ok: false, error: 'moneda desconocida' };
  return {
    ok: true,
    mov: {
      id: id, fecha: fecha, tipo: tipo, categoria: categoria, cuenta: cuenta,
      cuenta_destino: destino, descripcion: texto_(m.descripcion, 200), monto: monto,
      moneda: moneda, medio: texto_(m.medio, 60), referencia: texto_(m.referencia, 60),
      dispositivo: texto_(m.dispositivo, 60), anulado: m.anulado === true
    }
  };
}

/** Movimiento validado → fila completa del Diario. */
function construirFila(mov, tasas, ahoraLocal) {
  var tasa = buscarTasa(tasas, diaDe(mov.fecha));
  var c = calcularMontos(mov.tipo, mov.monto, mov.moneda, tasa);
  return {
    id: mov.id, fecha: mov.fecha, tipo: mov.tipo, categoria: mov.categoria, cuenta: mov.cuenta,
    cuenta_destino: mov.cuenta_destino, descripcion: mov.descripcion, monto: mov.monto,
    moneda: mov.moneda, medio: mov.medio, referencia: mov.referencia,
    tasa_bcv_usd: c.tasa_bcv_usd, tasa_usada: c.tasa_usada, monto_bs: c.monto_bs,
    monto_usd: c.monto_usd, tasa_provisional: c.tasa_provisional,
    registrado: ahoraLocal, modificado: ahoraLocal, dispositivo: mov.dispositivo,
    anulado: !!mov.anulado, estado_conciliacion: '', conciliado_con: ''
  };
}

/** Recalcula tasas y montos de una fila existente (tras editar o al llegar la tasa). */
function recalcularFila(fila, tasas) {
  var tasa = buscarTasa(tasas, diaDe(fila.fecha));
  var c = calcularMontos(fila.tipo, fila.monto, fila.moneda, tasa);
  var nueva = copiar_(fila);
  Object.keys(c).forEach(function (k) { nueva[k] = c[k]; });
  return nueva;
}

function copiar_(o) {
  var r = {};
  Object.keys(o).forEach(function (k) { r[k] = o[k]; });
  return r;
}

/**
 * Lote de movimientos → qué filas agregar. Idempotente: un id que ya
 * existe (o repetido en el mismo lote) se reporta como guardado sin duplicarlo.
 */
function procesarRegistro(movimientos, idsExistentes, tasas, config, ahoraLocal) {
  var vistos = {};
  (idsExistentes || []).forEach(function (id) { vistos[String(id)] = true; });
  var r = { nuevas: [], guardados: [], duplicados: [], rechazados: [] };
  (Array.isArray(movimientos) ? movimientos : []).slice(0, 500).forEach(function (m) {
    var v = validarMovimiento(m, config);
    if (!v.ok) {
      r.rechazados.push({ id: m && m.id ? String(m.id).slice(0, 64) : '', error: v.error });
      return;
    }
    if (vistos[v.mov.id]) {
      r.duplicados.push(v.mov.id);
      r.guardados.push(v.mov.id);
      return;
    }
    vistos[v.mov.id] = true;
    r.nuevas.push(construirFila(v.mov, tasas, ahoraLocal));
    r.guardados.push(v.mov.id);
  });
  return r;
}

/** Aplica {cambios} del teléfono a una fila. → {ok, fila} | {ok:false, error} */
function aplicarEdicion(fila, cambios, tasas, config, ahoraLocal) {
  if (!cambios || typeof cambios !== 'object') return { ok: false, error: 'sin cambios' };
  var base = copiar_(fila);
  CAMPOS_EDITABLES.forEach(function (k) {
    if (Object.prototype.hasOwnProperty.call(cambios, k)) base[k] = cambios[k];
  });
  var v = validarMovimiento(base, config);
  if (!v.ok) return v;
  var nueva = copiar_(fila);
  CAMPOS_EDITABLES.forEach(function (k) { nueva[k] = v.mov[k]; });
  nueva = recalcularFila(nueva, tasas);
  nueva.modificado = ahoraLocal;
  return { ok: true, fila: nueva };
}

function anularFila(fila, ahoraLocal) {
  var nueva = copiar_(fila);
  nueva.anulado = true;
  nueva.modificado = ahoraLocal;
  return nueva;
}

/** Filas provisionales que ya pueden mejorar su tasa. → [{indice, fila}] */
function rellenarProvisionales(filas, tasas) {
  var cambios = [];
  filas.forEach(function (f, i) {
    if (!esVerdadero(f.tasa_provisional)) return;
    var n = recalcularFila(f, tasas);
    var distinto = ['tasa_bcv_usd', 'tasa_usada', 'monto_bs', 'monto_usd', 'tasa_provisional']
      .some(function (k) { return String(n[k]) !== String(f[k]); });
    if (distinto) cambios.push({ indice: i, fila: n });
  });
  return cambios;
}

function esVerdadero(v) {
  if (v === true) return true;
  var s = String(v === null || v === undefined ? '' : v).trim().toLowerCase();
  return s === 'true' || s === 'verdadero' || s === 'sí' || s === 'si' || s === 'x' || s === '1';
}

/* ------------------------------------------------------------------ */
/* Config, sugerencias y uso                                           */
/* ------------------------------------------------------------------ */

/** Valores 2D de la hoja Config → {categorias, cuentas, medios, monedas, ajustes}. */
function leerConfigDeValores(valores) {
  function tabla(def) {
    var filas = [];
    for (var r = 1; r < valores.length; r++) {
      var primera = valores[r][def.col - 1];
      if (primera === '' || primera === null || primera === undefined) continue;
      var fila = [];
      for (var c = 0; c < def.encabezados.length; c++) fila.push(valores[r][def.col - 1 + c]);
      filas.push(fila);
    }
    return filas;
  }
  var t = function (v) { return texto_(v, 80); };
  var ajustes = {};
  tabla(CONFIG_TABLAS.ajustes).forEach(function (f) { ajustes[t(f[0])] = String(f[1] === undefined ? '' : f[1]); });
  return {
    categorias: tabla(CONFIG_TABLAS.categorias).map(function (f) {
      var tipo = t(f[1]);
      return { nombre: t(f[0]), tipo: TIPOS.indexOf(tipo) >= 0 ? tipo : '' };
    }),
    cuentas: tabla(CONFIG_TABLAS.cuentas).map(function (f) {
      return { nombre: t(f[0]), moneda: t(f[1]) || 'Bs', bancaria: esVerdadero(f[2]) };
    }),
    medios: tabla(CONFIG_TABLAS.medios).map(function (f) { return t(f[0]); }),
    monedas: tabla(CONFIG_TABLAS.monedas).map(function (f) { return t(f[0]); }),
    ajustes: ajustes
  };
}

/** Config inicial como objeto (lo usa la PWA de respaldo y el mock). */
function configInicialComoObjeto() {
  var filas = [[]];
  var maxFilas = 0;
  Object.keys(CONFIG_INICIAL).forEach(function (k) { maxFilas = Math.max(maxFilas, CONFIG_INICIAL[k].length); });
  for (var i = 0; i < maxFilas; i++) filas.push([]);
  Object.keys(CONFIG_TABLAS).forEach(function (k) {
    var def = CONFIG_TABLAS[k];
    def.encabezados.forEach(function (h, j) { filas[0][def.col - 1 + j] = h; });
    CONFIG_INICIAL[k].forEach(function (f, i) {
      f.forEach(function (v, j) { filas[i + 1][def.col - 1 + j] = v; });
    });
  });
  var ancho = 13;
  filas = filas.map(function (f) { var r = []; for (var j = 0; j < ancho; j++) r.push(f[j] === undefined ? '' : f[j]); return r; });
  return leerConfigDeValores(filas);
}

function claveTexto(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ').trim();
}

function masFrecuente_(conteo) {
  var mejor = '', n = -1;
  Object.keys(conteo).forEach(function (k) { if (conteo[k] > n) { mejor = k; n = conteo[k]; } });
  return mejor;
}

/**
 * Descripciones más usadas con su tipo, categoría, cuenta y medio habituales.
 * Considera las últimas `ventana` filas no anuladas.
 */
function calcularSugerencias(filas, limite, ventana) {
  limite = limite || 300;
  var desde = Math.max(0, filas.length - (ventana || 3000));
  var grupos = {};
  for (var i = desde; i < filas.length; i++) {
    var f = filas[i];
    if (esVerdadero(f.anulado) || !f.descripcion) continue;
    var k = claveTexto(f.descripcion);
    if (!k) continue;
    var g = grupos[k] || (grupos[k] = { n: 0, texto: '', ultimo: '', tipo: {}, categoria: {}, cuenta: {}, medio: {}, destino: {} });
    g.n++;
    if (String(f.fecha) >= g.ultimo) { g.ultimo = String(f.fecha); g.texto = String(f.descripcion); }
    ['tipo', 'categoria', 'cuenta', 'medio'].forEach(function (c) {
      if (f[c]) g[c][f[c]] = (g[c][f[c]] || 0) + 1;
    });
    if (f.cuenta_destino) g.destino[f.cuenta_destino] = (g.destino[f.cuenta_destino] || 0) + 1;
  }
  return Object.keys(grupos).map(function (k) {
    var g = grupos[k];
    return {
      descripcion: g.texto, n: g.n, ultimo: g.ultimo, tipo: masFrecuente_(g.tipo),
      categoria: masFrecuente_(g.categoria), cuenta: masFrecuente_(g.cuenta),
      medio: masFrecuente_(g.medio), cuenta_destino: masFrecuente_(g.destino)
    };
  }).sort(function (a, b) {
    return b.n - a.n || (a.ultimo < b.ultimo ? 1 : a.ultimo > b.ultimo ? -1 : 0);
  }).slice(0, limite);
}

/** Conteos de uso para ordenar los chips de la PWA. */
function calcularUso(filas, ventana) {
  var u = { categorias: {}, cuentas: {}, destinos: {}, medios: {} };
  var desde = Math.max(0, filas.length - (ventana || 1500));
  for (var i = desde; i < filas.length; i++) {
    var f = filas[i];
    if (esVerdadero(f.anulado)) continue;
    var t = f.tipo;
    if (TIPOS.indexOf(t) < 0) continue;
    u.categorias[t] = u.categorias[t] || {};
    u.cuentas[t] = u.cuentas[t] || {};
    if (f.categoria) u.categorias[t][f.categoria] = (u.categorias[t][f.categoria] || 0) + 1;
    if (f.cuenta) u.cuentas[t][f.cuenta] = (u.cuentas[t][f.cuenta] || 0) + 1;
    if (f.cuenta_destino) u.destinos[f.cuenta_destino] = (u.destinos[f.cuenta_destino] || 0) + 1;
    if (f.medio) u.medios[f.medio] = (u.medios[f.medio] || 0) + 1;
  }
  return u;
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

function valorCsv_(campo, v) {
  if (v === null || v === undefined || v === '') return '';
  if (CAMPOS_BOOLEANOS.indexOf(campo) >= 0) return esVerdadero(v) ? 'true' : 'false';
  if (CAMPOS_FECHA_HORA.indexOf(campo) >= 0) {
    var local = normalizarFecha(v);
    return local ? fechaIsoConZona(local) : String(v);
  }
  if (typeof v === 'number') return isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

function escaparCsv_(s) {
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Filas → CSV UTF-8 (sin BOM), coma, fechas ISO con -04:00, decimales con punto. */
function generarCsv(filas, encabezados) {
  encabezados = encabezados || ENCABEZADOS_DIARIO;
  var lineas = [encabezados.join(',')];
  filas.forEach(function (f) {
    lineas.push(encabezados.map(function (h) { return escaparCsv_(valorCsv_(h, f[h])); }).join(','));
  });
  return lineas.join('\n') + '\n';
}

/** CSV (RFC 4180) → arreglo 2D. Acepta BOM, CRLF y separador ';' si el encabezado lo usa. */
function parsearCsv(texto) {
  texto = String(texto || '').replace(/^﻿/, '');
  var primera = texto.split(/\r?\n/, 1)[0] || '';
  var sep = primera.indexOf(',') < 0 && primera.indexOf(';') >= 0 ? ';' : ',';
  var filas = [], fila = [], campo = '', comillas = false;
  for (var i = 0; i < texto.length; i++) {
    var c = texto[i];
    if (comillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else comillas = false;
      } else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(campo); filas.push(fila); fila = []; campo = '';
    } else campo += c;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  return filas.filter(function (f) { return !(f.length === 1 && f[0] === ''); });
}

/**
 * conciliacion_estado.csv (id, estado_conciliacion, conciliado_con) → cambios.
 * `filas` = filas actuales del Diario. Devuelve {cambios:[{indice, estado_conciliacion,
 * conciliado_con}], desconocidos:[id], error}
 */
function aplicarConciliacion(filasCsv, filas) {
  var r = { cambios: [], desconocidos: [], error: '' };
  if (!filasCsv.length) { r.error = 'archivo vacío'; return r; }
  var enc = filasCsv[0].map(function (h) { return claveTexto(h); });
  var iId = enc.indexOf('id'), iEst = enc.indexOf('estado_conciliacion'), iCon = enc.indexOf('conciliado_con');
  if (iId < 0 || (iEst < 0 && iCon < 0)) {
    r.error = 'faltan columnas: se esperan id, estado_conciliacion, conciliado_con';
    return r;
  }
  var indice = {};
  filas.forEach(function (f, i) { indice[String(f.id)] = i; });
  var porIndice = {};
  for (var k = 1; k < filasCsv.length; k++) {
    var fc = filasCsv[k];
    var id = String(fc[iId] || '').trim();
    if (!id) continue;
    if (!(id in indice)) { r.desconocidos.push(id); continue; }
    var i = indice[id];
    var f = filas[i];
    var est = iEst >= 0 ? texto_(fc[iEst], 100) : String(f.estado_conciliacion || '');
    var con = iCon >= 0 ? texto_(fc[iCon], 500) : String(f.conciliado_con || '');
    if (est === String(f.estado_conciliacion || '') && con === String(f.conciliado_con || '')) {
      delete porIndice[i];
      continue;
    }
    porIndice[i] = { indice: i, estado_conciliacion: est, conciliado_con: con };
  }
  r.cambios = Object.keys(porIndice).map(function (i) { return porIndice[i]; });
  return r;
}

/* ------------------------------------------------------------------ */
/* Seguridad                                                           */
/* ------------------------------------------------------------------ */

/** Comparación en tiempo constante. Token mínimo de 16 caracteres. */
function tokenValido(recibido, esperado) {
  if (typeof recibido !== 'string' || typeof esperado !== 'string') return false;
  if (esperado.length < 16 || recibido.length !== esperado.length) return false;
  var dif = 0;
  for (var i = 0; i < esperado.length; i++) dif |= recibido.charCodeAt(i) ^ esperado.charCodeAt(i);
  return dif === 0;
}

/* ------------------------------------------------------------------ */
/* API (la usa doPost y el servidor simulado)                          */
/* ------------------------------------------------------------------ */

var ACCIONES_QUE_ESCRIBEN = ['registrar', 'editar', 'anular'];

/**
 * Atiende una petición. `almacen` abstrae la hoja:
 *   token(), leerFilas(), agregarFilas(filas), actualizarFila(indice, fila),
 *   leerTasas(), leerConfig()
 * Devuelve {respuesta, cambio} — cambio=true si hay que exportar el CSV.
 */
function manejarPeticion(cuerpo, almacen, ahora) {
  var p;
  try { p = typeof cuerpo === 'string' ? JSON.parse(cuerpo) : cuerpo; } catch (e) { p = null; }
  if (!p || typeof p !== 'object') return { respuesta: { ok: false, error: 'solicitud inválida' }, cambio: false };
  if (!tokenValido(p.token, almacen.token())) return { respuesta: { ok: false, error: 'no autorizado' }, cambio: false };
  var ahoraLocal = aFechaCaracas(ahora || new Date());
  var tasas = function () { return normalizarTasas(almacen.leerTasas()); };

  switch (p.accion) {
    case 'config': {
      var cfg = almacen.leerConfig();
      var filas = almacen.leerFilas();
      var t = buscarTasa(tasas(), diaDe(ahoraLocal));
      return {
        respuesta: {
          ok: true, version: VERSION_BACKEND, ahora: fechaIsoConZona(ahoraLocal),
          config: { categorias: cfg.categorias, cuentas: cfg.cuentas, medios: cfg.medios, monedas: cfg.monedas },
          tasa: t ? { fecha: t.fecha, usd: t.usd, eur: t.eur } : null,
          sugerencias: calcularSugerencias(filas, 300),
          uso: calcularUso(filas)
        },
        cambio: false
      };
    }
    case 'registrar': {
      var existentes = almacen.leerFilas().map(function (f) { return f.id; });
      var r = procesarRegistro(p.movimientos, existentes, tasas(), almacen.leerConfig(), ahoraLocal);
      if (r.nuevas.length) almacen.agregarFilas(r.nuevas);
      return {
        respuesta: { ok: true, guardados: r.guardados, duplicados: r.duplicados, rechazados: r.rechazados },
        cambio: r.nuevas.length > 0
      };
    }
    case 'editar':
    case 'anular': {
      var todas = almacen.leerFilas();
      var id = String(p.id || '');
      var idx = -1;
      for (var i = todas.length - 1; i >= 0; i--) if (String(todas[i].id) === id) { idx = i; break; }
      if (!id || idx < 0) return { respuesta: { ok: false, error: 'no encontrado' }, cambio: false };
      var res;
      if (p.accion === 'anular') res = { ok: true, fila: anularFila(todas[idx], ahoraLocal) };
      else res = aplicarEdicion(todas[idx], p.cambios, tasas(), almacen.leerConfig(), ahoraLocal);
      if (!res.ok) return { respuesta: res, cambio: false };
      almacen.actualizarFila(idx, res.fila);
      return { respuesta: { ok: true, fila: res.fila }, cambio: true };
    }
    case 'ultimos': {
      var n = Math.max(1, Math.min(200, parseInt(p.n, 10) || 30));
      var ult = almacen.leerFilas().filter(function (f) { return f.id; }).slice(-n).sort(function (a, b) {
        return String(a.fecha) < String(b.fecha) ? 1 : String(a.fecha) > String(b.fecha) ? -1 : 0;
      });
      return { respuesta: { ok: true, filas: ult }, cambio: false };
    }
    default:
      return { respuesta: { ok: false, error: 'acción desconocida' }, cambio: false };
  }
}

/* Export condicional para Node (en Apps Script `module` no existe). */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    VERSION_BACKEND: VERSION_BACKEND, ZONA_HORARIA: ZONA_HORARIA, ENCABEZADOS_DIARIO: ENCABEZADOS_DIARIO,
    ENCABEZADOS_TASAS: ENCABEZADOS_TASAS, ENCABEZADOS_LOG: ENCABEZADOS_LOG, TIPOS: TIPOS,
    CAMPOS_FECHA_HORA: CAMPOS_FECHA_HORA, CAMPOS_BOOLEANOS: CAMPOS_BOOLEANOS, CAMPOS_TEXTO: CAMPOS_TEXTO,
    CAMPOS_EDITABLES: CAMPOS_EDITABLES, CONFIG_TABLAS: CONFIG_TABLAS, CONFIG_INICIAL: CONFIG_INICIAL,
    FUENTES_BCV: FUENTES_BCV, ACCIONES_QUE_ESCRIBEN: ACCIONES_QUE_ESCRIBEN,
    aFechaCaracas: aFechaCaracas, parsearFecha: parsearFecha, normalizarFecha: normalizarFecha,
    diaDe: diaDe, sumarDias: sumarDias, hoyCaracas: hoyCaracas, fechaIsoConZona: fechaIsoConZona,
    normalizarTasas: normalizarTasas, buscarTasa: buscarTasa, diasFaltantes: diasFaltantes,
    urlTasaDia: urlTasaDia, urlHistorial: urlHistorial, parsearTasaBcv: parsearTasaBcv,
    parsearHistorialBcv: parsearHistorialBcv, redondear: redondear, calcularMontos: calcularMontos,
    validarMovimiento: validarMovimiento, construirFila: construirFila, recalcularFila: recalcularFila,
    procesarRegistro: procesarRegistro, aplicarEdicion: aplicarEdicion, anularFila: anularFila,
    rellenarProvisionales: rellenarProvisionales, esVerdadero: esVerdadero,
    leerConfigDeValores: leerConfigDeValores, configInicialComoObjeto: configInicialComoObjeto,
    claveTexto: claveTexto, calcularSugerencias: calcularSugerencias, calcularUso: calcularUso,
    generarCsv: generarCsv, parsearCsv: parsearCsv, aplicarConciliacion: aplicarConciliacion,
    tokenValido: tokenValido, manejarPeticion: manejarPeticion, monedaDeCuenta: monedaDeCuenta
  };
}
