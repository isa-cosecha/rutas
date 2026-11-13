# Rutas por plantío · Programa de Corte 2026-2027

Visor de rutas de entrada y salida, muleo, autovolteo y puntos de raja por plantío. Incluye la validación de campo ("según lo planificado" o "diferente", con nota) que se guarda en Google Sheets.

## Estructura

| Carpeta | Contenido | Quién la edita |
|---|---|---|
| `fuentes/` | Programa de Corte (.xlsx), Mapeo 26-27 (.kml/.kmz), Mapeo 25-26 (.kmz) y Maestro General (shapefile en .zip) | **Tú** |
| `data/` | `rutas.json` (datos del visor), `capas.json` (capas de apoyo del QField), `manifest.json` (versiones) y el KMZ para Google Earth | GitHub Actions (`capas.json`: lo subes tú) |
| `docs/` | `lanzador.html` (archivo local), `index.html` (visor completo sin datos) y `visor.json` (versión del visor) | GitHub Actions |
| `scripts/` | Procesamiento en Python | — |
| `visor_src/` | Código fuente del visor; `config.json` guarda la URL de Apps Script | Solo si cambias el visor |
| ~~`apps_script/`~~ | **Ya no se sube a GitHub.** El servidor único (`Codigo_Plataforma_v5.gs`) contiene los IDs de los libros y se pega directo en Apps Script. Si esta carpeta existe en el repositorio, bórrala | — |

## Actualizar el mapeo o el programa

1. En `fuentes/`, sube el archivo nuevo y **borra el anterior del mismo tipo**. Debe quedar uno por tipo; si hay dos, el proceso se detiene para no adivinar cuál es el vigente.
2. GitHub Actions regenera `data/` y `docs/` en 2 a 3 minutos (pestaña **Actions**).
3. Los visores detectan la nueva versión la próxima vez que se abren con internet.

Los nombres deben empezar así: `Programa*.xlsx`, `Mapeo_26-27*.kml|kmz`, `Mapeo*25-26*.kml|kmz` y `Maestro_General*.zip`.

## Cómo lo usan las personas

**Opción recomendada: el lanzador (un archivo de 6 KB).** Cada usuario descarga **una sola vez** `docs/lanzador.html` y lo abre con doble clic. Al abrirse:

1. Consulta en GitHub si hay un visor nuevo (`docs/visor.json`) y lo descarga solo si cambió.
2. Consulta si hay datos nuevos (`data/manifest.json`) y los descarga solo si cambiaron.
3. Guarda ambos en el navegador. Sin internet abre la última copia guardada.

Así, cualquier cambio (datos, mapeo o mejoras del visor) llega a todos sin reenviar archivos. Para forzar la descarga completa: abrir `lanzador.html?forzar`.

- Descarga: en GitHub abre `docs/lanzador.html` y pulsa **Download raw file** (ícono de descarga).
- **En línea (necesario para el GPS en el celular):** *Settings > Pages > Deploy from a branch > main / docs*. Quedan publicados `https://USUARIO.github.io/REPO/` (visor) y `.../lanzador.html`.
- `docs/index.html` sigue disponible como visor independiente (400 KB, con la URL de datos incluida).

## Generar a mano (opcional)

```
pip install -r scripts/requirements.txt
python scripts/exportar_datos.py fuentes data
python scripts/construir_visor.py --repo USUARIO/REPO   # genera docs/index.html, visor.json y lanzador.html
```

## Usuarios, roles y capas por usuario (Google Sheets)

El script `apps_script/Codigo.gs` administra tres hojas del Google Sheets:

| Hoja | Contenido |
|---|---|
| `Usuarios` | Usuario, nombre, rol, activo, clave (solo sal y hash). Se administra desde la aplicación (⚙ *Mi cuenta* > **Administrar usuarios**); el menú **Rutas** de la hoja queda como respaldo |
| `Configuración` | Una fila por usuario con las capas del mapa que quiere ver (Sí / No). Se puede editar a mano |
| `Respuestas` | Validaciones de campo. Usuario, nombre y rol los pone el servidor según la sesión |

