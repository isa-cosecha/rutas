/**
 * Servidor de usuarios, configuración y respuestas del Visor de Rutas por Plantío (Zafra 2026-2027).
 *
 * Hojas que administra (se crean solas):
 *   Usuarios       Quién puede entrar. Las claves se guardan con sal y hash, nunca en texto.
 *   Configuración  Una fila por usuario con las capas del mapa que quiere ver (Sí / No).
 *   Respuestas     "Se trabajó según lo planificado / diferente", con nota. El usuario sale de la sesión.
 *
 * INSTALACIÓN (una vez; si ya tenías la versión anterior, reemplaza TODO el código):
 * 1. Hoja de cálculo > Extensiones > Apps Script. Pega este archivo y guarda.
 * 2. Implementar > Administrar implementaciones > Editar (lápiz) > Versión: "Nueva versión" > Implementar.
 *    La URL /exec no cambia. Tipo "Aplicación web", ejecutar como "Yo", acceso "Cualquier usuario".
 * 3. Recarga la hoja de cálculo: aparece el menú "Rutas".
 *    Rutas > 1. Configuración inicial.   Rutas > 2. Crear o reiniciar usuario (entrega un código temporal).
 *
 * SEGURIDAD: quien edita la hoja de cálculo ve los hashes. Comparte la hoja solo con administradores;
 * los usuarios del visor no necesitan acceso a ella.
 */
const HOJA_RESP = 'Respuestas', HOJA_USR = 'Usuarios', HOJA_CFG = 'Configuración';
const SESION_DIAS = 30, MAX_FALLOS = 5, BLOQUEO_SEG = 900, ITERACIONES = 1500, CLAVE_MIN = 6;
const ROLES = ['Administrador', 'Supervisor', 'Consulta'];

const HEAD_RESP = ['Recibido', 'ID', 'Fecha/hora dispositivo', 'Código', 'Nombre', 'Frente', 'Semana', 'Secuencia',
  'Fecha corte plan', 'Fecha de trabajo', 'Resultado', 'Aspectos diferentes', 'Nota', 'Usuario',
  'Latitud', 'Longitud', 'Precisión (m)', 'Mapeo usado', 'Origen', 'Nombre usuario', 'Rol'];
const HEAD_USR = ['Usuario', 'Nombre', 'Rol', 'Activo', 'Debe cambiar clave', 'Sal', 'Hash', 'Creado', 'Último ingreso'];
// Capas del visor: clave interna → título de la columna en "Configuración"
const CAPAS = [['lE', 'Ruta de entrada'], ['lS', 'Ruta de salida'], ['lME', 'Muleo de entrada'], ['lMS', 'Muleo de salida'],
  ['lAV', 'Muleo de autovolteo'], ['lB', 'Bahías / internas'], ['lC', 'Cabecereo / conformación'], ['lO', 'Otras líneas'],
  ['pR', 'Apertura de raja'], ['pP', 'Punto de control'], ['pX', 'Riesgo / peligro'], ['pO', 'Referencia vial'],
  ['ref', 'Mapeo 25-26 superpuesto'],
  // Capas de apoyo del proyecto QField (ids de scripts/capas_config.json con prefijo "x"). Si agregas una capa allá, agrégala aquí.
  ['xpozos', 'Pozos'], ['xmotores', 'Motores eléctricos'], ['xvalvulas', 'Válvulas de goteo'], ['xobstaculos', 'Otros obstáculos de riego'],
  ['xpostes', 'Postes eléctricos'], ['xrios', 'Ríos'], ['xvial', 'Red vial'], ['xquemaP', 'Límites de quema (polígonos)'],
  ['xquemaAC', 'Contorno de quemas (AC)'], ['xquemaPV', 'Quemas de proveedores'], ['xaa', 'Áreas a autorizar (AA)'],
  ['xall', 'Capas de apoyo: todo el mapa (zoom 14+)']];
