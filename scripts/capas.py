"""Convierte las capas de apoyo del proyecto QField (shapefiles) en un JSON compacto para el visor.

Cada capa se busca por nombre de archivo dentro de la carpeta del proyecto y se describe en
capas_config.json (estilo, radio de búsqueda alrededor del plantío, campos del popup, vínculo por código).
Tipos de capa:
  punto     entidades puntuales (pozos, válvulas, postes…)
  linea     líneas (ríos, red vial)
  poligono  polígonos (límites de quema)
  contorno  nubes de vértices (puntos en orden) convertidas en líneas de contorno. No se arman polígonos:
            en este proyecto los vértices no siempre cierran anillos válidos, pero unidos con corte por
            saltos grandes coinciden con el contorno real (verificado contra Limites_Quemas_P).
"""
import json, os, math, hashlib, unicodedata, datetime as dt, collections
import shapefile
from pyproj import CRS, Transformer
from shapely.geometry import LineString

AQUI = os.path.dirname(os.path.abspath(__file__))
UTM = 'EPSG:32616'
TIPOS = {'punto': 'p', 'linea': 'l', 'poligono': 'a', 'contorno': 'l'}


def nk(s):
    """Normaliza texto para comparar (sin tildes, minúsculas, corrige mojibake UTF-8 leído como latin1)."""
    s = str(s if s is not None else '')
    if 'Ã' in s or 'Â' in s:
        try: s = s.encode('latin1').decode('utf-8')
        except Exception: pass
    return unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower().strip()


def buscar(carpeta, archivo):
    objetivo = archivo.lower() + '.shp'
    hits = [os.path.join(r, f) for r, _, fs in os.walk(carpeta) for f in fs if f.lower() == objetivo]
    return sorted(hits, key=len)[0] if hits else None


def abrir(shp):
    base = shp[:-4]
    enc = 'utf-8'
    if os.path.exists(base + '.cpg'):
        c = open(base + '.cpg', encoding='latin1').read().strip().lower().replace('_', '-')
        enc = {'': 'utf-8', 'utf-8': 'utf-8', '1252': 'cp1252', 'iso-8859-1': 'latin1', 'windows-1252': 'cp1252'}.get(c, c)
    return shapefile.Reader(base, encoding=enc, encodingErrors='replace')


def transformadores(shp):
    prj = shp[:-4] + '.prj'
    crs = CRS.from_wkt(open(prj, encoding='latin1').read()) if os.path.exists(prj) else CRS.from_epsg(4326)
    return Transformer.from_crs(crs, UTM, always_xy=True), Transformer.from_crs(UTM, 'EPSG:4326', always_xy=True)


def valor(v):
    if v is None: return None
    if isinstance(v, bytes): v = v.decode('utf-8', 'replace')
    if isinstance(v, float):
        if math.isnan(v): return None
        return int(v) if v.is_integer() else round(v, 3)
    if isinstance(v, int): return v
    s = str(v).strip()
    return None if s in ('', '-', 'None', 'NULL') else s


def clave5(v):
    v = valor(v)
    if v is None: return None
    try: return str(int(float(v))).zfill(5)
    except Exception: return str(v).zfill(5)[-5:] if str(v).isdigit() else str(v)


def en_zona(lon, lat):
    return -89.5 < lon < -85 and 10.5 < lat < 15.5


class Tabla:
    """Filas únicas (A) + vínculo (K) + categoría (C) con tabla de cadenas (S) por capa."""
    def __init__(self):
        self.S, self._s = [], {}
        self.A, self._a = [], {}
        self.K, self.C = [], []

    def s(self, txt):
        if txt not in self._s: self._s[txt] = len(self.S); self.S.append(txt)
        return self._s[txt]

    def fila(self, vals, link, cat):
        enc = tuple((self.s(str(v)) if v is not None else -1) for v in vals)   # todo valor como texto; -1 = vacío
        key = (enc, link, cat)
        if key not in self._a:
            self._a[key] = len(self.A); self.A.append(list(enc))
            self.K.append(self.s(link) if link else -1)
            self.C.append(self.s(cat) if cat else -1)
        return self._a[key]


def delta(coords_ll):
    """[(lon,lat)…] → lista plana de enteros (microgrados) con deltas."""
    out, px, py = [], 0, 0
    for lon, lat in coords_ll:
        x, y = round(lon * 1e6), round(lat * 1e6)
        out += [x - px, y - py]; px, py = x, y
    return out


