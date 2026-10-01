// Match native or Web Speech transcripts near the current script position.
// Forward matches advance readily; rereading requires a stronger match.

import { normWord, wordChunks } from './words.js';
import { localMode, nativeVoice } from './environment.js';
import { toast } from './ui.js';
import { platform } from './platform.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export const voiceSupported = nativeVoice || (!!SR && (!localMode || window.isSecureContext));
let nativeTracker = null;
if (nativeVoice) {
  window.efirNative = {
    ...window.efirNative,
    onTranscript(text, isFinal) {
      if (!nativeTracker?.active) return;
      nativeTracker.onTranscript(text);
      nativeTracker._hear(text);
      nativeTracker.onState('hearing');
    },
    onState(state, message) {
      if (!nativeTracker?.active) return;
      nativeTracker.onState(state);
      if (state === 'off' || state === 'denied' || state === 'unsupported') nativeTracker.active = false;
      if (message) toast(message, 'bad');
    },
  };
}

function lev1(a, b) {
  // True when the Levenshtein distance is at most one.
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diff > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return diff + (a.length - i) + (b.length - j) <= 1;
}

function sim(a, b) {
  if (!a || !b) return 0;
  const w = /^[\p{Script=Han}]$/u.test(a) ? 1 : Math.min(1, 0.35 + Math.min(a.length, b.length) * 0.16); // Short words carry less weight.
  if (a === b) return w;
  const m = Math.min(a.length, b.length);
  if (m < 3) return 0;
  // Match Russian word stems.
  let p = 0; while (p < m && a[p] === b[p]) p++;
  if (p >= 4 && p >= m - 2) return 0.8 * w;
  if (m >= 4 && lev1(a, b)) return 0.8 * w;
  return 0;
}

export class VoiceTracker {
  constructor({ onIndex, onState, onTranscript }) {
    this.onIndex = onIndex;
    this.onState = onState || (() => {});
    this.onTranscript = onTranscript || (() => {});
    this.words = [];
    this.cur = 0;
    this.active = false;
    this.rec = null;
    this.lastTail = '';
  }

  setWords(words) { this.words = words; this.cur = Math.min(this.cur, Math.max(0, words.length - 1)); }
  setPosition(i) { this.cur = Math.max(0, i); }

  start(lang) {
    if (!voiceSupported) { this.onState('unsupported'); return; }
    this.lang = lang;
    this.active = true;
    this.lastTail = '';
    if (nativeVoice) {
      nativeTracker = this;
      platform.send('voiceStart', { lang: lang || 'ru-RU' });
    } else this._spawn();
  }

  stop() {
    this.active = false;
    if (nativeTracker === this) {
      platform.send('voiceStop');
      nativeTracker = null;
    }
    if (this.rec) { try { this.rec.abort(); } catch { /* */ } }
    this.rec = null;
    this.onState('off');
  }

  _spawn() {
    if (!this.active) return;
    const rec = new SR();
    this.rec = rec;
    rec.lang = this.lang || 'ru-RU';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onstart = () => this.onState('listening');
    rec.onresult = (e) => {
      const res = e.results;
      const last = res[res.length - 1];
      const prev = res.length > 1 ? res[res.length - 2][0].transcript : '';
      this.onTranscript(last[0].transcript);
      this._hear(prev + ' ' + last[0].transcript);
      this.onState('hearing');
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.active = false;
        this.onState('denied');
      } else if (e.error === 'network') {
        this.onState('network');
      }
    };
    rec.onend = () => {
      if (this.rec !== rec) return;
      // Chrome and Safari may stop after silence; restart recognition.
      if (this.active) setTimeout(() => this._spawn(), 120);
      else this.onState('off');
    };
    try { rec.start(); } catch { setTimeout(() => this._spawn(), 500); }
  }

  _hear(text) {
    const heard = wordChunks(text).map(normWord).filter(Boolean);
    if (!heard.length) return;
    const K = Math.min(heard.length, 6);
    const tail = heard.slice(-K);
    const key = tail.join(' ');
    if (key === this.lastTail) return;
    this.lastTail = key;

    const W = this.words, N = W.length;
    if (!N) return;
    const cur = this.cur;
    const lo = Math.max(0, cur - 50), hi = Math.min(N - 1, cur + 70);
    let best = -1, bestScore = -Infinity, bestRaw = 0;

    for (let j = lo; j <= hi; j++) {
      const anchor = sim(tail[K - 1], W[j]);
      if (anchor < 0.3) continue;
      let score = anchor, si = j - 1, matched = 1;
      for (let k = K - 2; k >= 0 && si >= 0; k--) {
        const a = sim(tail[k], W[si]);
        if (a > 0) { score += a; si--; matched++; continue; }
        const b = si > 0 ? sim(tail[k], W[si - 1]) : 0; // Recognition skipped a word.
        if (b > 0) { score += b * 0.75; si -= 2; matched++; continue; }
        score -= 0.25; // An extra word or filler.
      }
      const d = j - cur;
      const penalty = d >= 0 ? d * 0.012 : 0.4 + (-d) * 0.03;
      const final = score - penalty;
      if (final > bestScore) { bestScore = final; best = j; bestRaw = matched; }
    }
    if (best < 0) return;
    const d = best - cur;
    const oneLongWord = K === 1 || bestRaw === 1;
    const need = d < 0 ? 2.2 : (oneLongWord ? (d <= 3 && W[best].length >= 5 ? 0.9 : 99) : 1.3);
    if (bestScore < need) return;
    this.cur = best;
    this.onIndex(best);
  }
}
