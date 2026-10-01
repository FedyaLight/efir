// Draw while text moves; paused views redraw only when something changes.
import { platform } from './platform.js';
export class FrameLoop {
  constructor(stage, engine, draw) {
    this.stage = stage; this.engine = engine; this.draw = draw;
    this.raf = 0; this.last = 0; this.dead = false;
    this.onVisible = () => {
      cancelAnimationFrame(this.raf); this.raf = 0; this.last = 0;
      if (platform.visible) this.request();
    };
    this.onInvalidate = () => this.request();
    stage.onInvalidate = this.onInvalidate;
    document.addEventListener('visibilitychange', this.onVisible);
    platform.events.addEventListener('visible', this.onVisible);
    this.request();
  }

  request() {
    if (this.dead || this.raf || !platform.visible) return;
    this.raf = requestAnimationFrame(t => {
      this.raf = 0;
      const dt = this.last ? Math.min(.1, (t - this.last) / 1000) : 0;
      this.last = t;
      this.engine.step(dt);
      this.draw(t);
      if (this.engine.moving) this.request();
      else this.last = 0;
    });
  }

  destroy() {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    document.removeEventListener('visibilitychange', this.onVisible);
    platform.events.removeEventListener('visible', this.onVisible);
    if (this.stage.onInvalidate === this.onInvalidate) this.stage.onInvalidate = null;
  }
}
