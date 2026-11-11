"""Genera data/capas.json a partir de la carpeta del proyecto QField (o de una carpeta con los shapefiles).

Uso:   python scripts/exportar_capas.py "C:\\ruta\\Cosecha 25-26" [carpeta_salida=data]

Úsalo cada vez que actualices las capas en QField. Luego sube data/capas.json al repositorio
(los shapefiles originales no caben en GitHub: la capa de quemas sola pesa más de 100 MB).
"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import capas

if len(sys.argv) < 2:
    raise SystemExit(__doc__)
carpeta = sys.argv[1]
salida = sys.argv[2] if len(sys.argv) > 2 else 'data'
if not os.path.isdir(carpeta): raise SystemExit(f'No existe la carpeta: {carpeta}')
print('Procesando capas de apoyo de', carpeta)
doc = capas.construir(carpeta)
p, n = capas.escribir(doc, salida)
# si ya existe un manifest.json, lo actualiza con la información de las capas
mp = os.path.join(salida, 'manifest.json')
if os.path.exists(mp):
    m = json.load(open(mp, encoding='utf-8')); m['capas'] = capas.resumen_manifest(doc, n)
    json.dump(m, open(mp, 'w', encoding='utf-8'), ensure_ascii=False, indent=1); print('manifest.json actualizado')
print(f'{p}: {n/1e6:.2f} MB · versión {doc["version"]} · {len(doc["capas"])} capas')
