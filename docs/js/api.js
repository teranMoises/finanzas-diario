// Llamadas al Web App: POST con JSON como text/plain (evita el preflight CORS).
import { ErrorAuth, ErrorRed } from './cola.js';

export function crearApi(obtenerAjustes, { tiempoMs = 25000 } = {}) {
  return async function llamar(accion, datos = {}) {
    const { url, token } = obtenerAjustes();
    if (!url || !token) throw new ErrorAuth('sin configurar');
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new ErrorRed('sin conexión');
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), tiempoMs);
    let resp;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...datos, accion, token }),
        redirect: 'follow',
        cache: 'no-store',
        signal: control.signal
      });
    } catch (e) {
      throw new ErrorRed(e.name === 'AbortError' ? 'tiempo agotado' : 'sin conexión');
    } finally {
      clearTimeout(reloj);
    }
    if (!resp.ok) throw new ErrorRed('HTTP ' + resp.status);
    let json;
    try { json = await resp.json(); } catch { throw new ErrorRed('respuesta no es JSON'); }
    if (json && json.ok === false && json.error === 'no autorizado') throw new ErrorAuth('no autorizado');
    if (json && json.ok === false && json.error === 'ocupado, reintenta') throw new ErrorRed('ocupado');
    return json;
  };
}

/** "#cfg=<base64url de {url, token}>" → {url, token} o null. */
export function leerCfgDeHash(hash) {
  const m = /[#&]cfg=([A-Za-z0-9_-]+={0,2})/.exec(hash || '');
  if (!m) return null;
  try {
    let b64 = m[1].replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
    while (b64.length % 4) b64 += '=';
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const obj = JSON.parse(new TextDecoder().decode(bytes));
    if (!obj || typeof obj.url !== 'string' || typeof obj.token !== 'string') return null;
    if (!urlPermitida(obj.url) || obj.token.length < 16) return null;
    return { url: obj.url.trim(), token: obj.token.trim() };
  } catch {
    return null;
  }
}

/** Solo https (o http a localhost para el servidor de pruebas). */
export function urlPermitida(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

export function crearCfgHash({ url, token }) {
  const bytes = new TextEncoder().encode(JSON.stringify({ url, token }));
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return '#cfg=' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
