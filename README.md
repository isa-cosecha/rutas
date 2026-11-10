# Rutas por plantío · Programa de Corte 2026-2027

Visor de rutas de entrada y salida, muleo, autovolteo y puntos de raja por plantío. Incluye la validación de campo ("según lo planificado" o "diferente", con nota) que se guarda en Google Sheets.

## Estructura

| Carpeta | Contenido | Quién la edita |
|---|---|---|
| `fuentes/` | Programa de Corte (.xlsx), Mapeo 26-27 (.kml/.kmz), Mapeo 25-26 (.kmz) y Maestro General (shapefile en .zip) | **Tú** |
| `data/` | `rutas.json` (datos del visor), `manifest.json` (versión) y el KMZ para Google Earth | GitHub Actions |
| `docs/` | `index.html`: el visor de un solo archivo, sin datos dentro | GitHub Actions |
| `scripts/` | Procesamiento en Python | — |
| `visor_src/` | Código fuente del visor; `config.json` guarda la URL de Apps Script | Solo si cambias el visor |

## Actualizar el mapeo o el programa

1. En `fuentes/`, sube el archivo nuevo y **borra el anterior del mismo tipo**. Debe quedar uno por tipo; si hay dos, el proceso se detiene para no adivinar cuál es el vigente.
2. GitHub Actions regenera `data/` y `docs/` en 2 a 3 minutos (pestaña **Actions**).
3. Los visores detectan la nueva versión la próxima vez que se abren con internet.

Los nombres deben empezar así: `Programa*.xlsx`, `Mapeo_26-27*.kml|kmz`, `Mapeo*25-26*.kml|kmz` y `Maestro_General*.zip`.

## Cómo lo usan las personas

- **Local:** descargan `docs/index.html` (unos 400 KB) y lo abren con doble clic. La primera vez baja los datos de GitHub y los guarda en el navegador; después funciona sin conexión.
- **En línea (necesario para el GPS en el celular):** activa GitHub Pages en *Settings > Pages > Deploy from a branch > main / docs*. La URL queda como `https://USUARIO.github.io/REPO/`.

## Generar a mano (opcional)

```
pip install -r scripts/requirements.txt
python scripts/exportar_datos.py fuentes data
python scripts/construir_visor.py --repo USUARIO/REPO
```
