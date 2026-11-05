import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { cargarLogica } from './cargar-logica.js';

const L = cargarLogica();
const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345';

// vm crea objetos de otro "realm": los normalizamos para deepEqual.
const plano = (x) => JSON.parse(JSON.stringify(x));

const TASAS = L.normalizarTasas([
  { fecha: '2026-10-30', usd: 889.2553, eur: 992.80018713 },
  { fecha: '2026-11-02', usd: 889.5754, eur: 991.25386822 },
  { fecha: '2026-11-03', usd: 891.1054, eur: 997.92220429 },
  { fecha: '2026-11-04', usd: 893.2173, eur: 999.76919171 }
]);

describe('fechas', () => {
  test('aFechaCaracas usa UTC-4', () => {
    assert.equal(L.aFechaCaracas(new Date('2026-11-05T03:30:00Z')), '2026-11-04T23:30:00');
  });
  test('parsearFecha sin zona = Caracas; con zona respeta el offset', () => {
    assert.equal(L.normalizarFecha('2026-11-04T23:30'), '2026-11-04T23:30:00');
    assert.equal(L.normalizarFecha('2026-11-05T03:30:00Z'), '2026-11-04T23:30:00');
    assert.equal(L.normalizarFecha('2026-11-04T22:30:00-05:00'), '2026-11-04T23:30:00');
    assert.equal(L.normalizarFecha('2026-11-04'), '2026-11-04T00:00:00');
  });
  test('fechas inválidas', () => {
    assert.equal(L.normalizarFecha('2026-02-30T10:00'), null);
    assert.equal(L.normalizarFecha('ayer'), null);
    assert.equal(L.normalizarFecha(''), null);
    assert.equal(L.normalizarFecha(null), null);
  });
  test('sumarDias cruza meses y años', () => {
    assert.equal(L.sumarDias('2026-12-31', 1), '2027-01-01');
    assert.equal(L.sumarDias('2024-03-01', -1), '2024-02-29');
  });
});

describe('tasas con relleno hacia adelante', () => {
  test('día exacto', () => {
    const t = L.buscarTasa(TASAS, '2026-11-03');
    assert.equal(t.usd, 891.1054);
    assert.equal(t.exacta, true);
  });
  test('fin de semana hereda el viernes', () => {
    const t = L.buscarTasa(TASAS, '2026-11-01');
    assert.equal(t.fecha, '2026-10-30');
    assert.equal(t.usd, 889.2553);
    assert.equal(t.exacta, false);
  });
  test('después de la última fila usa la última', () => {
    assert.equal(L.buscarTasa(TASAS, '2026-12-25').fecha, '2026-11-04');
  });
  test('antes de la primera fila no hay tasa', () => {
    assert.equal(L.buscarTasa(TASAS, '2026-10-01'), null);
    assert.equal(L.buscarTasa([], '2026-10-01'), null);
  });
  test('normalizarTasas ordena, descarta inválidas y acepta Date', () => {
    const t = L.normalizarTasas([
      { fecha: '2026-11-02', usd: '889,5' }, { fecha: 'x', usd: 1 }, { fecha: '2026-11-01', usd: 0 },
      { fecha: new Date('2026-10-30T04:00:00Z'), usd: 10, eur: '' }
    ]);
    assert.deepEqual(plano(t), [{ fecha: '2026-10-30', usd: 10, eur: null }, { fecha: '2026-11-02', usd: 889.5, eur: null }]);
  });
  test('diasFaltantes', () => {
    assert.deepEqual(plano(L.diasFaltantes(['2026-11-02', '2026-11-04'], '2026-11-01', '2026-11-05')),
      ['2026-11-01', '2026-11-03', '2026-11-05']);
  });
  test('parsearTasaBcv (estructura real de bcv-api)', () => {
    const json = {
      USD: 889.2553, EUR: 992.80018713, CNY: 133.5, updated_at: '2026-10-29T23:28:16.258471+00:00',
      effective_date: '2026-10-30', date: '2026-10-31'
    };
    const t = L.parsearTasaBcv(json, '2026-10-31');
    assert.equal(t.fecha, '2026-10-31');
    assert.equal(t.usd, 889.2553);
    assert.match(t.fuente, /2026-10-30/);
    assert.equal(L.parsearTasaBcv(json, '2026-11-01'), null, 'fecha distinta a la pedida');
    assert.equal(L.parsearTasaBcv({ USD: 4.01, date: '2021-08-02' }).eur, null, 'históricos sin EUR');
    assert.equal(L.parsearTasaBcv({ error: 'x' }), null);
  });
});

