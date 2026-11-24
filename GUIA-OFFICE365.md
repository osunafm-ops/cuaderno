# Ver el calendario de Office 365 en Cuaderno

Los eventos se ven en la Agenda y en Inicio. Solo se ven: se cambian desde Outlook.

## Opción A · Sencilla, sin registrar nada (a través de Google Calendar)

1. En Outlook en la web: **Configuración → Calendario → Calendarios compartidos → Publicar un calendario**. Elige el calendario y el permiso **Puede ver todos los detalles** → **Publicar** → copia el enlace **ICS**.
2. En Google Calendar (ordenador): **Otros calendarios → + → Desde URL** → pega el enlace → **Añadir calendario**.
3. En Cuaderno ya está activado «Ver mis otros calendarios»: aparecerá al sincronizar.

Ten en cuenta: quien tenga ese enlace puede ver el calendario, la empresa puede tener desactivada la publicación y Google tarda horas en traer los cambios.

## Opción B · Conexión directa (se actualiza cada 10 minutos)

Hay que registrar la app una vez. Si la cuenta es de empresa, puede hacer falta que el administrador lo autorice.

1. Entra en https://entra.microsoft.com → **Entra ID → Registros de aplicaciones → Nuevo registro**.
2. Nombre: *Cuaderno*. Tipos de cuenta: **cualquier organización y cuentas personales de Microsoft**.
3. URI de redirección: tipo **Aplicación de página única (SPA)** y la dirección exacta `https://osunafm-ops.github.io/cuaderno/` → **Registrar**. (Los nombres de los menús pueden variar un poco.)
4. **Permisos de API → Agregar → Microsoft Graph → Delegados → Calendars.Read**.
5. Copia el **Id. de aplicación (cliente)**. No hace falta ningún secreto.
6. En la tablet: **Ajustes → Calendario de Office 365 → ID de aplicación** → pégalo y guarda → **Conectar con Office 365**.

Microsoft obliga a volver a entrar cada 24 horas en este tipo de aplicaciones.