const HEAD_CFG = ['Usuario'].concat(CAPAS.map(c => c[1]), ['Actualizado']);
const APAGADAS_DEFECTO = ['ref', 'xall', 'xmotores', 'xobstaculos', 'xvial', 'xaa'];   // el resto nace encendido
const CAPAS_DEFECTO = CAPAS.reduce((o, c) => (o[c[0]] = APAGADAS_DEFECTO.indexOf(c[0]) < 0, o), {});

/* ---------- utilidades ---------- */
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function si_(v) { return ['si', 'sí', 's', 'true', '1', 'x', 'yes'].indexOf(String(v).trim().toLowerCase()) >= 0; }
function norm_(u) { return String(u || '').trim().toLowerCase(); }
function hex_(bytes) { return bytes.map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join(''); }

function hoja_(nombre, encabezado, antes) {
  const ss = SpreadsheetApp.getActive();
  let s = ss.getSheetByName(nombre);
  if (!s) { s = ss.insertSheet(nombre); if (antes) antes(s); }
  const cur = s.getRange(1, 1, 1, encabezado.length).getValues()[0];
  if (cur.join('|') !== encabezado.join('|')) s.getRange(1, 1, 1, encabezado.length).setValues([encabezado]).setFontWeight('bold');
  s.setFrozenRows(1);
  return s;
}
function hojaResp_() { return hoja_(HOJA_RESP, HEAD_RESP, s => s.getRange(2, 4, 5000, 1).setNumberFormat('@')); }
/** Hoja Configuración. Si cambió el encabezado (capas nuevas), reubica los datos de cada usuario por nombre de columna. */
function hojaCfg_() {
  const ss = SpreadsheetApp.getActive();
  let s = ss.getSheetByName(HOJA_CFG);
  if (!s) {
    s = ss.insertSheet(HOJA_CFG);
    s.getRange(1, 1, 1, HEAD_CFG.length).setValues([HEAD_CFG]).setFontWeight('bold'); s.setFrozenRows(1);
    return s;
  }
  const w = Math.max(s.getLastColumn(), 1), viejo = s.getRange(1, 1, 1, w).getValues()[0].map(x => String(x).trim());
  if (viejo.slice(0, HEAD_CFG.length).join('|') !== HEAD_CFG.join('|')) {
    const n = s.getLastRow(), filas = n >= 2 ? s.getRange(2, 1, n - 1, w).getValues() : [];
    const nuevas = filas.map(r => HEAD_CFG.map(h => { const i = viejo.indexOf(h); return i >= 0 ? r[i] : ''; }));   // columna nueva = vacío = valor por defecto
    s.getRange(1, 1, 1, HEAD_CFG.length).setValues([HEAD_CFG]).setFontWeight('bold');
    if (nuevas.length) s.getRange(2, 1, nuevas.length, HEAD_CFG.length).setValues(nuevas);
    s.setFrozenRows(1);
  }
  return s;
}
function hojaUsr_() {
  return hoja_(HOJA_USR, HEAD_USR, s => {
    s.getRange(2, 1, 500, 1).setNumberFormat('@');
    s.getRange(2, 3, 500, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(ROLES, true).build());
    s.getRange(2, 4, 500, 2).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Sí', 'No'], true).build());
  });
}

