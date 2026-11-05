// Finanzas Diario — interfaz. Sin frameworks.
import { VERSION } from './version.js';
import { parsearMonto, formatearMonto, conMoneda, equivalente } from './montos.js';
import { aLocalCaracas, desdeLocalCaracas, ahoraIso, fechaCorta, diaCorto } from './fechas.js';
import { crearCola, sincronizar, almacenMemoria, ErrorAuth } from './cola.js';
import { almacenIndexedDB } from './idb.js';
import { crearApi, leerCfgDeHash, urlPermitida } from './api.js';
import { CONFIG_POR_DEFECTO, ordenarPorUso, filtrarCategorias, buscarSugerencias, claveTexto } from './datos.js';

const $ = (id) => document.getElementById(id);
const TIPOS = ['Gasto', 'Ingreso', 'Traspaso'];
const REINTENTO_MS = 60_000;
const CONFIG_VIEJA_MS = 30 * 60_000;

/* ------------------------------------------------------------------ */
/* Almacenamiento local                                                */
/* ------------------------------------------------------------------ */

function leer(clave, porDefecto) {
  try {
    const v = localStorage.getItem(clave);
    return v ? JSON.parse(v) : porDefecto;
  } catch {
    return porDefecto;
  }
}
function guardar(clave, valor) {
  try { localStorage.setItem(clave, JSON.stringify(valor)); } catch { /* almacenamiento lleno o bloqueado */ }
}

let ajustes = leer('fd.ajustes', { url: '', token: '', dispositivo: '' });
if (!ajustes.dispositivo) {
  ajustes.dispositivo = 'Teléfono-' + Math.random().toString(16).slice(2, 6);
  guardar('fd.ajustes', ajustes);
}
let servidor = leer('fd.config', null); // respuesta de {accion:"config"}
let local = leer('fd.local', { uso: {}, ultimas: { cuentaPorTipo: {}, medioPorCuenta: {}, destino: '' }, sugerencias: {} });
let ultimosServidor = leer('fd.ultimos', { filas: [], recibido: 0 });
let infoSync = leer('fd.sync', { ultima: 0, error: null });

const config = () => (servidor && servidor.config) || CONFIG_POR_DEFECTO;
const tasa = () => (servidor && servidor.tasa) || null;
const configurado = () => !!(ajustes.url && ajustes.token);

let almacen;
try {
  almacen = typeof indexedDB !== 'undefined' ? almacenIndexedDB() : almacenMemoria();
} catch {
  almacen = almacenMemoria();
}
const cola = crearCola(almacen);
const llamar = crearApi(() => ajustes);

/* ------------------------------------------------------------------ */
/* Estado del formulario                                               */
/* ------------------------------------------------------------------ */

const estado = {
  tipo: 'Gasto', moneda: 'Bs', cuenta: '', destino: '', categoria: '', medio: '',
  fechaEditada: false, monedaEditada: false
};

function cuentaInfo(nombre) {
  return config().cuentas.find((c) => c.nombre === nombre);
}

function usoDe(seccion, tipo) {
  const srv = (servidor && servidor.uso) || {};
  const s = tipo ? (srv[seccion] || {})[tipo] || {} : srv[seccion] || {};
  const l = tipo ? ((local.uso[seccion] || {})[tipo] || {}) : (local.uso[seccion] || {});
  const total = { ...s };
  for (const [k, n] of Object.entries(l)) total[k] = (total[k] || 0) + n;
  return total;
}

function contarUso(seccion, tipo, valor) {
  if (!valor) return;
  local.uso[seccion] ||= {};
  const destino = tipo ? (local.uso[seccion][tipo] ||= {}) : local.uso[seccion];
  destino[valor] = (destino[valor] || 0) + 1;
}

/* ------------------------------------------------------------------ */
/* Render                                                              */
/* ------------------------------------------------------------------ */

function renderChips(contenedor, opciones, seleccionado, alElegir) {
  contenedor.replaceChildren(...opciones.map((op) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(op.valor === seleccionado));
    b.textContent = op.texto;
    if (op.extra) {
      const s = document.createElement('small');
      s.textContent = op.extra;
      b.append(s);
    }
    b.addEventListener('click', () => alElegir(op.valor === seleccionado && op.deseleccionable ? '' : op.valor));
    return b;
  }));
}

function renderTipo() {
  document.querySelectorAll('.tipo').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.tipo === estado.tipo)));
  $('grupoDestino').hidden = estado.tipo !== 'Traspaso';
  $('etqCuenta').textContent = estado.tipo === 'Traspaso' ? 'Desde' : estado.tipo === 'Ingreso' ? 'Cuenta que recibe' : 'Cuenta';
}

