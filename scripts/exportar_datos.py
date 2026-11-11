"""Genera data/rutas.json (datos del visor), data/manifest.json (versión) y el KMZ para Google Earth.
Uso: python scripts/exportar_datos.py [carpeta_fuentes] [carpeta_salida]"""
import json, hashlib, zipfile, html, collections, sys, os, datetime as dt
from shapely.geometry import LineString
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build

SRC = sys.argv[1] if len(sys.argv) > 1 else 'fuentes'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'data'
os.makedirs(OUT, exist_ok=True)
fuentes = build.resolver_fuentes(SRC)
d, kpi = build.main(fuentes)

# ---------- orden operativo: frente > semana > secuencia ----------
def okey(o):
    def n(x):
        try: return float(x)
        except: return 9e9
    return (str(o['fr'] or 'ZZ'), n(o['sem']), n(o['sec']))
d.sort(key=okey)

def simp(c, tol):
    if len(c) < 3: return c
    return [list(p) for p in LineString(c).simplify(tol, preserve_topology=False).coords]

# ---------- KMZ para Google Earth (antes de codificar) ----------
CAT = {
    'E': ('Ruta de entrada', 'ffffff00', 4), 'S': ('Ruta de salida', 'ff0000ff', 4),
    'ME': ('Muleo de entrada', 'ffffd400', 3), 'MS': ('Muleo de salida', 'ff4444ff', 3),
    'AV': ('Muleo de autovolteo', 'ffff00ff', 4), 'B': ('Bahías / internas', 'ffff6600', 2),
    'C': ('Cabecereo / conformación', 'ff00ffff', 3), 'O': ('Otras líneas', 'ffdddddd', 2),
}
PCAT = {'R': ('Apertura de raja', 'http://maps.google.com/mapfiles/kml/paddle/R.png'),
        'P': ('Punto de control', 'http://maps.google.com/mapfiles/kml/shapes/police.png'),
        'X': ('Riesgo', 'http://maps.google.com/mapfiles/kml/shapes/caution.png'),
        'O': ('Referencia', 'http://maps.google.com/mapfiles/kml/paddle/wht-blank.png')}
e = html.escape
def cs(c): return ' '.join(f'{x},{y},0' for x, y in c)

K = ['<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>',
     '<name>Rutas por plantío · Programa de Corte 2026-2027</name><open>1</open>']
for k, (nm, col, w) in CAT.items():
    K.append(f'<Style id="l{k}"><LineStyle><color>{col}</color><width>{w}</width></LineStyle></Style>')
for k, (nm, ic) in PCAT.items():
    K.append(f'<Style id="p{k}"><IconStyle><scale>1.0</scale><Icon><href>{ic}</href></Icon></IconStyle><LabelStyle><scale>0.7</scale></LabelStyle></Style>')
K.append('<Style id="pol"><LineStyle><color>ff00e5ff</color><width>2.5</width></LineStyle><PolyStyle><color>3300e5ff</color></PolyStyle></Style>')
K.append('<Style id="area"><LineStyle><color>ffffffff</color><width>1</width></LineStyle><PolyStyle><color>40ffffff</color></PolyStyle></Style>')

by_fr = collections.OrderedDict()
for o in d: by_fr.setdefault(o['fr'] or 'Sin frente', collections.OrderedDict()).setdefault(o['sem'], []).append(o)

def pm_feats(feats):
    out = []
    for f in feats:
        if f['t'] == 'l':
            out.append(f'<Placemark><name>{e(f["n"] or CAT[f["c"]][0])}</name><styleUrl>#l{f["c"]}</styleUrl>'
                       f'<LineString><tessellate>1</tessellate><coordinates>{cs(simp(f["g"], 2e-5))}</coordinates></LineString></Placemark>')
        elif f['t'] == 'p':
            out.append(f'<Placemark><name>{e(f["n"])}</name><styleUrl>#p{f["c"]}</styleUrl>'
                       f'<Point><coordinates>{f["g"][0]},{f["g"][1]},0</coordinates></Point></Placemark>')
        else:
            out.append(f'<Placemark><name>{e(f["n"] or "Área")}</name><styleUrl>#area</styleUrl>'
                       f'<Polygon><outerBoundaryIs><LinearRing><coordinates>{cs(f["g"])}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>')
    return out

