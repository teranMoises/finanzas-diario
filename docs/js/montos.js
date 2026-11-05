// Montos en formato venezolano.
// Coma = decimal. Punto = decimal solo si le siguen 1 o 2 dígitos al final;
// si no, es separador de miles.

/** Texto → número positivo, o null si no es un monto válido. */
export function parsearMonto(texto) {
  if (typeof texto === 'number') return Number.isFinite(texto) && texto > 0 ? texto : null;
  if (typeof texto !== 'string') return null;
  let s = texto.replace(/[\s ]/g, '').replace(/^(bs\.?|\$|usd|eur|€|usdt)/i, '');
  if (!s) return null;
  if (!/^[\d.,]+$/.test(s)) return null;
  let entero, decimales = '';
  const comas = (s.match(/,/g) || []).length;
  if (comas > 1) return null;
  if (comas === 1) {
    [entero, decimales] = s.split(',');
    if (!/^[\d.]*$/.test(entero) || !/^\d*$/.test(decimales)) return null;
    entero = entero.replace(/\./g, '');
  } else {
    const m = /^(.*)\.(\d{1,2})$/.exec(s);
    if (m) { entero = m[1].replace(/\./g, ''); decimales = m[2]; } else entero = s.replace(/\./g, '');
  }
  if (!entero && !decimales) return null;
  if (!/^\d*$/.test(entero)) return null;
  const n = Number((entero || '0') + (decimales ? '.' + decimales : ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 1234.5 → "1.234,50" */
export function formatearMonto(n, decimales = 2) {
  if (n === null || n === undefined || n === '' || !Number.isFinite(Number(n))) return '';
  const v = Number(n);
  const negativo = v < 0;
  const [ent, dec] = Math.abs(v).toFixed(decimales).split('.');
  const miles = ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (negativo ? '-' : '') + miles + (dec ? ',' + dec : '');
}

const SIMBOLOS = { Bs: 'Bs', USD: '$', USDT: 'USDT', EUR: '€' };

export function conMoneda(n, moneda, decimales = 2) {
  const f = formatearMonto(n, decimales);
  if (!f) return '';
  const s = SIMBOLOS[moneda] || moneda || '';
  return moneda === 'USD' || moneda === 'EUR' ? `${s} ${f}` : `${f} ${s}`.trim();
}

/**
 * Equivalente aproximado para mostrar mientras se escribe.
 * tasa = {usd, eur} (Bs por unidad). USDT = 1 USD.
 */
export function equivalente(monto, moneda, tasa) {
  if (!monto || !tasa || !tasa.usd) return null;
  if (moneda === 'Bs') return { monto: monto / tasa.usd, moneda: 'USD' };
  if (moneda === 'USD' || moneda === 'USDT') return { monto: monto * tasa.usd, moneda: 'Bs' };
  if (moneda === 'EUR' && tasa.eur) return { monto: monto * tasa.eur, moneda: 'Bs' };
  return null;
}
