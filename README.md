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
