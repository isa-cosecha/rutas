/* Núcleo compartido: datos, mapa, filtros, CSV, Google Sheets (con cola offline) y GPS. */
const CONFIG = /*__CONFIG__*/{url:'',data:''};
/* Íconos de las capas de apoyo: réplica de los "Marcador SVG" del proyecto QGIS (válvula = cruz azul con rombo; poste = torre de alta tensión),
 * con halo blanco para que se vean sobre la imagen satelital. */
const SVG_VALVULA = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">'
  + '<g fill="none" stroke-linecap="round"><path d="M32 3V61M3 32H61" stroke="#fff" stroke-width="10" opacity=".9"/><path d="M32 5V59M5 32H59" stroke="#3a6fc0" stroke-width="4.6"/></g>'
  + '<path d="M32 18 46 32 32 46 18 32Z" fill="#4a90e8" stroke="#fff" stroke-width="6" stroke-linejoin="round" paint-order="stroke"/>'
  + '<path d="M32 18 46 32 32 46 18 32Z" fill="#4a90e8" stroke="#2457a8" stroke-width="2.2" stroke-linejoin="round"/></svg>';
const SVG_POSTE = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">'
  + '<g fill="none" stroke-linecap="round" stroke-linejoin="round">'
  // halo
  + '<g stroke="#fff" opacity=".9"><path d="M32 6 14 58M32 6 50 58" stroke-width="11"/><path d="M3 14Q13 11 29 14M3 21Q13 18 29 21M3 28Q13 25 29 28M35 14Q51 11 61 14M35 21Q51 18 61 21M35 28Q51 25 61 28" stroke-width="5.4"/></g>'
  // cables
  + '<g stroke="#8c7a1c" stroke-width="2.6"><path d="M3 14Q13 11 29 14M3 21Q13 18 29 21M3 28Q13 25 29 28M35 14Q51 11 61 14M35 21Q51 18 61 21M35 28Q51 25 61 28"/></g>'
  // torre: contorno oliva + relleno amarillo + celosía
  + '<path d="M32 6 14 58M32 6 50 58" stroke="#8c7a1c" stroke-width="9"/><path d="M32 6 14 58M32 6 50 58" stroke="#f2cf1d" stroke-width="5"/>'
  + '<g stroke="#8c7a1c" stroke-width="2.4"><path d="M25 26H39M21 40H43M17.5 52H46.5M25 26 43 40M39 26 21 40M21 40 46.5 52M43 40 17.5 52"/></g></g></svg>';