function renderCuentas() {
  const cuentas = ordenarPorUso(config().cuentas.map((c) => c.nombre), usoDe('cuentas', estado.tipo));
  const op = (n) => {
    const c = cuentaInfo(n);
    return { valor: n, texto: n, extra: c && c.moneda !== 'Bs' && !n.includes(c.moneda) && !n.includes('$') ? c.moneda : '' };
  };
  renderChips($('chipsCuenta'), cuentas.map(op), estado.cuenta, (v) => { elegirCuenta(v); });
  if (estado.tipo === 'Traspaso') {
    const destinos = ordenarPorUso(config().cuentas.map((c) => c.nombre).filter((n) => n !== estado.cuenta), usoDe('destinos'));
    renderChips($('chipsDestino'), destinos.map(op), estado.destino, (v) => { estado.destino = v; renderCuentas(); });
  }
}

function renderCategorias() {
  const nombres = filtrarCategorias(config().categorias, estado.tipo);
  const ordenadas = ordenarPorUso(nombres, usoDe('categorias', estado.tipo));
  renderChips($('chipsCategoria'), ordenadas.map((n) => ({ valor: n, texto: n })), estado.categoria, (v) => {
    estado.categoria = v;
    renderCategorias();
  });
}

function renderMedios() {
  const medios = ordenarPorUso(config().medios, usoDe('medios'));
  renderChips($('chipsMedio'), medios.map((n) => ({ valor: n, texto: n, deseleccionable: true })), estado.medio, (v) => {
    estado.medio = v;
    renderMedios();
  });
}

function renderMoneda() {
  $('moneda').textContent = estado.moneda;
  renderEquivalente();
}

function renderEquivalente() {
  const t = tasa();
  const monto = parsearMonto($('monto').value);
  const eq = equivalente(monto, estado.moneda, t);
  const el = $('equivalente');
  if (!monto) { el.innerHTML = '&nbsp;'; return; }
  if (!eq) { el.textContent = t ? '' : 'Sin tasa todavía'; return; }
  el.textContent = '≈ ' + conMoneda(eq.monto, eq.moneda);
}

function renderTasa() {
  const t = tasa();
  $('tasa').textContent = t ? `BCV $ ${formatearMonto(t.usd, 2)}${t.eur ? ' · € ' + formatearMonto(t.eur, 2) : ''} (${diaCorto(t.fecha).slice(0, 5)})` : 'Tasa: —';
}

function renderResumenMas() {
  const f = estado.fechaEditada && $('fecha').value ? fechaCorta(desdeLocalCaracas($('fecha').value)) : 'Ahora';
  const r = $('referencia').value.trim();
  $('resumenMas').textContent = `${f} · ${r ? 'ref. ' + r : 'sin referencia'}`;
}

function renderTodo() {
  renderTipo();
  renderCuentas();
  renderCategorias();
  renderMedios();
  renderMoneda();
  renderTasa();
  renderResumenMas();
  renderAvisoConfig();
}

function renderAvisoConfig() {
  const aviso = $('avisoConfig');
  if (!configurado()) {
    aviso.textContent = 'Este teléfono aún no está conectado. Abre el enlace de la hoja Config o ve a Ajustes. Lo que anotes se guarda y se enviará después.';
    aviso.hidden = false;
  } else if (infoSync.error === 'auth') {
    aviso.textContent = 'El servidor rechazó el token. Abre el enlace nuevo de la hoja Config. Tus anotaciones siguen guardadas aquí.';
    aviso.hidden = false;
  } else aviso.hidden = true;
}

async function renderPendientes() {
  const n = await cola.contar();
  const b = $('pendientes');
  b.hidden = n === 0;
  b.textContent = n === 1 ? '1 pendiente' : `${n} pendientes`;
  $('infoPendientes').textContent = String(n);
  $('infoSync').textContent = infoSync.ultima ? fechaCorta(new Date(infoSync.ultima).toISOString()) + (infoSync.error ? ` (error: ${infoSync.error})` : '') : '—';
  $('infoConfig').textContent = servidor && servidor.recibido
    ? `recibida ${fechaCorta(new Date(servidor.recibido).toISOString())} · backend ${servidor.version || '?'}`
    : 'usando valores por defecto';
}

function renderRed() {
  $('estadoRed').classList.toggle('en-linea', navigator.onLine);
  $('estadoRed').title = navigator.onLine ? 'En línea' : 'Sin conexión';
}

/* ------------------------------------------------------------------ */
/* Acciones del formulario                                             */
/* ------------------------------------------------------------------ */

