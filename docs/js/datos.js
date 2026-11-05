// Datos por defecto y utilidades puras de la interfaz (probadas en Node).

// Igual a CONFIG_INICIAL de apps-script/Logica.gs (lo verifica tests/pwa.test.js).
// Se usa solo hasta recibir la configuración real de la hoja Config.
export const CONFIG_POR_DEFECTO = {
  categorias: [
    ['Alimentos', 'Gasto'], ['Transporte', 'Gasto'], ['Servicios', 'Gasto'],
    ['Bienestar', 'Gasto'], ['Ocio', 'Gasto'], ['Educación', 'Gasto'], ['Ropa', 'Gasto'],
    ['Regalos', ''], ['Herramientas', 'Gasto'], ['Retiros', ''], ['Comisiones', 'Gasto'],
    ['Impuestos', 'Gasto'], ['Préstamos', ''], ['Inversiones', ''],
    ['Entre Cuentas', 'Traspaso'], ['Salarios', 'Ingreso'], ['Aportes', 'Ingreso'],
    ['Depósitos', 'Ingreso']
  ].map(([nombre, tipo]) => ({ nombre, tipo })),
  cuentas: [
    ['Banesco Corriente', 'Bs', true], ['Mercantil Corriente', 'Bs', true],
    ['Mercantil Ahorros', 'Bs', true], ['Efectivo Bs', 'Bs', false],
    ['Efectivo $', 'USD', false], ['Binance', 'USDT', false]
  ].map(([nombre, moneda, bancaria]) => ({ nombre, moneda, bancaria })),
  medios: ['Punto de venta', 'Pago móvil', 'Transferencia', 'Efectivo', 'Cashea inicial', 'Cashea cuota', 'Otro'],
  monedas: ['Bs', 'USD', 'EUR', 'USDT']
};

export function claveTexto(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

/** Ordena por uso (desc) manteniendo el orden de la hoja como desempate. */
export function ordenarPorUso(nombres, uso = {}) {
  return nombres
    .map((n, i) => ({ n, i, u: uso[n] || 0 }))
    .sort((a, b) => b.u - a.u || a.i - b.i)
    .map((x) => x.n);
}

/** Categorías que aplican a un tipo (tipo vacío en la hoja = todas). */
export function filtrarCategorias(categorias, tipo) {
  return categorias.filter((c) => !c.tipo || c.tipo === tipo).map((c) => c.nombre);
}

/** Primero las que empiezan por el texto, luego las que lo contienen; por uso. */
export function buscarSugerencias(sugerencias, texto, limite = 6) {
  const q = claveTexto(texto);
  if (!q) return [];
  const puntuadas = [];
  for (const s of sugerencias) {
    const k = claveTexto(s.descripcion);
    if (k === q) { puntuadas.push({ s, p: 3 }); continue; }
    if (k.startsWith(q)) puntuadas.push({ s, p: 2 });
    else if (k.split(' ').some((w) => w.startsWith(q))) puntuadas.push({ s, p: 1 });
    else if (k.includes(q)) puntuadas.push({ s, p: 0 });
  }
  return puntuadas
    .sort((a, b) => b.p - a.p || (b.s.n || 0) - (a.s.n || 0) || String(b.s.ultimo || '').localeCompare(String(a.s.ultimo || '')))
    .slice(0, limite)
    .map((x) => x.s);
}
