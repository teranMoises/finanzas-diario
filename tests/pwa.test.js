import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parsearMonto, formatearMonto, conMoneda, equivalente } from '../docs/js/montos.js';
import { aLocalCaracas, desdeLocalCaracas, ahoraIso, fechaCorta, aDate } from '../docs/js/fechas.js';
import { crearCola, sincronizar, almacenMemoria, ErrorRed, ErrorAuth } from '../docs/js/cola.js';
import { CONFIG_POR_DEFECTO, ordenarPorUso, filtrarCategorias, buscarSugerencias } from '../docs/js/datos.js';
import { leerCfgDeHash, crearCfgHash, urlPermitida } from '../docs/js/api.js';
import { VERSION } from '../docs/js/version.js';
import { cargarLogica } from './cargar-logica.js';

const docs = (p) => fileURLToPath(new URL('../docs/' + p, import.meta.url));

describe('parsearMonto (formato venezolano)', () => {
  const casos = [
    ['1.234,56', 1234.56], ['1234,56', 1234.56], ['1234.56', 1234.56], ['1.234', 1234],
    ['1.234.567', 1234567], ['1.234.567,8', 1234567.8], ['12,5', 12.5], ['12.5', 12.5],
    ['1.5', 1.5], ['0,99', 0.99], [',5', 0.5], ['.5', 0.5], ['100', 100], ['1.000.000', 1000000],
    [' 1 234,56 ', 1234.56], ['Bs 250', 250], ['$12,30', 12.3], ['1.234.56', 1234.56],
    ['7,123', 7.123], ['1.000,', 1000], ['15.', 15]
  ];
  for (const [texto, esperado] of casos) {
    test(`"${texto}" → ${esperado}`, () => assert.equal(parsearMonto(texto), esperado));
  }
  for (const malo of ['', '   ', 'abc', '0', '0,00', '-5', '1,2,3', '12a', '1,234.56', ',', '.', null, undefined]) {
    test(`${JSON.stringify(malo)} → null`, () => assert.equal(parsearMonto(malo), null));
  }
  test('número directo', () => { assert.equal(parsearMonto(12.5), 12.5); assert.equal(parsearMonto(-1), null); });
});

describe('formatearMonto', () => {
  test('miles con punto, decimales con coma', () => {
    assert.equal(formatearMonto(1234.5), '1.234,50');
    assert.equal(formatearMonto(1234567.891), '1.234.567,89');
    assert.equal(formatearMonto(-0.5), '-0,50');
    assert.equal(formatearMonto(100, 0), '100');
    assert.equal(formatearMonto(''), '');
  });
  test('ida y vuelta', () => {
    for (const n of [0.01, 1, 999.99, 1000, 1234.56, 98765432.1]) assert.equal(parsearMonto(formatearMonto(n)), n);
  });
  test('conMoneda y equivalente', () => {
    assert.equal(conMoneda(10, 'USD'), '$ 10,00');
    assert.equal(conMoneda(1500, 'Bs'), '1.500,00 Bs');
    assert.deepEqual(equivalente(894.8876, 'Bs', { usd: 894.8876 }), { monto: 1, moneda: 'USD' });
    assert.deepEqual(equivalente(2, 'USDT', { usd: 400 }), { monto: 800, moneda: 'Bs' });
    assert.deepEqual(equivalente(2, 'EUR', { usd: 400, eur: 450 }), { monto: 900, moneda: 'Bs' });
    assert.equal(equivalente(2, 'EUR', { usd: 400 }), null);
    assert.equal(equivalente(2, 'Bs', null), null);
  });
});

describe('fechas (Caracas)', () => {
  test('conversiones', () => {
    const d = new Date('2026-11-05T03:30:00Z');
    assert.equal(aLocalCaracas(d), '2026-11-04T23:30');
    assert.equal(ahoraIso(d), '2026-11-04T23:30:00-04:00');
    assert.equal(desdeLocalCaracas('2026-11-04T23:30'), '2026-11-04T23:30:00-04:00');
    assert.equal(desdeLocalCaracas('mal'), null);
    assert.equal(aDate('2026-11-04T23:30:00').toISOString(), '2026-11-05T03:30:00.000Z');
    assert.equal(fechaCorta('2026-11-04T23:30:00-04:00'), 'mié 04/11 23:30');
  });
});

