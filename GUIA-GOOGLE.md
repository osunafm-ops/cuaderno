# Conectar Cuaderno con Google (Drive, Calendar y Tasks)

Se hace una sola vez, desde el ordenador, con la cuenta de Gmail que usas en las tablets.

1. Entra en https://console.cloud.google.com/ → selector de proyectos → **Proyecto nuevo** → nombre **Cuaderno** → **Crear**.
2. **APIs y servicios → Biblioteca** → habilita **Google Drive API**, **Google Calendar API** y **Google Tasks API**.
3. **Google Auth Platform → Comenzar**: nombre de la app *Cuaderno*, tu correo de asistencia, público **Externo**, tu correo de contacto → **Crear**.
4. **Google Auth Platform → Público**: deja el estado en **Prueba** y en **Usuarios de prueba** añade tu Gmail (y cualquier otra cuenta que uses en las tablets).
5. **Google Auth Platform → Clientes → Crear cliente** → tipo **Aplicación web** → en **Orígenes autorizados de JavaScript** añade `https://osunafm-ops.github.io` → **Crear**.
6. Copia el **ID de cliente** (termina en `.apps.googleusercontent.com`).

En cada tablet: **Ajustes → Sincronización con Google → ID de cliente** (pégalo y guarda) → **Conectar con Google** → en el aviso «Google no ha verificado esta app» pulsa **Continuar** → marca todos los permisos.

## Qué se sincroniza

- **Entre tablets:** cuadernos, páginas, notas, recortes, PDF y audios, en la carpeta «Cuaderno (sincronización)» de tu Drive.
- **Google Calendar:** la Agenda ↔ un calendario llamado «Cuaderno», en los dos sentidos.
- **Google Tasks:** las tareas ↔ una lista llamada «Cuaderno», en los dos sentidos.

La sincronización es automática mientras la sesión de Google está activa (dura 1 hora). Después, el botón de la nube abajo a la derecha muestra «Toca para sincronizar»: tócalo y vuelve a sincronizar.
