/* Banco de pruebas: ejecuta Codigo.gs con simulaciones de SpreadsheetApp, Utilities, CacheService, etc.
 * Uso:  node harness.js test      → pruebas automáticas del servidor
 *       node harness.js serve 8787 → servidor HTTP local (POST / = doPost, POST /__admin = funciones internas) */
const vm = require('vm'), fs = require('fs'), crypto = require('crypto'), http = require('http'), path = require('path');

function nuevoEntorno() {
  const t0 = {now: Date.now()};
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(t0.now); }
    static now() { return t0.now; }
  }
  class Rango {
    constructor(h, r, c, nr, nc) { Object.assign(this, {h, r, c, nr, nc}); }
    getValues() { const o = []; for (let i = 0; i < this.nr; i++) { const f = []; for (let j = 0; j < this.nc; j++) { const v = (this.h.d[this.r + i - 1] || [])[this.c + j - 1]; f.push(v === undefined ? '' : v); } o.push(f); } return o; }
    setValues(v) { for (let i = 0; i < v.length; i++) for (let j = 0; j < v[i].length; j++) { const row = this.r + i - 1; this.h.d[row] = this.h.d[row] || []; this.h.d[row][this.c + j - 1] = v[i][j]; } return this; }
    setValue(v) { return this.setValues([[v]]); }
    setNumberFormat() { return this; } setFontWeight() { return this; } setDataValidation() { return this; }
  }
  class Hoja {
    constructor(n) { this.n = n; this.d = []; }
    getLastColumn() { let m = 0; this.d.forEach(r => { if (r) r.forEach((x, j) => { if (x !== '' && x !== undefined && j + 1 > m) m = j + 1; }); }); return m; }
    getLastRow() { let l = 0; this.d.forEach((r, i) => { if (r && r.some(x => x !== '' && x !== undefined)) l = i + 1; }); return l; }
    getRange(r, c, nr = 1, nc = 1) { return new Rango(this, r, c, nr, nc); }
    setFrozenRows() {}
  }
  const hojas = {};
  const props = {}, cache = {};
  const sandbox = {
    console, Date: FakeDate, JSON, Math, String, Number, Object, Array, Error, RegExp, Buffer,
    ContentService: {MimeType: {JSON: 'json'}, createTextOutput: s => ({s, setMimeType() { return this; }, getContent() { return this.s; }})},
    LockService: {getScriptLock: () => ({waitLock() {}, releaseLock() {}})},
    PropertiesService: {getScriptProperties: () => ({getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; }})},
    CacheService: {getScriptCache: () => ({get: k => (cache[k] && cache[k].e > t0.now ? cache[k].v : null), put: (k, v, s) => { cache[k] = {v, e: t0.now + s * 1000}; }, remove: k => { delete cache[k]; }})},
    SpreadsheetApp: {
      getActive: () => ({getSheetByName: n => hojas[n] || null, insertSheet: n => (hojas[n] = new Hoja(n))}),
      newDataValidation: () => ({requireValueInList() { return this; }, build() { return {}; }}),
      getUi: () => ({}),
    },
    Utilities: {
      DigestAlgorithm: {SHA_256: 'sha256'},
      computeDigest: (a, v) => Array.from(crypto.createHash('sha256').update(v, 'utf8').digest()).map(b => b > 127 ? b - 256 : b),
      computeHmacSha256Signature: (v, k) => Array.from(crypto.createHmac('sha256', k).update(v, 'utf8').digest()).map(b => b > 127 ? b - 256 : b),
      base64EncodeWebSafe: x => (typeof x === 'string' ? Buffer.from(x) : Buffer.from(x.map(b => (b + 256) % 256))).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64DecodeWebSafe: s => Array.from(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')).map(b => b > 127 ? b - 256 : b),
      newBlob: bytes => ({getDataAsString: () => Buffer.from(bytes.map(b => (b + 256) % 256)).toString('utf8')}),
      getUuid: () => crypto.randomUUID(), sleep() {},
    },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'Codigo.gs'), 'utf8'), ctx, {filename: 'Codigo.gs'});
  const post = (body) => JSON.parse(vm.runInContext('doPost(__e).getContent()', Object.assign(ctx, {__e: {postData: {contents: JSON.stringify(body)}}})));
  return {ctx, hojas, post, adelantar: ms => { t0.now += ms; },
    admin: (fn, ...a) => { ctx.__a = a; return vm.runInContext(`${fn}(...__a)`, ctx); },
    reloj: t0};
}