for fr, sems in by_fr.items():
    K.append(f'<Folder><name>Frente {e(str(fr))}</name>')
    for sem, lst in sems.items():
        K.append(f'<Folder><name>Semana {e(str(sem))}</name>')
        for o in lst:
            q = o['q']
            src = o['src'] or 'SIN MAPEO'
            desc = (f'<table><tr><td><b>Fecha corte</b></td><td>{o["fc"]}</td></tr>'
                    f'<tr><td><b>Secuencia</b></td><td>{o["sec"]}</td></tr><tr><td><b>Ha / TM</b></td><td>{o["ha"]} / {o["tm"]}</td></tr>'
                    f'<tr><td><b>Variedad</b></td><td>{e(str(o["var"]))}</td></tr><tr><td><b>Región</b></td><td>{o["reg"]}</td></tr>'
                    f'<tr><td><b>Mapeo usado</b></td><td>{src}</td></tr>'
                    f'<tr><td><b>Km entrada / salida (trazo)</b></td><td>{q["ke"]} / {q["ks"]}</td></tr>'
                    f'<tr><td><b>Dist KM Mapeado (programa)</b></td><td>{o["dkmm"]}</td></tr>'
                    f'<tr><td><b>Puntos de raja</b></td><td>{q["nR"]}</td></tr><tr><td><b>Autovolteo</b></td><td>{"Sí" if q["av"] else "No"}</td></tr></table>')
            tag = '' if o['src'] == '26-27' else (' [ref 25-26]' if o['src'] else ' [SIN MAPEO]')
            K.append(f'<Folder><name>{o["id"]} - {e(str(o["nm"]))}{tag}</name><description><![CDATA[{desc}]]></description>')
            for p in o['pol']:
                rings = [simp(r, 1e-5) for r in p['g']]
                inner = ''.join(f'<innerBoundaryIs><LinearRing><coordinates>{cs(r)}</coordinates></LinearRing></innerBoundaryIs>' for r in rings[1:])
                K.append(f'<Placemark><name>Cuadro {e(str(p["q"]))}</name><styleUrl>#pol</styleUrl><Polygon><outerBoundaryIs><LinearRing>'
                         f'<coordinates>{cs(rings[0])}</coordinates></LinearRing></outerBoundaryIs>{inner}</Polygon></Placemark>')
            K += pm_feats(o['f'])
            K.append('</Folder>')
        K.append('</Folder>')
    K.append('</Folder>')
K.append('</Document></kml>')
with zipfile.ZipFile(os.path.join(OUT, 'Rutas_por_Plantio_Programa_26-27.kmz'), 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('doc.kml', ''.join(K))

# ---------- codificación compacta para el visor ----------
pool, P = {}, []
def enc(c):
    out, px, py = [], 0, 0
    for x, y in c:
        ix, iy = round(x * 1e6), round(y * 1e6); out += [ix - px, iy - py]; px, py = ix, iy
    return out
def gid(c):
    ee = enc(c); k = hashlib.md5(json.dumps(ee).encode()).hexdigest()
    if k not in pool: pool[k] = len(P); P.append(ee)
    return pool[k]
for o in d:
    for key in ('f', 'ref'):
        for f in (o.get(key) or []):
            if f['t'] == 'l': f['g'] = gid(simp(f['g'], 2e-5))
            elif f['t'] == 'a': f['g'] = gid(simp(f['g'], 1e-5))
    for p in o['pol']:
        p['g'] = [gid(simp(r, 1e-5)) for r in p['g']]
payload = json.dumps({'G': P, 'D': d}, ensure_ascii=False, separators=(',', ':'))
ver = hashlib.sha256(payload.encode()).hexdigest()[:12]
open(os.path.join(OUT, 'rutas.json'), 'w', encoding='utf-8').write(payload)
manifest = {'version': ver, 'generado': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
            'bytes': len(payload.encode()), 'plantios': len(d), 'indicadores': kpi,
            'fuentes': {k: os.path.basename(v) for k, v in fuentes.items() if v}}
# ---- capas de apoyo (proyecto QField) ----
# a) si hay shapefiles en fuentes/capas_apoyo, se convierten aquí; b) si no, se conserva el data/capas.json ya existente
import capas as _capas
cap_dir = os.path.join(SRC, 'capas_apoyo'); cap_json = os.path.join(OUT, 'capas.json')
if os.path.isdir(cap_dir):
    cdoc = _capas.construir(cap_dir); _, cbytes = _capas.escribir(cdoc, OUT)
    manifest['capas'] = _capas.resumen_manifest(cdoc, cbytes); print('capas de apoyo generadas desde', cap_dir)
elif os.path.exists(cap_json):
    cdoc = json.load(open(cap_json, encoding='utf-8'))
    manifest['capas'] = _capas.resumen_manifest(cdoc, os.path.getsize(cap_json)); print('capas de apoyo conservadas de', cap_json)
else:
    print('sin capas de apoyo (opcional): ejecuta scripts/exportar_capas.py con tu proyecto QField')
json.dump(manifest, open(os.path.join(OUT, 'manifest.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('datos', ver, round(len(payload) / 1e6, 2), 'MB', manifest['fuentes'])