describe('datos de la interfaz', () => {
  test('config por defecto = Config inicial de Logica.gs', () => {
    const L = cargarLogica();
    const c = JSON.parse(JSON.stringify(L.configInicialComoObjeto()));
    delete c.ajustes;
    assert.deepEqual(c, CONFIG_POR_DEFECTO);
  });
  test('ordenarPorUso mantiene el orden de la hoja como desempate', () => {
    assert.deepEqual(ordenarPorUso(['a', 'b', 'c', 'd'], { c: 5, d: 1 }), ['c', 'd', 'a', 'b']);
  });
  test('filtrarCategorias por tipo (vacío = todas)', () => {
    const ing = filtrarCategorias(CONFIG_POR_DEFECTO.categorias, 'Ingreso');
    assert.ok(ing.includes('Salarios') && ing.includes('Regalos') && !ing.includes('Alimentos'));
    assert.deepEqual(filtrarCategorias(CONFIG_POR_DEFECTO.categorias, 'Traspaso'), ['Regalos', 'Retiros', 'Préstamos', 'Inversiones', 'Entre Cuentas']);
  });
  test('buscarSugerencias: prefijo, palabra, sin acentos, por uso', () => {
    const s = [
      { descripcion: 'Panadería', n: 2 }, { descripcion: 'Pan de año', n: 9 }, { descripcion: 'Farmacia Saas', n: 4 },
      { descripcion: 'Compra en panaderia', n: 20 }
    ];
    assert.deepEqual(buscarSugerencias(s, 'pan').map((x) => x.descripcion), ['Pan de año', 'Panadería', 'Compra en panaderia']);
    assert.deepEqual(buscarSugerencias(s, 'SAAS').map((x) => x.descripcion), ['Farmacia Saas']);
    assert.deepEqual(buscarSugerencias(s, ''), []);
  });
});

describe('enlace #cfg', () => {
  test('ida y vuelta con UTF-8', () => {
    const cfg = { url: 'https://script.google.com/macros/s/ABC_ñ/exec', token: 'a'.repeat(64) };
    assert.deepEqual(leerCfgDeHash(crearCfgHash(cfg)), cfg);
  });
  test('compatible con base64 web-safe de Apps Script (con o sin =)', () => {
    const json = JSON.stringify({ url: 'https://script.google.com/x/exec', token: 'b'.repeat(64) });
    const b64 = Buffer.from(json).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
    assert.equal(leerCfgDeHash('#cfg=' + b64).token, 'b'.repeat(64));
    assert.equal(leerCfgDeHash('#cfg=' + b64.replace(/=+$/, '')).token, 'b'.repeat(64));
  });
  test('rechaza URLs no seguras, tokens cortos y basura', () => {
    const h = (o) => '#cfg=' + Buffer.from(JSON.stringify(o)).toString('base64url');
    assert.equal(leerCfgDeHash(h({ url: 'http://evil.com/exec', token: 'x'.repeat(20) })), null);
    assert.equal(leerCfgDeHash(h({ url: 'javascript:alert(1)', token: 'x'.repeat(20) })), null);
    assert.equal(leerCfgDeHash(h({ url: 'https://ok.com', token: 'corto' })), null);
    assert.equal(leerCfgDeHash('#cfg=%%%'), null);
    assert.equal(leerCfgDeHash('#otra'), null);
    assert.equal(urlPermitida('http://localhost:8787/exec'), true);
  });
});

