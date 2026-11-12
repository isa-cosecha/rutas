/* Herramienta de administrador: convierte las capas del proyecto QField (shapefiles) a capas.json dentro del navegador.
 * Misma lógica que scripts/capas.py. Todo se procesa en este equipo; los archivos no se suben a ningún servidor.
 * Lee .shp/.dbf/.prj/.cpg directamente (DBF por bloques, para que la capa de quemas de 100+ MB no agote la memoria). */
const AdminCapas = (() => {
  const KLAT = 111320, KLON = 111320 * Math.cos(12.5 * Math.PI / 180), LAT0 = 12.5, LON0 = -87;
  const TIPOS = {punto: 'p', linea: 'l', poligono: 'a', contorno: 'l'};
  const sleep = () => new Promise(r => setTimeout(r, 0));

  // ---------- texto y valores ----------
  function nk(s) {
    s = String(s == null ? '' : s);
    if (/[ÃÂ]/.test(s)) { try { s = new TextDecoder('utf-8', {fatal: true}).decode(Uint8Array.from(s, ch => ch.charCodeAt(0))); } catch {} }
    return s.normalize('NFKD').replace(/[^\x00-\x7F]/g, '').toLowerCase().trim();
  }
  function valor(v) {
    if (v == null) return null;
    if (typeof v === 'number') { if (!isFinite(v)) return null; return Number.isInteger(v) ? v : Math.round(v * 1000) / 1000; }
    const s = String(v).trim();
    return (s === '' || s === '-' || s === 'None' || s === 'NULL') ? null : s;
  }
  function clave5(v) {
    v = valor(v); if (v == null) return null;
    const n = Number(v);
    if (!isNaN(n) && String(v).trim() !== '') return String(Math.trunc(n)).padStart(5, '0');
    return /^\d+$/.test(String(v)) ? String(v).padStart(5, '0').slice(-5) : String(v);
  }
  const enZona = (lo, la) => lo > -89.5 && lo < -85 && la > 10.5 && la < 15.5;

  // ---------- proyección: UTM / Transverse Mercator → WGS84 (grados) ----------
  function crearProyeccion(prj, ejemplo) {
    if (!prj) {
      if (ejemplo && Math.abs(ejemplo[0]) <= 180 && Math.abs(ejemplo[1]) <= 90) return {nombre: 'sin .prj (grados)', proyectada: false, inv: (x, y) => [x, y], aviso: 'Sin archivo .prj: se asumió WGS84 en grados.'};
      throw new Error('sin archivo .prj y las coordenadas no son grados: no se puede reproyectar');
    }
    const num = n => { const m = prj.match(new RegExp('PARAMETER\\["' + n + '",\\s*(-?[\\d.eE+-]+)', 'i')); return m ? parseFloat(m[1]) : null; };
    const datum = (prj.match(/DATUM\["([^"]+)"/i) || [])[1] || '';
    const wgs = /wgs[_ ]?(19)?84|nad[_ ]?(19)?83|sirgas|itrf/i.test(datum + ' ' + prj.slice(0, 120));
    const aviso = wgs ? null : `Datum "${datum}" distinto de WGS84: la posición puede variar algunos metros.`;
    if (!/PROJCS/i.test(prj)) return {nombre: 'WGS84 (grados)', proyectada: false, inv: (x, y) => [x, y], aviso};
    if (!/Transverse[_ ]Mercator/i.test(prj)) throw new Error('proyección no soportada (solo UTM / Transverse Mercator): ' + ((prj.match(/PROJCS\["([^"]+)"/i) || [])[1] || 'desconocida'));
    if (!/UNIT\["Met(er|re)/i.test(prj.slice(prj.search(/PROJECTION/i)))) throw new Error('las unidades de la proyección no son metros');
    const sph = prj.match(/SPHEROID\["[^"]*",\s*([\d.]+)\s*,\s*([\d.]+)/i);
    const a = sph ? parseFloat(sph[1]) : 6378137, f = 1 / (sph ? parseFloat(sph[2]) : 298.257223563);
    const lon0 = num('Central_Meridian'), k0 = num('Scale_Factor') ?? 0.9996, fe = num('False_Easting') ?? 500000, fn = num('False_Northing') ?? 0, lat0 = num('Latitude_Of_Origin') ?? 0;
    if (lon0 == null) throw new Error('la proyección no indica Central_Meridian');
    const e2 = f * (2 - f), ep2 = e2 / (1 - e2), r = Math.PI / 180;
    const M = p => a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * p - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * p) + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * p) - (35 * e2 ** 3 / 3072) * Math.sin(6 * p));
    const M0 = M(lat0 * r), e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    const inv = (E, N) => {
      const mu = (M0 + (N - fn) / k0) / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256));
      const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu) + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
      const s = Math.sin(p1), c = Math.cos(p1), t = Math.tan(p1), C1 = ep2 * c * c, T1 = t * t, N1 = a / Math.sqrt(1 - e2 * s * s), R1 = a * (1 - e2) / Math.pow(1 - e2 * s * s, 1.5), D = (E - fe) / (N1 * k0);
      const lat = p1 - (N1 * t / R1) * (D ** 2 / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * ep2) * D ** 4 / 24 + (61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * ep2 - 3 * C1 ** 2) * D ** 6 / 720);
      const lon = lon0 * r + (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * ep2 + 24 * T1 ** 2) * D ** 5 / 120) / c;
      return [lon / r, lat / r];
    };
    return {nombre: (prj.match(/PROJCS\["([^"]+)"/i) || [])[1] || 'Transverse Mercator', proyectada: true, inv, aviso};
  }

  // ---------- lectura de shapefile ----------
  function leerShp(buf) {
    const dv = new DataView(buf), n = buf.byteLength, shapes = []; let off = 100;
    while (off + 8 <= n) {
      const clen = dv.getInt32(off + 4) * 2; off += 8; const base = off, t = dv.getInt32(off, true); let sh = null;
      if (t === 1 || t === 11 || t === 21) sh = {k: 'p', x: dv.getFloat64(off + 4, true), y: dv.getFloat64(off + 12, true)};
      else if (t === 8 || t === 18 || t === 28) { if (dv.getInt32(off + 36, true) > 0) sh = {k: 'p', x: dv.getFloat64(off + 40, true), y: dv.getFloat64(off + 48, true)}; }
      else if (t === 3 || t === 13 || t === 23 || t === 5 || t === 15 || t === 25) {
        const np = dv.getInt32(off + 36, true), npt = dv.getInt32(off + 40, true), parts = new Int32Array(np);
        for (let i = 0; i < np; i++) parts[i] = dv.getInt32(off + 44 + 4 * i, true);
        const p0 = off + 44 + 4 * np, pts = new Float64Array(npt * 2);
        for (let i = 0; i < npt; i++) { pts[2 * i] = dv.getFloat64(p0 + 16 * i, true); pts[2 * i + 1] = dv.getFloat64(p0 + 16 * i + 8, true); }
        sh = {k: 'm', parts, pts};
      }
      shapes.push(sh); off = base + clen;
    }
    return shapes;
  }
  const encDe = cpg => { const c = String(cpg || '').trim().toLowerCase().replace(/_/g, '-'); return ({'': 'utf-8', 'utf-8': 'utf-8', '1252': 'windows-1252', 'windows-1252': 'windows-1252', 'iso-8859-1': 'iso-8859-1', 'latin1': 'iso-8859-1'})[c] || 'utf-8'; };
  async function cabeceraDbf(file, enc) {
    const dv = new DataView(await file.slice(0, 32).arrayBuffer()), n = dv.getUint32(4, true), hl = dv.getUint16(8, true), rl = dv.getUint16(10, true);
    const fb = new Uint8Array(await file.slice(32, hl).arrayBuffer()), dec = new TextDecoder(enc), campos = []; let off = 1;
    for (let i = 0; i * 32 < fb.length && fb[i * 32] !== 0x0D; i++) {
      const nm = dec.decode(fb.subarray(i * 32, i * 32 + 11)).split('\0')[0].trim(), len = fb[i * 32 + 16];
      campos.push({nombre: nm, nk: nk(nm), tipo: String.fromCharCode(fb[i * 32 + 11]), len, off}); off += len;
    }
    return {n, hl, rl, campos, dec: new TextDecoder(enc)};
  }
  /** Recorre el DBF por bloques de ~8 MB y entrega, por registro, un objeto {campo normalizado: valor} sólo con los campos pedidos. */
  async function* registros(file, cab, pedidos) {
    const cr = Math.max(1, Math.floor(8e6 / cab.rl)), sel = cab.campos.filter(c => pedidos.has(c.nk));
    for (let i = 0; i < cab.n; i += cr) {
      const cnt = Math.min(cr, cab.n - i), buf = new Uint8Array(await file.slice(cab.hl + i * cab.rl, cab.hl + (i + cnt) * cab.rl).arrayBuffer());
      for (let j = 0; j < cnt; j++) {
        const o = j * cab.rl; if (buf[o] === 0x2A) { yield [i + j, null]; continue; }       // registro borrado
        const rec = {};
        for (const c of sel) {
          const raw = cab.dec.decode(buf.subarray(o + c.off, o + c.off + c.len)).replace(/\0/g, '').trim();
          rec[c.nk] = (c.tipo === 'N' || c.tipo === 'F') ? (raw === '' || isNaN(parseFloat(raw)) ? null : parseFloat(raw)) : raw;
        }
        yield [i + j, rec];
      }
      await sleep();
    }
  }

  // ---------- geometría en metros locales ----------
  const mx = lo => (lo - LON0) * KLON, my = la => (la - LAT0) * KLAT;
  function simplificar(xs, ys, tol) {             // Douglas-Peucker iterativo → índices conservados
    const n = xs.length, keep = new Uint8Array(n);
    if (n < 3 || tol <= 0) return Array.from({length: n}, (_, i) => i);
    keep[0] = keep[n - 1] = 1; const pila = [[0, n - 1]];
    while (pila.length) {
      const [a, b] = pila.pop(); let dmax = 0, idx = -1; const ax = xs[a], ay = ys[a], dx = xs[b] - ax, dy = ys[b] - ay, l2 = dx * dx + dy * dy;
      for (let i = a + 1; i < b; i++) {
        let d; if (!l2) d = Math.hypot(xs[i] - ax, ys[i] - ay);
        else { const t = Math.max(0, Math.min(1, ((xs[i] - ax) * dx + (ys[i] - ay) * dy) / l2)); d = Math.hypot(xs[i] - (ax + t * dx), ys[i] - (ay + t * dy)); }
        if (d > dmax) { dmax = d; idx = i; }
      }
      if (dmax > tol) { keep[idx] = 1; pila.push([a, idx], [idx, b]); }
    }
    const out = []; for (let i = 0; i < n; i++) if (keep[i]) out.push(i); return out;
  }
  function delta(ll) { const out = []; let px = 0, py = 0; for (const [lo, la] of ll) { const x = Math.round(lo * 1e6), y = Math.round(la * 1e6); out.push(x - px, y - py); px = x; py = y; } return out; }

  class Tabla {
    constructor() { this.S = []; this._s = new Map(); this.A = []; this._a = new Map(); this.K = []; this.C = []; }
    s(t) { if (!this._s.has(t)) { this._s.set(t, this.S.length); this.S.push(t); } return this._s.get(t); }
    fila(vals, link, cat) {
      const enc = vals.map(v => v != null ? this.s(String(v)) : -1), key = JSON.stringify([enc, link, cat]);
      if (!this._a.has(key)) { this._a.set(key, this.A.length); this.A.push(enc); this.K.push(link ? this.s(link) : -1); this.C.push(cat != null ? this.s(cat) : -1); }
      return this._a.get(key);
    }
  }

  // ---------- conversión de una capa (misma lógica que scripts/capas.py) ----------
  async function convertirCapa(cfg, arch, gapM, progreso) {
    const shapes = leerShp(await arch.shp.arrayBuffer());
    const enc = encDe(arch.cpg ? await arch.cpg.text() : ''), cab = await cabeceraDbf(arch.dbf, enc);
    const prj = arch.prj ? await arch.prj.text() : '';
    const primero = shapes.find(s => s);
    const ej = primero ? (primero.k === 'p' ? [primero.x, primero.y] : [primero.pts[0], primero.pts[1]]) : null;
    const proy = crearProyeccion(prj, ej), tipo = cfg.tipo, popup = cfg.popup || [], campos = popup.map(p => p[0]);
    const vinc = cfg.vinculo, cat = cfg.categoria, exc = cfg.excluir, agr = (cfg.agrupar || []).map(nk), orden = cfg.orden;
    const necesarios = new Set([...campos, ...(vinc ? [vinc] : []), ...(cat ? [cat.campo] : []), ...(exc ? [exc.campo] : []), ...agr, ...(orden ? [orden] : [])].map(nk));
    const existentes = new Set(cab.campos.map(c => c.nk)), faltan = [...necesarios].filter(c => !existentes.has(c));
    const stats = {}, inc = (k, n = 1) => { stats[k] = (stats[k] || 0) + n; };
    const T = new Tabla(), excl = new Set(((exc && exc.valores) || []).map(nk)), simp = cfg.simplificar_m ?? 1.5;
    // Distancias y simplificación en metros: la cuadrícula del propio archivo si es proyectado (igual que el script de Python); si son grados, metros locales.
    const plano = proy.proyectada ? (x, y) => [x, y] : (x, y) => [mx(x), my(y)], aLL = proy.proyectada ? (x, y) => proy.inv(x, y) : (x, y) => [x, y];
    const get = (rec, campo) => { const v = rec[nk(campo)]; return v === undefined ? null : valor(v); };
    const fila = rec => T.fila(campos.map(c => get(rec, c)), vinc ? clave5(get(rec, vinc)) : null, cat ? (get(rec, cat.campo) != null ? String(get(rec, cat.campo)) : null) : null);
    const featsP = [], featsG = []; let k = 0;
    const grupos = new Map();
    for await (const [i, rec] of registros(arch.dbf, cab, necesarios)) {
      if (!rec) continue; inc('leidos'); const sh = shapes[i];
      if (k++ % 4000 === 0) progreso && progreso(i / cab.n);
      if (!sh) { inc('sin geometria'); continue; }
      if (tipo === 'punto') {
        if (exc && excl.has(nk(get(rec, exc.campo)))) { inc('excluidos'); continue; }
        if (!sh.x || !sh.y) { inc('coordenada 0,0'); continue; }
        const [lo, la] = proy.inv(sh.x, sh.y);
        if (enZona(lo, la)) featsP.push([la, lo, fila(rec)]); else inc('fuera de zona');
      } else if (tipo === 'linea' || tipo === 'poligono') {
        const fl = fila(rec), partes = [...sh.parts, sh.pts.length / 2], minimo = tipo === 'poligono' ? 4 : 2;
        for (let p = 0; p < partes.length - 1; p++) {
          const raw = []; for (let q = partes[p]; q < partes[p + 1]; q++) raw.push([sh.pts[2 * q], sh.pts[2 * q + 1]]);
          if (raw.length < 2) continue;
          const pl = raw.map(r => plano(r[0], r[1]));
          let idx = simp > 0 ? simplificar(pl.map(r => r[0]), pl.map(r => r[1]), simp) : raw.map((_, i) => i);
          if (idx.length < minimo && raw.length >= minimo) idx = raw.map((_, i) => i);   // anillo diminuto: se conserva sin simplificar
          if (idx.length < minimo) { inc('partes degeneradas'); continue; }
          featsG.push([idx.map(i => aLL(raw[i][0], raw[i][1])), fl]);
        }
      } else {   // contorno: puntos en orden → líneas
        if (!sh.x || !sh.y) { inc('coordenada 0,0'); continue; }
        const [px, py] = plano(sh.x, sh.y), key = JSON.stringify(agr.map(g => String(get(rec, g)))), o = orden ? get(rec, orden) : 0;
        if (!grupos.has(key)) grupos.set(key, []);
        grupos.get(key).push([typeof o === 'number' ? o : 0, i, px, py, fila(rec), sh.x, sh.y]);
      }
    }
    if (tipo === 'contorno') {
      for (const v of grupos.values()) {
        v.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const fl = v[0][4]; let cur = [];
        const cerrar = () => { if (cur.length >= 2) { const idx = simp > 0 ? simplificar(cur.map(c => c[0]), cur.map(c => c[1]), simp) : cur.map((_, i) => i); if (idx.length >= 2) featsG.push([idx.map(i => aLL(cur[i][2], cur[i][3])), fl]); } };
        for (const [, , px, py, , x, y] of v) {
          if (cur.length) { const u = cur[cur.length - 1], d = Math.hypot(px - u[0], py - u[1]); if (d < 0.3) continue; if (d > gapM) { cerrar(); cur = []; } }
          cur.push([px, py, x, y]);
        }
        cerrar();
      }
      stats.grupos = grupos.size;
    }
    const out = {id: cfg.id, nombre: cfg.nombre, tipo: TIPOS[tipo], estilo: cfg.estilo, radio: cfg.radio ?? 150, defecto: !!cfg.defecto, vinculo: !!vinc, popup: popup.map(p => p[1]),
      titulo: popup.findIndex(p => nk(p[0]) === nk(cfg.titulo || ''))};
    if (cfg.sobre) out.sobre = {tol: Number(cfg.sobre.tolerancia_m ?? 5), min: Number(cfg.sobre.minimo ?? 0.5)};   // solo lo que cae sobre el plantío
    if (cat) {
      const colores = {}, usadas = new Set(T.C), map = {};
      Object.entries(cat.colores).forEach(([kk, vv]) => { colores[nk(kk)] = vv; });
      T.S.forEach((t, i) => { if (usadas.has(i) && colores[nk(t)]) map[String(i)] = colores[nk(t)]; });
      out.cat = {otro: cat.otro || '#d1d5db', map};
    }
    let n;
    if (featsP.length) { featsP.sort((a, b) => Math.round(a[0] * 100) - Math.round(b[0] * 100) || a[1] - b[1]); out.g = delta(featsP.map(f => [f[1], f[0]])); out.r = featsP.map(f => f[2]); n = featsP.length; }
    else { featsG.sort((a, b) => Math.round(a[0][0][1] * 100) - Math.round(b[0][0][1] * 100) || a[0][0][0] - b[0][0][0]); out.l = featsG.map(f => delta(f[0])); out.r = featsG.map(f => f[1]); n = featsG.length; stats.vertices = featsG.reduce((s, f) => s + f[0].length, 0); }
    Object.assign(out, {n, S: T.S, A: T.A, K: T.K, C: T.C});
    if (!cat) delete out.C; if (!T.K.some(x => x >= 0)) delete out.K;
    return {out, stats, faltan, aviso: proy.aviso, crs: proy.nombre};
  }

  // ---------- localizar archivos dentro de lo que eligió el usuario ----------
  function indexar(files) {
    const mapa = new Map();
    for (const f of files) {
      const ruta = (f.webkitRelativePath || f.name).replace(/\\/g, '/'), m = ruta.match(/^(.*)\.([^./]+)$/); if (!m) continue;
      const clave = m[1].toLowerCase(); if (!mapa.has(clave)) mapa.set(clave, {ruta: m[1], len: ruta.length});
      mapa.get(clave)[m[2].toLowerCase()] = f;
    }
    return mapa;
  }
  function buscar(mapa, archivo) {
    const objetivo = archivo.toLowerCase(), hits = [...mapa.entries()].filter(([k, v]) => v.shp && (k.split('/').pop() === objetivo));
    if (!hits.length) return null;
    const v = hits.sort((a, b) => a[1].len - b[1].len)[0][1];
    return v.dbf ? v : {faltaDbf: true};
  }
  async function hashHex(txt) {
    try { const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt)); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 12); }
    catch { let h = 2166136261; for (let i = 0; i < txt.length; i++) { h ^= txt.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0') + txt.length.toString(16).padStart(4, '0'); }
  }
  async function construir(mapa, cfg, log, progreso) {
    const capas = [], fuentes = {}, omitidas = [], problemas = [], filas = [];
    for (let i = 0; i < cfg.capas.length; i++) {
      const c = cfg.capas[i], arch = buscar(mapa, c.archivo);
      if (!arch || arch.faltaDbf) { omitidas.push(c.archivo); log(`[omitida] ${c.nombre}: ${arch ? 'falta el .dbf de ' : 'no se encontró '}${c.archivo}.shp`); continue; }
      try {
        const r = await convertirCapa(c, arch, cfg.gap_contorno_m ?? 40, p => progreso((i + p) / cfg.capas.length, c.nombre));
        capas.push(r.out); fuentes[c.id] = arch.shp.name;
        const extra = [r.faltan.length ? 'campos no encontrados: ' + r.faltan.join(', ') : '', r.aviso || ''].filter(Boolean).join(' · ');
        log(`${c.nombre.padEnd(34)} ${String(r.out.n).padStart(7)} entidades ${JSON.stringify(r.stats)}${extra ? '  · ' + extra : ''}`);
        filas.push({id: c.id, nombre: c.nombre, n: r.out.n, vertices: r.stats.vertices, stats: r.stats, nota: extra});
      } catch (e) { problemas.push(c.nombre); log(`[error] ${c.nombre}: ${e.message}`); }
      progreso((i + 1) / cfg.capas.length, c.nombre); await sleep();
    }
    if (!capas.length) throw new Error('No se encontró ninguna capa de apoyo en lo que seleccionaste.');
    const doc = {generado: new Date().toISOString().slice(0, 19) + '+00:00', fuentes, omitidas, capas};
    const {generado: _g, ...contenido} = doc; doc.version = await hashHex(JSON.stringify(contenido));   // depende solo del contenido
    return {doc, filas, omitidas, problemas};
  }

  // ---------- publicación en GitHub (API de contenidos) ----------
  function destinoGitHub(dataUrl) {
    const m = String(dataUrl || '').match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+?)\/?$/);
    return m ? {dueno: m[1], repo: m[2], rama: m[3], ruta: m[4] + '/capas.json'} : null;
  }
  const aBase64 = txt => { const b = new TextEncoder().encode(txt); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
  async function publicar(txt, token, d, mensaje) {
    const api = `https://api.github.com/repos/${d.dueno}/${d.repo}/contents/${d.ruta}`, h = {Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json'};
    const g = await fetch(`${api}?ref=${encodeURIComponent(d.rama)}`, {headers: h}); let sha;
    if (g.ok) sha = (await g.json()).sha;
    else if (g.status === 401 || g.status === 403) throw new Error('GitHub rechazó el token (sin permiso de lectura/escritura sobre este repositorio).');
    else if (g.status !== 404) throw new Error('GitHub respondió ' + g.status + ' al consultar el archivo actual.');
    const p = await fetch(api, {method: 'PUT', headers: {...h, 'Content-Type': 'application/json'}, body: JSON.stringify({message: mensaje, content: aBase64(txt), branch: d.rama, ...(sha ? {sha} : {})})});
    if (p.status === 401 || p.status === 403) throw new Error('GitHub rechazó la escritura: el token necesita permiso "Contents: Read and write" sobre este repositorio.');
    if (!p.ok) throw new Error('GitHub respondió ' + p.status + ' al guardar: ' + (await p.text()).slice(0, 160));
    return p.json();
  }

  return {nk, valor, clave5, crearProyeccion, leerShp, convertirCapa, indexar, buscar, construir, destinoGitHub, publicar, aBase64, simplificar};
})();