function elegirTipo(tipo) {
  estado.tipo = tipo;
  const cuentas = config().cuentas.map((c) => c.nombre);
  const ultima = local.ultimas.cuentaPorTipo[tipo];
  if (ultima && cuentas.includes(ultima)) estado.cuenta = ultima;
  else if (!cuentas.includes(estado.cuenta)) estado.cuenta = ordenarPorUso(cuentas, usoDe('cuentas', tipo))[0] || '';
  const cats = filtrarCategorias(config().categorias, tipo);
  if (!cats.includes(estado.categoria)) estado.categoria = '';
  if (tipo === 'Traspaso') {
    if (!estado.categoria && cats.includes('Entre Cuentas')) estado.categoria = 'Entre Cuentas';
    if (!estado.destino || estado.destino === estado.cuenta) {
      const d = local.ultimas.destino;
      estado.destino = d && d !== estado.cuenta && cuentas.includes(d) ? d : '';
    }
  }
  elegirCuenta(estado.cuenta, { sinRender: true });
  renderTodo();
}

function elegirCuenta(nombre, { sinRender = false } = {}) {
  estado.cuenta = nombre;
  if (estado.destino === nombre) estado.destino = '';
  const c = cuentaInfo(nombre);
  if (c && !estado.monedaEditada) estado.moneda = c.moneda;
  const medio = local.ultimas.medioPorCuenta[nombre];
  if (medio && config().medios.includes(medio)) estado.medio = medio;
  else if (c && !c.bancaria && config().medios.includes('Efectivo') && /efectivo/i.test(nombre)) estado.medio = 'Efectivo';
  if (!sinRender) { renderCuentas(); renderMoneda(); renderMedios(); }
}

function rotarMoneda() {
  const m = config().monedas;
  estado.moneda = m[(m.indexOf(estado.moneda) + 1) % m.length] || 'Bs';
  estado.monedaEditada = true;
  renderMoneda();
}

function marcarError(el, mensaje) {
  el.classList.remove('error-campo');
  void el.offsetWidth;
  el.classList.add('error-campo');
  toast(mensaje);
  if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
}

async function alGuardar(ev) {
  ev.preventDefault();
  const monto = parsearMonto($('monto').value);
  if (!monto) { marcarError($('monto'), 'Escribe un monto válido'); $('monto').focus(); return; }
  if (!estado.cuenta) { marcarError($('chipsCuenta'), 'Elige la cuenta'); return; }
  if (estado.tipo === 'Traspaso' && !estado.destino) { marcarError($('chipsDestino'), 'Elige la cuenta destino'); return; }
  if (!estado.categoria) { marcarError($('chipsCategoria'), 'Elige la categoría'); return; }
  let fecha = ahoraIso();
  if (estado.fechaEditada && $('fecha').value) {
    fecha = desdeLocalCaracas($('fecha').value);
    if (!fecha) { marcarError($('fecha'), 'Fecha inválida'); return; }
  }
  const mov = {
    id: nuevoId(), fecha, tipo: estado.tipo, categoria: estado.categoria, cuenta: estado.cuenta,
    cuenta_destino: estado.tipo === 'Traspaso' ? estado.destino : '',
    descripcion: $('descripcion').value.trim(), monto, moneda: estado.moneda, medio: estado.medio,
    referencia: $('referencia').value.trim(), dispositivo: ajustes.dispositivo
  };
  $('guardar').disabled = true;
  try {
    await cola.registrar(mov);
  } catch (e) {
    $('guardar').disabled = false;
    toast('No se pudo guardar en el teléfono: ' + e.message);
    return;
  }
  aprender(mov);
  if (navigator.vibrate) navigator.vibrate(60);
  toast(`Guardado: ${conMoneda(monto, mov.moneda)}${mov.descripcion ? ' · ' + mov.descripcion : ''}`, true);
  limpiarFormulario();
  $('guardar').disabled = false;
  await renderPendientes();
  programarSync(0);
}

function aprender(mov) {
  contarUso('categorias', mov.tipo, mov.categoria);
  contarUso('cuentas', mov.tipo, mov.cuenta);
  contarUso('medios', null, mov.medio);
  if (mov.cuenta_destino) contarUso('destinos', null, mov.cuenta_destino);
  local.ultimas.cuentaPorTipo[mov.tipo] = mov.cuenta;
  if (mov.medio) local.ultimas.medioPorCuenta[mov.cuenta] = mov.medio;
  if (mov.cuenta_destino) local.ultimas.destino = mov.cuenta_destino;
  if (mov.descripcion) {
    const k = claveTexto(mov.descripcion);
    const prev = local.sugerencias[k];
    local.sugerencias[k] = {
      descripcion: mov.descripcion, n: (prev ? prev.n : 0) + 1, ultimo: mov.fecha, tipo: mov.tipo,
      categoria: mov.categoria, cuenta: mov.cuenta, medio: mov.medio, cuenta_destino: mov.cuenta_destino
    };
  }
  guardar('fd.local', local);
}

