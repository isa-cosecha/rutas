/* Edición de los maestros dentro de la aplicación (solo con el permiso "maestros_admin", es decir, el Administrador).
 * La pantalla solo muestra u oculta controles: TODA validación y todo permiso se aplican en el servidor (Apps Script),
 * que vuelve a comprobar la sesión y el rol en cada acción, no admite duplicados, detecta si otra persona cambió la fila
 * y deja cada cambio en la hoja Auditoría. Los formularios de todos toman el cambio al instante (se invalida la caché). */
function initAdminMaestros() {
  const $ = id => document.getElementById(id), A = App, esc = A.esc;
  const puede = () => A.auth.puede('maestros_admin');
  let datos = null, tabla = 'zafras', cargando = false, corriendo = false, ultErr = '';
  const aviso = (t, bien) => { const el = $('mstMsg'); el.textContent = t || ''; el.dataset.ok = bien ? '1' : ''; };

  /** Llama al servidor. Devuelve la respuesta si ok; si no, muestra el motivo y devuelve null (y la tabla se actualiza si hubo un conflicto). */
  async function llamar(accion, d) {
    try {
      const j = await A.api(accion, d);
      if (j && j.ok) return j;
      if (j && j.code !== 'sesion') { ultErr = j.error || 'No se pudo completar la acción.'; aviso(ultErr); if (j.code === 'conflicto' && !corriendo) cargar(); }
      else ultErr = 'La sesión caducó: vuelve a entrar.';
      return null;
    } catch { ultErr = 'Sin conexión con el servidor.'; aviso(ultErr); return null; }
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
    const sol = Array.isArray(soltar) ? soltar : [soltar];
    if (b.nueva && !sol.includes('nueva')) { const tn = document.querySelector('#mstT tr.mnew'); if (tn) Object.entries(b.nueva).forEach(([k, v]) => { const i = tn.querySelector(`[data-k="${k}"]`); if (i) i.value = v; }); }
    document.querySelectorAll('#mstT tr[data-f]').forEach(tr => {
      const v = b.filas[tr.dataset.antes]; if (!v || sol.includes(tr.dataset.antes)) return;
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
    pintarTabs(); pintar(); restaurarBorradores(borr, soltar); actualizarTodo(); if (sc) sc.scrollTop = y;
  }
  const inactiva = (t, r) => { const i = t.cols.findIndex(c => c.k === 'activo'); return i >= 0 && ['no', 'inactivo', 'inactiva', 'false', '0'].includes(String(r.v[i] == null ? '' : r.v[i]).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')); };
  const avisoAts = j => !j.ats ? '' : j.ats.error ? ` PERO la hoja Administrador del ATS NO se pudo actualizar: ${j.ats.error}` : (j.ats.agregadas || j.ats.actualizadas) ? ' La hoja del ATS se actualizó sola.' : '';
  const nInact = t => t.ok ? t.filas.filter(r => inactiva(t, r)).length : 0;
  function pintarTabs() {
    $('mstTabs').innerHTML = datos.orden.map(k => { const t = datos.tablas[k];
      const tr = datos.traer || {equipos: [], supervisores: []}, falta = k === 'equipos' && tr.equipos.length, faltaP = k === 'administradores' && (datos.sinPuesto || (datos.faltanMaestro || []).length || tr.supervisores.length);
      return `<button type="button" role="tab" data-t="${k}" class="${k === tabla ? 'on' : ''}" aria-selected="${k === tabla}">${esc(t.titulo)} <small>${t.ok ? t.filas.length : '!'}${nInact(t) ? ' · ' + nInact(t) + ' inact.' : ''}</small>${falta ? '<span class="mw" title="Hay camionetas en las hojas que aún no están aquí">⚠</span>' : ''}${faltaP ? '<span class="mw" title="Faltan puestos, fichas o supervisores por agregar">⚠</span>' : ''}</button>`; }).join('');
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
    let notaTxt = t.nota || '';
    if (tabla === 'administradores') {   // lo que falta completar en el personal: puesto, fichas que sólo están en el ATS y supervisores de las hojas de camionetas
      const x = [], fm = datos.faltanMaestro || [], sp = (datos.traer && datos.traer.supervisores) || [];
      if (datos.sinPuesto) x.push(`${datos.sinPuesto} persona(s) sin puesto (mientras tanto cuentan como Administrador de frente).`);
      if (fm.length) x.push('Están en la hoja del ATS pero no aquí: ' + fm.map(p => p.id + ' ' + p.texto).join(', ') + '. Agrégalas con su puesto.');
      if (sp.length) x.push('Aparecen como supervisores en las hojas de camionetas (zafra ' + datos.traer.zafra + ') pero no están aquí con puesto Supervisor: ' + sp.join(', ') + '.');
      notaTxt = [notaTxt].concat(x).join(' ');
    }
    $('mstNota').textContent = notaTxt;
    const tr = datos.traer || {equipos: [], supervisores: []}, mostrarTr = tabla === 'equipos' && tr.equipos.length > 0;
    $('mstTraer').hidden = !mostrarTr; $('mstTraer').textContent = `Traer de las hojas de camionetas (${tr.equipos.length} camioneta${tr.equipos.length === 1 ? '' : 's'})`;
    $('mstTraer').title = mostrarTr ? `De la zafra ${tr.zafra}: ${tr.equipos.join(', ')}` : '';
    if (!t.ok) { $('mstH').innerHTML = ''; $('mstT').innerHTML = `<tr><td style="color:var(--amber);padding:10px">${esc(t.error || 'Esta tabla no está disponible.')}</td></tr>`; $('mstCnt').textContent = ''; return; }
    $('mstH').innerHTML = `<tr>${t.cols.map(c => `<th>${esc(c.t)}${c.opc ? ' <span class="admsub" style="margin:0">(opcional)</span>' : ''}</th>`).join('')}<th>Fila</th><th></th></tr>`;
    const tieneAct = t.cols.some(c => c.k === 'activo'), ocIn = tieneAct && $('mstOcIn').checked; $('mstOcInL').hidden = !tieneAct;
    const filas = t.filas.filter(r => (!q || r.v.join(' ').toLowerCase().includes(q)) && !(ocIn && inactiva(t, r)));
    $('mstCnt').textContent = `${filas.length} de ${t.filas.length}${nInact(t) ? ' · ' + nInact(t) + ' inactivo' + (nInact(t) === 1 ? '' : 's') : ''}`;
    const nueva = `<tr class="mnew" data-nueva="1">${t.cols.map(c => `<td>${control(c, '')}</td>`).join('')}<td class="admsub">nueva</td><td><button type="button" class="mag primary">Agregar</button></td></tr>`;
    $('mstT').innerHTML = nueva + filas.map(r => `<tr class="${inactiva(t, r) ? 'inact' : ''}" data-f="${r.fila}" data-antes="${esc(JSON.stringify(r.v))}">${t.cols.map((c, i) => `<td>${control(c, r.v[i])}</td>`).join('')}<td class="admsub">${r.fila}</td><td style="white-space:nowrap"><button type="button" class="mgu" disabled>Guardar</button> <button type="button" class="mel">Eliminar</button></td></tr>`).join('');
  }
  const valores = tr => Object.fromEntries([...tr.querySelectorAll('[data-k]')].map(i => [i.dataset.k, i.value]));
  $('mstTabs').onclick = e => { const b = e.target.closest('button[data-t]'); if (!b) return; tabla = b.dataset.t; aviso(''); $('mstQ').value = ''; pintarTabs(); pintar(); };   // (los borradores sin guardar de la otra tabla se descartan al cambiar de pestaña)
  $('mstQ').oninput = () => { if (datos) pintar(); };
  $('mstOcIn').onchange = () => { if (datos) pintar(); };
  $('mstT').addEventListener('input', e => { const tr = e.target.closest('tr[data-f]'); if (!tr || tr.classList.contains('guardando')) return; const b = tr.querySelector('.mgu'); b.disabled = false; tr.classList.add('sucia'); actualizarTodo(); });
  const actualizarTodo = () => { const n = document.querySelectorAll('#mstT tr.sucia[data-f]:not(.guardando)').length; $('mstTodo').hidden = n < 2; $('mstTodo').textContent = `Guardar todo (${n})`; };
  $('mstT').addEventListener('keydown', e => { if (e.key !== 'Enter' || !e.target.matches('[data-k]')) return; e.preventDefault(); const tr = e.target.closest('tr'); const b = tr.querySelector('.mag, .mgu:not([disabled])'); if (b) b.click(); });
  /* COLA DE GUARDADOS. Cada clic en Guardar / Agregar / Eliminar entra en una cola que se atiende de uno en uno, en el orden de los clics
   * (el servidor de Google atiende una petición a la vez y cada una espera su turno como máximo 20 s: con muchas a la vez, las últimas se perdían).
   * La tabla se vuelve a leer UNA sola vez, cuando la cola se vacía; lo escrito y no guardado en otras filas se conserva. */
  const ops = []; let res = {ok: 0, mal: 0, soltar: [], ats: null, atsOk: false, errs: [], tipos: [], titulo: ''};
  function encolar(op) {
    op.tr.classList.add('guardando'); op.tr.querySelectorAll('button, input, select').forEach(x => { x.disabled = true; });
    ops.push(op); aviso(`Guardando… ${ops.length} en cola`, true); actualizarTodo(); if (!corriendo) correr();
  }
  async function correr() {
    corriendo = true;
    while (ops.length) {
      const op = ops.shift(); aviso(`Guardando… (${res.ok + res.mal + 1} de ${res.ok + res.mal + 1 + ops.length})`, true);
      const j = await llamar(op.accion, op.datos());
      if (j) {
        res.ok++; res.soltar.push(op.soltar); res.tipos.push(op.tipo); res.titulo = op.titulo;
        if (j.ats) { if (j.ats.error) res.ats = j.ats.error; else if (j.ats.agregadas || j.ats.actualizadas) res.atsOk = true; }
        if (op.accion === 'mae_eliminar') ops.forEach(o => { if (o.fila > op.fila) o.fila--; });   // al eliminar una fila, las de abajo suben una
      } else { res.mal++; res.errs.push(ultErr); }
    }
    const r = res; res = {ok: 0, mal: 0, soltar: [], ats: null, atsOk: false, errs: [], tipos: [], titulo: ''}; corriendo = false;
    await cargar(r.soltar);   // una sola recarga cuando la cola queda vacía
    const nota = r.ats ? ` PERO la hoja Administrador del ATS NO se pudo actualizar: ${r.ats}` : r.atsOk ? ' La hoja del ATS se actualizó sola.' : '';
    if (r.ok === 1 && !r.mal) { const tp = r.tipos[0]; UI.toast(`${r.titulo}: ${tp === 'agregar' ? 'agregado' : tp === 'eliminar' ? 'eliminado' : 'guardado'}`); aviso((tp === 'agregar' ? 'Agregado ✓ Los formularios ya lo ven.' : tp === 'eliminar' ? 'Eliminado ✓' : 'Guardado ✓ Los formularios ya lo ven.') + nota, !r.ats); }
    else if (r.ok && !r.mal) { UI.toast(`${r.titulo}: ${r.ok} cambios guardados`); aviso(`Guardados ${r.ok} cambios ✓ Los formularios ya lo ven.` + nota, !r.ats); }
    else if (r.ok) aviso(`Guardados ${r.ok} ✓ pero ${r.mal} con error: ${r.errs[0]} (las filas con error siguen marcadas para que las reintentes).` + nota, false);
    else aviso(`No se guardó (${r.mal}): ${r.errs[0] || 'error desconocido'}`, false);
  }
  const opGuardar = (tr, t) => { const vals = valores(tr), antes = JSON.parse(tr.dataset.antes), tb = tabla; return {accion: 'mae_guardar', tipo: 'guardar', tr, titulo: t.titulo, soltar: tr.dataset.antes, fila: +tr.dataset.f, datos() { return {tabla: tb, fila: this.fila, antes, valores: vals}; }}; };
  $('mstT').addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return; const tr = b.closest('tr'), t = datos.tablas[tabla], tb = tabla;
    if (b.classList.contains('mag')) {                                   // agregar
      const vals = valores(tr); aviso('');
      encolar({accion: 'mae_guardar', tipo: 'agregar', tr, titulo: t.titulo, soltar: 'nueva', fila: 0, datos() { return {tabla: tb, valores: vals}; }});
    } else if (b.classList.contains('mgu')) {                            // guardar cambios de una fila
      aviso(''); encolar(opGuardar(tr, t));
    } else if (b.classList.contains('mel')) {                            // eliminar
      const antes = JSON.parse(tr.dataset.antes), nom = antes.filter(x => x !== '').join(' · ');
      if (!confirm(`¿Eliminar \"${nom}\" de ${t.titulo}?\n\nLos registros ya guardados conservan su valor, pero esta opción dejará de aparecer para elegirla en los formularios.${tabla === 'administradores' ? '\n\nSu ficha se queda en la hoja del ATS para que los registros viejos conserven el nombre. Si solo quieres que deje de aparecer en los formularios, mejor márcala Activo = No.' : ''}`)) return;
      aviso(''); encolar({accion: 'mae_eliminar', tipo: 'eliminar', tr, titulo: t.titulo, soltar: tr.dataset.antes, fila: +tr.dataset.f, datos() { return {tabla: tb, fila: this.fila, antes}; }});
    }
  });
  $('mstTodo').onclick = e => {   // guarda de una vez todas las filas con cambios, en el orden en que aparecen
    e.preventDefault(); const t = datos.tablas[tabla]; aviso('');
    document.querySelectorAll('#mstT tr.sucia[data-f]:not(.guardando)').forEach(tr => encolar(opGuardar(tr, t)));
  };

  $('mstTraer').onclick = async e => {   // trae de las hojas de camionetas (zafra más reciente) las camionetas que aún no están en Equipos
    e.preventDefault(); const tr = datos.traer;
    if (!confirm(`De las hojas de camionetas (zafra ${tr.zafra}) se agregarán a Equipos, con categoría Camionetas:\n\n${tr.equipos.join(', ')}\n\nDespués puedes corregir o quitar lo que no corresponda.\n(Los supervisores se agregan en Personal, porque necesitan ficha.)`)) return;
    const j = await llamar('mae_traer', {}); if (j) { UI.toast(`Se agregaron ${j.equipos} camioneta(s)`); aviso(`Listo: ${j.equipos} camioneta(s) agregadas ✓`, true); await cargar(); }
  };
}
