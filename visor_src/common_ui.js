/* Toast y diálogo de configuración, comunes a web y móvil. Requiere #toast y #cfgDlg en el HTML. */
let UI;
function initUI() {
UI = (() => {
  const $ = id => document.getElementById(id);
  let tt;
  const toast = m => { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 3800); };
  App.on('toast', toast);
  const dlg = $('cfgDlg');
  function openCfg(msg) {
    $('cfgMsg').textContent = msg || ''; $('cfgUser').value = App.cfg.user || ''; $('cfgData').value = App.cfg.data || ''; $('cfgGh').value = App.cfg.gh || '';
    const m = App.META; $('cfgVer').textContent = m.version ? `Datos versión ${m.version}, generados ${String(m.generado || '').slice(0, 16).replace('T', ' ')} UTC${m.origen ? ' · ' + m.origen : ''}${m.fuentes ? ' · Programa: ' + m.fuentes.programa : ''}` : ''; $('cfgUrl').value = App.cfg.url || ''; $('cfgTok').value = App.cfg.token || '';
    $('cfgQ').textContent = App.queueLen ? `${App.queueLen} respuesta(s) pendiente(s) de envío.` : 'Sin respuestas pendientes.';
    dlg.showModal(); setTimeout(() => (App.cfg.user ? $('cfgUrl') : $('cfgUser')).focus(), 50);
  }
  $('cfgSave').onclick = e => { e.preventDefault();
    const url = $('cfgUrl').value.trim();
    if (url && !/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) { $('cfgMsg').textContent = 'La URL debe ser la del Web App de Apps Script (https://script.google.com/macros/s/…/exec).'; return; }
    const data = $('cfgData').value.trim(), gh = $('cfgGh').value.trim(), cambioDatos = data !== (App.cfg.data || '') || gh !== (App.cfg.gh || '');
    App.saveCfg({user: $('cfgUser').value.trim(), url, token: $('cfgTok').value.trim(), data, gh}); dlg.close(); toast('Configuración guardada');
    if (cambioDatos) { location.reload(); return; }
    if (App.cur) App.select(App.cur.id, {fit: false}); };
  $('cfgCancel').onclick = e => { e.preventDefault(); dlg.close(); };
  $('cfgSync').onclick = e => { e.preventDefault(); App.flush(); App.refreshStatus(); toast('Sincronizando…'); };
  App.on('needConfig', openCfg);
  $('cfgReload').onclick = e => { e.preventDefault(); try { sessionStorage.setItem('rp26_force', '1'); } catch {} location.reload(); };
  return {toast, openCfg};
})();
}
