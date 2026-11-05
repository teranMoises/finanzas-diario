# Instalar Finanzas Diario

Guía paso a paso para dejar funcionando la app en el teléfono, la hoja en Google Drive y el CSV en tu PC. No hace falta saber programar ni haber usado Apps Script antes. Calcula unos 30 minutos.

Al final tendrás:

- Una hoja **Finanzas – Diario** en `Mi unidad/Banco` que guarda todo.
- Un **Web App** (un programa pequeño que corre en Google, gratis) que recibe lo que anotas.
- La **app** instalada en tu Android, que funciona incluso sin internet.
- El archivo `Banco/Diario/diario.csv` sincronizado a tu PC para tus scripts.

---

## 1. Crear la hoja de cálculo

1. Abre [drive.google.com](https://drive.google.com) en la computadora.
2. En **Mi unidad**, entra a la carpeta **Banco**. Si no existe, créala: **Nuevo → Carpeta → `Banco`**.
3. Dentro de `Banco`: **Nuevo → Hojas de cálculo de Google → Hoja de cálculo en blanco**.
4. Arriba a la izquierda, donde dice "Hoja de cálculo sin título", escribe: `Finanzas – Diario`.

> No hace falta crear pestañas ni encabezados: lo hace `setup()` en el paso 3.

## 2. Pegar el código de Apps Script

1. En la hoja, menú **Extensiones → Apps Script**. Se abre el editor en otra pestaña.
2. Arriba a la izquierda, haz clic en "Proyecto sin título" y ponle `Finanzas Diario`.
3. **Mostrar el manifiesto:** en la barra de la izquierda, haz clic en el engranaje **⚙ Configuración del proyecto** y marca **"Mostrar el archivo de manifiesto «appsscript.json» en el editor"**. Vuelve al editor con el ícono **< >**.
4. Vas a tener tres archivos. Para cada uno, abre el archivo de este repositorio, selecciona todo y cópialo:

   | En el editor | Copiar desde el repo |
   |---|---|
   | `Código.gs` (ya existe; puedes renombrarlo a `Codigo` con los ⋮ junto al nombre) | `apps-script/Codigo.gs` |
   | Nuevo: botón **+** → **Secuencia de comandos** → nombre `Logica` | `apps-script/Logica.gs` |
   | `appsscript.json` (aparece al marcar la casilla del paso 3) | `apps-script/appsscript.json` |

   En cada archivo, borra todo lo que trae y pega el contenido completo.
5. Guarda con **Ctrl + S** (o el ícono del disquete).

> Para copiar desde GitHub: abre el archivo, botón **"Copy raw file"** (dos cuadritos) arriba a la derecha.

## 3. Correr `setup()` y aceptar permisos

1. En el editor, abre `Codigo.gs`. En la barra de arriba, en el desplegable de funciones, elige **`setup`**.
2. Haz clic en **▷ Ejecutar**.
3. Aparece "Se requiere autorización" → **Revisar permisos** → elige tu cuenta de Google.
4. Verás la pantalla **"Google no ha verificado esta app"**. Es normal: la app es tuya y nadie más la usa. Haz clic en **Configuración avanzada** (abajo a la izquierda) y luego en **"Ir a Finanzas Diario (no seguro)"**.
5. Revisa la lista de permisos y pulsa **Permitir**. Se piden porque el script:
   - lee y escribe la hoja (anotaciones, Config, tasas);
   - usa Google Drive (para crear `Banco/Diario` y escribir `diario.csv`);
   - se conecta a internet (para traer la tasa del BCV);
   - crea disparadores diarios y muestra el menú "Finanzas".
6. Espera a que en el "Registro de ejecución" diga **"Ejecución completada"** (puede tardar unos 30 segundos porque trae ~1 año de tasas).

Vuelve a la pestaña de la hoja y recárgala (F5). Ahora tendrás:

- Las pestañas **Diario**, **Config**, **TasasBCV** y **Log**.
- Un menú nuevo **Finanzas** junto a "Ayuda".
- La carpeta `Mi unidad/Banco/Diario` con `diario.csv`.

> `setup()` se puede correr las veces que quieras: solo crea lo que falta y no borra ni cambia lo que ya editaste. También está en el menú **Finanzas → Configurar todo (setup)**.

## 4. Implementar el Web App

1. En el editor de Apps Script, botón azul **Implementar → Nueva implementación**.
2. Junto a "Seleccionar tipo", haz clic en el engranaje ⚙ y elige **Aplicación web**.
3. Llena así:
   - **Descripción:** `v1`
   - **Ejecutar como:** **Yo** (tu correo)
   - **Quién tiene acceso:** **Cualquier usuario** (en inglés: *Anyone*; no "Cualquier usuario con cuenta de Google")
4. **Implementar**. Si vuelve a pedir permisos, repite lo del paso 3.
5. Copia la **URL de la aplicación web**. Termina en `/exec`.

> ¿"Cualquier usuario" es seguro? Sí: sin el token secreto, el Web App solo responde "no autorizado". El token tiene 64 caracteres aleatorios y está guardado en las propiedades del script, no en el código.

## 5. Publicar la app en GitHub Pages

1. Asegúrate de que el contenido de este repositorio esté en la rama **`main`** (si trabajas en otra rama, haz el *merge* a `main`).
2. En GitHub, en el repositorio: **Settings → Pages**.
3. En **Build and deployment**:
   - **Source:** `Deploy from a branch`
   - **Branch:** `main` y carpeta **`/docs`** → **Save**.
4. Espera 1–2 minutos y recarga la página de Settings → Pages. Aparecerá la dirección, del tipo `https://<tu-usuario>.github.io/finanzas-diario/`.
5. Ábrela en la computadora para comprobar que carga (dirá que el teléfono no está conectado; es normal).

## 6. Generar el enlace del teléfono

1. En la hoja, pestaña **Config**, tabla de la derecha (`clave` / `valor`):
   - **url_webapp:** pega la URL `/exec` del paso 4 (si `setup()` ya la puso, compruébala).
   - **url_pwa:** pega la dirección de GitHub Pages del paso 5.
2. Menú **Finanzas → Generar enlace del teléfono**. El enlace queda en **enlace_telefono** y también se muestra en una ventana.

> El enlace contiene el token. No lo publiques ni compartas la hoja. Si se filtra, usa **Finanzas → Regenerar token** y abre el enlace nuevo en tus teléfonos.

## 7. Abrir el enlace en el teléfono e instalar la app

1. Haz llegar el enlace al teléfono por una vía privada. Lo más simple es abrir la hoja en la app **Hojas de cálculo de Google** del teléfono, ir a **Config** y tocar el enlace (o copiarlo y pegarlo en Chrome).
2. Se abre en **Chrome**, muestra "Teléfono conectado ✓" y el enlace desaparece de la barra de direcciones (la URL y el token quedan guardados solo en ese teléfono).
3. Menú **⋮** de Chrome → **Instalar app** (o **Agregar a la pantalla principal**).
4. Abre la app desde el ícono. Arriba debería verse la tasa BCV. Ve a **Ajustes → Probar conexión** para confirmarlo.

**Prueba rápida:** anota un gasto de prueba, ve a **Últimos** y confirma que aparece sin la etiqueta "pendiente"; en la hoja, pestaña **Diario**, verás la fila. Luego puedes anularlo desde la app.

## 8. Llevar el CSV a tu PC

1. Instala [Google Drive para escritorio](https://www.google.com/drive/download/) si no lo tienes.
2. En sus preferencias, asegúrate de que la carpeta `Mi unidad/Banco/Diario` esté disponible en tu disco. Si usas el modo "Transmitir archivos", haz clic derecho en la carpeta **Diario** → **Disponible sin conexión**, para que tus scripts siempre lean la última versión.
3. Tus scripts leen `…/Mi unidad/Banco/Diario/diario.csv`. El formato está en [CLAUDE.md](CLAUDE.md#contrato-diariocsv).
4. Para marcar lo conciliado, tus scripts escriben `conciliacion_estado.csv` en esa misma carpeta. La hoja lo importa todos los días hacia las 6:00 a. m., o al instante con **Finanzas → Importar estado de conciliación**.

---

## Tareas de mantenimiento

### Publicar una versión nueva del Web App (sin cambiar la URL)

Cuando cambies `Codigo.gs` o `Logica.gs`:

1. Pega el código nuevo en el editor y guarda.
2. **Implementar → Gestionar implementaciones**.
3. Selecciona la implementación activa y haz clic en el **lápiz ✏ (Editar)**.
4. En **Versión**, elige **Nueva versión** y pon una descripción (por ejemplo `v2`).
5. **Implementar**. La URL `/exec` sigue siendo la misma: no hay que tocar los teléfonos.

> No uses "Nueva implementación" para actualizar: eso crea **otra** URL.
> Si el cambio agrega permisos nuevos, corre `setup()` una vez desde el editor para aceptarlos.

### Publicar una versión nueva de la app del teléfono

1. Sube el número de versión en **dos** lugares (deben coincidir; las pruebas lo verifican): `docs/js/version.js` y `docs/sw.js` (`const VERSION`).
2. Haz *push* a `main`. GitHub Pages publica en 1–2 minutos.
3. En el teléfono, al abrir la app aparecerá **"Hay una versión nueva · Actualizar"** (o usa **Ajustes → Buscar actualización**).

### Agregar o cambiar categorías, cuentas, medios o monedas

Edita las tablas de la pestaña **Config**. En la tabla de categorías, la columna `tipo` limita dónde aparece (`Gasto`, `Ingreso`, `Traspaso`; vacío = en todos). La app toma los cambios la próxima vez que se conecta (o con **Ajustes → Sincronizar ahora**). No hace falta tocar el código.

> Nuevas monedas: la app las acepta, pero solo Bs, USD, EUR y USDT se convierten; con otras, `monto_bs`/`monto_usd` quedan vacíos.

### Si algo falla

| Síntoma | Qué hacer |
|---|---|
| La app dice "El servidor rechazó el token" | Se regeneró el token. Abre el `enlace_telefono` actual de Config en el teléfono. |
| "No se pudo conectar" al probar | Revisa que la URL termine en `/exec` y que el acceso sea **Cualquier usuario**. |
| Las tasas no se actualizan | Mira la pestaña **Log**. Usa **Finanzas → Actualizar tasas**. Si la fuente está caída, las filas quedan con `tasa_provisional` y se rellenan cuando vuelva. |
| `diario.csv` no cambia en la PC | Comprueba que Drive para escritorio esté corriendo y que la carpeta esté disponible sin conexión. Prueba **Finanzas → Exportar CSV ahora**. |
| Quiero ver los disparadores | En el editor de Apps Script, ícono del reloj ⏰ **Activadores**. Deben ser 3: `tareaDiariaTasas`, `tareaDiariaConciliacion` y `alEditarHoja`. Si falta alguno, corre `setup()`. |