/* ---------- claves y sesiones ---------- */
function secreto_() {
  const p = PropertiesService.getScriptProperties();
  let s = p.getProperty('SECRETO');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); p.setProperty('SECRETO', s); }
  return s;
}
function hash_(sal, clave) {
  let h = sal + ':' + clave;
  for (let i = 0; i < ITERACIONES; i++) h = hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + sal));
  return h;
}
function firma_(texto) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(texto, secreto_())).replace(/=+$/, '');
}
function iguales_(a, b) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function crearToken_(u) {
  const exp = Date.now() + SESION_DIAS * 86400000;
  const carga = [u.usuario, exp, u.hash.slice(0, 10)].join('|');   // cambiar la clave invalida sesiones anteriores
  return {token: Utilities.base64EncodeWebSafe(carga).replace(/=+$/, '') + '.' + firma_(carga), exp};
}
function leerUsuarios_() {
  const s = hojaUsr_(), n = s.getLastRow();
  if (n < 2) return [];
  return s.getRange(2, 1, n - 1, HEAD_USR.length).getValues().map((r, i) => ({
    fila: i + 2, usuario: norm_(r[0]), nombre: String(r[1] || r[0]).trim(), rol: String(r[2] || 'Consulta').trim(),
    activo: si_(r[3]), cambiar: si_(r[4]), sal: String(r[5]), hash: String(r[6])})).filter(u => u.usuario);
}
function buscarUsuario_(usuario) { const k = norm_(usuario); return leerUsuarios_().filter(u => u.usuario === k)[0] || null; }
function validarToken_(token) {
  if (!token || String(token).indexOf('.') < 0) return null;
  const i = String(token).lastIndexOf('.'), b64 = token.slice(0, i), sig = token.slice(i + 1);
  let carga;
  try { carga = Utilities.newBlob(Utilities.base64DecodeWebSafe(b64)).getDataAsString(); } catch (e) { return null; }
  if (!iguales_(sig, firma_(carga))) return null;
  const p = carga.split('|');
  if (Number(p[1]) < Date.now()) return null;
  const u = buscarUsuario_(p[0]);
  if (!u || !u.activo || u.cambiar || u.hash.slice(0, 10) !== p[2]) return null;
  return u;
}
function sesion_(b) { const u = validarToken_(b.token); if (!u) throw {codigo: 'sesion', mensaje: 'Tu sesión venció. Ingresa de nuevo.'}; return u; }

/* ---------- control de intentos ---------- */
function fallos_(k) { return Number(CacheService.getScriptCache().get('f_' + k) || 0); }
function sumarFallo_(k) { CacheService.getScriptCache().put('f_' + k, String(fallos_(k) + 1), BLOQUEO_SEG); }
function limpiarFallos_(k) { CacheService.getScriptCache().remove('f_' + k); }
function verificarClave_(usuario, clave) {
  const k = norm_(usuario);
  if (fallos_(k) >= MAX_FALLOS) throw {mensaje: 'Demasiados intentos fallidos. Intenta de nuevo en 15 minutos.'};
  const u = buscarUsuario_(k);
  if (!u || !u.activo || !u.hash || !iguales_(hash_(u.sal, String(clave || '')), u.hash)) {
    sumarFallo_(k); Utilities.sleep(400);
    throw {mensaje: 'Usuario o clave incorrectos.'};
  }
  limpiarFallos_(k);
  return u;
}

/* ---------- configuración de capas por usuario ---------- */
function leerCapas_(usuario) {
  const s = hojaCfg_(), n = s.getLastRow(), k = norm_(usuario), out = Object.assign({}, CAPAS_DEFECTO);
  if (n < 2) return out;
  const v = s.getRange(2, 1, n - 1, HEAD_CFG.length).getValues();
  for (let i = 0; i < v.length; i++) if (norm_(v[i][0]) === k) {
    CAPAS.forEach((c, j) => { const x = v[i][j + 1]; if (x !== '' && x != null) out[c[0]] = si_(x); });
    break;
  }
  return out;
}
function guardarCapas_(usuario, capas) {
  const s = hojaCfg_(), n = s.getLastRow(), k = norm_(usuario);
  const fila = [usuario].concat(CAPAS.map(c => (c[0] in capas ? !!capas[c[0]] : CAPAS_DEFECTO[c[0]]) ? 'Sí' : 'No'), [new Date()]);
  let destino = n + 1;
  if (n >= 2) { const col = s.getRange(2, 1, n - 1, 1).getValues(); for (let i = 0; i < col.length; i++) if (norm_(col[i][0]) === k) { destino = i + 2; break; } }
  s.getRange(destino, 1, 1, HEAD_CFG.length).setValues([fila]);
}

