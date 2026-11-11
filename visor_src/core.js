/* Núcleo compartido: datos, mapa, filtros, CSV, Google Sheets (con cola offline) y GPS. */
const CONFIG = /*__CONFIG__*/{url:'',data:''};
let App;
function createApp(RAW, META) {
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
    ctx = L.layerGroup().addTo(map); sel = L.layerGroup().addTo(map);
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
    const H = ['Código','Nombre','Frente','Semana','Secuencia','Fecha corte','Variedad','N. cortes','Ha','Toneladas','TCH','Región','Tenencia','Municipio','Tipo de corte',
      'Carretas','Ubicación','Mulero','Mapeo usado','Km ingenio-lote (entrada)','Km ingenio-lote (salida)','Km ingenio-lote (promedio)','Dist Km (programa)',
      'Dist KM Mapeado (programa)','Dif. % vs Dist KM Mapeado','TM·km','Rajas','% rajas dentro del lote','Autovolteo','Alertas','Validación','Nota validación','Usuario validación','Fecha validación'];
    const cell = v => { if (v == null) return ''; const s = String(v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const rows = filtered.map(o => { const v = valOf(o.id) || {};
      return [o.id, o.nm, o.fr, o.sem, o.sec, o.fc, o.var, o.nc, o.ha, o.tm, o.tch, o.reg, o.ten, o.mun, o.tc, o.car, o.ubi, o.mul, o.src || 'Sin mapeo',
        o.dE, o.dS, o.dP, o.dkm, o.dkmm, o.dif, o.tmkm, o.q.nR, o.q.rin == null ? '' : Math.round(o.q.rin * 100), o.q.av ? 'Sí' : 'No',
        o.flags.map(f => FLAGS[f] || f).concat(kmFlag(o) ? ['Distancia difiere >15%'] : []).join(' | '),
        v.r ? (v.pend ? v.r + ' (pendiente de envío)' : v.r) : '', v.n || '', v.u || '', v.t || ''].map(cell).join(','); });
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
    LS.set(pkey('prefs'), {...vis}); syncChecks(); if (cur) draw(cur); emit('prefs');
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
  const PRESETS = {rutas: ['lE', 'lS'], operativa: ['lE', 'lS', 'lME', 'lMS', 'lAV', 'pR'], todo: PREF_KEYS.filter(k => k !== 'ref')};
  function applyPreset(n) { const on = new Set(PRESETS[n] || []); PREF_KEYS.forEach(k => { if (k !== 'ref') vis[k] = on.has(k); }); }

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
  function htmlLayers(o) {
    const cnt = {}; o.f.forEach(f => { const k = (f.t === 'l' ? 'l' : f.t === 'p' ? 'p' : 'a') + f.c; cnt[k] = (cnt[k] || 0) + 1; });
    return `<div class="presets"><span>Mi vista</span><button type="button" data-preset="rutas">Solo rutas</button><button type="button" data-preset="operativa">Operativa</button><button type="button" data-preset="todo">Todo</button></div>
      <div class="lg">${Object.entries(CAT).map(([k, v]) => `<label><input type="checkbox" data-v="l${k}" ${vis['l' + k] ? 'checked' : ''}><span class="sw${v[3] ? ' d' : ''}" style="background:${v[1]};color:${v[1]}"></span><span>${v[0]}</span><span class="cnt">${cnt['l' + k] || 0}</span></label>`).join('')}
      ${Object.entries(PCAT).map(([k, v]) => `<label><input type="checkbox" data-v="p${k}" ${vis['p' + k] ? 'checked' : ''}><span>${k === 'R' ? '<div class="rmk sm"><i>R</i></div>' : `<div class="${v[1]} sm"></div>`}</span><span>${v[0]}</span><span class="cnt">${cnt['p' + k] || 0}</span></label>`).join('')}</div>
      ${o.ref ? `<label class="chk"><input type="checkbox" data-v="ref" ${vis.ref ? 'checked' : ''}> Superponer mapeo 25-26 (punteado)</label>` : ''}
      <div class="pstate" data-s="${prefsDirty ? 'pend' : 'ok'}">${PSTATE[prefsDirty ? 'pend' : 'ok']}</div>`;
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
    root.querySelectorAll('input[data-v]').forEach(i => i.onchange = () => { vis[i.dataset.v] = i.checked; draw(o); prefsChanged(); });
    root.querySelectorAll('button[data-preset]').forEach(b => b.onclick = () => { applyPreset(b.dataset.preset); syncChecks(); draw(o); prefsChanged(); });
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
    saveCfg, locate, on, savePrefs, hasFilters, clearFilters, valOf, valTag, srcTag, htmlKpis, htmlDetail, htmlLayers, htmlForm, bind, kmFlag,
    auth: {logged, login, logout, changePassword, get sess() { return sess; }, canSubmit: () => logged() && sess.rol !== 'Consulta'},
    get filtered() { return filtered; }, get cur() { return cur; }, get queueLen() { return queue.length; }, get map() { return map; }};
})();
return App;
}
