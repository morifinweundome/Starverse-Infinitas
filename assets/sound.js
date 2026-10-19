/* Starverse Infinitas · sound. Off until the visitor turns it on; the choice is remembered across pages. */
(function () {
  'use strict';
  var KEY = 'si-sound', POS = 'si-sound-pos-', FADE = 4;
  var DEF = { music: false, fx: false, vol: 0.6 };
  function readPref() { try { return Object.assign({}, DEF, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { return Object.assign({}, DEF); } }
  function savePref() { try { localStorage.setItem(KEY, JSON.stringify(pref)); } catch (e) {} }
  var pref = readPref(), cfg = null, base = 'assets/audio/';
  var ctx = null, master, musicBus, fxBus, decks = [], cur = -1, queue = [], playing = null, mood = null, preview = '', scene = null, host = null;
  var raw = {}, bufs = {}, lastFx = {}, errors = 0, lastSave = 0, ui = {}, me = Math.random().toString(36).slice(2), chan = null;

  /* ---------- engine ---------- */
  function ensureCtx() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = pref.vol; master.connect(ctx.destination);
      musicBus = ctx.createGain(); musicBus.connect(master);
      fxBus = ctx.createGain(); fxBus.gain.value = 0.8; fxBus.connect(master);
      Object.keys(raw).forEach(decode);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function fetchFx() {
    if (!cfg.fx) return;
    Object.keys(cfg.fx).forEach(function (k) {
      if (raw[k] || bufs[k]) return;
      raw[k] = fetch(base + cfg.fx[k]).then(function (r) { if (!r.ok) throw r.status; return r.arrayBuffer(); });
      raw[k].catch(function () {});
      if (ctx) decode(k);
    });
  }
  function decode(k) {
    var p = raw[k]; if (!p) return; delete raw[k];
    p.then(function (ab) { return new Promise(function (ok, no) { ctx.decodeAudioData(ab, ok, no); }); }).then(function (b) { bufs[k] = b; }).catch(function () {});
  }
  function fadeTo(g, v, s) {
    var t = ctx.currentTime; g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(v, t + s);
  }
  function makeDeck() {
    var el = new Audio(); el.crossOrigin = 'anonymous'; el.preload = 'auto';
    var g = ctx.createGain(); g.gain.value = 0;
    ctx.createMediaElementSource(el).connect(g); g.connect(musicBus);
    var d = { el: el, g: g, track: null, fading: false };
    el.addEventListener('timeupdate', function () {
      if (d !== decks[cur] || d.fading) return;
      var len = el.duration;
      if (len && isFinite(len) && len - el.currentTime <= FADE) { next(); return; }
      if (Date.now() - lastSave > 3000) { lastSave = Date.now(); savePos(d); }
    });
    el.addEventListener('playing', function () { if (d === decks[cur]) errors = 0; });
    el.addEventListener('ended', function () { if (d === decks[cur] && !d.fading) next(); });
    el.addEventListener('error', function () {
      if (d !== decks[cur]) return;
      if (++errors < 4) setTimeout(next, 800); else { stopMusic(); nowText('Music unavailable just now'); }
    });
    return d;
  }
  function list(m) { var all = cfg.music || {}; return all[m] || all[Object.keys(all)[0]] || { tracks: [] }; }
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function buildQueue(avoid) {
    var L = list(activeMood()), t = L.tracks.slice(), lead = L.lead ? t.shift() : null;
    shuffle(t);
    if (avoid && t.length > 1 && t[0] === avoid) t.push(t.shift());
    queue = lead ? [lead].concat(t) : t;
    if (queue.length > 1 && queue[0] === avoid) queue.push(queue.shift());
  }
  function next() {
    if (!queue.length) buildQueue(playing);
    var tr = queue.shift(); if (tr) playTrack(tr, 0, FADE);
  }
  function playTrack(tr, at, fade) {
    var ni = cur === 0 ? 1 : 0, nd = decks[ni], od = decks[cur];
    nd.fading = false; nd.track = tr; nd.g.gain.cancelScheduledValues(ctx.currentTime); nd.g.gain.setValueAtTime(0, ctx.currentTime);
    nd.el.src = base + tr[0];
    if (at) nd.el.addEventListener('loadedmetadata', function f() { nd.el.removeEventListener('loadedmetadata', f); try { nd.el.currentTime = at; } catch (e) {} });
    var p = nd.el.play(); if (p && p.catch) p.catch(function () {});
    fadeTo(nd.g, 1, fade);
    if (od && od.track && !od.fading) {
      od.fading = true; fadeTo(od.g, 0, fade);
      setTimeout(function () { if (od.fading) od.el.pause(); }, fade * 1000 + 150);
    }
    cur = ni; playing = tr; nowText(tr[1]); claim();
  }
  function startMusic() {
    if (!cfg.music || !pref.music || !ensureCtx()) return;
    if (!decks.length) decks = [makeDeck(), makeDeck()];
    if (playing && decks[cur] && !decks[cur].el.paused && !decks[cur].fading) return;
    var p = readPos(), tr = p && list(activeMood()).tracks.filter(function (x) { return x[0] === p.src; })[0];
    buildQueue(tr);
    if (tr) { queue = queue.filter(function (x) { return x !== tr; }); playTrack(tr, p.t, 2); }
    else { queue.length ? playTrack(queue.shift(), 0, 2) : null; }
  }
  function stopMusic() {
    decks.forEach(function (d) {
      if (d === decks[cur] && d.track) savePos(d);
      if (!d.fading && d.track) { d.fading = true; fadeTo(d.g, 0, 1.2); setTimeout(function () { if (d.fading) d.el.pause(); }, 1300); }
    });
    playing = null; nowText('');
  }
  function savePos(d) { try { localStorage.setItem(POS + cfg.page, JSON.stringify({ src: d.track[0], t: d.el.currentTime || 0, at: Date.now() })); } catch (e) {} }
  function readPos() {
    try { var p = JSON.parse(localStorage.getItem(POS + cfg.page) || 'null'); return p && Date.now() - p.at < 12 * 3600e3 ? p : null; } catch (e) { return null; }
  }
  function activeMood() { var m = preview || scene || mood; return m && cfg.music && cfg.music[m] ? m : (mood && cfg.music && cfg.music[mood] ? mood : Object.keys(cfg.music || {})[0]); }
  function moodChanged() {
    if (!playing || !pref.music) return;
    queue = [];
    if (list(activeMood()).tracks.indexOf(playing) < 0) { buildQueue(); var tr = queue.shift(); if (tr) playTrack(tr, 0, 3); }
  }
  /* one page plays at a time: whichever was used last */
  function claim() { if (chan) chan.postMessage({ claim: me }); }
  if ('BroadcastChannel' in window) {
    chan = new BroadcastChannel('si-sound');
    chan.onmessage = function (e) {
      if (e.data && e.data.claim && e.data.claim !== me && playing) stopMusic();
      if (e.data && e.data.pref) { pref = readPref(); if (master) master.gain.value = pref.vol; paint(); }
    };
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && cfg && pref.music && cfg.music && !playing && ctx) startMusic();
  });

  function fx(name) {
    if (!cfg || !pref.fx) return;
    if (!ctx || ctx.state !== 'running') { ensureCtx(); if (!ctx || ctx.state !== 'running') return; }
    var b = bufs[name]; if (!b) return;
    var now = performance.now(), gap = name === 'hover' ? 90 : 40;
    if (lastFx[name] && now - lastFx[name] < gap) return;
    lastFx[name] = now;
    var s = ctx.createBufferSource(), g = ctx.createGain();
    s.buffer = b; g.gain.value = (cfg.fxGain && cfg.fxGain[name]) || 1;
    s.connect(g); g.connect(fxBus); s.start();
  }

  /* ---------- control ---------- */
  var ICON_ON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16 8.5a4.5 4.5 0 0 1 0 7M18.5 6a8 8 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  var ICON_OFF = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  var CSS = '.si-snd{position:fixed;right:18px;bottom:18px;z-index:40;font:13px/1.4 Lato,"Segoe UI",system-ui,sans-serif;color:#D3DEEA}' +
    '.si-snd.inline{position:relative;right:auto;bottom:auto;z-index:auto;margin-left:auto}' +
    '.si-snd-b{width:44px;height:44px;border-radius:50%;border:1px solid #2C4A68;background:rgba(8,14,24,.9);color:#8FB3D4;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}' +
    '.si-snd.inline .si-snd-b{width:26px;height:26px;background:transparent;border-color:#1B2D44}.si-snd.inline .si-snd-b svg{width:15px;height:15px}' +
    '.si-snd-b:hover,.si-snd-b[aria-expanded=true]{color:#E8F0F8;border-color:#8FB3D4}.si-snd-b.on{color:#B9D3EA}' +
    '.si-snd-p{position:absolute;right:0;bottom:54px;width:250px;padding:14px 14px 12px;border-radius:12px;border:1px solid #1B2D44;background:rgba(10,17,28,.97);box-shadow:0 12px 40px rgba(0,0,0,.5)}' +
    '.si-snd.inline .si-snd-p{bottom:auto;top:34px;right:-6px}' +
    '.si-snd-p[hidden]{display:none}' +
    '.si-snd-p h4{margin:0 0 10px;font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:#8FB3D4}' +
    '.si-snd-r{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:5px 0}' +
    '.si-sw{width:38px;height:22px;border-radius:999px;border:1px solid #2C4A68;background:#0C1420;position:relative;cursor:pointer;padding:0;flex:none}' +
    '.si-sw i{position:absolute;top:3px;left:3px;width:14px;height:14px;border-radius:50%;background:#4a6280;transition:left .15s,background .15s}' +
    '.si-sw[aria-checked=true]{border-color:#8FB3D4;background:#13233A}.si-sw[aria-checked=true] i{left:19px;background:#E8F0F8}' +
    '.si-snd-p input[type=range]{width:120px;accent-color:#8FB3D4}' +
    '.si-now{margin-top:8px;padding-top:9px;border-top:1px solid #1B2D44;display:flex;align-items:center;gap:8px;font-size:12px;color:#7F95AB;min-height:22px}' +
    '.si-now .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#B9D3EA;font-style:italic}' +
    '.si-now button,.si-snd-p select{background:#0C1420;border:1px solid #2C4A68;border-radius:6px;color:#B9D3EA;font:inherit;font-size:12px;padding:2px 8px;cursor:pointer}' +
    '@media (max-width:760px){.si-snd{right:12px;bottom:12px}.si-snd-p{width:min(250px,calc(100vw - 24px))}}';

  function el(h) { var d = document.createElement('div'); d.innerHTML = h; return d.firstChild; }
  function mount() {
    var st = document.createElement('style'); st.textContent = CSS + (cfg.css || ''); document.head.appendChild(st);
    var host = cfg.mount ? document.querySelector(cfg.mount) : null;
    var w = el('<div class="si-snd' + (host ? ' inline' : '') + '" data-nofx></div>');
    w.innerHTML = '<button class="si-snd-b" aria-label="Sound" aria-expanded="false" title="Sound"></button>' +
      '<div class="si-snd-p" hidden role="dialog" aria-label="Sound"><h4>Sound</h4>' +
      (cfg.music ? '<div class="si-snd-r"><span>Music</span><button class="si-sw" role="switch" aria-checked="false" data-k="music" aria-label="Music"><i></i></button></div>' : '') +
      (cfg.fx ? '<div class="si-snd-r"><span>Effects</span><button class="si-sw" role="switch" aria-checked="false" data-k="fx" aria-label="Effects"><i></i></button></div>' : '') +
      '<div class="si-snd-r"><span>Volume</span><input type="range" min="0" max="100" aria-label="Volume"></div>' +
      (cfg.music ? '<div class="si-now"><span class="t"></span><button class="nx" title="Next track">Next ›</button></div>' : '') +
      (cfg.moodPicker ? '<div class="si-snd-r"><span>Preview</span><select aria-label="Preview soundtrack"><option value="">As the galaxy stands</option><option value="calm">Calm</option><option value="crisis">Crisis</option><option value="war">War</option></select></div>' : '') +
      '</div>';
    (host || document.body).appendChild(w);
    ui.w = w; ui.b = w.querySelector('.si-snd-b'); ui.p = w.querySelector('.si-snd-p');
    ui.vol = w.querySelector('input[type=range]'); ui.now = w.querySelector('.si-now .t');
    ui.b.onclick = function (e) { e.stopPropagation(); var open = ui.p.hidden; ui.p.hidden = !open; ui.b.setAttribute('aria-expanded', open); };
    document.addEventListener('click', function (e) { if (!ui.p.hidden && !w.contains(e.target)) { ui.p.hidden = true; ui.b.setAttribute('aria-expanded', 'false'); } });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !ui.p.hidden) { ui.p.hidden = true; ui.b.setAttribute('aria-expanded', 'false'); } });
    w.querySelectorAll('.si-sw').forEach(function (s) {
      s.onclick = function () {
        var k = s.dataset.k; pref[k] = !pref[k]; savePref(); if (chan) chan.postMessage({ pref: 1 });
        ensureCtx(); fetchFx();
        if (k === 'music') { if (pref.music) startMusic(); else stopMusic(); }
        if (k === 'fx' && pref.fx) setTimeout(function () { fx('button'); }, 60);
        paint();
      };
    });
    ui.vol.oninput = function () { pref.vol = ui.vol.value / 100; if (master) master.gain.value = pref.vol; };
    ui.vol.onchange = function () { savePref(); if (chan) chan.postMessage({ pref: 1 }); };
    var nx = w.querySelector('.nx'); if (nx) nx.onclick = function () { if (playing) next(); else { pref.music = true; savePref(); startMusic(); paint(); } };
    var sel = w.querySelector('select'); if (sel) sel.onchange = function () { preview = sel.value; moodChanged(); };
    paint();
  }
  function paint() {
    if (!ui.w) return;
    var any = (cfg.music && pref.music) || (cfg.fx && pref.fx);
    ui.b.innerHTML = any ? ICON_ON : ICON_OFF; ui.b.classList.toggle('on', !!any);
    ui.w.querySelectorAll('.si-sw').forEach(function (s) { s.setAttribute('aria-checked', !!pref[s.dataset.k]); });
    ui.vol.value = Math.round(pref.vol * 100);
    nowText(playing ? playing[1] : '');
  }
  function nowText(t) { if (ui.now) ui.now.textContent = t || (pref.music ? 'Begins at your next click' : 'Music is off'); }

  /* ---------- inside the main menu: the host page plays everything ---------- */
  try { if (window.parent !== window && window.parent.SIShell) host = window.parent; } catch (e) { host = null; }
  var PAGES = { '': 'menu', 'index.html': 'menu', 'rules.html': 'rules', 'map.html': 'map', 'standings.html': 'standings', 'archives.html': 'archives', 'herald.html': 'herald' };
  var SHELL_CSS = '.in-shell header.top{display:none!important}.in-shell .links{display:none!important}';
  function embed(o) {
    document.documentElement.classList.add('in-shell');
    var st = document.createElement('style'); st.textContent = SHELL_CSS + (o.shellCss || ''); (document.head || document.documentElement).appendChild(st);
    var back = function () { var b = document.getElementById('back'); if (b) b.innerHTML = '<a href="./">‹ Main menu</a>'; };
    if (document.body) back(); else document.addEventListener('DOMContentLoaded', back);
    document.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target && e.target.closest && e.target.closest('a[href]'); if (!a) return;
      var u; try { u = new URL(a.getAttribute('href'), location.href); } catch (x) { return; }
      if (u.origin !== location.origin) return;
      var dir = location.pathname.replace(/[^\/]*$/, ''); if (u.pathname.indexOf(dir) !== 0) return;
      var file = u.pathname.slice(dir.length); if (!(file in PAGES)) return;
      var pg = PAGES[file];
      if (pg === o.page) { if (a.target) { e.preventDefault(); location.hash = u.hash; } return; }
      e.preventDefault(); host.SIShell.go(pg, u.hash.slice(1));
    }, true);
    addEventListener('hashchange', function () { host.SIShell.sync(o.page, location.hash.slice(1)); });
    if (o.page !== 'map' && o.page !== 'rules') addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !e.defaultPrevented && !/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName)) host.SIShell.go('menu');
    });
    if (o.buttons) document.addEventListener('click', function (e) {
      var t = e.target && e.target.closest && e.target.closest(o.buttons === true ? 'button,a[href],[role=tab],[role=button],summary,select' : o.buttons);
      if (t && !t.closest('[data-nofx]')) host.SISound.fx('button');
    }, true);
  }

  /* ---------- public ---------- */
  window.SISound = {
    init: function (o) {
      cfg = o; if (o.base) base = o.base; mood = o.mood || null;
      if (host) { embed(o); return; }
      if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
      if (pref.fx) fetchFx();
      var unlock = function () {
        removeEventListener('pointerdown', unlock, true); removeEventListener('keydown', unlock, true);
        if (pref.fx || pref.music) { ensureCtx(); fetchFx(); }
        if (pref.music) startMusic();
      };
      addEventListener('pointerdown', unlock, true); addEventListener('keydown', unlock, true);
      if (o.buttons) document.addEventListener('click', function (e) {
        var t = e.target && e.target.closest && e.target.closest(o.buttons === true ? 'button,a[href],[role=tab],[role=button],summary,select' : o.buttons);
        if (t && !t.closest('[data-nofx]')) fx('button');
      }, true);
    },
    fx: function (n) { if (host) host.SISound.fx(n); else fx(n); },
    setMood: function (m) { if (host || !m || m === mood) return; var was = activeMood(); mood = m; if (activeMood() !== was) moodChanged(); },
    setScene: function (s) { if (host) return; var was = activeMood(); scene = s || null; if (activeMood() !== was) moodChanged(); },
    setPref: function (o) {
      if (host) return; Object.assign(pref, o); savePref(); if (chan) chan.postMessage({ pref: 1 });
      if (pref.music || pref.fx) { ensureCtx(); fetchFx(); }
      if (pref.music) startMusic(); else if (playing) stopMusic();
      paint();
    },
    get pref() { return Object.assign({}, pref); },
    get mood() { return activeMood(); },
    get state() { var d = decks[cur]; return { mood: activeMood(), track: playing && playing[1], time: d ? d.el.currentTime : 0, paused: d ? d.el.paused : true, ctx: ctx && ctx.state, fx: Object.keys(bufs), pref: pref }; }
  };
})();
