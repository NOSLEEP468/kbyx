// 全部音效都用 WebAudio 现场合成，不加载任何音频文件
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.beatT = 0;
    this.heartInterval = 1.2;
    this.tension = 0;
  }

  init() {
    if (this.ready) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.ratio.value = 4;
    this.comp.connect(this.master);

    // 白噪声缓冲
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    // 环境低频嗡鸣
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0.0;
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 220;
    this.droneFilter.Q.value = 3;
    this.droneGain.connect(this.droneFilter);
    this.droneFilter.connect(this.comp);

    for (const [f, g] of [[55, 0.5], [58.2, 0.32], [110, 0.12]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const gg = ctx.createGain();
      gg.gain.value = g;
      o.connect(gg);
      gg.connect(this.droneGain);
      o.start();
    }

    // 空气声：极低音量的滤波噪声
    const air = ctx.createBufferSource();
    air.buffer = buf;
    air.loop = true;
    const airF = ctx.createBiquadFilter();
    airF.type = 'bandpass';
    airF.frequency.value = 700;
    airF.Q.value = 0.6;
    const airG = ctx.createGain();
    airG.gain.value = 0.016;
    air.connect(airF); airF.connect(airG); airG.connect(this.comp);
    air.start();

    this.droneGain.gain.linearRampToValueAtTime(0.09, ctx.currentTime + 3);
    this.ready = true;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.9;
  }

  setTension(t) {
    this.tension = Math.max(0, Math.min(1, t));
    if (!this.ready) return;
    const target = 0.09 + this.tension * 0.12;
    this.droneGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.5);
    this.droneFilter.frequency.setTargetAtTime(160 + this.tension * 520, this.ctx.currentTime, 0.6);
    this.heartInterval = 1.25 - this.tension * 0.85;
  }

  // 心跳：按压力值自动加快
  tick(dt) {
    if (!this.ready) return;
    this.beatT += dt;
    if (this.beatT >= this.heartInterval) {
      this.beatT = 0;
      this.thump(0.5 + this.tension * 0.5);
      setTimeout(() => this.thump(0.32 + this.tension * 0.3), this.heartInterval * 260);
    }
  }

  thump(vol = 0.5) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(72, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol * 0.5, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g); g.connect(this.comp);
    o.start(t); o.stop(t + 0.25);
  }

  noiseBurst({ dur = 0.12, freq = 600, q = 1, vol = 0.2, type = 'bandpass', sweep = 0 }) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * sweep), t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.comp);
    src.start(t); src.stop(t + dur + 0.05);
  }

  footstep(sprint = false) {
    this.noiseBurst({ dur: 0.09, freq: sprint ? 900 : 620, q: 1.2, vol: sprint ? 0.19 : 0.12 });
    if (this.ready) {
      const ctx = this.ctx, t = ctx.currentTime;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(sprint ? 95 : 78, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      o.connect(g); g.connect(this.comp);
      o.start(t); o.stop(t + 0.16);
    }
  }

  monsterStep(dist, hunting) {
    const vol = Math.max(0, 1 - dist / 16) * (hunting ? 0.5 : 0.34);
    if (vol <= 0.01) return;
    this.noiseBurst({ dur: 0.18, freq: 180, q: 0.8, vol: vol * 0.5, type: 'lowpass' });
    if (this.ready) {
      const ctx = this.ctx, t = ctx.currentTime;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(52, t);
      o.frequency.exponentialRampToValueAtTime(30, t + 0.3);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol * 0.55, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
      o.connect(g); g.connect(this.comp);
      o.start(t); o.stop(t + 0.36);
    }
  }

  stinger() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const f of [880, 932, 1244]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 0.5, t + 1.1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.075, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
      const f2 = ctx.createBiquadFilter();
      f2.type = 'lowpass'; f2.frequency.value = 2400;
      o.connect(g); g.connect(f2); f2.connect(this.comp);
      o.start(t); o.stop(t + 1.3);
    }
    this.noiseBurst({ dur: 0.9, freq: 3000, q: 0.7, vol: 0.1, sweep: 0.08 });
  }

  pickup() {
    if (!this.ready) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    [660, 990, 1320].forEach((f, i) => {
      const t = t0 + i * 0.09;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      o.connect(g); g.connect(this.comp);
      o.start(t); o.stop(t + 0.45);
    });
  }

  unlock() {
    if (!this.ready) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    [196, 247, 294, 392].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0 + i * 0.12);
      g.gain.exponentialRampToValueAtTime(0.13, t0 + i * 0.12 + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.12 + 1.4);
      o.connect(g); g.connect(this.comp);
      o.start(t0 + i * 0.12); o.stop(t0 + i * 0.12 + 1.5);
    });
  }

  scream() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(420, t);
    o.frequency.exponentialRampToValueAtTime(1200, t + 0.18);
    o.frequency.exponentialRampToValueAtTime(180, t + 0.9);
    const dist = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 4);
    }
    dist.curve = curve;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    o.connect(dist); dist.connect(g); g.connect(this.comp);
    o.start(t); o.stop(t + 1.2);
    this.noiseBurst({ dur: 0.7, freq: 1800, q: 0.5, vol: 0.22, sweep: 0.15 });
  }

  win() {
    if (!this.ready) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    [261.6, 329.6, 392, 523.2].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      const t = t0 + i * 0.16;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.14, t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      o.connect(g); g.connect(this.comp);
      o.start(t); o.stop(t + 1.7);
    });
  }
}
