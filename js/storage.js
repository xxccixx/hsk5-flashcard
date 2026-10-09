/* HSK 词卡 — persistence (localStorage) and backup codes. */
(function (root) {
  'use strict';

  var KEY = 'hsk-cika.v1';
  var LOG_MAX = 200;

  function defaults() {
    return {
      v: 1,
      settings: { target: 0.9, newPer: 8 },
      level: null,
      sel: {},          // level -> [chapter numbers]
      cards: {},        // "level|word" -> { S, last, due, reps, lapses, floor }
      k: 1,             // personal calibration
      log: [],          // [{ p: predicted R, c: correct }]
      stats: { q: 0, ok: 0 }
    };
  }

  function num(x, lo, hi, fallback) {
    return typeof x === 'number' && isFinite(x) && x >= lo && x <= hi ? x : fallback;
  }

  function normalize(o) {
    var d = defaults();
    if (!o || typeof o !== 'object') return d;
    var s = o.settings || {};
    d.settings.target = num(s.target, 0.8, 0.95, 0.9);
    d.settings.newPer = Math.round(num(s.newPer, 4, 20, 8));
    d.level = typeof o.level === 'number' ? o.level : null;
    if (o.sel && typeof o.sel === 'object') {
      Object.keys(o.sel).forEach(function (lv) {
        if (Array.isArray(o.sel[lv])) d.sel[lv] = o.sel[lv].filter(function (n) { return typeof n === 'number'; });
      });
    }
    if (o.cards && typeof o.cards === 'object') {
      Object.keys(o.cards).forEach(function (key) {
        var c = o.cards[key];
        if (c && typeof c.S === 'number' && c.S > 0 && typeof c.last === 'number') {
          d.cards[key] = {
            S: c.S,
            last: c.last,
            due: typeof c.due === 'number' ? c.due : c.last,
            reps: c.reps | 0,
            lapses: c.lapses | 0,
            floor: typeof c.floor === 'number' ? c.floor : 0
          };
        }
      });
    }
    d.k = num(o.k, 0.5, 2, 1);
    if (Array.isArray(o.log)) {
      d.log = o.log.filter(function (e) { return e && typeof e.p === 'number'; })
        .slice(-LOG_MAX).map(function (e) { return { p: e.p, c: !!e.c }; });
    }
    if (o.stats) {
      d.stats.q = Math.max(0, o.stats.q | 0);
      d.stats.ok = Math.min(d.stats.q, Math.max(0, o.stats.ok | 0));
    }
    return d;
  }

  function load() {
    try {
      var raw = root.localStorage.getItem(KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) { /* storage blocked or corrupt */ }
    return defaults();
  }

  function save(state) {
    try {
      if (state.log.length > LOG_MAX) state.log = state.log.slice(-LOG_MAX);
      root.localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      return false;
    }
  }

  function clear() {
    try { root.localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    return defaults();
  }

  // UTF-8 safe base64
  function encode(state) {
    var bytes = new TextEncoder().encode(JSON.stringify(state));
    var bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  /** Returns a normalized state, or null if the code is invalid. */
  function decode(code) {
    try {
      var bin = atob(String(code).replace(/\s+/g, ''));
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var o = JSON.parse(new TextDecoder().decode(bytes));
      if (!o || typeof o !== 'object' || typeof o.cards !== 'object') return null;
      return normalize(o);
    } catch (e) {
      return null;
    }
  }

  root.Store = { load: load, save: save, clear: clear, encode: encode, decode: decode, defaults: defaults };
})(this);
