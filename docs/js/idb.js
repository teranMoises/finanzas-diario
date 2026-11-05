// Almacén de la cola en IndexedDB (sobrevive a cerrar la app y a reinicios).
const BD = 'finanzas-diario';
const TIENDA = 'cola';

function abrir() {
  return new Promise((ok, mal) => {
    const req = indexedDB.open(BD, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(TIENDA, { keyPath: 'qid' });
    req.onsuccess = () => ok(req.result);
    req.onerror = () => mal(req.error);
  });
}

export function almacenIndexedDB() {
  let bd = null;
  const conBd = async () => (bd ||= await abrir());
  const tx = async (modo, fn) => {
    const db = await conBd();
    return new Promise((ok, mal) => {
      const t = db.transaction(TIENDA, modo);
      const tienda = t.objectStore(TIENDA);
      let resultado;
      const req = fn(tienda);
      if (req) req.onsuccess = () => { resultado = req.result; };
      t.oncomplete = () => ok(resultado);
      t.onerror = () => mal(t.error);
      t.onabort = () => mal(t.error);
    });
  };
  return {
    todos: () => tx('readonly', (s) => s.getAll()),
    obtener: (qid) => tx('readonly', (s) => s.get(qid)),
    poner: (item) => tx('readwrite', (s) => s.put(item)),
    quitar: (qid) => tx('readwrite', (s) => s.delete(qid))
  };
}