function limpiarFormulario() {
  $('monto').value = '';
  $('descripcion').value = '';
  $('referencia').value = '';
  $('fecha').value = aLocalCaracas();
  estado.fechaEditada = false;
  estado.monedaEditada = false;
  estado.categoria = estado.tipo === 'Traspaso' && filtrarCategorias(config().categorias, 'Traspaso').includes('Entre Cuentas') ? 'Entre Cuentas' : '';
  $('mas').open = false;
  cerrarSugerencias();
  elegirCuenta(estado.cuenta, { sinRender: true });
  renderTodo();
  $('monto').focus();
}

function nuevoId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/* ------------------------------------------------------------------ */
/* Autocompletado de descripción                                       */
/* ------------------------------------------------------------------ */

let sugerenciasVisibles = [];
let indiceSugerencia = -1;

function todasLasSugerencias() {
  const mapa = new Map();
  for (const s of (servidor && servidor.sugerencias) || []) mapa.set(claveTexto(s.descripcion), s);
  for (const [k, s] of Object.entries(local.sugerencias)) {
    const srv = mapa.get(k);
    mapa.set(k, srv ? { ...srv, ...s, n: Math.max(srv.n, s.n) } : s);
  }
  return [...mapa.values()];
}

function mostrarSugerencias() {
  const q = $('descripcion').value;
  sugerenciasVisibles = q.trim() ? buscarSugerencias(todasLasSugerencias(), q, 6) : [];
  indiceSugerencia = -1;
  const ul = $('sugerencias');
  if (!sugerenciasVisibles.length) { ul.hidden = true; return; }
  ul.replaceChildren(...sugerenciasVisibles.map((s, i) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.textContent = s.descripcion;
    const sm = document.createElement('small');
    sm.textContent = [s.categoria, s.cuenta, s.medio].filter(Boolean).join(' · ');
    li.append(sm);
    li.addEventListener('pointerdown', (e) => { e.preventDefault(); aplicarSugerencia(i); });
    return li;
  }));
  ul.hidden = false;
}

function cerrarSugerencias() {
  $('sugerencias').hidden = true;
  sugerenciasVisibles = [];
}

function aplicarSugerencia(i) {
  const s = sugerenciasVisibles[i];
  if (!s) return;
  $('descripcion').value = s.descripcion;
  const cfg = config();
  if (s.tipo && TIPOS.includes(s.tipo) && s.tipo !== estado.tipo) {
    estado.tipo = s.tipo;
  }
  const cuentas = cfg.cuentas.map((c) => c.nombre);
  if (s.cuenta && cuentas.includes(s.cuenta)) elegirCuenta(s.cuenta, { sinRender: true });
  if (estado.tipo === 'Traspaso' && s.cuenta_destino && cuentas.includes(s.cuenta_destino) && s.cuenta_destino !== estado.cuenta) estado.destino = s.cuenta_destino;
  if (s.categoria && filtrarCategorias(cfg.categorias, estado.tipo).includes(s.categoria)) estado.categoria = s.categoria;
  if (s.medio && cfg.medios.includes(s.medio)) estado.medio = s.medio;
  cerrarSugerencias();
  renderTodo();
  if (!parsearMonto($('monto').value)) $('monto').focus();
  else $('guardar').focus();
}

/* ------------------------------------------------------------------ */
/* Sincronización                                                      */
/* ------------------------------------------------------------------ */

let sincronizando = null;
let temporizador = null;

function programarSync(ms = REINTENTO_MS) {
  clearTimeout(temporizador);
  temporizador = setTimeout(() => { sincronizarAhora(); }, ms);
}

async function sincronizarAhora({ forzarConfig = false } = {}) {
  if (sincronizando) return sincronizando;
  sincronizando = (async () => {
    try {
      if (!configurado()) return { error: 'sin configurar' };
      const r = await sincronizar(cola, llamar);
      infoSync = { ultima: Date.now(), error: r.error };
      guardar('fd.sync', infoSync);
      if (r.rechazados) toast(`${r.rechazados} anotación(es) rechazada(s): revísalas en Últimos`);
      if (!r.error && (forzarConfig || !servidor || Date.now() - (servidor.recibido || 0) > CONFIG_VIEJA_MS)) {
        await traerConfig().catch(() => {});
      }
      return r;
    } finally {
      sincronizando = null;
      renderAvisoConfig();
      await renderPendientes();
      const n = await cola.contar();
      const hayReintentables = (await cola.todos()).some((i) => !i.error);
      if (n && hayReintentables) programarSync(REINTENTO_MS);
      if (!$('vistaUltimos').hidden) renderLista();
    }
  })();
  return sincronizando;
}

