"""Construye docs/index.html: visor de un solo archivo (sin datos embebidos) que descarga data/rutas.json
desde GitHub, lo guarda en el navegador (IndexedDB) y sigue funcionando sin conexión.

Uso:  python scripts/construir_visor.py --repo usuario/repo [--rama main]
      python scripts/construir_visor.py --datos https://raw.githubusercontent.com/usuario/repo/main/data/
"""
import argparse, base64, json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = lambda *p: os.path.join(ROOT, 'visor_src', *p)
rd = lambda p: open(p, encoding='utf-8').read()
b64 = lambda p: base64.b64encode(open(p, 'rb').read()).decode()

ap = argparse.ArgumentParser()
ap.add_argument('--repo', help='usuario/repositorio en GitHub')
ap.add_argument('--rama', default='main')
ap.add_argument('--datos', help='URL base de la carpeta data/ (anula --repo)')
ap.add_argument('--salida', default=os.path.join(ROOT, 'docs', 'index.html'))
a = ap.parse_args()
cfg = json.load(open(S('config.json'), encoding='utf-8'))
datos = a.datos or (f'https://raw.githubusercontent.com/{a.repo}/{a.rama}/data/' if a.repo else cfg.get('datos_url', ''))

# --- recursos embebidos ---
lcss = rd(S('vendor', 'leaflet', 'leaflet.css'))
for img in ('layers-2x.png', 'layers.png', 'marker-icon.png'):
    lcss = lcss.replace(f'images/{img}', 'data:image/png;base64,' + b64(S('vendor', 'leaflet', 'images', img)))
fonts = '\n'.join(
    f"@font-face{{font-family:'{fam}';font-style:normal;font-weight:{w};font-display:swap;"
    f"src:url(data:font/woff2;base64,{b64(S('vendor', 'fonts', f'{slug}-latin-{w}-normal.woff2'))}) format('woff2')}}"
    for fam, slug, ws in (('Barlow', 'barlow', (400, 500, 600)), ('Barlow Semi Condensed', 'barlow-semi-condensed', (500, 600, 700)))
    for w in ws)
config_js = json.dumps({'url': cfg.get('sheets_url', ''), 'token': cfg.get('sheets_token', ''), 'data': datos}, ensure_ascii=False)
core = rd(S('core.js')).replace("/*__CONFIG__*/{url:'',token:'',data:''}", config_js)
assert config_js in core, 'No se encontró el marcador CONFIG en core.js'

def parts(name):
    t = rd(S(name))
    return (re.search(r'<style>/\*__CSS__\*/(.*?)</style>', t, re.S).group(1),
            re.search(r'<body>(.*?)<!--__DIALOG__-->', t, re.S).group(1),
            re.findall(r'<script>(.*?)</script>', t, re.S)[-1])
w_css, w_body, w_js = parts('web.html')
m_css, m_body, m_js = parts('movil.html')
dlg = rd(S('dialog.html')).replace('<div class="row">', '<div class="row"><button id="modeSw" type="button"></button>')
esc = lambda s: s.replace('</script>', '<\\/script>')