describe('conversiones y signos', () => {
  const t = { usd: 400, eur: 450, exacta: true };
  test('Gasto en Bs', () => {
    const r = L.calcularMontos('Gasto', 1000, 'Bs', t);
    assert.deepEqual(plano(r), { tasa_bcv_usd: 400, tasa_usada: 1, monto_bs: -1000, monto_usd: -2.5, tasa_provisional: false });
  });
  test('Ingreso en USD', () => {
    const r = L.calcularMontos('Ingreso', 10, 'USD', t);
    assert.equal(r.monto_bs, 4000); assert.equal(r.monto_usd, 10); assert.equal(r.tasa_usada, 400);
  });
  test('USDT = 1 USD', () => {
    const r = L.calcularMontos('Gasto', 12.5, 'USDT', t);
    assert.equal(r.monto_usd, -12.5); assert.equal(r.monto_bs, -5000);
  });
  test('EUR usa tasa EUR y convierte a USD', () => {
    const r = L.calcularMontos('Gasto', 10, 'EUR', t);
    assert.equal(r.tasa_usada, 450); assert.equal(r.monto_bs, -4500); assert.equal(r.monto_usd, -11.25);
  });
  test('Traspaso es negativo (visto desde el origen)', () => {
    assert.equal(L.calcularMontos('Traspaso', 100, 'Bs', t).monto_bs, -100);
  });
  test('sin tasa: queda vacía y provisional', () => {
    const r = L.calcularMontos('Gasto', 1000, 'Bs', null);
    assert.deepEqual(plano(r), { tasa_bcv_usd: '', tasa_usada: 1, monto_bs: -1000, monto_usd: '', tasa_provisional: true });
    const u = L.calcularMontos('Gasto', 5, 'USD', null);
    assert.equal(u.monto_bs, ''); assert.equal(u.monto_usd, -5);
  });
  test('tasa heredada (no exacta) = provisional', () => {
    assert.equal(L.calcularMontos('Gasto', 1, 'Bs', { usd: 400, exacta: false }).tasa_provisional, true);
  });
  test('redondeo a 2 decimales sin -0', () => {
    assert.equal(L.redondear(-1.005, 2), -1.01);
    assert.equal(Object.is(L.redondear(-0.001, 2), 0), true);
  });
});

describe('validación', () => {
  const base = { id: 'a1b2c3d4-0000-4000-8000-000000000001', fecha: '2026-11-04T10:00:00-04:00', tipo: 'Gasto', categoria: 'Alimentos', cuenta: 'Banesco Corriente', monto: 100, moneda: 'Bs' };
  const cfg = L.configInicialComoObjeto();
  test('válido', () => assert.equal(L.validarMovimiento(base, cfg).ok, true));
  for (const [campo, valor, error] of [
    ['id', 'x', 'id inválido'], ['tipo', 'Robo', 'tipo inválido'], ['monto', -5, 'monto inválido'],
    ['monto', 0, 'monto inválido'], ['monto', 'abc', 'monto inválido'], ['fecha', 'nunca', 'fecha inválida'],
    ['cuenta', ' ', 'falta la cuenta'], ['categoria', '', 'falta la categoría'], ['moneda', 'BTC', 'moneda desconocida']
  ]) {
    test(`${campo}=${JSON.stringify(valor)} → ${error}`, () => {
      assert.deepEqual(plano(L.validarMovimiento({ ...base, [campo]: valor }, cfg)), { ok: false, error });
    });
  }
  test('traspaso requiere destino distinto y pone categoría por defecto', () => {
    const t = { ...base, tipo: 'Traspaso', categoria: '' };
    assert.equal(L.validarMovimiento(t, cfg).error, 'falta la cuenta destino');
    assert.equal(L.validarMovimiento({ ...t, cuenta_destino: 'Banesco Corriente' }, cfg).ok, false);
    const ok = L.validarMovimiento({ ...t, cuenta_destino: 'Efectivo Bs' }, cfg);
    assert.equal(ok.mov.categoria, 'Entre Cuentas');
  });
  test('cuenta_destino se limpia si no es traspaso', () => {
    assert.equal(L.validarMovimiento({ ...base, cuenta_destino: 'Efectivo Bs' }, cfg).mov.cuenta_destino, '');
  });
  test('moneda por defecto = la de la cuenta', () => {
    assert.equal(L.validarMovimiento({ ...base, moneda: '', cuenta: 'Binance' }, cfg).mov.moneda, 'USDT');
  });
  test('limpia espacios y caracteres de control', () => {
    assert.equal(L.validarMovimiento({ ...base, descripcion: '  Pan\n de  jamón ' }, cfg).mov.descripcion, 'Pan de jamón');
  });
});