### Administrar usuarios desde la aplicación

Con un usuario **Administrador**: ⚙ *Mi cuenta* > **Administrar usuarios**.

| Quiero… | Cómo |
|---|---|
| Crear un usuario | *Nuevo usuario*: usuario (sin espacios), nombre y rol > **Crear usuario**. Se muestra un **código temporal** (una sola vez) que le entregas; al entrar, el visor le pide crear su propia clave |
| Restablecer una clave | Botón **Restablecer clave** de su fila. La clave anterior deja de servir, se cierran sus sesiones abiertas y se genera un código temporal nuevo |
| Cambiar el rol (dar o quitar permisos) | Selector **Rol** de su fila. Rige de inmediato, sin que la persona salga y entre |
| Dar de baja o reactivar | Botón **Activo / Inactivo**. Al desactivar pierde el acceso al instante; sus respuestas anteriores se conservan |
| Liberar a alguien bloqueado | Tras 5 intentos fallidos se bloquea 15 min; botón **Desbloquear** |
| Ver quién hizo qué | *Historial de cambios* (crear, editar, restablecer, desbloquear; nunca guarda claves) |

Permisos por rol (se aplican en el servidor; la pantalla solo oculta botones):

| Permiso | Administrador | Supervisor | Administrador de frente | Consulta |
|---|:-:|:-:|:-:|:-:|
| Ver mapa, rutas, capas y estado de las respuestas | ✓ | ✓ | ✓ | ✓ |
| Registrar "según lo planificado / diferente" | ✓ | ✓ | ✓ | — |
| Formularios: combustible, motos, seguimiento de administradores, ATS | ✓ | ✓ | ✓ | — |
| Convertir y publicar las capas del QField | ✓ | — | — | — |
| Administrar usuarios, roles y claves | ✓ | — | — | — |

*Administrador* es quien administra la plataforma. *Administrador de frente* es quien dirige un frente de cosecha: llena formularios y responde rutas, pero no administra nada; necesita **ficha** (así la app precarga su nombre). A cada persona se le pueden limitar los formularios (columna *Formularios* de la hoja `Usuarios`, o las casillas del panel).

Protecciones: un administrador no puede quitarse su propio rol, desactivarse ni restablecer su propia clave desde el panel (usa *Cambiar clave*), y siempre debe quedar al menos un administrador activo. **Emergencia:** si nadie puede entrar como administrador, el menú *Rutas > Crear o reiniciar usuario* de la hoja de Google sigue funcionando.


## Capas de apoyo del proyecto QField

El visor integra las capas del proyecto QField (pozos, motores, válvulas, obstáculos, postes, ríos, red vial y quemas) en un solo archivo, `data/capas.json` (~1 MB; el proyecto original pesa 226 MB).

**Cómo se muestran.** Al seleccionar un plantío aparecen solo las entidades que están a cierto radio del plantío (pozos 500 m, válvulas y obstáculos 120 m, postes 150 m, ríos 300 m…) **o** que traen su código (válvulas y obstáculos por `Lote`; quemas por `Codigo`). Las **capas de quema** (límites, contornos, proveedores y áreas a autorizar) usan otra regla: se muestra solo lo que cae **sobre el plantío seleccionado** (al menos la mitad de su trazo dentro del contorno del lote, con 5 m de tolerancia), sin radio ni código; así no aparecen las quemas de los lotes vecinos. Se configura con `sobre` en `scripts/capas_config.json`. El modo **"Ver capas de todo el mapa"** (zoom 14 o más) muestra lo que cae en pantalla. Cada usuario enciende o apaga cada capa en el panel **Capas** (botón *Capas* sobre el mapa en la web; botón de capas en la barra superior en el celular) y su elección se guarda en la hoja `Configuración` de Google Sheets (una columna por capa). La ficha del plantío ya no lleva capas. Las válvulas de goteo y los postes eléctricos se dibujan con los íconos del proyecto QGIS (cruz azul con rombo; torre de alta tensión), cuyo tamaño sigue el zoom.

