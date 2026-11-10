# Rutas por plantío · Programa de Corte 2026-2027

Visor de rutas de entrada y salida, muleo, autovolteo y puntos de raja por plantío. Incluye la validación de campo ("según lo planificado" o "diferente", con nota) que se guarda en Google Sheets.

## Estructura

| Carpeta | Contenido | Quién la edita |
|---|---|---|
| `fuentes/` | Programa de Corte (.xlsx), Mapeo 26-27 (.kml/.kmz), Mapeo 25-26 (.kmz) y Maestro General (shapefile en .zip) | **Tú** |
| `data/` | `rutas.json` (datos del visor), `manifest.json` (versión) y el KMZ para Google Earth | GitHub Actions |
| `docs/` | `lanzador.html` (archivo local), `index.html` (visor completo sin datos) y `visor.json` (versión del visor) | GitHub Actions |
| `scripts/` | Procesamiento en Python | — |
| `visor_src/` | Código fuente del visor; `config.json` guarda la URL de Apps Script | Solo si cambias el visor |

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