describe('registro idempotente', () => {
  const cfg = L.configInicialComoObjeto();
  const mov = (n, extra = {}) => ({ id: `id-000000${n}`, fecha: '2026-11-03T12:00', tipo: 'Gasto', categoria: 'Ocio', cuenta: 'Banesco Corriente', monto: 891.1054, moneda: 'Bs', ...extra });
  test('nuevos, duplicados (existentes y en el mismo lote) y rechazados', () => {
    const r = L.procesarRegistro([mov(1), mov(2), mov(2), mov(3, { monto: -1 })], ['id-0000001'], TASAS, cfg, '2026-11-05T08:00:00');
    assert.deepEqual(plano(r.guardados), ['id-0000001', 'id-0000002', 'id-0000002']);
    assert.deepEqual(plano(r.duplicados), ['id-0000001', 'id-0000002']);
    assert.equal(r.nuevas.length, 1);
    assert.deepEqual(plano(r.rechazados), [{ id: 'id-0000003', error: 'monto inválido' }]);
    const f = r.nuevas[0];
    assert.equal(f.monto_usd, -1); assert.equal(f.tasa_provisional, false);
    assert.equal(f.registrado, '2026-11-05T08:00:00'); assert.equal(f.anulado, false);
    assert.deepEqual(Object.keys(f), [...L.ENCABEZADOS_DIARIO]);
  });
  test('editar recalcula, conserva conciliación y marca modificado', () => {
    const f = { ...L.procesarRegistro([mov(1)], [], TASAS, cfg, '2026-11-05T08:00:00').nuevas[0], estado_conciliacion: 'conciliado', conciliado_con: 'BAN-1' };
    const r = L.aplicarEdicion(f, { moneda: 'USD', monto: 2, id: 'otro', estado_conciliacion: 'x' }, TASAS, cfg, '2026-11-05T09:00:00');
    assert.equal(r.ok, true);
    assert.equal(r.fila.id, 'id-0000001');
    assert.equal(r.fila.monto_bs, -1782.21);
    assert.equal(r.fila.estado_conciliacion, 'conciliado');
    assert.equal(r.fila.modificado, '2026-11-05T09:00:00');
    assert.equal(r.fila.registrado, '2026-11-05T08:00:00');
    assert.equal(L.aplicarEdicion(f, { monto: 0 }, TASAS, cfg, 'x').ok, false);
  });
  test('rellenar provisionales cuando llega la tasa', () => {
    const f = L.procesarRegistro([mov(1, { fecha: '2026-11-05T10:00' })], [], TASAS, cfg, 'x').nuevas[0];
    assert.equal(f.tasa_provisional, true);
    assert.equal(f.tasa_bcv_usd, 893.2173);
    const nuevas = L.normalizarTasas([...TASAS, { fecha: '2026-11-05', usd: 894.8876 }]);
    const c = L.rellenarProvisionales([f, { ...f, tasa_provisional: false }], nuevas);
    assert.equal(c.length, 1);
    assert.equal(c[0].indice, 0);
    assert.equal(c[0].fila.tasa_provisional, false);
    assert.equal(c[0].fila.tasa_bcv_usd, 894.8876);
    assert.equal(L.rellenarProvisionales([c[0].fila], nuevas).length, 0);
  });
});

