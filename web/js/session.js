// Restore positions by word and line offset across different screen sizes.
// Equal sizes preserve exact pixels.
export function captureSession(stage, engine, sid) {
  stage.measure();
  const word = stage.wordAt(engine.pos);
  const top = stage.tops?.[word] ?? stage.markerY;
  return { ...engine.snapshot(), sid, vw: stage.w, vh: stage.h, word,
    offset: (engine.pos + stage.markerY - top) / (stage.s.fontSize * stage.s.lineHeight) };
}

export function restoreSession(stage, engine, state) {
  stage.measure();
  const number = (v, fallback) => Number.isFinite(v) ? v : fallback;
  const word = Math.max(0, Math.min(stage.words.length - 1, number(state.word, 0)));
  const pos = state.vw === stage.w && state.vh === stage.h ? number(state.pos, 0)
    : (stage.tops?.[word] ?? stage.markerY) + number(state.offset, 0) * stage.s.fontSize * stage.s.lineHeight - stage.markerY;
  engine.pos = stage.clamp(pos);
  engine.target = null; engine.nudge = 0;
  engine.speed = Math.max(.1, Math.min(20, number(state.speed, engine.speed)));
  engine.mode = state.mode === 'voice' ? 'voice' : 'scroll';
  engine.voiceIdx = Math.max(0, Math.min(stage.words.length - 1, number(state.voiceIdx, word)));
  engine.playing = engine.mode === 'scroll' && state.playing === true;
  engine.cd = engine.playing ? Math.max(0, Math.min(10, number(state.cd, 0))) : 0;
}