def construir_capa(cfg, shp, gap_m):
    rd = abrir(shp)
    real = {nk(f[0]): f[0] for f in rd.fields[1:]}
    to_utm, to_ll = transformadores(shp)
    tipo = cfg['tipo']
    popup = cfg.get('popup', [])
    campos_popup = [p[0] for p in popup]
    vinc = cfg.get('vinculo'); cat = cfg.get('categoria'); exc = cfg.get('excluir')
    agr = [nk(x) for x in cfg.get('agrupar', [])]
    orden = cfg.get('orden')
    necesarios = set(campos_popup) | ({vinc} if vinc else set()) | ({cat['campo']} if cat else set()) | ({exc['campo']} if exc else set()) | set(agr) | ({orden} if orden else set())
    faltan = [c for c in necesarios if nk(c) not in real]
    nombres = [real[nk(c)] for c in necesarios if nk(c) in real]
    stats = collections.Counter()
    T = Tabla()
    excl_set = {nk(x) for x in (exc['valores'] if exc else [])}

    def get(rec, campo):
        r = real.get(nk(campo))
        return valor(rec[r]) if r else None

    def fila_de(rec):
        vals = [get(rec, c) for c in campos_popup]
        link = clave5(get(rec, vinc)) if vinc else None
        c = get(rec, cat['campo']) if cat else None
        return T.fila(vals, link, str(c) if c is not None else None)

    feats_p, feats_g = [], []        # puntos: (lat,lon,fila) | líneas: (coords_ll,fila)
    simp = float(cfg.get('simplificar_m', 1.5))

    if tipo == 'punto':
        xs, ys, filas = [], [], []
        for sr in rd.iterShapeRecords(fields=nombres):
            stats['leidos'] += 1
            if not sr.shape.points: stats['sin geometria'] += 1; continue
            if exc and nk(get(sr.record, exc['campo'])) in excl_set: stats['excluidos'] += 1; continue
            x, y = sr.shape.points[0][:2]
            if not x or not y: stats['coordenada 0,0'] += 1; continue
            xs.append(x); ys.append(y); filas.append(fila_de(sr.record))
        ux, uy = to_utm.transform(xs, ys); lon, lat = to_ll.transform(ux, uy)
        for lo, la, f in zip(lon, lat, filas):
            if en_zona(lo, la): feats_p.append((la, lo, f))
            else: stats['fuera de zona'] += 1
    elif tipo in ('linea', 'poligono'):   # cada parte (anillo exterior o interior) es una entidad
        for sr in rd.iterShapeRecords(fields=nombres):
            stats['leidos'] += 1
            sh = sr.shape
            if not sh.points: stats['sin geometria'] += 1; continue
            fila = fila_de(sr.record)
            partes = list(sh.parts) + [len(sh.points)]
            for a, b in zip(partes, partes[1:]):
                pts = sh.points[a:b]
                if len(pts) < 2: continue
                ux, uy = to_utm.transform([p[0] for p in pts], [p[1] for p in pts])
                ln = LineString(list(zip(ux, uy)))
                s = ln.simplify(simp) if simp > 0 else ln
                cs = list(s.coords)
                if len(cs) < (4 if tipo == 'poligono' else 2): stats['partes degeneradas'] += 1; continue
                lo, la = to_ll.transform([c[0] for c in cs], [c[1] for c in cs])
                feats_g.append((list(zip(lo, la)), fila))
    else:  # contorno: puntos en orden → líneas
        xs, ys, recs = [], [], []
        for i, sr in enumerate(rd.iterShapeRecords(fields=nombres)):
            stats['leidos'] += 1
            if not sr.shape.points: stats['sin geometria'] += 1; continue
            x, y = sr.shape.points[0][:2]
            if not x or not y: stats['coordenada 0,0'] += 1; continue
            xs.append(x); ys.append(y)
            o = get(sr.record, orden) if orden else 0
            recs.append((tuple(str(get(sr.record, g)) for g in agr), o if isinstance(o, (int, float)) else 0, i, fila_de(sr.record)))
        ux, uy = to_utm.transform(xs, ys)
        grupos = collections.OrderedDict()
        for (k, o, i, fila), x, y in zip(recs, ux, uy): grupos.setdefault(k, []).append((o, i, x, y, fila))
        for k, v in grupos.items():
            v.sort(key=lambda t: (t[0], t[1]))
            fila = v[0][4]; cur = []
            def cerrar():
                if len(cur) >= 2:
                    s = list(LineString(cur).simplify(simp).coords) if simp > 0 else cur
                    if len(s) >= 2:
                        lo, la = to_ll.transform([c[0] for c in s], [c[1] for c in s])
                        feats_g.append((list(zip(lo, la)), fila))
            for _, _, x, y, _f in v:
                if cur and math.dist((x, y), cur[-1]) < 0.3: continue            # duplicado consecutivo
                if cur and math.dist((x, y), cur[-1]) > gap_m: cerrar(); cur = []  # salto grande: nuevo tramo
                cur.append((x, y))
            cerrar()
        stats['grupos'] = len(grupos)

    out = {'id': cfg['id'], 'nombre': cfg['nombre'], 'tipo': TIPOS[tipo], 'estilo': cfg['estilo'], 'radio': cfg.get('radio', 150),
           'defecto': bool(cfg.get('defecto', False)), 'vinculo': bool(vinc), 'popup': [p[1] for p in popup],
           'titulo': next((i for i, p in enumerate(popup) if nk(p[0]) == nk(cfg.get('titulo', ''))), -1)}
    if cat:
        colores = {nk(k): v for k, v in cat['colores'].items()}
        usadas = set(T.C)
        out['cat'] = {'otro': cat.get('otro', '#d1d5db'),
                      'map': {str(i): colores[nk(t)] for i, t in enumerate(T.S) if i in usadas and nk(t) in colores}}
    if feats_p:
        feats_p.sort(key=lambda t: (round(t[0] * 100), t[1]))
        out['g'] = delta([(lo, la) for la, lo, _ in feats_p]); out['r'] = [f for _, _, f in feats_p]; n = len(feats_p)
    else:
        feats_g.sort(key=lambda t: (round(t[0][0][1] * 100), t[0][0][0]))
        out['l'] = [delta(c) for c, _ in feats_g]; out['r'] = [f for _, f in feats_g]; n = len(feats_g)
        stats['vertices'] = sum(len(c) for c, _ in feats_g)
    out.update({'n': n, 'S': T.S, 'A': T.A, 'K': T.K, 'C': T.C})
    if not cat: out.pop('C')
    if not any(k >= 0 for k in T.K): out.pop('K')
    return out, dict(stats), faltan


