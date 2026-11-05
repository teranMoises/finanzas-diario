#!/usr/bin/env node
// Servidor simulado del Web App de Apps Script, sin dependencias.
// Usa la MISMA lógica (apps-script/Logica.gs) que el backend real y además
// sirve la PWA de /docs, para probarla en el navegador.
//
//   node tools/mock-server.js [--puerto 8787] [--token TOKEN] [--latencia 300]
//
// Rutas:
//   GET  /                 la PWA (carpeta docs/)
//   POST /exec             API (igual que el Web App: JSON en texto plano)
//   GET  /exec             como doGet()
//   GET  /__estado         filas guardadas (para pruebas)
//   POST /__fallar         {"n":2, "modo":"antes"|"despues"} → las próximas n llamadas fallan
//                          "despues" = guarda pero responde 500 (simula respuesta perdida)
//   POST /__reset          vacía el Diario
// El CSV exportado queda en tools/salida/diario.csv.

import http from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const DOCS = path.join(RAIZ, 'docs');

export function cargarLogica() {
  const codigo = readFileSync(path.join(RAIZ, 'apps-script', 'Logica.gs'), 'utf8');
  const sandbox = { module: { exports: {} }, console };
  vm.createContext(sandbox);
  vm.runInContext(codigo, sandbox, { filename: 'Logica.gs' });
  return sandbox.module.exports;
}

const TIPOS_MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

/** Tasas de ejemplo: los últimos 40 días (fines de semana con la del viernes). */
function tasasDeEjemplo(L, hoy) {
  const r = [];
  let usd = 880, eur = 985, viernes = null;
  for (let d = L.sumarDias(hoy, -40); d <= hoy; d = L.sumarDias(d, 1)) {
    const dow = new Date(d + 'T12:00:00Z').getUTCDay();
    if (dow === 0 || dow === 6) { if (viernes) r.push({ ...viernes, fecha: d }); continue; }
    usd = Math.round((usd + 0.6) * 10000) / 10000;
    eur = Math.round((eur + 0.7) * 10000) / 10000;
    viernes = { fecha: d, usd, eur };
    r.push(viernes);
  }
  return r;
}

export function crearServidor({ token = 'token-de-prueba-0123456789', latencia = 0, salida = path.join(RAIZ, 'tools', 'salida'), silencioso = false } = {}) {
  const L = cargarLogica();
  const filas = [];
  const tasas = tasasDeEjemplo(L, L.hoyCaracas(new Date()));
  const config = L.configInicialComoObjeto();
  let fallos = { n: 0, modo: 'antes' };
  let llamadas = 0;

  const almacen = {
    token: () => token,
    leerFilas: () => filas,
    agregarFilas: (n) => { filas.push(...n); },
    actualizarFila: (i, f) => { filas[i] = f; },
    leerTasas: () => tasas,
    leerConfig: () => config
  };

  function exportar() {
    try {
      mkdirSync(salida, { recursive: true });
      writeFileSync(path.join(salida, 'diario.csv'), L.generarCsv(filas));
    } catch (e) {
      if (!silencioso) console.error('No se pudo escribir el CSV:', e.message);
    }
  }

  const cors = { 'Access-Control-Allow-Origin': '*' };
  const enviarJson = (res, codigo, obj) => {
    res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors });
    res.end(JSON.stringify(obj));
  };
  const leerCuerpo = (req) => new Promise((ok) => {
    let b = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { b += c; });
    req.on('end', () => ok(b));
  });
  const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

  const servidor = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors, 'Access-Control-Allow-Headers': 'Content-Type' }); res.end(); return; }
      if (url.pathname === '/exec' && req.method === 'GET') return enviarJson(res, 200, { ok: true, app: 'finanzas-diario', version: L.VERSION_BACKEND, mensaje: 'Usa POST.' });
      if (url.pathname === '/exec' && req.method === 'POST') {
        const cuerpo = await leerCuerpo(req);
        llamadas++;
        if (latencia) await esperar(latencia);
        if (fallos.n > 0 && fallos.modo === 'antes') { fallos.n--; return enviarJson(res, 500, { error: 'falla simulada' }); }
        const r = L.manejarPeticion(cuerpo, almacen, new Date());
        if (r.cambio) exportar();
        if (fallos.n > 0 && fallos.modo === 'despues') { fallos.n--; return enviarJson(res, 500, { error: 'respuesta perdida (simulada)' }); }
        if (!silencioso) {
          let accion = '?';
          try { accion = JSON.parse(cuerpo).accion; } catch { /* nada */ }
          console.log(`[api] ${accion} → ${r.respuesta.ok ? 'ok' : r.respuesta.error}`);
        }
        return enviarJson(res, 200, r.respuesta);
      }
      if (url.pathname === '/__estado') return enviarJson(res, 200, { filas, llamadas });
      if (url.pathname === '/__fallar' && req.method === 'POST') {
        const p = JSON.parse((await leerCuerpo(req)) || '{}');
        fallos = { n: Number(p.n) || 0, modo: p.modo === 'despues' ? 'despues' : 'antes' };
        return enviarJson(res, 200, { ok: true, fallos });
      }
      if (url.pathname === '/__reset' && req.method === 'POST') { filas.length = 0; exportar(); return enviarJson(res, 200, { ok: true }); }

      // Archivos estáticos de docs/
      let ruta = decodeURIComponent(url.pathname);
      if (ruta.endsWith('/')) ruta += 'index.html';
      const archivo = path.normalize(path.join(DOCS, ruta));
      if (!archivo.startsWith(DOCS) || !existsSync(archivo) || !statSync(archivo).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('No encontrado');
        return;
      }
      res.writeHead(200, { 'Content-Type': TIPOS_MIME[path.extname(archivo)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(readFileSync(archivo));
    } catch (e) {
      enviarJson(res, 500, { ok: false, error: 'error interno', detalle: e.message });
    }
  });

  return { servidor, filas, token, logica: L };
}

export function enlaceCfg(base, token) {
  const json = JSON.stringify({ url: base + '/exec', token });
  return base + '/#cfg=' + Buffer.from(json, 'utf8').toString('base64url');
}

// Ejecución directa
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
  const puerto = Number(arg('puerto', 8787));
  const { servidor, token } = crearServidor({ token: arg('token', undefined), latencia: Number(arg('latencia', 0)) });
  servidor.listen(puerto, () => {
    const base = `http://localhost:${puerto}`;
    console.log(`Servidor simulado en ${base}`);
    console.log(`API:   POST ${base}/exec   (token: ${token})`);
    console.log(`Abre este enlace para configurar la PWA automáticamente:\n  ${enlaceCfg(base, token)}`);
  });
}
