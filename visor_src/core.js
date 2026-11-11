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
  const vis = Object.fromEntries([...Object.keys(CAT).map(k => ['l' + k, true]), ...Object.keys(PCAT).map(k => ['p' + k, true]), ['ref', false]]);
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
    for (const poly of o._rings) { const r = poly[0];
      for (let i = 1; i < r.length; i++) { const d = dSeg((r[i - 1][1] - lo) * KLON, (r[i - 1][0] - la) * KLAT, (r[i][1] - lo) * KLON, (r[i][0] - la) * KLAT); if (d < best) best = d; } }
    return best;
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
  const poligonoCerca = (o, ll, rad) => lineaCerca(o, ll, rad) || (o._cen && pip(o._cen, ll));
  function capasCerca(o) {                             // por capa: entidades dentro del radio O con el código del plantío
    if (o._cap) return o._cap;
    const res = {};
    CAPS.forEach(c => {
      capaPrep(c); const rad = c.radio, idx = new Set();
      if (o._bb) {
        capaBBox(c, o._bb[0] - rad / KLAT, o._bb[1] - rad / KLON, o._bb[2] + rad / KLAT, o._bb[3] + rad / KLON).forEach(i => {
          if (c.tipo === 'p' ? distPlantio(o, c._lat[i], c._lon[i]) <= rad : c.tipo === 'l' ? lineaCerca(o, c._ln[i], rad) : poligonoCerca(o, c._ln[i], rad)) idx.add(i);
        });
      }
      if (c._byLink && c._byLink.has(o.id)) c._byLink.get(o.id).forEach(i => idx.add(i));
      res[c.id] = [...idx];
    });
    return (o._cap = res);
  }
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
  const capasDibujar = (o, grp) => { const near = capasCerca(o); CAPS.forEach(c => { if (vis['x' + c.id]) near[c.id].forEach(i => capaAdd(c, i, grp)); }); };
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
  const redibujar = () => { if (cur) draw(cur); capasTodo(); };
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
    const all = L.latLngBounds();
    D.forEach(o => { if (!o._rings.length) return;
      const lay = L.polygon(o._rings, {color: SRC_COL[o.src], weight: 1, fillOpacity: .12, opacity: .8});
      lay.on('click', () => select(o.id)); if (!L.Browser.mobile) lay.bindTooltip(`${o.id} ${esc(o.nm)}`, {sticky: true});
      lay.addTo(ctx); all.extend(lay.getBounds()); o._ctx = lay; });
    map.fitBounds(all); return map;
  }
  const kmLen = ll => { let d = 0; for (let i = 1; i < ll.length; i++) d += map.distance(ll[i - 1], ll[i]); return d / 1000; };
  const icon = c => L.divIcon({className: '', html: c === 'R' ? '<div class="rmk"><i>R</i></div>' : `<div class="${PCAT[c][1]}"></div>`, iconSize: [18, 18], iconAnchor: c === 'R' ? [9, 20] : [9, 9]});
  function draw(o) {
    sel.clearLayers(); const local = L.latLngBounds(), all = L.latLngBounds();
    o.pol.forEach((p, i) => { const pl = L.polygon(o._rings[i], {color: '#ffe14d', weight: 3, fillColor: '#ffe14d', fillOpacity: .15})
      .bindTooltip(`Cuadro ${esc(p.q)} · ${p.ha} ha`, {sticky: true}).addTo(sel); local.extend(pl.getBounds()); all.extend(pl.getBounds()); });
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
    curLocal = local.isValid() ? local : all; curAll = all;
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
    emit('filtered', filtered); return filtered;
  }
  const options = k => [...new Set(D.map(o => o[k]).filter(v => v != null && v !== ''))].sort((a, b) => a > b ? 1 : -1);

  // ---------- CSV ----------
  function csv() {
    const CSVCAP = CAPS.filter(c => ['postes', 'valvulas', 'obstaculos', 'pozos'].includes(c.id));
    const H = ['Código','Nombre','Frente','Semana','Secuencia','Fecha corte','Variedad','N. cortes','Ha','Toneladas','TCH','Región','Tenencia','Municipio','Tipo de corte',
      'Carretas','Ubicación','Mulero','Mapeo usado','Km ingenio-lote (entrada)','Km ingenio-lote (salida)','Km ingenio-lote (promedio)','Dist Km (programa)',
      'Dist KM Mapeado (programa)','Dif. % vs Dist KM Mapeado','TM·km','Rajas','% rajas dentro del lote','Autovolteo','Alertas','Validación','Nota validación','Usuario validación','Fecha validación', ...CSVCAP.map(c => `${c.nombre} cercanos (≤${c.radio} m)`)];
    const cell = v => { if (v == null) return ''; const s = String(v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const rows = filtered.map(o => { const v = valOf(o.id) || {};
      return [o.id, o.nm, o.fr, o.sem, o.sec, o.fc, o.var, o.nc, o.ha, o.tm, o.tch, o.reg, o.ten, o.mun, o.tc, o.car, o.ubi, o.mul, o.src || 'Sin mapeo',
        o.dE, o.dS, o.dP, o.dkm, o.dkmm, o.dif, o.tmkm, o.q.nR, o.q.rin == null ? '' : Math.round(o.q.rin * 100), o.q.av ? 'Sí' : 'No',
        o.flags.map(f => FLAGS[f] || f).concat(kmFlag(o) ? ['Distancia difiere >15%'] : []).join(' | '),
        v.r ? (v.pend ? v.r + ' (pendiente de envío)' : v.r) : '', v.n || '', v.u || '', v.t || '', ...CSVCAP.map(c => capasCerca(o)[c.id].length)].map(cell).join(','); });
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
  const setSess = x => { sess = x; LS.set('sess', x); };
  async function api(action, body = {}, authed = true) {
    if (!cfg.url) return {ok: false, error: 'Falta configurar la URL del servidor de usuarios (Apps Script).'};
    const payload = {action, ...body}; if (authed && sess) payload.token = sess.token;
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 30000);
    try {
      const r = await fetch(cfg.url, {method: 'POST', body: JSON.stringify(payload), signal: ctl.signal});
      const j = await r.json();
      if (j && j.code === 'sesion' && authed) { setSess(null); emit('logout', j.error); }
      return j;
    } finally { clearTimeout(t); }
  }

  // ---------- capas del mapa: configuración personal del usuario ----------
  const PREF_KEYS = Object.keys(vis);
  const pkey = k => 'u_' + (sess ? sess.user : '_') + '_' + k;
  let prefsDirty = false, prefTimer = null;
  const PSTATE = {ok: 'Tu vista se guarda en tu perfil y aplica a todos los plantíos.', pend: 'Guardando tu vista…',
    off: 'Sin conexión: tu vista se guardará al reconectar.', err: 'No se pudo guardar tu vista.'};
  const setPState = st => { document.querySelectorAll('.pstate').forEach(el => { el.dataset.s = st; el.textContent = PSTATE[st]; }); };
  const syncChecks = () => document.querySelectorAll('input[data-v]').forEach(i => { i.checked = !!vis[i.dataset.v]; });
  function loadPrefsLocal() {
    const p = LS.get(pkey('prefs'), null); if (p) PREF_KEYS.forEach(k => { if (k in p) vis[k] = !!p[k]; });
    prefsDirty = LS.get(pkey('dirty'), false);
  }
  loadPrefsLocal();
  function applyPrefs(p) {
    if (!p || prefsDirty) return;                       // si hay cambios locales sin enviar, no se pisan
    PREF_KEYS.forEach(k => { if (k in p) vis[k] = !!p[k]; });
    LS.set(pkey('prefs'), {...vis}); syncChecks(); redibujar(); emit('prefs');
  }
  async function savePrefs() {
    if (!logged()) return;
    const snap = JSON.stringify(vis);
    try {
      const j = await api('prefs_set', {prefs: {...vis}});
      if (j.ok) { if (JSON.stringify(vis) === snap) { prefsDirty = false; LS.set(pkey('dirty'), false); setPState('ok'); } }
      else if (j.code !== 'sesion') setPState('err');
    } catch { setPState('off'); }
  }
  function prefsChanged() {
    LS.set(pkey('prefs'), {...vis}); prefsDirty = true; LS.set(pkey('dirty'), true);
    setPState('pend'); clearTimeout(prefTimer); prefTimer = setTimeout(savePrefs, 1200);
  }
  const PRESETS = {rutas: ['lE', 'lS'], operativa: ['lE', 'lS', 'lME', 'lMS', 'lAV', 'pR', 'xpostes', 'xvalvulas', 'xobstaculos', 'xpozos'], todo: PREF_KEYS.filter(k => k !== 'ref' && k !== 'xall')};
  function applyPreset(n) { const on = new Set(PRESETS[n] || []); PREF_KEYS.forEach(k => { if (k !== 'ref' && k !== 'xall') vis[k] = on.has(k); }); }

  async function login(usuario, clave) {
    const j = await api('login', {usuario, clave}, false);
    if (!j.ok || j.cambiar) return j;
    setSess({token: j.token, exp: j.exp, user: j.usuario, nombre: j.nombre, rol: j.rol});
    loadPrefsLocal(); applyPrefs(j.prefs);
    emit('login', sess); flush(); refreshStatus();
    return j;
  }
  const changePassword = (usuario, actual, nueva) => api('cambiar_clave', {usuario, actual, nueva}, false);
  function logout() { clearTimeout(prefTimer); if (prefsDirty) savePrefs(); setSess(null); emit('logout', ''); }

  // ---------- respuestas en Google Sheets (cola sin conexión, ligada al usuario) ----------
  const metaText = () => 'Responde: ' + (sess ? sess.nombre + ' (' + sess.rol + ')' : '—') + (queue.length ? ' · ' + queue.length + ' pendiente(s) de envío' : '');
  let flushing = false;
  async function flush() {
    const mine = logged() ? queue.filter(r => r.uid === sess.user) : [];
    if (logged() && prefsDirty && !prefTimer) savePrefs();
    if (flushing || !mine.length) { emit('queue', queue.length); return; }
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
      } else if (j.code !== 'sesion') emit('toast', j.error || 'El servidor rechazó el envío');
    } catch (e) { emit('toast', 'Sin conexión con Google Sheets: las respuestas quedan guardadas para reenvío'); }
    finally { flushing = false; emit('queue', queue.length); }
  }
  async function refreshStatus() {
    if (!cfg.url || !logged()) return;
    try {
      const j = await api('sync');
      if (j.ok) {
        remote = {}; Object.entries(j.status || {}).forEach(([k, v]) => remote[String(k).padStart(5, '0')] = v);
        if (j.rol && (sess.rol !== j.rol || sess.nombre !== j.nombre)) setSess({...sess, rol: j.rol, nombre: j.nombre});
        applyPrefs(j.prefs); emit('status');
      }
    } catch {}
  }
  function submit(o, resultado, aspectos, nota, fechaReal, withPos) {
    if (!logged()) { emit('needLogin'); return false; }
    if (sess.rol === 'Consulta') { emit('toast', 'Tu rol es de consulta: no puede registrar respuestas.'); return false; }
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
  function htmlDetail(o) {
    const q = o.q, w = warnings(o);
    return `<div class="kv"><span>Fecha de corte</span><span>${o.fc || '—'}</span><span>Frente / Semana / Sec.</span><span>${fmt(o.fr)} / ${fmt(o.sem)} / ${fmt(o.sec)}</span>
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
    return `<div class="sec">Capas de apoyo</div><div class="lg">${CAPS.map(c => `<label title="${vis.xall ? 'Modo todo el mapa' : 'A ≤ ' + c.radio + ' m del plantío' + (c.vinculo ? ' o con su código' : '')}"><input type="checkbox" data-v="x${c.id}" ${vis['x' + c.id] ? 'checked' : ''}>${swatch(c)}<span>${esc(c.nombre)}</span><span class="cnt">${!o || vis.xall ? '·' : near[c.id].length}</span></label>`).join('')}</div>
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
    if (sess && sess.rol === 'Consulta') return `<div class="vlast">${v ? `${valTag(v)} ${esc(v.u || '')} ${v.t ? esc(String(v.t).slice(0, 16).replace('T', ' ')) : ''}${v.n ? `<div class="vnote">“${esc(v.n)}”</div>` : ''}` : 'Sin respuesta registrada.'}</div><div class="ok">Tu rol es de consulta: puedes ver rutas y estados, pero no registrar respuestas.</div>`;
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
    saveCfg, locate, on, savePrefs, hasFilters, clearFilters, CAPS, capasCerca, setCapas, valOf, valTag, srcTag, htmlKpis, htmlDetail, htmlPanelCapas, bindCapas, htmlForm, bind, kmFlag,
    auth: {logged, login, logout, changePassword, get sess() { return sess; }, canSubmit: () => logged() && sess.rol !== 'Consulta'},
    get filtered() { return filtered; }, get cur() { return cur; }, get queueLen() { return queue.length; }, get map() { return map; }};
})();
return App;
}