/* ---------- acciones ---------- */
function accionLogin_(b) {
  const u = verificarClave_(b.usuario, b.clave);
  if (u.cambiar) return {ok: true, cambiar: true, usuario: u.usuario, nombre: u.nombre};
  const t = crearToken_(u);
  hojaUsr_().getRange(u.fila, 9).setValue(new Date());
  return {ok: true, token: t.token, exp: t.exp, usuario: u.usuario, nombre: u.nombre, rol: u.rol, prefs: leerCapas_(u.usuario)};
}
function accionCambiarClave_(b) {
  const u = verificarClave_(b.usuario, b.actual);
  const nueva = String(b.nueva || '');
  if (nueva.length < CLAVE_MIN) throw {mensaje: 'La clave nueva debe tener al menos ' + CLAVE_MIN + ' caracteres.'};
  if (nueva === String(b.actual)) throw {mensaje: 'La clave nueva debe ser distinta a la actual.'};
  const sal = Utilities.getUuid();
  const r = hojaUsr_().getRange(u.fila, 5, 1, 3);
  r.setValues([['No', sal, hash_(sal, nueva)]]);
  limpiarFallos_(u.usuario);
  return {ok: true};
}
function accionSync_(b) {
  const u = sesion_(b), s = hojaResp_(), n = s.getLastRow(), status = {};
  if (n >= 2) {
    const v = s.getRange(2, 1, n - 1, HEAD_RESP.length).getValues();
    v.forEach(r => {
      const code = String(r[3]).padStart(5, '0'), t = r[0] instanceof Date ? r[0].toISOString() : String(r[0]);
      if (!status[code] || status[code].t < t) status[code] = {r: r[10], n: r[12], u: r[19] || r[13], t};
    });
  }
  return {ok: true, usuario: u.usuario, nombre: u.nombre, rol: u.rol, status, prefs: leerCapas_(u.usuario)};
}
function accionPrefs_(b) {
  const u = sesion_(b);
  if (!b.prefs || typeof b.prefs !== 'object') throw {mensaje: 'Configuración inválida.'};
  guardarCapas_(u.usuario, b.prefs);
  return {ok: true};
}
function accionEnviar_(b) {
  const u = sesion_(b);
  if (u.rol === 'Consulta') throw {mensaje: 'Tu rol es de consulta: no puede registrar respuestas.'};
  const items = Array.isArray(b.items) ? b.items : [];
  const s = hojaResp_(), n = s.getLastRow();
  const vistos = {};
  if (n >= 2) s.getRange(2, 2, n - 1, 1).getValues().forEach(r => { vistos[String(r[0])] = 1; });
  const filas = [], aceptados = [];
  items.forEach(r => {
    if (!r || !r.id || !r.codigo) return;
    if (vistos[String(r.id)]) { aceptados.push(r.id); return; }                 // reenvío desde la cola sin conexión
    if (r.resultado !== 'Según lo planificado' && r.resultado !== 'Diferente') return;
    if (r.resultado === 'Diferente' && !String(r.nota || '').trim()) return;     // la nota es obligatoria
    filas.push([new Date(), r.id, r.ts ? new Date(r.ts) : '', String(r.codigo).padStart(5, '0'), r.nombre || '', r.frente || '',
      r.semana == null ? '' : r.semana, r.secuencia == null ? '' : r.secuencia, r.fecha_plan || '', r.fecha_real || '', r.resultado,
      r.aspectos || '', r.nota || '', u.usuario, r.lat == null ? '' : r.lat, r.lon == null ? '' : r.lon, r.prec == null ? '' : r.prec,
      r.mapeo || '', r.origen || '', u.nombre, u.rol]);
    vistos[String(r.id)] = 1; aceptados.push(r.id);
  });
  if (filas.length) s.getRange(s.getLastRow() + 1, 1, filas.length, HEAD_RESP.length).setValues(filas);
  return {ok: true, accepted: aceptados};
}

function doPost(e) {
  let b;
  try { b = JSON.parse((e.postData && e.postData.contents) || '{}'); } catch (x) { return json_({ok: false, error: 'Solicitud inválida'}); }
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    switch (b.action) {
      case 'login': return json_(accionLogin_(b));
      case 'cambiar_clave': return json_(accionCambiarClave_(b));
      case 'sync': return json_(accionSync_(b));
      case 'prefs_set': return json_(accionPrefs_(b));
      case 'submit': return json_(accionEnviar_(b));
      default: return json_({ok: false, error: 'Acción desconocida'});
    }
  } catch (err) {
    if (err && err.mensaje) return json_({ok: false, error: err.mensaje, code: err.codigo || ''});
    return json_({ok: false, error: 'Error del servidor: ' + String(err)});
  } finally { try { lock.releaseLock(); } catch (x) {} }
}

