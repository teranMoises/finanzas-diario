// Cola de envíos pendientes. El almacenamiento se inyecta (IndexedDB en el
// navegador, memoria en las pruebas) con esta interfaz asíncrona:
//   todos() → item[]   obtener(qid) → item|undefined   poner(item)   quitar(qid)
//
// item = { qid, op: 'registrar'|'editar'|'anular', datos, creado, ver, error }
//   registrar: qid = id del movimiento, datos = movimiento
//   editar:    qid = 'ed:' + id,         datos = { id, cambios }
//   anular:    qid = 'an:' + id,         datos = { id }

export class ErrorRed extends Error {}
export class ErrorAuth extends Error {}

const TAM_LOTE = 50;

export function crearCola(almacen, { ahora = () => Date.now() } = {}) {
  const ordenados = async () => (await almacen.todos()).sort((a, b) => a.creado - b.creado || (a.qid < b.qid ? -1 : 1));

  return {
    almacen,
    todos: ordenados,
    async contar() { return (await almacen.todos()).length; },

    /** Agrega un movimiento nuevo. */
    async registrar(mov) {
      await almacen.poner({ qid: mov.id, op: 'registrar', datos: { ...mov }, creado: ahora(), ver: 1, error: null });
    },

    /** Edita un movimiento: si aún está en la cola se cambia ahí; si no, se encola un "editar". */
    async editar(id, cambios) {
      const pendiente = await almacen.obtener(id);
      if (pendiente && pendiente.op === 'registrar') {
        await almacen.poner({ ...pendiente, datos: { ...pendiente.datos, ...cambios }, ver: pendiente.ver + 1, error: null });
        return 'local';
      }
      const qid = 'ed:' + id;
      const previo = await almacen.obtener(qid);
      const acumulado = { ...(previo ? previo.datos.cambios : {}), ...cambios };
      await almacen.poner({ qid, op: 'editar', datos: { id, cambios: acumulado }, creado: previo ? previo.creado : ahora(), ver: (previo ? previo.ver : 0) + 1, error: null });
      return 'servidor';
    },

    /** Anula: nunca se borra; si está en la cola, se envía ya anulado. */
    async anular(id) {
      const pendiente = await almacen.obtener(id);
      if (pendiente && pendiente.op === 'registrar') {
        await almacen.poner({ ...pendiente, datos: { ...pendiente.datos, anulado: true }, ver: pendiente.ver + 1, error: null });
        return 'local';
      }
      await almacen.poner({ qid: 'an:' + id, op: 'anular', datos: { id }, creado: ahora(), ver: 1, error: null });
      return 'servidor';
    }
  };
}

const CAMPOS_EDITABLES = ['fecha', 'tipo', 'categoria', 'cuenta', 'cuenta_destino', 'descripcion', 'monto', 'moneda', 'medio', 'referencia'];

/**
 * Envía la cola. `llamar(accion, datos)` devuelve la respuesta JSON del
 * servidor o lanza ErrorRed / ErrorAuth. Nunca pierde un elemento: solo se
 * quita de la cola lo que el servidor confirmó.
 * → { enviados, rechazados, pendientes, error }  (error: null | 'red' | 'auth')
 */
export async function sincronizar(cola, llamar) {
  const almacen = cola.almacen;
  const res = { enviados: 0, rechazados: 0, pendientes: 0, error: null };
  try {
    const items = (await cola.todos()).filter((i) => !i.error);
    const registros = items.filter((i) => i.op === 'registrar');
    for (let k = 0; k < registros.length; k += TAM_LOTE) {
      const lote = registros.slice(k, k + TAM_LOTE);
      const r = await llamar('registrar', { movimientos: lote.map((i) => i.datos) });
      if (!r || !r.ok) throw new ErrorRed((r && r.error) || 'respuesta inválida');
      const guardados = new Set(r.guardados || []);
      const rechazos = new Map((r.rechazados || []).map((x) => [x.id, x.error]));
      for (const enviado of lote) {
        const actual = await almacen.obtener(enviado.qid);
        if (!actual) continue;
        if (guardados.has(enviado.qid)) {
          res.enviados++;
          await almacen.quitar(enviado.qid);
          if (actual.ver !== enviado.ver) {
            // Se editó mientras viajaba: lo que cambió se manda como edición.
            const cambios = {};
            for (const c of CAMPOS_EDITABLES) if (actual.datos[c] !== enviado.datos[c]) cambios[c] = actual.datos[c];
            if (Object.keys(cambios).length) await cola.editar(enviado.qid, cambios);
            if (actual.datos.anulado && !enviado.datos.anulado) await cola.anular(enviado.qid);
          }
        } else if (rechazos.has(enviado.qid)) {
          res.rechazados++;
          if (actual.ver === enviado.ver) await almacen.poner({ ...actual, error: rechazos.get(enviado.qid) });
        }
      }
    }
    const otros = (await cola.todos()).filter((i) => !i.error && i.op !== 'registrar');
    for (const item of otros) {
      const datos = item.op === 'editar' ? { id: item.datos.id, cambios: item.datos.cambios } : { id: item.datos.id };
      const r = await llamar(item.op, datos);
      const actual = await almacen.obtener(item.qid);
      if (r && r.ok) {
        res.enviados++;
        if (actual && actual.ver === item.ver) await almacen.quitar(item.qid);
      } else if (r && r.error && actual) {
        res.rechazados++;
        await almacen.poner({ ...actual, error: r.error });
      }
    }
  } catch (e) {
    if (e instanceof ErrorAuth) res.error = 'auth';
    else res.error = 'red';
  }
  res.pendientes = await cola.contar();
  return res;
}

/** Almacén en memoria (pruebas y respaldo si IndexedDB no está disponible). */
export function almacenMemoria() {
  const m = new Map();
  const copia = (x) => (x ? structuredClone(x) : x);
  return {
    async todos() { return [...m.values()].map(copia); },
    async obtener(qid) { return copia(m.get(qid)); },
    async poner(item) { m.set(item.qid, copia(item)); },
    async quitar(qid) { m.delete(qid); }
  };
}
