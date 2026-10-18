/* Soporty Agente — equipos administrados (soporte desatendido).
 * Reusa el motor WebRTC de Soporty (SPRoom, en rtc.js) igual que la app de Windows,
 * pero sin pedir código: el equipo se registra una vez y queda escuchando conexiones
 * entrantes del técnico (ya autorizadas con el PIN del equipo en el panel). Al conectar
 * comparte la pantalla y acepta el control automáticamente, mostrando la barra roja. */
(function () {
  'use strict';
  const invoke = window.__TAURI__ && window.__TAURI__.core.invoke;
  const tauriEvent = window.__TAURI__ && window.__TAURI__.event;
  const tauriWin = window.__TAURI__ && window.__TAURI__.window;
  const $ = (id) => document.getElementById(id);

  const DEFAULT_SERVER = 'https://soporty.com';
  let SERVER = DEFAULT_SERVER;
  let DEV = null;            // { id, token, name }  registro del equipo
  let SESSAUTH = null;       // "id:token" de la sesión en curso (cliente)

  /* ---- fetch: solo las peticiones a NUESTRO servidor reciben cabeceras y URL absoluta.
   *      Las llamadas internas de Tauri (http://ipc.localhost, tauri.localhost) y cualquier
   *      otro origen pasan intactas: si las tocáramos, Tauri perdería su Tauri-Invoke-Key. ---- */
  const rawFetch = window.fetch.bind(window);
  window.fetch = function (url, init) {
    let u = typeof url === 'string' ? url : (url && url.url) || '';
    const absolute = /^https?:\/\//i.test(u);
    if (absolute && u.indexOf(SERVER) !== 0) return rawFetch(url, init);   // Tauri u otros orígenes: no tocar
    if (!absolute) u = SERVER + '/' + String(u).replace(/^\//, '');
    init = Object.assign({}, init || {});
    const h = new Headers(init.headers || undefined);
    h.set('X-Soporty', '1');
    if (DEV) h.set('X-Device-Auth', DEV.id + ':' + DEV.token);       // api/agent.php
    if (SESSAUTH) h.set('X-Client-Auth', SESSAUTH);                  // api/rtc.php
    init.headers = h;
    return rawFetch(u, init);
  };

  window.SP = {
    base: SERVER, csrf: '',
    url: (p) => SERVER + '/' + String(p).replace(/^\//, ''),
    esc: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    clock: (sec) => { sec = Math.max(0, Math.floor(sec)); const m = Math.floor(sec / 60), s = sec % 60; return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0'); },
    isMobile: () => false,
    canShareScreen: () => !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia),
    beep: () => {},
    toast: (m) => logLine(m),
    copy: () => {}, modal: () => {},
    api: async function (path, data) {
      const init = { method: data === undefined ? 'GET' : 'POST', cache: 'no-store' };
      if (data !== undefined) { init.body = JSON.stringify(data); init.headers = { 'Content-Type': 'application/json' }; }
      const res = await window.fetch(SP.url(path), init);
      let j = null; try { j = await res.json(); } catch (e) {}
      if (!res.ok || !j || j.ok === false) { const e = new Error((j && j.error) || ('Error ' + res.status)); e.status = res.status; throw e; }
      return j;
    }
  };

  function logLine(msg) {
    const el = document.createElement('div'); el.className = 'ln system';
    const t = new Date(); el.textContent = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') + ' · ' + msg;
    const log = $('log'); if (!log) return; const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
    log.appendChild(el); if (stick) log.scrollTop = log.scrollHeight;
    while (log.children.length > 60) log.removeChild(log.firstChild);
  }

  /* ---- estado de sesión ---- */
  let room = null, mic = null, screen = null, ended = false;
  let controlling = false, screenW = 1920, screenH = 1080;
  const INPUT = new Set(['move', 'down', 'up', 'click', 'wheel', 'key', 'keydown', 'keyup', 'text']);
  let inBuf = [], flush = 0, polling = false, pollTimer = 0, busy = false;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    if (tauriEvent) tauriEvent.listen('rc-stopped', () => onControlStopped());
    $('btnEnroll').onclick = enroll;
    $('btnCapture').onclick = () => startShare(true);
    $('btnReset').onclick = resetDevice;
    $('btnMin').onclick = () => { try { if (tauriWin) tauriWin.getCurrentWindow().minimize(); } catch (e) {} };
    // Cargar registro guardado
    let cfg = null;
    try { const raw = invoke ? await invoke('cfg_get') : (localStorage.getItem('sp_agent') || ''); if (raw) cfg = JSON.parse(raw); } catch (e) {}
    if (cfg && cfg.id && cfg.token) {
      DEV = { id: cfg.id, token: cfg.token, name: cfg.name || 'Equipo' };
      SERVER = (cfg.server || DEFAULT_SERVER).replace(/\/+$/, ''); SP.base = SERVER;
      startRunning();
    } else {
      $('server').value = DEFAULT_SERVER;
      show('panelSetup');
    }
  }

  function show(id) { ['panelSetup', 'panelRunning'].forEach((p) => $(p).hidden = p !== id); }

  /* ---- registro ---- */
  async function enroll() {
    $('setupErr').hidden = true;
    const tok = $('enroll').value.toUpperCase().replace(/[^A-Z0-9]/g, '');   // acepta guion/espacios/minúsculas
    SERVER = ($('server').value.trim() || DEFAULT_SERVER).replace(/\/+$/, ''); SP.base = SERVER;
    if (!tok) return setupErr('Pega el código de alta.');
    $('btnEnroll').disabled = true;
    try {
      const host = (navigator.userAgentData && navigator.userAgentData.platform) || 'Windows';
      const r = await SP.api('api/agent.php', { action: 'enroll', enroll: tok, os: 'Windows', hostname: host, app_version: window.__APPVER__ || '1.0.0' });
      DEV = { id: r.device_id, token: r.token, name: r.name || 'Equipo', server: SERVER };
      await saveCfg();
      startRunning();
    } catch (e) { setupErr(e.message || 'No se pudo registrar.'); $('btnEnroll').disabled = false; }
  }
  function setupErr(m) { $('setupErr').textContent = m; $('setupErr').hidden = false; }

  async function saveCfg() {
    const data = JSON.stringify({ id: DEV.id, token: DEV.token, name: DEV.name, server: SERVER });
    try { if (invoke) await invoke('cfg_set', { data }); else localStorage.setItem('sp_agent', data); } catch (e) {}
  }

  async function resetDevice() {
    if (!confirm('¿Quitar el registro de este equipo? Dejará de estar disponible para soporte hasta registrarlo de nuevo.')) return;
    try { await SP.api('api/agent.php', { action: 'bye' }); } catch (e) {}
    try { if (invoke) await invoke('cfg_set', { data: '' }); else localStorage.removeItem('sp_agent'); } catch (e) {}
    DEV = null; location.reload();
  }

  /* ---- modo en funcionamiento: latido y espera de conexiones ---- */
  function startRunning() {
    show('panelRunning');
    $('devName').textContent = DEV.name;
    $('devServer').textContent = SERVER.replace(/^https?:\/\//, '');
    setStatus(false, 'Equipo listo · esperando conexiones');
    logLine('Equipo registrado. En espera de soporte.');
    polling = true;
    pollLoop();
    window.addEventListener('beforeunload', () => { try { navigator.sendBeacon && SP.api('api/agent.php', { action: 'bye' }); } catch (e) {} });
  }

  function setStatus(on, txt) {
    $('statusText').textContent = txt;
    $('status').querySelector('.dot').style.background = on ? '#3E7B56' : '#A86A12';
  }

  async function pollLoop() {
    if (!polling) return;
    if (!room && !busy) {
      try {
        const r = await SP.api('api/agent.php', { action: 'poll', hostname: (navigator.userAgentData && navigator.userAgentData.platform) || 'Windows', app_version: window.__APPVER__ || '1.0.0' });
        if (r.connect) { await beginSession(r.connect); }
      } catch (e) {
        if (e.status === 401) { logLine('Este equipo ya no está autorizado. Hay que registrarlo de nuevo.'); polling = false; return resetToSetup(); }
        setStatus(false, 'Sin conexión con el servidor. Reintentando…');
      }
    }
    pollTimer = setTimeout(pollLoop, room ? 8000 : 3000);
  }

  function resetToSetup() { DEV = null; try { if (invoke) invoke('cfg_set', { data: '' }); else localStorage.removeItem('sp_agent'); } catch (e) {} $('enroll').value = ''; $('server').value = SERVER; show('panelSetup'); }

  /* ---- sesión entrante ---- */
  async function beginSession(conn) {
    busy = true; ended = false;
    SESSAUTH = conn.id + ':' + conn.token;
    const who = conn.tech || 'un técnico';
    setStatus(true, 'Conectando con ' + who + '…');
    logLine('Conexión entrante de ' + who + '.');
    room = new SPRoom({ sid: conn.id, role: 'client' });
    room.on('status', (st) => { if (st === 'ended' || st === 'cancelled') return endSession(); });
    room.on('poll', (d) => { if (d.tech && d.tech.name) room.techName = d.tech.name; room.techOnline = d.peer_online; if (room.connected) setStatus(true, 'Soporte en curso con ' + (room.techName || who) + (screen ? ' · viendo la pantalla' : '')); });
    room.on('connected', (v) => { if (v) { room.ctl({ t: 'device', d: 'desktop', app: true, control: true }); room.ctl({ t: 'screen', on: !!screen }); setStatus(true, 'Soporte en curso con ' + (room.techName || who)); logLine('Llamada establecida.'); startShare(false); } });
    room.on('track', (track) => { if (track.kind === 'audio') { $('ra').srcObject = new MediaStream([track]); $('ra').play().catch(() => {}); } });
    room.on('ctl', onCtl);
    room.on('fatal', (m) => logLine('Aviso: ' + m));
    room.start();
    await ensureMic();
  }

  async function endSession() {
    if (ended) return; ended = true;
    if (controlling && invoke) invoke('rc_stop');
    annHide();
    if (screen) { try { screen.stop(); } catch (e) {} screen = null; }
    if (room) { try { room.stop(); } catch (e) {} room = null; }
    SESSAUTH = null; controlling = false; inBuf = [];
    logLine('La sesión terminó.');
    setStatus(false, 'Equipo listo · esperando conexiones');
    busy = false;
  }

  /* ---- voz ---- */
  async function ensureMic() {
    if (mic) return;
    try { const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); mic = s.getAudioTracks()[0]; if (room) await room.setTrack('audio', mic); }
    catch (e) { logLine('Sin micrófono en este equipo (solo pantalla y control).'); }
  }

  /* ---- pantalla: intento automático; si el sistema pide elegir, botón manual ---- */
  async function startShare(manual) {
    if (screen || !room) return;
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 }, displaySurface: 'monitor' }, audio: false });
      const track = s.getVideoTracks()[0]; try { track.contentHint = 'detail'; } catch (e) {}
      screen = track; track.onended = () => { screen = null; annHide(); if (room) { room.setTrack('video', null); room.ctl({ t: 'screen', on: false }); } };
      await room.setTrack('video', track);
      room.ctl({ t: 'screen', on: true });
      $('captureBox').hidden = true;
      logLine('Compartiendo la pantalla.');
      if (room.connected) setStatus(true, 'Soporte en curso · viendo la pantalla');
    } catch (e) {
      // El navegador mostró el selector y nadie eligió: ofrecer botón manual.
      $('captureBox').hidden = false;
      if (!manual) logLine('No se pudo compartir la pantalla automáticamente. Usa «Autorizar captura».');
    }
  }

  /* ---- control remoto: se concede automáticamente (equipo administrado) ---- */
  /* ---- marcas del técnico (puntero y trazos) sobre el escritorio ---- */
  var annReady = null;
  function annShow() { if (!invoke) return Promise.resolve(); if (!annReady) annReady = invoke('ann_show').catch(function (e) { annReady = null; logLine('No se pudo mostrar las marcas: ' + errText(e)); }); return annReady; }
  function annHide() { annReady = null; if (invoke) invoke('ann_hide').catch(function () {}); }
  function annPush(m) { annShow().then(function () { if (invoke) invoke('ann_push', { m: m }).catch(function () {}); }); }

  function onCtl(m) {
    const t = m.t;
    if (t === 'ptr' || t === 'stroke' || t === 'clear') { if (screen) annPush(m); return; }
    if (t === 'rc-request') { grantControl(); return; }
    if (t === 'rc-release') { if (controlling && invoke) invoke('rc_stop'); return; }
    if (t === 'hi' && m.name) { if (room) room.techName = m.name; return; }
    if (controlling && INPUT.has(t)) { queueInput(m); return; }
  }

  async function grantControl() {
    if (!invoke) { if (room) room.ctl({ t: 'rc-denied', why: 'sin soporte nativo' }); return; }
    if (!screen) { await startShare(false); if (!screen) { room.ctl({ t: 'rc-denied', why: 'sin pantalla' }); return; } }
    const dpr = window.devicePixelRatio || 1;
    let sz = null;
    try { sz = await invoke('rc_screen'); } catch (e) { logLine('Aviso: tamaño de pantalla desde el WebView (' + errText(e) + ').'); }
    screenW = (sz && sz[0]) || Math.round(screen.width * dpr) || 1920;
    screenH = (sz && sz[1]) || Math.round(screen.height * dpr) || 1080;
    try { await invoke('rc_start'); }
    catch (e) { room.ctl({ t: 'rc-denied' }); logLine('No se pudo iniciar el control: ' + errText(e)); return; }
    controlling = true;
    room.ctl({ t: 'rc-granted' });
    logLine('El técnico tomó el control del equipo (' + screenW + '×' + screenH + ').');
  }
  function errText(e) { try { return (e && (e.message || (typeof e === 'string' ? e : JSON.stringify(e)))) || 'error desconocido'; } catch (x) { return 'error desconocido'; } }

  function onControlStopped() { controlling = false; inBuf = []; if (room) room.ctl({ t: 'rc-stopped' }); logLine('El control se detuvo.'); }

  function queueInput(m) {
    let ev = null;
    switch (m.t) {
      case 'move': ev = { t: 'move', x: Math.round((m.x || 0) * screenW), y: Math.round((m.y || 0) * screenH) }; break;
      case 'down': case 'up': case 'click': ev = { t: m.t, b: m.b || 'left' }; break;
      case 'wheel': ev = { t: 'wheel', amount: m.amount || 0 }; break;
      case 'text': ev = { t: 'text', text: m.text || '' }; break;
      case 'key': case 'keydown': case 'keyup': ev = { t: m.t, k: m.k || '' }; break;
    }
    if (!ev) return;
    inBuf.push(ev);
    if (!flush) flush = requestAnimationFrame(doFlush);
  }
  function doFlush() { flush = 0; if (!inBuf.length || !controlling) { inBuf = []; return; } const batch = inBuf; inBuf = []; invoke('rc_apply', { events: batch }).catch(() => {}); }
})();