BOOT = r'''
(() => {
  const $ = id => document.getElementById(id);
  let saved = {}; try { saved = JSON.parse(localStorage.getItem('rp26_cfg') || '{}'); } catch {}
  const cfg = {data: saved.data || CONFIG.data, gh: saved.gh || ''};
  const say = (m, p) => { $('bootMsg').textContent = m; if (p != null) $('bootBar').style.width = Math.min(100, p) + '%'; };
  // ---- IndexedDB (caché de datos para uso sin conexión) ----
  const idb = () => new Promise((ok, ko) => { try { const r = indexedDB.open('rp26', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); } catch (e) { ko(e); } });
  const idbGet = async k => { try { const db = await idb(); return await new Promise(ok => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => ok(q.result); q.onerror = () => ok(null); }); } catch { return null; } };
  const idbPut = async (k, v) => { try { const db = await idb(); await new Promise(ok => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = t.onerror = () => ok(); }); } catch {} };
  // ---- origen: raw.githubusercontent (público) o API de GitHub con token (privado) ----
  function req(file, bust) {
    const base = cfg.data.endsWith('/') ? cfg.data : cfg.data + '/', full = base + file;
    const m = full.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
    if (cfg.gh && m) return [`https://api.github.com/repos/${m[1]}/${m[2]}/contents/${m[4]}?ref=${m[3]}`, {headers: {Authorization: 'Bearer ' + cfg.gh, Accept: 'application/vnd.github.raw'}, cache: 'no-store'}];
    return [full + (full.includes('?') ? '&' : '?') + 'v=' + bust, {cache: 'no-store'}];
  }
  async function get(file, bust, ms, total) {
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), ms);
    try { const [u, o] = req(file, bust); const r = await fetch(u, {...o, signal: ctl.signal});
      if (!r.ok) throw new Error(`HTTP ${r.status} al leer ${file}`);
      if (!total || !r.body) return await r.text();
      const rd = r.body.getReader(), chunks = []; let n = 0;
      for (;;) { const {done, value} = await rd.read(); if (done) break; chunks.push(value); n += value.length;
        say(`Descargando datos… ${(n / 1e6).toFixed(1)} de ${(total / 1e6).toFixed(1)} MB`, 10 + 85 * n / total); }
      const buf = new Uint8Array(n); let off = 0; chunks.forEach(c => { buf.set(c, off); off += c.length; });
      return new TextDecoder().decode(buf);
    } finally { clearTimeout(to); }
  }
  function start(text, meta) {
    say('Preparando mapa…', 98);
    createApp(JSON.parse(text), meta); initUI();
    const qs = new URLSearchParams(location.search).get('modo');
    let pref = null; try { pref = localStorage.getItem('rp26_modo'); } catch {}
    const auto = (matchMedia('(max-width: 820px)').matches || (matchMedia('(pointer: coarse)').matches && innerWidth < 1100)) ? 'movil' : 'web';
    const mode = qs === 'web' || qs === 'movil' ? qs : (pref || auto), M = mode === 'movil' ? 'Movil' : 'Web';
    document.documentElement.dataset.ui = mode;
    $('uiCss').textContent = $('css' + M).textContent;
    $('uiRoot').appendChild($('tpl' + M).content.cloneNode(true));
    const sw = $('modeSw'); sw.textContent = mode === 'movil' ? 'Usar vista web' : 'Usar vista móvil';
    sw.onclick = () => { try { localStorage.setItem('rp26_modo', mode === 'movil' ? 'web' : 'movil'); } catch {}
      const u = new URL(location.href); u.searchParams.delete('modo'); location.replace(u.toString()); };
    const s = document.createElement('script'); s.textContent = $('js' + M).textContent; document.body.appendChild(s);
    $('boot').remove();
    if (meta.aviso) setTimeout(() => UI.toast(meta.aviso), 1500);
  }
  function fail(err, cached) {
    $('bootFail').hidden = false; $('bootUrl').value = cfg.data || ''; $('bootGh').value = cfg.gh || '';
    say(cfg.data ? `No se pudieron descargar los datos (${err && err.message || err}).` : 'Falta configurar la URL de datos en GitHub.', 0);
    $('bootRetry').onclick = () => { cfg.data = $('bootUrl').value.trim(); cfg.gh = $('bootGh').value.trim();
      try { localStorage.setItem('rp26_cfg', JSON.stringify({...saved, data: cfg.data, gh: cfg.gh})); } catch {} location.reload(); };
    $('bootFile').onchange = async e => { const f = e.target.files[0]; if (!f) return; const t = await f.text();
      try { JSON.parse(t); } catch { say('El archivo no es un rutas.json válido.'); return; }
      const meta = {version: 'archivo local', generado: new Date(f.lastModified).toISOString(), origen: f.name};
      await idbPut('datos', {meta, text: t}); start(t, meta); };
  }
  (async () => {
    let force = false; try { force = sessionStorage.getItem('rp26_force') === '1'; sessionStorage.removeItem('rp26_force'); } catch {}
    say('Revisando versión de los datos…', 4);
    const cached = await idbGet('datos');
    let meta = null, err = null;
    if (cfg.data) { try { meta = JSON.parse(await get('manifest.json', Date.now(), 10000)); } catch (e) { err = e; } }
    if (meta && cached && cached.meta.version === meta.version && !force)
      return start(cached.text, {...meta, origen: 'caché del navegador (al día con GitHub)'});
    if (meta) {
      try { const t = await get('rutas.json', meta.version, 180000, meta.bytes); JSON.parse(t);
        await idbPut('datos', {meta, text: t});
        return start(t, {...meta, origen: 'descargado de GitHub', aviso: cached ? `Datos actualizados a la versión ${meta.version}` : ''});
      } catch (e) { err = e; }
    }
    if (cached) return start(cached.text, {...cached.meta, origen: 'caché del navegador (sin conexión)',
      aviso: `Sin conexión con GitHub: usando datos guardados del ${String(cached.meta.generado || '').slice(0, 10)}`});
    fail(err);
  })();
})();
'''

