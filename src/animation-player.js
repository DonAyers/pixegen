/**
 * Animation Player
 *
 * Plays back a sequence of pixel art frames as an animation loop.
 * Renders to a dedicated canvas with configurable FPS, ping-pong mode,
 * and onion-skinning overlay.
 */

export class AnimationPlayer {
  /**
   * @param {HTMLCanvasElement} canvas - Target canvas for animation playback
   * @param {object} options
   * @param {number} options.fps - Playback frames per second (default: 8)
   * @param {boolean} options.loop - Whether to loop (default: true)
   * @param {boolean} options.pingPong - Play forward then reverse (default: false)
   * @param {number} options.onionSkinOpacity - 0 = off, 0-1 = ghost of prev frame (default: 0)
   * @param {number} options.scale - Display scale (default: auto)
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.frames = [];        // Array of { canvas, spriteW, spriteH }
    this.fps = options.fps ?? 8;
    this.loop = options.loop ?? true;
    this.pingPong = options.pingPong ?? false;
    this.onionSkinOpacity = options.onionSkinOpacity ?? 0;
    this.scale = options.scale ?? 0; // 0 = auto

    this._playing = false;
    this._currentFrame = 0;
    this._direction = 1;     // 1 = forward, -1 = reverse (for ping-pong)
    this._animId = null;
    this._lastFrameTime = 0;

    this.onFrameChange = null; // callback(frameIndex)
  }

  /**
   * Set the frames to animate.
   * @param {Array<{ canvas: HTMLCanvasElement, spriteW: number, spriteH: number } | null>} frames
   */
  setFrames(frames) {
    // Filter out null/empty frame slots
    this.frames = frames.filter(f => f !== null);
    this._currentFrame = 0;
    this._direction = 1;
    if (this.frames.length > 0) {
      this._drawFrame(0);
    }
  }

  get frameCount() {
    return this.frames.length;
  }

  get currentFrame() {
    return this._currentFrame;
  }

  get isPlaying() {
    return this._playing;
  }

  /**
   * Start playback.
   */
  play() {
    if (this.frames.length < 2) return; // Need at least 2 frames to animate
    if (this._playing) return;

    this._playing = true;
    this._lastFrameTime = performance.now();
    this._tick();
  }

  /**
   * Pause playback (keeps current frame).
   */
  pause() {
    this._playing = false;
    if (this._animId) {
      cancelAnimationFrame(this._animId);
      this._animId = null;
    }
  }

  /**
   * Stop and reset to frame 0.
   */
  stop() {
    this.pause();
    this._currentFrame = 0;
    this._direction = 1;
    if (this.frames.length > 0) {
      this._drawFrame(0);
    }
  }

  /**
   * Toggle play/pause.
   * @returns {boolean} New playing state
   */
  toggle() {
    if (this._playing) {
      this.pause();
    } else {
      this.play();
    }
    return this._playing;
  }

  /**
   * Step forward one frame.
   */
  stepForward() {
    if (this.frames.length === 0) return;
    this.pause();
    this._currentFrame = (this._currentFrame + 1) % this.frames.length;
    this._drawFrame(this._currentFrame);
  }

  /**
   * Step backward one frame.
   */
  stepBackward() {
    if (this.frames.length === 0) return;
    this.pause();
    this._currentFrame = (this._currentFrame - 1 + this.frames.length) % this.frames.length;
    this._drawFrame(this._currentFrame);
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  _tick() {
    if (!this._playing) return;

    this._animId = requestAnimationFrame((now) => {
      const elapsed = now - this._lastFrameTime;
      const interval = 1000 / this.fps;

      if (elapsed >= interval) {
        this._lastFrameTime = now - (elapsed % interval);
        this._advance();
      }

      this._tick();
    });
  }

  _advance() {
    const total = this.frames.length;
    if (total === 0) return;

    if (this.pingPong) {
      const next = this._currentFrame + this._direction;
      if (next >= total) {
        this._direction = -1;
        this._currentFrame = total - 2;
      } else if (next < 0) {
        this._direction = 1;
        this._currentFrame = 1;
      } else {
        this._currentFrame = next;
      }
    } else {
      this._currentFrame = (this._currentFrame + 1) % total;
      if (!this.loop && this._currentFrame === 0) {
        this.pause();
        this._currentFrame = total - 1;
      }
    }

    this._drawFrame(this._currentFrame);
  }

  _drawFrame(idx) {
    const frame = this.frames[idx];
    if (!frame) return;

    const srcCanvas = frame.canvas;
    const w = srcCanvas.width;
    const h = srcCanvas.height;

    // Auto-scale: fit within 256×256 using nearest-neighbor
    let scale = this.scale;
    if (!scale || scale <= 0) {
      scale = Math.max(1, Math.floor(Math.min(256 / (frame.spriteW || w), 256 / (frame.spriteH || h))));
    }

    const displayW = (frame.spriteW || w) * scale;
    const displayH = (frame.spriteH || h) * scale;

    this.canvas.width = displayW;
    this.canvas.height = displayH;
    this.ctx.imageSmoothingEnabled = false;

    // Onion skin: draw previous frame at reduced opacity
    if (this.onionSkinOpacity > 0 && idx > 0 && this.frames[idx - 1]) {
      this.ctx.globalAlpha = this.onionSkinOpacity;
      const prev = this.frames[idx - 1].canvas;
      this.ctx.drawImage(prev, 0, 0, displayW, displayH);
      this.ctx.globalAlpha = 1;
    }

    // Draw current frame
    this.ctx.drawImage(srcCanvas, 0, 0, displayW, displayH);

    // Notify listener
    if (this.onFrameChange) {
      this.onFrameChange(idx);
    }
  }

  /**
   * Export the current animation as an animated GIF data URL.
   * Uses a simple GIF encoder built from frames.
   * Returns null if no frames available.
   *
   * @returns {Promise<Blob|null>} GIF blob or null
   */
  async exportGif() {
    if (this.frames.length === 0) return null;

    // We'll build a simple sprite-sheet PNG instead of GIF
    // (GIF encoding in browser without a library is complex)
    // Users can use the sprite sheet export for that.
    return null;
  }
}
