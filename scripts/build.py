"""Une Programa de Corte 26-27 + Mapeo 26-27 + Mapeo 25-26 + Maestro (shp) por código de plantío."""
import re, json, datetime as dt, collections, math
from lxml import etree
import shapefile, openpyxl
from pyproj import Transformer
from shapely.geometry import shape, Point, LineString, mapping
from shapely.ops import unary_union

NS = {'k': 'http://www.opengis.net/kml/2.2'}
K = '{%s}' % NS['k']
import glob, os, zipfile, io

def resolver_fuentes(carpeta):
    """Ubica UNA fuente de cada tipo en la carpeta. Falla si hay ambigüedad (dejar solo la vigente)."""
    def uno(patrones, etiqueta, opcional=False):
        hits = sorted({p for pat in patrones for p in glob.glob(os.path.join(carpeta, pat))})
        if len(hits) > 1: raise SystemExit(f'Hay más de un archivo de {etiqueta} en {carpeta}: {[os.path.basename(h) for h in hits]}. Deja solo el vigente.')
        if not hits:
            if opcional: return None
            raise SystemExit(f'Falta el archivo de {etiqueta} en {carpeta}')
        return hits[0]
    return {'programa': uno(['Programa*.xlsx'], 'Programa de Corte'),
            'mapeo_actual': uno(['Mapeo_26-27*.kml', 'Mapeo_26-27*.kmz'], 'Mapeo 26-27'),
            'mapeo_anterior': uno(['Mapeo*25-26*.kml', 'Mapeo*25-26*.kmz'], 'Mapeo 25-26', opcional=True),
            'maestro': uno(['Maestro_General*.zip'], 'Maestro General (shapefile .zip)')}

def abrir_kml(path):
    """Acepta .kml o .kmz; devuelve algo legible por lxml."""
    if path.lower().endswith('.kmz'):
        z = zipfile.ZipFile(path); name = next(n for n in z.namelist() if n.lower().endswith('.kml'))
        return io.BytesIO(z.read(name))
    return path

def abrir_shp(path_zip):
    z = zipfile.ZipFile(path_zip)
    base = next(n[:-4] for n in z.namelist() if n.lower().endswith('.shp'))
    rd = lambda ext: io.BytesIO(z.read(base + ext))
    return shapefile.Reader(shp=rd('.shp'), shx=rd('.shx'), dbf=rd('.dbf'), encoding='utf-8')

# ---------- clasificación ----------
def norm(s):
    s = (s or '').upper().strip()
    s = re.sub(r'\(.*?\)', '', s)
    return re.sub(r'\s+', ' ', s).strip()

def kml_rgb(c):  # aabbggrr -> #rrggbb
    if not c or len(c) != 8: return None
    return '#' + c[6:8] + c[4:6] + c[2:4]

def line_cat(name, color):
    n = norm(name)
    if 'AUTOVOLT' in n or 'AUTOOLT' in n or 'AUTO VOLT' in n: return 'AV'
    mul = n.startswith('M') and n not in ('M',) or 'MULEO' in n
    if n in ('EM', 'ME') or ('MULEO' in n and 'ENTRADA' in n) or n in ('M - ENTRADA', 'M-ENTRADA') or 'ENTRADA DE MULEO' in n: return 'ME'
    if n in ('SM', 'MS') or ('MULEO' in n and 'SALIDA' in n) or n in ('M - SALIDA', 'M-SALIDA') or 'SALIDA DE MULEO' in n: return 'MS'
    if n in ('E', 'RE') or n.startswith('RUTA DE ENTRADA') or n.startswith('ENTRADA') or n == 'R - ENTRADA': return 'E'
    if n in ('S', 'RS') or n.startswith('RUTA DE SALIDA') or n.startswith('SALIDA') or n == 'R - SALIDA': return 'S'
    if n in ('B', 'BAHIA', 'BAHÍA') or n.startswith('BAHIA'): return 'B'
    if 'CABECER' in n or n in ('C', 'M') or 'CONFORMACI' in n: return 'C'
    # fallback por color convencional
    rgb = kml_rgb(color)
    return {'#ff00ff': 'AV', '#ff0000': 'S', '#00ffff': 'E', '#0000ff': 'B', '#ffff00': 'C'}.get(rgb, 'O')

