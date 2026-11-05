// Carga apps-script/Logica.gs en un contexto aislado de Node, igual que
// Apps Script: un script "global" que exporta solo si existe `module`.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const RUTA = fileURLToPath(new URL('../apps-script/Logica.gs', import.meta.url));

export function cargarLogica() {
  const codigo = readFileSync(RUTA, 'utf8');
  const sandbox = { module: { exports: {} }, console };
  vm.createContext(sandbox);
  vm.runInContext(codigo, sandbox, { filename: 'Logica.gs' });
  return sandbox.module.exports;
}