const ICONOS = {valvula: {svg: SVG_VALVULA, size: 22}, poste: {svg: SVG_POSTE, size: 28}};
const ICONO_DE_CAPA = {valvulas: 'valvula', postes: 'poste'};   // si la capa no declara estilo.icono en capas.json
/* Marcador que dibuja una imagen sobre el lienzo de Leaflet (rápido con miles de entidades). Su tamaño sigue el zoom. */
if (typeof L !== 'undefined' && !L.IconMarker) {
  L.IconMarker = L.CircleMarker.extend({
    options: {img: null, size: 24, fill: false, stroke: false},
    _escala() { const z = this._map ? this._map.getZoom() : 18; return z >= 18 ? 1 : z >= 17 ? .9 : z >= 16 ? .72 : z >= 15 ? .56 : z >= 14 ? .46 : .4; },
    _project() { this._radius = this.options.size * this._escala() / 2; L.CircleMarker.prototype._project.call(this); },
    _updatePath() {
      const img = this.options.img, c = this._renderer && this._renderer._ctx;
      if (!c || !img || !img.complete || !img.naturalWidth) return;
      const s = this._radius * 2, p = this._point; c.drawImage(img, p.x - s / 2, p.y - s / 2, s, s);
    }
  });
}
let App;
function createApp(RAW, META, CAPAS) {
App = (() => {
  const G = RAW.G, D = RAW.D, byId = new Map(D.map(o => [o.id, o]));
  const dec = i => { const a = G[i], o = []; let x = 0, y = 0; for (let k = 0; k < a.length; k += 2) { x += a[k]; y += a[k + 1]; o.push([y / 1e6, x / 1e6]); } return o; };
  const CAT = {E:['Ruta de entrada','#22d3ee',5,null],S:['Ruta de salida','#ff4d4d',5,null],ME:['Muleo de entrada','#22d3ee',3,'7 5'],MS:['Muleo de salida','#ff4d4d',3,'7 5'],
    AV:['Muleo de autovolteo','#e040fb',5,null],B:['Bahías / líneas internas','#4f8dff',2.5,null],C:['Cabecereo / conformación','#ffd60a',3,null],O:['Otras líneas','#d9d9d9',2,'2 4']};
  const PCAT = {R:['Apertura de raja','rmk'],P:['Punto de control','pmk'],X:['Riesgo / peligro','xmk'],O:['Referencia vial','pmk']};
  const FLAGS = {sin_mapeo:'Sin mapeo',solo_25_26:'Solo mapeo 25-26',sin_entrada:'Sin ruta de entrada',sin_salida:'Sin ruta de salida',sin_raja:'Sin puntos de raja',
    raja_fuera:'Rajas fuera del polígono',sin_poligono:'Sin polígono en Maestro',no_llega_lote:'Ruta termina a >1 km del lote',no_conecta_ingenio:'Ruta no conecta al ingenio'};
  const ASPECTOS = ['Ruta de entrada','Ruta de salida','Puntos de raja','Muleo / autovolteo','Fecha o secuencia','Frente o equipo','Otro'];
  const vis = Object.fromEntries([...Object.keys(CAT).map(k => ['l' + k, true]), ...Object.keys(PCAT).map(k => ['p' + k, true]), ['ref', false], ['lblHa', true]]);
  // Capas de apoyo (proyecto QField): cada una tiene una clave 'x'+id en la vista del usuario. 'xall' = ver todo el mapa.
  const CAPS = (CAPAS && CAPAS.capas) || [];
  CAPS.forEach(c => { vis['x' + c.id] = !!c.defecto; });
  if (CAPS.length) vis.xall = false;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = (x, d = 1) => x == null || x === '' ? '—' : (typeof x === 'number' ? x.toLocaleString('es-NI', {maximumFractionDigits: d}) : esc(x));
  const strip = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  // ---------- almacenamiento local (try/catch: puede no estar disponible) ----------
  const LS = {get(k, d) { try { const v = localStorage.getItem('rp26_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
              set(k, v) { try { localStorage.setItem('rp26_' + k, JSON.stringify(v)); } catch {} }};
  const cfg = Object.assign({url: CONFIG.url, data: CONFIG.data, gh: ''}, LS.get('cfg', {}));
  delete cfg.token; delete cfg.user;
  if (!cfg.url) cfg.url = CONFIG.url; if (!cfg.data) cfg.data = CONFIG.data;
  let queue = LS.get('queue', []);           // respuestas pendientes de envío
  let local = LS.get('local', {});           // última respuesta enviada desde este dispositivo
  let remote = {};                            // última respuesta por plantío según Google Sheets
  const ev = {};
  const on = (n, f) => (ev[n] = ev[n] || []).push(f), emit = (n, ...a) => (ev[n] || []).forEach(f => f(...a));

  // ---------- geometría auxiliar ----------
  D.forEach(o => {
    o._rings = o.pol.map(p => p.g.map(dec));
    let a = 90, b = 180, c = -90, d = -180, sx = 0, sy = 0, n = 0;
    o._rings.forEach(poly => poly[0].forEach(([y, x]) => { a = Math.min(a, y); c = Math.max(c, y); b = Math.min(b, x); d = Math.max(d, x); sx += x; sy += y; n++; }));
    o._bb = n ? [a, b, c, d] : null; o._cen = n ? [sy / n, sx / n] : null;
    o.dif = (o.dP && o.dkmm) ? Math.round((o.dP - o.dkmm) / o.dkmm * 1000) / 10 : null;
    o.tmkm = (o.tm && o.dP) ? Math.round(o.tm * o.dP) : null;
  });

  // ---------- programa de corte leído de Google Sheets (hoja "Programa de Corte" de Archivo_Maestros) ----------
  // Los datos del programa (frente, fecha, semana, secuencia, ha, toneladas…) se toman de la hoja; el repositorio sólo aporta la geometría y las rutas.
  let PROG = {zafra: '', borrador: '', version: '', total: 0, enMapa: 0, sinMapa: [], fuera: 0, origen: 'repositorio', t: null}, PROG_DOC = null;
  const PROG_CAMPOS = ['nm', 'var', 'nc', 'ha', 'tm', 'est', 'fc', 'fr', 'sem', 'sec', 'reg', 'ten', 'mun', 'tc', 'car', 'ubi', 'mul', 'dkm', 'dkmm'];
  const ordenPrograma = (a, b) => String(a.fr || '').localeCompare(String(b.fr || '')) || (a.sem || 0) - (b.sem || 0) || (a.sec || 0) - (b.sec || 0) || a.id.localeCompare(b.id);   // el mismo orden que ya tenía la lista
  function aplicarPrograma(doc, origen) {
    if (!doc || !Array.isArray(doc.rows) || !doc.rows.length) return false;
    const filas = new Map(doc.rows.map(r => [r.id, r])); let n = 0;
    D.forEach(o => {
      const r = filas.get(o.id);
      if (!r) { o.fuera = true; return; }
      delete o.fuera; n++;
      PROG_CAMPOS.forEach(k => { o[k] = (r[k] === undefined || r[k] === '') ? null : r[k]; });
      o.tch = o.ha ? Math.round(o.tm / o.ha * 10) / 10 : null;
      o.dif = (o.dP && o.dkmm) ? Math.round((o.dP - o.dkmm) / o.dkmm * 1000) / 10 : null;
      o.tmkm = (o.tm && o.dP) ? Math.round(o.tm * o.dP) : null;
    });
    const ids = new Set(D.map(o => o.id));
    D.sort(ordenPrograma);
    PROG_DOC = doc;   // las filas del programa quedan en memoria: el formulario ATS las usa para listar los plantíos sin llamar al servidor
    PROG = {zafra: doc.zafra, borrador: doc.borrador || '', version: doc.version || '', total: doc.rows.length, enMapa: n, sinMapa: doc.rows.filter(r => !ids.has(r.id)).map(r => r.id), fuera: D.filter(o => o.fuera).length, origen: origen || 'google', t: Date.now()};
    return true;
  }
  { const cp = LS.get('prog', null); if (cp) aplicarPrograma(cp, 'caché'); }   // sin conexión se usa el último programa leído
  const pip = (pt, ring) => { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [yi, xi] = ring[i], [yj, xj] = ring[j];
    if (((yi > pt[0]) !== (yj > pt[0])) && (pt[1] < (xj - xi) * (pt[0] - yi) / (yj - yi) + xi)) ins = !ins; } return ins; };
  const inPlantio = (o, pt) => o._bb && pt[0] >= o._bb[0] && pt[0] <= o._bb[2] && pt[1] >= o._bb[1] && pt[1] <= o._bb[3]
    && o._rings.some(poly => pip(pt, poly[0]) && !poly.slice(1).some(h => pip(pt, h)));

  // ---------- capas de apoyo: índice espacial y filtro por plantío ----------
  const KLAT = 111320, KLON = 111320 * Math.cos(12.5 * Math.PI / 180), CELL = 0.01, ckey = (cx, cy) => cx * 20000 + cy;
  function capaPrep(c) {
    if (c._ok) return c; c._ok = true;
    const grid = new Map(), big = [], put = (k, i) => { const a = grid.get(k); if (a) a.push(i); else grid.set(k, [i]); };
    if (c.tipo === 'p') {
      const lon = new Float64Array(c.n), lat = new Float64Array(c.n); let x = 0, y = 0;
      for (let i = 0; i < c.n; i++) { x += c.g[2 * i]; y += c.g[2 * i + 1]; lon[i] = x / 1e6; lat[i] = y / 1e6; put(ckey(Math.floor(lon[i] / CELL), Math.floor(lat[i] / CELL)), i); }
      c._lon = lon; c._lat = lat; c.g = null;
    } else {
      c._ln = new Array(c.n); c._bb = new Float64Array(c.n * 4);
      for (let i = 0; i < c.n; i++) {
        const a = c.l[i], m = a.length / 2, ll = new Array(m); let x = 0, y = 0, s0 = 90, w = 180, n0 = -90, e = -180;
        for (let k = 0; k < m; k++) { x += a[2 * k]; y += a[2 * k + 1]; const lo = x / 1e6, la = y / 1e6; ll[k] = [la, lo]; if (la < s0) s0 = la; if (la > n0) n0 = la; if (lo < w) w = lo; if (lo > e) e = lo; }
        c._ln[i] = ll; c._bb[4 * i] = s0; c._bb[4 * i + 1] = w; c._bb[4 * i + 2] = n0; c._bb[4 * i + 3] = e;
        const x0 = Math.floor(w / CELL), x1 = Math.floor(e / CELL), y0 = Math.floor(s0 / CELL), y1 = Math.floor(n0 / CELL);
        if ((x1 - x0 + 1) * (y1 - y0 + 1) > 400) big.push(i); else for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) put(ckey(cx, cy), i);
      }
      c.l = null;
    }
    c._grid = grid; c._big = big; c._byLink = null;
    if (c.K) { const m = new Map(); c.r.forEach((row, i) => { const k = c.K[row]; if (k >= 0) { const key = c.S[k]; if (!m.has(key)) m.set(key, []); m.get(key).push(i); } }); c._byLink = m; }
    return c;
  }
  function capaBBox(c, s0, w, n0, e) {                 // entidades cuyo punto o caja cae en el rectángulo
    capaPrep(c);
    const x0 = Math.floor(w / CELL), x1 = Math.floor(e / CELL), y0 = Math.floor(s0 / CELL), y1 = Math.floor(n0 / CELL);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 2500) return [];
    const seen = new Set(), out = [];
    const take = i => { if (seen.has(i)) return; seen.add(i);
      if (c.tipo === 'p') { if (c._lat[i] >= s0 && c._lat[i] <= n0 && c._lon[i] >= w && c._lon[i] <= e) out.push(i); }
      else { const b = c._bb, j = 4 * i; if (b[j] <= n0 && b[j + 2] >= s0 && b[j + 1] <= e && b[j + 3] >= w) out.push(i); } };
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) { const a = c._grid.get(ckey(cx, cy)); if (a) a.forEach(take); }
    c._big.forEach(take);
    return out;
  }
  const dSeg = (ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy; let t = l2 ? -(ax * dx + ay * dy) / l2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(ax + t * dx, ay + t * dy); };
  function distPlantio(o, la, lo) {                    // metros al polígono del plantío (0 si está dentro)
    if (inPlantio(o, [la, lo])) return 0;
    let best = Infinity;
    for (const poly of o._rings) for (const r of poly)
      for (let i = 1; i < r.length; i++) { const d = dSeg((r[i - 1][1] - lo) * KLON, (r[i - 1][0] - la) * KLAT, (r[i][1] - lo) * KLON, (r[i][0] - la) * KLAT); if (d < best) best = d; }
    return best;
  }
  // ¿El punto está sobre el lote? Cuenta todo el interior del contorno exterior (incluidas las islas excluidas del Maestro) más una tolerancia.
  function sobreLote(o, la, lo, tol) {
    if (!o._obb) o._obb = o._rings.map(poly => { let a = 90, b = 180, c = -90, d = -180; poly[0].forEach(([y, x]) => { if (y < a) a = y; if (y > c) c = y; if (x < b) b = x; if (x > d) d = x; }); return [a, b, c, d]; });
    const dla = tol / KLAT, dlo = tol / KLON, R = o._rings, B = o._obb;
    for (let k = 0; k < R.length; k++) { const b = B[k]; if (la >= b[0] && la <= b[2] && lo >= b[1] && lo <= b[3] && pip([la, lo], R[k][0])) return true; }
    for (let k = 0; k < R.length; k++) { const b = B[k]; if (la < b[0] - dla || la > b[2] + dla || lo < b[1] - dlo || lo > b[3] + dlo) continue;   // cuadro lejano: se descarta
      const r = R[k][0];
      for (let i = 1; i < r.length; i++) if (dSeg((r[i - 1][1] - lo) * KLON, (r[i - 1][0] - la) * KLAT, (r[i][1] - lo) * KLON, (r[i][0] - la) * KLAT) <= tol) return true; }
    return false;
  }
  function lineaCerca(o, ll, rad) {                    // ¿algún tramo está a ≤ rad metros del plantío?
    const S0 = o._bb[0] - rad / KLAT, N0 = o._bb[2] + rad / KLAT, W0 = o._bb[1] - rad / KLON, E0 = o._bb[3] + rad / KLON;
    const dentro = (la, lo) => la >= S0 && la <= N0 && lo >= W0 && lo <= E0;
    for (let i = 0; i < ll.length; i++) {
      const a = ll[i];
      if (dentro(a[0], a[1]) && distPlantio(o, a[0], a[1]) <= rad) return true;
      if (i) { const b = ll[i - 1], len = Math.hypot((a[1] - b[1]) * KLON, (a[0] - b[0]) * KLAT);
        if (len > rad) { const k = Math.ceil(len / (rad / 2));
          for (let t = 1; t < k; t++) { const la = b[0] + (a[0] - b[0]) * t / k, lo = b[1] + (a[1] - b[1]) * t / k; if (dentro(la, lo) && distPlantio(o, la, lo) <= rad) return true; } } }
    }
    return false;
  }
  // Capas "sobre el plantío" (quemas): no se usa radio ni código; se muestra solo lo que cae encima del lote seleccionado.
  const SOBRE_DEFECTO = {quemaP: 1, quemaAC: 1, quemaPV: 1, aa: 1};        // para capas.json anteriores que no declaran 'sobre'
  const reglaSobre = c => c.sobre || (SOBRE_DEFECTO[c.id] ? {tol: 5, min: .5} : null);
  function fraccionSobre(o, ll, tol) {                 // fracción del largo del trazo (o del borde del polígono) que cae sobre el plantío
    const S0 = o._bb[0] - tol / KLAT, N0 = o._bb[2] + tol / KLAT, W0 = o._bb[1] - tol / KLON, E0 = o._bb[3] + tol / KLON;
    let tot = 0, den = 0;
    for (let i = 1; i < ll.length; i++) {
      const a = ll[i - 1], b = ll[i], len = Math.hypot((b[1] - a[1]) * KLON, (b[0] - a[0]) * KLAT); if (!len) continue;
      const k = Math.max(3, Math.ceil(len / 2)), w = len / k;           // muestras cada ≤2 m (mínimo 3 por tramo)
      for (let t = 0; t < k; t++) { const f = (t + .5) / k, la = a[0] + (b[0] - a[0]) * f, lo = a[1] + (b[1] - a[1]) * f; tot += w;
        if (la >= S0 && la <= N0 && lo >= W0 && lo <= E0 && sobreLote(o, la, lo, tol)) den += w; }
    }
    return tot ? den / tot : 0;
  }
  const poligonoCerca = (o, ll, rad) => lineaCerca(o, ll, rad) || (o._cen && pip(o._cen, ll));
  /** Entidades de UNA capa para el plantío (se calcula bajo demanda y se guarda por plantío y capa). */
  function cercaCapa(o, c) {
    const cache = o._cap || (o._cap = {}); if (cache[c.id]) return cache[c.id];
    capaPrep(c); const rad = c.radio, idx = new Set(), rs = reglaSobre(c);
    if (rs) {                                            // ajuste exacto: solo lo que cae sobre el lote
      if (o._bb) capaBBox(c, o._bb[0] - rs.tol / KLAT, o._bb[1] - rs.tol / KLON, o._bb[2] + rs.tol / KLAT, o._bb[3] + rs.tol / KLON).forEach(i => {
        if (c.tipo === 'p' ? sobreLote(o, c._lat[i], c._lon[i], rs.tol) : fraccionSobre(o, c._ln[i], rs.tol) >= rs.min) idx.add(i); });
    } else {                                             // por radio alrededor del plantío O por su código
      if (o._bb) capaBBox(c, o._bb[0] - rad / KLAT, o._bb[1] - rad / KLON, o._bb[2] + rad / KLAT, o._bb[3] + rad / KLON).forEach(i => {
        if (c.tipo === 'p' ? distPlantio(o, c._lat[i], c._lon[i]) <= rad : c.tipo === 'l' ? lineaCerca(o, c._ln[i], rad) : poligonoCerca(o, c._ln[i], rad)) idx.add(i); });
      if (c._byLink && c._byLink.has(o.id)) c._byLink.get(o.id).forEach(i => idx.add(i));
    }
    return (cache[c.id] = [...idx]);
  }
  function capasCerca(o) { const res = {}; CAPS.forEach(c => { res[c.id] = cercaCapa(o, c); }); return res; }   // todas las capas (leyenda)
  const capaColor = (c, row) => { if (!c.cat) return null; const k = c.C[row]; return (k >= 0 && c.cat.map[k]) || c.cat.otro; };
  function capaPopup(c, i) {
    const row = c.A[c.r[i]], g = j => (row[j] >= 0 ? c.S[row[j]] : null), t = c.titulo >= 0 ? g(c.titulo) : null;
    return `<b>${esc(c.nombre)}</b>${t ? ' · ' + esc(t) : ''}<br>` + c.popup.map((lab, j) => (j === c.titulo || g(j) == null) ? '' : `<span style="color:#6b7a70">${esc(lab)}:</span> ${esc(g(j))}`).filter(Boolean).join('<br>');
  }
  const iconoCache = {};
  function icono(nombre) {
    if (!nombre || !ICONOS[nombre]) return null;
    if (!iconoCache[nombre]) {
      const img = new Image(), src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(ICONOS[nombre].svg);
      img.onload = () => { if (map) map.eachLayer(l => { if (l instanceof L.IconMarker) l.redraw(); }); };   // si el ícono termina de cargar tarde
      img.src = src; iconoCache[nombre] = {img, src, size: ICONOS[nombre].size};
    }
    return iconoCache[nombre];
  }
  const iconoDe = c => icono(c.estilo.icono || ICONO_DE_CAPA[c.id]);
  function capaAdd(c, i, grp) {
    const st = c.estilo, col = capaColor(c, c.r[i]), dash = st.dash || null, ic = c.tipo === 'p' ? iconoDe(c) : null;
    if (ic) grp.addLayer(new L.IconMarker([c._lat[i], c._lon[i]], {img: ic.img, size: ic.size, radius: ic.size / 2}).bindPopup(() => capaPopup(c, i)));
    else if (c.tipo === 'p') grp.addLayer(L.circleMarker([c._lat[i], c._lon[i]], {radius: st.r, color: st.color, weight: st.peso, fillColor: col || st.relleno, fillOpacity: .95}).bindPopup(() => capaPopup(c, i)));
    else if (c.tipo === 'l') grp.addLayer(L.polyline(c._ln[i], {color: col || st.color, weight: st.peso, dashArray: dash, opacity: .9}).bindPopup(() => capaPopup(c, i)));
    else {   // polígono: el relleno no es interactivo (no debe tapar los clics de los plantíos); el borde sí muestra datos
      grp.addLayer(L.polygon(c._ln[i], {stroke: false, fillColor: st.relleno || st.color, fillOpacity: st.opacidad ?? .1, interactive: false}));
      grp.addLayer(L.polyline([...c._ln[i], c._ln[i][0]], {color: st.color, weight: st.peso, dashArray: dash, opacity: .9}).bindPopup(() => capaPopup(c, i)));
    }
  }
  const capasDibujar = (o, grp) => { CAPS.forEach(c => { if (vis['x' + c.id]) cercaCapa(o, c).forEach(i => capaAdd(c, i, grp)); }); };   // solo calcula las capas encendidas
  let capAll = null, capAllT = null; const capWarn = {};
  function capasTodo() {                               // modo "todo el mapa": lo que cae en pantalla (zoom ≥ 14)
    if (!map || !capAll) return; capAll.clearLayers();
    if (!vis.xall || !CAPS.length) return;
    if (map.getZoom() < 14) { if (!capWarn.z) { capWarn.z = 1; emit('toast', 'Acerca el mapa (zoom 14 o más) para ver las capas de apoyo de todo el mapa.'); } return; }
    capWarn.z = 0; const b = map.getBounds().pad(0.15);
    CAPS.forEach(c => { if (!vis['x' + c.id]) return;
      const idx = capaBBox(c, b.getSouth(), b.getWest(), b.getNorth(), b.getEast());
      if (idx.length > 5000) { if (!capWarn[c.id]) { capWarn[c.id] = 1; emit('toast', `${c.nombre}: demasiadas entidades en pantalla (${idx.length}). Acerca más el mapa.`); } return; }
      capWarn[c.id] = 0; idx.forEach(i => capaAdd(c, i, capAll)); });
  }
  const capasTodoPronto = () => { clearTimeout(capAllT); capAllT = setTimeout(capasTodo, 200); };
  const redibujar = () => { if (cur) draw(cur); capasTodo(); pedirEtiquetas(); };
  function setCapas(doc) {                             // vista previa en este equipo (no se guarda ni se publica)
    const nuevas = (doc && doc.capas) || [];
    D.forEach(o => { delete o._cap; });
    CAPS.length = 0; nuevas.forEach(c => CAPS.push(c));
    CAPS.forEach(c => { const k = 'x' + c.id; if (!(k in vis)) vis[k] = !!c.defecto; if (!PREF_KEYS.includes(k)) PREF_KEYS.push(k); });
    if (CAPS.length && !('xall' in vis)) { vis.xall = false; PREF_KEYS.push('xall'); }
    PRESETS.todo = PREF_KEYS.filter(k => k !== 'ref' && k !== 'xall');
    if (META) META.capasVista = doc && doc.version;
    if (map && capAll) capAll.clearLayers();
    if (cur) { draw(cur); emit('select', cur); } capasTodo();
  }

  // ---------- mapa ----------
  let map, sel, ctx, cur = null, curLocal = null, curAll = null, padFn = () => ({padding: [30, 30]}), meLayer = null;
  const SRC_COL = {'26-27': '#f2b134', '25-26': '#5fc4b0', null: '#e5604f'};
  function initMap(el, pad) {
    if (pad) padFn = pad;
    map = L.map(el, {preferCanvas: true, zoomControl: !L.Browser.mobile});
    const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {maxZoom: 20, maxNativeZoom: 18, attribution: 'Esri World Imagery'}).addTo(map);
    const lbl = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {maxZoom: 20, maxNativeZoom: 18}).addTo(map);
    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19, attribution: '© OpenStreetMap'});
    L.control.layers({'Satélite': sat, 'Calles (OSM)': osm}, {'Nombres': lbl}, {position: L.Browser.mobile ? 'topright' : 'bottomright'}).addTo(map);
    L.control.scale({imperial: false}).addTo(map);
    // Un solo lienzo (preferCanvas): si hubiera dos, el de arriba absorbe los clics y los lotes de abajo dejan de responder.
    ctx = L.layerGroup().addTo(map); capAll = L.layerGroup().addTo(map); sel = L.layerGroup().addTo(map);
    map.on('moveend', capasTodoPronto);
    map.createPane('etqPane'); const pEtq = map.getPane('etqPane'); pEtq.style.zIndex = 450; pEtq.style.pointerEvents = 'none';
    ETQ.cv = L.DomUtil.create('canvas', 'etqHa', pEtq); ETQ.cx = ETQ.cv.getContext('2d');
    map.on('move zoomend resize viewreset', pedirEtiquetas); map.on('zoomstart', () => { if (ETQ.cx) ETQ.cx.clearRect(0, 0, ETQ.cv.width, ETQ.cv.height); });
    const all = L.latLngBounds();
    D.forEach(o => { if (!o._rings.length) return;
      const lay = L.polygon(o._rings, {color: SRC_COL[o.src], weight: 1, fillOpacity: .12, opacity: .8});
      lay.on('click', () => select(o.id)); if (!L.Browser.mobile) tooltipPlantio(lay, () => tipPlantio(o));
      lay.addTo(ctx); all.extend(lay.getBounds()); o._ctx = lay; });
    map.fitBounds(all); return map;
  }
  // ---------- nota emergente al pasar el cursor: todos los datos del programa de corte ----------
  const nfmt = (v, d = 1) => (v == null || v === '' || isNaN(Number(v))) ? '—' : Number(v).toLocaleString('es-NI', {minimumFractionDigits: d, maximumFractionDigits: d});
  const fdmy = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '—';
  function tipPlantio(o, p) {
    return `<div class="tipP">${p ? `<div class="tc">Cuadro ${esc(p.q)} · ${nfmt(p.ha, 2)} ha</div>` : ''}<b>${esc(o.id)} · ${esc(o.nm)}</b><div class="tk">`
      + `<span>Área total</span><span>${nfmt(o.ha)} ha</span><span>TCH</span><span>${nfmt(o.tch)}</span><span>TM</span><span>${nfmt(o.tm, 0)}</span>`
      + `<span>Frente de corte</span><span>${esc(o.fr ?? '—')}</span><span>Semana</span><span>${esc(o.sem ?? '—')}</span><span>Secuencia</span><span>${esc(o.sec ?? '—')}</span>`
      + `<span>Fecha de corte</span><span>${fdmy(o.fc)}</span></div></div>`;
  }
  /** La nota se abre hacia la izquierda si a su derecha estaría la ficha del plantío (que la taparía). */
  const lado = e => {
    const card = document.getElementById('card'), w = card && card.offsetParent ? card.offsetWidth + 12 : 0;
    return e.containerPoint.x > map.getSize().x - w - 250 ? 'left' : 'right';
  };
  const tooltipPlantio = (lay, f) => lay.bindTooltip(f, {sticky: true, className: 'tipPl', direction: 'right'}).on('mouseover mousemove', e => { const t = lay.getTooltip(), d = lado(e); if (t && t.options.direction !== d) { t.options.direction = d; t.update(); } });   // update(): se reposiciona de inmediato
  // ---------- etiquetas con las hectáreas de cada cuadro (como en QGIS) ----------
  const ETQ = {cv: null, cx: null, raf: 0, ultimo: []};
  function puntoEtiqueta(anillo) {   // un punto DENTRO del cuadro: su centroide, o (si es cóncavo) el centro del tramo más ancho de una recta horizontal
    let a = 0, cx = 0, cy = 0; const n = anillo.length;
    for (let i = 0, j = n - 1; i < n; j = i++) { const [y1, x1] = anillo[j], [y2, x2] = anillo[i], f = x1 * y2 - x2 * y1; a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f; }
    const p = a ? [cy / (3 * a), cx / (3 * a)] : anillo[0];
    if (pip(p, anillo)) return p;
    const xs = [];
    for (let i = 0, j = n - 1; i < n; j = i++) { const [y1, x1] = anillo[j], [y2, x2] = anillo[i]; if ((y1 > p[0]) !== (y2 > p[0])) xs.push(x1 + (p[0] - y1) / (y2 - y1) * (x2 - x1)); }
    xs.sort((u, v) => u - v); let mejor = -1, medio = anillo[0][1];
    for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > mejor) { mejor = xs[i + 1] - xs[i]; medio = (xs[i] + xs[i + 1]) / 2; }
    return [p[0], medio];
  }
  function etiquetaDe(o, i) {   // punto y caja de cada cuadro, calculados una sola vez
    const k = o._lbl || (o._lbl = []); if (k[i]) return k[i];
    const r = o._rings[i] && o._rings[i][0]; if (!r || r.length < 3) return (k[i] = null);
    let s = 90, w = 180, n = -90, e = -180; r.forEach(([y, x]) => { if (y < s) s = y; if (y > n) n = y; if (x < w) w = x; if (x > e) e = x; });
    return (k[i] = {p: puntoEtiqueta(r), b: [s, w, n, e]});
  }
  const esMovil = () => document.documentElement.dataset.ui === 'movil' || (!document.documentElement.dataset.ui && L.Browser.mobile);
  // El plantío seleccionado resalta (amarillo, negrita, grande); los demás son discretos: pequeños, delgados y translúcidos.
  // Los vecinos además se achican y se vuelven más translúcidos cuanto más lejos está el mapa (con la escala de 500 m son diminutos y tenues).
  const estiloEtq = (sel, z) => {
    const k = aj.etqTam / 100, tam = fs => +Math.max(4, Math.min(30, fs * k)).toFixed(1);   // tamaño personal (50-200 %)
    if (sel) return {fs: tam(12.5), peso: 700, relleno: '#ffe14d', halo: 'rgba(8,18,12,.88)', ancho: 3.4};   // el seleccionado siempre se resalta en amarillo
    const t = Math.max(0, Math.min(1, (z - 13) / 4)), L_ = (a, b) => a + (b - a) * t, m = esMovil();   // t: 0 con zoom ≤ 13, 1 con zoom ≥ 17
    const r = parseInt(aj.etqColor.slice(1, 3), 16), g = parseInt(aj.etqColor.slice(3, 5), 16), bl = parseInt(aj.etqColor.slice(5, 7), 16), claro = (.299 * r + .587 * g + .114 * bl) / 255 > .5;
    const halo = claro ? `rgba(8,18,12,${L_(.26, .5).toFixed(2)})` : `rgba(255,255,255,${L_(.4, .65).toFixed(2)})`;   // el borde contrasta con el color elegido
    return {fs: tam(L_(m ? 5.5 : 6.5, m ? 8.5 : 9.5)), peso: 500, relleno: `rgba(${r},${g},${bl},${L_(.4, .7).toFixed(2)})`, halo, ancho: +(L_(1.5, 2.2) * Math.max(.7, Math.min(1.6, k))).toFixed(1)};
  };
  function dibujarEtiquetas() {
    ETQ.raf = 0; const cv = ETQ.cv; if (!cv || !map) return;
    const tam = map.getSize(), dpr = window.devicePixelRatio || 1; ETQ.ultimo = [];
    if (cv.width !== Math.round(tam.x * dpr) || cv.height !== Math.round(tam.y * dpr)) { cv.width = Math.round(tam.x * dpr); cv.height = Math.round(tam.y * dpr); cv.style.width = tam.x + 'px'; cv.style.height = tam.y + 'px'; }
    L.DomUtil.setPosition(cv, map.containerPointToLayerPoint([0, 0]));   // el lienzo vive en un panel que se desplaza con el mapa
    const c = ETQ.cx; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, tam.x, tam.y);
    if (!vis.lblHa || map.getZoom() < 13) return;
    const bd = map.getBounds().pad(.05), S = bd.getSouth(), N = bd.getNorth(), W = bd.getWest(), E = bd.getEast();
    const filt = hasFilters() ? new Set(filtered.map(o => o.id)) : null, zoom = map.getZoom();
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
    // 1) candidatos: cuadros visibles cuya etiqueta cabe dentro del cuadro
    const cand = [];
    for (const o of D) {
      if (!o._bb || o._bb[2] < S || o._bb[0] > N || o._bb[3] < W || o._bb[1] > E) continue;
      const esSel = !!cur && cur.id === o.id; if (filt && !filt.has(o.id) && !esSel) continue;   // con filtros activos, sólo los plantíos filtrados
      const est = estiloEtq(esSel, zoom); c.font = `${est.peso} ${est.fs}px Barlow, system-ui, sans-serif`;
      for (let i = 0; i < o.pol.length; i++) {
        const t = etiquetaDe(o, i); if (!t) continue;
        const [s2, w2, n2, e2] = t.b; if (n2 < S || s2 > N || e2 < W || w2 > E) continue;
        const a = map.latLngToContainerPoint([s2, w2]), b = map.latLngToContainerPoint([n2, e2]), txt = Number(o.pol[i].ha).toFixed(2), tw = c.measureText(txt).width;
        if (Math.abs(b.x - a.x) < tw + 8 || Math.abs(a.y - b.y) < est.fs + 6) continue;   // cuadro demasiado pequeño para su etiqueta a este zoom
        const p = map.latLngToContainerPoint(t.p); cand.push({o, i, sel: esSel, est, txt, tw, x: p.x, y: p.y, ha: Number(o.pol[i].ha) || 0});
      }
    }
    // 2) primero las del plantío seleccionado; luego las demás, de mayor a menor cuadro; una etiqueta que se encima con otra ya puesta se omite
    cand.sort((a, b) => (b.sel - a.sel) || (b.ha - a.ha));
    const CEL = 48, rej = new Map();
    const choca = r => { for (let gx = Math.floor(r[0] / CEL); gx <= Math.floor(r[2] / CEL); gx++) for (let gy = Math.floor(r[1] / CEL); gy <= Math.floor(r[3] / CEL); gy++) { const l = rej.get(gx + ',' + gy); if (l) for (const q of l) if (!(r[2] < q[0] || r[0] > q[2] || r[3] < q[1] || r[1] > q[3])) return true; } return false; };
    const marca = r => { for (let gx = Math.floor(r[0] / CEL); gx <= Math.floor(r[2] / CEL); gx++) for (let gy = Math.floor(r[1] / CEL); gy <= Math.floor(r[3] / CEL); gy++) { const k = gx + ',' + gy; (rej.get(k) || rej.set(k, []).get(k)).push(r); } };
    let n = 0;
    for (const e of cand) {
      const r = [e.x - e.tw / 2 - 2, e.y - e.est.fs / 2 - 1, e.x + e.tw / 2 + 2, e.y + e.est.fs / 2 + 1];
      if (!e.sel && choca(r)) continue; marca(r);
      c.font = `${e.est.peso} ${e.est.fs}px Barlow, system-ui, sans-serif`;
      c.lineWidth = e.est.ancho; c.strokeStyle = e.est.halo; c.strokeText(e.txt, e.x, e.y); c.fillStyle = e.est.relleno; c.fillText(e.txt, e.x, e.y);
      ETQ.ultimo.push({id: e.o.id, q: e.o.pol[e.i].q, txt: e.txt, x: Math.round(e.x), y: Math.round(e.y), sel: e.sel, fs: e.est.fs, rel: e.est.relleno, r});
      if (++n >= 900) return;
    }
  }
  const pedirEtiquetas = () => { if (!ETQ.raf) ETQ.raf = requestAnimationFrame(dibujarEtiquetas); };
  const kmLen = ll => { let d = 0; for (let i = 1; i < ll.length; i++) d += map.distance(ll[i - 1], ll[i]); return d / 1000; };
  const icon = c => L.divIcon({className: '', html: c === 'R' ? '<div class="rmk"><i>R</i></div>' : `<div class="${PCAT[c][1]}"></div>`, iconSize: [18, 18], iconAnchor: c === 'R' ? [9, 20] : [9, 9]});
  function draw(o) {
    sel.clearLayers(); const local = L.latLngBounds(), all = L.latLngBounds();
    o.pol.forEach((p, i) => { const pl = L.polygon(o._rings[i], {color: '#ffe14d', weight: 3, fillColor: '#ffe14d', fillOpacity: .15})
      .addTo(sel); tooltipPlantio(pl, () => tipPlantio(o, p)); local.extend(pl.getBounds()); all.extend(pl.getBounds()); });
    if (CAPS.length && !vis.xall) capasDibujar(o, sel);
    const layer = (feats, ghost) => feats.forEach(f => {
      if (f.t === 'l') { if (!vis['l' + f.c]) return; const ll = dec(f.g), c = CAT[f.c];
        const pl = L.polyline(ll, {color: c[1], weight: ghost ? 2 : c[2], dashArray: ghost ? '4 6' : c[3], opacity: ghost ? .55 : .95})
          .bindPopup(`<b>${c[0]}</b><br>${esc(f.n || '(sin nombre)')}<br>${kmLen(ll).toFixed(2)} km${ghost ? '<br><i>Mapeo 25-26 (referencia)</i>' : ''}`).addTo(sel);
        all.extend(pl.getBounds()); if (!['E', 'S'].includes(f.c)) local.extend(pl.getBounds());
      } else if (f.t === 'p') { if (!vis['p' + f.c] || ghost) return; const ll = [f.g[1], f.g[0]];
        L.marker(ll, {icon: icon(f.c), keyboard: false}).bindPopup(`<b>${PCAT[f.c][0]}</b>${f.n ? '<br>' + esc(f.n) : ''}<br>${ll[0].toFixed(6)}, ${ll[1].toFixed(6)}`).addTo(sel);
        if (f.c === 'R') local.extend(ll); all.extend(ll);
      } else if (f.t === 'a' && !ghost) L.polygon(dec(f.g), {color: '#fff', weight: 1, fillOpacity: .2, dashArray: '3 3'}).bindTooltip(esc(f.n || 'Área')).addTo(sel);
    });
    layer(o.f, false); if (vis.ref && o.ref) layer(o.ref, true);
    curLocal = local.isValid() ? local : all; curAll = all; pedirEtiquetas();
  }
  const fitLocal = () => curLocal && curLocal.isValid() && map.fitBounds(curLocal, {...padFn(), maxZoom: 17});
  const fitAll = () => curAll && curAll.isValid() && map.fitBounds(curAll, padFn());
  function select(id, opt = {}) {
    const o = byId.get(id); if (!o) return; cur = o; draw(o); if (opt.fit !== false) fitLocal();
    try { if (location.hash !== '#p' + id) history.replaceState(null, '', '#p' + id); } catch {}
    emit('select', o);
  }
  function step(d) { const ids = filtered.map(o => o.id); let i = cur ? ids.indexOf(cur.id) : -1; i = Math.max(0, Math.min(ids.length - 1, i + d)); if (ids[i]) select(ids[i]); }

  // ---------- validación ----------
  function valOf(id) {
    const q = queue.filter(r => r.codigo === id).pop();
    if (q) return {r: q.resultado, n: q.nota, u: q.usuario, t: q.ts, pend: true};
    const a = remote[id], b = local[id];
    if (a && b) return (new Date(b.t) > new Date(a.t)) ? b : a;
    return a || b || null;
  }

  // ---------- filtros ----------
  const F = {q: '', fr: '', sem: '', src: '', flag: '', val: ''};
  let filtered = D;
  const kmFlag = o => o.src && o.dkmm > 0 && o.dP > 0 && Math.abs(o.dif) > 15;
  const hasFilters = () => Object.values(F).some(v => v);
  function clearFilters() { Object.keys(F).forEach(k => { F[k] = ''; }); applyFilters(); emit('filterscleared'); }
  function applyFilters() {
    const q = strip(F.q.trim());
    filtered = D.filter(o => (!q || o.id.includes(q) || strip(o.nm).includes(q)) && (!F.fr || o.fr == F.fr) && (!F.sem || String(o.sem) === F.sem)
      && (!F.src || (F.src === 'none' ? !o.src : o.src === F.src))
      && (!F.flag || (F.flag === 'km' ? kmFlag(o) : F.flag === 'av' ? o.q.av : o.flags.includes(F.flag)))
      && (!F.val || (() => { const v = valOf(o.id); return F.val === 'none' ? !v : F.val === 'pend' ? v && v.pend : v && v.r === F.val; })()));
    const set = new Set(filtered.map(o => o.id));
    D.forEach(o => o._ctx && o._ctx.setStyle({opacity: set.has(o.id) ? .85 : .12, fillOpacity: set.has(o.id) ? .14 : .02}));
    pedirEtiquetas(); emit('filtered', filtered); return filtered;
  }
  const options = k => [...new Set(D.map(o => o[k]).filter(v => v != null && v !== ''))].sort((a, b) => a > b ? 1 : -1);

  // ---------- CSV ----------
  // CSV: no lo descarga el rol Consulta. (Con un servidor anterior, que aún no manda el permiso 'csv', todo rol distinto de Consulta lo conserva.)
  const puedeCsv = () => logged() && (puede('csv') || sess.rol !== 'Consulta');
  function csv() {
    if (!puedeCsv()) { emit('toast', 'Tu rol es de consulta: no puede descargar el CSV.'); return; }
    const CSVCAP = CAPS.filter(c => ['postes', 'valvulas', 'obstaculos', 'pozos'].includes(c.id));
    const H = ['Código','Nombre','Frente','Semana','Secuencia','Fecha corte','Variedad','N. cortes','Ha','Toneladas','TCH','Región','Tenencia','Municipio','Tipo de corte',
      'Carretas','Ubicación','Mulero','Mapeo usado','Km ingenio-lote (entrada)','Km ingenio-lote (salida)','Km ingenio-lote (promedio)','Dist Km (programa)',
      'Dist KM Mapeado (programa)','Dif. % vs Dist KM Mapeado','TM·km','Rajas','% rajas dentro del lote','Autovolteo','Alertas','Validación','Nota validación','Usuario validación','Fecha validación', ...CSVCAP.map(c => `${c.nombre} cercanos (≤${c.radio} m)`)];
    const cell = v => { if (v == null) return ''; const s = String(v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const rows = filtered.map(o => { const v = valOf(o.id) || {};
      return [o.id, o.nm, o.fr, o.sem, o.sec, o.fc, o.var, o.nc, o.ha, o.tm, o.tch, o.reg, o.ten, o.mun, o.tc, o.car, o.ubi, o.mul, o.src || 'Sin mapeo',
        o.dE, o.dS, o.dP, o.dkm, o.dkmm, o.dif, o.tmkm, o.q.nR, o.q.rin == null ? '' : Math.round(o.q.rin * 100), o.q.av ? 'Sí' : 'No',
        o.flags.map(f => FLAGS[f] || f).concat(kmFlag(o) ? ['Distancia difiere >15%'] : []).join(' | '),
        v.r ? (v.pend ? v.r + ' (pendiente de envío)' : v.r) : '', v.n || '', v.u || '', v.t || '', ...CSVCAP.map(c => cercaCapa(o, c).length)].map(cell).join(','); });
    const blob = new Blob(['\ufeff' + [H.join(','), ...rows].join('\r\n')], {type: 'text/csv;charset=utf-8'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    const tag = [F.fr && 'F' + F.fr, F.sem && 'S' + F.sem, F.src, F.flag, F.val].filter(Boolean).join('_');
    a.download = `Plantios_Programa_26-27${tag ? '_' + tag : ''}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    emit('toast', `CSV descargado: ${filtered.length} plantíos`);
  }

  // ---------- sesión: usuarios guardados en Google Sheets ----------
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2));
  let sess = LS.get('sess', null);                     // {token, exp, user, nombre, rol}
  if (sess && !(sess.token && sess.exp > Date.now())) sess = null;
  const logged = () => !!(sess && sess.token && sess.exp > Date.now());
  // Permisos que envía el servidor al entrar y en cada sincronización. Respaldo para sesiones guardadas antes de existir esta lista.
  const PERMISOS_POR_ROL = {Administrador: ['ver', 'csv', 'responder', 'capas_admin', 'usuarios_admin'], Supervisor: ['ver', 'csv', 'responder'], 'Administrador de frente': ['ver', 'csv', 'responder'], Consulta: ['ver']};
  const puede = p => logged() && (sess.permisos || PERMISOS_POR_ROL[sess.rol] || ['ver']).includes(p);   // la pantalla solo oculta botones; el servidor decide siempre
  const setSess = x => { sess = x; LS.set('sess', x); };
  async function api(action, body = {}, authed = true) {
    if (!cfg.url) return {ok: false, error: 'Falta configurar la URL del servidor de usuarios (Apps Script).'};
    const payload = {action, ...body}; if (authed && sess) payload.token = sess.token;
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 30000);
    try {
      const r = await fetch(cfg.url, {method: 'POST', body: JSON.stringify(payload), signal: ctl.signal});
      const j = await r.json();
      if (j && j.code === 'sesion' && authed) { setSess(null); emit('logout', j.error); }
      if (j && j.code === 'permiso' && authed && Date.now() - ultimoSync > 5000) setTimeout(refreshStatus, 0);   // el servidor dice que ya no puedes: se actualiza lo que la pantalla muestra
      return j;
    } finally { clearTimeout(t); }
  }

  // ---------- capas del mapa: configuración personal del usuario ----------
  const PREF_KEYS = Object.keys(vis);
  // Ajustes personales de los números de hectáreas: tamaño (50-200 %) y color. Se guardan en el perfil del usuario junto con sus capas.
  const aj = {etqTam: 100, etqColor: '#ffffff'};
  const ajValido = p => ({etqTam: Number.isFinite(+p.etqTam) && +p.etqTam >= 50 && +p.etqTam <= 200 ? Math.round(+p.etqTam) : 100, etqColor: /^#[0-9a-f]{6}$/i.test(String(p.etqColor || '')) ? String(p.etqColor).toLowerCase() : '#ffffff'});
  const pkey = k => 'u_' + (sess ? sess.user : '_') + '_' + k;
  let prefsDirty = false, prefTimer = null;
  const PSTATE = {ok: 'Tu vista se guarda en tu perfil y aplica a todos los plantíos.', pend: 'Guardando tu vista…',
    off: 'Sin conexión: tu vista se guardará al reconectar.', err: 'No se pudo guardar tu vista.'};
  const setPState = st => { document.querySelectorAll('.pstate').forEach(el => { el.dataset.s = st; el.textContent = PSTATE[st]; }); };
  const syncChecks = () => document.querySelectorAll('input[data-v]').forEach(i => { i.checked = !!vis[i.dataset.v]; });
  function loadPrefsLocal() {
    const p = LS.get(pkey('prefs'), null); if (p) { PREF_KEYS.forEach(k => { if (k in p) vis[k] = !!p[k]; }); Object.assign(aj, ajValido({...aj, ...p})); }
    prefsDirty = LS.get(pkey('dirty'), false);
  }
  loadPrefsLocal();
  function applyPrefs(p) {
    if (!p || prefsDirty) return;                       // si hay cambios locales sin enviar, no se pisan
    PREF_KEYS.forEach(k => { if (k in p) vis[k] = !!p[k]; });
    if ('etqTam' in p || 'etqColor' in p) Object.assign(aj, ajValido({...aj, ...p}));
    LS.set(pkey('prefs'), {...vis, ...aj}); syncChecks(); redibujar(); emit('prefs');
  }
  async function savePrefs() {
    if (!logged()) return;
    const snap = JSON.stringify([vis, aj]);
    try {
      const j = await api('prefs_set', {prefs: {...vis, ...aj}});
      if (j.ok) { if (JSON.stringify([vis, aj]) === snap) { prefsDirty = false; LS.set(pkey('dirty'), false); setPState('ok'); } }
      else if (j.code !== 'sesion') setPState('err');
    } catch { setPState('off'); }
  }
  function prefsChanged() {
    LS.set(pkey('prefs'), {...vis, ...aj}); prefsDirty = true; LS.set(pkey('dirty'), true);
    setPState('pend'); clearTimeout(prefTimer); prefTimer = setTimeout(savePrefs, 1200);
  }
  /** Cambia el tamaño (%) y/o el color de los números de hectáreas de ESTE usuario; se aplica al instante y se guarda en su perfil. */
  function setEtq(x) { Object.assign(aj, ajValido({...aj, ...x})); prefsChanged(); pedirEtiquetas(); emit('prefs'); }
  const PRESETS = {rutas: ['lE', 'lS'], operativa: ['lE', 'lS', 'lME', 'lMS', 'lAV', 'pR', 'lblHa', 'xpostes', 'xvalvulas', 'xobstaculos', 'xpozos'], todo: PREF_KEYS.filter(k => k !== 'ref' && k !== 'xall')};
  function applyPreset(n) { const on = new Set(PRESETS[n] || []); PREF_KEYS.forEach(k => { if (k !== 'ref' && k !== 'xall') vis[k] = on.has(k); }); }

  async function login(usuario, clave) {
    const j = await api('login', {usuario, clave}, false);
    if (!j.ok || j.cambiar) return j;
    setSess({token: j.token, exp: j.exp, user: j.usuario, nombre: j.nombre, rol: j.rol, ficha: j.ficha || '', permisos: j.permisos});
    loadPrefsLocal(); applyPrefs(j.prefs);
    emit('login', sess); flush(); refreshStatus();
    return j;
  }
  const changePassword = (usuario, actual, nueva) => api('cambiar_clave', {usuario, actual, nueva}, false);
  function logout() { clearTimeout(prefTimer); if (prefsDirty) savePrefs(); setSess(null); emit('logout', ''); }

  // ---------- respuestas en Google Sheets (cola sin conexión, ligada al usuario) ----------
  const metaText = () => 'Responde: ' + (sess ? sess.nombre + ' (' + sess.rol + ')' : '—') + (queue.length ? ' · ' + queue.length + ' pendiente(s) de envío' : '');
  let flushing = false;
  let avisoSinPermiso = false;
  async function flush() {
    const mine = logged() ? queue.filter(r => r.uid === sess.user) : [];
    if (logged() && prefsDirty && !prefTimer) savePrefs();
    if (flushing || !mine.length) { emit('queue', queue.length); return; }
    if (!puede('responder')) { if (!avisoSinPermiso) { avisoSinPermiso = true; emit('toast', `Tienes ${mine.length} respuesta(s) guardada(s) que no se enviarán: tu usuario no puede registrar la planificación.`); } emit('queue', queue.length); return; }   // se conservan por si te devuelven el permiso
    avisoSinPermiso = false;
    flushing = true;
    try {
      const j = await api('submit', {items: mine});
      if (j.ok) {
        const ok = new Set(j.accepted || []);
        mine.filter(r => ok.has(r.id)).forEach(r => local[r.codigo] = {r: r.resultado, n: r.nota, u: r.usuario, t: r.ts});
        queue = queue.filter(r => !ok.has(r.id)); LS.set('queue', queue); LS.set('local', local);
        if (ok.size) { emit('toast', `${ok.size} respuesta(s) enviadas a Google Sheets`); emit('status');
          if (cur) document.querySelectorAll('.vform .vmeta').forEach(el => el.textContent = metaText());
          if (cur) document.querySelectorAll('.vform .vlast').forEach(el => { const v = valOf(cur.id); el.innerHTML = `${valTag(v)} ${esc(v.u || '')} ${v.t ? esc(String(v.t).slice(0, 16).replace('T', ' ')) : ''}${v.n ? `<div class="vnote">“${esc(v.n)}”</div>` : ''}`; }); }
      } else if (j.code === 'permiso') { avisoSinPermiso = true; emit('toast', j.error || 'El servidor rechazó el envío: tu usuario no puede registrar la planificación.'); }   // api() ya pidió actualizar los permisos; no se reintenta cada minuto
      else if (j.code !== 'sesion') emit('toast', j.error || 'El servidor rechazó el envío');
    } catch (e) { emit('toast', 'Sin conexión con Google Sheets: las respuestas quedan guardadas para reenvío'); }
    finally { flushing = false; emit('queue', queue.length); }
  }
  let progOcupado = false;
  /** Lee el programa vigente de Google Sheets (si ya se tiene esa versión, el servidor no reenvía las filas) y lo aplica. */
  async function cargarPrograma() {
    if (progOcupado || !cfg.url || !logged()) return; progOcupado = true;
    try {
      const j = await api('programa', {version: PROG.version || ''});
      if (!j || !j.ok) return;
      if (j.sinCambios) { PROG.t = Date.now(); return; }
      if (!aplicarPrograma(j, 'google')) return;
      LS.set('prog', {zafra: j.zafra, borrador: j.borrador, version: j.version, rows: j.rows});
      applyFilters(); emit('programa', PROG); if (cur) emit('select', cur);
    } catch (e) { /* sin conexión o servidor sin la hoja: se sigue con el último programa conocido */ } finally { progOcupado = false; }
  }
  let ultimoSync = 0;   // última vez que se consultó al servidor por el estado, los permisos y el perfil
  async function refreshStatus() {
    if (!cfg.url || !logged()) return;
    ultimoSync = Date.now();
    cargarPrograma();   // en paralelo con la sincronización (antes esperaba a que ella terminara)
    try {
      const j = await api('sync');
      if (j.ok) {
        remote = {}; Object.entries(j.status || {}).forEach(([k, v]) => remote[String(k).padStart(5, '0')] = v);
        if (j.rol && (sess.rol !== j.rol || sess.nombre !== j.nombre || JSON.stringify(sess.permisos) !== JSON.stringify(j.permisos))) {
          const cambioPermisos = JSON.stringify(sess.permisos) !== JSON.stringify(j.permisos) || sess.rol !== j.rol;
          if (cambioPermisos) emit('toast', `Un administrador actualizó tus permisos (rol: ${j.rol}).`);   // primero el aviso general: si además se cierra algo concreto (formularios), ese mensaje, más específico, queda visible al final
          setSess({...sess, rol: j.rol, nombre: j.nombre, ficha: j.ficha || '', permisos: j.permisos}); emit('perfil', sess);
          if (cambioPermisos && cur) emit('select', cur);   // la ficha abierta se redibuja con lo que ahora puedes hacer
        }
        if (j.mv !== undefined) { const ant = mvServidor; mvServidor = j.mv; if (ant !== null && ant !== j.mv) emit('maestros', j.mv); }   // un administrador cambió los maestros
        applyPrefs(j.prefs); emit('status');
      }
    } catch {}
  }
  function submit(o, resultado, aspectos, nota, fechaReal, withPos) {
    if (!logged()) { emit('needLogin'); return false; }
    if (!puede('responder')) { emit('toast', sess.rol === 'Consulta' ? 'Tu rol es de consulta: no puede registrar respuestas.' : 'El registro de la planificación está deshabilitado para tu usuario.'); return false; }
    if (resultado === 'Diferente' && nota.trim().length < 5) { emit('toast', 'Agrega la nota de por qué se trabajó diferente.'); return false; }
    const p = withPos && lastPos ? lastPos : null;
    queue.push({id: uuid(), ts: new Date().toISOString(), codigo: o.id, nombre: o.nm, frente: o.fr, semana: o.sem, secuencia: o.sec, fecha_plan: o.fc,
      fecha_real: fechaReal || '', resultado, aspectos: resultado === 'Diferente' ? aspectos.join(', ') : '', nota: nota.trim(),
      usuario: sess.nombre, uid: sess.user,
      lat: p ? +p.lat.toFixed(6) : '', lon: p ? +p.lng.toFixed(6) : '', prec: p ? Math.round(p.acc) : '', mapeo: o.src || 'Sin mapeo',
      origen: document.documentElement.dataset.ui || 'web'});
    LS.set('queue', queue); emit('queue', queue.length); emit('status');
    flush();
    return true;
  }
  function saveCfg(c) { Object.assign(cfg, c); LS.set('cfg', cfg); flush(); refreshStatus(); }
  addEventListener('online', () => { flush(); refreshStatus(); });
  setInterval(() => { flush(); }, 60000);
  // Los permisos los decide el servidor en CADA acción; esto mantiene la pantalla al día aunque la persona no toque nada:
  // cada 3 minutos con la app a la vista, y al volver a la pestaña/ventana (máx. una consulta cada 20 s).
  let permMs = 180000, permTimer = null, mvServidor = null;
  const refrescarPermisos = (min) => { if (logged() && !document.hidden && Date.now() - ultimoSync > min) refreshStatus(); };
  const armarPerm = () => { clearInterval(permTimer); permTimer = setInterval(() => refrescarPermisos(0), permMs); };
  armarPerm();
  document.addEventListener('visibilitychange', () => refrescarPermisos(20000));
  addEventListener('focus', () => refrescarPermisos(20000));

  // ---------- GPS ----------
  let lastPos = null, geoDenied = false;
  function locate(silent) {
    if (silent && geoDenied) return;
    if (!navigator.geolocation) { emit('toast', 'Este navegador no permite ubicación.'); return; }
    if (!silent) emit('toast', 'Buscando tu ubicación…');
    navigator.geolocation.getCurrentPosition(p => {
      lastPos = {lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, t: Date.now()};
      const ll = [lastPos.lat, lastPos.lng];
      if (silent) { emit('toast', `Ubicación lista (±${Math.round(lastPos.acc)} m)`); return; }
      if (meLayer) meLayer.remove();
      meLayer = L.layerGroup([L.circle(ll, {radius: lastPos.acc, color: '#3b82f6', weight: 1, fillOpacity: .12}),
        L.circleMarker(ll, {radius: 7, color: '#fff', weight: 2, fillColor: '#3b82f6', fillOpacity: 1})]).addTo(map);
      const inside = D.find(o => inPlantio(o, ll));
      if (inside) { select(inside.id, {fit: false}); map.setView(ll, Math.max(map.getZoom(), 16)); emit('toast', `Estás dentro de ${inside.id} ${inside.nm}`); }
      else { let best = null, bd = 1e12; D.forEach(o => { if (!o._cen) return; const d = map.distance(ll, o._cen); if (d < bd) { bd = d; best = o; } });
        map.setView(ll, 15); emit('toast', best ? `Fuera de los lotes del programa. Más cercano: ${best.id} ${best.nm} (${(bd / 1000).toFixed(1)} km)` : 'Ubicación encontrada'); }
    }, e => { if (e.code === 1) geoDenied = true; emit('toast', e.code === 1 ? 'Permiso de ubicación denegado (requiere página https).' : 'No se pudo obtener la ubicación.'); }, {enableHighAccuracy: true, timeout: 15000, maximumAge: 30000});
  }

  // ---------- bloques de interfaz compartidos ----------
  function warnings(o) {
    const q = o.q, w = [];
    if (o.fuera) w.push('Este plantío ya no está en el programa de corte vigente (Google Sheets).');
    if (!o.src) w.push('Plantío del programa sin carpeta en ningún mapeo.');
    if (o.src === '25-26') w.push('Aún no está en el Mapeo 26-27: se muestra la ruta de la zafra anterior.');
    if (o.flags.includes('sin_entrada')) w.push('No tiene ruta de entrada identificada.');
    if (o.flags.includes('sin_salida')) w.push('No tiene ruta de salida identificada.');
    if (o.flags.includes('sin_raja') && o.src) w.push('No tiene puntos de apertura de raja.');
    if (o.flags.includes('raja_fuera')) w.push(`Solo ${Math.round(q.rin * 100)} % de las rajas cae dentro del polígono (±60 m).`);
    if (o.flags.includes('no_llega_lote')) w.push('La ruta termina a más de 1 km del lote: revisar trazo o continuidad con el muleo.');
    if (o.flags.includes('no_conecta_ingenio')) w.push('La ruta no arranca en el ingenio: distancia calculada solo sobre el tramo mapeado.');
    if (kmFlag(o)) w.push(`Distancia ingenio-lote (${fmt(o.dP, 2)} km) difiere ${fmt(o.dif)} % del Dist KM Mapeado (${fmt(o.dkmm, 2)} km).`);
    if (o.flags.includes('sin_poligono')) w.push('Código no encontrado en el Maestro General.');
    return w;
  }
  const srcTag = o => o.src === '26-27' ? '<span class="tag t27">MAPEO 26-27</span>' : o.src ? '<span class="tag t26">REFERENCIA 25-26</span>' : '<span class="tag tno">SIN MAPEO</span>';
  const valTag = v => !v ? '' : v.pend ? '<span class="tag tpe">Pendiente envío</span>' : v.r === 'Según lo planificado' ? '<span class="tag tok">Según plan</span>' : '<span class="tag tdi">Diferente</span>';
  function htmlKpis(o) {
    return `<div class="kpis"><div><b>${fmt(o.tch)}</b><span>TCH</span></div><div><b>${fmt(o.dP, 1)}</b><span>km ingenio-lote</span></div>
      <div><b>${fmt(o.ha, 1)}</b><span>ha</span></div><div><b>${fmt(o.tm, 0)}</b><span>TM</span></div></div>`;
  }
  /** Botón de la ficha del plantío que abre el formulario ATS con ese plantío y su frente ya elegidos (sólo si el usuario tiene permiso). */
  function htmlAtsBtn(o) {
    return puede('form_ats') ? `<button type="button" class="ffAts" data-ffopen="ats" data-ffsolo="1" data-ffplantio="${esc(o.id)}" data-fffrente="${esc(o.fr || '')}" data-ffnombre="${esc(o.nm || '')}">🦺 Registrar ATS de este plantío</button>` : '';
  }
  function htmlDetail(o) {
    const q = o.q, w = warnings(o);
    return htmlAtsBtn(o) + `<div class="kv"><span>Fecha de corte</span><span>${o.fc || '—'}</span><span>Frente / Semana / Sec.</span><span>${fmt(o.fr)} / ${fmt(o.sem)} / ${fmt(o.sec)}</span>
      <span>Variedad / N. cortes</span><span>${fmt(o.var)} / ${fmt(o.nc)}</span><span>TCH (TM/ha)</span><span>${fmt(o.tch)}</span>
      <span>Región / Tenencia</span><span>${fmt(o.reg)} / ${fmt(o.ten)}</span><span>Tipo corte / carretas</span><span>${fmt(o.tc)} / ${fmt(o.car)}</span>
      <span>Ubicación / Mulero</span><span>${fmt(o.ubi)} / ${fmt(o.mul)}</span></div>
      <div class="sec">Distancia ingenio → plantío</div>
      <div class="kv"><span>Por ruta de entrada</span><span>${o.dE == null ? '—' : fmt(o.dE, 2) + ' km'}</span><span>Por ruta de salida</span><span>${o.dS == null ? '—' : fmt(o.dS, 2) + ' km'}</span>
      <span>Promedio</span><span><b>${o.dP == null ? '—' : fmt(o.dP, 2) + ' km'}</b></span><span>Dist Km / KM Mapeado (programa)</span><span>${fmt(o.dkm, 2)} / ${fmt(o.dkmm, 2)}</span>
      <span>TM·km a transportar</span><span>${fmt(o.tmkm, 0)}</span></div>
      <div class="sec">Control del mapeo</div>
      <div class="kv"><span>Rajas (dentro del lote)</span><span>${q.nR}${q.rin == null ? '' : ' (' + Math.round(q.rin * 100) + ' %)'}</span><span>Autovolteo</span><span>${q.av ? 'Sí' : 'No'}</span></div>
      ${w.length ? w.map(x => `<div class="warn">${x}</div>`).join('') : (o.src ? '<div class="ok">Mapeo completo: entrada, salida y rajas presentes.</div>' : '')}`;
  }
  const swatch = c => { const st = c.estilo, ic = c.tipo === 'p' ? iconoDe(c) : null;
    return ic ? `<img class="icoc" src="${ic.src}" alt="">` : c.tipo === 'p' ? `<span class="dotc" style="background:${st.relleno};border-color:${st.color}"></span>`
      : c.tipo === 'a' ? `<span class="polc" style="border-color:${st.color};background:${st.relleno || st.color}33"></span>`
      : `<span class="sw${st.dash ? ' d' : ''}" style="background:${st.color};color:${st.color}"></span>`; };
  function htmlCapas(o) {
    const near = o ? capasCerca(o) : null;
    return `<div class="sec">Capas de apoyo</div><div class="lg">${CAPS.map(c => `<label title="${vis.xall ? 'Modo todo el mapa' : reglaSobre(c) ? 'Solo lo que cae sobre el plantío seleccionado' : 'A ≤ ' + c.radio + ' m del plantío' + (c.vinculo ? ' o con su código' : '')}"><input type="checkbox" data-v="x${c.id}" ${vis['x' + c.id] ? 'checked' : ''}>${swatch(c)}<span>${esc(c.nombre)}</span><span class="cnt">${!o || vis.xall ? '·' : near[c.id].length}</span></label>`).join('')}</div>
      <label class="chk"><input type="checkbox" data-v="xall" ${vis.xall ? 'checked' : ''}> Ver capas de todo el mapa (zoom 14+), no solo cerca del plantío</label>`;
  }
  /** Panel de configuración de capas (independiente de la ficha del plantío). Los conteos son del plantío seleccionado. */
  function htmlPanelCapas() {
    const o = cur, cnt = {}; if (o) o.f.forEach(f => { const k = (f.t === 'l' ? 'l' : f.t === 'p' ? 'p' : 'a') + f.c; cnt[k] = (cnt[k] || 0) + 1; });
    const num = k => o ? (cnt[k] || 0) : '·';
    return `<div class="presets"><span>Mi vista</span><button type="button" data-preset="rutas">Solo rutas</button><button type="button" data-preset="operativa">Operativa</button><button type="button" data-preset="todo">Todo</button></div>
      <div class="sec">Rutas y puntos del plantío</div>
      <div class="lg">${Object.entries(CAT).map(([k, v]) => `<label><input type="checkbox" data-v="l${k}" ${vis['l' + k] ? 'checked' : ''}><span class="sw${v[3] ? ' d' : ''}" style="background:${v[1]};color:${v[1]}"></span><span>${v[0]}</span><span class="cnt">${num('l' + k)}</span></label>`).join('')}
      ${Object.entries(PCAT).map(([k, v]) => `<label><input type="checkbox" data-v="p${k}" ${vis['p' + k] ? 'checked' : ''}><span>${k === 'R' ? '<div class="rmk sm"><i>R</i></div>' : `<div class="${v[1]} sm"></div>`}</span><span>${v[0]}</span><span class="cnt">${num('p' + k)}</span></label>`).join('')}</div>
      <label class="chk"><input type="checkbox" data-v="lblHa" ${vis.lblHa ? 'checked' : ''}> Hectáreas de cada cuadro (etiquetas)</label>
      <label class="chk"><input type="checkbox" data-v="ref" ${vis.ref ? 'checked' : ''}> Superponer mapeo 25-26 (punteado)</label>
      ${CAPS.length ? htmlCapas(o) : ''}
      <div class="pstate" data-s="${prefsDirty ? 'pend' : 'ok'}">${PSTATE[prefsDirty ? 'pend' : 'ok']}</div>`;
  }
  function bindCapas(root) {
    root.querySelectorAll('input[data-v]').forEach(i => i.onchange = () => { vis[i.dataset.v] = i.checked; redibujar(); prefsChanged(); });
    root.querySelectorAll('button[data-preset]').forEach(b => b.onclick = () => { applyPreset(b.dataset.preset); syncChecks(); redibujar(); prefsChanged(); });
  }
  function htmlForm(o) {
    const v = valOf(o.id), today = new Date().toISOString().slice(0, 10);
    if (sess && !puede('responder')) return `<div class="vlast">${v ? `${valTag(v)} ${esc(v.u || '')} ${v.t ? esc(String(v.t).slice(0, 16).replace('T', ' ')) : ''}${v.n ? `<div class="vnote">“${esc(v.n)}”</div>` : ''}` : 'Sin respuesta registrada.'}</div><div class="ok">${sess.rol === 'Consulta' ? 'Tu rol es de consulta: puedes ver rutas y estados, pero no registrar respuestas.' : 'El registro de la planificación está deshabilitado para tu usuario: puedes ver rutas y estados.'}</div>`;
    return `<div class="vform">
      ${v ? `<div class="vlast">${valTag(v)} ${esc(v.u || '')} ${v.t ? esc(String(v.t).slice(0, 16).replace('T', ' ')) : ''}${v.n ? `<div class="vnote">“${esc(v.n)}”</div>` : ''}</div>` : ''}
      <div class="vbtns"><button type="button" class="vb vok" data-r="Según lo planificado">Se trabajó según lo planificado</button>
      <button type="button" class="vb vdi" data-r="Diferente">Se trabajó diferente</button></div>
      <div class="vdet" hidden>
        <div class="asp">${ASPECTOS.map(a => `<label><input type="checkbox" value="${a}"> ${a}</label>`).join('')}</div>
        <textarea class="vnota" rows="3" placeholder="¿Por qué se está trabajando diferente? (obligatorio)"></textarea>
      </div>
      <div class="vrow"><label>Fecha de trabajo <input type="date" class="vfecha" value="${today}"></label>
        <label class="chk"><input type="checkbox" class="vpos" ${L.Browser.mobile ? 'checked' : ''}> Adjuntar mi ubicación GPS</label></div>
      <button type="button" class="vsend primary" disabled>Enviar a Google Sheets</button>
      <div class="vmeta">${esc(metaText())}</div></div>`;
  }
  function bind(root, o) {
    const f = root.querySelector('.vform'); if (!f) return;
    let res = null; const send = f.querySelector('.vsend'), det = f.querySelector('.vdet'), nota = f.querySelector('.vnota');
    const upd = () => { send.disabled = !res || (res === 'Diferente' && nota.value.trim().length < 5); };
    f.querySelectorAll('.vb').forEach(b => b.onclick = () => { res = b.dataset.r; f.querySelectorAll('.vb').forEach(x => x.classList.toggle('on', x === b));
      det.hidden = res !== 'Diferente'; if (res === 'Diferente') nota.focus(); upd(); });
    nota.oninput = upd;
    f.querySelector('.vpos').onchange = e => { if (e.target.checked && (!lastPos || Date.now() - lastPos.t > 600000)) locate(true); };
    if (f.querySelector('.vpos').checked && (!lastPos || Date.now() - lastPos.t > 600000)) locate(true);
    send.onclick = () => {
      const asp = [...f.querySelectorAll('.asp input:checked')].map(i => i.value);
      const pos = f.querySelector('.vpos').checked;
      if (submit(o, res, asp, nota.value, f.querySelector('.vfecha').value, pos)) emit('select', o);
    };
  }

  return {META: META || {}, D, byId, F, CAT, PCAT, FLAGS, vis, cfg, esc, fmt, init: initMap, select, step, fitLocal, fitAll, applyFilters, options, csv, flush, refreshStatus,
    saveCfg, locate, on, savePrefs, hasFilters, clearFilters, CAPS, capasCerca, setCapas, cercaCapa, _t: {fraccionSobre, distPlantio, capaBBox, reglaSobre, tipPlantio, submit, setPermMs: ms => { permMs = ms; armarPerm(); }, olvidarSync: () => { ultimoSync = 0; }, get etiquetas() { return ETQ.ultimo; }, dibujarEtiquetas}, valOf, valTag, srcTag, htmlKpis, htmlDetail, htmlPanelCapas, bindCapas, htmlForm, bind, kmFlag,
    cargarPrograma, get programa() { return PROG; }, get programaDoc() { return PROG_DOC; },
    get etqPref() { return {...aj}; }, setEtq, get maeVersion() { return mvServidor; },
    auth: {logged, login, logout, changePassword, get sess() { return sess; }, puede, puedeCsv, canSubmit: () => puede('responder')},
    api: (accion, datos) => api(accion, datos || {}, true),
    get filtered() { return filtered; }, get cur() { return cur; }, get queueLen() { return queue.length; }, get map() { return map; }};
})();
return App;
}