/** Comprobación de servicio. No devuelve datos ni usuarios. */
function doGet() { return json_({ok: true, servicio: 'Rutas por plantío', version: 2, requiere_login: true}); }

/* ---------- administración desde la hoja de cálculo ---------- */
function codigoTemporal_() {
  const d = (Utilities.getUuid() + Utilities.getUuid()).replace(/\D/g, '');
  return d.slice(0, 6).padStart(6, '0');
}
/** Crea el usuario o reinicia su clave. Devuelve el código temporal (el usuario debe cambiarlo al entrar). */
function crearUsuario_(usuario, nombre, rol) {
  const k = norm_(usuario);
  if (!/^[a-z0-9._-]{3,30}$/.test(k)) throw new Error('Usuario inválido: 3 a 30 caracteres (letras, números, punto, guion).');
  const r = ROLES.filter(x => x.toLowerCase() === String(rol || '').trim().toLowerCase())[0];
  if (rol && !r) throw new Error('Rol inválido. Usa: ' + ROLES.join(', '));
  const codigo = codigoTemporal_(), sal = Utilities.getUuid(), s = hojaUsr_(), u = buscarUsuario_(k);
  if (u) {
    s.getRange(u.fila, 1, 1, 7).setValues([[k, nombre || u.nombre, r || u.rol, 'Sí', 'Sí', sal, hash_(sal, codigo)]]);
    limpiarFallos_(k);
    return {codigo, nuevo: false};
  }
  s.getRange(s.getLastRow() + 1, 1, 1, 8).setValues([[k, nombre || k, r || 'Supervisor', 'Sí', 'Sí', sal, hash_(sal, codigo), new Date()]]);
  return {codigo, nuevo: true};
}
function inicializar() {
  hojaResp_(); hojaUsr_(); hojaCfg_();
  SpreadsheetApp.getUi().alert('Listo. Hojas creadas: Usuarios, Configuración y Respuestas.\nSiguiente paso: Rutas > Crear o reiniciar usuario.');
}
function menuCrearUsuario() {
  const ui = SpreadsheetApp.getUi();
  const pedir = (t, d) => { const r = ui.prompt(t, d || '', ui.ButtonSet.OK_CANCEL); return r.getSelectedButton() === ui.Button.OK ? r.getResponseText().trim() : null; };
  const usuario = pedir('Usuario (sin espacios, ej. jperez)'); if (!usuario) return;
  const nombre = pedir('Nombre completo (ej. Juan Pérez - Supervisor K4)\nDeja vacío para conservar el actual.');
  if (nombre === null) return;
  const rol = pedir('Rol: Administrador, Supervisor o Consulta\n(Consulta no puede registrar respuestas)', 'Supervisor');
  if (rol === null) return;
  try {
    const r = crearUsuario_(usuario, nombre, rol);
    ui.alert((r.nuevo ? 'Usuario creado' : 'Clave reiniciada') + ': ' + usuario.toLowerCase() +
      '\n\nCódigo temporal: ' + r.codigo + '\n\nEntrégaselo al usuario. Al ingresar por primera vez el visor le pedirá crear su propia clave.');
  } catch (e) { ui.alert('No se pudo: ' + e.message); }
}
function cerrarSesiones() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Cerrar todas las sesiones', 'Todos los usuarios deberán ingresar de nuevo. ¿Continuar?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  PropertiesService.getScriptProperties().deleteProperty('SECRETO');
  ui.alert('Sesiones cerradas.');
}
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Rutas')
    .addItem('1. Configuración inicial (crear hojas)', 'inicializar')
    .addItem('2. Crear o reiniciar usuario…', 'menuCrearUsuario')
    .addItem('3. Cerrar todas las sesiones', 'cerrarSesiones')
    .addToUi();
}
