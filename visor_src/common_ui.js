/* Toast, ingreso de usuarios y diálogo de cuenta, comunes a web y móvil. */
let UI;
function initUI() {
UI = (() => {
  const $ = id => document.getElementById(id);
  let tt;
  const toast = m => { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 4200); };
  App.on('toast', toast);
  const A = App, auth = A.auth;

  // ---------- ingreso ----------
  const box = $('login'), msg = t => { $('lgMsg').textContent = t || ''; };
  let waiters = [], mustChange = null;
  function showLogin(m) {
    mustChange = null; $('lgIn').hidden = false; $('lgNew').hidden = true; $('lgGo').textContent = 'Entrar'; $('lgPass').value = '';
    $('lgUrlBox').hidden = !!A.cfg.url; $('lgUrl').value = A.cfg.url || '';
    msg(m); box.hidden = false; document.querySelectorAll('dialog[open]').forEach(d => d.close());
    setTimeout(() => ($('lgUser').value ? $('lgPass') : $('lgUser')).focus(), 60);
  }
  function hideLogin() { box.hidden = true; const w = waiters; waiters = []; w.forEach(f => f()); }
  $('lgForm').onsubmit = async e => {
    e.preventDefault(); const go = $('lgGo'); go.disabled = true; msg('');
    try {
      if (!A.cfg.url) {
        const u = $('lgUrl').value.trim();
        if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(u)) { msg('Pega la URL del Web App de Apps Script (https://script.google.com/macros/s/…/exec).'); return; }
        A.saveCfg({url: u});
      }
      if (mustChange) {
        const n1 = $('lgN1').value, n2 = $('lgN2').value;
        if (n1.length < 6) { msg('La clave nueva debe tener al menos 6 caracteres.'); return; }
        if (n1 !== n2) { msg('Las claves nuevas no coinciden.'); return; }
        const r = await auth.changePassword(mustChange.user, mustChange.clave, n1);
        if (!r.ok) { msg(r.error || 'No se pudo cambiar la clave.'); return; }
        const l = await auth.login(mustChange.user, n1);
        if (!l.ok) { msg(l.error || 'Clave cambiada. Ingresa con tu clave nueva.'); showLogin('Clave cambiada. Ingresa con tu clave nueva.'); return; }
        mustChange = null; $('lgN1').value = $('lgN2').value = ''; hideLogin(); return;
      }
      const user = $('lgUser').value.trim(), clave = $('lgPass').value;
      const r = await auth.login(user, clave);
      if (!r.ok) { msg(r.error || 'No se pudo ingresar.'); return; }
      if (r.cambiar) { mustChange = {user, clave}; $('lgIn').hidden = true; $('lgNew').hidden = false; $('lgGo').textContent = 'Guardar clave y entrar'; $('lgN1').focus(); return; }
      hideLogin();
    } catch (err) { msg('Sin conexión con el servidor de usuarios. El primer ingreso requiere internet.'); }
    finally { go.disabled = false; }
  };
  const ensureLogin = () => new Promise(res => { if (auth.logged()) return res(); waiters.push(res); showLogin(); });
  A.on('logout', m => showLogin(m || ''));
  A.on('needLogin', () => showLogin('Ingresa para registrar respuestas.'));

  // ---------- cuenta ----------
  const dlg = $('cfgDlg');
  // ---- números de hectáreas: tamaño y color personales ----
  const COLORES = ['#ffffff', '#ffe14d', '#ffb454', '#7dd3fc', '#86efac', '#f9a8d4', '#111111'];
  function pintarEtq() {
    const p = A.etqPref, movil = document.documentElement.dataset.ui === 'movil';
    $('etqTam').value = p.etqTam; $('etqTamV').textContent = p.etqTam + ' %'; $('etqCol').value = p.etqColor;
    $('etqSw').innerHTML = COLORES.map(c => `<button type="button" class="sw${c === p.etqColor ? ' on' : ''}" data-c="${c}" style="background:${c}" aria-label="Color ${c}"></button>`).join('');
    $('etqPrevN').style.cssText = `font-size:${((movil ? 8.5 : 9.5) * p.etqTam / 100).toFixed(1)}px;color:${p.etqColor}`;   // así se ve de cerca (zoom 17 o más)
  }
  $('etqTam').oninput = e => { A.setEtq({etqTam: +e.target.value}); pintarEtq(); };
  $('etqSw').onclick = e => { const b = e.target.closest('button.sw'); if (!b) return; e.preventDefault(); A.setEtq({etqColor: b.dataset.c}); pintarEtq(); };
  $('etqCol').oninput = e => { A.setEtq({etqColor: e.target.value}); pintarEtq(); };
  $('etqRst').onclick = e => { e.preventDefault(); A.setEtq({etqTam: 100, etqColor: '#ffffff'}); pintarEtq(); };
  function openCfg(m) {
    const s = auth.sess;
    $('cfgMsg').textContent = m || '';
    $('cfgWho').innerHTML = s ? `Usuario: <b>${A.esc(s.nombre)}</b> (${A.esc(s.user)}) · Rol: <b>${A.esc(s.rol)}</b>` : 'Sin sesión';
    $('cfgAdm').hidden = !A.auth.puede('capas_admin'); $('cfgUsr').hidden = !A.auth.puede('usuarios_admin'); $('cfgMst').hidden = !A.auth.puede('maestros_admin');
    pintarEtq();
    // Las conexiones (URL de Apps Script, URL de datos en GitHub y token) sólo las ve y edita el Administrador de la plataforma.
    // Para los demás ni se muestran ni se cargan en los campos.
    const adm = A.auth.puede('usuarios_admin');
    $('cfgAvz').hidden = !adm; $('cfgAvz').open = false; $('cfgSave').hidden = !adm;
    if (adm) { $('cfgData').value = A.cfg.data || ''; $('cfgGh').value = A.cfg.gh || ''; $('cfgUrl').value = A.cfg.url || ''; }
    else { $('cfgData').value = $('cfgGh').value = $('cfgUrl').value = ''; }
    const pg = A.programa; $('cfgProg').textContent = pg.zafra ? `Programa de corte: ${pg.zafra}${pg.borrador ? ' · ' + pg.borrador : ''} · ${pg.total} plantíos · ${pg.origen === 'google' ? 'leído de Google Sheets' : 'última lectura guardada'}${pg.sinMapa.length ? ' · ' + pg.sinMapa.length + ' sin polígono en el mapa' : ''}${pg.fuera ? ' · ' + pg.fuera + ' del mapa ya no están en el programa' : ''}` : 'Programa de corte: el del repositorio (aún no se lee de Google Sheets).';
    const x = A.META; $('cfgVer').textContent = x.version ? `Datos versión ${x.version}, generados ${String(x.generado || '').slice(0, 16).replace('T', ' ')} UTC${x.origen ? ' · ' + x.origen : ''}${x.fuentes ? ' · Programa: ' + x.fuentes.programa : ''}${x.capas ? ' · Capas de apoyo ' + x.capas.version : ''}` : '';
    $('cfgQ').textContent = A.queueLen ? `${A.queueLen} respuesta(s) pendiente(s) de envío.` : 'Sin respuestas pendientes.';
    dlg.showModal();
  }
  dlg.addEventListener('close', () => { $('cfgData').value = $('cfgGh').value = $('cfgUrl').value = ''; });   // al cerrar no quedan datos de conexión en la pantalla
  $('cfgSave').onclick = e => { e.preventDefault();
    if (!A.auth.puede('usuarios_admin')) { dlg.close(); return; }   // defensa: nadie más guarda conexiones
    const url = $('cfgUrl').value.trim();
    if (url && !/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) { $('cfgMsg').textContent = 'La URL debe ser la del Web App de Apps Script (https://script.google.com/macros/s/…/exec).'; return; }
    const data = $('cfgData').value.trim(), gh = $('cfgGh').value.trim(), cambio = data !== (A.cfg.data || '') || gh !== (A.cfg.gh || '');
    A.saveCfg({url, data, gh}); dlg.close(); toast('Configuración guardada');
    if (cambio) location.reload(); };
  $('cfgCancel').onclick = e => { e.preventDefault(); dlg.close(); };
  $('cfgSync').onclick = e => { e.preventDefault(); A.flush(); A.refreshStatus(); toast('Sincronizando…'); };
  $('cfgReload').onclick = e => { e.preventDefault(); try { sessionStorage.setItem('rp26_force', '1'); } catch {} location.reload(); };
  $('cfgOut').onclick = e => { e.preventDefault(); dlg.close(); auth.logout(); };
  $('cfgPw').onclick = e => { e.preventDefault(); dlg.close(); $('pwMsg').textContent = ''; $('pwOld').value = $('pwN1').value = $('pwN2').value = ''; $('pwDlg').showModal(); };
  $('pwCancel').onclick = e => { e.preventDefault(); $('pwDlg').close(); };
  $('pwOk').onclick = async e => { e.preventDefault();
    const o = $('pwOld').value, n1 = $('pwN1').value, n2 = $('pwN2').value, m = t => { $('pwMsg').textContent = t; };
    if (n1.length < 6) return m('La clave nueva debe tener al menos 6 caracteres.');
    if (n1 !== n2) return m('Las claves nuevas no coinciden.');
    try {
      const r = await auth.changePassword(auth.sess.user, o, n1);
      if (!r.ok) return m(r.error || 'No se pudo cambiar la clave.');
      const l = await auth.login(auth.sess.user, n1);
      $('pwDlg').close(); toast(l.ok ? 'Clave cambiada' : 'Clave cambiada. Ingresa de nuevo.');
    } catch { m('Sin conexión con el servidor.'); } };
  if (typeof initAdmin === 'function') initAdmin();   // herramientas de administrador (admin_capas.js)
  if (typeof initAdminMaestros === 'function') initAdminMaestros();   // edición de maestros (admin_maestros.js)
  if (typeof initAdminUsuarios === 'function') initAdminUsuarios();   // administración de usuarios (admin_usuarios.js)
  if (typeof initForms === 'function') initForms();   // formularios de campo como módulo (forms.js)
  return {toast, openCfg, ensureLogin};
})();
}
