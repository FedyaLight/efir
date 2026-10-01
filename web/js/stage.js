import { t, translateUI, onLanguageChange } from './i18n.js';
import { normWord, wordChunks } from './words.js';
import { localMode } from './environment.js';
export { normWord } from './words.js';
// Stage renders both the reader and controller preview. The preview uses
// the reader's CSS dimensions before scaling, keeping line breaks, padding
// and text positions aligned.

const esc = (s) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function parseScript(text) {
  const words = [];
  const sections = [];
  const out = [];
  const blocks = (text || '').replace(/\r\n?/g, '\n').split(/\n{2,}/);

  const wrapWords = (seg) => wordChunks(seg).map(chunk => {
    if (!chunk) return '';
    if (/^\s+$/.test(chunk)) return ' ';
    const n = normWord(chunk);
    if (!n) return esc(chunk);
    const i = words.push(n) - 1;
    return `<span class="w" data-i="${i}">${esc(chunk)}</span>`;
  }).join('');

  const inline = (line) => line.split(/(\[[^\]]*\]|\*\*[^*]+\*\*)/).map(seg => {
    if (!seg) return '';
    if (seg.startsWith('[') && seg.endsWith(']')) return `<span class="note">${esc(seg)}</span>`;
    if (seg.startsWith('**') && seg.endsWith('**')) return `<strong>${wrapWords(seg.slice(2, -2))}</strong>`;
    return wrapWords(seg);
  }).join('');

  for (const block of blocks) {
    const lines = block.split('\n');
    let para = [];
    const flush = () => {
      if (para.length) out.push(`<p>${para.join('<br>')}</p>`);
      para = [];
    };
    for (const raw of lines) {
      const line = raw.trimEnd();
      const m = line.match(/^\s*#+\s*(.*)$/);
      if (m) {
        flush();
        const k = sections.length;
        sections.push({ title: m[1] || t('Раздел'), word: words.length });
        out.push(`<h2 class="sec" data-s="${k}">${esc(m[1] || '')}</h2>`);
      } else if (line.trim()) {
        para.push(inline(line));
      }
    }
    flush();
  }
  if (!out.length) out.push(`<p class="empty">${esc(t('Текст пуст — откройте редактор на пульте.'))}</p>`);
  return { html: out.join(''), words, sections };
}

export class Stage {
  constructor(host, { fill = false } = {}) {
    this.fill = fill;
    this.el = document.createElement('div');
    this.el.className = 'stage';
    this.el.innerHTML = `
      <div class="stage-inner">
        <div class="scroller"><div class="text"></div></div>
        <div class="fade fade-top"></div><div class="fade fade-bottom"></div>
        <div class="marker"><i class="arrow l"></i><i class="bar"></i><i class="arrow r"></i></div>
        <div class="hud">
          <div class="hud-time"><span class="el">0:00</span><span class="rm">−0:00</span></div>
          <div class="hud-progress"><i></i></div>
        </div>
        <div class="countdown"><div class="cd-ring"></div><span></span></div>
        <div class="paused-tag">ПАУЗА</div>
        <div class="voice-tag"><i></i>ГОЛОС</div>
      </div>`;
    host.appendChild(this.el);
    this.releaseTranslation = translateUI(this.el);
    this.releaseLanguage = onLanguageChange(() => {
      const empty = this.el.querySelector('.empty');
      if (empty) empty.textContent = t('Текст пуст — откройте редактор на пульте.');
    });
    this.inner = this.el.querySelector('.stage-inner');
    this.scroller = this.el.querySelector('.scroller');
    this.text = this.el.querySelector('.text');
    this.text.dir = 'auto';
    this.hudEl = this.el.querySelector('.el');
    this.hudRm = this.el.querySelector('.rm');
    this.hudBar = this.el.querySelector('.hud-progress i');
    this.cd = this.el.querySelector('.countdown');
    this.cdNum = this.cd.querySelector('span');
    this.w = 0; this.h = 0;
    this.s = null;
    this.words = [];
    this.sections = [];
    this.tops = null;
    this.max = 0;
    this.readIdx = -1;
    this.showMirror = true;
    this._lastCd = null;

    if (fill) {
      this.resizeObserver = new ResizeObserver(() => this.setViewport(host.clientWidth, host.clientHeight));
      this.resizeObserver.observe(host);
      this.setViewport(host.clientWidth, host.clientHeight);
    }
    // Remeasure when fonts finish loading.
    if (document.fonts) {
      this.fontsLoaded = () => this.invalidate();
      document.fonts.addEventListener('loadingdone', this.fontsLoaded);
      document.fonts.ready.then(this.fontsLoaded);
    }
  }

