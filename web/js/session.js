// Restore positions by word and line offset across different screen sizes.
// Equal sizes preserve exact pixels.
export function captureSession(stage, engine, sid) {
  stage.measure();
  const word = stage.wordAt(engine.pos);
  const top = stage.tops?.[word] ?? stage.markerY;
  const lines = stage.lines || [];
  const y = engine.pos + stage.markerY;
  let lo = 0, hi = Math.max(0, lines.length - 1);
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (stage.tops[lines[mid]] <= y) lo = mid; else hi = mid - 1; }
  const a = lines[lo] ?? 0, b = lines[lo + 1] ?? a;
  const ay = stage.tops?.[a] ?? stage.markerY, by = stage.tops?.[b] ?? ay;
  const f = (y - ay) / (by > ay ? by - ay : stage.s.fontSize * stage.s.lineHeight);
  return { ...engine.snapshot(), sid, atStart: engine.pos < .01, atEnd: stage.max > 0 && engine.pos >= stage.max, layout: stage.layout, anchor: { a, b, f }, vw: stage.w, vh: stage.h, word,
    offset: (engine.pos + stage.markerY - top) / (stage.s.fontSize * stage.s.lineHeight) };
}

// Interpolate between source line starts, avoiding jumps when a wider source
// line wraps into several lines on a narrower follower.
export function sessionPosition(stage, state) {
  stage.measure();
  if (state.atStart) return 0;
  if (state.atEnd) return stage.max;
  if (state.vw === stage.w && state.vh === stage.h && (!state.layout || state.layout === stage.layout)) return stage.clamp(Number.isFinite(state.pos) ? state.pos : 0);
  const anchor = state.anchor;
  if (anchor && Number.isInteger(anchor.a) && Number.isInteger(anchor.b) && Number.isFinite(anchor.f)) {
    const last = stage.words.length - 1;
    const a = Math.max(0, Math.min(last, anchor.a)), b = Math.max(a, Math.min(last, anchor.b));
    const ay = stage.tops?.[a] ?? stage.markerY, by = stage.tops?.[b] ?? ay;
    return stage.clamp(ay + anchor.f * (b !== a ? by - ay : stage.s.fontSize * stage.s.lineHeight) - stage.markerY);
  }
  const word = Math.max(0, Math.min(stage.words.length - 1, Number.isFinite(state.word) ? state.word : 0));
  return stage.clamp((stage.tops?.[word] ?? stage.markerY) + (Number.isFinite(state.offset) ? state.offset : 0) * stage.s.fontSize * stage.s.lineHeight - stage.markerY);
}

export function restoreSession(stage, engine, state) {
  stage.measure();
  const number = (v, fallback) => Number.isFinite(v) ? v : fallback;
  const word = Math.max(0, Math.min(stage.words.length - 1, number(state.word, 0)));
  engine.pos = sessionPosition(stage, state);
  engine.target = null; engine.nudge = 0;
  engine.speed = Math.max(.1, Math.min(20, number(state.speed, engine.speed)));
  engine.mode = state.mode === 'voice' ? 'voice' : 'scroll';
  engine.voiceIdx = Math.max(0, Math.min(stage.words.length - 1, number(state.voiceIdx, word)));
  engine.playing = engine.mode === 'scroll' && state.playing === true;
  engine.cd = engine.playing ? Math.max(0, Math.min(10, number(state.cd, 0))) : 0;
}
