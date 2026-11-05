// Prueba de punta a punta: PWA real en Chromium (Playwright) contra tools/mock-server.js.
// Si Playwright no está instalado, la prueba se salta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { crearServidor, enlaceCfg } from '../tools/mock-server.js';

const require = createRequire(import.meta.url);
let playwright = null;
try { playwright = require('playwright'); } catch { /* no disponible */ }

const SALIDA = fileURLToPath(new URL('../tools/salida/', import.meta.url));

test('anotar sin red, volver la red y sincronizar sin duplicar', { skip: !playwright && 'Playwright no está instalado', timeout: 120_000 }, async () => {
  mkdirSync(SALIDA, { recursive: true });
  const { servidor, token } = crearServidor({ silencioso: true, salida: SALIDA });
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  const base = `http://localhost:${servidor.address().port}`;
  const estado = async () => (await fetch(base + '/__estado')).json();

  const navegador = await playwright.chromium.launch();
  const contexto = await navegador.newContext({ ...playwright.devices['Pixel 7'], locale: 'es-VE', serviceWorkers: 'allow' });
  const pagina = await contexto.newPage();
  const errores = [];
  pagina.on('pageerror', (e) => errores.push(e.message));
  pagina.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
  pagina.on('dialog', (d) => d.accept());

  const pendientes = () => pagina.locator('#pendientes');
  const chip = (grupo, texto) => pagina.locator(`#${grupo} .chip`, { hasText: texto }).first();
  const anotar = async ({ monto, desc, categoria, cuenta }) => {
    await pagina.fill('#monto', monto);
    if (desc) { await pagina.fill('#descripcion', desc); await pagina.keyboard.press('Escape'); }
    if (cuenta) await chip('chipsCuenta', cuenta).click();
    if (categoria) await chip('chipsCategoria', categoria).click();
    await pagina.click('#guardar');
  };

  try {
    // 1. Configurar con el enlace #cfg: se guarda y se limpia el hash.
    await pagina.goto(enlaceCfg(base, token));
    await pagina.waitForFunction(() => location.hash === '');
    await pagina.evaluate(() => navigator.serviceWorker.ready);
    await pagina.reload(); // ahora el service worker controla la página
    await pagina.waitForFunction(() => !!navigator.serviceWorker.controller);
    await assert.doesNotReject(pagina.locator('#tasa', { hasText: 'BCV' }).waitFor());
    assert.equal(await pagina.evaluate(() => document.activeElement.id), 'monto', 'el foco empieza en el monto');
    assert.equal(await pagina.getAttribute('#monto', 'inputmode'), 'decimal');
    await pagina.screenshot({ path: SALIDA + 'anotar.png' });

    // 2. Sin red: dos anotaciones quedan en la cola.
    await contexto.setOffline(true);
    await pagina.fill('#monto', '1.234,56');
    assert.match(await pagina.textContent('#equivalente'), /≈ \$ \d/);
    await anotar({ monto: '1.234,56', desc: 'Panadería', cuenta: 'Mercantil Corriente', categoria: 'Alimentos' });
    await pendientes().filter({ hasText: '1 pendiente' }).waitFor();
    assert.equal(await pagina.inputValue('#monto'), '', 'formulario limpio');
    assert.equal(await pagina.evaluate(() => document.activeElement.id), 'monto');
    await anotar({ monto: '20', desc: 'Taxi', cuenta: 'Efectivo $', categoria: 'Transporte' });
    await pendientes().filter({ hasText: '2 pendientes' }).waitFor();
    assert.equal((await estado()).filas.length, 0);

    // 3. Recargar sin red: la app abre desde la caché y la cola sigue ahí.
    await pagina.reload();
    await pendientes().filter({ hasText: '2 pendientes' }).waitFor();
    await pagina.screenshot({ path: SALIDA + 'pendientes.png' });

    // 4. Vuelve la red: se envía sola.
    await contexto.setOffline(false);
    await pendientes().waitFor({ state: 'hidden' });
    let filas = (await estado()).filas;
    assert.equal(filas.length, 2);
    assert.equal(new Set(filas.map((f) => f.id)).size, 2);
    const pan = filas.find((f) => f.descripcion === 'Panadería');
    assert.equal(pan.monto, 1234.56);
    assert.equal(pan.monto_bs, -1234.56);
    assert.equal(pan.cuenta, 'Mercantil Corriente');
    const taxi = filas.find((f) => f.descripcion === 'Taxi');
    assert.equal(taxi.moneda, 'USD');
    assert.equal(taxi.monto_usd, -20);

    // 5. El servidor guarda pero la respuesta se pierde: el reintento no duplica.
    await fetch(base + '/__fallar', { method: 'POST', body: JSON.stringify({ n: 1, modo: 'despues' }) });
    await anotar({ monto: '5', desc: 'Chicle', categoria: 'Alimentos' });
    await pagina.waitForFunction(() => window.__fd && true);
    await pagina.waitForTimeout(500);
    assert.equal((await estado()).filas.length, 3, 'el servidor ya lo guardó');
    await pagina.evaluate(() => window.__fd.sincronizarAhora());
    await pendientes().waitFor({ state: 'hidden' });
    await pagina.evaluate(() => window.__fd.sincronizarAhora());
    filas = (await estado()).filas;
    assert.equal(filas.length, 3, 'sin duplicados');

    // 6. Autocompletado: "pan" propone Panadería con su categoría y cuenta.
    await pagina.evaluate(() => window.__fd.sincronizarAhora({ forzarConfig: true }));
    await pagina.fill('#descripcion', '');
    await pagina.type('#descripcion', 'pan');
    await pagina.locator('#sugerencias li', { hasText: 'Panadería' }).first().dispatchEvent('pointerdown');
    assert.equal(await chip('chipsCategoria', 'Alimentos').getAttribute('aria-checked'), 'true');
    assert.equal(await chip('chipsCuenta', 'Mercantil Corriente').getAttribute('aria-checked'), 'true');
    await pagina.fill('#descripcion', '');

    // 7. Últimos: editar y anular.
    await pagina.click('nav [data-ir="ultimos"]');
    await pagina.locator('#lista li', { hasText: 'Panadería' }).waitFor();
    await pagina.screenshot({ path: SALIDA + 'ultimos.png' });
    await pagina.locator('#lista li', { hasText: 'Panadería' }).click();
    await pagina.fill('#edMonto', '1.500');
    await pagina.click('#edGuardar');
    await pagina.waitForFunction(async () => (await window.__fd.cola.contar()) === 0);
    await pagina.waitForTimeout(300);
    filas = (await estado()).filas;
    assert.equal(filas.find((f) => f.descripcion === 'Panadería').monto, 1500);
    await pagina.locator('#lista li', { hasText: 'Taxi' }).click();
    await pagina.click('#edAnular');
    await pagina.locator('#lista li.anulado', { hasText: 'Taxi' }).waitFor();
    await pagina.waitForFunction(async () => (await window.__fd.cola.contar()) === 0);
    await pagina.waitForTimeout(300);
    filas = (await estado()).filas;
    assert.equal(filas.length, 3, 'anular no borra');
    assert.equal(filas.find((f) => f.descripcion === 'Taxi').anulado, true);

    // 8. Ajustes: probar conexión.
    await pagina.click('nav [data-ir="ajustes"]');
    await pagina.click('#btnProbar');
    await pagina.locator('#resultadoAjustes', { hasText: 'Conexión correcta' }).waitFor();
    await pagina.screenshot({ path: SALIDA + 'ajustes.png' });

    // Errores esperables en consola: solo los de red simulada.
    const inesperados = errores.filter((e) => !/Failed to load resource|ERR_INTERNET_DISCONNECTED|500/.test(e));
    assert.deepEqual(inesperados, []);
  } finally {
    await navegador.close();
    servidor.close();
  }
});