def point_cat(name, icon):
    n = norm(name)
    if icon == 'R.png' or n == 'R': return 'R'
    if icon == 'police.png': return 'P'
    if any(k in n for k in ('RIESGO', 'PELIGRO', 'TENDIDO', 'ALTA TENSION', 'POSTE', 'POZO', 'TRONCO', 'TERRENO', 'MATERIA')) \
            or icon in ('caution.png', 'earthquake.png'): return 'X'
    return 'O'

# ---------- lectura KML ----------
def read_kml(path):
    root = etree.parse(abrir_kml(path), etree.XMLParser(huge_tree=True)).getroot()
    styles, smap = {}, {}
    for s in root.iter(K + 'Style'):
        href = s.findtext('.//k:Icon/k:href', namespaces=NS)
        styles[s.get('id')] = (href.rsplit('/', 1)[-1] if href else None,
                               s.findtext('k:LineStyle/k:color', namespaces=NS))
    for sm in root.iter(K + 'StyleMap'):
        for p in sm.findall('k:Pair', NS):
            if p.findtext('k:key', namespaces=NS) == 'normal':
                smap[sm.get('id')] = (p.findtext('k:styleUrl', namespaces=NS) or '').lstrip('#')
    def style(p):
        u = (p.findtext('k:styleUrl', namespaces=NS) or '').lstrip('#')
        return styles.get(smap.get(u, u), (None, None))
    def coords(el):
        out = []
        for tok in (el.text or '').split():
            v = tok.split(',')
            if len(v) >= 2: out.append([round(float(v[0]), 6), round(float(v[1]), 6)])
        return out
    data = {}
    for f in root.iter(K + 'Folder'):
        pms = f.findall('k:Placemark', NS)
        if not pms: continue
        code = (f.findtext('k:name', namespaces=NS) or '').strip()
        if code.isdigit(): code = code.zfill(5)
        feats = []
        for p in pms:
            name = (p.findtext('k:name', namespaces=NS) or '').strip()
            icon, lcol = style(p)
            for g in p.iter(K + 'Point', K + 'LineString', K + 'Polygon'):
                tag = etree.QName(g).localname
                if tag == 'Point':
                    c = coords(g.find('k:coordinates', NS))
                    if c: feats.append({'t': 'p', 'c': point_cat(name, icon), 'n': name, 'g': c[0]})
                elif tag == 'LineString':
                    c = coords(g.find('k:coordinates', NS))
                    if len(c) >= 2: feats.append({'t': 'l', 'c': line_cat(name, lcol), 'n': name, 'g': c})
                else:
                    c = coords(g.find('.//k:outerBoundaryIs//k:coordinates', NS))
                    if len(c) >= 3: feats.append({'t': 'a', 'c': 'A', 'n': name, 'g': c})
        data[code] = feats
    return data

# ---------- geodesia ----------
def km(coords):
    R = 6371.0088; d = 0
    for (x1, y1), (x2, y2) in zip(coords, coords[1:]):
        p1, p2 = math.radians(y1), math.radians(y2)
        dp, dl = p2 - p1, math.radians(x2 - x1)
        a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
        d += 2 * R * math.asin(math.sqrt(a))
    return d

ING = (-87.0500, 12.5305)   # centroide de las puertas del ingenio (inferido de los extremos de rutas E/S)
TRU = Transformer.from_crs('EPSG:4326', 'EPSG:32616', always_xy=True)
def utm(c):
    xs, ys = TRU.transform([p[0] for p in c], [p[1] for p in c]); return list(zip(xs, ys))
ING_U = TRU.transform(*ING)

