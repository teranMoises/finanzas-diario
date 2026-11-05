// Genera docs/icons/*.png a partir de tools/icono.svg usando el Chromium de Playwright.
// Uso: node tools/generar-iconos.js   (solo hace falta si cambias el ícono)
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const svg = readFileSync(fileURLToPath(new URL('./icono.svg', import.meta.url)), 'utf8');
const salida = (n) => fileURLToPath(new URL(`../docs/icons/${n}`, import.meta.url));

const navegador = await chromium.launch();
const pagina = await navegador.newPage({ deviceScaleFactor: 1 });
async function render(tam, archivo, escala) {
  await pagina.setViewportSize({ width: tam, height: tam });
  // "any": esquinas redondeadas. "maskable": fondo completo y dibujo dentro de la zona segura (80 %).
  const radio = escala === 1 ? Math.round(tam * 0.22) : 0;
  await pagina.setContent(`<html><body style="margin:0;background:transparent">
    <div style="width:${tam}px;height:${tam}px;border-radius:${radio}px;overflow:hidden;background:#0f766e;display:grid;place-items:center">
      <div style="width:${tam * escala}px;height:${tam * escala}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div>
    </div></body></html>`);
  await pagina.screenshot({ path: salida(archivo), omitBackground: true, clip: { x: 0, y: 0, width: tam, height: tam } });
}
await render(192, 'icon-192.png', 1);
await render(512, 'icon-512.png', 1);
await render(512, 'icon-maskable-512.png', 0.8);
await navegador.close();
console.log('Íconos generados en docs/icons/');
