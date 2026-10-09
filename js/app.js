/* HSK 词卡 — screens, routing, session logic. Depends on Store (storage.js) and SRS (srs.js). */
(function () {
  'use strict';

  var LEVELS = [1, 2, 3, 4, 5, 6];
  var REVIEW_MAX = 20;
  var PRACTICE_N = 8;
  var TYPE_LABEL = { 1: '选义 · Meaning', 2: '选词 · Word', 3: '填空 · Fill in', 4: '译句 · Sentence' };
  var TYPE_DIR = { 1: 'zh2id', 2: 'id2zh', 3: 'zh2zh', 4: 'id2zh' };
  var TYPE_GROUP = { 1: 'A', 3: 'A', 2: 'B', 4: 'B' }; // A: Chinese prompt, B: Indonesian prompt
  var KEYS = 'ABCD';

  var app = document.getElementById('app');
  var state = Store.load();
  var data = {};   // level -> dataset
  var sess = null; // active study/review session
  var ui = { open: null, openCh: null, code: '', copyMsg: null, restoreMsg: null, resetArm: 0 };
  var timers = {};
  var enterNext = true; // play the enter animation on the next render (screen change only)

  /* ---------------- utilities ---------------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var x = a[i]; a[i] = a[j]; a[j] = x;
    }
    return a;
  }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function now() { return Date.now(); }
  function pct(a, b) { return b ? Math.round(a / b * 1000) / 10 : 0; }
  function save() { Store.save(state); }
  function target() { return state.settings.target; }
  function occurrences(hay, needle) { return needle ? hay.split(needle).length - 1 : 0; }

  function fmtIn(ts) {
    if (!isFinite(ts)) return '—';
    var d = ts - now();
    if (d <= 0) return 'now';
    var h = d / SRS.HOUR;
    if (h < 1) return Math.max(1, Math.round(d / 60000)) + ' m';
    if (h < 23.5) return Math.round(h) + ' h';
    return Math.round(d / SRS.DAY) + ' d';
  }
  function fmtDays(v) {
    if (v < 1) return Math.max(1, Math.round(v * 24)) + ' h';
    return (v < 10 ? Math.round(v * 10) / 10 : Math.round(v)) + ' d';
  }

  /* ---------------- data ---------------- */

  function prep(d, level) {
    d.level = level;
    d.all = [];
    d.byH = {};
    d.chapters.forEach(function (c) {
      c.words = Array.isArray(c.words) ? c.words : [];
      c.words.forEach(function (w) {
        w._lv = level;
        w._ch = c.n;
        // "sense" distinguishes a second entry of the same characters with another meaning (e.g. 则 m. / 则 conj.)
        w.key = level + '|' + w.h + (w.sense ? '#' + w.sense : '');
        d.all.push(w);
        if (w.h && !d.byH[w.h]) d.byH[w.h] = w;
      });
    });
  }

  function validate(d) {
    var tag = '[HSK 词卡] HSK' + d.level;
    var n = 0, seen = {};
    function warn() {
      n++;
      console.warn.apply(console, [tag].concat([].slice.call(arguments)));
    }
    d.chapters.forEach(function (c) {
      if (typeof c.n !== 'number' || !c.zh || !c.en) warn('chapter is missing n / zh / en:', c);
      c.words.forEach(function (w) {
        var id = '第' + c.n + '课 ' + (w.h || '?');
        ['h', 'py', 'meaning', 's', 't'].forEach(function (f) {
          if (typeof w[f] !== 'string' || !w[f].trim()) warn(id, 'missing field "' + f + '"');
        });
        if (typeof w.pos !== 'string') warn(id, 'missing field "pos"');
        if (w.h && seen[w.key]) warn(id, 'duplicate word in level (add "sense": 2 for a second meaning)');
        seen[w.key] = true;
        if (w.h && typeof w.s === 'string') {
          var k = occurrences(w.s, w.h);
          if (k !== 1) warn(id, 'sentence contains the word ' + k + '× (must be exactly 1):', w.s);
        }
        if (!Array.isArray(w.fd) || w.fd.length !== 3) warn(id, '"fd" must list exactly 3 distractors');
        else w.fd.forEach(function (f) {
          if (f === w.h) warn(id, '"fd" contains the word itself');
          else if (!d.byH[f]) warn(id, '"fd" word not in this level:', f);
        });
        if (w.tw && typeof w.t === 'string' && w.t.indexOf(w.tw) < 0) warn(id, '"tw" not found in translation:', w.tw);
        if (w.syn) w.syn.forEach(function (x) {
          if (!d.byH[x]) warn(id, '"syn" word not in this level:', x);
          if (Array.isArray(w.fd) && w.fd.indexOf(x) >= 0) warn(id, '"fd" contains a synonym:', x);
        });
      });
    });
    if (!n) console.info(tag + ': ' + d.all.length + ' words, no problems found.');
  }

  function fdOk(w) {
    var d = data[w._lv];
    return Array.isArray(w.fd) && w.fd.length === 3 && occurrences(w.s || '', w.h) === 1 &&
      w.fd.every(function (f) { return f !== w.h && d.byH[f]; });
  }

  function level() { return data[state.level]; }
  function card(w) { return state.cards[w.key]; }

  function selected() {
    var d = level();
    var s = (state.sel[state.level] || []).filter(function (n) {
      return d.chapters.some(function (c) { return c.n === n; });
    });
    if (!s.length) s = [d.chapters[0].n];
    state.sel[state.level] = s;
    return s;
  }
  function selWords() {
    var s = selected();
    return level().chapters.filter(function (c) { return s.indexOf(c.n) >= 0; })
      .reduce(function (a, c) { return a.concat(c.words); }, []);
  }
  function newWords() { return selWords().filter(function (w) { return !card(w); }); }
  function learnedWords() { return selWords().filter(function (w) { return !!card(w); }); }
  function dueWords(t) {
    return selWords().filter(function (w) { var c = card(w); return c && c.due <= t; });
  }
  function byRetention(t) {
    return function (a, b) { return SRS.retention(card(a), t) - SRS.retention(card(b), t); };
  }

  /* ---------------- markup helpers ---------------- */

  function tzg(text, size) {
    return '<span class="tzg' + (size ? ' tzg-' + size : '') + '" lang="zh-Hans">' +
      Array.from(text).map(function (ch) { return '<span class="cell"><span>' + esc(ch) + '</span></span>'; }).join('') +
      '</span>';
  }
  /** Words marked "star" (beyond the HSK 5 syllabus, * in the book) carry a red asterisk. */
  function star(w) {
    return w.star ? '<span class="star" aria-label="超纲">*</span>' : '';
  }
  function hw(w, size) {
    return '<span class="hw">' + tzg(w.h, size) + star(w) + '</span>';
  }
  function hlZh(s, h) {
    return esc(s).split(esc(h)).join('<mark>' + esc(h) + '</mark>');
  }
  function blankZh(s, h, fill) {
    var i = s.indexOf(h);
    if (i < 0) return esc(s);
    return esc(s.slice(0, i)) + '<span class="blank">' + (fill ? esc(h) : '&nbsp;') + '</span>' + esc(s.slice(i + h.length));
  }
  function markId(t, tw, hide) {
    var i = tw ? t.indexOf(tw) : -1;
    if (i < 0) return esc(t);
    var mid = hide ? '<span class="blank">&nbsp;</span>' : '<mark>' + esc(tw) + '</mark>';
    return esc(t.slice(0, i)) + mid + esc(t.slice(i + tw.length));
  }
  function posTag(w) {
    return w.pos ? '<span class="pos">' + esc(w.pos) + '</span>' : '';
  }
  /** Two-line button label: Chinese on top, English below. */
  function bl(zh, en) {
    return '<span class="bl"><span class="bl-zh" lang="zh-Hans">' + zh + '</span><span class="bl-en">' + en + '</span></span>';
  }
  function btn(cls, act, zh, en, extra) {
    return '<button type="button" class="btn ' + cls + '" data-act="' + act + '"' + (extra || '') + '>' + bl(zh, en) + '</button>';
  }
  function tags(label, again) {
    if (!label && !again) return '';
    return '<div class="tags">' +
      (label ? '<span class="tag">' + label + '</span>' : '') +
      (again ? '<span class="tag tag-again">再来 · Again</span>' : '') +
      '</div>';
  }
  function exBox(w, zh, id) {
    return '<div class="exbox">' +
      (zh ? '<p class="ex-zh" lang="zh-Hans">' + zh + '</p>' : '') +
      (id ? '<p class="ex-id" lang="id">' + id + '</p>' : '') +
      '</div>';
  }
  function fullEx(w) { return exBox(w, hlZh(w.s, w.h), markId(w.t, w.tw)); }

  function stat(n, label) {
    return '<div class="stat"><b>' + n + '</b><span>' + label + '</span></div>';
  }

  /** Swap in a screen; the enter animation plays only when the screen itself changes. */
  function paint(html) {
    app.innerHTML = html;
    if (enterNext) {
      var m = app.querySelector('.main');
      if (m) m.classList.add('enter');
      enterNext = false;
    }
  }

  /* ---------------- routing ---------------- */

  function render() {
    if (sess) renderSession();
    else if (location.hash === '#/progress') renderProgress();
    else if (location.hash === '#/settings') renderSettings();
    else renderHome();
  }

  function route() {
    sess = null;
    enterNext = true;
    render();
    window.scrollTo(0, 0);
  }

  function goHome() {
    sess = null;
    if (location.hash && location.hash !== '#/') location.hash = '#/';
    else route();
  }

  /* ---------------- home ---------------- */

  function renderHome() {
    var d = level(), sel = selected(), t = now(), tg = target();

    var seg = LEVELS.map(function (l) {
      return '<button type="button" data-act="level" data-v="' + l + '" aria-pressed="' + (l === state.level) + '"' +
        (data[l] ? '' : ' disabled') + '>HSK' + l + '</button>';
    }).join('');

    var tiles = d.chapters.map(function (c) {
      var tot = c.words.length, good = 0, weak = 0;
      c.words.forEach(function (w) {
        var k = card(w);
        if (k) { if (SRS.retention(k, t) >= tg) good++; else weak++; }
      });
      return '<button type="button" class="tile" data-act="chap" data-v="' + c.n + '" aria-pressed="' + (sel.indexOf(c.n) >= 0) + '">' +
        '<span class="tile-top"><span class="tile-n" lang="zh-Hans">第' + c.n + '课</span><span class="check" aria-hidden="true"></span></span>' +
        '<span class="tile-en">' + esc(c.en) + '</span>' +
        '<span class="tile-zh" lang="zh-Hans">' + esc(c.zh) + '</span>' +
        '<span class="tile-foot"><span class="mbar" aria-hidden="true">' +
        '<i class="g" style="width:' + pct(good, tot) + '%"></i><i class="r" style="width:' + pct(weak, tot) + '%"></i></span>' +
        '<span class="tile-count">' + (good + weak) + '/' + tot + '</span></span>' +
        '</button>';
    }).join('');

    var nNew = Math.min(state.settings.newPer, newWords().length);
    var nDue = dueWords(t).length;
    var nLearned = learnedWords().length;

    function mode(cls, act, zh, en, n, on) {
      return '<button type="button" class="mode ' + cls + '" data-act="' + act + '"' + (on ? '' : ' disabled') + '>' +
        '<span class="mode-zh" lang="zh-Hans">' + zh + '</span><span class="mode-en">' + en + '</span>' +
        '<span class="mode-n">' + n + '</span></button>';
    }

    paint(
      '<header class="brand"><div class="seal" aria-hidden="true">忆</div><h1 class="brand-name">HSK 词卡</h1></header>' +
      '<main class="main stack">' +
      '<div class="seg" role="group" aria-label="HSK level">' + seg + '</div>' +
      '<div class="tiles">' + tiles + '</div>' +
      '<div class="modes">' +
      mode('mode-study', 'study', '学习', 'Study', nNew, nNew > 0) +
      (nDue
        ? mode('mode-review', 'review', '复习', 'Review', nDue, true)
        : mode('mode-review', 'review', '练习', 'Practice', Math.min(PRACTICE_N, nLearned), nLearned > 0)) +
      '</div>' +
      '<nav class="links"><a class="link" href="#/progress">进度 · Progress ›</a>' +
      '<a class="link" href="#/settings">设置 · Settings ›</a></nav>' +
      '</main>'
    );
  }

  /* ---------------- sessions ---------------- */

  function newSession(mode, words) {
    return {
      mode: mode, words: words, queue: [], phase: 1, done: 0, barPct: 0,
      item: null, stage: null, knew: false, showEx: false, picked: null, correct: null,
      missed: {}, first: {}, lastType: {}, groups: { A: 0, B: 0 }
    };
  }

  function startStudy() {
    var words = newWords().slice(0, state.settings.newPer);
    if (!words.length) return;
    sess = newSession('study', words);
    // A word's first appearance is always 中→印.
    sess.queue = words.map(function (w) { return { kind: 'card', w: w, dir: 'zh2id' }; });
    advance();
  }

  function startReview() {
    var t = now(), due = dueWords(t), mode = 'review', words;
    if (due.length) {
      words = due.sort(byRetention(t)).slice(0, REVIEW_MAX);
    } else {
      mode = 'practice';
      words = learnedWords().sort(byRetention(t)).slice(0, PRACTICE_N);
    }
    if (!words.length) return;
    sess = newSession(mode, words);
    sess.phase = 2;
    sess.queue = words.map(function (w) { return makeQuiz(w); });
    advance();
  }

  function allowedTypes(w) {
    var c = card(w);
    var full = sess.mode === 'study' || (c && c.reps >= 2);
    return full && fdOk(w) ? [1, 2, 3, 4] : [1, 2];
  }

  /** New quiz item; balances Chinese-prompt vs Indonesian-prompt types, never repeats the word's last type. */
  function makeQuiz(w, avoid) {
    var s = sess;
    var allowed = allowedTypes(w);
    var last = avoid || s.lastType[w.key];
    var pool = allowed.filter(function (t) { return t !== last; });
    if (!pool.length) pool = allowed;
    var g = s.groups.A < s.groups.B ? 'A' : s.groups.B < s.groups.A ? 'B' : (Math.random() < 0.5 ? 'A' : 'B');
    var inGroup = pool.filter(function (t) { return TYPE_GROUP[t] === g; });
    var type = pick(inGroup.length ? inGroup : pool);
    s.groups[TYPE_GROUP[type]]++;
    s.lastType[w.key] = type;
    return { kind: 'quiz', w: w, type: type, again: !!avoid };
  }

  /** Words marked as near-synonyms ("syn") never appear as each other's distractors. */
  function isSyn(a, b) {
    return (a.syn || []).indexOf(b.h) >= 0 || (b.syn || []).indexOf(a.h) >= 0;
  }

  /** Distractors for types 1–2: same chapter first (same POS preferred), then same POS in level. */
  function distractors(w, n) {
    var d = data[w._lv];
    var chapter = d.chapters.filter(function (c) { return c.n === w._ch; })[0];
    var ch = chapter.words.filter(function (x) { return x !== w; });
    var rest = d.all.filter(function (x) { return x._ch !== w._ch; });
    function same(x) { return !!w.pos && x.pos === w.pos; }
    function diff(x) { return !same(x); }
    var order = [].concat(
      shuffle(ch.filter(same)), shuffle(ch.filter(diff)),
      shuffle(rest.filter(same)), shuffle(rest.filter(diff))
    );
    var out = [], seenM = {}, seenH = {};
    seenM[w.meaning] = seenH[w.h] = true;
    for (var i = 0; i < order.length && out.length < n; i++) {
      var x = order[i];
      if (seenM[x.meaning] || seenH[x.h] || isSyn(w, x)) continue;
      seenM[x.meaning] = seenH[x.h] = true;
      out.push(x);
    }
    return out;
  }

  function buildOpts(it) {
    var w = it.w, list;
    if (it.type === 3 || it.type === 4) {
      list = [w].concat(w.fd.map(function (h) { return data[w._lv].byH[h]; }));
    } else {
      list = [w].concat(distractors(w, 3));
    }
    return shuffle(list).map(function (x) {
      return { w: x, label: it.type === 1 ? x.meaning : x.h, ok: x === w };
    });
  }

  function advance() {
    var s = sess;
    if (s.item) s.done++;
    if (!s.queue.length && s.phase === 1) {
      s.phase = 2;
      s.queue = shuffle(s.words).map(function (w) { return makeQuiz(w); });
    }
    s.item = s.queue.shift() || null;
    if (!s.item) { finish(); return; }
    s.stage = s.item.kind === 'card' ? 'front' : 'q';
    s.knew = false;
    s.showEx = false;
    s.picked = null;
    s.correct = null;
    if (s.item.kind === 'quiz') {
      s.item.opts = buildOpts(s.item);
      s.item.t0 = now();
    }
    enterNext = true;
    renderSession();
    window.scrollTo(0, 0);
  }

  function requeueCard() {
    var it = sess.item;
    sess.missed[it.w.key] = true;
    sess.queue.push({ kind: 'card', w: it.w, dir: it.dir === 'zh2id' ? 'id2zh' : 'zh2id', again: true });
  }

  function cardKnow(knew) {
    if (sess.stage !== 'front') return;
    sess.stage = 'back';
    sess.knew = knew;
    if (!knew) requeueCard();
    renderSession();
    focusPrimary();
  }

  function cardGotWrong() {
    if (sess.stage !== 'back' || !sess.knew) return;
    requeueCard();
    advance();
  }

  function answer(i) {
    var s = sess, it = s.item;
    if (!it || it.kind !== 'quiz' || s.stage !== 'q') return;
    var ms = now() - it.t0;
    var ok = i >= 0 && !!it.opts[i].ok;
    s.stage = 'a';
    s.picked = i;
    s.correct = ok;
    state.stats.q++;
    if (ok) state.stats.ok++;
    var key = it.w.key;
    if (!(key in s.first)) s.first[key] = { correct: ok, ms: ms, dir: TYPE_DIR[it.type] };
    if (!ok) {
      s.missed[key] = true;
      s.queue.push(makeQuiz(it.w, it.type));
    }
    save();
    renderSession();
    focusPrimary();
  }

  function finish() {
    var s = sess, t = now(), tg = target();
    if (s.mode === 'study') {
      s.words.forEach(function (w) {
        state.cards[w.key] = SRS.afterStudy(!!s.missed[w.key], t, tg);
      });
    } else if (s.mode === 'review') {
      s.words.forEach(function (w) {
        var f = s.first[w.key], c = card(w);
        if (!f || !c) return;
        var r = SRS.afterReview(c, f, t, tg, state.k);
        state.cards[w.key] = r.card;
        state.log.push({ p: r.predicted, c: f.correct });
      });
      state.k = SRS.calibrate(state.k, state.log);
    }
    save();
    var next = Infinity;
    s.words.forEach(function (w) { var c = card(w); if (c && c.due < next) next = c.due; });
    s.result = {
      n: s.words.length,
      first: s.words.filter(function (w) { return !s.missed[w.key]; }).length,
      next: next,
      missed: s.words.filter(function (w) { return s.missed[w.key]; })
    };
    s.stage = 'done';
    s.item = null;
    enterNext = true;
    renderSession();
    window.scrollTo(0, 0);
    focusPrimary();
  }

  function focusPrimary() {
    var b = app.querySelector('[data-primary]');
    if (b) try { b.focus({ preventScroll: true }); } catch (e) { b.focus(); }
  }

  /* ---------------- session views ---------------- */

  function renderSession() {
    var s = sess;
    if (s.stage === 'done') { renderDone(); return; }
    var total = s.done + 1 + s.queue.length + (s.phase === 1 ? s.words.length : 0);
    var from = s.barPct, to = pct(s.done, total);
    s.barPct = to;
    var top =
      '<div class="sbar">' +
      '<button type="button" class="iconbtn" data-act="quit" aria-label="Quit 退出">' +
      '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button>' +
      '<div class="sprog" role="progressbar" aria-valuemin="0" aria-valuemax="' + total + '" aria-valuenow="' + s.done + '">' +
      '<i style="width:' + from + '%"></i></div>' +
      '<span class="scount">' + s.done + '/' + total + '</span>' +
      '</div>';
    var v = s.item.kind === 'card' ? cardView(s) : quizView(s);
    paint(top + '<main class="main stack">' + v.main + '</main>' + (v.bar ? '<div class="bar">' + v.bar + '</div>' : ''));
    var fill = app.querySelector('.sprog > i');
    if (from !== to) requestAnimationFrame(function () { requestAnimationFrame(function () { fill.style.width = to + '%'; }); });
  }

  function cardView(s) {
    var it = s.item, w = it.w, body, bar;
    if (s.stage === 'front') {
      var ex = '';
      if (s.showEx) {
        ex = it.dir === 'zh2id' ? exBox(w, hlZh(w.s, w.h), '') : exBox(w, '', markId(w.t, w.tw, true));
      }
      body = it.dir === 'zh2id'
        ? hw(w) + '<div class="py">' + esc(w.py) + '</div>'
        : '<div class="prompt-mean" lang="id">' + esc(w.meaning) + star(w) + '</div>' + posTag(w);
      body += '<button type="button" class="expill" data-act="ex" aria-expanded="' + s.showEx + '">例句 · Example</button>' + ex;
      bar = btn('btn-neg', 'dont', '不认识', 'Don’t know') + btn('btn-pos', 'know', '认识', 'Know it');
    } else {
      body = hw(w) + '<div class="py">' + esc(w.py) + '</div>' +
        '<div class="reveal">' + posTag(w) + '<div class="mean" lang="id">' + esc(w.meaning) + '</div>' + fullEx(w) + '</div>';
      bar = s.knew
        ? btn('btn-neg', 'wrong', '记错了', 'Got it wrong') + btn('btn-ink', 'next', '下一个', 'Next', ' data-primary')
        : btn('btn-ink', 'next', '下一个', 'Next', ' data-primary');
    }
    return { main: '<div class="card">' + tags('', it.again) + body + '</div>', bar: bar };
  }

  function quizView(s) {
    var it = s.item, w = it.w, answered = s.stage === 'a';
    var prompt;
    switch (it.type) {
      case 1:
        prompt = hw(w, 'q') + '<div class="py">' + esc(w.py) + '</div>';
        break;
      case 2:
        prompt = '<div class="prompt-mean" lang="id">' + esc(w.meaning) + '</div>' + posTag(w);
        break;
      case 3:
        prompt = '<p class="qtext" lang="zh-Hans">' + blankZh(w.s, w.h, answered) + '</p>';
        break;
      default:
        prompt = '<p class="qsub" lang="id">' + markId(w.t, w.tw) + '</p>' +
          '<p class="qtext" lang="zh-Hans">' + blankZh(w.s, w.h, answered) + '</p>';
    }

    var reveal = '';
    if (answered) {
      var head = it.type === 1 ? '' :
        '<div class="rv-word">' + hw(w, 'sm') + '<div class="py">' + esc(w.py) + '</div></div>';
      reveal = '<div class="reveal">' + head + posTag(w) + '<div class="mean" lang="id">' + esc(w.meaning) + '</div>' + fullEx(w) + '</div>';
    }

    var zhOpts = it.type !== 1;
    var opts = it.opts.map(function (o, i) {
      var cls = 'opt' + (zhOpts ? ' opt-zh' : '');
      if (answered && o.ok) cls += ' ok';
      else if (answered && i === s.picked) cls += ' bad';
      return '<button type="button" class="' + cls + '" data-act="opt" data-v="' + i + '"' + (answered ? ' disabled' : '') +
        (zhOpts ? ' aria-keyshortcuts="' + (i + 1) + '"' : '') + '>' +
        (zhOpts
          ? '<span lang="zh-Hans">' + esc(o.label) + '</span>'
          : '<span class="opt-k" aria-hidden="true">' + KEYS[i] + '</span><span lang="id">' + esc(o.label) + '</span>') +
        '</button>';
    }).join('');

    var main = '<div class="card">' + tags(TYPE_LABEL[it.type], it.again) + prompt + reveal + '</div>' +
      '<div class="opts' + (zhOpts ? ' grid2' : '') + (answered ? ' done' : '') + '">' + opts + '</div>';
    var bar = !answered
      ? btn('btn-plain', 'show', '看答案', 'Show answer')
      : s.correct
        ? btn('btn-pos', 'next', '对了 ✓', 'Correct', ' data-primary')
        : btn('btn-ink', 'next', '下一个', 'Next', ' data-primary');
    return { main: main, bar: bar };
  }

  function renderDone() {
    var r = sess.result;
    var missed = r.missed.length
      ? '<section class="missed"><div class="tags"><span class="tag">再练 · Missed</span></div><div class="chips">' +
        r.missed.map(function (w) {
          return '<span class="chip"><b lang="zh-Hans">' + esc(w.h) + star(w) + '</b><span lang="id">' + esc(w.meaning) + '</span></span>';
        }).join('') + '</div></section>'
      : '';
    paint(
      '<main class="main stack done">' + tzg('完成', 'done') +
      '<div class="stats">' +
      stat(r.n, 'Words 词') + stat(r.first, 'First try 一次对') + stat(fmtIn(r.next), 'Next review 下次') +
      '</div>' + missed + '</main>' +
      '<div class="bar">' + btn('btn-ink', 'home', '返回', 'Back home', ' data-primary') + '</div>'
    );
  }

  /* ---------------- progress ---------------- */

  function curveSvg(c, t, tg) {
    var W = 320, H = 150, L = 34, R = 14, T = 18, B = 24;
    var pw = W - L - R, ph = H - T - B;
    var tstar = SRS.criticalT(c.S, tg);
    var tnow = Math.max(0, (t - c.last) / SRS.DAY);
    var tdue = (c.due - c.last) / SRS.DAY;
    var maxT = Math.max(tstar * 2, tnow * 1.15, tdue * 1.15, 0.5);
    var yMin = Math.max(0, Math.floor(Math.min(SRS.retentionAt(c.S, maxT), tg - 0.1) * 10) / 10);
    function x(v) { return (L + v / maxT * pw).toFixed(1); }
    function y(r) { return (T + (1 - r) / (1 - yMin) * ph).toFixed(1); }
    var pts = [];
    for (var i = 0; i <= 64; i++) {
      var v = maxT * i / 64;
      pts.push(x(v) + ',' + y(SRS.retentionAt(c.S, v)));
    }
    var line = 'M' + pts.join(' L');
    var area = line + ' L' + x(maxT) + ',' + y(yMin) + ' L' + x(0) + ',' + y(yMin) + ' Z';
    var nv = Math.min(tnow, maxT);
    var nowX = x(nv), nowY = y(SRS.retentionAt(c.S, nv));
    var critX = x(tstar), critY = y(tg);
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Forgetting curve 遗忘曲线">' +
      '<path class="c-area" d="' + area + '"/>' +
      '<line class="c-axis" x1="' + L + '" y1="' + y(yMin) + '" x2="' + (W - R) + '" y2="' + y(yMin) + '"/>' +
      '<line class="c-axis" x1="' + L + '" y1="' + T + '" x2="' + L + '" y2="' + y(yMin) + '"/>' +
      '<line class="c-target" x1="' + L + '" y1="' + critY + '" x2="' + (W - R) + '" y2="' + critY + '"/>' +
      '<path class="c-line" d="' + line + '"/>' +
      '<circle class="c-crit" cx="' + critX + '" cy="' + critY + '" r="5"/>' +
      '<text class="t-crit" x="' + critX + '" y="' + (+critY + 17) + '" text-anchor="middle">' + fmtDays(tstar) + '</text>' +
      '<circle class="c-now" cx="' + nowX + '" cy="' + nowY + '" r="6"/>' +
      '<text class="t-now" x="' + nowX + '" y="' + (+nowY - 11) + '" text-anchor="middle">now</text>' +
      '<text x="' + (L - 6) + '" y="' + (T + 4) + '" text-anchor="end">100%</text>' +
      '<text x="' + (L - 6) + '" y="' + (+critY + 4) + '" text-anchor="end">' + Math.round(tg * 100) + '%</text>' +
      '<text x="' + (L - 6) + '" y="' + (+y(yMin) + 4) + '" text-anchor="end">' + Math.round(yMin * 100) + '%</text>' +
      '<text x="' + L + '" y="' + (H - 6) + '" text-anchor="middle">0</text>' +
      '<text x="' + (W - R) + '" y="' + (H - 6) + '" text-anchor="end">' + fmtDays(maxT) + '</text>' +
      '</svg>';
  }

  function pageHead(zh, en) {
    return '<div class="pagehead"><button type="button" class="iconbtn" data-act="home" aria-label="Back 返回">' +
      '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
      '<h1><span lang="zh-Hans">' + zh + '</span> · ' + en + '</h1></div>';
  }

  function renderProgress() {
    var d = level(), t = now(), tg = target();
    // chapters start collapsed except the ones selected on home
    if (!ui.openCh) {
      ui.openCh = {};
      selected().forEach(function (n) { ui.openCh[n] = true; });
    }
    var learned = d.all.filter(function (w) { return !!card(w); });
    var avgR = learned.length
      ? learned.reduce(function (a, w) { return a + SRS.retention(card(w), t); }, 0) / learned.length
      : 0;
    var acc = state.stats.q ? Math.round(state.stats.ok / state.stats.q * 100) + '%' : '—';

    var chapters = d.chapters.map(function (c) {
      var open = !!ui.openCh[c.n];
      var nLearned = c.words.filter(function (w) { return !!card(w); }).length;
      var head = '<button type="button" class="chhead" data-act="chsec" data-v="' + c.n + '" aria-expanded="' + open + '">' +
        '<span class="chn" lang="zh-Hans">第' + c.n + '课</span>' +
        '<span class="chtitle"><span class="chen">' + esc(c.en) + '</span><span class="chzh" lang="zh-Hans">' + esc(c.zh) + '</span></span>' +
        '<span class="chcount">' + nLearned + '/' + c.words.length + '</span>' +
        '<svg class="chev" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</button>';
      if (!open) return '<section class="chsec">' + head + '</section>';
      var rows = c.words.map(function (w) {
        var k = card(w);
        var r = k ? SRS.retention(k, t) : 0;
        var label = !k ? 'new' : k.due <= t ? 'due' : fmtIn(k.due);
        var inner =
          '<span class="w" lang="zh-Hans">' + esc(w.h) + star(w) + '</span>' +
          '<span class="m" lang="id">' + esc(w.meaning) + '</span>' +
          '<span class="rr"><span class="rbar" aria-hidden="true"><i class="' + (r >= tg ? 'g' : 'r') + '" style="width:' + Math.round(r * 100) + '%"></i></span>' +
          '<span class="nx' + (label === 'due' ? ' due' : '') + '">' + label + '</span></span>';
        if (!k) return '<div class="wrow">' + inner + '</div>';
        var open = ui.open === w.key;
        return '<button type="button" class="wrow" data-act="word" data-v="' + esc(w.key) + '" aria-expanded="' + open + '">' + inner + '</button>' +
          (open ? '<div class="curve">' + curveSvg(k, t, tg) + '</div>' : '');
      }).join('');
      return '<section class="chsec">' + head + '<div class="wlist">' + rows + '</div></section>';
    }).join('');

    paint(
      pageHead('进度', 'Progress · HSK ' + state.level) +
      '<main class="main stack">' +
      '<div class="stats">' +
      stat(learned.length, 'Learned 已学') +
      stat(learned.length ? Math.round(avgR * 100) + '%' : '—', 'Retention 记忆度') +
      stat(acc, 'Accuracy 正确率') +
      '</div>' +
      chapters +
      '</main>'
    );
  }

  /* ---------------- settings ---------------- */

  /** Example card for the live curve in settings: a freshly studied word (first review due in 1 day at 90%). */
  function demoCurve(tg) {
    var t = now(), S = SRS.stabilityFor(1, 0.9);
    var c = { S: S, last: t, floor: 0 };
    c.due = SRS.dueOf(c, tg);
    return curveSvg(c, t, tg);
  }

  function renderSettings() {
    var ta = document.getElementById('code');
    if (ta) ui.code = ta.value;
    var tg = target();
    var armed = ui.resetArm && now() - ui.resetArm < 4000;
    var copy = ui.copyMsg || ['复制', 'Copy'];
    var restore = ui.restoreMsg || ['恢复', 'Restore'];

    paint(
      pageHead('设置', 'Settings') +
      '<main class="main stack">' +
      '<h2 class="sec-h">Settings <span lang="zh-Hans">设置</span></h2>' +
      '<section class="panel">' +
      '<div class="field">' +
      '<label class="field-label" for="set-target">Target retention <span lang="zh-Hans">目标记忆度</span> ·</label>' +
      '<output class="field-val" id="out-target" for="set-target">' + Math.round(tg * 100) + '%</output>' +
      '<input id="set-target" type="range" min="80" max="95" step="1" value="' + Math.round(tg * 100) + '" data-set="target">' +
      '<div class="curve curve-demo" id="demo-curve">' + demoCurve(tg) + '</div>' +
      '</div>' +
      '<div class="field">' +
      '<label class="field-label" for="set-new">New words per session <span lang="zh-Hans">每次新词</span> ·</label>' +
      '<output class="field-val" id="out-new" for="set-new">' + state.settings.newPer + '</output>' +
      '<input id="set-new" type="range" min="4" max="20" step="1" value="' + state.settings.newPer + '" data-set="newPer">' +
      '</div>' +
      '</section>' +
      '<h2 class="sec-h">Backup <span lang="zh-Hans">备份</span></h2>' +
      '<section class="panel">' +
      '<textarea id="code" spellcheck="false" autocomplete="off" aria-label="Backup code 备份码">' + esc(ui.code) + '</textarea>' +
      '<div class="row3">' +
      btn('btn-plain btn-sm', 'copy', copy[0], copy[1]) +
      btn('btn-pos btn-sm', 'restore', restore[0], restore[1]) +
      (armed ? btn('btn-danger btn-sm', 'reset', '再点一次', 'Tap again to reset') : btn('btn-neg btn-sm', 'reset', '重置', 'Reset')) +
      '</div></section>' +
      '</main>'
    );
  }

  function onSettings() { return !sess && location.hash === '#/settings'; }

  function flash(key, msg) {
    ui[key] = msg;
    renderSettings();
    clearTimeout(timers[key]);
    timers[key] = setTimeout(function () {
      ui[key] = null;
      if (onSettings()) renderSettings();
    }, 2500);
  }

  function copyCode() {
    var code = Store.encode(state);
    var ta = document.getElementById('code');
    function selectBox() {
      var el = document.getElementById('code');
      if (el) { el.focus(); el.select(); }
      return el;
    }
    function fallback() {
      ui.code = code;
      var copied = false;
      if (selectBox()) {
        try { copied = document.execCommand('copy'); } catch (e) { /* manual copy */ }
      }
      flash('copyMsg', copied ? ['已复制 ✓', 'Copied'] : ['已选中', 'Selected']);
      selectBox();
    }
    if (ta) ta.value = code;
    ui.code = code;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(function () { flash('copyMsg', ['已复制 ✓', 'Copied']); }, fallback);
    } else {
      fallback();
    }
  }

  function restoreCode() {
    var ta = document.getElementById('code');
    var next = Store.decode(ta ? ta.value : '');
    if (!next) { flash('restoreMsg', ['无效', 'Invalid']); return; }
    var lv = state.level;
    state = next;
    if (!data[state.level]) state.level = lv;
    save();
    ui.code = '';
    if (ta) ta.value = '';
    ui.open = null;
    flash('restoreMsg', ['已恢复 ✓', 'Restored']);
  }

  function resetAll() {
    if (ui.resetArm && now() - ui.resetArm < 4000) {
      var lv = state.level;
      state = Store.clear();
      state.level = lv;
      save();
      ui.resetArm = 0;
      ui.open = null;
      ui.code = '';
      var ta = document.getElementById('code');
      if (ta) ta.value = '';
      renderSettings();
      return;
    }
    ui.resetArm = now();
    renderSettings();
    var b = app.querySelector('[data-act="reset"]');
    if (b) b.focus();
    clearTimeout(timers.reset);
    timers.reset = setTimeout(function () {
      ui.resetArm = 0;
      if (onSettings()) renderSettings();
    }, 4000);
  }

  function applySetting(el, commit) {
    var v = +el.value;
    if (el.dataset.set === 'target') {
      state.settings.target = v / 100;
      document.getElementById('out-target').textContent = v + '%';
      var demo = document.getElementById('demo-curve');
      if (demo) demo.innerHTML = demoCurve(state.settings.target);
      Object.keys(state.cards).forEach(function (k) {
        state.cards[k].due = SRS.dueOf(state.cards[k], state.settings.target);
      });
    } else {
      state.settings.newPer = v;
      document.getElementById('out-new').textContent = v;
    }
    if (commit) {
      save();
      var id = el.id;
      renderSettings();
      var again = document.getElementById(id);
      if (again) again.focus({ preventScroll: true });
    }
  }

  /* ---------------- events ---------------- */

  app.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    var v = b.getAttribute('data-v');
    switch (b.getAttribute('data-act')) {
      case 'level':
        state.level = +v; save(); enterNext = true; renderHome(); break;
      case 'chap': {
        var sel = selected().slice(), n = +v, i = sel.indexOf(n);
        if (i >= 0) { if (sel.length > 1) sel.splice(i, 1); }
        else sel.push(n);
        state.sel[state.level] = sel.sort(function (a, c) { return a - c; });
        save(); renderHome(); break;
      }
      case 'study': startStudy(); break;
      case 'review': startReview(); break;
      case 'quit':
      case 'home': goHome(); break;
      case 'ex': sess.showEx = !sess.showEx; renderSession(); break;
      case 'know': cardKnow(true); break;
      case 'dont': cardKnow(false); break;
      case 'wrong': cardGotWrong(); break;
      case 'next': advance(); break;
      case 'opt': answer(+v); break;
      case 'show': answer(-1); break;
      case 'word': ui.open = ui.open === v ? null : v; renderProgress(); break;
      case 'chsec': ui.openCh[v] = !ui.openCh[v]; renderProgress(); break;
      case 'copy': copyCode(); break;
      case 'restore': restoreCode(); break;
      case 'reset': resetAll(); break;
    }
  });

  app.addEventListener('input', function (e) {
    if (e.target.dataset && e.target.dataset.set) applySetting(e.target, false);
  });
  app.addEventListener('change', function (e) {
    if (e.target.dataset && e.target.dataset.set) applySetting(e.target, true);
  });

  document.addEventListener('keydown', function (e) {
    if (!sess || e.metaKey || e.ctrlKey || e.altKey) return;
    var tg = e.target;
    if (tg && (tg.tagName === 'TEXTAREA' || tg.tagName === 'INPUT')) return;
    var s = sess, k = e.key, go = k === 'Enter' || k === ' ';
    if (k === 'Escape') { goHome(); return; }
    if (s.stage === 'done') {
      if (go) { e.preventDefault(); goHome(); }
      return;
    }
    if (s.item.kind === 'card') {
      if (s.stage === 'front') {
        if (k === 'ArrowLeft') { e.preventDefault(); cardKnow(false); }
        else if (k === 'ArrowRight') { e.preventDefault(); cardKnow(true); }
      } else if (go) { e.preventDefault(); advance(); }
      else if (k === 'ArrowLeft' && s.knew) { e.preventDefault(); cardGotWrong(); }
      return;
    }
    if (s.stage === 'q') {
      var i = '1234'.indexOf(k);
      if (i < 0 && k.length === 1) i = 'abcd'.indexOf(k.toLowerCase());
      if (i >= 0 && i < s.item.opts.length) { e.preventDefault(); answer(i); }
    } else if (go) {
      e.preventDefault();
      advance();
    }
  });

  window.addEventListener('hashchange', route);

  /* ---------------- boot ---------------- */

  function boot() {
    var inline = window.HSK_DATA; // optional single-file build: { "5": {...level json...} }
    Promise.all(LEVELS.map(function (l) {
      if (inline) return Promise.resolve(inline[l] || null);
      return fetch('data/hsk' + l + '.json', { cache: 'no-cache' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    })).then(function (list) {
      list.forEach(function (d, i) {
        if (d && Array.isArray(d.chapters) && d.chapters.length) {
          prep(d, LEVELS[i]);
          validate(d);
          data[LEVELS[i]] = d;
        }
      });
      var avail = LEVELS.filter(function (l) { return data[l]; });
      if (!avail.length) {
        app.innerHTML = '<main class="main"><div class="empty">data/hsk*.json</div></main>';
        console.error('[HSK 词卡] No vocabulary loaded. Serve the folder over http (GitHub Pages or a local web server); file:// cannot fetch JSON.');
        return;
      }
      if (!data[state.level]) state.level = avail[0];
      route();
    });
  }

  boot();
})();