  setViewport(w, h) {
    w = Math.round(w); h = Math.round(h);
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.el.style.width = w + 'px';
    this.el.style.height = h + 'px';
    this._applyVars();
    this.invalidate();
  }

  setSettings(s) {
    const changedFont = !this.s || this.s.fontFamily !== s.fontFamily || this.s.fontWeight !== s.fontWeight;
    this.s = { ...s };
    if (changedFont && document.fonts) {
      document.fonts.load(`${s.fontWeight} ${s.fontSize}px "${s.fontFamily}"`, 'Эфир ABC').then(() => this.invalidate()).catch(() => {});
    }
    this._applyVars();
    this.invalidate();
  }

  setScript(text) {
    const p = parseScript(text);
    this.text.lang = /\p{Script=Han}/u.test(text) ? 'zh-Hans' : /\p{Script=Devanagari}/u.test(text) ? 'hi' : /\p{Script=Arabic}/u.test(text) ? 'ar' : 'und';
    this.text.innerHTML = p.html;
    this.words = p.words;
    this.sections = p.sections;
    this.wordEls = this.text.querySelectorAll('.w');
    this.readIdx = -1;
    this.invalidate();
  }

  _applyVars() {
    const s = this.s; if (!s) return;
    const st = this.el.style;
    const fontStack = `'${s.fontFamily}', 'Noto Sans Arabic', 'Noto Sans Devanagari', 'Noto Sans SC', ${/Merriweather|Slab/.test(s.fontFamily) ? 'Georgia, serif' : /Mono/.test(s.fontFamily) ? 'monospace' : 'system-ui, sans-serif'}`;
    st.setProperty('--u', (Math.min(this.w, this.h * 1.6) / 100) + 'px');
    st.setProperty('--fs', s.fontSize + 'px');
    st.setProperty('--ff', fontStack);
    st.setProperty('--fw', s.fontWeight);
    st.setProperty('--lh', s.lineHeight);
    if (localMode) {
      // WebKit and Chromium round fractional line heights differently.
      // Whole pixels prevent accumulated drift in long scripts.
      const section = Math.round(s.fontSize * .4);
      st.setProperty('--line', Math.round(s.fontSize * s.lineHeight) + 'px');
      st.setProperty('--paragraph-gap', Math.round(s.fontSize * .55) + 'px');
      st.setProperty('--section-font', section + 'px');
      st.setProperty('--section-line', Math.round(section * 1.3) + 'px');
      st.setProperty('--section-top', Math.round(section * 1.1) + 'px');
      st.setProperty('--section-gap', Math.round(section * .55) + 'px');
      st.setProperty('--section-border', Math.max(1, Math.round(section * .08)) + 'px');
    }
    st.setProperty('--ls', s.letterSpacing + 'em');
    st.setProperty('--tc', s.textColor);
    st.setProperty('--bg', s.bgColor);
    st.setProperty('--ac', s.accentColor);
    st.setProperty('--nc', s.noteColor);
    st.setProperty('--mc', s.markerColor);
    st.setProperty('--side', (s.sidePad * this.w / 100) + 'px');
    st.setProperty('--top', (s.topPad * this.h / 100) + 'px');
    st.setProperty('--bottom', (s.bottomPad * this.h / 100) + 'px');
    st.setProperty('--my', (s.markerPos * this.h / 100) + 'px');
    st.setProperty('--align', s.align);
    const cls = this.el.classList;
    cls.toggle('upper', !!s.uppercase);
    cls.toggle('no-marker', !s.marker);
    cls.toggle('no-fade', !s.fade);
    cls.toggle('no-progress', !s.showProgress);
    cls.toggle('no-timer', !s.showTimer);
    cls.toggle('no-dim', !s.dimRead);
    cls.remove('m-band', 'm-line', 'm-arrows');
    cls.add('m-' + s.markerStyle);
    this._applyMirror();
  }

