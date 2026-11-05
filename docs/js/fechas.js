// Fechas en hora de Caracas (UTC-4 todo el año).
const OFFSET_MS = -4 * 3600 * 1000;

const dos = (n) => String(n).padStart(2, '0');

/** Date → "AAAA-MM-DDTHH:mm" en hora de Caracas (valor para <input type="datetime-local">). */
export function aLocalCaracas(fecha = new Date()) {
  return new Date(fecha.getTime() + OFFSET_MS).toISOString().slice(0, 16);
}

/** "AAAA-MM-DDTHH:mm" (Caracas) → "AAAA-MM-DDTHH:mm:00-04:00", o null. */
export function desdeLocalCaracas(valor) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(valor || '');
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}-04:00`;
}

/** Ahora, con zona: "AAAA-MM-DDTHH:mm:ss-04:00". */
export function ahoraIso(fecha = new Date()) {
  return new Date(fecha.getTime() + OFFSET_MS).toISOString().slice(0, 19) + '-04:00';
}

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

/** Cualquier ISO → "jue 05/11 14:30" (hora de Caracas). */
export function fechaCorta(iso) {
  const d = aDate(iso);
  if (!d) return '';
  const c = new Date(d.getTime() + OFFSET_MS);
  return `${DIAS[c.getUTCDay()]} ${dos(c.getUTCDate())}/${dos(c.getUTCMonth() + 1)} ${dos(c.getUTCHours())}:${dos(c.getUTCMinutes())}`;
}

/** ISO con o sin zona (sin zona = Caracas) → Date, o null. */
export function aDate(iso) {
  if (!iso) return null;
  let s = String(iso);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) s += '-04:00';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "AAAA-MM-DD" → "05/11/2026" */
export function diaCorto(dia) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dia || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}