describe('cola de envíos', () => {
  const mov = (n, extra = {}) => ({ id: `mov-${String(n).padStart(4, '0')}`, fecha: '2026-11-04T10:00:00-04:00', tipo: 'Gasto', categoria: 'Ocio', cuenta: 'Banesco Corriente', monto: n, moneda: 'Bs', ...extra });

  // Servidor falso con la lógica real de Logica.gs.
  function servidorFalso() {
    const L = cargarLogica();
    const filas = [];
    const almacen = {
      token: () => 'T'.repeat(32), leerFilas: () => filas, agregarFilas: (n) => filas.push(...n),
      actualizarFila: (i, f) => { filas[i] = f; }, leerTasas: () => [{ fecha: '2026-11-01', usd: 400, eur: 450 }],
      leerConfig: () => L.configInicialComoObjeto()
    };
    const s = {
      filas, red: true, perderRespuesta: 0, llamadas: 0, token: 'T'.repeat(32),
      async llamar(accion, datos) {
        s.llamadas++;
        if (!s.red) throw new ErrorRed('sin conexión');
        const r = JSON.parse(JSON.stringify(L.manejarPeticion(JSON.stringify({ ...datos, accion, token: s.token }), almacen, new Date()).respuesta));
        if (s.perderRespuesta > 0) { s.perderRespuesta--; throw new ErrorRed('respuesta perdida'); }
        if (r.ok === false && r.error === 'no autorizado') throw new ErrorAuth('no autorizado');
        return r;
      }
    };
    return s;
  }

  test('sin red: todo queda en la cola; con red: se envía sin duplicar', async () => {
    const srv = servidorFalso();
    const cola = crearCola(almacenMemoria());
    await cola.registrar(mov(1));
    await cola.registrar(mov(2));
    srv.red = false;
    let r = await sincronizar(cola, srv.llamar);
    assert.equal(r.error, 'red');
    assert.equal(r.pendientes, 2);
    assert.equal(srv.filas.length, 0);
    srv.red = true;
    r = await sincronizar(cola, srv.llamar);
    assert.deepEqual([r.error, r.enviados, r.pendientes], [null, 2, 0]);
    assert.equal(srv.filas.length, 2);
    r = await sincronizar(cola, srv.llamar);
    assert.equal(srv.filas.length, 2);
  });

  test('respuesta perdida: el reintento no duplica', async () => {
    const srv = servidorFalso();
    const cola = crearCola(almacenMemoria());
    await cola.registrar(mov(1));
    srv.perderRespuesta = 1;
    let r = await sincronizar(cola, srv.llamar);
    assert.equal(r.pendientes, 1);
    assert.equal(srv.filas.length, 1, 'el servidor sí lo guardó');
    r = await sincronizar(cola, srv.llamar);
    assert.equal(r.pendientes, 0);
    assert.equal(srv.filas.length, 1, 'sin duplicado');
  });

  test('rechazado por el servidor: queda con error y no bloquea a los demás', async () => {
    const srv = servidorFalso();
    const cola = crearCola(almacenMemoria());
    await cola.registrar(mov(1, { tipo: 'Robo' }));
    await cola.registrar(mov(2));
    const r = await sincronizar(cola, srv.llamar);
    assert.equal(r.rechazados, 1);
    assert.equal(srv.filas.length, 1);
    const [pend] = await cola.todos();
    assert.equal(pend.error, 'tipo inválido');
    await cola.editar(pend.qid, { tipo: 'Gasto' });
    const r2 = await sincronizar(cola, srv.llamar);
    assert.equal(r2.pendientes, 0);
    assert.equal(srv.filas.length, 2);
  });

  test('editar y anular: local si está en cola, por servidor si ya se envió', async () => {
    const srv = servidorFalso();
    const cola = crearCola(almacenMemoria());
    await cola.registrar(mov(1));
    assert.equal(await cola.editar('mov-0001', { monto: 10 }), 'local');
    await sincronizar(cola, srv.llamar);
    assert.equal(srv.filas[0].monto, 10);
    srv.red = false;
    assert.equal(await cola.editar('mov-0001', { monto: 20 }), 'servidor');
    assert.equal(await cola.editar('mov-0001', { descripcion: 'x' }), 'servidor');
    assert.equal(await cola.anular('mov-0001'), 'servidor');
    assert.equal(await cola.contar(), 2, 'las ediciones se acumulan en una sola');
    srv.red = true;
    const r = await sincronizar(cola, srv.llamar);
    assert.equal(r.pendientes, 0);
    assert.equal(srv.filas.length, 1);
    assert.equal(srv.filas[0].monto, 20);
    assert.equal(srv.filas[0].descripcion, 'x');
    assert.equal(srv.filas[0].anulado, true);
  });

  test('anular algo aún no enviado: se envía ya anulado (nunca se borra)', async () => {
    const srv = servidorFalso();
    const cola = crearCola(almacenMemoria());
    await cola.registrar(mov(1));
    await cola.anular('mov-0001');
    await sincronizar(cola, srv.llamar);
    assert.equal(srv.filas[0].anulado, true);
  });

  test('editado mientras viajaba: el cambio se manda después', async () => {
    const srv = servidorFalso();
    const cola = crearCola(almacenMemoria());
    await cola.registrar(mov(1));
    const llamarLento = async (accion, datos) => {
      if (accion === 'registrar') await cola.editar('mov-0001', { monto: 99 });
      return srv.llamar(accion, datos);
    };
    const r = await sincronizar(cola, llamarLento);
    assert.equal(r.pendientes, 0);
    assert.equal(srv.filas.length, 1);
    assert.equal(srv.filas[0].monto, 99);
  });

  test('token inválido: error auth y la cola se conserva', async () => {
    const srv = servidorFalso();
    srv.token = 'malo'.repeat(8);
    const cola = crearCola(almacenMemoria());
    await cola.registrar(mov(1));
    const r = await sincronizar(cola, srv.llamar);
    assert.equal(r.error, 'auth');
    assert.equal(r.pendientes, 1);
  });

  test('lotes de 50', async () => {
    const srv = servidorFalso();
    const cola = crearCola(almacenMemoria());
    for (let i = 1; i <= 120; i++) await cola.registrar(mov(i));
    const r = await sincronizar(cola, srv.llamar);
    assert.equal(r.pendientes, 0);
    assert.equal(srv.filas.length, 120);
    assert.equal(srv.llamadas, 3);
  });
});

