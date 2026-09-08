// オジジ（雷蔵）の顔アニメーション <raizo-rig>。顔だけを Canvas 2D に描く（体・腕・湯呑みは無い）。
// 制作元の全身リグを、スマートフォンの対局画面に常駐させるために顔だけに作り直したもの。
// - 素材は window.RAIZO_RIG_SPRITES（assets.js）の URL から読む。顔 7 点と眉 1 点
// - 描画は「動いている間だけ」。単発動作の間と、ループ状態の中で動きのある区間（まばたき等）だけ
//   requestAnimationFrame を回し、それ以外は 1 回描いて次の区間まで setTimeout で眠る（電池対策）
// - API と出来事は元のリグと同じ: state 属性 / play() / pause() / resume() / seek()、
//   raizo-ready / raizo-statechange / raizo-complete / raizo-error
// - prefers-reduced-motion のときは動かさず、表情だけ切り替える
(function () {
  'use strict';

  // 状態。loop でないものは duration 秒で raizo-complete を出して止まる。
  // windows は、ループ状態の中で連続描画が要る区間（秒）。それ以外の時間は静止画
  const STATES = {
    idle: { label: 'タイトル・通常', duration: 4.8, loop: true, windows: [[3.66, 3.88]] },
    thinking: { label: '思考中・ヒント・待った・助言', duration: 3.2, loop: true, windows: [[0.3, 0.92], [1.9, 2.52]] },
    nod: { label: '頷き（良い手）', duration: 1.6 },
    good: { label: '段階2「良い手じゃな」', duration: 3.0 },
    doubtful: { label: '段階3「むう…」・王手', duration: 2.6, loop: true, windows: [[0.55, 0.68], [0.8, 0.93]] },
    bad: { label: '段階4「それは悪手じゃろう」', duration: 2.2 },
    angry: { label: '段階5「ばかもーん！」', duration: 2.2 },
    surprised: { label: '勝ち（オジジが負け）', duration: 1.6 },
  };

  // 描画空間（正方形）。顔は下端を y=HEAD_Y に置き、幅 HEAD_W で描く
  const SIZE = 380;
  const HEAD_W = 300;
  const HEAD_X = 190;
  const HEAD_Y = 345;
  // 眉（brow）を sour の顔に重ねる位置。sour の幅・高さに対する割合（scripts/build-faces.py の BROW_CROP と対応）
  const BROW = { x: 65 / 345, y: 110 / 328, w: 213 / 345, h: 68 / 328 };

  const clamp = (x) => Math.max(0, Math.min(1, x));
  const ease = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
  const mix = (a, b, t) => a + (b - a) * t;

  // 状態と経過秒から、その瞬間の顔の姿勢を決める（純粋関数。テストからも使う）
  function motion(state, t) {
    const s = STATES[state];
    const local = s.loop ? t % s.duration : Math.min(t, s.duration);
    const r = { state, t: local, face: 'neutral', brow: false, headY: 0, headAngle: 0, jump: 0, shakeX: 0, shakeY: 0, scale: 1, effects: 0 };
    if (state === 'idle') {
      r.face = local > 3.7 && local < 3.84 ? 'blink' : 'neutral';
    } else if (state === 'thinking') {
      // 首をゆっくり傾げて戻す
      r.face = 'think';
      const a = 0.045;
      if (local < 1.9) r.headAngle = mix(-a, a, ease((local - 0.3) / 0.6));
      else r.headAngle = mix(a, -a, ease((local - 1.9) / 0.6));
    } else if (state === 'nod') {
      const n = Math.sin(clamp(local / 1.4) * Math.PI);
      r.face = 'blink';
      r.headAngle = n * 0.14;
      r.headY = n * 10;
    } else if (state === 'good') {
      // 少し考えてから、目を閉じて満足げに頷く
      const k = ease((local - 0.5) / 0.4);
      r.face = local < 0.5 ? 'think' : 'sip';
      r.headAngle = -0.06 * k;
      r.headY = 4 * k;
    } else if (state === 'doubtful') {
      r.face = 'sour';
      r.brow = (local > 0.55 && local < 0.66) || (local > 0.8 && local < 0.91);
    } else if (state === 'bad') {
      const thrust = ease(local / 0.48) * (1 - ease((local - 1.25) / 0.7));
      r.face = 'sour';
      r.scale = 1 + 0.14 * thrust;
      r.headAngle = -0.05 * thrust;
    } else if (state === 'angry') {
      const a = 1 - ease((local - 1.5) / 0.7);
      r.face = 'shout';
      r.scale = 1.12;
      r.shakeX = Math.sin(local * 77) * 4 * a;
      r.shakeY = Math.cos(local * 67) * 2 * a;
      r.effects = a * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(local * 12.56)));
    } else if (state === 'surprised') {
      r.face = 'surprise';
      r.jump = -34 * Math.sin(clamp(local / 0.7) * Math.PI);
      r.headAngle = 0.06 * Math.sin(local * 14) * Math.exp(-local * 4);
    }
    return r;
  }

  // ループ状態で、時刻 local が連続描画の区間の中か
  function inWindow(state, local) {
    const w = STATES[state].windows || [];
    return w.some(([a, b]) => local >= a && local < b);
  }

  // ループ状態で、時刻 local から次の区間の始まりまでの秒数（区間が無ければ null）
  function untilNextWindow(state, local) {
    const s = STATES[state];
    const w = s.windows || [];
    if (w.length === 0) return null;
    let best = Infinity;
    for (const [a] of w) {
      const d = a > local ? a - local : a - local + s.duration;
      if (d < best) best = d;
    }
    return best;
  }

  class RaizoRig extends HTMLElement {
    static get observedAttributes() { return ['state']; }

    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this.shadowRoot.innerHTML = '<style>:host{display:block;width:100%;aspect-ratio:1}canvas{display:block;width:100%;height:100%}</style><canvas role="img" aria-label="雷蔵"></canvas>';
      this.canvas = this.shadowRoot.querySelector('canvas');
      this.ctx = this.canvas.getContext('2d');
      this._state = 'idle';
      this.time = 0;
      this.paused = false;
      this.ready = false;
      this.completed = false;
      this.sprites = {};
      this.reduce = matchMedia('(prefers-reduced-motion:reduce)');
      this._onFrame = this._onFrame.bind(this);
      this.raf = 0;
      this.timer = 0;
      // 置き場が変わって大きさが変わったら描き直す（静止中は自分から描かないため）
      this.observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.renderAt(this.time)) : null;
    }

    connectedCallback() {
      this.connected = true;
      if (!this.loading) this.load();
      if (this.observer) this.observer.observe(this);
      this._schedule();
    }

    disconnectedCallback() {
      this.connected = false;
      if (this.observer) this.observer.disconnect();
      this._stop();
    }

    attributeChangedCallback(n, o, v) { if (o !== v && v !== this._state) this.play(v); }

    get state() { return this._state; }

    play(state) {
      if (!STATES[state]) throw Error('Unknown state: ' + state);
      this._state = state;
      this.time = 0;
      this.completed = false;
      if (this.getAttribute('state') !== state) this.setAttribute('state', state);
      this.canvas.setAttribute('aria-label', '雷蔵：' + STATES[state].label);
      this.renderAt(0);
      this.dispatchEvent(new CustomEvent('raizo-statechange', { detail: { state } }));
      this._schedule();
    }

    pause() { this.paused = true; this._stop(); }
    resume() { if (!this.paused) return; this.paused = false; this._schedule(); }
    seek(t) { this.time = Math.max(0, t); this.renderAt(this.time); this._schedule(); }

    async load() {
      this.loading = true;
      try {
        const map = window.RAIZO_RIG_SPRITES;
        if (!map) throw new Error('RAIZO_RIG_SPRITES is not defined');
        await Promise.all(Object.entries(map).map(async ([name, src]) => {
          const img = new Image();
          img.decoding = 'async';
          img.src = src;
          await img.decode();
          this.sprites[name] = img; // そのまま drawImage に渡す。canvas に写し直さない
        }));
        this.ready = true;
        this.renderAt(this.time);
        this.dispatchEvent(new CustomEvent('raizo-ready'));
        this._schedule();
      } catch (error) {
        this.shadowRoot.innerHTML = '';
        this.dispatchEvent(new CustomEvent('raizo-error', { detail: String(error) }));
      }
    }

    _stop() {
      cancelAnimationFrame(this.raf);
      clearTimeout(this.timer);
      this.raf = 0;
      this.timer = 0;
    }

    // 今の状態と時刻に応じて、rAF を回すか、次の動きまで眠るかを決める
    _schedule() {
      this._stop();
      if (!this.connected || !this.ready || this.paused) return;
      const s = STATES[this._state];
      if (this.reduce.matches) {
        // 動かさない。単発動作は時間が来たら終わったことにする
        this.renderAt(0);
        if (!s.loop && !this.completed) this.timer = setTimeout(() => this._complete(), s.duration * 1000);
        return;
      }
      if (!s.loop) {
        if (this.completed) return;
        this.last = performance.now();
        this.raf = requestAnimationFrame(this._onFrame);
        return;
      }
      const local = this.time % s.duration;
      if (inWindow(this._state, local)) {
        this.last = performance.now();
        this.raf = requestAnimationFrame(this._onFrame);
        return;
      }
      this.renderAt(this.time);
      const wait = untilNextWindow(this._state, local);
      if (wait === null) return; // 動きの無いループ状態。次の play() まで何もしない
      this.timer = setTimeout(() => { this.time += wait; this._schedule(); }, wait * 1000);
    }

    _complete() {
      if (this.completed) return;
      this.completed = true;
      this.dispatchEvent(new CustomEvent('raizo-complete', { detail: { state: this._state } }));
    }

    _onFrame(now) {
      this.raf = 0;
      if (!this.connected || this.paused) return;
      const dt = Math.min((now - this.last) / 1000, 0.05);
      this.last = now;
      if (!document.hidden) this.time += dt;
      this.renderAt(this.time);
      const s = STATES[this._state];
      if (!s.loop) {
        if (this.time >= s.duration) { this._complete(); return; } // 最後の絵を描いたまま止まる
        this.raf = requestAnimationFrame(this._onFrame);
        return;
      }
      if (inWindow(this._state, this.time % s.duration)) this.raf = requestAnimationFrame(this._onFrame);
      else this._schedule();
    }

    renderAt(seconds) {
      if (!this.ready) return;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const css = this.clientWidth || 96;
      const px = Math.round(css * dpr);
      if (this.canvas.width !== px || this.canvas.height !== px) { this.canvas.width = px; this.canvas.height = px; }
      const c = this.ctx;
      c.setTransform(px / SIZE, 0, 0, px / SIZE, 0, 0);
      c.clearRect(0, 0, SIZE, SIZE);
      const m = motion(this._state, this.reduce.matches ? 0 : seconds);
      const face = this.sprites[m.face];
      if (!face) return;
      c.save();
      c.translate(m.shakeX, m.jump + m.shakeY);
      if (m.effects > 0) {
        // 怒りの放射線
        c.save();
        c.globalAlpha = m.effects;
        c.strokeStyle = '#74381f';
        c.lineWidth = 4;
        for (let i = 0; i < 12; i++) {
          const a = i * Math.PI / 6 + 0.12;
          c.beginPath();
          c.moveTo(HEAD_X + Math.cos(a) * 160, 200 + Math.sin(a) * 158);
          c.lineTo(HEAD_X + Math.cos(a) * 186, 200 + Math.sin(a) * 190);
          c.stroke();
        }
        c.restore();
      }
      // 顔は首元を軸に回す・拡大する
      const w = HEAD_W * m.scale;
      const h = w * face.height / face.width;
      c.translate(HEAD_X, HEAD_Y + m.headY);
      c.rotate(m.headAngle);
      c.drawImage(face, -w / 2, -h * 0.95, w, h);
      if (m.brow && this.sprites.brow) {
        c.drawImage(this.sprites.brow, -w / 2 + w * BROW.x, -h * 0.95 + h * BROW.y, w * BROW.w, h * BROW.h);
      }
      c.restore();
    }
  }

  window.RaizoRigStates = STATES;
  window.RaizoRigMotion = motion;
  window.RaizoRigSchedule = { inWindow, untilNextWindow };
  if (typeof customElements !== 'undefined' && !customElements.get('raizo-rig')) customElements.define('raizo-rig', RaizoRig);
})();
