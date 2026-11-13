/* Edición de los maestros dentro de la aplicación (solo con el permiso "maestros_admin", es decir, el Administrador).
 * La pantalla solo muestra u oculta controles: TODA validación y todo permiso se aplican en el servidor (Apps Script),
 * que vuelve a comprobar la sesión y el rol en cada acción, no admite duplicados, detecta si otra persona cambió la fila
 * y deja cada cambio en la hoja Auditoría. Los formularios de todos toman el cambio al instante (se invalida la caché). */
function initAdminMaestros() {
  const $ = id => document.getElementById(id), A = App, esc = A.esc;
  const puede = () => A.auth.puede('maestros_admin');
  let datos = null, tabla = 'zafras', cargando = false;
  const aviso = (t, bien) => { const el = $('mstMsg'); el.textContent = t || ''; el.dataset.ok = bien ? '1' : ''; };

  /** Llama al servidor. Devuelve la respuesta si ok; si no, muestra el motivo y devuelve null (y la tabla se actualiza si hubo un conflicto). */
  async function llamar(accion, d) {
    try {
      const j = await A.api(accion, d);
      if (j && j.ok) return j;
      if (j && j.code !== 'sesion') { aviso(j.error || 'No se pudo completar la acción.'); if (j.code === 'conflicto') cargar(); }
      return null;
    } catch { aviso('Sin conexión con el servidor.'); return null; }
  }
  function abrir() {
    if (!puede()) { UI.toast('No tienes permiso para editar los maestros.'); return; }
    aviso(''); $('mstQ').value = ''; $('mstDlg').showModal(); cargar();
  }
  $('cfgMst').onclick = e => { e.preventDefault(); $('cfgDlg').close(); abrir(); };
  $('mstClose').onclick = e => { e.preventDefault(); $('mstDlg').close(); };
  $('mstForm').onsubmit = e => e.preventDefault();      // Enter dentro de los campos no debe cerrar el diálogo

  // Al recargar la tabla (después de guardar, agregar o eliminar) NO se pierde lo que se escribió y aún no se guardó en otras filas.
  // Las filas se reconocen por su contenido original (no por su número), que cambia cuando se elimina una fila de arriba.
  function guardarBorradores() {
    const b = {nueva: null, filas: {}}, tn = document.querySelector('#mstT tr.mnew');
    if (tn) { const v = valores(tn); if (Object.values(v).some(x => x !== '')) b.nueva = v; }
    document.querySelectorAll('#mstT tr.sucia[data-f]').forEach(tr => { b.filas[tr.dataset.antes] = valores(tr); });
    return b;
  }
  function restaurarBorradores(b, soltar) {
    if (!b) return;
    if (b.nueva && soltar !== 'nueva') { const tn = document.querySelector('#mstT tr.mnew'); if (tn) Object.entries(b.nueva).forEach(([k, v]) => { const i = tn.querySelector(`[data-k="${k}"]`); if (i) i.value = v; }); }
    document.querySelectorAll('#mstT tr[data-f]').forEach(tr => {
      const v = b.filas[tr.dataset.antes]; if (!v || tr.dataset.antes === soltar) return;
      Object.entries(v).forEach(([k, x]) => { const i = tr.querySelector(`[data-k="${k}"]`); if (i) i.value = x; });
      tr.querySelector('.mgu').disabled = false; tr.classList.add('sucia');
    });
  }
  async function cargar(soltar) {   // soltar: 'nueva' o el contenido original de la fila recién guardada (sus cambios ya están en el servidor)
    if (cargando) return; cargando = true;
    const sc = $('mstDlg').querySelector('.mstwrap'), y = sc ? sc.scrollTop : 0, borr = datos ? guardarBorradores() : null;
    const j = await llamar('mae_listar', {});
    cargando = false; if (!j) return;
    datos = j; if (!datos.tablas[tabla]) tabla = datos.orden[0];
    pintarTabs(); pintar(); restaurarBorradores(borr, soltar); if (sc) sc.scrollTop = y;
  }
  function pintarTabs() {
    $('mstTabs').innerHTML = datos.orden.map(k => { const t = datos.tablas[k], aten = k === 'ats_admin' && datos.faltanAts.length;
      return `<button type="button" role="tab" data-t="${k}" class="${k === tabla ? 'on' : ''}" aria-selected="${k === tabla}">${esc(t.titulo)} <small>${t.ok ? t.filas.length : '!'}</small>${aten ? '<span class="mw" title="Faltan fichas">⚠</span>' : ''}</button>`; }).join('');
  }
  // un control por tipo de dato (el servidor vuelve a validar todo)
  function control(c, v, id) {
    const val = v === null || v === undefined ? '' : String(v), n = `data-k="${c.k}" aria-label="${esc(c.t)}"`;
    if (c.tipo === 'lista') return `<select ${n}${id ? ' id="' + id + '"' : ''}>${val === '' ? '<option value="">—</option>' : ''}${c.valores.map(x => `<option${x === val ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>`;
    if (c.tipo === 'fecha') return `<input type="date" ${n} value="${esc(val)}"${id ? ' id="' + id + '"' : ''}>`;
    const inm = (c.tipo === 'entero' || c.tipo === 'idtxt') ? ' inputmode="numeric"' : '', up = c.tipo === 'codigo' ? ' style="text-transform:uppercase"' : '', ph = c.tipo === 'zafra' ? ' placeholder="2026-2027"' : '';
    return `<input type="text" ${n} value="${esc(val)}" maxlength="${c.tipo === 'texto' ? 60 : 12}"${inm}${up}${ph}${id ? ' id="' + id + '"' : ''}>`;
  }
  function pintar() {
    const t = datos.tablas[tabla], q = $('mstQ').value.trim().toLowerCase();
    $('mstNota').textContent = t.nota || '';
    const falta = datos.faltanAts.length, mostrarAts = (tabla === 'administradores' || tabla === 'ats_admin') && falta > 0;
    $('mstAts').hidden = !mostrarAts; $('mstAts').textContent = `Completar el ATS (${falta} ficha${falta === 1 ? '' : 's'} faltan)`;
    $('mstAts').title = mostrarAts ? 'Faltan en la hoja del ATS: ' + datos.faltanAts.map(x => x.id + ' ' + x.texto).join(', ') : '';
    if (!t.ok) { $('mstH').innerHTML = ''; $('mstT').innerHTML = `<tr><td style="color:var(--amber);padding:10px">${esc(t.error || 'Esta tabla no está disponible.')}</td></tr>`; $('mstCnt').textContent = ''; return; }
    $('mstH').innerHTML = `<tr>${t.cols.map(c => `<th>${esc(c.t)}${c.opc ? ' <span class="admsub" style="margin:0">(opcional)</span>' : ''}</th>`).join('')}<th>Fila</th><th></th></tr>`;
    const filas = t.filas.filter(r => !q || r.v.join(' ').toLowerCase().includes(q));
    $('mstCnt').textContent = `${filas.length} de ${t.filas.length}`;
    const nueva = `<tr class="mnew" data-nueva="1">${t.cols.map(c => `<td>${control(c, '')}</td>`).join('')}<td class="admsub">nueva</td><td><button type="button" class="mag primary">Agregar</button></td></tr>`;
    $('mstT').innerHTML = nueva + filas.map(r => `<tr data-f="${r.fila}" data-antes="${esc(JSON.stringify(r.v))}">${t.cols.map((c, i) => `<td>${control(c, r.v[i])}</td>`).join('')}<td class="admsub">${r.fila}</td><td style="white-space:nowrap"><button type="button" class="mgu" disabled>Guardar</button> <button type="button" class="mel">Eliminar</button></td></tr>`).join('');
  }
  const valores = tr => Object.fromEntries([...tr.querySelectorAll('[data-k]')].map(i => [i.dataset.k, i.value]));
  $('mstTabs').onclick = e => { const b = e.target.closest('button[data-t]'); if (!b) return; tabla = b.dataset.t; aviso(''); $('mstQ').value = ''; pintarTabs(); pintar(); };   // (los borradores sin guardar de la otra tabla se descartan al cambiar de pestaña)
  $('mstQ').oninput = () => { if (datos) pintar(); };
  $('mstT').addEventListener('input', e => { const tr = e.target.closest('tr[data-f]'); if (!tr) return; const b = tr.querySelector('.mgu'); b.disabled = false; tr.classList.add('sucia'); });
  $('mstT').addEventListener('keydown', e => { if (e.key !== 'Enter' || !e.target.matches('[data-k]')) return; e.preventDefault(); const tr = e.target.closest('tr'); const b = tr.querySelector('.mag, .mgu:not([disabled])'); if (b) b.click(); });
  $('mstT').addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return; const tr = b.closest('tr'), t = datos.tablas[tabla];
    if (b.classList.contains('mag')) {                                   // agregar
      b.disabled = true; aviso(''); const j = await llamar('mae_guardar', {tabla, valores: valores(tr)}); b.disabled = false;
      if (j) { UI.toast(`${t.titulo}: agregado`); aviso('Agregado ✓ Los formularios ya lo ven.', true); await cargar('nueva'); }
    } else if (b.classList.contains('mgu')) {                            // guardar cambios de una fila
      b.disabled = true; aviso(''); const j = await llamar('mae_guardar', {tabla, fila: +tr.dataset.f, antes: JSON.parse(tr.dataset.antes), valores: valores(tr)});
      if (j) { UI.toast(`${t.titulo}: guardado`); aviso('Guardado ✓ Los formularios ya lo ven.', true); await cargar(tr.dataset.antes); } else b.disabled = false;
    } else if (b.classList.contains('mel')) {                            // eliminar
      const antes = JSON.parse(tr.dataset.antes), nom = antes.filter(x => x !== '').join(' · ');
      if (!confirm(`¿Eliminar "${nom}" de ${t.titulo}?\n\nLos registros ya guardados conservan su valor, pero esta opción dejará de aparecer para elegirla en los formularios.${tabla === 'ats_admin' ? '\n\nLos registros ATS ya guardados de esa ficha mostrarán #N/A en su columna Administrador.' : ''}`)) return;
      aviso(''); const j = await llamar('mae_eliminar', {tabla, fila: +tr.dataset.f, antes}); if (j) { UI.toast(`${t.titulo}: eliminado`); aviso('Eliminado ✓', true); await cargar(tr.dataset.antes); }
    }
  });
  $('mstAts').onclick = async e => {
    e.preventDefault(); const n = datos.faltanAts.length;
    if (!confirm(`Se agregarán a la hoja "Administrador" del ATS ${n} ficha(s) que están en Administradores y aún no están ahí:\n\n${datos.faltanAts.map(x => x.id + ' ' + x.texto).join('\n')}`)) return;
    const j = await llamar('mae_sync_ats', {}); if (j) { UI.toast(`ATS: ${j.agregadas} ficha(s) agregada(s)`); aviso(`Listo: ${j.agregadas} ficha(s) agregada(s) al ATS ✓`, true); await cargar(); }
  };
}