async function traerConfig() {
  const r = await llamar('config');
  if (!r || !r.ok) throw new Error((r && r.error) || 'respuesta inválida');
  servidor = { config: r.config, tasa: r.tasa, sugerencias: r.sugerencias || [], uso: r.uso || {}, version: r.version, recibido: Date.now() };
  // El servidor ya cuenta lo enviado: se reinician los conteos locales.
  local.uso = {};
  guardar('fd.local', local);
  guardar('fd.config', servidor);
  if (!cuentaInfo(estado.cuenta)) estado.cuenta = '';
  elegirTipo(estado.tipo);
  return r;
}

/* ------------------------------------------------------------------ */
/* Últimos                                                             */
/* ------------------------------------------------------------------ */

async function cargarUltimos() {
  $('notaUltimos').textContent = 'Cargando…';
  try {
    const r = await llamar('ultimos', { n: 60 });
    if (r && r.ok) {
      ultimosServidor = { filas: r.filas, recibido: Date.now() };
      guardar('fd.ultimos', ultimosServidor);
      $('notaUltimos').textContent = '';
    } else $('notaUltimos').textContent = 'No se pudo cargar: ' + ((r && r.error) || 'error');
  } catch (e) {
    $('notaUltimos').textContent = ultimosServidor.recibido
      ? `Sin conexión. Mostrando lo recibido el ${fechaCorta(new Date(ultimosServidor.recibido).toISOString())}.`
      : configurado() ? 'Sin conexión: solo se muestran los pendientes.' : 'Configura el servidor en Ajustes para ver lo guardado.';
  }
  await renderLista();
}

async function elementosLista() {
  const pendientes = await cola.todos();
  const porId = new Map();
  for (const f of ultimosServidor.filas) porId.set(f.id, { fila: { ...f }, origen: 'servidor', pendiente: null });
  for (const it of pendientes) {
    if (it.op === 'registrar') {
      porId.set(it.qid, { fila: { ...it.datos }, origen: 'cola', pendiente: it });
    } else {
      const e = porId.get(it.datos.id);
      if (!e) continue;
      if (it.op === 'editar') Object.assign(e.fila, it.datos.cambios);
      if (it.op === 'anular') e.fila.anulado = true;
      e.pendiente = it;
    }
  }
  return [...porId.values()].sort((a, b) => (String(a.fila.fecha) < String(b.fila.fecha) ? 1 : -1));
}

async function renderLista() {
  const items = await elementosLista();
  const ul = $('lista');
  if (!items.length) {
    const li = document.createElement('p');
    li.className = 'nota';
    li.textContent = 'Todavía no hay anotaciones.';
    ul.replaceChildren(li);
    return;
  }
  ul.replaceChildren(...items.map((e) => {
    const f = e.fila;
    const li = document.createElement('li');
    li.className = `${f.tipo} ${esVerdadero(f.anulado) ? 'anulado' : ''}`;
    const desc = document.createElement('span');
    desc.className = 'desc';
    desc.textContent = f.descripcion || f.categoria;
    if (e.pendiente) {
      const t = document.createElement('span');
      t.className = 'etq' + (e.pendiente.error ? ' error' : '');
      t.textContent = e.pendiente.error ? 'error' : 'pendiente';
      if (e.pendiente.error) t.title = e.pendiente.error;
      desc.append(t);
    }
    if (esVerdadero(f.anulado)) {
      const t = document.createElement('span');
      t.className = 'etq';
      t.textContent = 'anulado';
      desc.append(t);
    }
    const det = document.createElement('span');
    det.className = 'det';
    det.textContent = [fechaCorta(f.fecha), f.categoria, f.tipo === 'Traspaso' ? `${f.cuenta} → ${f.cuenta_destino}` : f.cuenta].filter(Boolean).join(' · ');
    const valor = document.createElement('span');
    valor.className = 'valor';
    const signo = f.tipo === 'Ingreso' ? '+' : '−';
    valor.textContent = signo + conMoneda(Number(f.monto), f.moneda);
    if (f.moneda !== 'Bs' && f.monto_bs !== '' && f.monto_bs !== undefined) {
      const s = document.createElement('small');
      s.textContent = conMoneda(Math.abs(Number(f.monto_bs)), 'Bs');
      valor.append(s);
    } else if (f.moneda === 'Bs' && f.monto_usd !== '' && f.monto_usd !== undefined) {
      const s = document.createElement('small');
      s.textContent = conMoneda(Math.abs(Number(f.monto_usd)), 'USD');
      valor.append(s);
    }
    li.append(desc, valor, det);
    li.addEventListener('click', () => abrirEdicion(e));
    return li;
  }));
}

