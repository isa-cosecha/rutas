/* Formularios de campo (combustible, recorrido de motos, seguimiento de administradores, ATS) como módulo de la plataforma.
 * Comparte con el mapa el inicio de sesión, el servidor y los permisos (App.auth / App.api). Se dibuja dentro de un Shadow DOM,
 * así que sus estilos e identificadores no se mezclan con los del mapa. Sin conexión funciona con catálogos y cola guardados
 * en el teléfono; cada registro lleva un identificador único, por lo que un reenvío nunca duplica. */
let Forms;
function initForms() {
const A = App; let ROOT = null, HOST = null;
const me = () => A.auth.sess || {};
const APP_VERSION = '3.0.0';
// Avisos "valor inusual" (el usuario puede confirmar). Salen de los percentiles 1 y 99 del histórico real, con margen.
const AVISOS = {litrosPlanta: [0.5, 10], litrosMoto: [1, 20], recorridoMax: 300, hrs: [5, 250], tm: [20, 6000], ltHr: [10, 450], ltTm: [0.1, 120], tmHrsMotor: [0, 400], odoSalto: 400,
  // camionetas alquiladas (percentiles de los 678 + 1,763 registros históricos): galones 5.6-19, avance entre cargas hasta ~1,360 km, 17-102 km por galón, recorridos hasta ~320 km
  camGal: [3, 30], odoSaltoCam: 2000, kmGal: [10, 130], recorridoCam: 450};
const MODS = {
  combustible: {titulo: 'Combustible', icono: '⛽', acc: 'var(--azul)'},
  motos: {titulo: 'Motos', icono: '🏍️', acc: 'var(--ama)'},
  admin: {titulo: 'Administradores', icono: '📊', acc: 'var(--cian)'},
  ats: {titulo: 'ATS', icono: '🦺', acc: 'var(--verde)'},
  camcomb: {titulo: 'Cam. combustible', icono: '🛻', acc: 'var(--azul)'},
  camrec: {titulo: 'Cam. recorrido', icono: '🧭', acc: 'var(--ama)'}
};


/* ======================================================================== UTILIDADES */
const $ = (s, r = ROOT) => r.querySelector(s), $$ = (s, r = ROOT) => [...r.querySelectorAll(s)];
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const uuid = () => 'uuid:' + (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
const LS = {get(k, d) { try { const v = localStorage.getItem('ff_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('ff_' + k, JSON.stringify(v)); } catch {} }, del(k) { try { localStorage.removeItem('ff_' + k); } catch {} }};
const fmt = n => (Math.round(n * 10) / 10).toLocaleString('es-NI');
function toast(m, ms = 3200) { if (!ROOT) { if (typeof UI !== 'undefined') UI.toast(m, ms); return; }   // pantalla de formularios aún no abierta (p. ej. envío en segundo plano tras refrescar): se usa el aviso del mapa
  const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), ms); }
const S = {formularios: [], pre: null, mae: null, odo: {}, cfg: {}, hoy: null, cola: LS.get('cola', []), hist: LS.get('hist', []), vista: 'combustible', enviando: false, online: navigator.onLine, plantios: {}, mensajeRed: '', odoLocal: {}, maeProm: null};

/* fecha/turno/zafra por defecto */
function turnoActual() { const h = new Date().getHours(); return (h >= 6 && h < 18) ? 'Dia' : 'Noche'; }
function fechaPorDefecto(turno) { const d = new Date(); if (turno === 'Noche' && d.getHours() < 6) d.setDate(d.getDate() - 1); return ymd(d); }   // la noche después de medianoche pertenece al turno del día anterior
function zafraDe(fecha) { const [y, m] = fecha.split('-').map(Number), a = m >= 10 ? y : y - 1, z = `${a}-${a + 1}`; return (S.mae && S.mae.zafras.includes(z)) ? z : (S.mae ? S.mae.zafras[S.mae.zafras.length - 1] : z); }
function semanaSugerida(zafra, fecha) { const ini = S.mae && S.mae.zafras_inicio && S.mae.zafras_inicio[zafra]; if (!ini) return null; const n = Math.floor((new Date(fecha + 'T00:00:00') - new Date(ini + 'T00:00:00')) / (7 * 86400000)) + 1; return (n >= 1 && n <= 60 && S.mae.semanas.some(s => s.id === n)) ? n : null; }


/* ======================================================================== API */
const api = (accion, cuerpo) => A.api(accion, cuerpo || {});   // el núcleo agrega el token y, si la sesión venció, pide entrar de nuevo
function marcarRed(ok) { S.online = ok; if (!ROOT) return; $('#estado').classList.toggle('off', !ok); $('#estado span').textContent = ok ? 'En línea' : 'Sin conexión'; }
window.addEventListener('online', () => { marcarRed(true); if (A.auth.logged()) { sincronizar(); cargarMaestros(); } });
window.addEventListener('offline', () => marcarRed(false));
document.addEventListener('visibilitychange', () => { if (!document.hidden && A.auth.logged()) sincronizar(); });

/* ======================================================================== MAESTROS */
const MAE_FRESCO_MS = 10 * 60 * 1000;   // los catálogos guardados se consideran al día durante 10 minutos
/** Aplica los catálogos guardados en el teléfono (sin red). Devuelve true si había. */
function leerCacheMae() {
  if (S.mae) return true;
  const c = LS.get('mae', null); if (!c) return false;
  S.mae = c.mae; S.odo = Object.assign({}, c.odo, S.odo); S.cfg = c.cfg; S.hoy = c.hoy; S.maeT = c.t; S.mv = c.mv; if (!c.mae || !c.mae.supervisores) S.maeT = 0; return true;   // sin la lista de supervisores = catálogo de una versión anterior: se refresca ya
}
/** Un odómetro guardado en este teléfono y todavía sin enviar manda sobre lo que diga el servidor (que aún no lo conoce). */
function mezclarOdo(servidor) {
  const o = Object.assign({}, servidor);
  Object.keys(S.odoLocal).forEach(k => { const l = S.odoLocal[k]; if (S.cola.some(x => x.id === l.id)) o[k] = l.v; else delete S.odoLocal[k]; });
  return o;
}
const zafraCalendario = f => { const [y, m] = f.split('-').map(Number), a = m >= 10 ? y : y - 1; return `${a}-${a + 1}`; };
/** Catálogos (y plantíos de la zafra) desde el servidor. Una sola consulta a la vez; si lo guardado es reciente no se consulta. */
function cargarMaestros(forzar) {
  leerCacheMae();
  if (!A.auth.logged() || !navigator.onLine) return Promise.resolve();
  if (S.mae && !forzar && Date.now() - (S.maeT || 0) < MAE_FRESCO_MS) return Promise.resolve();
  if (S.maeProm) return S.maeProm;
  S.maeProm = (async () => {
    try {
      const j = await api('form_maestros', {zafra: zafraCalendario(ymd(new Date()))});
      if (!j.ok) return;
      marcarRed(true); S.mae = j.maestros; S.odo = mezclarOdo(j.odometros); S.cfg = j.config; S.hoy = j.hoy; S.maeT = Date.now(); S.mv = j.mv;
      LS.set('mae', {mae: S.mae, odo: S.odo, cfg: S.cfg, hoy: S.hoy, t: S.maeT, mv: S.mv});
      if (j.plantios && j.zafra && !plantiosDelPrograma(j.zafra)) { S.plantios[j.zafra] = j.plantios; LS.set('plan_' + j.zafra, j.plantios); }   // vienen en la misma respuesta
      const hoyDisp = ymd(new Date()); if (S.hoy && Math.abs((new Date(hoyDisp) - new Date(S.hoy)) / 86400000) >= 1) toast('⚠ La fecha de este teléfono (' + hoyDisp + ') no coincide con la del servidor (' + S.hoy + '). Revísala.', 7000);
      if (ROOT) pintarTabs();   // no se redibuja el formulario: se borraría lo que la persona está escribiendo
    } catch (e) { marcarRed(false); } finally { S.maeProm = null; }
  })();
  return S.maeProm;
}
/** Plantíos de la zafra tomados del programa de corte que el mapa ya tiene en el teléfono (sin llamar al servidor). */
function plantiosDelPrograma(zafra) {
  const d = A.programaDoc; if (!d || d.zafra !== zafra || !d.rows || !d.rows.length) return null;
  return d.rows.map(r => [r.id, r.nm || '', r.var || '', r.fr || '', r.sem == null ? '' : r.sem, r.fc || '', r.sec == null ? '' : r.sec, r.ha == null ? '' : r.ha]);
}
async function actualizarPlantios(zafra) { try { const j = await api('form_plantios', {zafra}); if (j.ok) { S.plantios[zafra] = j.plantios; LS.set('plan_' + zafra, j.plantios); } } catch (e) {} }
async function plantiosDe(zafra) {
  const p = plantiosDelPrograma(zafra); if (p) { S.plantios[zafra] = p; return p; }
  if (S.plantios[zafra]) return S.plantios[zafra];
  const c = LS.get('plan_' + zafra, null);
  if (c) { S.plantios[zafra] = c; if (navigator.onLine && A.auth.logged()) actualizarPlantios(zafra); return c; }   // se muestra lo guardado y se refresca en segundo plano
  if (navigator.onLine && A.auth.logged()) await actualizarPlantios(zafra);
  return S.plantios[zafra] || [];
}

/* ======================================================================== COLA DE ENVÍO */
const guardarCola = () => LS.set('cola', S.cola);
function encolar(modulo, datos) {
  const it = {id: uuid(), modulo, datos, uid: me().user, creado: new Date().toISOString(), estado: 'pendiente'}; S.cola.push(it); guardarCola(); pintarBadges(); setTimeout(sincronizar, 50); return it;
}
async function sincronizar() {
  if (S.enviando || !A.auth.logged() || !navigator.onLine) return;
  const mios = () => S.cola.filter(i => i.uid === me().user && i.estado === 'pendiente');
  if (!mios().length) return;
  S.enviando = true; pintarBadges();
  try {
    while (mios().length) {
      const lote = mios().slice(0, 10);
      let j;
      try { j = await api('form_enviar', {items: lote.map(i => ({id: i.id, modulo: i.modulo, datos: i.datos, forzar: !!i.forzar}))}); marcarRed(true); }
      catch (e) { marcarRed(navigator.onLine && false); break; }                    // sin señal: se reintenta solo
      if (!j.ok) { if (j.code === 'sesion') break; lote.forEach(i => { i.estado = 'error'; i.error = j.error || 'Error del servidor'; }); guardarCola(); break; }
      let enviados = 0, odoNuevo = false;
      j.resultados.forEach(r => {
        const it = S.cola.find(x => x.id === r.id); if (!it) return;
        if (r.ok) { S.cola = S.cola.filter(x => x.id !== r.id); enviados++; if (it.modulo === 'motos' || it.modulo === 'combustible' || it.modulo === 'camcomb' || it.modulo === 'camrec') odoNuevo = true; if (!r.duplicado || !S.hist.some(h => h.id === r.id)) { S.hist.unshift({id: r.id, t: new Date().toISOString(), modulo: it.modulo, resumen: resumen(it.modulo, it.datos), fila: r.fila || null, uid: it.uid}); S.hist = S.hist.slice(0, 40); LS.set('hist', S.hist); } }
        else if (r.codigo === 'repetido') { it.estado = 'repetido'; it.error = r.error; }
        else { it.estado = 'error'; it.error = r.error; it.codigo = r.codigo; }
      });
      guardarCola(); if (odoNuevo) cargarMaestros(true);   // el servidor ya conoce el odómetro nuevo: se refresca la sugerencia en segundo plano
      if (enviados) toast(`✓ ${enviados} registro${enviados > 1 ? 's' : ''} enviado${enviados > 1 ? 's' : ''}`);
      if (!lote.some(i => i.estado === 'pendiente') && !j.resultados.length) break;
    }
  } finally { S.enviando = false; pintarBadges(); if (ROOT && S.vista === 'pendientes') pintarVista(); }
}
setInterval(() => { if (A.auth.logged() && S.cola.some(i => i.estado === 'pendiente')) sincronizar(); }, 45000);
function resumen(m, d) {
  const f = d.fecha ? d.fecha.slice(8) + '/' + d.fecha.slice(5, 7) : '';
  if (m === 'combustible') return `${f} ${d.turno} · ${d.tipo === 'moto' ? d.motor + ' (moto)' : d.cisterna + ' → ' + d.motor} · ${d.litros} L`;
  if (m === 'motos') return `${f} ${d.turno} · ${d.equipo} · ${d.odo_i} → ${d.odo_f} (${fmt(d.odo_f - d.odo_i)} km)`;
  if (m === 'camcomb') return `${f} ${d.turno} · ${d.equipo} · ${d.cantidad} gal · ${d.odometro} km`;
  if (m === 'camrec') return `${f} ${d.turno} · ${d.equipo} · ${d.odo_i} → ${d.odo_f} (${fmt(d.odo_f - d.odo_i)} km)`;
  if (m === 'admin') { const a = S.mae && S.mae.administradores.find(x => x.id === Number(d.administrador)); return `${f} · ${d.frente} · semana ${d.semana} · ${a ? a.text : d.administrador}`; }
  return `${f} ${d.turno} · ${d.frente} · plantío ${String(d.plantio).padStart(5, '0')}`;
}
const pendMios = () => S.cola.filter(i => i.uid === me().user);


/* ======================================================================== COMPONENTES */
function confirmar(titulo, lineas, si = 'Confirmar y guardar', no = 'Revisar') {
  return new Promise(res => { $('#mdT').textContent = titulo; $('#mdL').innerHTML = lineas.map(l => `<li>${esc(l)}</li>`).join(''); $('#mdSi').textContent = si; $('#mdNo').textContent = no; $('#modal').classList.add('on');
    const fin = v => { $('#modal').classList.remove('on'); res(v); }; $('#mdSi').onclick = () => fin(true); $('#mdNo').onclick = () => fin(false); });
}
/** Selector a pantalla completa con buscador. opciones: [{valor, texto, sub}]. libre(texto) → {valor, texto} | null para aceptar lo escrito. */
function elegir(titulo, opciones, libre) {
  return new Promise(res => {
    const sh = $('#sheet'), q = $('#shQ'), L = $('#shL'), lb = $('#shLibre'), todas = typeof opciones === 'function' ? opciones : () => opciones;   // opciones: lista, o función de lo que se escribe en el buscador
    $('#shT').textContent = titulo; q.value = ''; sh.classList.add('on');
    const cerrar = v => { sh.classList.remove('on'); res(v); };
    const pintar = () => {
      const t = q.value.trim().toLowerCase(), v = todas(t).filter(o => !t || (o.texto + ' ' + (o.sub || '') + ' ' + o.valor).toLowerCase().includes(t)).slice(0, 120);
      L.innerHTML = v.map((o, i) => `<button type="button" class="op" data-i="${i}">${esc(o.texto)}${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</button>`).join('') || '<div class="vacio-msg">Sin coincidencias</div>';
      $$('.op', L).forEach(b => b.onclick = () => cerrar(v[Number(b.dataset.i)]));
      const l = libre && t ? libre(q.value.trim()) : null; lb.hidden = !l;
      if (l) { lb.innerHTML = `<button type="button" class="btn sec">Usar "${esc(l.texto)}"${l.aviso ? ' (' + esc(l.aviso) + ')' : ''}</button>`; $('button', lb).onclick = () => cerrar(l); }
    };
    q.oninput = pintar; $('#shX').onclick = () => cerrar(null); pintar(); setTimeout(() => q.focus(), 80);
  });
}
const segHTML = (n, ops) => `<div class="seg" data-seg="${n}">${ops.map(([v, t]) => `<button type="button" data-v="${v}">${t}</button>`).join('')}</div>`;
function segSet(root, n, v) { const s = $(`[data-seg="${n}"]`, root); if (!s) return; $$('button', s).forEach(b => b.classList.toggle('on', b.dataset.v === String(v))); s.dataset.valor = v == null ? '' : v; }
const segGet = (root, n) => ($(`[data-seg="${n}"]`, root) || {dataset: {}}).dataset.valor || '';
function bindSeg(root, n, cb) { const s = $(`[data-seg="${n}"]`, root); $$('button', s).forEach(b => b.onclick = () => { segSet(root, n, b.dataset.v); cb && cb(b.dataset.v); }); }
const selHTML = (n, ph) => `<button type="button" class="sel" data-sel="${n}"><span class="v ph">${esc(ph || 'Elegir…')}</span></button>`;
function selSet(root, n, valor, texto) { const b = $(`[data-sel="${n}"]`, root); if (!b) return; b.dataset.valor = valor == null ? '' : valor; b.dataset.texto = texto || ''; const v = $('.v', b); v.textContent = texto || b.dataset.ph || 'Elegir…'; v.classList.toggle('ph', !valor && valor !== 0); b.classList.remove('inval'); }
const selGet = (root, n) => { const b = $(`[data-sel="${n}"]`, root); return b ? {valor: b.dataset.valor || '', texto: b.dataset.texto || ''} : {valor: '', texto: ''}; };
function bindSel(root, n, titulo, opcionesFn, cb, libreFn) { const b = $(`[data-sel="${n}"]`, root); b.dataset.ph = b.textContent; b.onclick = async () => { const r = await elegir(titulo, opcionesFn, libreFn); if (r) { selSet(root, n, r.valor, r.texto); cb && cb(r); } }; }
const opcSelect = (lista, ph) => `<option value="">${esc(ph || 'Elegir…')}</option>` + lista.map(v => { const [val, txt] = Array.isArray(v) ? v : [v, v]; return `<option value="${esc(val)}">${esc(txt)}</option>`; }).join('');
const campo = (lbl, html, ayuda, id, cls) => `<div class="campo${cls ? ' ' + cls : ''}"${id ? ` id="${id}"` : ''}><label>${lbl}</label>${html}${ayuda ? `<div class="ayuda">${ayuda}</div>` : ''}</div>`;
function marcar(el, malo) { if (el) el.classList.toggle('inval', !!malo); }
function listaErrores(root, errores) { if (!errores.length) return; toast(errores[0], 4200); const e = $('.inval, .sino.falta', root); if (e) e.scrollIntoView({block: 'center', behavior: 'smooth'}); }


/* ======================================================================== MÓDULOS */
const FORM = {};
const cab = (root, m) => { root.style.setProperty('--acc', MODS[m].acc); };
function zafraSel(root, cbFecha) { const s = $('[name=zafra]', root); s.innerHTML = opcSelect(S.mae.zafras, 'Zafra'); return s; }
function turnoYFecha(root, onChange) {
  const t = turnoActual(); segSet(root, 'turno', t); $('[name=fecha]', root).value = fechaPorDefecto(t); $('[name=zafra]', root).value = zafraDe($('[name=fecha]', root).value);
  bindSeg(root, 'turno', () => { onChange && onChange(); }); $('[name=fecha]', root).onchange = () => { $('[name=zafra]', root).value = zafraDe($('[name=fecha]', root).value || ymd(new Date())); onChange && onChange(); };
}
const ult = (m, k, d) => (LS.get('ult_' + me().user, {})[m + '_' + k]) || d;
const guardarUlt = (m, o) => { const u = LS.get('ult_' + me().user, {}); Object.keys(o).forEach(k => { u[m + '_' + k] = o[k]; }); LS.set('ult_' + me().user, u); };
const cabeceraComun = m => `<div class="fila">${campo('Fecha', '<input type="date" name="fecha">')}${campo('Turno', segHTML('turno', [['Dia', 'Día'], ['Noche', 'Noche']]))}</div>${campo('Zafra', '<select name="zafra"></select>')}`;
const nombresAdmin = () => S.mae.administradores.map(a => ({valor: a.text, texto: a.text, sub: 'ficha ' + a.id}));
const libreFicha = t => /^\d{3,7}$/.test(t) ? {valor: t, texto: t, aviso: 'ficha que no está en el maestro'} : null;
const libreNombre = t => t.length >= 2 ? {valor: t, texto: t, aviso: 'no está en el maestro; se guardará tal cual'} : null;

/* ---------------------------------------------------------------- COMBUSTIBLE */
FORM.combustible = {
  html: () => `<div class="card" style="--acc:var(--azul)"><h2>⛽ Control de combustible</h2><div class="cuerpo"><form id="f-combustible" onsubmit="return false">
    ${campo('¿Qué se abasteció?', segHTML('tipo', [['planta', 'Planta / Cisterna'], ['moto', 'Moto']]), '', '', 'full')}
    ${cabeceraComun()}
    <div id="cbPlanta"><div class="fila">${campo('Cisterna', '<select name="cisterna"></select>')}${campo('Planta / motor', '<select name="motorPlanta"></select>')}</div>${campo('Conductor de la cisterna', selHTML('condCis', 'Buscar por ficha o nombre'))}</div>
    <div id="cbMoto" hidden>${campo('Moto', '<select name="motorMoto"></select>')}${campo('Quién la abasteció', selHTML('condMoto', 'Buscar por ficha o nombre'))}${campo('Abastecida desde', '<select name="origen"></select>', 'Normalmente la misma moto; cámbialo si la cargó otra unidad.')}</div>
    <div class="fila">${campo('Cantidad (litros)', '<input type="number" name="litros" inputmode="decimal" step="any" min="0">')}<div id="cbOdo">${campo('Odómetro', '<input type="number" name="odometro" inputmode="decimal" step="any" min="0">', '', 'cbOdoAy')}</div></div>
    <button class="btn" id="cbGo" type="submit">Guardar registro</button></form></div></div>`,
  montar(root, datos) {
    cab(root, 'combustible'); zafraSel(root);
    $('[name=cisterna]', root).innerHTML = opcSelect(S.mae.equipos.Cisternas, 'Cisterna'); $('[name=motorPlanta]', root).innerHTML = opcSelect(S.mae.equipos.Plantas, 'Planta');
    $('[name=motorMoto]', root).innerHTML = opcSelect(S.mae.equipos.Motos, 'Moto');
    $('[name=origen]', root).innerHTML = '<option value="">La misma moto</option>' + [...S.mae.equipos.Motos, ...S.mae.equipos.Cisternas].map(e => `<option>${esc(e)}</option>`).join('');
    const cc = (S.mae.operadores['Operador Cisterna'] || []).map(o => ({valor: o.id, texto: o.text, sub: 'ficha ' + o.id}));
    const cm = [...(S.mae.operadores['Operador Moto'] || []).map(o => ({valor: o.id, texto: o.text, sub: 'ficha ' + o.id})), ...S.mae.administradores.map(a => ({valor: String(a.id), texto: a.text, sub: 'ficha ' + a.id + ' · administrador'}))];
    bindSel(root, 'condCis', 'Conductor de la cisterna', () => cc, null, libreFicha); bindSel(root, 'condMoto', 'Quién abasteció la moto', () => cm, null, libreFicha);
    const act = () => { const moto = segGet(root, 'tipo') === 'moto'; $('#cbPlanta', root).hidden = moto; $('#cbMoto', root).hidden = !moto; $('#cbOdo', root).hidden = !moto; hintOdo(); };
    const hintOdo = () => { const m = $('[name=motorMoto]', root).value, ay = $('#cbOdoAy', root); let h = $('.ayuda', ay); if (!h) { h = document.createElement('div'); h.className = 'ayuda'; ay.appendChild(h); } h.innerHTML = m && S.odo[m] ? `Último registrado: <b>${S.odo[m]}</b> km` : ''; };
    bindSeg(root, 'tipo', act); $('[name=motorMoto]', root).onchange = () => { hintOdo(); const o = S.odo[$('[name=motorMoto]', root).value]; if (o && !$('[name=odometro]', root).value) $('[name=odometro]', root).placeholder = String(o); };
    turnoYFecha(root); segSet(root, 'tipo', ult('combustible', 'tipo', 'planta')); act();
    if (me().ficha) { const a = S.mae.administradores.find(x => String(x.id) === String(me().ficha)); if (a) selSet(root, 'condMoto', String(a.id), a.text); }
    const u = ult('combustible', 'cisterna', ''); if (u) $('[name=cisterna]', root).value = u;
    if (datos) FORM.combustible.set(root, datos);
    $('#f-combustible').onsubmit = e => { e.preventDefault(); FORM.combustible.enviar(root); return false; };
  },
  set(root, d) {
    segSet(root, 'tipo', d.tipo); $('[name=zafra]', root).value = d.zafra; $('[name=fecha]', root).value = d.fecha; segSet(root, 'turno', d.turno); $('[name=litros]', root).value = d.litros;
    const cond = String(d.conductor), tx = id => { const o = [...(S.mae.operadores['Operador Cisterna'] || []), ...(S.mae.operadores['Operador Moto'] || [])].find(x => x.id === cond) || S.mae.administradores.find(a => String(a.id) === cond); return o ? o.text : cond; };
    if (d.tipo === 'moto') { $('#cbPlanta', root).hidden = true; $('#cbMoto', root).hidden = false; $('#cbOdo', root).hidden = false; $('[name=motorMoto]', root).value = d.motor; $('[name=origen]', root).value = d.cisterna && d.cisterna !== d.motor ? d.cisterna : ''; $('[name=odometro]', root).value = d.odometro; selSet(root, 'condMoto', cond, tx()); }
    else { $('#cbPlanta', root).hidden = false; $('#cbMoto', root).hidden = true; $('#cbOdo', root).hidden = true; $('[name=cisterna]', root).value = d.cisterna; $('[name=motorPlanta]', root).value = d.motor; selSet(root, 'condCis', cond, tx()); }
  },
  async enviar(root) {
    const tipo = segGet(root, 'tipo'), er = [], av = [], g = n => $(`[name=${n}]`, root), lit = parseFloat(g('litros').value);
    const mk = (el, bad, msg) => { marcar(el, bad); if (bad) er.push(msg); };
    const d = {tipo, zafra: g('zafra').value, fecha: g('fecha').value, turno: segGet(root, 'turno'), litros: lit};
    mk(g('fecha'), !d.fecha, 'Falta la fecha.'); mk(g('zafra'), !d.zafra, 'Falta la zafra.');
    if (tipo === 'moto') {
      d.motor = g('motorMoto').value; d.cisterna = g('origen').value || d.motor; d.conductor = selGet(root, 'condMoto').valor; d.odometro = parseFloat(g('odometro').value);
      mk(g('motorMoto'), !d.motor, 'Elige la moto.'); mk($('[data-sel=condMoto]', root), !d.conductor, 'Elige quién abasteció la moto.'); mk(g('odometro'), !(d.odometro > 0), 'Escribe el odómetro de la moto.');
      if (lit > AVISOS.litrosMoto[1]) av.push(`${lit} litros es mucho para una moto (lo normal es hasta ${AVISOS.litrosMoto[1]}).`);
      const u = S.odo[d.motor]; if (u && d.odometro > 0) { if (d.odometro < u) av.push(`El odómetro (${d.odometro}) es menor que el último registrado (${u}).`); else if (d.odometro - u > AVISOS.odoSalto) av.push(`El odómetro avanzó ${fmt(d.odometro - u)} km desde el último registro (${u}). ¿Es correcto?`); }
    } else {
      d.cisterna = g('cisterna').value; d.motor = g('motorPlanta').value; d.conductor = selGet(root, 'condCis').valor; d.odometro = 0;
      mk(g('cisterna'), !d.cisterna, 'Elige la cisterna.'); mk(g('motorPlanta'), !d.motor, 'Elige la planta.'); mk($('[data-sel=condCis]', root), !d.conductor, 'Elige el conductor de la cisterna.');
      if (lit > AVISOS.litrosPlanta[1]) av.push(`${lit} litros es mucho para una planta (lo normal es hasta ${AVISOS.litrosPlanta[1]}).`);
    }
    mk(g('litros'), !(lit > 0), 'Escribe los litros.');
    if (er.length) return listaErrores(root, er);
    if (av.length && !await confirmar('Revisa estos datos', av)) return;
    const itC = encolar('combustible', d); guardarUlt('combustible', {tipo, cisterna: d.cisterna});
    if (tipo === 'moto' && d.odometro) { S.odo[d.motor] = d.odometro; S.odoLocal[d.motor] = {v: d.odometro, id: itC.id}; }
    toast('Guardado ✓ ' + (S.online ? 'enviando…' : 'se enviará al volver la señal')); pintarVista(true);
  }
};

/* ---------------------------------------------------------------- MOTOS */
FORM.motos = {
  html: () => `<div class="card" style="--acc:var(--ama)"><h2>🏍️ Recorrido de motos</h2><div class="cuerpo"><form id="f-motos" onsubmit="return false">
    ${cabeceraComun()}
    ${campo('Operador de la moto', selHTML('operador', 'Buscar por nombre'))}
    ${campo('Moto', '<select name="equipo"></select>')}
    <div class="fila">${campo('Odómetro inicial', '<input type="number" name="odo_i" inputmode="decimal" step="any" min="0">', '', 'mtAy')}${campo('Odómetro final', '<input type="number" name="odo_f" inputmode="decimal" step="any" min="0">')}</div>
    ${campo('Recorrido (km)', '<input type="text" name="rec" class="ro" readonly value="—">')}
    ${campo('Observación', '<textarea name="observacion" placeholder="Opcional: qué se recorrió o qué se encontró"></textarea>', '', '', 'full')}
    <button class="btn" type="submit">Guardar recorrido</button></form></div></div>`,
  montar(root, datos) {
    cab(root, 'motos'); zafraSel(root); $('[name=equipo]', root).innerHTML = opcSelect(S.mae.equipos.Motos, 'Moto');
    const ops = () => { const m = new Map(); [...(S.mae.operadores['Operador Moto'] || []).map(o => o.text), ...S.mae.administradores.map(a => a.text)].forEach(n => m.set(n.toLowerCase(), n)); return [...m.values()].sort((a, b) => a.localeCompare(b, 'es')).map(n => ({valor: n, texto: n})); };
    bindSel(root, 'operador', 'Operador de la moto', ops, null, libreNombre);
    const calc = () => { const i = parseFloat($('[name=odo_i]', root).value), f = parseFloat($('[name=odo_f]', root).value), r = $('[name=rec]', root); r.value = (isFinite(i) && isFinite(f)) ? (f >= i ? fmt(f - i) + ' km' : 'Revisa: final menor que inicial') : '—'; };
    const sug = () => { const e = $('[name=equipo]', root).value, ay = $('#mtAy', root); let h = $('.ayuda', ay); if (!h) { h = document.createElement('div'); h.className = 'ayuda'; ay.appendChild(h); } const u = S.odo[e]; h.innerHTML = u ? `Último registrado: <b>${u}</b> km <button type="button" class="btn sec peq" style="min-height:30px;font-size:12px;padding:0 8px" id="mtUsar">Usar</button>` : ''; const b = $('#mtUsar', ay); if (b) b.onclick = () => { $('[name=odo_i]', root).value = u; calc(); }; return u; };
    $('[name=equipo]', root).onchange = () => { const u = sug(); const i = $('[name=odo_i]', root); if (u && (!i.value || i.dataset.auto)) { i.value = u; i.dataset.auto = '1'; } calc(); };
    $('[name=odo_i]', root).oninput = () => { delete $('[name=odo_i]', root).dataset.auto; calc(); }; $('[name=odo_f]', root).oninput = calc;
    turnoYFecha(root);
    const yo = me().nombre; const o = ops().find(x => x.valor.toLowerCase() === yo.toLowerCase()); if (o) selSet(root, 'operador', o.valor, o.texto);
    const e = ult('motos', 'equipo', ''); if (e) { $('[name=equipo]', root).value = e; $('[name=equipo]', root).onchange(); }
    root.dataset.inicio = new Date().toISOString();
    if (datos) FORM.motos.set(root, datos);
    $('#f-motos').onsubmit = e => { e.preventDefault(); FORM.motos.enviar(root); return false; };
  },
  set(root, d) { $('[name=zafra]', root).value = d.zafra; $('[name=fecha]', root).value = d.fecha; segSet(root, 'turno', d.turno); selSet(root, 'operador', d.operador, d.operador); $('[name=equipo]', root).value = d.equipo; $('[name=odo_i]', root).value = d.odo_i; $('[name=odo_f]', root).value = d.odo_f; $('[name=observacion]', root).value = d.observacion || ''; $('[name=odo_f]', root).oninput(); if (d.inicio) root.dataset.inicio = d.inicio; },
  async enviar(root) {
    const g = n => $(`[name=${n}]`, root), er = [], av = [], mk = (el, bad, msg) => { marcar(el, bad); if (bad) er.push(msg); };
    const oi = parseFloat(g('odo_i').value), of = parseFloat(g('odo_f').value), op = selGet(root, 'operador');
    const d = {zafra: g('zafra').value, fecha: g('fecha').value, turno: segGet(root, 'turno'), operador: op.valor, equipo: g('equipo').value, odo_i: oi, odo_f: of, observacion: g('observacion').value.trim(), inicio: root.dataset.inicio};
    mk(g('fecha'), !d.fecha, 'Falta la fecha.'); mk($('[data-sel=operador]', root), !d.operador, 'Elige el operador.'); mk(g('equipo'), !d.equipo, 'Elige la moto.');
    mk(g('odo_i'), !isFinite(oi) || oi < 0, 'Escribe el odómetro inicial.'); mk(g('odo_f'), !isFinite(of) || of < 0, 'Escribe el odómetro final.');
    if (isFinite(oi) && isFinite(of) && of < oi) mk(g('odo_f'), true, 'El odómetro final no puede ser menor que el inicial.');
    if (er.length) return listaErrores(root, er);
    const rec = of - oi; if (rec > AVISOS.recorridoMax) av.push(`Un recorrido de ${fmt(rec)} km es muy grande (lo normal es menos de ${AVISOS.recorridoMax}).`);
    const u = S.odo[d.equipo]; if (u && Math.abs(oi - u) > 1) av.push(`El odómetro inicial (${oi}) no coincide con el último registrado de esta moto (${u}).`);
    if (av.length && !await confirmar('Revisa estos datos', av)) return;
    const itM = encolar('motos', d); guardarUlt('motos', {equipo: d.equipo}); S.odo[d.equipo] = of; S.odoLocal[d.equipo] = {v: of, id: itM.id}; toast('Guardado ✓ ' + (S.online ? 'enviando…' : 'se enviará al volver la señal')); pintarVista(true);
  }
};

/* ---------------------------------------------------------------- CAMIONETAS ALQUILADAS (combustible y recorrido) */
// El supervisor se elige de la lista de Maestros (por defecto, la persona que inició sesión si está en la lista) y las camionetas salen de Equipos (categoría Camionetas).
const sinTilde = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const camionetas = () => (S.mae.equipos && S.mae.equipos.Camionetas) || [];
const supervisores = () => [...(S.mae.supervisores || [])].sort((a, b) => a.localeCompare(b, 'es')).map(n => ({valor: n, texto: n}));
function avisoCamionetas() {   // sin catálogos el formulario no puede funcionar: se le explica a la persona qué hacer
  const f = [];
  if (!camionetas().length) f.push('No hay camionetas cargadas.');
  if (!supervisores().length) f.push('No hay supervisores cargados.');
  return f.length ? `<div class="aviso">${f.join(' ')} El administrador debe cargarlas en <b>Mi cuenta → Administrar maestros</b> (Equipos con categoría Camionetas y Supervisores); el botón <i>Traer de las hojas de camionetas</i> las completa solo.</div>` : '';
}
function camComun(root, modulo) {   // supervisor, camioneta y último odómetro conocido (iguales en los dos formularios)
  cab(root, modulo); zafraSel(root);
  $('[name=equipo]', root).innerHTML = opcSelect(camionetas(), 'Camioneta');
  bindSel(root, 'supervisor', 'Supervisor', supervisores, null, null);
  turnoYFecha(root);
  const yo = sinTilde(me().nombre), s = supervisores().find(x => sinTilde(x.valor) === yo) || supervisores().find(x => x.valor === ult(modulo, 'supervisor', ''));
  if (s) selSet(root, 'supervisor', s.valor, s.texto);
  const e = ult(modulo, 'equipo', ''); if (e && camionetas().includes(e)) $('[name=equipo]', root).value = e;
  root.dataset.inicio = new Date().toISOString();
}
function ayudaOdo(root, idCampo, accion) {   // "Último registrado: N km  [Usar]"
  const e = $('[name=equipo]', root).value, ay = $(idCampo, root); let h = $('.ayuda', ay); if (!h) { h = document.createElement('div'); h.className = 'ayuda'; ay.appendChild(h); }
  const u = S.odo[e]; h.innerHTML = u ? `Último registrado: <b>${u}</b> km${accion ? ' <button type="button" class="btn sec peq" style="min-height:30px;font-size:12px;padding:0 8px" data-usar>Usar</button>' : ''}` : '';
  const b = $('[data-usar]', ay); if (b) b.onclick = () => accion(u); return u;
}
FORM.camcomb = {
  html: () => `<div class="card" style="--acc:var(--azul)"><h2>🛻 Combustible de camionetas alquiladas</h2><div class="cuerpo"><form id="f-camcomb" onsubmit="return false">
    <div id="ccAv"></div>${cabeceraComun()}
    ${campo('Hora', '<input type="time" name="hora">')}${campo('Supervisor', selHTML('supervisor', 'Buscar por nombre'))}${campo('Camioneta', '<select name="equipo"></select>')}
    <div class="fila">${campo('Odómetro (km)', '<input type="number" name="odometro" inputmode="decimal" step="any" min="0">', '', 'ccOdoAy')}${campo('Cantidad (galones)', '<input type="number" name="cantidad" inputmode="decimal" step="any" min="0">', '', 'ccRend')}</div>
    ${campo('Observación', '<textarea name="observacion" placeholder="Opcional"></textarea>', '', '', 'full')}
    <button class="btn" type="submit">Guardar registro</button></form></div></div>`,
  montar(root, datos) {
    camComun(root, 'camcomb'); $('#ccAv', root).innerHTML = avisoCamionetas(); $('[name=hora]', root).value = hhmm(new Date());
    const rend = () => {   // rendimiento estimado desde la última carga (orientativo)
      const u = S.odo[$('[name=equipo]', root).value], o = parseFloat($('[name=odometro]', root).value), c = parseFloat($('[name=cantidad]', root).value), ay = $('#ccRend', root); let h = $('.ayuda', ay); if (!h) { h = document.createElement('div'); h.className = 'ayuda'; ay.appendChild(h); }
      h.textContent = (u && o > u && c > 0) ? `Desde la última carga: ${fmt(o - u)} km · ${fmt((o - u) / c)} km por galón` : '';
    };
    $('[name=equipo]', root).onchange = () => { ayudaOdo(root, '#ccOdoAy'); const u = S.odo[$('[name=equipo]', root).value], o = $('[name=odometro]', root); if (u && !o.value) o.placeholder = String(u); rend(); };
    $('[name=odometro]', root).oninput = rend; $('[name=cantidad]', root).oninput = rend; $('[name=equipo]', root).onchange();
    if (datos) FORM.camcomb.set(root, datos);
    $('#f-camcomb').onsubmit = e => { e.preventDefault(); FORM.camcomb.enviar(root); return false; };
  },
  set(root, d) { $('[name=zafra]', root).value = d.zafra; $('[name=fecha]', root).value = d.fecha; $('[name=hora]', root).value = d.hora; segSet(root, 'turno', d.turno); selSet(root, 'supervisor', d.supervisor, d.supervisor); $('[name=equipo]', root).value = d.equipo; $('[name=odometro]', root).value = d.odometro; $('[name=cantidad]', root).value = d.cantidad; $('[name=observacion]', root).value = d.observacion || ''; $('[name=equipo]', root).onchange(); if (d.inicio) root.dataset.inicio = d.inicio; },
  async enviar(root) {
    const g = n => $(`[name=${n}]`, root), er = [], av = [], mk = (el, bad, msg) => { marcar(el, bad); if (bad) er.push(msg); };
    const odo = parseFloat(g('odometro').value), cant = parseFloat(g('cantidad').value), sup = selGet(root, 'supervisor');
    const d = {zafra: g('zafra').value, fecha: g('fecha').value, hora: g('hora').value, turno: segGet(root, 'turno'), supervisor: sup.valor, equipo: g('equipo').value, odometro: odo, cantidad: cant, observacion: g('observacion').value.trim(), inicio: root.dataset.inicio};
    mk(g('fecha'), !d.fecha, 'Falta la fecha.'); mk(g('zafra'), !d.zafra, 'Falta la zafra.'); mk(g('hora'), !/^\d{1,2}:\d{2}/.test(d.hora), 'Falta la hora.');
    mk($('[data-sel=supervisor]', root), !d.supervisor, 'Elige el supervisor.'); mk(g('equipo'), !d.equipo, 'Elige la camioneta.');
    mk(g('odometro'), !(odo > 0), 'Escribe el odómetro.'); mk(g('cantidad'), !(cant > 0), 'Escribe los galones.');
    if (er.length) return listaErrores(root, er);
    if (cant < AVISOS.camGal[0] || cant > AVISOS.camGal[1]) av.push(`${cant} galones es un valor inusual (lo normal está entre ${AVISOS.camGal[0]} y ${AVISOS.camGal[1]}).`);
    const u = S.odo[d.equipo];
    if (u) {
      if (odo < u) av.push(`El odómetro (${odo}) es menor que el último registrado (${u}).`);
      else if (odo - u > AVISOS.odoSaltoCam) av.push(`El odómetro avanzó ${fmt(odo - u)} km desde el último registro (${u}). ¿Es correcto?`);
      else if (odo > u) { const r = (odo - u) / cant; if (r < AVISOS.kmGal[0] || r > AVISOS.kmGal[1]) av.push(`El rendimiento sería de ${fmt(r)} km por galón (lo normal está entre ${AVISOS.kmGal[0]} y ${AVISOS.kmGal[1]}).`); }
    }
    if (av.length && !await confirmar('Revisa estos datos', av)) return;
    const it = encolar('camcomb', d); guardarUlt('camcomb', {equipo: d.equipo, supervisor: d.supervisor}); S.odo[d.equipo] = odo; S.odoLocal[d.equipo] = {v: odo, id: it.id};
    toast('Guardado ✓ ' + (S.online ? 'enviando…' : 'se enviará al volver la señal')); pintarVista(true);
  }
};
FORM.camrec = {
  html: () => `<div class="card" style="--acc:var(--ama)"><h2>🧭 Recorrido de camionetas alquiladas</h2><div class="cuerpo"><form id="f-camrec" onsubmit="return false">
    <div id="crAv"></div>${cabeceraComun()}
    ${campo('Supervisor', selHTML('supervisor', 'Buscar por nombre'))}${campo('Camioneta', '<select name="equipo"></select>')}
    <div class="fila">${campo('Odómetro inicial', '<input type="number" name="odo_i" inputmode="decimal" step="any" min="0">', '', 'crAy')}${campo('Odómetro final', '<input type="number" name="odo_f" inputmode="decimal" step="any" min="0">')}</div>
    ${campo('Recorrido (km)', '<input type="text" name="rec" class="ro" readonly value="—">')}
    ${campo('Observación', '<textarea name="observacion" placeholder="Opcional: adónde se fue o qué se encontró"></textarea>', '', '', 'full')}
    <button class="btn" type="submit">Guardar recorrido</button></form></div></div>`,
  montar(root, datos) {
    camComun(root, 'camrec'); $('#crAv', root).innerHTML = avisoCamionetas();
    const calc = () => { const i = parseFloat($('[name=odo_i]', root).value), f = parseFloat($('[name=odo_f]', root).value), r = $('[name=rec]', root); r.value = (isFinite(i) && isFinite(f)) ? (f >= i ? fmt(f - i) + ' km' : 'Revisa: final menor que inicial') : '—'; };
    $('[name=equipo]', root).onchange = () => { const u = ayudaOdo(root, '#crAy', v => { $('[name=odo_i]', root).value = v; calc(); }), i = $('[name=odo_i]', root); if (u && (!i.value || i.dataset.auto)) { i.value = u; i.dataset.auto = '1'; } calc(); };
    $('[name=odo_i]', root).oninput = () => { delete $('[name=odo_i]', root).dataset.auto; calc(); }; $('[name=odo_f]', root).oninput = calc; $('[name=equipo]', root).onchange();
    if (datos) FORM.camrec.set(root, datos);
    $('#f-camrec').onsubmit = e => { e.preventDefault(); FORM.camrec.enviar(root); return false; };
  },
  set(root, d) { $('[name=zafra]', root).value = d.zafra; $('[name=fecha]', root).value = d.fecha; segSet(root, 'turno', d.turno); selSet(root, 'supervisor', d.supervisor, d.supervisor); $('[name=equipo]', root).value = d.equipo; $('[name=odo_i]', root).value = d.odo_i; $('[name=odo_f]', root).value = d.odo_f; $('[name=observacion]', root).value = d.observacion || ''; $('[name=odo_f]', root).oninput(); if (d.inicio) root.dataset.inicio = d.inicio; },
  async enviar(root) {
    const g = n => $(`[name=${n}]`, root), er = [], av = [], mk = (el, bad, msg) => { marcar(el, bad); if (bad) er.push(msg); };
    const oi = parseFloat(g('odo_i').value), of = parseFloat(g('odo_f').value), sup = selGet(root, 'supervisor');
    const d = {zafra: g('zafra').value, fecha: g('fecha').value, turno: segGet(root, 'turno'), supervisor: sup.valor, equipo: g('equipo').value, odo_i: oi, odo_f: of, observacion: g('observacion').value.trim(), inicio: root.dataset.inicio};
    mk(g('fecha'), !d.fecha, 'Falta la fecha.'); mk(g('zafra'), !d.zafra, 'Falta la zafra.'); mk($('[data-sel=supervisor]', root), !d.supervisor, 'Elige el supervisor.'); mk(g('equipo'), !d.equipo, 'Elige la camioneta.');
    mk(g('odo_i'), !isFinite(oi) || oi < 0, 'Escribe el odómetro inicial.'); mk(g('odo_f'), !isFinite(of) || of < 0, 'Escribe el odómetro final.');
    if (isFinite(oi) && isFinite(of) && of < oi) mk(g('odo_f'), true, 'El odómetro final no puede ser menor que el inicial.');
    if (er.length) return listaErrores(root, er);
    const rec = of - oi; if (rec > AVISOS.recorridoCam) av.push(`Un recorrido de ${fmt(rec)} km es muy grande (lo normal es menos de ${AVISOS.recorridoCam}).`);
    const u = S.odo[d.equipo]; if (u && Math.abs(oi - u) > 1) av.push(`El odómetro inicial (${oi}) no coincide con el último registrado de esta camioneta (${u}).`);
    if (av.length && !await confirmar('Revisa estos datos', av)) return;
    const it = encolar('camrec', d); guardarUlt('camrec', {equipo: d.equipo, supervisor: d.supervisor}); S.odo[d.equipo] = of; S.odoLocal[d.equipo] = {v: of, id: it.id};
    toast('Guardado ✓ ' + (S.online ? 'enviando…' : 'se enviará al volver la señal')); pintarVista(true);
  }
};

/* ---------------------------------------------------------------- ADMINISTRADORES */
const SLIDERS = [['ralenti', 'Ralentí (%)'], ['autotrac', 'AutoTrac (%)'], ['control_alt', 'Control alt. CB (%)']];
FORM.admin = {
  html: () => `<div class="card" style="--acc:var(--cian)"><h2>📊 Seguimiento de administradores</h2><div class="cuerpo"><form id="f-admin" onsubmit="return false">
    <div class="fila">${campo('Fecha de evaluación', '<input type="date" name="fecha">')}${campo('Zafra', '<select name="zafra"></select>')}</div>
    <div class="fila">${campo('Semana', '<select name="semana"></select>', '', 'adSemAy')}${campo('Frente', '<select name="frente"></select>')}</div>
    ${campo('Administrador', selHTML('administrador', 'Buscar por nombre o ficha'))}
    <div class="grupo">Rendimiento de cosechadoras</div>
    <div class="fila">${campo('Hrs equipo / día', '<input type="number" name="hrs" inputmode="decimal" step="any" min="0">')}${campo('TM equipo / día', '<input type="number" name="tm" inputmode="decimal" step="any" min="0">')}</div>
    <div class="fila">${campo('Lt / Hr productiva', '<input type="number" name="lt_hr" inputmode="decimal" step="any" min="0">')}${campo('Lt / TM', '<input type="number" name="lt_tm" inputmode="decimal" step="any" min="0">')}</div>
    <div class="grupo">Información JDLink</div>
    ${SLIDERS.map(([k, t]) => campo(t, `<div class="rango"><input type="range" name="${k}" min="0" max="100" step="1" value="0"><output class="vacio" data-out="${k}">—</output></div>`)).join('')}
    <div class="grupo">Movimiento interno</div>
    ${campo('TM / Hrs motor', '<input type="number" name="tm_hrs_motor" inputmode="decimal" step="any" min="0">')}
    <button class="btn" type="submit">Guardar seguimiento</button></form></div></div>`,
  montar(root, datos) {
    cab(root, 'admin'); zafraSel(root); $('[name=semana]', root).innerHTML = opcSelect(S.mae.semanas.map(s => [s.id, s.text]), 'Semana'); $('[name=frente]', root).innerHTML = opcSelect(S.mae.frentes.map(f => f.text), 'Frente');
    bindSel(root, 'administrador', 'Administrador', () => S.mae.administradores.map(a => ({valor: String(a.id), texto: a.text, sub: 'ficha ' + a.id})));
    const hoy = fechaPorDefecto('Dia'); $('[name=fecha]', root).value = hoy; $('[name=zafra]', root).value = zafraDe(hoy);
    const sem = () => { const s = semanaSugerida($('[name=zafra]', root).value, $('[name=fecha]', root).value), ay = $('#adSemAy', root); if (s) { $('[name=semana]', root).value = s; } let h = $('.ayuda', ay); if (!h) { h = document.createElement('div'); h.className = 'ayuda'; ay.appendChild(h); } h.textContent = s ? 'Sugerida según la fecha' : ''; };
    $('[name=fecha]', root).onchange = () => { $('[name=zafra]', root).value = zafraDe($('[name=fecha]', root).value || hoy); sem(); }; $('[name=zafra]', root).onchange = sem;
    const us = ult('admin', 'semana', ''); if (us) $('[name=semana]', root).value = us; sem();
    const uf = ult('admin', 'frente', ''); if (uf) $('[name=frente]', root).value = uf;
    const ficha = me().ficha ? me().ficha : ult('admin', 'administrador', ''); const a = S.mae.administradores.find(x => String(x.id) === String(ficha)); if (a) selSet(root, 'administrador', String(a.id), a.text);
    SLIDERS.forEach(([k]) => { const r = $(`[name=${k}]`, root), o = $(`[data-out=${k}]`, root); r.oninput = () => { r.dataset.tocado = '1'; o.textContent = r.value + '%'; o.classList.remove('vacio'); }; r.style.setProperty('--x', 0); });
    if (datos) FORM.admin.set(root, datos);
    $('#f-admin').onsubmit = e => { e.preventDefault(); FORM.admin.enviar(root); return false; };
  },
  set(root, d) {
    $('[name=zafra]', root).value = d.zafra; $('[name=fecha]', root).value = d.fecha; $('[name=semana]', root).value = d.semana; $('[name=frente]', root).value = d.frente; const a = S.mae.administradores.find(x => x.id === Number(d.administrador)); selSet(root, 'administrador', String(d.administrador), a ? a.text : String(d.administrador));
    ['hrs', 'tm', 'lt_hr', 'lt_tm', 'tm_hrs_motor'].forEach(k => { $(`[name=${k}]`, root).value = d[k]; }); SLIDERS.forEach(([k]) => { const r = $(`[name=${k}]`, root); r.value = d[k]; r.oninput(); });
  },
  async enviar(root) {
    const g = n => $(`[name=${n}]`, root), er = [], av = [], mk = (el, bad, msg) => { marcar(el, bad); if (bad) er.push(msg); }, nv = n => parseFloat(g(n).value);
    const adm = selGet(root, 'administrador');
    const d = {zafra: g('zafra').value, fecha: g('fecha').value, semana: Number(g('semana').value), frente: g('frente').value, administrador: Number(adm.valor), hrs: nv('hrs'), tm: nv('tm'), lt_hr: nv('lt_hr'), lt_tm: nv('lt_tm'), tm_hrs_motor: nv('tm_hrs_motor'), dispositivo: dispositivo()};
    mk(g('fecha'), !d.fecha, 'Falta la fecha.'); mk(g('semana'), !d.semana, 'Elige la semana.'); mk(g('frente'), !d.frente, 'Elige el frente.'); mk($('[data-sel=administrador]', root), !d.administrador, 'Elige el administrador.');
    [['hrs', 'las horas del equipo'], ['tm', 'las TM del equipo'], ['lt_hr', 'los litros por hora'], ['lt_tm', 'los litros por TM'], ['tm_hrs_motor', 'las TM por hora de motor']].forEach(([k, t]) => mk(g(k), !isFinite(d[k]) || d[k] < 0, 'Escribe ' + t + '.'));
    SLIDERS.forEach(([k, t]) => { d[k] = Number(g(k).value); mk(g(k), !g(k).dataset.tocado || !(d[k] > 0), 'Mueve el deslizador de ' + t + ' (no puede quedar en 0).'); });
    if (er.length) return listaErrores(root, er);
    const rg = (v, [a, b], t) => { if (v < a || v > b) av.push(`${t} = ${v} está fuera de lo habitual (${a} a ${b}).`); };
    rg(d.hrs, AVISOS.hrs, 'Hrs equipo/día'); rg(d.tm, AVISOS.tm, 'TM equipo/día'); rg(d.lt_hr, AVISOS.ltHr, 'Lt/Hr'); rg(d.lt_tm, AVISOS.ltTm, 'Lt/TM'); rg(d.tm_hrs_motor, AVISOS.tmHrsMotor, 'TM/Hrs motor');
    if (av.length && !await confirmar('Revisa estos datos', av)) return;
    encolar('admin', d); guardarUlt('admin', {semana: d.semana, frente: d.frente, administrador: String(d.administrador)}); toast('Guardado ✓ ' + (S.online ? 'enviando…' : 'se enviará al volver la señal')); pintarVista(true);
  }
};
function dispositivo() { let d = LS.get('dev', null); if (!d) { d = Math.random().toString(36).slice(2, 12); LS.set('dev', d); } return d; }

/* ---------------------------------------------------------------- ATS */
const ATS_GRUPOS = [
  {k: 'epp', t: 'Equipo de protección personal', haz: false, todo: 'SI', items: [['gorro', 'Gorro'], ['lentes', 'Lentes'], ['uniforme', 'Uniforme con cinta reflectiva'], ['guantes', 'Guantes'], ['polainas', 'Polainas'], ['botas', 'Botas']]},
  {k: 'herr', t: 'Herramientas y equipos', haz: false, todo: 'SI', items: [['machete', 'Machete'], ['pie_amigo', 'Pie amigo'], ['cunas', 'Cuñas'], ['destraba_cuchillas', 'Destraba cuchillas'], ['torres', 'Torres de iluminación'], ['lampara', 'Lámpara frontal'], ['conos', 'Conos de señalización'], ['extintores', 'Extintores en buen estado']]},
  {k: 'peligros', t: 'Peligros en el plantío (SI = existe)', haz: true, todo: 'NO', items: [['pozos', 'Pozos'], ['tormenta', 'Tormenta eléctrica'], ['topografia', 'Topografía del terreno'], ['tendido', 'Tendido eléctrico'], ['causes', 'Causes'], ['zanjas', 'Zanjas']]},
  {k: 'riesgos', t: 'Riesgos de accidente (SI = existe)', haz: true, todo: 'NO', items: [['vuelco', 'Vuelco de maquinaria'], ['descarga', 'Descarga eléctrica'], ['caidas', 'Caídas a distinto nivel'], ['golpes', 'Golpes y contusiones'], ['atrapamiento', 'Atrapamiento por o entre objetos']]},
  {k: 'verif', t: 'Verificación', haz: false, todo: 'SI', items: [['v1', '¿Las herramientas que está utilizando el personal se encuentran en buen estado?'], ['v2', '¿El personal está dotado de equipo protección y lo utiliza correctamente?'], ['v3', '¿El personal está informado de los peligros del área de trabajo?'], ['v4', '¿Está identificada la ruta de evacuación de emergencia?'], ['v5', '¿Se cuenta con personal capacitado para responder a emergencias?'], ['v6', '¿El personal toma sus descanso en los horarios establecidos?']]}
];
const ATS_TOTAL = ATS_GRUPOS.reduce((n, g) => n + g.items.length, 0);
const sinoHTML = (g, k, t) => `<div class="sino${g.haz ? ' haz' : ''}" data-g="${g.k}" data-k="${k}"><span class="q">${esc(t)}</span><span class="b"><button type="button" class="si" data-v="SI">SI</button><button type="button" class="no" data-v="NO">NO</button></span></div>`;
FORM.ats = {
  html: () => `<div class="card" style="--acc:var(--verde)"><h2>🦺 Análisis de trabajo seguro · transporte de caña</h2><div class="cuerpo"><form id="f-ats" onsubmit="return false">
    <div class="fila">${campo('Fecha de evaluación', '<input type="date" name="fecha">')}${campo('Turno', segHTML('turno', [['Dia', 'Día'], ['Noche', 'Noche']]))}</div>
    <div class="fila">${campo('Zafra', '<select name="zafra"></select>')}${campo('Frente de cosecha', '<select name="frente"></select>')}</div>
    ${campo('Ficha del administrador', selHTML('administrador', 'Buscar por nombre o ficha'))}
    ${campo('Actividad', '<select name="actividad"><option>Cosecha mecanizada</option><option>Alce Manual</option></select>')}${campo('Código del plantío', selHTML('plantio', 'Buscar código o nombre'), '', 'atsPlAy')}
    ${ATS_GRUPOS.map(g => `<div class="grupo"><span>${esc(g.t)}</span><button type="button" class="btn sec peq" data-todo="${g.k}">Marcar todo ${g.todo}</button></div><div class="sinos">${g.items.map(([k, t]) => sinoHTML(g, k, t)).join('')}</div>${g.k === 'peligros' ? `<div class="campo full" style="margin-top:12px" id="atsBio"><label>Riesgos biológicos</label><div class="chips" data-chips="bio">${['Serpientes', 'Abejas', 'No_Aplica'].map(b => `<button type="button" data-v="${b}">${b.replace('_', ' ')}</button>`).join('')}</div></div>` : ''}`).join('')}
    ${campo('Notas', '<textarea name="notas" placeholder="Hallazgos, acciones tomadas, condiciones del terreno…"></textarea>', '', '', 'full')}
    ${campo('Responsable de la actividad', selHTML('responsable', 'Elegir'))}
    <div class="aviso" id="atsProg">Respondidas 0 de ${ATS_TOTAL}</div>
    <button class="btn" type="submit">Guardar análisis</button></form></div></div>`,
  async montar(root, datos) {
    cab(root, 'ats'); zafraSel(root); $('[name=frente]', root).innerHTML = opcSelect(S.mae.frentes.map(f => f.text), 'Frente');
    bindSel(root, 'administrador', 'Administrador', () => S.mae.administradores.map(a => ({valor: String(a.id), texto: a.text, sub: 'ficha ' + a.id})), r => { if (!selGet(root, 'responsable').valor) selSet(root, 'responsable', r.texto, r.texto); });
    bindSel(root, 'responsable', 'Responsable de la actividad', () => nombresAdmin(), null, libreNombre);
    const pl = () => (S.plantios[$('[name=zafra]', root).value] || []);
    const frenteElegido = () => $('[name=frente]', root).value;
    bindSel(root, 'plantio', 'Plantío del programa de corte', q => pl().filter(p => q || !frenteElegido() || !p[3] || p[3] === frenteElegido()).map(p => ({valor: p[0], texto: p[0] + ' · ' + p[1], sub: subPlantio(p)})),
      r => { const p = pl().find(x => x[0] === r.valor); if (p && p[3] && S.mae.frentes.some(f => f.text === p[3])) $('[name=frente]', root).value = p[3]; infoAts(root); },   // al elegir el plantío se completa el frente del programa
      t => /^\d{1,5}$/.test(t) ? {valor: t.padStart(5, '0'), texto: t.padStart(5, '0'), aviso: 'no está en la lista'} : null);
    const avisoPl = async () => { const z = $('[name=zafra]', root).value; await plantiosDe(z); const ay = $('#atsPlAy', root); let h = $('.ayuda', ay); if (!h) { h = document.createElement('div'); h.className = 'ayuda'; ay.appendChild(h); } const hay = pl().length, prog = hay && pl()[0][3]; h.innerHTML = hay ? `${hay} plantíos ${prog ? 'del Programa de Corte' : 'de la zafra'} ${z}${frenteElegido() ? ' · se muestran los del frente ' + frenteElegido() + ' (cambia el frente para ver otros)' : ''}` : `<b style="color:var(--bad)">No hay plantíos cargados para la zafra ${z}.</b> Hay que cargar el Programa de Corte de esa zafra en Archivo_Maestros (menú Plataforma de campo); el código escrito a mano será validado al enviar.`; infoAts(root); };
    const t = turnoActual(); segSet(root, 'turno', t); $('[name=fecha]', root).value = fechaPorDefecto(t); $('[name=zafra]', root).value = zafraDe($('[name=fecha]', root).value);
    bindSeg(root, 'turno', () => {}); $('[name=fecha]', root).onchange = () => { $('[name=zafra]', root).value = zafraDe($('[name=fecha]', root).value || ymd(new Date())); avisoPl(); }; $('[name=zafra]', root).onchange = avisoPl; $('[name=frente]', root).onchange = avisoPl;
    $$('.sino', root).forEach(row => $$('button', row).forEach(b => b.onclick = () => { $$('button', row).forEach(x => x.classList.toggle('on', x === b)); row.dataset.valor = b.dataset.v; row.classList.remove('falta'); prog(); }));
    $$('[data-todo]', root).forEach(b => b.onclick = () => { const g = ATS_GRUPOS.find(x => x.k === b.dataset.todo); $$(`.sino[data-g=${g.k}]`, root).forEach(row => { $$('button', row).forEach(x => x.classList.toggle('on', x.dataset.v === g.todo)); row.dataset.valor = g.todo; row.classList.remove('falta'); }); prog(); });
    $$('[data-chips=bio] button', root).forEach(b => b.onclick = () => {   // "No aplica" es excluyente: no se puede marcar junto a un riesgo real
      const v = b.dataset.v, on = !b.classList.contains('on'); if (v === 'No_Aplica' && on) $$('[data-chips=bio] button', root).forEach(x => x.classList.remove('on'));
      else if (on) $('[data-chips=bio] [data-v=No_Aplica]', root).classList.remove('on'); b.classList.toggle('on', on); $('#atsBio', root).classList.remove('inval'); });
    const prog = () => { const n = $$('.sino', root).filter(r => r.dataset.valor).length, el = $('#atsProg', root); el.textContent = `Respondidas ${n} de ${ATS_TOTAL}`; el.className = 'aviso' + (n === ATS_TOTAL ? ' ok' : ''); };
    FORM.ats._prog = prog; await avisoPl();
    const uf = ult('ats', 'frente', ''); if (uf) $('[name=frente]', root).value = uf;
    const ficha = me().ficha ? me().ficha : ult('ats', 'administrador', ''); const a = S.mae.administradores.find(x => String(x.id) === String(ficha)); if (a) { selSet(root, 'administrador', String(a.id), a.text); selSet(root, 'responsable', a.text, a.text); }
    root.dataset.inicio = new Date().toISOString();
    if (datos) FORM.ats.set(root, datos);
    if (S.pre && S.pre.plantio) { prefillAts(root, S.pre); S.pre = null; }   // viene del botón "Registrar ATS" de la ficha del plantío en el mapa
    $('#f-ats').onsubmit = e => { e.preventDefault(); FORM.ats.enviar(root); return false; };
  },
  set(root, d) {
    $('[name=zafra]', root).value = d.zafra; $('[name=fecha]', root).value = d.fecha; segSet(root, 'turno', d.turno); $('[name=frente]', root).value = d.frente; $('[name=actividad]', root).value = d.actividad; $('[name=notas]', root).value = d.notas || '';
    const a = S.mae.administradores.find(x => x.id === Number(d.administrador)); selSet(root, 'administrador', String(d.administrador), a ? a.text : String(d.administrador)); selSet(root, 'responsable', d.responsable, d.responsable);
    const p = (S.plantios[d.zafra] || []).find(x => Number(x[0]) === Number(d.plantio)); const cod = String(d.plantio).padStart(5, '0'); selSet(root, 'plantio', cod, p ? cod + ' · ' + p[1] : cod);
    ATS_GRUPOS.forEach(g => g.items.forEach(([k]) => { const v = (d[g.k] || {})[k], row = $(`.sino[data-g=${g.k}][data-k=${k}]`, root); if (v) { row.dataset.valor = v; $$('button', row).forEach(x => x.classList.toggle('on', x.dataset.v === v)); } }));
    $$('[data-chips=bio] button', root).forEach(b => b.classList.toggle('on', (d.riesgo_bio || []).includes(b.dataset.v))); if (d.inicio) root.dataset.inicio = d.inicio; FORM.ats._prog();
  },
  async enviar(root) {
    const g = n => $(`[name=${n}]`, root), er = [], mk = (el, bad, msg) => { marcar(el, bad); if (bad) er.push(msg); };
    const adm = selGet(root, 'administrador'), pl = selGet(root, 'plantio'), resp = selGet(root, 'responsable');
    const d = {zafra: g('zafra').value, fecha: g('fecha').value, turno: segGet(root, 'turno'), frente: g('frente').value, administrador: Number(adm.valor), actividad: g('actividad').value, plantio: Number(pl.valor), notas: g('notas').value.trim(), responsable: resp.valor, inicio: root.dataset.inicio, dispositivo: dispositivo(),
      riesgo_bio: $$('[data-chips=bio] button.on', root).map(b => b.dataset.v)};
    mk(g('fecha'), !d.fecha, 'Falta la fecha.'); mk(g('frente'), !d.frente, 'Elige el frente.'); mk($('[data-sel=administrador]', root), !d.administrador, 'Elige el administrador.'); mk($('[data-sel=plantio]', root), !d.plantio, 'Elige el código del plantío.');
    mk($('[data-sel=responsable]', root), !d.responsable, 'Elige el responsable de la actividad.'); mk($('#atsBio', root), !d.riesgo_bio.length, 'Marca el riesgo biológico (o "No aplica").');
    let faltan = 0; ATS_GRUPOS.forEach(gr => { d[gr.k] = {}; gr.items.forEach(([k]) => { const row = $(`.sino[data-g=${gr.k}][data-k=${k}]`, root); d[gr.k][k] = row.dataset.valor || ''; if (!d[gr.k][k]) { faltan++; row.classList.add('falta'); } }); });
    if (faltan) er.push(`Faltan ${faltan} preguntas por responder (SI / NO).`);
    if (er.length) { listaErrores(root, er); const f = $('.sino.falta', root); if (f && er[0].startsWith('Falta')) {} return; }
    const av = []; const pPrg = (S.plantios[d.zafra] || []).find(x => Number(x[0]) === d.plantio); if (pPrg && pPrg[3] && pPrg[3] !== d.frente) av.push(`El plantío ${pPrg[0]} está programado en el frente ${pPrg[3]}, pero elegiste ${d.frente}.`);
    const bio = d.riesgo_bio; if (bio.includes('No_Aplica') && bio.length > 1) av.push('Marcaste "No aplica" junto con otros riesgos biológicos.');
    if (d.peligros.tendido === 'NO' && d.riesgos.descarga === 'SI') av.push('Indicas riesgo de descarga eléctrica pero sin tendido eléctrico en el plantío.');
    if (av.length && !await confirmar('Revisa estos datos', av)) return;
    encolar('ats', d); guardarUlt('ats', {frente: d.frente, administrador: String(d.administrador)}); toast('Guardado ✓ ' + (S.online ? 'enviando…' : 'se enviará al volver la señal')); pintarVista(true);
  }
};


/** Datos que trae el mapa al abrir un ATS desde la ficha de un plantío: sólo plantío y frente (lo demás lo llena la persona). */
function prefillAts(root, p) {
  const cod = String(p.plantio).padStart(5, '0'), pl = (S.plantios[$('[name=zafra]', root).value] || []).find(x => x[0] === cod);
  selSet(root, 'plantio', cod, pl ? cod + ' · ' + pl[1] : cod + (p.nombre ? ' · ' + p.nombre : ''));
  if (p.frente && S.mae.frentes.some(f => f.text === p.frente)) $('[name=frente]', root).value = p.frente;
  infoAts(root); toast('Plantío ' + cod + ' cargado desde el mapa');
}
const fechaCorta = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '';
const subPlantio = p => [p[3] && 'Frente ' + p[3], p[4] !== '' && p[4] != null && 'Sem ' + p[4], p[5] && 'Corte ' + fechaCorta(p[5]), p[6] !== '' && p[6] != null && 'Sec ' + p[6], p[2]].filter(Boolean).join(' · ');
/** Debajo del plantío elegido: lo que dice el Programa de Corte (frente, semana, fecha de corte, secuencia, ha). */
function infoAts(root) {
  const campoPl = $('#atsPlAy', root); if (!campoPl) return;
  let el = $('#atsPlInfo', campoPl); if (!el) { el = document.createElement('div'); el.id = 'atsPlInfo'; el.className = 'ayuda'; el.style.fontWeight = '600'; campoPl.appendChild(el); }
  const cod = selGet(root, 'plantio').valor, p = cod && (S.plantios[$('[name=zafra]', root).value] || []).find(x => x[0] === cod);
  el.textContent = p && p[3] ? `Programa: frente ${p[3]} · semana ${p[4]} · corte ${fechaCorta(p[5])} · secuencia ${p[6]}${p[7] !== '' ? ' · ' + fmt(Number(p[7])) + ' ha' : ''}` : '';
}

/* ======================================================================== VISTAS */
const formulariosDe = () => { const s = A.auth.sess; return s && s.permisos ? s.permisos.filter(p => p.indexOf('form_') === 0).map(p => p.slice(5)) : []; };
function modulosPermitidos() { return S.formularios.filter(m => MODS[m] && (m !== 'ats' || !S.cfg || S.cfg.ats_disponible !== false)); }
function pintarTabs() {
  const ms = modulosPermitidos(), nav = $('#tabs'), p = pendMios().length;
  nav.innerHTML = ms.map(m => `<button data-v="${m}"><b>${MODS[m].icono}</b>${MODS[m].titulo}</button>`).join('') + `<button data-v="pendientes"><b>📤</b>Pendientes${p ? `<span class="n">${p}</span>` : ''}</button>`;
  $$('button', nav).forEach(b => { b.onclick = () => { S.vista = b.dataset.v; pintarVista(); }; b.classList.toggle('on', b.dataset.v === S.vista); });
  const on = $('button.on', nav); if (on && nav.scrollWidth > nav.clientWidth && HOST.dataset.modo !== 'web') nav.scrollLeft = on.offsetLeft - (nav.clientWidth - on.offsetWidth) / 2;   // en el celular la barra se desplaza: la pestaña activa queda a la vista
}
function contadorMapa() {   // contador de pendientes en los botones del mapa (no depende de que la pantalla de formularios esté abierta)
  const p = A.auth.logged() ? pendMios().length : 0;
  document.querySelectorAll('[data-ffbadge]').forEach(el => { el.textContent = p || ''; el.hidden = !p; });
}
function pintarBadges() {
  contadorMapa();
  if (!ROOT) return;
  const p = pendMios(), n = p.filter(i => i.estado === 'pendiente').length, e = p.length - n, b = $('#bPend');
  b.hidden = !p.length; b.textContent = S.enviando ? 'Enviando…' : (e ? `${p.length} pendientes (${e} con aviso)` : `${n} por enviar`); b.onclick = () => { S.vista = 'pendientes'; pintarVista(); };
  pintarTabs();
}
async function pintarVista() {
  const v = $('#vista'); if (!A.auth.logged()) return;
  if (!S.mae) { v.innerHTML = '<div class="vacio-msg">Cargando catálogos…<br><small>La primera vez necesita internet.</small></div>'; return; }
  pintarTabs(); $('#quien').textContent = `${me().nombre} · ${me().rol}`; delete v.dataset.edicion;
  if (FORM[S.vista]) {
    if (!modulosPermitidos().includes(S.vista)) { S.vista = modulosPermitidos()[0] || 'pendientes'; return pintarVista(); }
    v.innerHTML = FORM[S.vista].html(); const root = $(`#f-${S.vista}`); await FORM[S.vista].montar(root, null); v.scrollTop = 0;
  } else pintarPendientes(v);
}
function pintarPendientes(v) {
  const mios = pendMios(), otros = S.cola.length - mios.length, hist = S.hist.filter(h => h.uid === me().user).slice(0, 15);
  const tag = i => i.estado === 'pendiente' ? '<span class="tag p">Por enviar</span>' : i.estado === 'repetido' ? '<span class="tag r">Posible repetido</span>' : '<span class="tag e">Con error</span>';
  v.innerHTML = `${!S.online ? '<div class="aviso">Sin conexión: los registros se enviarán solos cuando vuelva la señal.</div>' : ''}${otros ? `<div class="aviso">Hay ${otros} registro(s) de otra persona pendientes en este teléfono; se envían cuando ella inicie sesión.</div>` : ''}
  <div class="card"><h2 style="--acc:var(--v)">📤 Por enviar (${mios.length})</h2><div class="cuerpo">${mios.length ? mios.map(i => `<div class="item" data-id="${i.id}"><div class="t">${MODS[i.modulo].icono} ${esc(resumen(i.modulo, i.datos))} ${tag(i)}</div>${i.error ? `<div class="e">${esc(i.error)}</div>` : ''}<div class="acc">${i.estado === 'repetido' ? '<button class="btn peq" data-a="forzar">Guardar de todos modos</button>' : ''}${i.estado === 'pendiente' ? '<button class="btn peq" data-a="reintentar">Enviar ahora</button>' : ''}${i.estado === 'error' ? '<button class="btn peq" data-a="reintentar">Reintentar</button>' : ''}<button class="btn sec peq" data-a="editar">Corregir</button><button class="btn sec peq" data-a="descartar">Descartar</button></div></div>`).join('') : '<div class="vacio-msg">No hay registros pendientes ✓</div>'}</div></div>
  <div class="card"><h2 style="--acc:var(--v2)">✓ Enviados desde este teléfono</h2><div class="cuerpo">${hist.length ? hist.map(h => `<div class="item"><div class="t">${MODS[h.modulo].icono} ${esc(h.resumen)}</div><div class="s">${new Date(h.t).toLocaleString('es-NI', {dateStyle: 'short', timeStyle: 'short'})}${h.fila ? ' · fila ' + h.fila : ''}</div></div>`).join('') : '<div class="vacio-msg">Aún no has enviado registros desde este teléfono.</div>'}</div></div>`;
  $$('[data-a]', v).forEach(b => b.onclick = async () => {
    const id = b.closest('.item').dataset.id, it = S.cola.find(x => x.id === id); if (!it) return;
    if (b.dataset.a === 'descartar') { if (confirm('¿Descartar este registro? No se enviará.')) { S.cola = S.cola.filter(x => x.id !== id); guardarCola(); pintarBadges(); pintarVista(); } }
    else if (b.dataset.a === 'reintentar') { it.estado = 'pendiente'; delete it.error; guardarCola(); pintarBadges(); sincronizar(); pintarVista(); }
    else if (b.dataset.a === 'forzar') { it.estado = 'pendiente'; it.forzar = true; delete it.error; guardarCola(); pintarBadges(); sincronizar(); pintarVista(); }
    else if (b.dataset.a === 'editar') { S.cola = S.cola.filter(x => x.id !== id); guardarCola(); S.vista = it.modulo; pintarTabs(); const vv = $('#vista'); vv.innerHTML = FORM[it.modulo].html(); vv.dataset.edicion = '1'; await FORM[it.modulo].montar($(`#f-${it.modulo}`), it.datos); pintarBadges(); toast('Corrige los datos y guarda de nuevo.'); }
  });
}

/* ======================================================================== PANTALLA, ENTRADA Y SALIDA */
const HTML = `<div id="app">
  <header id="top"><button class="chip atras" id="ffBack" type="button">← Mapa</button><h1>Formularios<small id="quien"></small></h1>
    <span id="estado"><i></i><span>En línea</span></span><button class="chip" id="bPend" hidden></button><button class="chip" id="ffCfg" type="button" aria-label="Mi cuenta">⚙</button></header>
  <main id="vista"></main><nav id="tabs" aria-label="Formularios"></nav>
  <div id="sheet" role="dialog" aria-modal="true"><div class="hoja"><div class="cab"><b id="shT"></b><button class="btn sec peq" id="shX" type="button">Cerrar</button></div><div class="cab" style="padding-top:0"><input type="text" id="shQ" placeholder="Buscar…" autocomplete="off"></div><div class="lista" id="shL"></div><div id="shLibre" style="padding:6px 12px 12px" hidden></div></div></div>
  <div id="modal" role="alertdialog" aria-modal="true"><div class="caja"><h3 id="mdT"></h3><ul id="mdL"></ul><div class="bs"><button class="btn sec" id="mdNo" type="button"></button><button class="btn" id="mdSi" type="button"></button></div></div></div>
  <div id="toast" role="status" aria-live="polite"></div></div>`;
function construir() {
  HOST = document.createElement('div'); HOST.id = 'ffHost'; document.body.appendChild(HOST);
  ROOT = HOST.attachShadow({mode: 'open'}); ROOT.innerHTML = '<style>' + FF_CSS + '</style>' + HTML;
  $('#ffBack').onclick = cerrar; $('#ffCfg').onclick = () => { if (typeof UI !== 'undefined') UI.openCfg(); };
  marcarRed(navigator.onLine);
}
function entradas() { const ok = A.auth.logged() && formulariosDe().length > 0; document.querySelectorAll('[data-ffopen]').forEach(b => { if (!b.dataset.ffsolo) b.hidden = !ok; }); }
/** Abre el módulo (opcionalmente en un formulario y con datos que vienen del mapa). */
async function abrir(mod, pre) {
  if (!A.auth.logged()) return;
  S.formularios = formulariosDe(); if (!S.formularios.length) { UI.toast('Tu usuario no tiene formularios habilitados.'); return; }
  if (!ROOT) construir();
  HOST.dataset.modo = document.documentElement.dataset.ui === 'movil' || (!document.documentElement.dataset.ui && innerWidth <= 820) ? 'movil' : 'web';   // la misma versión (web/móvil) que eligió el mapa
  HOST.classList.add('on'); S.pre = pre || null;
  const ms = modulosPermitidos(); S.vista = (mod && ms.includes(mod)) ? mod : (ms.includes(S.vista) || S.vista === 'pendientes' ? S.vista : (ms[0] || 'pendientes'));
  marcarRed(navigator.onLine); pintarBadges();
  if (!leerCacheMae()) { $('#vista').innerHTML = '<div class="card"><div class="cuerpo"><b>Cargando catálogos…</b><div class="ayuda" style="margin-top:6px">Solo la primera vez en este teléfono. Después se abren al instante, incluso sin señal.</div></div></div>'; await cargarMaestros(); }
  else cargarMaestros();   // con catálogos en el teléfono NO se espera al servidor: se actualizan en segundo plano si ya están viejos
  await pintarVista(); sincronizar();
}
function cerrar() { if (HOST) HOST.classList.remove('on'); }
async function iniciar() { S.formularios = formulariosDe(); entradas(); pintarBadges(); await cargarMaestros(); sincronizar(); }
// La pantalla del mapa puede construirse DESPUÉS de iniciar sesión (en el celular): se vuelve a evaluar cuando aparezca un botón de formularios.
new MutationObserver(ms => { if (ms.some(m => [...m.addedNodes].some(n => n.nodeType === 1 && ((n.matches && n.matches('[data-ffopen],[data-ffbadge]')) || (n.querySelector && n.querySelector('[data-ffopen],[data-ffbadge]')))))) { entradas(); contadorMapa(); } })
  .observe(document.body, {childList: true, subtree: true});
document.addEventListener('click', e => {   // botones del mapa: abrir los formularios o un ATS con el plantío ya elegido
  const b = e.target.closest && e.target.closest('[data-ffopen]'); if (!b) return; e.preventDefault();
  abrir(b.dataset.ffopen || null, b.dataset.ffplantio ? {plantio: b.dataset.ffplantio, frente: b.dataset.fffrente, nombre: b.dataset.ffnombre} : null);
});
A.on('login', () => { iniciar(); });
A.on('perfil', () => {
  S.formularios = formulariosDe(); entradas();
  if (!ROOT) return; pintarTabs();
  if (!Forms.abierto) return;
  const ms = modulosPermitidos();
  if (!ms.length) { cerrar(); UI.toast('Tu usuario ya no tiene formularios habilitados.'); }   // le quitaron todos mientras los tenía abiertos
  else if (S.vista !== 'pendientes' && !ms.includes(S.vista)) { S.vista = ms[0]; pintarVista(); UI.toast('Se cambió de formulario: ya no tienes permiso para el anterior.'); }
});
A.on('maestros', () => { cargarMaestros(true); });
A.on('status', () => { if (A.maeVersion != null && S.mv != null && A.maeVersion !== S.mv) cargarMaestros(true); });   // los catálogos guardados son de una versión anterior de los maestros   // un administrador cambió los maestros: se vuelven a bajar ya, sin esperar los 10 minutos
A.on('logout', () => {   // al salir: se cierra la pantalla y se borran los catálogos del teléfono (nombres y fichas); la cola de pendientes se conserva
  cerrar(); S.mae = null; S.plantios = {}; S.formularios = []; LS.del('mae'); Object.keys(localStorage).filter(k => k.indexOf('ff_plan_') === 0).forEach(k => localStorage.removeItem(k)); entradas(); pintarBadges();
});
Forms = {abrir, cerrar, iniciar, entradas, get abierto() { return !!HOST && HOST.classList.contains('on'); }, get pendientes() { return pendMios().length; }};
window.__ff = {S, api, encolar, sincronizar, pintarVista, cargarMaestros, AVISOS, get root() { return ROOT; }};
if (A.auth.logged()) iniciar(); else entradas();
}
