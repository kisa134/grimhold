// audio.js — fully procedural WebAudio synth engine. No asset files.
// Everything is oscillators + filtered noise buffers. Starts on first user
// gesture (pointer lock). M toggles mute.
// Volumes & the spatial model read CFG.audio live (tuning panel).
import { CFG } from './config.js';

// ---- Batch 1 (contact quality): swing whoosh + per-material hit tuning ----
// swingWhoosh(charge01, timingOff): blade whoosh that rises with charge and
// bends with drag/accel timing (timingOff > 0 = dragged = lower & later).
export const SWING_WHOOSH_DEFAULTS = {
  durBase: 0.16, durCharge: 0.14,   // whoosh length (s) floor + charge-scaled add
  freqBase: 380, freqCharge: 620,   // sweep start (Hz) floor + charge-scaled add
  sweepMult: 2.6,                   // sweep end = start * this
  q: 2.4,                           // bandpass resonance
  gainBase: 0.20, gainCharge: 0.22, // volume floor + charge-scaled add
  dragPitchDrop: 0.22,              // pitch multiplier fall at full drag
  accelPitchLift: 0.15,             // pitch multiplier rise at full accel
  dragDelay: 0.045,                 // onset delay (s) at full drag — the "late" feel
  dragDurStretch: 0.35,             // fractional duration stretch at full drag
  whistleAt: 0.45, whistleGain: 0.10, // high-charge blade whistle layer
};