def construir(carpeta, cfg_path=None, log=print):
    cfg = json.load(open(cfg_path or os.path.join(AQUI, 'capas_config.json'), encoding='utf-8'))
    capas, fuentes, ausentes = [], {}, []
    for c in cfg['capas']:
        shp = buscar(carpeta, c['archivo'])
        if not shp:
            ausentes.append(c['archivo']); log(f"  [omitida] {c['nombre']}: no se encontró {c['archivo']}.shp"); continue
        o, st, faltan = construir_capa(c, shp, cfg.get('gap_contorno_m', 40))
        capas.append(o); fuentes[c['id']] = os.path.basename(shp)
        extra = ('  · campos no encontrados: ' + ', '.join(faltan)) if faltan else ''
        log(f"  {c['nombre']:<34} {o['n']:>7,} entidades {json.dumps(st, ensure_ascii=False)}{extra}")
    if not capas: raise SystemExit(f'No se encontró ninguna capa de apoyo en {carpeta}')
    doc = {'generado': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'), 'fuentes': fuentes, 'omitidas': ausentes, 'capas': capas}
    # la versión depende solo del contenido (no de la fecha de generación): mismos datos = misma versión = sin descargas de más
    cuerpo = json.dumps({k: v for k, v in doc.items() if k != 'generado'}, ensure_ascii=False, separators=(',', ':'))
    doc['version'] = hashlib.sha256(cuerpo.encode()).hexdigest()[:12]
    return doc


def escribir(doc, salida):
    os.makedirs(salida, exist_ok=True)
    txt = json.dumps(doc, ensure_ascii=False, separators=(',', ':'))
    p = os.path.join(salida, 'capas.json')
    open(p, 'w', encoding='utf-8').write(txt)
    return p, len(txt.encode())


def resumen_manifest(doc, nbytes):
    return {'version': doc['version'], 'bytes': nbytes, 'generado': doc['generado'],
            'capas': {c['id']: c['n'] for c in doc['capas']}, 'fuentes': doc['fuentes']}