describe('config, sugerencias y uso', () => {
  test('config inicial', () => {
    const c = L.configInicialComoObjeto();
    assert.equal(c.categorias.length, 18);
    assert.deepEqual(plano(c.cuentas[0]), { nombre: 'Banesco Corriente', moneda: 'Bs', bancaria: true });
    assert.deepEqual(plano(c.cuentas[5]), { nombre: 'Binance', moneda: 'USDT', bancaria: false });
    assert.deepEqual(plano(c.monedas), ['Bs', 'USD', 'EUR', 'USDT']);
    assert.equal(c.medios.length, 7);
    assert.equal(c.ajustes.url_pwa, '');
  });
  test('sugerencias con valores habituales', () => {
    const f = (d, cat, cta, fecha, anulado = false) => ({ descripcion: d, categoria: cat, cuenta: cta, medio: 'Pago móvil', tipo: 'Gasto', fecha, anulado });
    const s = L.calcularSugerencias([
      f('Panadería', 'Alimentos', 'Banesco Corriente', '2026-11-01'),
      f('panaderia ', 'Alimentos', 'Mercantil Corriente', '2026-11-02'),
      f('Panadería', 'Alimentos', 'Mercantil Corriente', '2026-11-03'),
      f('Metro', 'Transporte', 'Efectivo Bs', '2026-11-03'),
      f('Cine', 'Ocio', 'Efectivo Bs', '2026-11-03', true)
    ]);
    assert.equal(s.length, 2);
    assert.equal(s[0].descripcion, 'Panadería');
    assert.equal(s[0].n, 3);
    assert.equal(s[0].cuenta, 'Mercantil Corriente');
    assert.equal(s[0].categoria, 'Alimentos');
  });
  test('uso por tipo', () => {
    const u = L.calcularUso([{ tipo: 'Gasto', categoria: 'Ocio', cuenta: 'A' }, { tipo: 'Gasto', categoria: 'Ocio', cuenta: 'B' }, { tipo: 'Ingreso', categoria: 'Salarios', cuenta: 'A', anulado: true }]);
    assert.equal(u.categorias.Gasto.Ocio, 2);
    assert.equal(u.categorias.Ingreso, undefined);
  });
});

describe('CSV', () => {
  test('genera encabezados exactos, ISO, punto decimal y comillas', () => {
    const fila = Object.fromEntries(L.ENCABEZADOS_DIARIO.map((h) => [h, '']));
    Object.assign(fila, { id: 'x1', fecha: '2026-11-04T10:00:00', descripcion: 'Pan, "dulce"', monto: 1234.56, monto_bs: -1234.56, anulado: false, tasa_provisional: true, registrado: '2026-11-04T10:00:05' });
    const csv = L.generarCsv([fila]);
    const [enc, linea] = csv.trim().split('\n');
    assert.equal(enc, 'id,fecha,tipo,categoria,cuenta,cuenta_destino,descripcion,monto,moneda,medio,referencia,tasa_bcv_usd,tasa_usada,monto_bs,monto_usd,tasa_provisional,registrado,modificado,dispositivo,anulado,estado_conciliacion,conciliado_con');
    assert.match(linea, /^x1,2026-11-04T10:00:00-04:00,,,,,"Pan, ""dulce""",1234\.56,,,,,,-1234\.56,,true,2026-11-04T10:00:05-04:00,,,false,,$/);
    assert.ok(!csv.startsWith('﻿'));
  });
  test('parsearCsv ida y vuelta, BOM, CRLF y ;', () => {
    assert.deepEqual(plano(L.parsearCsv('﻿a,b\r\n"x, ""y""",2\r\n\r\n')), [['a', 'b'], ['x, "y"', '2']]);
    assert.deepEqual(plano(L.parsearCsv('id;estado\n1;ok')), [['id', 'estado'], ['1', 'ok']]);
    assert.deepEqual(plano(L.parsearCsv('a\n"multi\nlinea"')), [['a'], ['multi\nlinea']]);
  });
  test('aplicarConciliacion', () => {
    const filas = [{ id: 'a', estado_conciliacion: '', conciliado_con: '' }, { id: 'b', estado_conciliacion: 'conciliado', conciliado_con: 'X' }];
    const r = L.aplicarConciliacion(L.parsearCsv('id,estado_conciliacion,conciliado_con\na,conciliado,BAN-123\nb,conciliado,X\nzz,conciliado,Y\n'), filas);
    assert.deepEqual(plano(r.cambios), [{ indice: 0, estado_conciliacion: 'conciliado', conciliado_con: 'BAN-123' }]);
    assert.deepEqual(plano(r.desconocidos), ['zz']);
    assert.match(L.aplicarConciliacion([['x', 'y']], filas).error, /faltan columnas/);
  });
});