function esVerdadero(v) {
  return v === true || String(v).toLowerCase() === 'true';
}

/* ------------------------------------------------------------------ */
/* Editar / anular                                                     */
/* ------------------------------------------------------------------ */

let enEdicion = null;

function llenarSelect(sel, opciones, valor) {
  const lista = [...opciones];
  if (valor && !lista.includes(valor)) lista.unshift(valor);
  sel.replaceChildren(...lista.map((o) => {
    const op = document.createElement('option');
    op.value = o;
    op.textContent = o || '—';
    return op;
  }));
  sel.value = valor || '';
}

function abrirEdicion(e) {
  enEdicion = e;
  const f = e.fila;
  const cfg = config();
  $('edTipo').value = f.tipo;
  $('edMonto').value = formatearMonto(Number(f.monto), Number(f.monto) % 1 ? 2 : 0).replace(/,00$/, '');
  llenarSelect($('edMoneda'), cfg.monedas, f.moneda);
  $('edDescripcion').value = f.descripcion || '';
  llenarSelect($('edCategoria'), cfg.categorias.map((c) => c.nombre), f.categoria);
  const cuentas = cfg.cuentas.map((c) => c.nombre);
  llenarSelect($('edCuenta'), cuentas, f.cuenta);
  llenarSelect($('edDestino'), ['', ...cuentas], f.cuenta_destino || '');
  llenarSelect($('edMedio'), ['', ...cfg.medios], f.medio || '');
  $('edFecha').value = String(f.fecha || '').slice(0, 16);
  $('edReferencia').value = f.referencia || '';
  $('edGrupoDestino').hidden = f.tipo !== 'Traspaso';
  const partes = [];
  if (e.origen === 'cola') partes.push('Aún no se ha enviado al servidor.');
  if (e.pendiente && e.pendiente.error) partes.push('Error del servidor: ' + e.pendiente.error);
  if (f.estado_conciliacion) partes.push('Conciliación: ' + f.estado_conciliacion + (f.conciliado_con ? ` (${f.conciliado_con})` : ''));
  if (esVerdadero(f.tasa_provisional)) partes.push('Tasa provisional.');
  $('edEstado').textContent = partes.join(' ');
  $('edAnular').hidden = esVerdadero(f.anulado);
  $('dlgEditar').showModal();
}

async function guardarEdicion(ev) {
  ev.preventDefault();
  if (!enEdicion) return;
  const f = enEdicion.fila;
  const monto = parsearMonto($('edMonto').value);
  if (!monto) { marcarError($('edMonto'), 'Monto inválido'); return; }
  const tipo = $('edTipo').value;
  const nuevo = {
    tipo, monto, moneda: $('edMoneda').value, descripcion: $('edDescripcion').value.trim(),
    categoria: $('edCategoria').value, cuenta: $('edCuenta').value,
    cuenta_destino: tipo === 'Traspaso' ? $('edDestino').value : '',
    medio: $('edMedio').value, referencia: $('edReferencia').value.trim()
  };
  if (tipo === 'Traspaso' && (!nuevo.cuenta_destino || nuevo.cuenta_destino === nuevo.cuenta)) {
    marcarError($('edDestino'), 'Elige una cuenta destino distinta'); return;
  }
  const fechaNueva = desdeLocalCaracas($('edFecha').value);
  if (!fechaNueva) { marcarError($('edFecha'), 'Fecha inválida'); return; }
  if ($('edFecha').value !== String(f.fecha || '').slice(0, 16)) nuevo.fecha = fechaNueva;
  const cambios = {};
  for (const [k, v] of Object.entries(nuevo)) {
    if (String(v ?? '') !== String(f[k] ?? '')) cambios[k] = v;
  }
  $('dlgEditar').close();
  if (!Object.keys(cambios).length) return;
  await cola.editar(f.id, cambios);
  if (enEdicion.origen === 'servidor') aplicarLocal(f.id, cambios);
  toast('Cambios guardados', true);
  await renderLista();
  await renderPendientes();
  programarSync(0);
}

async function anularActual() {
  if (!enEdicion) return;
  if (!confirm('¿Anular esta anotación? Quedará marcada como anulada (no se borra).')) return;
  const f = enEdicion.fila;
  await cola.anular(f.id);
  if (enEdicion.origen === 'servidor') aplicarLocal(f.id, { anulado: true });
  $('dlgEditar').close();
  toast('Anotación anulada', true);
  await renderLista();
  await renderPendientes();
  programarSync(0);
}