describe('empaquetado de la PWA', () => {
  const sw = readFileSync(docs('sw.js'), 'utf8');
  test('la versión del service worker coincide con la de la app', () => {
    assert.equal(/const VERSION = '([^']+)'/.exec(sw)[1], VERSION);
  });
  test('todos los archivos precacheados existen y todos los módulos están precacheados', () => {
    const lista = JSON.parse('[' + /const ARCHIVOS = \[([\s\S]*?)\];/.exec(sw)[1].replace(/'/g, '"').replace(/,\s*$/, '') + ']');
    for (const a of lista) if (a !== './') assert.ok(existsSync(docs(a)), a);
    for (const js of ['app', 'api', 'cola', 'datos', 'fechas', 'idb', 'montos', 'version']) assert.ok(lista.includes(`js/${js}.js`), js);
  });
  test('manifest con rutas relativas e íconos 192 y 512', () => {
    const m = JSON.parse(readFileSync(docs('manifest.webmanifest'), 'utf8'));
    assert.equal(m.start_url, './');
    assert.equal(m.scope, './');
    const tam = m.icons.map((i) => i.sizes);
    assert.ok(tam.includes('192x192') && tam.includes('512x512'));
    for (const i of m.icons) {
      assert.ok(!i.src.startsWith('/'), 'ruta relativa');
      const png = readFileSync(docs(i.src));
      assert.equal(png.readUInt32BE(16) + 'x' + png.readUInt32BE(20), i.sizes);
    }
  });
  test('sin datos personales en el código público', () => {
    const textos = ['index.html', 'js/app.js', 'js/api.js'].map((f) => readFileSync(docs(f), 'utf8')).join('\n');
    assert.doesNotMatch(textos, /script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}/);
  });
});
