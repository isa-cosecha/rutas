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
    // ---- administración de usuarios desde la aplicación ----
    const E4 = nuevoEntorno(), clave0 = 'clave123';
    const mk = (u, nombre, rol) => { const c = E4.admin('crearUsuario_', u, nombre, rol); E4.post({action: 'cambiar_clave', usuario: u, actual: c.codigo, nueva: clave0}); return E4.post({action: 'login', usuario: u, clave: clave0}); };
    const ad1 = mk('admin1', 'Administrador Uno', 'Administrador'), su1 = mk('sup1', 'Supervisor Uno', 'Supervisor'), co1 = mk('con1', 'Consulta Uno', 'Consulta');
    T('el login entrega los permisos del rol', ad1.permisos.includes('usuarios_admin') && su1.permisos.join() === 'ver,responder' && co1.permisos.join() === 'ver', [ad1.permisos, su1.permisos, co1.permisos]);
    r = E4.post({action: 'usr_listar', token: su1.token}); T('un Supervisor NO puede listar usuarios (aunque llame al servidor)', !r.ok && r.code === 'permiso', r);
    r = E4.post({action: 'usr_crear', token: co1.token, usuario: 'intruso', nombre: 'X', rol: 'Administrador'}); T('un usuario de Consulta NO puede crear usuarios ni darse permisos', !r.ok && r.code === 'permiso' && !E4.admin('buscarUsuario_', 'intruso'), r);
    r = E4.post({action: 'usr_editar', token: su1.token, usuario: 'sup1', rol: 'Administrador'}); T('un Supervisor NO puede ascenderse a Administrador', !r.ok && r.code === 'permiso' && E4.admin('buscarUsuario_', 'sup1').rol === 'Supervisor', r);
    r = E4.post({action: 'usr_reiniciar', token: su1.token, usuario: 'admin1'}); T('un Supervisor NO puede restablecer la clave de un administrador', !r.ok && r.code === 'permiso', r);
    r = E4.post({action: 'usr_listar', token: 'falso.token'}); T('sin sesión válida no se administra nada', !r.ok && r.code === 'sesion', r);
    r = E4.post({action: 'usr_listar', token: ad1.token}); const hashReal = E4.hojas['Usuarios'].d[1][6];
    T('el administrador lista los usuarios con rol, estado y último ingreso', r.ok && r.usuarios.length === 3 && r.usuarios.every(u => u.usuario && u.rol && typeof u.activo === 'boolean' && u.ultimo), r.usuarios);
    T('la lista JAMÁS incluye sal ni hash de claves', !/"(sal|hash)"/.test(JSON.stringify(r)) && !JSON.stringify(r).includes(hashReal));
    T('la lista incluye la matriz de permisos por rol', r.permisos.Administrador.includes('usuarios_admin') && !r.permisos.Supervisor.includes('usuarios_admin') && r.etiquetas.usuarios_admin, r.permisos);
    const codigos = [];
    r = E4.post({action: 'usr_crear', token: ad1.token, usuario: 'Nuevo.Usr', nombre: 'Nuevo Usuario', rol: 'supervisor'}); codigos.push(r.codigo);
    T('crear usuario: entrega un código temporal de 6 dígitos y normaliza el nombre de usuario', r.ok && /^\d{6}$/.test(r.codigo) && r.usuario === 'nuevo.usr' && E4.admin('buscarUsuario_', 'nuevo.usr').rol === 'Supervisor', r);
    T('el código temporal no queda guardado en texto en la hoja', !JSON.stringify(E4.hojas['Usuarios'].d).includes(r.codigo));
    r = E4.post({action: 'usr_crear', token: ad1.token, usuario: 'nuevo.usr', nombre: 'Otro', rol: 'Consulta'}); T('crear un usuario que ya existe se rechaza', !r.ok && /ya existe/.test(r.error), r);
    r = E4.post({action: 'usr_crear', token: ad1.token, usuario: 'a b', nombre: 'X', rol: 'Consulta'}); T('nombre de usuario con espacios se rechaza', !r.ok && /inválido/.test(r.error), r);
    r = E4.post({action: 'usr_crear', token: ad1.token, usuario: 'otro.usr', nombre: 'X', rol: 'Jefe'}); T('rol inexistente se rechaza', !r.ok && /rol/i.test(r.error) && !E4.admin('buscarUsuario_', 'otro.usr'), r);
    r = E4.post({action: 'login', usuario: 'nuevo.usr', clave: codigos[0]}); T('el usuario nuevo entra con el código y debe crear su propia clave', r.ok && r.cambiar && !r.token, r);
    r = E4.post({action: 'usr_listar', token: ad1.token}); T('la lista marca al usuario nuevo como pendiente de primer ingreso', r.usuarios.find(u => u.usuario === 'nuevo.usr').pendiente === true);
    E4.post({action: 'cambiar_clave', usuario: 'nuevo.usr', actual: codigos[0], nueva: 'MiClave99'}); const nu = E4.post({action: 'login', usuario: 'nuevo.usr', clave: 'MiClave99'});
    T('tras crear su clave el usuario entra con normalidad', nu.ok && nu.token && nu.rol === 'Supervisor', nu);
    // restablecer clave
    r = E4.post({action: 'usr_reiniciar', token: ad1.token, usuario: 'nuevo.usr'}); codigos.push(r.codigo);
    T('restablecer clave entrega un código temporal nuevo', r.ok && /^\d{6}$/.test(r.codigo), r);
    T('la clave anterior deja de servir', !E4.post({action: 'login', usuario: 'nuevo.usr', clave: 'MiClave99'}).ok);
    T('las sesiones abiertas del usuario se cierran', E4.post({action: 'sync', token: nu.token}).code === 'sesion');
    r = E4.post({action: 'login', usuario: 'nuevo.usr', clave: codigos[1]}); T('con el código nuevo debe volver a crear su clave', r.ok && r.cambiar, r);
    r = E4.post({action: 'usr_reiniciar', token: ad1.token, usuario: 'admin1'}); T('un administrador no restablece su propia clave desde aquí', !r.ok && /Cambiar clave/.test(r.error), r);
    r = E4.post({action: 'usr_reiniciar', token: ad1.token, usuario: 'fantasma'}); T('restablecer un usuario inexistente se rechaza', !r.ok && /no existe/.test(r.error), r);
    // roles y estado
    const su2 = mk('sup2', 'Supervisor Dos', 'Supervisor'); const itz = {id: 'z1', ts: new Date().toISOString(), codigo: '80683', nombre: 'X', resultado: 'Según lo planificado', usuario: 'x'};
    T('antes del cambio de rol, el Supervisor puede registrar respuestas', E4.post({action: 'submit', token: su2.token, items: [itz]}).ok);
    r = E4.post({action: 'usr_editar', token: ad1.token, usuario: 'sup2', rol: 'Consulta'}); T('cambiar el rol a Consulta', r.ok, r);
    r = E4.post({action: 'submit', token: su2.token, items: [{...itz, id: 'z2'}]}); T('el cambio de rol rige de inmediato, sin que el usuario salga y entre', !r.ok && r.code === 'permiso', r);
    r = E4.post({action: 'sync', token: su2.token}); T('y sus permisos reflejan el rol nuevo', r.ok && r.rol === 'Consulta' && r.permisos.join() === 'ver', r);
    r = E4.post({action: 'usr_editar', token: ad1.token, usuario: 'sup2', activo: false}); T('desactivar usuario', r.ok, r);
    T('un usuario desactivado pierde la sesión al instante', E4.post({action: 'sync', token: su2.token}).code === 'sesion');
    T('y no puede volver a entrar', !E4.post({action: 'login', usuario: 'sup2', clave: clave0}).ok);
    E4.post({action: 'usr_editar', token: ad1.token, usuario: 'sup2', activo: true}); T('reactivarlo le devuelve el acceso con su misma clave', E4.post({action: 'login', usuario: 'sup2', clave: clave0}).ok);
    r = E4.post({action: 'usr_editar', token: ad1.token, usuario: 'sup2', nombre: 'Supervisor Dos (K8)'}); T('cambiar el nombre', r.ok && E4.admin('buscarUsuario_', 'sup2').nombre === 'Supervisor Dos (K8)', r);
    r = E4.post({action: 'usr_editar', token: ad1.token, usuario: 'sup2', nombre: 'Supervisor Dos (K8)'}); T('editar sin cambios no hace nada', r.ok && r.sinCambios, r);
    r = E4.post({action: 'usr_editar', token: ad1.token, usuario: 'admin1', rol: 'Consulta'}); T('un administrador no puede quitarse su propio rol', !r.ok && /propio rol/.test(r.error) && E4.admin('buscarUsuario_', 'admin1').rol === 'Administrador', r);
    r = E4.post({action: 'usr_editar', token: ad1.token, usuario: 'admin1', activo: false}); T('ni desactivarse a sí mismo', !r.ok && E4.admin('buscarUsuario_', 'admin1').activo === true, r);
    r = E4.post({action: 'usr_editar', token: ad1.token, usuario: 'sup2', rol: 'Rey'}); T('editar con un rol inválido se rechaza', !r.ok, r);
    r = E4.post({action: 'usr_editar', token: ad1.token, usuario: 'fantasma', rol: 'Consulta'}); T('editar un usuario inexistente se rechaza', !r.ok, r);
    // segundo administrador
    const ad2 = mk('admin2', 'Administrador Dos', 'Administrador');
    r = E4.post({action: 'usr_editar', token: ad2.token, usuario: 'admin1', rol: 'Supervisor'}); T('un administrador puede degradar a otro administrador', r.ok, r);
    T('el administrador degradado pierde los permisos de inmediato', E4.post({action: 'usr_listar', token: ad1.token}).code === 'permiso');
    T('y siempre queda al menos un administrador activo', E4.admin('leerUsuarios_').filter(u => u.rol === 'Administrador' && u.activo).length >= 1);
    // desbloqueo
    for (let i = 0; i < 5; i++) E4.post({action: 'login', usuario: 'con1', clave: 'mala' + i});
    T('tras 5 intentos fallidos el usuario queda bloqueado', /intentos/.test(E4.post({action: 'login', usuario: 'con1', clave: clave0}).error));
    r = E4.post({action: 'usr_listar', token: ad2.token}); T('la lista lo muestra como bloqueado', r.usuarios.find(u => u.usuario === 'con1').bloqueado === true);
    r = E4.post({action: 'usr_desbloquear', token: ad2.token, usuario: 'con1'}); T('el administrador lo desbloquea sin cambiarle la clave', r.ok && E4.post({action: 'login', usuario: 'con1', clave: clave0}).ok, r);
    // auditoría
    const aud = E4.hojas['Auditoría'].d, acciones = aud.slice(1).map(f => f[2]);
    T('la auditoría registra crear, restablecer, editar y desbloquear', ['Crear usuario', 'Restablecer clave', 'Editar usuario', 'Desbloquear usuario'].every(a => acciones.includes(a)), acciones);
    T('cada registro dice quién lo hizo y a quién afectó', aud.slice(1).every(f => /\(/.test(f[1]) && f[3]) && aud[1][1].startsWith('admin1'), aud[1]);
    T('la auditoría nunca guarda claves ni códigos temporales', codigos.every(c => !JSON.stringify(aud).includes(c)));
    T('los intentos rechazados (sin permiso) no dejan registros de cambios', !aud.some(f => /intruso/.test(f[3])));
    r = E4.post({action: 'usr_auditoria', token: ad2.token});
    T('el administrador consulta el historial de cambios, lo más reciente primero', r.ok && r.registros.length >= 5 && r.registros[0].fecha >= r.registros[r.registros.length - 1].fecha && r.registros.every(x => x.accion && x.admin), r.registros && r.registros.slice(0, 2));
    T('el historial nunca expone claves ni códigos temporales', codigos.every(c => !JSON.stringify(r).includes(c)));
    T('un Supervisor NO puede ver el historial', E4.post({action: 'usr_auditoria', token: su1.token}).code === 'permiso');
    T('sin sesión no hay historial', E4.post({action: 'usr_auditoria', token: 'x.y'}).code === 'sesion');
    console.log(`\n${ok} correctas, ${mal} fallas`); process.exit(mal ? 1 : 0);
  }
}
module.exports = {nuevoEntorno};