if (require.main === module) {
  const modo = process.argv[2];
  if (modo === 'serve') {
    const E = nuevoEntorno(), port = Number(process.argv[3] || 8787);
    http.createServer((req, res) => {
      const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Content-Type': 'application/json'};
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
      let b = ''; req.on('data', c => b += c); req.on('end', () => {
        try {
          if (req.url.startsWith('/__admin')) { const j = JSON.parse(b); res.writeHead(200, cors); return res.end(JSON.stringify({r: E.admin(j.fn, ...(j.args || []))})); }
          if (req.url.startsWith('/__dump')) { const n = decodeURIComponent(req.url.split('?h=')[1] || ''); res.writeHead(200, cors); return res.end(JSON.stringify((E.hojas[n] || {d: []}).d)); }
          if (req.method === 'GET') { res.writeHead(200, cors); return res.end(vm.runInContext('doGet().getContent()', E.ctx)); }
          const r = E.post(JSON.parse(b)); res.writeHead(200, cors); res.end(JSON.stringify(r));
        } catch (e) { res.writeHead(500, cors); res.end(JSON.stringify({ok: false, error: String(e)})); }
      });
    }).listen(port, () => console.log('gas harness en', port));
  } else {
    let ok = 0, mal = 0;
    const T = (n, c, extra) => { if (c) { ok++; console.log('  ok  ', n); } else { mal++; console.log('  FALLA', n, extra ? JSON.stringify(extra) : ''); } };
    const E = nuevoEntorno(); E.post({action: 'sync'});  // sin sesión
    console.log('Pruebas del servidor');
    let r = E.post({action: 'sync'}); T('sync sin token → sesión inválida', !r.ok && r.code === 'sesion', r);
    r = E.post({action: 'login', usuario: 'nadie', clave: '123456'}); T('usuario inexistente → mensaje genérico', !r.ok && /incorrectos/.test(r.error), r);
    const c1 = E.admin('crearUsuario_', 'JPerez', 'Juan Pérez · Sup K4', 'Supervisor'); T('crearUsuario_ devuelve código de 6 dígitos', /^\d{6}$/.test(c1.codigo) && c1.nuevo, c1);
    const dump = JSON.stringify(E.hojas['Usuarios'].d); T('la clave temporal no queda en texto en la hoja', !dump.includes(c1.codigo));
    r = E.post({action: 'login', usuario: 'jperez', clave: 'mala'}); T('clave incorrecta rechazada', !r.ok, r);
    r = E.post({action: 'login', usuario: 'JPEREZ', clave: c1.codigo}); T('login con temporal exige cambio (sin token)', r.ok && r.cambiar && !r.token, r);
    r = E.post({action: 'cambiar_clave', usuario: 'jperez', actual: c1.codigo, nueva: '123'}); T('clave corta rechazada', !r.ok, r);
    r = E.post({action: 'cambiar_clave', usuario: 'jperez', actual: c1.codigo, nueva: 'Zafra2627'}); T('cambio de clave ok', r.ok, r);
    r = E.post({action: 'login', usuario: 'jperez', clave: c1.codigo}); T('la clave temporal ya no sirve', !r.ok, r);
    r = E.post({action: 'login', usuario: 'jperez', clave: 'Zafra2627'}); T('login con clave nueva entrega token, rol y capas', r.ok && r.token && r.rol === 'Supervisor' && r.prefs.lE === true && r.prefs.ref === false, r);
    const tok = r.token;
    r = E.post({action: 'sync', token: tok}); T('sync con token válido', r.ok && r.nombre.startsWith('Juan') && r.status && r.prefs, r);
    r = E.post({action: 'sync', token: tok.slice(0, -3) + 'abc'}); T('token alterado rechazado', !r.ok && r.code === 'sesion', r);
    // capas por usuario
    r = E.post({action: 'prefs_set', token: tok, prefs: {lE: true, lS: true, lME: false, lMS: false, lAV: true, lB: false, lC: false, lO: false, pR: true, pP: false, pX: false, pO: false, ref: true}}); T('guardar capas', r.ok, r);
    let cfg = E.hojas['Configuración'].d; T('hoja Configuración tiene encabezado y una fila Sí/No', cfg[0][0] === 'Usuario' && cfg[1][0] === 'jperez' && cfg[1][1] === 'Sí' && cfg[1][3] === 'No' && cfg[1][13] === 'Sí', cfg);
    r = E.post({action: 'prefs_set', token: tok, prefs: {lE: false}}); cfg = E.hojas['Configuración'].d; T('actualiza la misma fila, no duplica', cfg.filter(x => x && x[0] === 'jperez').length === 1 && cfg[1][1] === 'No');
    r = E.post({action: 'sync', token: tok}); T('sync devuelve las capas guardadas', r.prefs.lE === false && r.prefs.pR === false && r.prefs.ref === false || r.prefs.lS === true, r.prefs);
    // edición manual de la hoja por un admin
    E.hojas['Configuración'].d[1][2] = 'No'; r = E.post({action: 'sync', token: tok}); T('lee cambios hechos a mano en la hoja', r.prefs.lS === false, r.prefs);
    // respuestas
    const it = (id, res, nota) => ({id, ts: new Date().toISOString(), codigo: '80683', nombre: 'ISA IDELFONSO', frente: 'K4', semana: 6, secuencia: 11, fecha_plan: '2027-01-12', fecha_real: '2026-11-10', resultado: res, aspectos: 'Ruta de entrada', nota, usuario: 'FALSO-ADMIN', lat: '', lon: '', prec: '', mapeo: '26-27', origen: 'web'});
    r = E.post({action: 'submit', token: tok, items: [it('a1', 'Diferente', 'Puente cerrado, se usó acceso norte'), it('a2', 'Diferente', ''), it('a3', 'Según lo planificado', '')]});
    T('acepta 2, rechaza la diferente sin nota', r.ok && r.accepted.join() === 'a1,a3', r);
    r = E.post({action: 'submit', token: tok, items: [it('a1', 'Diferente', 'x')]}); T('reenvío no duplica', r.ok && E.hojas['Respuestas'].getLastRow() === 3, E.hojas['Respuestas'].getLastRow());
    const f = E.hojas['Respuestas'].d[1]; T('el usuario sale de la sesión, no del cliente', f[13] === 'jperez' && f[19].startsWith('Juan') && f[20] === 'Supervisor', f);
    r = E.post({action: 'sync', token: tok}); T('status por plantío con el último registro', r.status['80683'] && r.status['80683'].r && r.status['80683'].u.startsWith('Juan'), r.status);
    // rol Consulta
    const c2 = E.admin('crearUsuario_', 'lectura', 'Lector', 'consulta'); E.post({action: 'cambiar_clave', usuario: 'lectura', actual: c2.codigo, nueva: 'abcdef'});
    const t2 = E.post({action: 'login', usuario: 'lectura', clave: 'abcdef'}).token;
    r = E.post({action: 'submit', token: t2, items: [it('b1', 'Según lo planificado', '')]}); T('rol Consulta no puede enviar', !r.ok && /consulta/i.test(r.error), r);
    r = E.post({action: 'sync', token: t2}); T('rol Consulta sí puede leer', r.ok && r.rol === 'Consulta', r);
    // bloqueo por intentos
    E.admin('crearUsuario_', 'bloq', 'B', 'Supervisor'); let l;
    for (let i = 0; i < 5; i++) l = E.post({action: 'login', usuario: 'bloq', clave: 'x' + i});
    l = E.post({action: 'login', usuario: 'bloq', clave: 'otra'}); T('bloqueo tras 5 fallos', !l.ok && /intentos/.test(l.error), l);
    E.adelantar(16 * 60 * 1000); l = E.post({action: 'login', usuario: 'bloq', clave: 'otra'}); T('el bloqueo expira a los 15 min', !l.ok && /incorrectos/.test(l.error), l);
    // desactivar y reinicio
    const fila = E.admin('buscarUsuario_', 'jperez').fila; E.hojas['Usuarios'].d[fila - 1][3] = 'No';
    r = E.post({action: 'sync', token: tok}); T('usuario desactivado pierde la sesión de inmediato', !r.ok && r.code === 'sesion', r);
    E.hojas['Usuarios'].d[fila - 1][3] = 'Sí';
    r = E.post({action: 'sync', token: tok}); T('al reactivarlo la sesión vuelve a valer', r.ok, r);
    const c3 = E.admin('crearUsuario_', 'jperez', '', ''); T('reiniciar clave conserva nombre y rol', !c3.nuevo && E.admin('buscarUsuario_', 'jperez').rol === 'Supervisor');
    r = E.post({action: 'sync', token: tok}); T('reiniciar clave invalida las sesiones anteriores', !r.ok && r.code === 'sesion', r);
    // expiración
    r = E.post({action: 'cambiar_clave', usuario: 'jperez', actual: c3.codigo, nueva: 'NuevaClave1'}); const t3 = E.post({action: 'login', usuario: 'jperez', clave: 'NuevaClave1'}).token;
    E.adelantar(31 * 86400000); r = E.post({action: 'sync', token: t3}); T('la sesión expira a los 30 días', !r.ok && r.code === 'sesion', r);
    r = E.post({action: 'borrar'}); T('acción desconocida', !r.ok, r);
    r = JSON.parse(E.ctx.doGet().getContent()); T('doGet no expone datos', r.ok && !r.status && !r.usuarios, r);
    // ---- capas de apoyo (QField) en el perfil ----
    const E2 = nuevoEntorno(); const c9 = E2.admin('crearUsuario_', 'nuevo', 'Nuevo', 'Supervisor'); E2.post({action: 'cambiar_clave', usuario: 'nuevo', actual: c9.codigo, nueva: 'abcdef'});
    const lg = E2.post({action: 'login', usuario: 'nuevo', clave: 'abcdef'}); const pf = lg.prefs;
    T('usuario nuevo: capas de apoyo con valores por defecto (pozos sí, motores no, todo el mapa no)', pf.xpozos === true && pf.xvalvulas === true && pf.xpostes === true && pf.xmotores === false && pf.xobstaculos === false && pf.xvial === false && pf.xaa === false && pf.xall === false && pf.xquemaP === true, pf);
    r = E2.post({action: 'prefs_set', token: lg.token, prefs: {xpozos: false, xvial: true, xall: true, xmotores: true}}); T('guardar capas de apoyo', r.ok, r);
    r = E2.post({action: 'sync', token: lg.token}); T('sync devuelve capas de apoyo guardadas', r.prefs.xpozos === false && r.prefs.xvial === true && r.prefs.xall === true && r.prefs.xmotores === true && r.prefs.xpostes === true, r.prefs);
    const hd = E2.hojas['Configuración'].d[0]; T('encabezado de Configuración incluye las capas de apoyo', hd.includes('Pozos') && hd.includes('Red vial') && hd.includes('Capas de apoyo: todo el mapa (zoom 14+)') && hd[hd.length - 1] === 'Actualizado', hd);
    // migración: hoja creada con la versión anterior (13 capas) y datos de un usuario existente
    const E3 = nuevoEntorno(); E3.admin('hojaUsr_'); const viejo = ['Usuario', 'Ruta de entrada', 'Ruta de salida', 'Muleo de entrada', 'Muleo de salida', 'Muleo de autovolteo', 'Bahías / internas', 'Cabecereo / conformación', 'Otras líneas', 'Apertura de raja', 'Punto de control', 'Riesgo / peligro', 'Referencia vial', 'Mapeo 25-26 superpuesto', 'Actualizado'];
    const hv = E3.ctx.SpreadsheetApp.getActive().insertSheet('Configuración'); hv.getRange(1, 1, 1, viejo.length).setValues([viejo]);
    hv.getRange(2, 1, 1, viejo.length).setValues([['antiguo', 'No', 'Sí', 'Sí', 'Sí', 'Sí', 'No', 'Sí', 'Sí', 'No', 'Sí', 'Sí', 'Sí', 'Sí', '2026-11-01']]);
    E3.admin('hojaCfg_'); const m = E3.hojas['Configuración'].d; const col = n => m[0].indexOf(n);
    T('migración: conserva los valores de cada usuario por nombre de columna', m[1][0] === 'antiguo' && m[1][col('Ruta de entrada')] === 'No' && m[1][col('Apertura de raja')] === 'No' && m[1][col('Mapeo 25-26 superpuesto')] === 'Sí' && m[1][col('Actualizado')] === '2026-11-01', m[1]);
    T('migración: las capas nuevas quedan vacías (= por defecto) y el encabezado se actualiza', m[1][col('Pozos')] === '' && m[1][col('Capas de apoyo: todo el mapa (zoom 14+)')] === '' && m[0].length === 27, [m[0].length, m[1][col('Pozos')]]);
    const lgA = (() => { const cA = E3.admin('crearUsuario_', 'antiguo', 'Antiguo', 'Supervisor'); E3.post({action: 'cambiar_clave', usuario: 'antiguo', actual: cA.codigo, nueva: 'abcdef'}); return E3.post({action: 'login', usuario: 'antiguo', clave: 'abcdef'}); })();
    T('migración: usuario antiguo conserva su vista y recibe defaults en las capas nuevas', lgA.prefs.lE === false && lgA.prefs.xpozos === true && lgA.prefs.xall === false, lgA.prefs);
    console.log(`\n${ok} correctas, ${mal} fallas`); process.exit(mal ? 1 : 0);
  }
}
module.exports = {nuevoEntorno};