// materialHit(pos, material, severity) + armorBreak(pos) tuning.
// severity 0..1 scales gain (minGain..1), pitch (bright glancing -> deep full
// hit) and duration (minDur..1) of every layer.
export const MATERIAL_SFX_DEFAULTS = {
  severity: { minGain: 0.45, pitchDrop: 0.30, minDur: 0.7 },
  flesh:  { gain: 0.55, noiseFreq: 320, bodyFreq: 120, sliceFreq: 1400, dur: 0.15 },
  bone:   { gain: 0.48, crackFreq: 2400, partials: [1150, 1730], bodyFreq: 210, dur: 0.07 },
  armor:  { gain: 0.36, clangBase: 1050, ring: 0.30 },
  shield: { gain: 0.42, thudFreq: 140, thudNoise: 380, clangBase: 700, ring: 0.14, dur: 0.12 },
  break:  { gain: 0.55, snapFreq: 2900, clangBase: 830, ring: 0.5, drop: 0.82, bodyFreq: 160 },
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.volume = CFG.audio.master;
    this._heartT = 0;
    this._noiseBuf = null;
    // listener (camera) state for positional voices
    this._lx = 0; this._ly = 1.6; this._lz = 0; this._lyaw = 0;
    this._voices = [];   // active scream voices {g, until} — capped
    this._chgOsc = null; // charge tension tone nodes
    this._chgGain = null;
    this._chgF = null;
  }

  // Live volume from the tuning panel (respects mute).
  applyCfg() {
    this.volume = CFG.audio.master;
    if (this.master && !this.muted) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.03);
    }
  }

  // Must be called from a user gesture (pointer lock click).
  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(this.ctx.destination);

    const len = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noiseBuf = buf;

    this._startDrone();
    this._startCrackle();
  }

  get ready() { return !!this.ctx; }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.02);
    return this.muted;
  }

  // ---- positional voices (Task 5) ----
  // Called once per frame with the listener (camera) position + yaw.
  setListener(x, y, z, yaw) {
    this._lx = x; this._ly = y; this._lz = z; this._lyaw = yaw;
  }

  // Build a short-lived StereoPannerNode -> distance-gain -> master chain for a
  // world position. Returns the input node, or null when the sound would be
  // inaudible (beyond the configured cutoff) or the context is not running.
  _dest(pos) {
    if (!this.ctx) return null;
    const a = CFG.audio;
    const dx = pos.x - this._lx, dy = (pos.y || 0) - this._ly, dz = pos.z - this._lz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > a.cutoff) return null;
    // stereo pan: component of the source direction along the listener's right
    // vector. facing = (-sin yaw, -cos yaw); right = (cos yaw, -sin yaw)
    const rx = Math.cos(this._lyaw), rz = -Math.sin(this._lyaw);
    const pan = d > 0.01 ? (dx * rx + dz * rz) / d : 0;
    const gain = 1 / (1 + Math.pow(d / a.refDist, a.exponent));
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-0.9, Math.min(0.9, pan));
    const g = this.ctx.createGain();
    g.gain.value = gain;
    p.connect(g); g.connect(this.master);
    // short-lived node: clean it up well past any voice duration
    setTimeout(() => { try { p.disconnect(); g.disconnect(); } catch (e) {} }, 4000);
    return p;
  }

  // Resolve the destination for an optionally world-positioned sound.
  // Returns null when the sound should be skipped entirely.
  _out(pos) {
    if (!pos) return this.ctx ? this.master : null;
    return this._dest(pos);
  }

  // ---- primitives ----
  _noise(dur, { freq = 800, q = 1, type = 'bandpass', gain = 0.5, sweepTo = null, sweepT = null, at = 0, dest = null } = {}) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + at;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t0); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t0 + (sweepT || dur));
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(dest || this.master);
    src.start(t0); src.stop(t0 + dur + 0.05);
  }

  _tone(freq, dur, { type = 'sine', gain = 0.4, sweepTo = null, at = 0, vibrato = 0, dest = null } = {}) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + at;
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t0 + dur);
    if (vibrato > 0) {
      const lfo = this.ctx.createOscillator();
      const lg = this.ctx.createGain();
      lfo.frequency.value = 9; lg.gain.value = vibrato;
      lfo.connect(lg); lg.connect(o.frequency);
      lfo.start(t0); lfo.stop(t0 + dur);
    }
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(dest || this.master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  // ---- combat ----
  _gv() { return CFG.audio.goreVol; }   // gore bus volume (tuning panel)
  _cv() { return CFG.audio.clangVol; }  // metal bus volume

  swing(heavy, weaponKey) {
    if (!this.ctx) return;
    const base = weaponKey === 'axe' ? 300 : weaponKey === 'mace' ? 350 : 450;
    if (heavy) this._noise(0.32, { freq: base * 0.7, sweepTo: base * 1.8, q: 2.5, gain: 0.34 });
    else this._noise(0.18, { freq: base, sweepTo: base * 2.6, q: 2.5, gain: 0.24 });
  }

  // Batch 1: charge/drag-aware blade whoosh. charge01 0..1 raises pitch,
  // volume, length; timingOff (fraction of swing duration, + = drag, - =
  // accel) lowers & delays (drag) or brightens & tightens (accel) the sweep.
  // Player-local (master bus) like swing(); allocates nothing persistent.
  // Live-tunable leaves come from CFG.feel.whoosh; SWING_WHOOSH_DEFAULTS
  // supplies the internals + fallback.
  swingWhoosh(charge01 = 0, timingOff = 0) {
    if (!this.ctx) return;
    const w = { ...SWING_WHOOSH_DEFAULTS, ...((CFG.feel && CFG.feel.whoosh) || {}) };
    const c = Math.max(0, Math.min(1, charge01 || 0));
    const tOff = timingOff || 0;
    // normalize to [-1, 1] against the duel drag/accel clamps
    const tn = tOff >= 0
      ? Math.min(1, tOff / ((CFG.duel && CFG.duel.dragMax) || 0.35))
      : Math.max(-1, tOff / ((CFG.duel && CFG.duel.accelMax) || 0.25));
    const drag = Math.max(0, tn), accel = Math.max(0, -tn);
    const pitch = 1 - w.dragPitchDrop * drag + w.accelPitchLift * accel;
    const dur = (w.durBase + w.durCharge * c) * (1 + w.dragDurStretch * drag);
    const f0 = (w.freqBase + w.freqCharge * c) * pitch;
    const gain = w.gainBase + w.gainCharge * c;
    const at = w.dragDelay * drag;
    this._noise(dur, { freq: f0, sweepTo: f0 * w.sweepMult, q: w.q, gain, at });
    // faint blade whistle layered in at high charge
    if (c > w.whistleAt) {
      this._tone(f0 * 2.1, dur * 0.8, { type: 'sine', sweepTo: f0 * 3.2,
        gain: w.whistleGain * (c - w.whistleAt) / (1 - w.whistleAt), at });
    }
  }

  // Batch 1: per-material contact one-shot. material in
  // 'flesh'|'bone'|'armor'|'shield'; severity 0..1 scales gain/pitch/duration.
  // All positional: routed through the pan + distance-falloff chain via _out.
  materialHit(pos, material, severity = 0.5) {
    if (!this.ctx) return;
    const dest = this._out(pos); if (pos && !dest) return;
    const M = MATERIAL_SFX_DEFAULTS;
    const s = Math.max(0, Math.min(1, severity || 0));
    const gMul = M.severity.minGain + (1 - M.severity.minGain) * s;
    const pMul = 1 - M.severity.pitchDrop * (1 - s); // glancing = brighter
    const dMul = M.severity.minDur + (1 - M.severity.minDur) * s;
    switch (material) {
      case 'bone': {
        // sharp crack: bright noise snap + brittle short partials over a body
        const m = M.bone, gv = this._gv();
        this._noise(m.dur * dMul, { freq: m.crackFreq * pMul, q: 2.0, gain: m.gain * gMul * gv, dest });
        this._noise(m.dur * 0.6 * dMul, { freq: m.crackFreq * 1.6 * pMul, q: 4,
          gain: m.gain * 0.5 * gMul * gv, at: 0.012, dest });
        for (const f of m.partials) {
          this._tone(f * pMul, m.dur * 1.2 * dMul, { gain: m.gain * 0.22 * gMul * gv, dest });
        }
        this._tone(m.bodyFreq * pMul, m.dur * 1.4 * dMul, { sweepTo: 90,
          gain: m.gain * 0.4 * gMul * gv, dest });
        break;
      }
      case 'armor': {
        // metallic clang — shared struck-bar partial bank (_clang applies _cv)
        const m = M.armor;
        this._clang(m.clangBase * pMul, m.gain * gMul, m.ring * dMul, 1, dest);
        break;
      }
      case 'shield': {
        // dull wooden thunk with a faint metallic edge (boss + strapping)
        const m = M.shield, cv = this._cv();
        this._tone(m.thudFreq * pMul, m.dur * dMul, { sweepTo: 60, gain: m.gain * gMul * cv, dest });
        this._noise(m.dur * 0.9 * dMul, { freq: m.thudNoise * pMul, type: 'lowpass',
          gain: m.gain * 0.8 * gMul * cv, dest });
        this._clang(m.clangBase * pMul, m.gain * 0.3 * gMul, m.ring * dMul, 1, dest);
        break;
      }
      case 'flesh':
      default: {
        // wet thud + slice: lowpassed noise over a dropping body tone
        const m = M.flesh, gv = this._gv();
        this._noise(m.dur * dMul, { freq: m.noiseFreq * pMul, type: 'lowpass',
          gain: m.gain * gMul * gv, dest });
        this._tone(m.bodyFreq * pMul, m.dur * 0.9 * dMul, { sweepTo: 48,
          gain: m.gain * 0.8 * gMul * gv, dest });
        this._noise(m.dur * 1.3 * dMul, { freq: m.sliceFreq * pMul, sweepTo: 350, q: 1.2,
          gain: m.gain * 0.35 * gMul * gv, at: 0.01, dest });
        break;
      }
    }
  }

  // Batch 1: armor break — cracking metal snap + detuned ring-down.
  armorBreak(pos = null) {
    if (!this.ctx) return;
    const dest = this._out(pos); if (pos && !dest) return;
    const m = MATERIAL_SFX_DEFAULTS.break, cv = this._cv();
    // the crack: two layered snaps
    this._noise(0.06, { freq: m.snapFreq, q: 1.4, gain: m.gain * cv, dest });
    this._noise(0.09, { freq: m.snapFreq * 0.55, q: 2, gain: m.gain * 0.6 * cv, at: 0.02, dest });
    // ring-down: clang partials pitched down as the plate gives way
    this._clang(m.clangBase, m.gain * 0.8, m.ring, m.drop, dest);
    // low body of the blow
    this._tone(m.bodyFreq, 0.18, { sweepTo: 55, gain: m.gain * 0.7 * cv, dest });
  }

  impactFlesh(big, pos = null) {
    const dest = this._out(pos); if (pos && !dest) return;
    const gv = this._gv();
    this._noise(big ? 0.22 : 0.14, { freq: 320, type: 'lowpass', gain: (big ? 0.7 : 0.5) * gv, dest });
    this._tone(120, 0.14, { sweepTo: 48, gain: (big ? 0.6 : 0.42) * gv, dest });
  }

  // glancing blow: dull, quiet, unsatisfying
  graze(pos = null) {
    const dest = this._out(pos); if (pos && !dest) return;
    const gv = this._gv();
    this._noise(0.09, { freq: 210, type: 'lowpass', gain: 0.28 * gv, dest });
    this._tone(95, 0.09, { sweepTo: 60, gain: 0.22 * gv, dest });
  }

  armorClang(pos = null) {
    const dest = this._out(pos); if (pos && !dest) return;
    const cv = this._cv();
    this._tone(812, 0.22, { type: 'triangle', gain: 0.34 * cv, dest });
    this._tone(1237, 0.16, { type: 'triangle', gain: 0.22 * cv, dest });
    this._noise(0.05, { freq: 3800, q: 3, gain: 0.2 * cv, dest });
  }

  severCrunch(pos = null) {
    const dest = this._out(pos); if (pos && !dest) return;
    const gv = this._gv();
    for (let i = 0; i < 3; i++) {
      this._noise(0.06, { freq: 900 - i * 220, type: 'lowpass', gain: 0.5 * gv, at: i * 0.045, dest });
    }
    this._tone(180, 0.1, { sweepTo: 60, gain: 0.4 * gv, dest });
  }

  decapitation(pos = null) {
    const dest = this._out(pos); if (pos && !dest) return;
    const gv = this._gv();
    this.severCrunch(pos);
    this._noise(0.25, { freq: 1600, sweepTo: 300, q: 1.2, gain: 0.45 * gv, dest });      // wet slice
    this._noise(1.6, { freq: 700, q: 0.8, gain: 0.16 * gv, sweepTo: 450, at: 0.1, dest }); // fountain spray
  }

  // arterial spray: short rhythmic wet squirt synced to the fountain pulses
  arterialSquirt(pos = null) {
    const dest = this._out(pos); if (pos && !dest) return;
    const gv = this._gv();
    this._noise(0.14, { freq: 900 + Math.random() * 500, sweepTo: 260, q: 1.1, gain: 0.3 * gv, dest });
    this._tone(210, 0.09, { sweepTo: 90, gain: 0.16 * gv, dest });
  }

  // Sword-clash synth: 5 inharmonic metallic partials (~ratios of a struck
  // bar) with fast individual decays, a noise tick for the attack transient,
  // and a faint ring tail. `drop` detunes the tail slightly (heavy impacts).
  _clang(base, gain, ringT, drop = 1, dest = null) {
    if (!this.ctx) return;
    gain *= this._cv();
    const RATIOS = [1, 1.51, 2.09, 2.74, 3.76];
    const DECAYS = [0.26, 0.20, 0.15, 0.11, 0.08];
    for (let i = 0; i < RATIOS.length; i++) {
      const f = base * RATIOS[i];
      this._tone(f, DECAYS[i] * (ringT / 0.26), {
        type: 'sine', gain: gain * (1 - i * 0.13),
        sweepTo: drop !== 1 ? f * drop : null, dest,
      });
    }
    this._noise(0.03, { freq: 5400, q: 2.5, gain: gain * 0.7, dest }); // tick attack
    this._tone(base * 2.09, ringT * 2.0, { type: 'sine', gain: gain * 0.16, dest }); // ring tail
  }

  // Light clash: weapon vs block, armor deflection, blade on stone.
  clangLight(pos = null) {
    const dest = this._out(pos); if (pos && !dest) return;
    this._clang(1350, 0.30, 0.26, 1, dest);
  }

  // Heavy clash: parries & hard deflects — longer ring, slight pitch drop.
  clangHeavy(pos = null) {
    const dest = this._out(pos); if (pos && !dest) return;
    this._clang(940, 0.44, 0.55, 0.94, dest);
  }

  blockPing(parry) {
    if (parry) {
      this._tone(1245, 0.4, { type: 'triangle', gain: 0.4 });
      this._tone(1868, 0.3, { type: 'sine', gain: 0.26 });
      this._noise(0.08, { freq: 5200, q: 4, gain: 0.22 });
    } else {
      this._tone(622, 0.14, { type: 'triangle', gain: 0.3 });
      this._noise(0.05, { freq: 3000, q: 3, gain: 0.18 });
    }
  }

  // ---- duel mechanics (Chivalry-grade cues) ----

  // feint: the charge whoosh is CUT — air chokes off + a low thup
  feint(pos = null) {
    const dest = this._out(pos); if (pos && !dest) return;
    this._noise(0.15, { freq: 1500, sweepTo: 200, q: 1.6, gain: 0.3, dest });
    this._tone(150, 0.08, { sweepTo: 65, gain: 0.22, dest });
  }

  // morph: quick metallic zip as the blade redirects mid-windup
  morph() {
    if (!this.ctx) return;
    this._noise(0.1, { freq: 900, sweepTo: 2500, q: 3, gain: 0.22 });
    this._tone(720, 0.07, { type: 'triangle', sweepTo: 1450, gain: 0.12 });
  }

  // chamber: high metallic SHRIEK — two blades shear along each other
  chamber(pos = null) {
    const dest = this._out(pos); if (pos && !dest) return;
    this._clang(1750, 0.4, 0.5, 1.06, dest); // partials detune upward = shriek
    this._noise(0.22, { freq: 4200, sweepTo: 2500, q: 6, gain: 0.2, dest });
  }

  // weapon clash mid-swing: heavy clang + a short grinding scrape
  clash(pos = null) {
    const dest = this._out(pos); if (pos && !dest) return;
    this._clang(1100, 0.42, 0.4, 0.9, dest);
    this._noise(0.18, { freq: 520, sweepTo: 170, type: 'lowpass', gain: 0.26, dest });
  }

  // guard break: the guard CRACKS — snap + body drop + rattling fall
  guardBreak(pos = null) {
    const dest = this._out(pos); if (pos && !dest) return;
    this._noise(0.07, { freq: 2600, q: 1.2, gain: 0.55, dest });           // snap
    this._tone(220, 0.35, { type: 'sawtooth', sweepTo: 48, gain: 0.5, dest });
    this._noise(0.3, { freq: 320, type: 'lowpass', gain: 0.4, dest });
  }

  // boss unparryable telegraph: ominous low swell + metallic shing
  bossTelegraph(pos = null) {
    const dest = this._out(pos); if (pos && !dest) return;
    this._tone(98, 0.5, { type: 'sawtooth', sweepTo: 62, gain: 0.42, vibrato: 10, dest });
    this._clang(620, 0.26, 0.45, 1.0, dest);
  }

  playerHurt() {
    this._tone(95, 0.22, { sweepTo: 55, gain: 0.55, type: 'sawtooth', vibrato: 8 });
    this._noise(0.16, { freq: 260, type: 'lowpass', gain: 0.4 });
  }

  enemyDeath() {
    this._tone(210, 0.55, { sweepTo: 55, type: 'sawtooth', gain: 0.34, vibrato: 22 });
    this._noise(0.5, { freq: 420, sweepTo: 140, type: 'lowpass', gain: 0.26 });
  }

  kickThud(pos = null) {
    const dest = this._out(pos); if (pos && !dest) return;
    this._tone(85, 0.12, { sweepTo: 40, gain: 0.6, dest });
    this._noise(0.1, { freq: 240, type: 'lowpass', gain: 0.5, dest });
  }

  // corpse / ragdoll body hitting the floor
  ragdollThud(pos = null) {
    const dest = this._out(pos); if (pos && !dest) return;
    const gv = this._gv();
    this._tone(72, 0.14, { sweepTo: 36, gain: 0.5 * gv, dest });
    this._noise(0.12, { freq: 190, type: 'lowpass', gain: 0.42 * gv, dest });
  }

  // ---- Batch 2 (duel depth): reward + wall splat feedback ----

  // rewardSting(pos): bright success chime — a short bell/arpeggio (sine
  // partials at 880 + 1320 + a sparkle) with a fast decay and a light reverb
  // tail. Positive reinforcement for parries / posture breaks / executions.
  rewardSting(pos = null) {
    if (!this.ctx) return;
    const dest = this._out(pos); if (pos && !dest) return;
    // short bright bell: stacked sine partials, quick exponential decay
    this._tone(880, 0.25, { type: 'sine', gain: 0.32, dest });
    this._tone(1320, 0.22, { type: 'sine', gain: 0.22, at: 0.02, dest });
    this._tone(1760, 0.18, { type: 'sine', gain: 0.14, at: 0.04, dest });
    // shimmer tick
    this._noise(0.06, { freq: 5200, q: 4, gain: 0.12, at: 0.02, dest });
    // light reverb tail: a faint delayed echo of the bell partials
    this._tone(880, 0.35, { type: 'sine', gain: 0.10, at: 0.10, dest });
    this._tone(1320, 0.30, { type: 'sine', gain: 0.07, at: 0.12, dest });
  }

  // wallSplat(pos): enemy body slammed into a wall — crunchy noise burst
  // (bone/dust grind) over a low body thud. Loud, meatier than a normal hit.
  wallSplat(pos = null) {
    const dest = this._out(pos); if (pos && !dest) return;
    const gv = this._gv();
    // heavy low thud
    this._tone(80, 0.16, { sweepTo: 38, gain: 0.7 * gv, dest });
    // crunch: layered filtered noise (dust + bone grind)
    this._noise(0.18, { freq: 380, type: 'lowpass', gain: 0.6 * gv, dest });
    this._noise(0.12, { freq: 1400, q: 1.5, gain: 0.34 * gv, at: 0.01, dest });
    this._noise(0.08, { freq: 2600, q: 3, gain: 0.2 * gv, at: 0.03, dest });
    // meaty body partial
    this._tone(150, 0.12, { sweepTo: 60, gain: 0.4 * gv, dest });
  }

  // wet organ hit: brains/guts landing, skull squish
  squelch(pos = null) {
    const dest = this._out(pos); if (pos && !dest) return;
    const gv = this._gv();
    this._noise(0.2, { freq: 480, sweepTo: 110, type: 'lowpass', gain: 0.5 * gv, dest });
    this._tone(150, 0.16, { sweepTo: 65, gain: 0.3 * gv, dest });
    this._noise(0.05, { freq: 1600, q: 1.5, gain: 0.14 * gv, at: 0.02, dest });
  }

  executeBoom(pos = null) {
    const dest = this._out(pos); if (pos && !dest) return;
    this._tone(55, 0.8, { sweepTo: 30, gain: 0.8, type: 'sine', dest });
    this._noise(0.6, { freq: 180, type: 'lowpass', gain: 0.5, dest });
    this.severCrunch(pos);
  }

  footstep(alt) {
    this._noise(0.07, { freq: alt ? 170 : 140, type: 'lowpass', gain: 0.13 });
  }

  gateRumble(pos = null) {
    const dest = this._out(pos); if (pos && !dest) return;
    this._tone(38, 1.8, { gain: 0.7, sweepTo: 30, dest });
    this._noise(1.8, { freq: 110, type: 'lowpass', gain: 0.5, dest });
    this._noise(0.4, { freq: 900, q: 2, gain: 0.14, at: 0.1, dest }); // stone scrape
  }

  // ---- enemy voices (Task 4) ----
  // Scream voice cap: at most 4 concurrent, the oldest is faded out early.
  _screamCap() {
    const now = this.ctx.currentTime;
    this._voices = this._voices.filter((v) => v.until > now);
    while (this._voices.length >= 4) {
      const old = this._voices.shift();
      try { old.g.gain.setTargetAtTime(0, now, 0.03); } catch (e) {}
    }
  }

  // Procedural yell. variant: 'sever' (big) | 'death' (death cry) | 'grunt'
  // (short, quiet, heavy non-lethal hit). kind: knight | bandit | skeleton | boss.
  scream(kind, variant = 'grunt', pos = null) {
    if (!this.ctx) return;
    const dest = this._out(pos); if (pos && !dest) return;
    this._screamCap();
    const vg = this.ctx.createGain();
    vg.gain.value = 1;
    vg.connect(dest);
    if (kind === 'skeleton') {
      // dry bone rattle + shrill screech (no vocal cords left)
      const dur = variant === 'death' ? 0.6 : variant === 'sever' ? 0.4 : 0.22;
      const g = variant === 'grunt' ? 0.28 : 0.44;
      const ticks = variant === 'death' ? 6 : 4;
      for (let i = 0; i < ticks; i++) {
        this._noise(0.04, { freq: 2100 + (i % 2) * 500, q: 7, gain: g * 0.8, at: i * 0.055, dest: vg });
      }
      this._noise(dur, { freq: 1900, sweepTo: 750, q: 2.2, gain: g, dest: vg });
    } else {
      const base = kind === 'boss' ? 260 : kind === 'knight' ? 480 : 660;
      const v = variant === 'sever' ? { dur: 0.55, g: 0.55 }
        : variant === 'death' ? { dur: 0.7, g: 0.5 }
        : { dur: 0.2, g: 0.28 };
      const f0 = base * (variant === 'sever' ? 1.15 : 1);
      // yell: sawtooth sweeping down ~40% with vibrato + detuned square layer
      this._tone(f0, v.dur, { type: 'sawtooth', sweepTo: f0 * 0.42, gain: v.g,
        vibrato: kind === 'boss' ? 30 : 18, dest: vg });
      this._tone(f0 * 1.005, v.dur, { type: 'square', sweepTo: f0 * 0.4,
        gain: v.g * 0.35, vibrato: 18, dest: vg });
      // breathy noise, bandpassed
      this._noise(v.dur, { freq: kind === 'knight' ? 700 : 1100, sweepTo: 500,
        q: 0.9, gain: v.g * 0.5, dest: vg });
      if (kind === 'boss') this._tone(70, v.dur * 1.2, { sweepTo: 42, gain: 0.5, dest: vg });
      if (kind === 'knight') {
        // muffled inside the helm
        this._noise(v.dur, { freq: 500, type: 'lowpass', gain: v.g * 0.4, dest: vg });
      }
    }
    this._voices.push({ g: vg, until: this.ctx.currentTime + 1.2 });
  }

  // Enemy footsteps, routed through positional audio by the caller's position.
  // gainMult scales asymmetry for limps (wounded-side step lands softer).
  enemyStep(kind, alt, pos, gainMult = 1) {
    if (!this.ctx) return;
    const dest = this._out(pos); if (pos && !dest) return;
    const m = alt ? 1.12 : 1;
    if (kind === 'skeleton') {
      // bony click
      this._noise(0.035, { freq: 2100 * m, q: 6, gain: 0.10 * gainMult, dest });
      this._tone(760 * m, 0.03, { gain: 0.03 * gainMult, dest });
    } else if (kind === 'bandit') {
      // light leather shuffle
      this._noise(0.06, { freq: 230 * m, type: 'lowpass', gain: 0.10 * gainMult, dest });
    } else {
      // knight / boss: armored thud + faint clang layer
      const g = (kind === 'boss' ? 0.24 : 0.17) * gainMult;
      this._noise(0.09, { freq: 150 * m, type: 'lowpass', gain: g, dest });
      this._tone(70 * m, 0.07, { sweepTo: 45, gain: g * 0.8, dest });
      this._tone(1150 * m, 0.10, { type: 'triangle', gain: 0.028 * gainMult, dest });
    }
  }

  // ---- charge tension tone (very quiet rising saw while holding LMB) ----
  chargeStart() {
    if (!this.ctx || this._chgOsc) return;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth'; o.frequency.value = 85;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 300;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    o.connect(f); f.connect(g); g.connect(this.master);
    o.start();
    this._chgOsc = o; this._chgGain = g; this._chgF = f;
  }

  chargeLevel(c) {
    if (!this._chgOsc) return;
    const t = this.ctx.currentTime;
    this._chgOsc.frequency.setTargetAtTime(85 + 120 * c, t, 0.05);
    this._chgF.frequency.setTargetAtTime(300 + 900 * c, t, 0.05);
    this._chgGain.gain.setTargetAtTime(0.012 + 0.026 * c, t, 0.05);
  }

  chargeStop() {
    if (!this._chgOsc) return;
    const t = this.ctx.currentTime;
    const o = this._chgOsc;
    this._chgGain.gain.setTargetAtTime(0, t, 0.02);
    o.stop(t + 0.15);
    this._chgOsc = null; this._chgGain = null; this._chgF = null;
  }

  pickup(rarity) {
    if (rarity === 'cursed') {
      this._tone(220, 0.5, { type: 'sawtooth', gain: 0.28, vibrato: 12 });
      this._tone(233, 0.5, { type: 'sawtooth', gain: 0.28 }); // detuned dread
    } else if (rarity === 'rare') {
      this._tone(880, 0.25, { gain: 0.3 });
      this._tone(1320, 0.35, { gain: 0.22, at: 0.08 });
    } else if (rarity === 'gold') {
      this._tone(1046, 0.12, { gain: 0.22 });
      this._tone(1568, 0.18, { gain: 0.16, at: 0.06 });
    } else {
      this._tone(660, 0.18, { gain: 0.26 });
    }
  }

  // ---- ambience ----
  _startDrone() {
    const t0 = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.gain.value = 0.045;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 180;
    for (const fr of [55, 55.6, 82.4]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = fr;
      o.connect(f); o.start(t0);
    }
    // slow LFO breathing on the filter
    const lfo = this.ctx.createOscillator();
    const lg = this.ctx.createGain();
    lfo.frequency.value = 0.07; lg.gain.value = 70;
    lfo.connect(lg); lg.connect(f.frequency); lfo.start(t0);
    f.connect(g); g.connect(this.master);
  }

  _startCrackle() {
    // fire crackle bed: looping filtered noise, randomly retriggered pops
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf; src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 0.6;
    const g = this.ctx.createGain();
    g.gain.value = 0.012;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start();
    const pop = () => {
      if (!this.ctx) return;
      this._noise(0.03 + Math.random() * 0.04, { freq: 1800 + Math.random() * 2600, q: 4, gain: 0.05 + Math.random() * 0.05 });
      this._popT = setTimeout(pop, 120 + Math.random() * 700);
    };
    pop();
  }

  // heartbeat when hp < 30%, rate scales with desperation
  update(dt, hpFrac) {
    if (!this.ctx || hpFrac >= 0.3 || hpFrac <= 0) { this._heartT = 0; return; }
    this._heartT -= dt;
    if (this._heartT <= 0) {
      const rate = 0.55 + hpFrac; // faster when lower
      this._heartT = rate;
      const g = 0.5 * (1 - hpFrac / 0.3) + 0.2;
      this._tone(58, 0.1, { gain: g });
      this._tone(52, 0.09, { gain: g * 0.7, at: 0.14 });
    }
  }
}