  setShowMirror(v) { this.showMirror = v; this._applyMirror(); }

  _applyMirror() {
    const s = this.s; if (!s) return;
    const sx = s.mirrorH && this.showMirror ? -1 : 1;
    const sy = s.mirrorV && this.showMirror ? -1 : 1;
    this.inner.style.transform = (sx !== 1 || sy !== 1) ? `scale(${sx}, ${sy})` : '';
  }

  invalidate() {
    if (this.dead) return;
    this.tops = null; this._measured = false;
    this.onInvalidate?.();
  }

  destroy() { this.releaseTranslation(); this.releaseLanguage();
    this.dead = true;
    this.resizeObserver?.disconnect();
    if (this.fontsLoaded) document.fonts.removeEventListener('loadingdone', this.fontsLoaded);
    this.onInvalidate = null;
  }

  measure() {
    if (this._measured) return;
    this._measured = true;
    this.max = Math.max(0, this.text.offsetHeight - this.h);
    const n = this.wordEls ? this.wordEls.length : 0;
    this.tops = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const e = this.wordEls[i];
      this.tops[i] = e.offsetTop + e.offsetHeight / 2;
    }
    this.secTops = [...this.text.querySelectorAll('.sec')].map(e => e.offsetTop);
  }

  get markerY() { return (this.s ? this.s.markerPos : 40) * this.h / 100; }

  pxPerSec(speed) {
    const s = this.s || { fontSize: 64, lineHeight: 1.4 };
    // Speed 1 is about 0.12 lines per second, independent of font size.
    return speed * s.fontSize * s.lineHeight * 0.12;
  }

  posForWord(i) {
    this.measure();
    if (!this.tops.length) return 0;
    i = Math.max(0, Math.min(this.tops.length - 1, i));
    return this.clamp(this.tops[i] - this.markerY);
  }

  posForSection(k) {
    this.measure();
    const t = this.secTops[k];
    if (t == null) return 0;
    return this.clamp(t - this.markerY + (this.s ? this.s.fontSize * 0.3 : 0));
  }

  sectionAt(pos) {
    this.measure();
    const y = pos + this.markerY + 2;
    let k = -1;
    for (let i = 0; i < this.secTops.length; i++) if (this.secTops[i] <= y) k = i;
    return k;
  }

  // Target position for previous/next section.
  sectionStep(pos, dir) {
    this.measure();
    const n = this.secTops.length;
    if (!n) return dir > 0 ? this.max : 0;
    const k = this.sectionAt(pos);
    let t;
    if (dir > 0) t = Math.min(n - 1, k + 1);
    else t = k >= 0 && pos - this.posForSection(k) > (this.s ? this.s.fontSize * 1.2 : 60) ? k : Math.max(0, k - 1);
    if (dir < 0 && k <= 0 && t === 0 && pos - this.posForSection(0) <= (this.s ? this.s.fontSize * 1.2 : 60)) return 0;
    return this.posForSection(t);
  }

  wordAt(pos) {
    this.measure();
    const t = this.tops; if (!t.length) return 0;
    const y = pos + this.markerY;
    let lo = 0, hi = t.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (t[mid] < y - 4) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  clamp(p) { this.measure(); return Math.max(0, Math.min(this.max, p)); }

  setRead(idx) {
    if (!this.wordEls || idx === this.readIdx) return;
    const a = Math.min(idx, this.readIdx), b = Math.max(idx, this.readIdx);
    for (let i = Math.max(0, a + 1); i <= b && i < this.wordEls.length; i++) {
      this.wordEls[i].classList.toggle('read', i <= idx);
    }
    if (this.readIdx >= 0 && this.wordEls[this.readIdx]) this.wordEls[this.readIdx].classList.remove('now');
    if (idx >= 0 && this.wordEls[idx]) this.wordEls[idx].classList.add('now');
    if (idx < 0) this.wordEls.forEach(e => e.classList.remove('read', 'now'));
    this.readIdx = idx;
  }

  render(st) {
    this.measure();
    const pos = Math.max(0, Math.min(this.max, st.pos));
    const offset = pos.toFixed(2);
    if (offset !== this._lastOffset) {
      this._lastOffset = offset;
      this.scroller.style.transform = `translate3d(0, ${-offset}px, 0)`;
    }
    const cls = this.el.classList;
    cls.toggle('is-paused', !st.playing && st.mode !== 'voice' && pos > 1);
    cls.toggle('is-voice', st.mode === 'voice');
    cls.toggle('voice-live', !!st.voiceLive);

    // Countdown
    const cd = st.cd > 0 ? Math.ceil(st.cd) : 0;
    if (cd !== this._lastCd) {
      this._lastCd = cd;
      cls.toggle('is-counting', cd > 0);
      if (cd > 0) {
        this.cdNum.textContent = cd;
        this.cd.classList.remove('tick'); void this.cd.offsetWidth; this.cd.classList.add('tick');
      }
    }

    // HUD
    const pps = this.pxPerSec(st.speed || 1);
    const elapsed = pos / pps, remain = (this.max - pos) / pps;
    const t = fmt(elapsed), r = '−' + fmt(remain);
    if (this.hudEl.textContent !== t) this.hudEl.textContent = t;
    if (this.hudRm.textContent !== r) this.hudRm.textContent = r;
    const progress = this.max ? pos / this.max : 0;
    if (progress !== this._lastProgress) {
      this._lastProgress = progress;
      this.hudBar.style.transform = `scaleX(${progress})`;
    }
    return pos;
  }
}

