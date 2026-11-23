# Cuaderno — contexto del proyecto (para Claude)

App web instalable (PWA) que imita una tableta de tinta electrónica tipo VIWOODS AiPaper Mini / iFLYTEK AINOTE 2, para usar en una **Samsung Galaxy Tab S6 Lite con S Pen**. Todo en español. Diseño propio en grises tipo papel (no copia marcas ni diseños ajenos).

- **Publicada en:** https://osunafm-ops.github.io/cuaderno/ (GitHub Pages, repo público `osunafm-ops/cuaderno`, rama `main`). Solo código; los datos del usuario nunca van al repo.
- **Publicar cambios:** subir la versión `V` de `sw.js` (`cuaderno-vN`) y hacer `git commit` + `git push`. Las tablets cargan la nueva versión solas al abrir la app con internet.
- **Git:** identidad local del repo `osunafm-ops` con correo noreply de GitHub.
- **Sin dependencias de compilación:** HTML + CSS + módulos JS nativos. Librerías por CDN: pdf.js 3.11.174 y jsPDF 2.5.1 (cdnjs), fuentes de Google (Literata, Inter, Caveat).
- **Probar en local:** `python -m http.server 8765 --bind 127.0.0.1` dentro de la carpeta y abrir http://127.0.0.1:8765. El navegador integrado no admite service workers (es normal el error al registrarlo).

## Archivos
- `index.html`, `manifest.webmanifest`, `sw.js` (caché sin conexión; con internet carga siempre lo último y recarga sola al haber versión nueva).
- `css/app.css` — todo el estilo.
- `js/app.js` — estructura, rutas (`#/home`, `#/papel/<carpeta>`, `#/agenda`, `#/reuniones`, `#/biblioteca`, `#/recortes`, `#/notas`, `#/ajustes`, `#/ed/<cuaderno>/<página>`), pantallas, Agenda Día/Semana/Mes, PIN, barra inferior.
- `js/editor.js` — editor de páginas: lápices con presión, borrador, lazo (copiar/cortar/duplicar/capa/evento/tarea/índice/destacar/escuchar/recorte/a texto), texto con formato y barra de formato, imágenes, capas (5), plantillas, páginas, grabación de audio (todos los cuadernos, trazos enlazados al audio `ar`/`at`), índice y destacados (`page.marks`), IA Gemini, exportar PDF/PNG.
- `js/ink.js` — trazos, pinceles, formas perfectas, selección. `js/richtext.js` — texto con formato (párrafos/runs). `js/templates.js` — 19 plantillas.
- `js/db.js` — IndexedDB (`notebooks`, `pages`, `blobs`, `events`, `todos`, `kv`); cada cambio lleva `_u` y los borrados dejan `tombs` para sincronizar.
- `js/store.js`, `js/render.js`, `js/pdf.js`, `js/ui.js`, `js/icons.js`, `js/settings.js`.
- `js/folders.js` — carpetas en árbol: registros `kind:'folder'` en `notebooks`, campo `parent` ('' = raíz).
- `js/google.js` + `js/sync.js` — sincronización con Google: carpeta de Drive «Cuaderno (sincronización)» con `indice.json`, calendario propio «Cuaderno», lista de Tasks «Cuaderno», y lectura de los demás calendarios (solo lectura).
- `js/ai.js` — Gemini (reintentos y modelo de reserva si está saturado).
- `GUIA-GOOGLE.md` — pasos de registro en Google Cloud.

## Google
- Proyecto de Google Cloud **«CUADERNO OK»** (`cuaderno-515614`), modo Prueba, usuario de prueba: la cuenta Gmail del usuario.
- APIs activadas: Drive, Calendar, Tasks. ID de cliente web puesto en `DEFAULT_CLIENT_ID` (`js/google.js`), origen autorizado `https://osunafm-ops.github.io`.
- Clave de Gemini creada en ese proyecto; **la pega el usuario en Ajustes de cada tablet** y se guarda solo allí. Nunca ponerla en el código (el repo es público).

## Preferencias del usuario
- Habla español; explicar sin tecnicismos.
- Al principio no quería IA de pago; luego pidió Gemini con la modalidad gratuita.
- Quiere la app lo más parecida posible a las tabletas E Ink (VIWOODS, AINOTE 2).

## Pendiente / ideas no hechas
- Mapas mentales interactivos, página infinita, transcripción en directo mientras se graba, panel flotante de nota rápida.
- Probar en la tablet real: dictado, grabación, barra de formato con S Pen, permiso de calendarios.
