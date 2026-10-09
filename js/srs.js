/* HSK 词卡 — memory model (Ebbinghaus forgetting curve). Pure functions, no DOM. */
(function (root) {
  'use strict';

  var HOUR = 3600000;
  var DAY = 24 * HOUR;
  var WRONG_FLOOR = 12 * HOUR;
  var MIN_S = 0.3;
  var K_MIN = 0.5, K_MAX = 2;
  var CALIBRATION_WINDOW = 40;

  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

  /** R(t) = e^(−t/S), t in days. */
  function retentionAt(S, tDays) {
    return Math.exp(-Math.max(0, tDays) / S);
  }

  /** Predicted retention of a card at time `now` (ms). */
  function retention(card, now) {
    if (!card) return 0;
    return retentionAt(card.S, (now - card.last) / DAY);
  }

  /** Forgetting critical point t* = S · ln(1/target), in days. */
  function criticalT(S, target) {
    return S * Math.log(1 / target);
  }

  /** Stability that puts the critical point exactly `intervalDays` after the last review. */
  function stabilityFor(intervalDays, target) {
    return intervalDays / Math.log(1 / target);
  }

  /** due = last + t*, but never before a lapse floor. */
  function dueOf(card, target) {
    return Math.max(card.last + criticalT(card.S, target) * DAY, card.floor || 0);
  }

  /**
   * Initial card after a study session. The short 5-min / 30-min steps happen inside the
   * session by repetition; the first real review is in 1 day, or 12 h if the word was missed.
   */
  function afterStudy(missed, now, target) {
    var card = {
      S: stabilityFor(missed ? 0.5 : 1, target),
      last: now,
      reps: 0,
      lapses: 0,
      floor: 0
    };
    card.due = dueOf(card, target);
    return card;
  }

  function speedFactor(ms) {
    if (ms < 3000) return 1.6;
    if (ms > 8000) return 0.45;
    return 1.4;
  }

  /**
   * Update after a review, graded by the FIRST attempt.
   * answer = { correct: bool, ms: response time, dir: 'zh2id' | 'id2zh' | 'zh2zh' }
   * Returns { card, predicted } where predicted is R at the moment of review.
   */
  function afterReview(card, answer, now, target, k) {
    var R = retention(card, now);
    var next = {
      S: card.S,
      last: now,
      reps: (card.reps || 0) + 1,
      lapses: card.lapses || 0,
      floor: 0
    };
    if (answer.correct) {
      var f = speedFactor(answer.ms);
      if (answer.dir === 'id2zh') f *= 1.1;
      next.S = card.S * (1 + k * f * Math.exp(1.6 * (1 - R)));
    } else {
      next.S = Math.max(MIN_S, card.S * 0.35);
      next.lapses += 1;
      next.floor = now + WRONG_FLOOR;
    }
    next.due = dueOf(next, target);
    return { card: next, predicted: R };
  }

  /** Personal calibration: k = k · (1 + 0.15 · (actualRate − predictedRate)) over the last 40 reviews. */
  function calibrate(k, log) {
    var recent = (log || []).slice(-CALIBRATION_WINDOW);
    if (!recent.length) return k;
    var actual = 0, predicted = 0;
    for (var i = 0; i < recent.length; i++) {
      actual += recent[i].c ? 1 : 0;
      predicted += recent[i].p;
    }
    actual /= recent.length;
    predicted /= recent.length;
    return clamp(k * (1 + 0.15 * (actual - predicted)), K_MIN, K_MAX);
  }

  var SRS = {
    HOUR: HOUR,
    DAY: DAY,
    retention: retention,
    retentionAt: retentionAt,
    criticalT: criticalT,
    stabilityFor: stabilityFor,
    dueOf: dueOf,
    afterStudy: afterStudy,
    afterReview: afterReview,
    speedFactor: speedFactor,
    calibrate: calibrate
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = SRS;
  else root.SRS = SRS;
})(this);