function aplicarLocal(id, cambios) {
  const fila = ultimosServidor.filas.find((x) => x.id === id);
  if (fila) Object.assign(fila, cambios);
  guardar('fd.ultimos', ultimosServidor);
}

/* ------------------------------------------------------------------ */
/* Ajustes y #cfg                                                      */
/* ------------------------------------------------------------------ */

function cargarAjustesEnFormulario() {
  $('ajUrl').value = ajustes.url || '';
  $('ajToken').value = ajustes.token || '';
  $('ajDispositivo').value = ajustes.dispositivo || '';
  $('infoVersion').textContent = VERSION;
}

function guardarAjustes(ev) {
  ev.preventDefault();
  const url = $('ajUrl').value.trim();
  if (url && !urlPermitida(url)) { marcarError($('ajUrl'), 'La URL debe empezar por https://'); return; }
  ajustes = { url, token: $('ajToken').value.trim(), dispositivo: $('ajDispositivo').value.trim() || ajustes.dispositivo };
  guardar('fd.ajustes', ajustes);
  infoSync.error = null;
  toast('Ajustes guardados', true);
  renderAvisoConfig();
  sincronizarAhora({ forzarConfig: true });
}

async function probarConexion() {
  const out = $('resultadoAjustes');
  out.textContent = 'Probando…';
  try {
    const r = await traerConfig();
    infoSync.error = null;
    out.textContent = `Conexión correcta. Backend ${r.version}. ${r.tasa ? `Tasa BCV ${formatearMonto(r.tasa.usd)} del ${diaCorto(r.tasa.fecha)}.` : 'Aún no hay tasas cargadas.'}`;
  } catch (e) {
    out.textContent = e instanceof ErrorAuth && e.message !== 'sin configurar'
      ? 'El servidor rechazó el token.'
      : e.message === 'sin configurar' ? 'Falta la URL o el token.'
        : `No se pudo conectar (${e.message}). Revisa la URL y que el Web App tenga acceso "Cualquier usuario".`;
  }
  renderAvisoConfig();
  await renderPendientes();
}

function procesarHashCfg() {
  if (!/[#&]cfg=/.test(location.hash)) return false;
  const cfg = leerCfgDeHash(location.hash);
  history.replaceState(null, '', location.pathname + location.search);
  if (!cfg) { toast('El enlace de configuración no es válido'); return false; }
  const host = new URL(cfg.url).host;
  if (ajustes.url && ajustes.url !== cfg.url && !confirm(`¿Conectar este teléfono a ${host}? Reemplaza la configuración actual.`)) return false;
  ajustes = { ...ajustes, url: cfg.url, token: cfg.token };
  guardar('fd.ajustes', ajustes);
  infoSync.error = null;
  toast('Teléfono conectado ✓', true);
  return true;
}

/* ------------------------------------------------------------------ */
/* Navegación, toast, service worker                                   */
/* ------------------------------------------------------------------ */

function irA(vista) {
  document.querySelectorAll('.vista').forEach((s) => { s.hidden = s.dataset.vista !== vista; });
  document.querySelectorAll('.navegacion button').forEach((b) => b.classList.toggle('activo', b.dataset.ir === vista));
  if (vista === 'ultimos') { renderLista(); cargarUltimos(); }
  if (vista === 'ajustes') { cargarAjustesEnFormulario(); renderPendientes(); }
  if (vista === 'anotar') $('monto').focus();
  window.scrollTo(0, 0);
}

let relojToast = null;
function toast(texto, ok = false) {
  const t = $('toast');
  t.textContent = texto;
  t.classList.toggle('ok', ok);
  t.hidden = false;
  clearTimeout(relojToast);
  relojToast = setTimeout(() => { t.hidden = true; }, 2600);
}

let registro = null;
function iniciarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    registro = reg;
    const vigilar = (w) => {
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) $('avisoVersion').hidden = false;
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) $('avisoVersion').hidden = false;
    if (reg.installing) vigilar(reg.installing);
    reg.addEventListener('updatefound', () => vigilar(reg.installing));
  }).catch(() => {});
  let recargando = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recargando || !actualizacionPedida) return;
    recargando = true;
    location.reload();
  });
}
let actualizacionPedida = false;

function actualizarApp() {
  actualizacionPedida = true;
  if (registro && registro.waiting) registro.waiting.postMessage('saltarEspera');
  else location.reload();
}

/* ------------------------------------------------------------------ */
/* Inicio                                                              */
/* ------------------------------------------------------------------ */