**Listado lateral (web):** el botón **«** sobre el mapa oculta el listado para ver el mapa a ancho completo; **»** lo muestra de nuevo. Se recuerda en cada equipo.

**Qué no se importó, y por qué.** Rajas y Maestro de plantíos ya estaban (las rajas del QField coinciden con las del visor, mediana 0.1 m). Las válvulas están repetidas dentro de "Obstáculos varios" (971 de 4,403): esa capa se importa sin ellas. Las nubes de vértices de quemas no se convierten a polígonos porque no cierran anillos válidos; se dibujan como líneas de contorno.

**Actualizar las capas — desde el propio visor (recomendado, sin instalar nada).** Inicia sesión como **Administrador**, abre ⚙ *Mi cuenta* > **Administrar capas (QField)**, elige la carpeta del proyecto QField y pulsa **Convertir capas**. Todo se procesa en tu equipo (el proyecto completo de 226 MB tarda unos segundos; los archivos no se suben a ningún servidor). Luego puedes **Vista previa en este equipo** (solo tú, hasta recargar), **Descargar capas.json**, o **Publicar en GitHub** con un token *fine-grained* con permiso *Contents: Read and write* solo sobre este repositorio (no se guarda). Si la red de la empresa bloquea `api.github.com`, descarga el archivo y súbelo a `data/` desde la web de GitHub. Al cambiar `data/capas.json` el workflow actualiza el manifiesto y los visores descargan las capas nuevas.

*Alternativas:* `Actualizar_capas.bat` (Windows) o `python scripts/exportar_capas.py "<carpeta del proyecto QField>" data` producen el mismo archivo. El workflow actualiza el manifiesto y los visores lo descargan solos. Los shapefiles no se suben a GitHub (la capa de quemas sola pesa más de 100 MB).

**Agregar o ajustar una capa:** edita `scripts/capas_config.json` (archivo, estilo, radio, campos del popup, vínculo). Si agregas una capa nueva, agrega también su id con prefijo `x` en la lista `CAPAS` de `apps_script/Codigo.gs` para que se pueda guardar en el perfil.

## Formularios de campo (módulos de esta misma aplicación)

Combustible, recorrido de motos, seguimiento de administradores y análisis de trabajo seguro (ATS) viven dentro del visor: botón **📝 Formularios** en el mapa (y **🦺 Registrar ATS de este plantío** en la ficha de cada plantío, que abre el ATS con ese plantío y su frente ya cargados). Usan **el mismo inicio de sesión, el mismo servidor y la misma URL** que el mapa, y escriben en los mismos libros y columnas que alimentaba ODK. Código: `visor_src/forms.js` y `forms.css`.

- **Sin conexión:** los registros se guardan en el teléfono y se envían solos; cada uno lleva un identificador único (`instanceID`), así un reenvío nunca duplica.
- **Catálogos** (zafras, frentes, administradores, equipos, operadores, plantíos): salen de `Archivo_Maestros` y del libro ATS; se guardan en el teléfono y se borran al cerrar sesión.
- Guía de migración y de puesta en marcha: `LEEME_Migracion.md` (entregada aparte del repositorio).

## Programa de corte en Google Sheets

El programa de corte vive en la hoja **`Programa de Corte`** de `Archivo_Maestros`: una fila por plantío y zafra (columna *Zafra*), con **todas** las columnas del programa (frente, fecha de corte, semana, secuencia, ha, toneladas, etc.) y una columna *Borrador* con su etiqueta. **El mapa y el ATS leen de ahí.**

