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
  let ultErr = '', colaU = Promise.resolve();
  async function llamarYa(accion, datos) {
    try {
      const j = await A.api(accion, datos);
      if (j && j.ok) return j;
      if (j && j.code !== 'sesion') { ultErr = j.error || 'No se pudo completar la acción.'; UI.toast(ultErr); } else ultErr = 'La sesión caducó: vuelve a entrar.';
      return null;
    } catch { ultErr = 'Sin conexión con el servidor de usuarios.'; UI.toast(ultErr); return null; }
  }
  /** Las llamadas salen de una en una, en el orden de los clics: el servidor de Google atiende una petición a la vez y cada una espera su turno como máximo 20 s; con varias a la vez las últimas se perdían y el orden de llegada podía cambiar. */
  function llamar(accion, datos) { const p = colaU.then(() => llamarYa(accion, datos)); colaU = p.catch(() => {}); return p; }

  function abrir() {
    if (!puede()) { UI.toast('No tienes permiso para administrar usuarios.'); return; }
    $('usrCod').hidden = true; aviso(''); $('usrQ').value = '';
    $('usrDlg').showModal(); cargar();
  }
  $('cfgUsr').onclick = e => { e.preventDefault(); $('cfgDlg').close(); abrir(); };
  $('usrClose').onclick = e => { e.preventDefault(); $('usrDlg').close(); };
  $('usrForm').onsubmit = e => e.preventDefault();      // Enter dentro de los campos no debe cerrar el diálogo

  async function cargar() {
    await vaciarForms();   // antes de redibujar, lo que se eligió en las casillas debe estar guardado
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
  /* CASILLAS DE FORMULARIOS. Cada casilla no manda su propia petición: se espera un instante a que termines de marcar (o a que cierres la lista) y se guarda UNA vez
   * el estado final; si aún hay un guardado en curso, al terminar se manda el estado más reciente. La pantalla nunca se revierte sola: si algo falla, se avisa y se vuelve a leer del servidor. */
  const pendF = {};
  const estadoDet = det => ({ids: [...det.querySelectorAll('input.um:checked')].map(i => i.value), plan: det.querySelector('input.up').checked});
  function programarForms(u, det) { const p = pendF[u.usuario] = pendF[u.usuario] || {}; p.det = det; clearTimeout(p.t); p.t = setTimeout(() => lanzarForms(u, p), 600); }
  function lanzarForms(u, p) {
    clearTimeout(p.t); p.t = null;
    if (p.vuelo) { p.otra = true; return p.prom; }
    p.vuelo = true;
    p.prom = (async () => {
      let fallo = '';
      do {
        p.otra = false; const {ids, plan} = estadoDet(p.det), valor = valorForms(ids);
        const j = await llamar('usr_editar', {usuario: u.usuario, formularios: valor, planificacion: plan});   // se puede dejar sin ningún formulario y/o sin registro de planificación
        if (j) { u.modulos = valor === 'todos' ? 'todos' : (ids.length ? ids.join(',') : 'ninguno'); u.planificacion = plan; } else fallo = ultErr || 'No se pudo guardar.';
      } while (p.otra);
      p.vuelo = false;
      if (fallo) { UI.toast(`No se guardaron los permisos de ${u.usuario}: ${fallo}`); cargar(); }
      else { const {ids, plan} = estadoDet(p.det); UI.toast(`Permisos de ${u.usuario}: ${resumenForms(ids, plan)}`); }
    })();
    return p.prom;
  }
  async function vaciarForms() {   // guarda ya lo que esté esperando y espera a que termine todo lo que está en curso
    const ps = [];
    Object.entries(pendF).forEach(([k, p]) => { if (p.t) { const u = lista.find(x => x.usuario === k); if (u) lanzarForms(u, p); else { clearTimeout(p.t); p.t = null; } } if (p.vuelo && p.prom) ps.push(p.prom); });
    await Promise.all(ps);
  }
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
      const det = e.target.closest('details'), est = estadoDet(det);
      det.querySelector('summary').textContent = resumenForms(est.ids, est.plan);   // se ve al instante; el guardado se agrupa (sin redibujar la tabla: el desplegable sigue abierto)
      programarForms(u, det);
    }
  });
  $('usrT').addEventListener('toggle', e => {   // al cerrar la lista de formularios se guarda sin esperar
    if (!e.target.matches || !e.target.matches('details.mods') || e.target.open) return;
    const tr = e.target.closest('tr[data-u]'), u = tr && lista.find(x => x.usuario === tr.dataset.u), p = u && pendF[u.usuario]; if (p && p.t) lanzarForms(u, p);
  }, true);
  $('usrDlg').addEventListener('close', () => { vaciarForms(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) vaciarForms(); });
  /* ==================== ALTAS MASIVAS (plantilla CSV o filas pegadas) ==================== */
  const ALT_LOTE = 30;                      // usuarios por petición al crear (cada uno calcula el hash de su clave temporal en el servidor)
  let altOk = [], altFilas = [], altRes = [], altCodigos = [];
  const sinAc = t => String(t == null ? '' : t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  const altMsg = (t, ok) => { const e = $('altMsg'); e.textContent = t || ''; e.style.color = t ? (ok ? '' : 'var(--amber)') : ''; };
  const csvCelda = v => { const s = String(v == null ? '' : v); return /[;"\n\r,]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  function bajar(nombre, texto) {          // CSV con BOM (Excel lo abre con tildes) y la indicación sep=; (Excel abre las columnas bien en cualquier idioma)
    const a = document.createElement('a'), u = URL.createObjectURL(new Blob(['\uFEFF' + texto], {type: 'text/csv;charset=utf-8'}));
    a.href = u; a.download = nombre; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000);
  }
  function altPlantilla() {
    const ids = forms.map(f => f.id).join(', '), l = [
      'sep=;',
      '# PLANTILLA DE ALTAS MASIVAS. Las líneas que empiezan con # se ignoran. Llena una fila por persona debajo del encabezado.',
      '# Usuario: 3 a 30 caracteres (letras, números, punto, guion o guion bajo), sin espacios. Nombre: el que verá la gente (si lo dejas vacío se usa el usuario).',
      '# Rol: ' + roles.join(' | ') + '. El "Administrador de frente" necesita Ficha (3 a 8 dígitos).',
      '# Formularios: todos, ninguno o una lista separada por comas con: ' + ids + '. Vacío = todos. (No aplica al rol Consulta.)',
      '# Planificacion: Sí o No (si puede registrar la planificación en el mapa). Vacío = Sí.',
      '# Ejemplo: jperez;Juan Pérez;Supervisor;;todos;Sí',
      '# Ejemplo: mlopez;María López;Administrador de frente;46207;combustible,motos,ats;Sí',
      'Usuario;Nombre;Rol;Ficha;Formularios;Planificacion'];
    bajar('plantilla_altas_usuarios.csv', l.join('\r\n') + '\r\n'); altMsg('Plantilla descargada. Llénala, guárdala como CSV y súbela, o copia las celdas y pégalas aquí.', true);
  }
  function altPartir(l, sep) { const o = []; let c = '', q = false; for (let i = 0; i < l.length; i++) { const x = l[i]; if (q) { if (x === '"') { if (l[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += x; } else if (x === '"') q = true; else if (x === sep) { o.push(c); c = ''; } else c += x; } o.push(c); return o.map(s => s.trim()); }
  const ALT_NOMBRES = {usuario: ['usuario', 'user', 'login'], nombre: ['nombre', 'nombre completo'], rol: ['rol'], ficha: ['ficha'], formularios: ['formularios', 'formulario'], planificacion: ['planificacion']};
  function altParsear(txt) {                // → {filas} o {error}
    const util = []; String(txt || '').replace(/^\uFEFF/, '').split(/\r\n|\n|\r/).forEach((l, i) => { const t = l.trim(); if (t && t[0] !== '#' && !/^sep=/i.test(t)) util.push({n: i + 1, l}); });
    if (!util.length) return {error: 'No hay nada que revisar: pega las filas o sube la plantilla llena (con su encabezado).'};
    const h = util[0].l, cuenta = c => h.split(c).length - 1, sep = [['\t', cuenta('\t')], [';', cuenta(';')], [',', cuenta(',')]].sort((a, b) => b[1] - a[1])[0];
    if (!sep[1]) return {error: 'No reconozco las columnas. La primera fila debe ser el encabezado: Usuario;Nombre;Rol;Ficha;Formularios;Planificacion.'};
    const enc = altPartir(h, sep[0]).map(sinAc), idx = {};
    Object.keys(ALT_NOMBRES).forEach(k => { const i = enc.findIndex(x => ALT_NOMBRES[k].includes(x)); if (i >= 0) idx[k] = i; });
    const falta = ['usuario', 'rol'].filter(k => idx[k] === undefined);
    if (falta.length) return {error: 'Al encabezado le falta la columna ' + falta.map(x => x[0].toUpperCase() + x.slice(1)).join(' y ') + '. Usa la plantilla: Usuario;Nombre;Rol;Ficha;Formularios;Planificacion.'};
    const filas = [];
    util.slice(1).forEach(({n, l}) => { const c = altPartir(l, sep[0]); if (c.every(x => x === '')) return; const f = {n}; Object.keys(idx).forEach(k => { f[k] = c[idx[k]] === undefined ? '' : c[idx[k]]; }); filas.push(f); });
    if (!filas.length) return {error: 'La plantilla no tiene filas debajo del encabezado.'};
    if (filas.length > 500) return {error: 'Son ' + filas.length + ' filas: el máximo por revisión es 500. Divide el archivo.'};
    return {filas};
  }
  async function altLeerArchivo(file) {
    if (file.size > 1500000) throw new Error('El archivo es demasiado grande para ser una plantilla de altas.');
    const buf = await file.arrayBuffer(), b = new Uint8Array(buf);
    if (b[0] === 0x50 && b[1] === 0x4B) throw new Error('Ese archivo es de Excel (.xlsx). Guárdalo como CSV (Archivo → Guardar como → CSV), o copia las celdas y pégalas en el cuadro.');
    try { return new TextDecoder('utf-8', {fatal: true}).decode(buf); } catch { return new TextDecoder('windows-1252').decode(buf); }   // el "CSV" de Excel suele guardarse en ANSI: así las tildes no se dañan
  }
  function altLimpiar() { altOk = []; altFilas = []; altRes = []; $('altRes').hidden = true; $('altT').innerHTML = ''; $('altCrear').disabled = true; $('altAdmL').hidden = true; $('altAdm').checked = false; altMsg(''); }
  function altCerrarCodigos() { altCodigos = []; $('altCT').innerHTML = ''; $('altCods').hidden = true; }
  async function altRevisar() {
    altCerrarCodigos(); altMsg('Revisando…', true); $('altRevisar').disabled = true;
    const p = altParsear($('altTexto').value);
    if (p.error) { $('altRes').hidden = true; altMsg(p.error); $('altRevisar').disabled = false; return; }
    const j = await llamar('usr_altas', {filas: p.filas, simular: true}); $('altRevisar').disabled = false;
    if (!j) { altMsg('No se pudo revisar: ' + (ultErr || 'error desconocido')); return; }
    altFilas = p.filas; altRes = j.resultados; altOk = altFilas.filter(f => (altRes.find(r => r.n === f.n) || {}).estado === 'ok');
    $('altT').innerHTML = altRes.map(r => `<tr class="e-${r.estado}"><td>${r.n}</td><td>${esc(r.usuario)}</td><td>${esc(r.nombre || '')}</td><td>${esc(r.rol || '')}</td><td>${esc(r.ficha || '')}</td><td>${r.estado === 'ok' ? '✓ Se creará' + (r.formularios && r.formularios !== 'todos' ? ' (formularios: ' + esc(r.formularios) + ')' : '') + (r.planificacion === false ? ' · sin planificación' : '') : r.estado === 'existe' ? 'Ya existe: se omite' : '✗ ' + esc(r.mensaje)}</td></tr>`).join('');
    $('altResum').textContent = `${altRes.length} fila(s): ${j.ok_n} se crearán · ${j.existen} ya existen (se omiten) · ${j.errores} con error (se omiten, corrígelas en tu archivo y vuelve a revisar).`;
    const hayAdm = altRes.some(r => r.estado === 'ok' && r.rol === 'Administrador'); $('altAdmL').hidden = !hayAdm; $('altAdm').checked = false;
    $('altCrear').disabled = !j.ok_n; $('altCrear').textContent = j.ok_n ? `Crear ${j.ok_n} usuario${j.ok_n === 1 ? '' : 's'}` : 'No hay usuarios para crear'; $('altRes').hidden = false; altMsg('');
  }
  async function altCrear() {
    if (!altOk.length) return;
    if (altRes.some(r => r.estado === 'ok' && r.rol === 'Administrador') && !$('altAdm').checked) { altMsg('Marca la confirmación de los usuarios con rol Administrador para continuar.'); return; }
    if (!confirm(`¿Crear ${altOk.length} usuario(s) ahora?\n\nCada uno recibirá un código temporal que se mostrará UNA sola vez.`)) return;
    $('altCrear').disabled = true; $('altRevisar').disabled = true; const out = []; let hechos = 0, parar = '';
    for (let i = 0; i < altOk.length; i += ALT_LOTE) {
      altMsg(`Creando ${Math.min(i + ALT_LOTE, altOk.length)} de ${altOk.length}…`, true);
      const j = await llamar('usr_altas', {filas: altOk.slice(i, i + ALT_LOTE), simular: false});
      if (!j) { parar = ultErr || 'error desconocido'; break; }
      out.push(...j.resultados); hechos += j.creados;
    }
    $('altRevisar').disabled = false;
    altMostrarCodigos(out);
    altMsg(parar ? `Se detuvo tras crear ${hechos} de ${altOk.length}: ${parar}. Los ya creados están abajo; pulsa Revisar para continuar con los que faltan (los creados aparecerán como "ya existe").` : `Listo: ${hechos} usuario(s) creado(s) ✓`, !parar);
    $('altRes').hidden = true; altOk = []; await cargar();
  }
  function altMostrarCodigos(res) {
    altCodigos = res.filter(r => r.estado === 'ok' && r.codigo).map(r => ({usuario: r.usuario, nombre: r.nombre, rol: r.rol, codigo: r.codigo, estado: 'Creado'}));
    const otros = res.filter(r => r.estado !== 'ok');
    if (!altCodigos.length) { $('altCods').hidden = true; return; }
    $('altCodT').innerHTML = `<b>${altCodigos.length} usuario(s) creado(s).</b>` + (otros.length ? ` ${otros.length} se omitieron (ya existían o tenían error).` : '');
    $('altCT').innerHTML = altCodigos.map(c => `<tr><td>${esc(c.usuario)}</td><td>${esc(c.nombre)}</td><td><code>${esc(c.codigo)}</code></td></tr>`).join('');
    $('altCods').hidden = false; $('altCods').scrollIntoView({block: 'nearest'});
  }
  $('altPlantilla').onclick = e => { e.preventDefault(); altPlantilla(); };
  $('altArchivo').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { $('altTexto').value = await altLeerArchivo(f); altMsg(`Archivo leído: ${f.name}. Pulsa Revisar.`, true); altLimpiarResultado(); } catch (x) { altMsg(x.message); } };
  const altLimpiarResultado = () => { altOk = []; $('altRes').hidden = true; $('altCrear').disabled = true; };
  $('altTexto').addEventListener('input', altLimpiarResultado);   // si cambias el texto, hay que volver a revisar
  $('altRevisar').onclick = e => { e.preventDefault(); altRevisar(); };
  $('altLimpiar').onclick = e => { e.preventDefault(); $('altTexto').value = ''; altLimpiar(); altCerrarCodigos(); };
  $('altCrear').onclick = e => { e.preventDefault(); altCrear(); };
  $('altOk').onclick = e => { e.preventDefault(); altCerrarCodigos(); };
  $('altCopiar').onclick = async e => { e.preventDefault(); try { await navigator.clipboard.writeText('Usuario\tNombre\tCódigo temporal\n' + altCodigos.map(c => `${c.usuario}\t${c.nombre}\t${c.codigo}`).join('\n')); UI.toast('Copiado'); } catch { UI.toast('No se pudo copiar: usa la descarga.'); } };
  $('altBajar').onclick = e => { e.preventDefault(); bajar('altas_' + new Date().toISOString().slice(0, 10) + '.csv', ['sep=;', ['Usuario', 'Nombre', 'Rol', 'Codigo temporal', 'Estado'].join(';'), ...altCodigos.map(c => [c.usuario, c.nombre, c.rol, c.codigo, c.estado].map(csvCelda).join(';'))].join('\r\n') + '\r\n'); };
  $('usrDlg').addEventListener('close', () => { altCerrarCodigos(); });   // los códigos temporales no se quedan en pantalla al cerrar
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