/* ---------- interfaz del diálogo (sólo administradores) ---------- */
function initAdmin() {
  const $ = id => document.getElementById(id), A = App;
  const esAdmin = () => A.auth.puede('capas_admin');
  const fmtMB = n => (n / 1e6).toFixed(n > 1e7 ? 0 : 1) + ' MB';
  let cfgCapas = null, mapa = null, res = null, texto = null;
  try { cfgCapas = JSON.parse(document.getElementById('capasCfg').textContent); } catch {}
  const log = t => { const el = $('admLog'); el.textContent += t + '\n'; el.scrollTop = el.scrollHeight; };

  function abrir() {
    if (!esAdmin()) { UI.toast('Esta herramienta es solo para administradores.'); return; }
    if (!cfgCapas) { UI.toast('Este visor no incluye la configuración de capas (capas_config.json).'); return; }
    mapa = res = texto = null;
    $('admFound').innerHTML = ''; $('admLog').textContent = ''; $('admBar').style.width = '0'; $('admGo').disabled = true; $('admOut').hidden = true; $('admPub').hidden = true;
    $('admDlg').showModal();
  }
  $('cfgAdm').onclick = e => { e.preventDefault(); $('cfgDlg').close(); abrir(); };
  $('admClose').onclick = e => { e.preventDefault(); $('admDlg').close(); };

  async function elegido(files) {
    if (!esAdmin()) return;
    mapa = AdminCapas.indexar([...files]); res = texto = null; $('admOut').hidden = true; $('admLog').textContent = '';
    let html = '<table class="admt"><tr><th>Capa</th><th>Archivo</th><th>Estado</th></tr>', hay = 0;
    for (const c of cfgCapas.capas) {
      const a = AdminCapas.buscar(mapa, c.archivo);
      if (a && !a.faltaDbf) { hay++; let crs = '';
        try { const p = a.prj ? await a.prj.text() : ''; crs = AdminCapas.crearProyeccion(p, [-87, 12]).nombre; } catch (e) { crs = '⚠ ' + e.message; }
        html += `<tr><td>${A.esc(c.nombre)}</td><td>${A.esc(c.archivo)}.shp · ${fmtMB((a.shp.size || 0) + (a.dbf.size || 0))}</td><td class="ok">✓ ${A.esc(crs)}</td></tr>`;
      } else html += `<tr><td>${A.esc(c.nombre)}</td><td>${A.esc(c.archivo)}.shp</td><td class="no">${a ? '✗ falta el .dbf' : '✗ no encontrada'}</td></tr>`;
    }
    $('admFound').innerHTML = `<div class="admsub">${files.length} archivos leídos · ${hay} de ${cfgCapas.capas.length} capas encontradas</div>` + html + '</table>';
    $('admGo').disabled = hay === 0;
  }
  $('admDir').onchange = e => elegido(e.target.files); $('admFiles').onchange = e => elegido(e.target.files);

  $('admGo').onclick = async e => {
    e.preventDefault(); if (!mapa || !esAdmin()) return;
    const go = $('admGo'); go.disabled = true; $('admLog').textContent = ''; $('admOut').hidden = true; const t0 = performance.now();
    try {
      const r = await AdminCapas.construir(mapa, cfgCapas, log, (p, nom) => { $('admBar').style.width = Math.round(p * 100) + '%'; $('admEstado').textContent = 'Procesando: ' + nom; });
      res = r; texto = JSON.stringify(r.doc); $('admBar').style.width = '100%';
      $('admEstado').textContent = `Listo en ${((performance.now() - t0) / 1000).toFixed(0)} s`;
      const actual = new Map((A.CAPS || []).map(c => [c.id, c.n]));
      let tb = '<table class="admt"><tr><th>Capa</th><th>Entidades</th><th>Antes</th><th>Cambio</th></tr>';
      for (const f of r.filas) { const a = actual.get(f.id), d = a == null ? 'nueva' : (f.n - a === 0 ? '=' : (f.n - a > 0 ? '+' : '') + (f.n - a)); tb += `<tr><td>${A.esc(f.nombre)}</td><td>${f.n.toLocaleString('es-NI')}</td><td>${a == null ? '—' : a.toLocaleString('es-NI')}</td><td>${d}</td></tr>`; }
      tb += '</table>';
      const avisos = [r.omitidas.length ? `Sin procesar (no encontradas): ${r.omitidas.join(', ')}.` : '', r.problemas.length ? `Con error: ${r.problemas.join(', ')} (ver detalle arriba).` : ''].filter(Boolean);
      $('admRes').innerHTML = `<div class="admsub">Versión <b>${r.doc.version}</b> · ${fmtMB(new Blob([texto]).size)} · ${r.doc.capas.length} capas</div>` + tb + avisos.map(x => `<div class="warn">${A.esc(x)} Si publicas así, esas capas desaparecerán del visor.</div>`).join('');
      $('admOut').hidden = false;
      const d = AdminCapas.destinoGitHub(A.cfg.data);
      $('admPubInfo').textContent = d ? `Destino: ${d.dueno}/${d.repo} (rama ${d.rama}) → ${d.ruta}` : 'No se pudo deducir el repositorio a partir de la URL de datos configurada.';
      $('admPubGo').disabled = !d;
    } catch (err) { log('[error] ' + err.message); $('admEstado').textContent = 'No se pudo convertir'; }
    finally { go.disabled = false; }
  };

  $('admPrev').onclick = e => { e.preventDefault(); if (!res) return;
    A.setCapas(JSON.parse(texto)); $('admDlg').close(); UI.toast('Vista previa cargada en este equipo (no está publicada). Recarga la página para volver a la versión publicada.'); };
  $('admDown').onclick = e => { e.preventDefault(); if (!texto) return;
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([texto], {type: 'application/json'})); a.download = 'capas.json';
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800); };
  $('admPubShow').onclick = e => { e.preventDefault(); $('admPub').hidden = !$('admPub').hidden; };
  $('admPubGo').onclick = async e => {
    e.preventDefault(); if (!texto || !esAdmin()) return;
    const tk = $('admTok').value.trim(), d = AdminCapas.destinoGitHub(A.cfg.data), msg = $('admPubMsg');
    if (!tk) { msg.textContent = 'Pega el token de GitHub.'; return; }
    if ((res.omitidas.length || res.problemas.length) && !confirm('Algunas capas no se procesaron y desaparecerán del visor al publicar. ¿Publicar de todos modos?')) return;
    msg.textContent = 'Publicando…'; $('admPubGo').disabled = true;
    try {
      await AdminCapas.publicar(texto, tk, d, `Capas de apoyo ${res.doc.version} (${A.auth.sess.nombre})`);
      $('admTok').value = ''; msg.textContent = 'Publicado. En 2 a 3 minutos el workflow actualiza el manifiesto y los visores descargan las capas nuevas al abrirse.';
    } catch (err) { msg.textContent = err.message.includes('Failed to fetch') ? 'No se pudo conectar con GitHub (¿red o proxy de la empresa?). Usa "Descargar capas.json" y súbelo a data/ desde la web de GitHub.' : err.message; }
    finally { $('admPubGo').disabled = false; }
  };
}