- **Mapa:** al entrar toma el programa de la hoja y lo aplica sobre cada plantío (frente, fecha, semana, secuencia, ha, toneladas…). Si no hay conexión usa el último que leyó. El repositorio sigue aportando la geometría y las rutas.
- **ATS:** lista los plantíos del programa con su frente, semana, fecha de corte y secuencia; al elegir uno completa el frente. Si se abre desde la ficha de un plantío en el mapa, ya viene elegido.
- **Cargar un borrador nuevo:** pegar el Excel del programa en la hoja `Programa nuevo` de `Archivo_Maestros` y ejecutar el menú *Plataforma de campo → Cargar programa de corte*. Informa cuántos plantíos son nuevos, cuántos ya no están y cuántos cambiaron de fecha, frente o semana; deja el programa anterior en la hoja `Programa respaldo`; y no carga nada si encuentra errores (códigos repetidos, sin fecha, sin frente).
- **Cuándo sí hay que subir algo a GitHub:** solo cuando se agregan plantíos nuevos (necesitan polígono) o cambia el mapeo. Para cambiar frente, fecha o semana basta la hoja.

## Hectáreas por cuadro y nota emergente

- Cada cuadro muestra su área en hectáreas como etiqueta (capa **Hectáreas de cada cuadro** del panel *Capas*; se guarda por usuario). Se dibujan en un lienzo propio (`core.js`, `dibujarEtiquetas`) entre las líneas y los íconos, con el punto de etiqueta siempre *dentro* del cuadro (también si es cóncavo), y se omiten las que no caben a ese zoom.
- Al pasar el cursor sobre un plantío (computadora) se ve su nota: código, nombre, área total, TCH, TM, frente, semana, secuencia y fecha de corte.

## App instalable (PWA), uso sin conexión y APK

- **Service worker** (`visor_src/pwa/sw.template.js` → `docs/sw.js`): guarda la app en el teléfono y la abre al instante con o sin señal, también al refrescar. Se actualiza solo en cada versión (el nombre de su caché lleva la versión de la app). Los datos de GitHub y el servidor de Google no pasan por él: la app los guarda por su cuenta.
- **Arranque sin esperas** (`scripts/construir_visor.py`): si ya hay datos guardados se abre con ellos de inmediato; los nuevos se bajan en segundo plano. En modo avión no espera a la red; con señal mala espera como máximo 6-8 s.
- **Manifiesto, íconos y capturas** (`visor_src/pwa/`): se copian a `docs/` en cada compilación. Los íconos se generan con `scripts/generar_iconos.py`.
- **Publicación en Firebase Hosting:** `firebase.json` publica la carpeta `docs/` (con las cabeceras de caché correctas) y `.firebaserc` guarda el ID del proyecto. El flujo `.github/workflows/firebase-hosting.yml` publica automáticamente cuando cambia `docs/` y cuando termina *Actualizar datos del visor*; necesita el secreto `FIREBASE_SERVICE_ACCOUNT`. A mano: `firebase deploy --only hosting`.
- **APK con PWABuilder:** ver `LEEME_APK_PWABuilder.md` (entregada aparte). Para que el APK se abra sin la barra del navegador, la huella de su llave de firma va en **`docs/.well-known/assetlinks.json`**; el compilador crea ese archivo con textos de ejemplo solo si no existe y **nunca lo sobrescribe**.

## Rendimiento de los formularios

- **Cliente (`forms.js`):** al abrir los formularios no se espera al servidor si ya hay catálogos en el teléfono; si están viejos (más de 10 minutos) se actualizan en segundo plano y una sola consulta a la vez. Los plantíos del ATS salen del programa de corte que el mapa ya tiene (sin llamada aparte). Un odómetro guardado y aún sin enviar no se pisa con lo que diga el servidor.
- **Servidor (`Codigo_Plataforma_v8.gs`):** el programa de corte (~320 KB) se guarda en la caché de Google por trozos (cada valor admite 100 KB) durante 2 minutos y se invalida al cargar un borrador nuevo; los odómetros se guardan 5 minutos y se invalidan al registrar un recorrido o una carga de moto; cada libro se abre una sola vez por ejecución.
- **Etiquetas de hectáreas:** las del plantío seleccionado resaltan (12.5 px, negrita, amarillo); las demás son pequeñas (9.5 px en computadora, 8.5 px en celular), delgadas y translúcidas, y no se encimen (`estiloEtq` en `core.js`).