def route_to_lot(segs, lot):
    """Encadena segmentos (UTM), orienta desde el ingenio y mide hasta la primera entrada al lote.
    Devuelve (km_hasta_lote, conecta_ingenio, llega_lote)."""
    if not segs: return None, None, None
    segs = [list(s) for s in segs]
    d0 = lambda p: math.dist(p, ING_U)
    # segmento inicial: el que tenga el extremo más cercano al ingenio
    best = min(range(len(segs)), key=lambda i: min(d0(segs[i][0]), d0(segs[i][-1])))
    cur = segs.pop(best)
    if d0(cur[-1]) < d0(cur[0]): cur.reverse()
    conecta = d0(cur[0]) <= 1200
    chain = cur[:]
    while segs:  # encadenado codicioso (tolerancia 80 m)
        end = chain[-1]; j, rev, dm = None, False, 80
        for i, sg in enumerate(segs):
            for r, p in ((False, sg[0]), (True, sg[-1])):
                dd = math.dist(end, p)
                if dd < dm: j, rev, dm = i, r, dd
        if j is None: break
        sg = segs.pop(j); chain += (sg[::-1] if rev else sg)
    line = LineString(chain)
    if lot is None: return round(line.length / 1000, 2), conecta, None
    lotb = lot.buffer(25)
    inter = line.intersection(lotb)
    if inter.is_empty:
        return round(line.length / 1000, 2), conecta, line.distance(lot) <= 1000
    pts = [line.project(Point(c)) for g in getattr(inter, 'geoms', [inter]) for c in g.coords]
    return round(min(pts) / 1000, 2), conecta, True