html = f'''<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#1d2b22"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes">
<title>Rutas por plantío · Programa de Corte 2026-2027</title>
<style>{fonts}</style>
<style>{lcss}</style>
<style>{rd(S('common.css'))}
#modeSw{{margin-right:auto}} dialog .row{{flex-wrap:wrap}}
#boot{{position:fixed;inset:0;z-index:5000;background:var(--panel);display:grid;place-items:center;padding:24px}}
#boot .bx{{width:min(440px,100%)}} #boot h1{{font:700 26px var(--f-head);margin:0 0 4px}}
#boot .pb{{height:6px;background:var(--field);border-radius:3px;margin:16px 0 8px;overflow:hidden}}
#bootBar{{height:100%;width:2%;background:var(--amber);transition:width .2s}}
#bootMsg{{color:var(--mute);font-size:14px;min-height:20px}}
#bootFail label{{display:grid;gap:4px;margin:12px 0;font-size:13px;color:var(--mute)}}
#bootFail .r{{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}}
</style>
<style id="uiCss"></style>
</head>
<body>
<div id="boot"><div class="bx"><h1>Rutas por plantío</h1><div style="color:var(--mute)">Programa de Corte 2026-2027</div>
  <div class="pb"><div id="bootBar"></div></div><div id="bootMsg">Iniciando…</div>
  <div id="bootFail" hidden>
    <label>URL de la carpeta data/ en GitHub<input id="bootUrl" type="url" placeholder="https://raw.githubusercontent.com/usuario/repo/main/data/"></label>
    <label>Token de GitHub (solo repositorio privado)<input id="bootGh" type="password" autocomplete="off"></label>
    <div class="r"><button id="bootRetry" class="primary">Reintentar</button>
      <label style="margin:0;display:inline-flex"><span class="btnf" style="display:none"></span><input id="bootFile" type="file" accept=".json,application/json" style="max-width:260px"></label></div>
    <div style="font-size:12.5px;color:var(--mute);margin-top:6px">También puedes abrir un <b>rutas.json</b> descargado del repositorio.</div>
  </div></div></div>
<div id="uiRoot" style="display:contents"></div>
{dlg}
<script>{rd(S('vendor', 'leaflet', 'leaflet.js'))}</script>
<script>{core}</script>
<script>{rd(S('common_ui.js'))}</script>
<script type="text/plain" id="jsWeb">{esc(w_js)}</script>
<script type="text/plain" id="jsMovil">{esc(m_js)}</script>
<template id="tplWeb">{w_body}</template>
<template id="tplMovil">{m_body}</template>
<script type="text/plain" id="cssWeb">{w_css}</script>
<script type="text/plain" id="cssMovil">{m_css}</script>
<script>{BOOT}</script>
</body>
</html>'''
os.makedirs(os.path.dirname(a.salida), exist_ok=True)
open(a.salida, 'w', encoding='utf-8').write(html)
print('visor', a.salida, round(len(html.encode()) / 1e3), 'KB', '· datos:', datos or '(sin configurar)')