## Conexiones visibles solo para el Administrador

En **Mi cuenta**, la sección *Avanzado (conexiones)* (URL del Web App de Apps Script, URL de datos en GitHub y token de GitHub) solo se muestra al **Administrador** de la plataforma (permiso `usuarios_admin`). Para los demás roles ni se dibuja ni se cargan esos valores en los campos, el botón *Guardar* no aparece y, aunque alguien lo destapara con las herramientas del navegador, `Guardar` no cambia nada. Es una protección de pantalla: la URL de Apps Script sigue estando dentro del archivo de la página (la app la necesita para funcionar); lo que protege los datos es el inicio de sesión del servidor. El token de GitHub solo se usa si el repositorio es privado.

## Etiquetas de hectáreas según el zoom

Las de los vecinos se achican y se vuelven más translúcidas cuanto más lejos está el mapa: en celular de 8.5 px / 0.70 de opacidad (zoom 17 o más) a 5.5 px / 0.40 (zoom 13 o menos); en computadora de 9.5 px a 6.5 px. Con la escala de 500 m (zoom 14) miden ~6.3 px y 0.49. El plantío seleccionado conserva 12.5 px, negrita y amarillo a cualquier zoom. Ajustes en `estiloEtq` de `core.js`.

## Permisos finos por usuario (v9)

- **CSV:** permiso `csv` (Administrador, Supervisor, Administrador de frente). El rol Consulta no ve el botón; la función `csv()` también lo comprueba. Con un servidor anterior, que aún no manda ese permiso, todo rol distinto de Consulta conserva el CSV.
- **Planificación por usuario:** columna *Planificación* de la hoja `Usuarios` (`Sí`/`No`, vacía = `Sí`). Con `No` el servidor quita el permiso `responder` a ese usuario (rechaza el registro con "deshabilitado para tu usuario") y la ficha no muestra los botones de respuesta.
- **Formularios por usuario:** la columna *Formularios* acepta `todos`, `ninguno` o una lista. Con `ninguno` no se dibuja el botón de Formularios y el servidor niega catálogos y envíos. Las casillas por usuario solo **quitan** permisos del rol; nunca agregan.
- **Hectáreas, tamaño y color por usuario:** `Mi cuenta` → deslizador 50–200 % y color; se guardan en las columnas *Tamaño de las hectáreas (%)* y *Color de las hectáreas* de la hoja `Configuración`. El plantío seleccionado conserva el amarillo.

## Maestros editables y permisos al día (v10)

- **Editor de maestros** (`visor_src/admin_maestros.js`, servidor `accionMae*_`): solo con el permiso `maestros_admin` (Administrador). Tablas definidas en `MAESTROS_DEF` del servidor (hoja, columnas, tipo y reglas de cada una); alta, edición y baja con validación por tipo, unicidad, detección de cambios simultáneos (el cliente envía el contenido original de la fila) y registro en la hoja `Auditoría`. Cada cambio sube el contador `maestros_version`, que el servidor devuelve en `sync` y `form_maestros`; el cliente lo compara y vuelve a bajar los catálogos.
- **Permisos en vivo** (`core.js`): consulta al servidor cada 3 minutos con la app a la vista, al volver a la ventana (máx. 1 cada 20 s) y cuando el servidor niega una acción (`code: 'permiso'`). Al cambiar el rol o los permisos avisa, redibuja la ficha y, si corresponde, cierra o cambia la pantalla de formularios. Las respuestas guardadas sin permiso no se envían ni se pierden.

## Camionetas alquiladas (v11)

