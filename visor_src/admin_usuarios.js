/* Administración de usuarios, roles y claves dentro de la aplicación (solo con el permiso "usuarios_admin").
 * La pantalla solo muestra u oculta controles: TODA validación y todo permiso se aplican en el servidor (Apps Script),
 * que vuelve a comprobar la sesión y el rol en cada acción. Las claves nunca llegan al navegador; al crear o
 * restablecer, el servidor devuelve un código temporal de un solo uso (el usuario debe cambiarlo al entrar). */
function initAdminUsuarios() {
  const $ = id => document.getElementById(id), A = App, esc = A.esc;
  const puede = () => A.auth.puede('usuarios_admin');
  let lista = [], roles = ['Administrador', 'Supervisor', 'Administrador de frente', 'Consulta'], permisos = {}, etiquetas = {}, forms = [], yo = '', cargando = false;
  const fecha = iso => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleString('es-NI', {dateStyle: 'short', timeStyle: 'short'}); };
  const aviso = t => { const el = $('usrNM'); el.textContent = t || ''; };

  /** Llama al servidor. Devuelve la respuesta si ok; si no, muestra el motivo y devuelve null. */
  async function llamar(accion, datos) {
    try {
      const j = await A.api(accion, datos);
      if (j && j.ok) return j;
      if (j && j.code !== 'sesion') UI.toast(j.error || 'No se pudo completar la acción.');
      return null;
    } catch { UI.toast('Sin conexión con el servidor de usuarios.'); return null; }
  }

  function abrir() {
    if (!puede()) { UI.toast('No tienes permiso para administrar usuarios.'); return; }
    $('usrCod').hidden = true; aviso(''); $('usrQ').value = '';
    $('usrDlg').showModal(); cargar();
  }
  $('cfgUsr').onclick = e => { e.preventDefault(); $('cfgDlg').close(); abrir(); };
  $('usrClose').onclick = e => { e.preventDefault(); $('usrDlg').close(); };
  $('usrForm').onsubmit = e => e.preventDefault();      // Enter dentro de los campos no debe cerrar el diálogo

  async function cargar() {
    if (cargando) return; cargando = true;
    const sc = $('usrDlg').querySelector('.usrwrap'), y = sc ? sc.scrollTop : 0;
    const j = await llamar('usr_listar', {});
    cargando = false; if (!j) return;
    lista = j.usuarios; roles = j.roles; permisos = j.permisos; etiquetas = j.etiquetas; forms = j.formularios || []; yo = A.auth.sess.user;
    pintarNuevosForms();
    const sel = $('usrNR'), previo = sel.value;
    sel.innerHTML = roles.map(r => `<option${r === (previo || 'Supervisor') ? ' selected' : ''}>${esc(r)}</option>`).join('');
    pintarLista(); pintarPermisos();
    if (sc) sc.scrollTop = y;
    if ($('usrAud').open) cargarAuditoria();
  }

  const idsDe = u => u.modulos === 'ninguno' ? [] : (u.modulos && u.modulos !== 'todos') ? u.modulos.split(',') : forms.map(f => f.id);
  const planDe = u => u.planificacion !== false;   // registro de la planificación (según lo planificado / diferente): vacío = habilitado
  const resumenForms = (ids, plan) => (ids.length === forms.length && plan) ? 'Todo' : (!ids.length && !plan) ? 'Ninguno' : (!ids.length ? 'Solo planificación' : ids.length + ' de ' + forms.length + (plan ? ' + planif.' : ''));
  function celdaForms(u) {   // desplegable con una casilla por formulario (no aplica a "Consulta": ese rol no registra nada)
    if (u.rol === 'Consulta') return '<span class="admsub" style="margin:0">no aplica</span>';
    const sel = idsDe(u), plan = planDe(u);
    return `<details class="mods"><summary>${resumenForms(sel, plan)}</summary><div class="modsl">${forms.map(f => `<label><input type="checkbox" class="um" value="${esc(f.id)}"${sel.includes(f.id) ? ' checked' : ''}> ${esc(f.titulo)}</label>`).join('')}<label class="planl"><input type="checkbox" class="up"${plan ? ' checked' : ''}> Registrar planificación en el mapa</label></div></details>`;
  }
  function pintarNuevosForms() {
    const c = $('usrNMods'); if (c.dataset.n === String(forms.length)) return;
    c.dataset.n = forms.length; c.innerHTML = forms.map(f => `<label><input type="checkbox" value="${esc(f.id)}" checked> ${esc(f.titulo)}</label>`).join('') + '<label class="planl"><input type="checkbox" class="unp" checked> Registrar planificación en el mapa</label>';
  }
  const marcadosNuevos = () => [...$('usrNMods').querySelectorAll('input:checked:not(.unp)')].map(i => i.value);
  const valorForms = ids => ids.length === forms.length ? 'todos' : (ids.length ? ids : 'ninguno');   // 'ninguno' = ningún formulario
  function pintarLista() {
    const q = $('usrQ').value.trim().toLowerCase();
    const v = lista.filter(u => !q || (u.usuario + ' ' + u.nombre + ' ' + u.rol).toLowerCase().includes(q));
    $('usrCnt').textContent = `${v.length} de ${lista.length} usuarios · ${lista.filter(u => u.activo).length} activos`;
    $('usrT').innerHTML = v.length ? v.map(u => {
      const soy = u.usuario === yo;
      return `<tr data-u="${esc(u.usuario)}" class="${u.activo ? '' : 'inact'}">
        <td><b>${esc(u.usuario)}</b>${soy ? ' <span class="tag t27">tú</span>' : ''}${u.pendiente ? ' <span class="ptag" title="Aún no cambió su código temporal">Pendiente</span>' : ''}${u.bloqueado ? ' <span class="ptag blq" title="Bloqueado por intentos fallidos">Bloqueado</span>' : ''}</td>
        <td><input class="un" type="text" maxlength="80" value="${esc(u.nombre)}" aria-label="Nombre de ${esc(u.usuario)}"></td>
        <td><select class="ur" aria-label="Rol de ${esc(u.usuario)}" ${soy ? 'disabled title="No puedes cambiar tu propio rol"' : ''}>${roles.map(r => `<option${r === u.rol ? ' selected' : ''}>${esc(r)}</option>`).join('')}</select></td>
        <td><input class="uf${u.rol === 'Administrador de frente' && !u.ficha ? ' inval' : ''}" type="text" inputmode="numeric" maxlength="8" value="${esc(u.ficha || '')}" placeholder="—" aria-label="Ficha de ${esc(u.usuario)}" style="width:84px"></td>
        <td>${celdaForms(u)}</td>
        <td><button type="button" class="ua ${u.activo ? 'on' : 'off'}" ${soy ? 'disabled title="No puedes desactivarte a ti mismo"' : ''}>${u.activo ? 'Activo' : 'Inactivo'}</button></td>
        <td>${fecha(u.ultimo)}</td>
        <td style="white-space:nowrap"><button type="button" class="urs" ${soy ? 'disabled title="Tu propia clave se cambia en Mi cuenta > Cambiar clave"' : ''}>Restablecer clave</button>${u.bloqueado ? ' <button type="button" class="udb">Desbloquear</button>' : ''}</td></tr>`;
    }).join('') : '<tr><td colspan="8" style="color:var(--mute);padding:10px">Sin coincidencias.</td></tr>';
  }

  function pintarPermisos() {
    const cuenta = r => lista.filter(u => u.rol === r && u.activo).length, claves = Object.keys(etiquetas);
    $('usrPermT').innerHTML = `<table class="admt"><thead><tr><th>Permiso</th>${roles.map(r => `<th style="text-align:center">${esc(r)}<div class="admsub" style="margin:0">${cuenta(r)} activos</div></th>`).join('')}</tr></thead><tbody>
      ${claves.map(k => `<tr><td>${esc(etiquetas[k])}</td>${roles.map(r => (permisos[r] || []).includes(k) ? '<td class="si">✓</td>' : '<td class="nop">—</td>').join('')}</tr>`).join('')}</tbody></table>
      <div class="admsub">Los permisos los define el rol y se aplican en el servidor. Para dar o quitar permisos a una persona, cámbiale el rol en la tabla de arriba.</div>`;
  }

  async function cargarAuditoria() {
    const j = await llamar('usr_auditoria', {}); if (!j) return;
    $('usrAudT').innerHTML = j.registros.length ? `<table class="admt"><thead><tr><th>Fecha</th><th>Administrador</th><th>Acción</th><th>Usuario</th><th>Detalle</th></tr></thead><tbody>
      ${j.registros.map(r => `<tr><td style="white-space:nowrap">${fecha(r.fecha)}</td><td>${esc(r.admin)}</td><td>${esc(r.accion)}</td><td>${esc(r.usuario)}</td><td>${esc(r.detalle)}</td></tr>`).join('')}</tbody></table>`
      : '<div class="admsub">Aún no hay cambios registrados.</div>';
  }
  $('usrAud').addEventListener('toggle', () => { if ($('usrAud').open) cargarAuditoria(); });

  // ---- código temporal (se muestra una sola vez) ----
  function mostrarCodigo(titulo, codigo) {
    $('usrCodT').innerHTML = titulo; $('usrCodV').textContent = codigo; $('usrCod').hidden = false;
    $('usrCod').scrollIntoView({block: 'nearest'});
  }
  $('usrCodX').onclick = () => { $('usrCod').hidden = true; $('usrCodV').textContent = ''; };
  $('usrCodCp').onclick = async () => {
    const t = $('usrCodV').textContent;
    try { await navigator.clipboard.writeText(t); UI.toast('Código copiado'); }
    catch { const r = document.createRange(); r.selectNodeContents($('usrCodV')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); UI.toast('Selecciona y copia el código'); }
  };

  // ---- crear ----
  async function crear() {
    const u = $('usrNU').value.trim().toLowerCase(), n = $('usrNN').value.trim(), r = $('usrNR').value, ficha = $('usrNF').value.trim(), mods = marcadosNuevos();
    if (!/^[a-z0-9._-]{3,30}$/.test(u)) return aviso('Usuario inválido: 3 a 30 caracteres (letras, números, punto, guion o guion bajo), sin espacios.');
    if (!n) return aviso('Escribe el nombre completo de la persona.');
    if (ficha && !/^\d{3,8}$/.test(ficha)) return aviso('La ficha debe ser un número de 3 a 8 dígitos.');
    if (r === 'Administrador de frente' && !ficha) return aviso('Un "Administrador de frente" necesita su ficha: así la app lo reconoce y precarga su nombre en los formularios.');
    if (r === 'Administrador' && !confirm(`¿Dar permisos de ADMINISTRADOR a ${n}? Podrá crear usuarios, cambiar roles y restablecer claves.`)) return;
    aviso(''); $('usrNC').disabled = true;
    const j = await llamar('usr_crear', {usuario: u, nombre: n, rol: r, ficha, formularios: r === 'Consulta' ? 'todos' : valorForms(mods), planificacion: r === 'Consulta' ? true : $('usrNMods').querySelector('.unp').checked});
    $('usrNC').disabled = false; if (!j) return;
    $('usrNU').value = $('usrNN').value = $('usrNF').value = ''; $('usrNMods').querySelectorAll('input').forEach(i => { i.checked = true; });
    mostrarCodigo(`Usuario creado: <b>${esc(j.usuario)}</b> (${esc(r)}). Código temporal:`, j.codigo);
    cargar();
  }
  $('usrNC').onclick = crear;
  [$('usrNU'), $('usrNN'), $('usrNF')].forEach(el => el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); crear(); } }));
  $('usrQ').addEventListener('input', pintarLista);

  // ---- acciones por fila ----
  const fila = el => { const tr = el.closest('tr[data-u]'); return tr ? lista.find(u => u.usuario === tr.dataset.u) : null; };
  $('usrT').addEventListener('change', async e => {
    const u = fila(e.target); if (!u) return;
    if (e.target.classList.contains('ur')) {
      const rol = e.target.value; let ficha;
      if (!confirm(`¿Cambiar el rol de ${u.nombre} de ${u.rol} a ${rol}?\n\nRige de inmediato, sin que la persona tenga que salir y entrar.`)) { e.target.value = u.rol; return; }
      if (rol === 'Administrador de frente' && !u.ficha) {   // este rol necesita ficha: se pide aquí mismo
        ficha = (prompt(`Ficha de ${u.nombre} (número de 3 a 8 dígitos). Un "Administrador de frente" la necesita:`) || '').trim();
        if (!/^\d{3,8}$/.test(ficha)) { UI.toast('No se cambió el rol: falta una ficha válida.'); e.target.value = u.rol; return; }
      }
      const j = await llamar('usr_editar', ficha ? {usuario: u.usuario, rol, ficha} : {usuario: u.usuario, rol});
      if (!j) e.target.value = u.rol; else UI.toast(`Rol de ${u.usuario}: ${rol}`);
      cargar();
    } else if (e.target.classList.contains('un')) {
      const nombre = e.target.value.trim();
      if (!nombre || nombre === u.nombre) { e.target.value = u.nombre; return; }
      const j = await llamar('usr_editar', {usuario: u.usuario, nombre});
      if (!j) e.target.value = u.nombre; else UI.toast('Nombre actualizado');
      cargar();
    } else if (e.target.classList.contains('uf')) {
      const ficha = e.target.value.trim();
      if (ficha === (u.ficha || '')) return;
      const j = await llamar('usr_editar', {usuario: u.usuario, ficha});
      if (!j) e.target.value = u.ficha || ''; else UI.toast(ficha ? `Ficha de ${u.usuario}: ${ficha}` : `${u.usuario}: sin ficha`);
      cargar();
    } else if (e.target.classList.contains('um') || e.target.classList.contains('up')) {
      const det = e.target.closest('details'), ids = [...det.querySelectorAll('input.um:checked')].map(i => i.value), plan = det.querySelector('input.up').checked;
      const valor = valorForms(ids), j = await llamar('usr_editar', {usuario: u.usuario, formularios: valor, planificacion: plan});   // se puede dejar sin ningún formulario y/o sin registro de planificación
      if (!j) { const prev = idsDe(u); det.querySelectorAll('input.um').forEach(i => { i.checked = prev.includes(i.value); }); det.querySelector('input.up').checked = planDe(u); return; }
      u.modulos = valor === 'todos' ? 'todos' : (ids.length ? ids.join(',') : 'ninguno'); u.planificacion = plan; det.querySelector('summary').textContent = resumenForms(ids, plan);   // sin redibujar la tabla: el desplegable sigue abierto
      UI.toast(`Permisos de ${u.usuario}: ${resumenForms(ids, plan)}`);
    }
  });
  $('usrT').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.classList.contains('un')) { e.preventDefault(); e.target.blur(); } });
  $('usrT').addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return; const u = fila(b); if (!u) return;
    if (b.classList.contains('ua')) {
      const activar = !u.activo;
      if (!activar && !confirm(`¿Desactivar a ${u.nombre}?\n\nPerderá el acceso de inmediato. Sus respuestas ya registradas se conservan.`)) return;
      const j = await llamar('usr_editar', {usuario: u.usuario, activo: activar}); if (j) UI.toast(`${u.usuario}: ${activar ? 'activado' : 'desactivado'}`); cargar();
    } else if (b.classList.contains('urs')) {
      if (!confirm(`¿Restablecer la clave de ${u.nombre}?\n\nSu clave actual dejará de servir, se cerrarán sus sesiones abiertas y recibirá un código temporal para crear una clave nueva.`)) return;
      const j = await llamar('usr_reiniciar', {usuario: u.usuario});
      if (j) mostrarCodigo(`Clave restablecida para <b>${esc(j.usuario)}</b>. Código temporal:`, j.codigo);
      cargar();
    } else if (b.classList.contains('udb')) {
      const j = await llamar('usr_desbloquear', {usuario: u.usuario}); if (j) UI.toast(`${u.usuario} desbloqueado`); cargar();
    }
  });
}