describe('API (manejarPeticion)', () => {
  function almacenMemoria() {
    const filas = [];
    return {
      filas,
      token: () => TOKEN,
      leerFilas: () => filas,
      agregarFilas: (n) => filas.push(...n),
      actualizarFila: (i, f) => { filas[i] = f; },
      leerTasas: () => TASAS,
      leerConfig: () => L.configInicialComoObjeto()
    };
  }
  const ahora = new Date('2026-11-04T16:00:00Z');
  const pedir = (a, p) => plano(L.manejarPeticion(JSON.stringify({ token: TOKEN, ...p }), a, ahora));
  const mov = { id: 'uuid-0001-aaaa', fecha: '2026-11-04T11:00:00-04:00', tipo: 'Gasto', categoria: 'Alimentos', cuenta: 'Banesco Corriente', monto: 50, moneda: 'Bs', descripcion: 'Panadería' };

  test('token inválido → error sin detalles', () => {
    const a = almacenMemoria();
    for (const token of ['', 'x', TOKEN.slice(1) + 'X', undefined]) {
      assert.deepEqual(plano(L.manejarPeticion(JSON.stringify({ accion: 'config', token }), a, ahora)), { respuesta: { ok: false, error: 'no autorizado' }, cambio: false });
    }
    assert.equal(plano(L.manejarPeticion('no es json', a, ahora)).respuesta.error, 'solicitud inválida');
  });
  test('registrar dos veces el mismo lote no duplica', () => {
    const a = almacenMemoria();
    const r1 = pedir(a, { accion: 'registrar', movimientos: [mov] });
    assert.deepEqual(r1.respuesta.guardados, [mov.id]);
    assert.equal(r1.cambio, true);
    const r2 = pedir(a, { accion: 'registrar', movimientos: [mov] });
    assert.deepEqual(r2.respuesta.guardados, [mov.id]);
    assert.deepEqual(r2.respuesta.duplicados, [mov.id]);
    assert.equal(r2.cambio, false);
    assert.equal(a.filas.length, 1);
  });
  test('config, editar, anular, ultimos', () => {
    const a = almacenMemoria();
    pedir(a, { accion: 'registrar', movimientos: [mov, { ...mov, id: 'uuid-0002-bbbb', fecha: '2026-11-03T09:00' }] });
    const c = pedir(a, { accion: 'config' }).respuesta;
    assert.equal(c.ok, true);
    assert.deepEqual(c.tasa, { fecha: '2026-11-04', usd: 893.2173, eur: 999.76919171 });
    assert.equal(c.sugerencias[0].descripcion, 'Panadería');
    assert.equal(c.config.cuentas.length, 6);
    assert.equal(c.config.ajustes, undefined, 'no expone ajustes (contienen el enlace con token)');
    const e = pedir(a, { accion: 'editar', id: mov.id, cambios: { monto: 100 } });
    assert.equal(e.respuesta.fila.monto_bs, -100);
    assert.equal(pedir(a, { accion: 'editar', id: 'nada-0000', cambios: {} }).respuesta.error, 'no encontrado');
    const an = pedir(a, { accion: 'anular', id: mov.id });
    assert.equal(an.respuesta.fila.anulado, true);
    assert.equal(a.filas.length, 2, 'anular no borra');
    const u = pedir(a, { accion: 'ultimos', n: 10 }).respuesta;
    assert.deepEqual(u.filas.map((f) => f.id), [mov.id, 'uuid-0002-bbbb']);
    assert.equal(pedir(a, { accion: 'borrar' }).respuesta.error, 'acción desconocida');
  });
});