def main(fuentes):
    m27 = read_kml(fuentes['mapeo_actual'])
    m26 = read_kml(fuentes['mapeo_anterior']) if fuentes.get('mapeo_anterior') else {}

    # Maestro: polígonos por código (UTM16N -> WGS84)
    tr = Transformer.from_crs('EPSG:32616', 'EPSG:4326', always_xy=True)
    shp = abrir_shp(fuentes['maestro'])
    polys = collections.defaultdict(list)
    lots_u = collections.defaultdict(list)
    for sr in shp.iterShapeRecords(fields=['Codigo', 'Cuadro', 'Area_Agric']):
        code = str(sr.record['Codigo']).strip().zfill(5)
        if sr.shape.shapeType == 0 or not sr.shape.points: continue
        geo = sr.shape.__geo_interface__
        if geo['type'] not in ('Polygon', 'MultiPolygon'): continue
        def conv(ring):
            xs, ys = tr.transform([p[0] for p in ring], [p[1] for p in ring])
            return [[round(x, 6), round(y, 6)] for x, y in zip(xs, ys)]
        parts = geo['coordinates'] if geo['type'] == 'MultiPolygon' else [geo['coordinates']]
        for part in parts:
            try: lots_u[code].append(shape({'type': 'Polygon', 'coordinates': part}).buffer(0))
            except Exception: pass
            polys[code].append({'q': sr.record['Cuadro'], 'ha': sr.record['Area_Agric'], 'g': [conv(r) for r in part]})

    # Programa
    ws = openpyxl.load_workbook(fuentes['programa'], read_only=True, data_only=True).active
    rows = list(ws.iter_rows(values_only=True))
    H = [str(h).strip() if h else '' for h in rows[0]]
    ix = {h: i for i, h in enumerate(H)}
    base = dt.date(1899, 12, 30)
    def v(r, k):
        x = r[ix[k]] if k in ix else None
        return x
    def fdate(x):
        return (base + dt.timedelta(days=int(x))).isoformat() if isinstance(x, (int, float)) else (x.date().isoformat() if hasattr(x, 'date') else x)

    out, kpi = [], collections.Counter()
    for r in rows[1:]:
        if not r[0]: continue
        code = str(r[0]).strip().zfill(5)
        if code in m27: src, feats = '26-27', m27[code]
        elif code in m26: src, feats = '25-26', m26[code]
        else: src, feats = None, []
        ref = m26.get(code) if src == '26-27' else None   # referencia histórica

        # QA: longitudes, conteos, puntos R dentro del polígono (buffer ~60 m)
        cnt = collections.Counter(f['c'] for f in feats)
        ke = sum(km(f['g']) for f in feats if f['t'] == 'l' and f['c'] == 'E')
        ks = sum(km(f['g']) for f in feats if f['t'] == 'l' and f['c'] == 'S')
        rin = None
        if polys.get(code) and cnt['R']:
            u = unary_union([shape({'type': 'Polygon', 'coordinates': p['g']}).buffer(0) for p in polys[code]]).buffer(0.00055)
            rin = sum(u.contains(Point(f['g'])) for f in feats if f['c'] == 'R') / cnt['R']
        lot = unary_union(lots_u[code]) if lots_u.get(code) else None
        dE, cE, lE = route_to_lot([utm(f['g']) for f in feats if f['t'] == 'l' and f['c'] == 'E'], lot)
        dS, cS, lS = route_to_lot([utm(f['g']) for f in feats if f['t'] == 'l' and f['c'] == 'S'], lot)
        flags = []
        if (cE is False) or (cS is False): flags.append('no_conecta_ingenio')
        if (lE is False) or (lS is False): flags.append('no_llega_lote')
        if src is None: flags.append('sin_mapeo')
        elif src == '25-26': flags.append('solo_25_26')
        if src and not cnt['E']: flags.append('sin_entrada')
        if src and not cnt['S']: flags.append('sin_salida')
        if src and not cnt['R']: flags.append('sin_raja')
        if rin is not None and rin < 0.5: flags.append('raja_fuera')
        if code not in polys: flags.append('sin_poligono')
        for f in flags: kpi[f] += 1
        kpi['src_' + str(src)] += 1

        out.append({
            'id': code, 'nm': v(r, 'Nombre'), 'nc': v(r, 'N. Cortes'), 'est': v(r, 'Est'),
            'tch': (round(v(r, 'Toneladas') / v(r, 'Ha'), 1) if v(r, 'Ha') else None),
            'dE': dE, 'dS': dS, 'dP': (round(((dE or 0) + (dS or 0)) / ((dE is not None) + (dS is not None)), 2) if (dE is not None or dS is not None) else None), 'var': v(r, 'Variedad'), 'ha': v(r, 'Ha'), 'tm': v(r, 'Toneladas'),
            'fc': fdate(v(r, 'Fecha de Corte')), 'fr': v(r, 'Frente Cosecha'), 'sem': v(r, 'Semana'),
            'sec': v(r, 'Secuencia de Corte'), 'reg': v(r, 'Region'), 'ten': v(r, 'Tenencia'),
            'mun': v(r, 'Municipio'), 'tc': v(r, 'Tipo de Corte'), 'car': v(r, 'Numero de carretas'),
            'ubi': v(r, 'Ubicación'), 'mul': v(r, 'Mulero'), 'dkm': v(r, 'Dist Km'), 'dkmm': v(r, 'Dist KM Mapeado'),
            'src': src, 'f': feats, 'ref': ref, 'pol': polys.get(code, []),
            'q': {'ke': round(ke, 2), 'ks': round(ks, 2), 'nR': cnt['R'], 'nP': cnt['P'], 'av': cnt['AV'] > 0,
                  'rin': None if rin is None else round(rin, 2)},
            'flags': flags,
        })
    for o in out:
        for k, val in list(o.items()):
            if isinstance(val, float): o[k] = round(val, 3)
    print(len(out), dict(kpi))
    return out, dict(kpi)

if __name__ == '__main__':
    import sys
    o, _ = main(resolver_fuentes(sys.argv[1] if len(sys.argv) > 1 else 'fuentes'))
    json.dump(o, open('data.json', 'w'), ensure_ascii=False, separators=(',', ':'))