function conectarEventos() {
  document.querySelectorAll('.tipo').forEach((b) => b.addEventListener('click', () => elegirTipo(b.dataset.tipo)));
  $('moneda').addEventListener('click', rotarMoneda);
  $('monto').addEventListener('input', renderEquivalente);
  $('monto').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('descripcion').focus(); } });
  $('descripcion').addEventListener('input', mostrarSugerencias);
  $('descripcion').addEventListener('blur', () => setTimeout(cerrarSugerencias, 150));
  $('descripcion').addEventListener('keydown', (e) => {
    const n = sugerenciasVisibles.length;
    if (e.key === 'ArrowDown' && n) { e.preventDefault(); indiceSugerencia = (indiceSugerencia + 1) % n; }
    else if (e.key === 'ArrowUp' && n) { e.preventDefault(); indiceSugerencia = (indiceSugerencia - 1 + n) % n; }
    else if (e.key === 'Enter' && n && indiceSugerencia >= 0) { e.preventDefault(); aplicarSugerencia(indiceSugerencia); return; }
    else if (e.key === 'Escape') { cerrarSugerencias(); return; }
    else return;
    [...$('sugerencias').children].forEach((li, i) => li.setAttribute('aria-selected', String(i === indiceSugerencia)));
  });
  $('fecha').addEventListener('input', () => { estado.fechaEditada = true; renderResumenMas(); });
  $('mas').addEventListener('toggle', () => { if ($('mas').open && !estado.fechaEditada) $('fecha').value = aLocalCaracas(); });
  $('referencia').addEventListener('input', renderResumenMas);
  $('formulario').addEventListener('submit', alGuardar);

  document.querySelectorAll('.navegacion button').forEach((b) => b.addEventListener('click', () => irA(b.dataset.ir)));
  $('pendientes').addEventListener('click', () => irA('ultimos'));
  $('btnRecargarUltimos').addEventListener('click', () => { sincronizarAhora().then(cargarUltimos); });

  $('formAjustes').addEventListener('submit', guardarAjustes);
  $('btnVerToken').addEventListener('click', () => {
    const t = $('ajToken');
    t.type = t.type === 'password' ? 'text' : 'password';
    $('btnVerToken').textContent = t.type === 'password' ? 'Ver' : 'Ocultar';
  });
  $('btnProbar').addEventListener('click', probarConexion);
  $('btnSincronizar').addEventListener('click', async () => {
    $('resultadoAjustes').textContent = 'Sincronizando…';
    const r = await sincronizarAhora({ forzarConfig: true });
    const n = await cola.contar();
    $('resultadoAjustes').textContent = r && r.error
      ? `No se pudo sincronizar (${r.error === 'auth' ? 'token rechazado' : r.error === 'red' ? 'sin conexión con el servidor' : r.error}). Pendientes: ${n}.`
      : `Listo. Pendientes: ${n}.`;
  });
  $('btnBuscarVersion').addEventListener('click', async () => {
    $('resultadoAjustes').textContent = 'Buscando…';
    try { await registro?.update(); } catch { /* sin red */ }
    $('resultadoAjustes').textContent = registro && registro.waiting ? 'Hay una versión nueva.' : `Tienes la última versión (${VERSION}).`;
    if (registro && registro.waiting) $('avisoVersion').hidden = false;
  });
  $('btnActualizar').addEventListener('click', actualizarApp);

  $('formEditar').addEventListener('submit', guardarEdicion);
  $('edCancelar').addEventListener('click', () => $('dlgEditar').close());
  $('edAnular').addEventListener('click', anularActual);
  $('edTipo').addEventListener('change', () => { $('edGrupoDestino').hidden = $('edTipo').value !== 'Traspaso'; });

  window.addEventListener('online', () => { renderRed(); sincronizarAhora(); });
  window.addEventListener('offline', renderRed);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      sincronizarAhora();
      registro?.update().catch(() => {});
      if (!estado.fechaEditada) $('fecha').value = aLocalCaracas();
    }
  });
  window.addEventListener('hashchange', () => { if (procesarHashCfg()) sincronizarAhora({ forzarConfig: true }); });
}

function iniciar() {
  const desdeEnlace = procesarHashCfg();
  conectarEventos();
  $('fecha').value = aLocalCaracas();
  elegirTipo('Gasto');
  renderRed();
  renderPendientes();
  $('monto').focus();
  iniciarServiceWorker();
  sincronizarAhora({ forzarConfig: desdeEnlace });
  // Exponer para pruebas de punta a punta.
  window.__fd = { cola, sincronizarAhora, version: VERSION };
}

iniciar();