export function fmt(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  sec = Math.round(sec);
  const m = Math.floor(sec / 60), s = sec % 60;
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

// Scrolling state and motion shared by the reader and controller preview.
export class Engine {
  constructor(stage) {
    this.stage = stage;
    this.pos = 0;
    this.playing = false;
    this.speed = 3;
    this.cd = 0;
    this.mode = 'scroll';     // scroll | voice
    this.voiceIdx = -1;
    this.voiceLive = false;
    this.target = null;       // Smooth seek target for jumps and voice.
    this.nudge = 0;           // Held-button adjustment, px/s.
  }

  snapshot() {
    return { pos: this.pos, playing: this.playing, speed: this.speed, cd: this.cd, mode: this.mode, voiceIdx: this.voiceIdx, voiceLive: this.voiceLive, max: this.stage.max };
  }

  get moving() { return this.playing || this.cd > 0 || !!this.nudge || this.target != null; }

  play(countdown = 0) {
    if (this.mode === 'voice') return;
    if (this.playing) return;
    this.playing = true;
    this.target = null;
    this.cd = this.pos < 2 ? countdown : Math.min(countdown, 0);
  }
  pause() { this.playing = false; this.cd = 0; }
  toggle(countdown) { this.playing ? this.pause() : this.play(countdown); }

  seek(pos, smooth = false) {
    const p = this.stage.clamp(pos);
    if (smooth) this.target = p; else { this.pos = p; this.target = null; }
  }

  step(dt) {
    const st = this.stage;
    st.measure();
    if (this.cd > 0) {
      this.cd -= dt;
      if (this.cd < 0) this.cd = 0;
    } else if (this.mode === 'voice') {
      if (this.voiceIdx >= 0) this.target = st.posForWord(this.voiceIdx);
    } else if (this.playing && this.target == null) {
      this.pos += st.pxPerSec(this.speed) * dt;
      if (this.pos >= st.max) { this.pos = st.max; this.playing = false; }
    }
    if (this.nudge) { this.pos += this.nudge * dt; this.target = null; }
    if (this.target != null) {
      const k = 1 - Math.exp(-dt * (this.mode === 'voice' ? 5 : 9));
      this.pos += (this.target - this.pos) * k;
      if (Math.abs(this.target - this.pos) < 0.5) { this.pos = this.target; this.target = null; }
    }
    this.pos = Math.max(0, Math.min(st.max, this.pos));
  }
}