- **Dos formularios** (`FORM.camcomb`, `FORM.camrec` en `forms.js`; `filaCamComb_`, `filaCamRec_` en el servidor) que escriben en los libros `ID_CAMCOMB` (*Consumo combustible Camionetas*) y `ID_CAMREC` (*Recorrido de Vehículos Alquilado*): 15 columnas en el orden de ODK, hora como fracción de día, supervisor como `Nombre_Apellido`, recorrido = final − inicial. Permisos `form_camcomb` y `form_camrec`; en `Usuarios`/`Altas` se escriben `camcomb` y `camrec`.
- **Maestros:** camionetas = `Equipos` con categoría `Camionetas`; `Supervisores` es una tabla nueva (`MAESTROS_DEF.supervisores`, con `crear: true`: la hoja se crea sola). `mae_traer` copia a ambos lo que aparece en la zafra más reciente de las hojas de camionetas.
- **Odómetros:** `odometros_()` combina las dos hojas de camionetas (el último por fecha; el mismo día gana el mayor) y se invalida al guardar cualquiera de los dos formularios.
- **Cantidad en galones:** rótulo en `forms.js` y límites en `AVISOS` (`camGal`, `kmGal`, `odoSaltoCam`, `recorridoCam`); el rechazo del servidor (60) está en `filaCamComb_`.
- Rótulo de *Control de combustible*: "Planta / Cisterna".

## Puestos y supervisor del ATS (v12)

- `MAESTROS_DEF.administradores` ahora tiene `Puesto` (`PUESTOS`: Administrador de frente / Supervisor, opcional) y `Nombre completo` (opcional). `maestros_()` devuelve `puesto` y `completo` por persona y una lista `supervisores` unificada (tabla `Supervisores` + personas con puesto Supervisor, sin repetir por nombre normalizado). `MAESTROS_V = 12`.
- ATS: `filaAts_` exige `supervisor` en esa lista y lo escribe en la columna 41 (*Supervisor*); la 42 es el responsable y la 47 quien registró (antes la 41 llevaba a quien registraba).
- Cliente: `soloAdmins()` excluye a los supervisores de los selectores de administrador y responsable; `supervisoresAts()` alimenta el campo nuevo.

## Activo / inactivo en los maestros (v13)

- `ACTIVO = ['Sí','No']`: columna opcional **al final** de `administradores`, `equipos`, `operadores` y `supervisores` (vacío = activo). `esInactivo_()` también reconoce `no`, `inactivo`, `inactiva`, `false` y `0`.
- `maestros_()` devuelve **sólo lo activo** en las listas que usan los formularios, más `inactivos` (`administradores`, `operadores`, `equipos` por categoría) y `inact` (nombres y códigos inactivos, sólo para explicar el rechazo en `enLista_` y en las validaciones de ficha). `MAESTROS_V = 13`.
- Cliente: `adminPorId()` y `operadorPorId()` buscan también en `inactivos` para seguir mostrando nombres en registros viejos o pendientes. El editor atenúa las filas inactivas, cuenta las inactivas por pestaña y trae el filtro *Ocultar inactivos*.
- `escribirMae_` completa con vacíos las columnas que falten, así que añadir una columna a una tabla no obliga a cambiar a quienes escriben en ella.

## Capas base del mapa (cliente)

- `initMap` en `core.js`: **Satélite (Esri)** (por defecto), **Google Satellite** (`mt1.google.com/vt/lyrs=s`, `maxNativeZoom` 20; se quita con `CAPA_GOOGLE = false`) y **Calles (OSM)** (`maxNativeZoom` 19), más la capa superpuesta **Nombres**. El orden de las capas lo da el selector (`autoZIndex`), por lo que Nombres queda siempre encima.
- La última capa se guarda en `localStorage` (`rp26_base`); sin conexión (`navigator.onLine === false`) se ignora y se usa Esri.
- El service worker solo intercepta y guarda teselas de `server.arcgisonline.com` (`HOST_TESELAS`): las de Google van directo a la red y no se almacenan.
