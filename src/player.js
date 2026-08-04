// player.js — pointer-lock FPS controller: WASD + mouse, sprint/stamina,
// gravity + AABB collision, DIRECTIONAL CHARGED ATTACKS (hold LMB to charge,
// flick the mouse to pick the strike direction, release to strike; tap LMB for
// the quick 1-2-3 combo; a NEW flick mid-windup MORPHS the direction),
// ACTIVE PARRY / BLOCK on RMB (tap = parry, hold = block), RMB mid-windup =
// FEINT, drags & accels from mouse motion during the swing, guard break at
// zero stamina, procedural viewmodel swing animation, damage intake.
import * as THREE from 'three';
import { weaponStats, buildViewmodel } from './weapons.js';
import {
  comboNextStage,
  isInterruptible, interruptChance,
  landingLock, fallDamage, pickDir, canMorph, dragAxis, clampTimingOff,
  timingWindow,
} from './combat.js';
import { CFG } from './config.js';

// ---- camera feel (Batch 1 — contact quality) ----
// Tunable defaults for the first-person camera director: directional camKick
// on your own hits, FOV punches on heavy impacts / guard breaks, and the
// view-model jolt when YOUR attack gets parried. Pure data (Node-import-safe).
export const CAMERA_FEEL_DEFAULTS = {
  camKick: {
    yaw: 0.022,     // rad of camera yaw per unit of side push × power
    pitch: 0.018,   // rad of camera pitch per unit of vertical push × power
    roll: 0.012,    // rad of camera roll per unit of side push × power
    max: 0.07,      // clamp on any single kick channel (rad)
    recover: 9,     // exponential decay rate (1/s); hit-stop slows it naturally
  },
  fovPunch: {
    heavyHit: 6,    // heavy connect (matches pre-batch behavior)
    guardBreak: 9,  // your guard is smashed aside
    armorBreak: 5,  // you shattered their armor
    max: 12,        // clamp on total FOV widen
    decay: 14,      // units/s
  },
  parryJolt: {
    recoil: 1.15,   // viewmodel kick when your blow is turned aside (was 1.1)
    yaw: 0.03,      // camera nudge away from the parried blade's travel
    roll: 0.035,    // camera roll with the rebound
    t: 0.22,        // seconds of visible arms shiver
    oscFreq: 40,    // shiver frequency (rad/s)
    oscAmp: 0.05,   // shiver amplitude (rad on the viewmodel)
  },
};

// Live resolve: CFG.feel.camKick / CFG.feel.fovPunch mirror CAMERA_FEEL_DEFAULTS
// (tuning panel writes them at runtime); the exported const above stays the
// fallback for tests. parryJolt is not panel-exposed yet — const only.
export function cameraFeel() {
  const f = (typeof CFG !== 'undefined' && CFG.feel) || {};
  const d = CAMERA_FEEL_DEFAULTS;
  const ck = f.camKick || {}, fp = f.fovPunch || {};
  return {
    camKick: {
      yaw: ck.yaw ?? d.camKick.yaw, pitch: ck.pitch ?? d.camKick.pitch,
      roll: ck.roll ?? d.camKick.roll, max: ck.max ?? d.camKick.max,
      recover: ck.recover ?? d.camKick.recover,
    },
    fovPunch: {
      heavyHit: fp.heavyHit ?? d.fovPunch.heavyHit,
      guardBreak: fp.guardBreak ?? d.fovPunch.guardBreak,
      armorBreak: fp.armorBreak ?? d.fovPunch.armorBreak,
      max: fp.max ?? d.fovPunch.max, decay: fp.decay ?? d.fovPunch.decay,
    },
    parryJolt: d.parryJolt,
  };
}

const EYE = 1.62;
const RADIUS = 0.38;
const HEIGHT = 1.7;
const DOUBLE_TAP_T = 0.28;   // A/A or D/D within this window = dodge

const _clampKick = (v, m) => Math.max(-m, Math.min(m, v));

// Directional swing keyframes. Pose = [rx, ry, rz, px, py, pz] on the viewmodel
// root (camera space). windup -> end over the swing; recover eases back to rest.
const REST_POSE = [0, 0, 0, 0.35, -0.38, -0.65];
const SWING_POSE = {
  slashR: { // arc from the player's right to left
    windup: [0.55, -0.85, 0.55, 0.55, -0.34, -0.55],
    end:    [-0.35, 1.05, -0.50, 0.02, -0.40, -0.60],
  },
  slashL: { // arc from the player's left to right
    windup: [0.55, 0.85, -0.55, 0.15, -0.34, -0.55],
    end:    [-0.35, -1.05, 0.50, 0.55, -0.40, -0.60],
  },
  overhead: { // straight down the center
    windup: [1.35, 0, 0, 0.32, -0.20, -0.50],
    end:    [-1.45, 0, 0, 0.35, -0.55, -0.55],
  },
  stab: { // punches forward
    windup: [0.15, 0.15, 0.10, 0.38, -0.40, -0.42],
    end:    [-0.10, -0.05, 0, 0.33, -0.36, -1.02],
  },
};

function lerpPose6(a, b, k, out) {
  for (let i = 0; i < 6; i++) out[i] = a[i] + (b[i] - a[i]) * k;
  return out;
}

const _bd = new THREE.Vector3();
// Blade direction (up the haft) for a pose: Euler YXZ applied to (0,1,0).
function bladeDir(p, out) {
  const sx = -Math.sin(p[2]), cy = Math.cos(p[2]);       // after Rz
  const y1 = cy * Math.cos(p[0]), z1 = cy * Math.sin(p[0]); // after Rx
  out.set(
    sx * Math.cos(p[1]) + z1 * Math.sin(p[1]),           // after Ry
    y1,
    -sx * Math.sin(p[1]) + z1 * Math.cos(p[1]));
  return out;
}

export class Player {
  constructor(game, cfg) {
    this.game = game;
    this.stats = cfg.stats;
    this.hp = this.stats.maxHp;
    this.stamina = this.stats.maxStamina;
    this.dead = false;

    this.pos = new THREE.Vector3(game.level.spawn.x, 0, game.level.spawn.z);
    this.pos.y = game.level.floorHeightAt(this.pos.x, this.pos.z, 2);
    this.vel = new THREE.Vector3();  // horizontal momentum
    this.moveLock = 0;               // landing recovery lock
    this.vy = 0;
    this.yaw = game.level.spawn.yaw || 0;
    this.pitch = 0;
    this.bobT = 0;

    this.keys = new Set();
    this.lmb = false;
    this.blocking = false;
    this.sprinting = false;

    // weapon slots (1/2/3): slot 0 = loadout weapon, found weapons fill 1..2
    this.slots = [cfg.weapon];
    this.slot = 0;

    this.attack = {
      phase: 'idle', t: 0, heavy: false,
      charge: 0, charged: false, dir: null,
      hitSet: new Set(), stage: 1, wallSparked: false,
      flickDir: null,     // first committed flick direction (free)
      morphed: false,     // direction already morphed once this windup
      timingOff: 0,       // drag(+)/accel(-) accumulated this swing
      swingStart: -99,    // game.time the swing phase began (chambers)
      clashed: false,     // weapon clash already resolved this swing
    };
    this.cooldown = 0;
    this.combo = { stage: 0, sinceEnd: 99 };  // light-attack chain state
    // ---- dodge / i-frames + flow combo ----
    this.dodgeT = 0;            // >0: dodge burst in progress
    this.dodgeCdT = 0;          // dodge cooldown
    this.invuln = false;        // read-only for main.js: i-frames active
    this.combo.flow = 0;        // alternating-direction flow counter
    this.combo.lastDir = null;  // last light-attack direction
    this.dodgeDir = new THREE.Vector3();
    this._tapA = -99; this._tapD = -99; // last A/D press times (double-tap dodge)
    this.blockStart = -99;      // game.time when the current block was raised
    this.rmbHeld = false;       // RMB guard button held (tap = parry, hold = block)
    this._rmbGuard = false;     // current guard was raised by an RMB press
    this.parryCdUntil = -99;    // game.time until the guard can rise again
    this.guardBreakT = 0;       // >0: guard broken — long stagger, can't act
    this.riposteUntil = -99;    // game.time deadline for a guaranteed-crit riposte
    this._fovPunch = 0;         // transient FOV widen (see fovPunch())
    this._kickYaw = 0;          // camera-director kick offsets (see camKick())
    this._kickPitch = 0;
    this._kickRoll = 0;
    this._joltT = 0;            // >0: arms shiver after your attack was parried
    this._swayYaw = 0; this._swayPitch = 0;
    this._stepAcc = 0; this._stepAlt = false;
    this._wasGrounded = true; this._prevVy = 0; this._landDip = 0;
    this.kickT = 0;
    this.moveStr = 0;
    this.vmRecoil = 0;   // weapon viewmodel kick: +blocked/deflect recoil, -flesh bite
    this._bobSin = 0;
    this._flickX = 0; this._flickY = 0; // mouse deltas sampled during the windup
    this._pose = [0, 0, 0, 0, 0, 0];    // scratch viewmodel pose
    this._trailPose = [0, 0, 0, 0, 0, 0];

    // faint swing trail ribbon (rebuilt each swing; color by damage type)
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position',
      new THREE.BufferAttribute(new Float32Array(2 * 12 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    trailGeo.setIndex([...Array(11).keys()].flatMap(i => [i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2]));
    this.trail = new THREE.Mesh(trailGeo, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false,
    }));
    this.trail.frustumCulled = false;
    game.camera.add(this.trail); // ribbon points are written in camera space

    // heavy-attack crescent slash arc: thin additive ring sector that flashes
    // at the strike moment and fades in ~0.15s (anime impact read)
    this.crescent = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 1.35, 24, 1, 0, Math.PI * 1.15),
      new THREE.MeshBasicMaterial({
        color: 0xfff4d8, transparent: true, opacity: 0, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
    this.crescent.position.set(0.1, -0.05, -0.85);
    this.crescent.visible = false;
    this.crescent.renderOrder = 3;
    game.camera.add(this.crescent);

    // viewmodel rig attached to the camera
    this.viewRoot = new THREE.Group();
    this.viewRoot.position.set(0.35, -0.38, -0.65);
    game.camera.add(this.viewRoot);
    this._mountWeapon();

    this._onKeyDown = (e) => this._keyDown(e);
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onMouseMove = (e) => this._look(e);
    this._onMouseDown = (e) => this._mouseDown(e);
    this._onMouseUp = (e) => this._mouseUp(e);
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mousedown', this._onMouseDown);
    document.addEventListener('mouseup', this._onMouseUp);
  }

  get weapon() { return this.slots[this.slot]; }
  get wstats() { return weaponStats(this.weapon); }
  get locked() { return document.pointerLockElement != null; }

  _mountWeapon() {
    while (this.viewRoot.children.length) this.viewRoot.remove(this.viewRoot.children[0]);
    this.viewModel = buildViewmodel(this.weapon);
    this.viewRoot.add(this.viewModel);
  }

  setSlot(i) {
    if (i < 0 || i >= this.slots.length || i === this.slot) return;
    if (this.attack.phase !== 'idle') return;
    this.slot = i;
    this.cooldown = Math.max(this.cooldown, 0.25);
    this._mountWeapon();
    this.game.notify(this.wstats.itemName, '#c9b577');
  }

  addWeapon(item) {
    if (this.slots.length < 3) {
      this.slots.push(item);
      return this.slots.length; // 1-based slot number for the notification
    }
    return 0;
  }

  _keyDown(e) {
    // ignore keystrokes typed into the tuning panel / other inputs
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    this.keys.add(e.code);
    if (this.game.state !== 'run') return;
    if (e.code === 'Digit1') this.setSlot(0);
    if (e.code === 'Digit2') this.setSlot(1);
    if (e.code === 'Digit3') this.setSlot(2);
    if (e.code === 'KeyG') this.tryKick();
    // DODGE: double-tap A/D for a lateral burst, C for a backstep
    if (e.code === 'KeyA' || e.code === 'KeyD') {
      const now = this.game.time || 0;
      const last = e.code === 'KeyA' ? this._tapA : this._tapD;
      if (!e.repeat && now - last < DOUBLE_TAP_T) this.dodge(e.code === 'KeyA' ? 'left' : 'right');
      if (!e.repeat) { if (e.code === 'KeyA') this._tapA = now; else this._tapD = now; }
    }
    if (e.code === 'KeyC' && !e.repeat) this.dodge('back');
    // JUMP: Space → upward impulse when grounded
    if (e.code === 'Space' && !e.repeat) this.tryJump();
  }

  tryJump() {
    if (this.dead || this.game.state !== 'run' || this.game.paused) return;
    if (this._wasGrounded && this.vy <= 0.01) {
      this.vy = CFG.player.jumpSpeed;
      this._wasGrounded = false;
    }
  }

  // DODGE: short i-frame burst. dir: 'left' | 'right' | 'back' (default back).
  dodge(dir = 'back') {
    if (this.dead || this.game.state !== 'run' || this.game.paused) return;
    if (this.guardBreakT > 0) return;
    if (this.dodgeT > 0) return;
    if (this.dodgeCdT > 0 || this.stamina < CFG.combat.dodgeCost) return;
    this.stamina -= CFG.combat.dodgeCost;
    this.dodgeT = CFG.combat.dodgeT;
    this.dodgeCdT = CFG.combat.dodgeCd;
    // camera-space basis: forward = (-sin yaw, -cos yaw), right = (cos, -sin)
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    if (dir === 'left') this.dodgeDir.set(-cos, 0, sin);
    else if (dir === 'right') this.dodgeDir.set(cos, 0, -sin);
    else this.dodgeDir.set(sin, 0, cos);   // backwards, away from the camera
    this.dodgeDir.y = 0;
    if (this.dodgeDir.lengthSq() > 0) this.dodgeDir.normalize();
    this.invuln = true;
    if (this.game.audio?.swingWhoosh) this.game.audio.swingWhoosh(0.1, 0);
  }

  tryKick() {
    if (this.dead || this.game.state !== 'run' || this.game.paused) return;
    if (this.attack.phase !== 'idle' || this.cooldown > 0 || this.blocking) return;
    if (this.guardBreakT > 0) return;
    if (this.stamina < CFG.combat.kickCost) { this.game.notify('EXHAUSTED', '#7a9a5a'); return; }
    this.stamina -= CFG.combat.kickCost;
    this.kickT = 0.25;
    this.game.onPlayerKick();
  }

  // Applies a kick to a resolved enemy + WALL SPLAT when it's pinned against
  // stone. main.js may call this instead of enemy.applyKick() directly.
  kick(enemy) {
    if (!enemy || enemy.dead) return;
    enemy.applyKick(CFG.combat.kickDmg, this.pos);
    if (this.game.level && typeof this.game.level.wallDistance === 'function'
        && this.game.level.wallDistance(enemy.pos) < CFG.combat.wallSplatDist) {
      enemy.takeHit('torso', CFG.combat.wallSplatDmg, 'blunt', this.wstats, true, enemy.pos, {});
      enemy.staggerT = Math.max(enemy.staggerT, CFG.combat.wallSplatStagger);
      if (this.game.audio?.wallSplat) this.game.audio.wallSplat(enemy.pos);
      this.game.shake = Math.max(this.game.shake || 0, CFG.combat.wallSplatShake);
      if (this.game.ui?.notify) this.game.ui.notify('WALL SPLAT!', '#ff9a4a');
    }
  }

  _look(e) {
    if (!this.locked || this.game.state !== 'run') return;
    let sens = CFG.player.mouseSens;
    const a = this.attack;
    if (a.phase === 'windup') {
      // flick sampling: mouse deltas during the windup pick the strike direction
      this._flickX += e.movementX; this._flickY += e.movementY;
      // weapon weight: heavy windups & big charges drag the aim (axe most of all)
      if (a.heavy || a.charge > 0.35) sens *= this.wstats.key === 'axe' ? 0.55 : 0.75;
    } else if (a.phase === 'swing' && a.dir) {
      // DRAGS & ACCELS: mouse motion ALONG the swing axis shifts contact
      // timing — with the swing = accel (sooner, softer), against = drag
      // (later, harder). Accumulated per swing, clamped by CFG.duel.
      const da = dragAxis(a.dir);
      const along = (da.axis === 'x' ? e.movementX : e.movementY) * da.sign;
      a.timingOff = clampTimingOff(a.timingOff - along * CFG.duel.dragSens);
    }
    this.yaw -= e.movementX * sens;
    this.pitch -= e.movementY * sens;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
  }

  _mouseDown(e) {
    if (!this.locked || this.game.state !== 'run' || this.dead) return;
    if (e.button === 0) { this.lmb = true; this._startLmb(); }
    if (e.button === 2) this._rmbDown();
  }

  _mouseUp(e) {
    if (e.button === 0) {
      this.lmb = false;
      this._releaseLmb();
    }
    if (e.button === 2) this._rmbUp();
  }

  // LMB pressed: windup begins and charge starts building (cap ~0.9s).
  _startLmb() {
    const a = this.attack;
    if (a.phase !== 'idle' || this.cooldown > 0 || this.blocking) return;
    if (this.guardBreakT > 0) return;
    if (this.stamina < 12) { this.game.notify('EXHAUSTED', '#7a9a5a'); return; }
    this.stamina -= 12;
    a.phase = 'windup';
    a.t = 0;
    a.heavy = false;
    a.charge = 0;
    a.charged = false;
    a.dir = null;
    a.flickDir = null;
    a.morphed = false;
    a.timingOff = 0;
    a.clashed = false;
    a.hitSet.clear();
    a.wallSparked = false;
    a.stage = comboNextStage(this.combo.stage, this.combo.sinceEnd);
    this._flickX = 0; this._flickY = 0;
    this.game.audio.chargeStart();
  }

  // RMB pressed: FEINT if we're mid-windup, otherwise raise the guard.
  // A guard raised now is a PARRY for the first parryWindow seconds, a plain
  // block after that (hold RMB to keep blocking).
  _rmbDown() {
    const a = this.attack, g = this.game;
    if (this.guardBreakT > 0) return;
    this.rmbHeld = true;
    if (a.phase === 'windup') { this._feint(); return; }
    if (a.phase !== 'idle' || this.cooldown > 0 || this.blocking) return;
    if (g.time < this.parryCdUntil) return; // parry recovery: guard can't rise yet
    if (this.stamina <= 0) return;
    this._rmbGuard = true;
    this.blocking = true;
    this.blockStart = g.time;
    this._blockTap = true;
  }

  _rmbUp() {
    this.rmbHeld = false;
    this._rmbGuard = false;
    if (this.blocking && !this.keys.has('KeyF')) {
      this.blocking = false;
      // a quick tap (raised & dropped inside the parry window) has recovery —
      // this is what stops parry spam
      if (this._blockTap && this.game.time - this.blockStart <= CFG.combat.parryWindow) {
        this.parryCdUntil = this.game.time + CFG.duel.parryRecovery;
      }
    }
    this._blockTap = false;
  }

  // FEINT: RMB during your own windup chokes the attack off into a short
  // recovery for a stamina cost. The classic mind-game vs parry-happy foes.
  _feint() {
    const a = this.attack, g = this.game, w = this.wstats;
    if (this.stamina < CFG.duel.feintCost) { g.notify('EXHAUSTED', '#7a9a5a'); return; }
    this.stamina -= CFG.duel.feintCost;
    a.phase = 'recover';
    a.t = w.recover - CFG.duel.feintRecover; // negative t = recovery longer than recover anim
    this.combo.stage = 0; this.combo.sinceEnd = 99; // feints break the chain
    g.audio.chargeStop();
    g.audio.feint();
    if (g.debugLine) g.debugLine(`FEINT · -${CFG.duel.feintCost} st`);
  }

  // LMB released mid-windup: the strike goes NOW. A release before
  // QUICK_RELEASE is a quick uncharged slash that keeps the combo chain alive.
  _releaseLmb() {
    const a = this.attack;
    if (a.phase !== 'windup') return;
    a.charge = Math.min(1, a.t / CFG.combat.chargeTime);
    a.charged = a.charge >= CFG.combat.chargedMin;
    a.heavy = a.charge >= CFG.combat.chargeHeavy;
    this.stamina = Math.max(0, this.stamina - Math.round(CFG.combat.chargeStamina * a.charge));
    a.dir = a.flickDir || pickDir(this._flickX, this._flickY) || this._comboSide();
    this._beginSwing();
  }

  _comboSide() { return this.attack.stage === 2 ? 'slashL' : 'slashR'; }

  // Live direction preview while winding up (viewmodel follows the flick).
  _windupDir() {
    const a = this.attack;
    return a.flickDir || pickDir(this._flickX, this._flickY) || this._comboSide();
  }

  _beginSwing() {
    const g = this.game, w = this.wstats, a = this.attack;
    a.phase = 'swing';
    a.t = 0;
    a.swingStart = g.time;
    a.hitSet.clear();
    a.wallSparked = false;
    a.limbLaunched = false; // one limb-launch sweep per swing (gore 2.0)
    g.audio.chargeStop();
    // whoosh at swing start: Batch-1 charge/timing-aware whoosh preferred,
    // legacy swing() until audio.swingWhoosh lands
    if (typeof g.audio.swingWhoosh === 'function') g.audio.swingWhoosh(a.charge, a.timingOff || 0);
    else g.audio.swing(a.heavy, w.key);
    // chambers: a mirrored swing started right before an incoming blow lands
    if (g.onPlayerSwingStart) g.onPlayerSwingStart();
    // live debug readout: attack direction + charge on every swing
    if (g.debugLine) g.debugLine(`${a.dir || 'slashR'} · chg ${Math.round((a.charge || 0) * 100)}%${a.heavy ? ' · HEAVY' : ''}${a.morphed ? ' · MORPHED' : ''}`);
    this.trail.material.color.setHex(
      w.type === 'slash' ? 0xd8dce8 : w.type === 'chop' ? 0xd83838 : 0x8a8a8a);
    this.trail.material.opacity = a.heavy ? 0.5 : 0.32;
    this._writeTrail(0);
    if (a.heavy) {
      // crescent arc flash at the strike moment, oriented with the strike type
      this.crescent.visible = true;
      this.crescent.material.opacity = 0.85;
      this.crescent.rotation.z =
        ({ slashR: 0.5, slashL: 2.6, overhead: 1.6, stab: 1.6 })[a.dir] ?? Math.random() * Math.PI * 2;
      this.crescent.scale.setScalar(0.8);
    }
  }

  // GUARD BREAK: stamina hit zero while blocking (or an unparryable blow met
  // the guard). Long stagger, weapon knocked aside, big audio cue.
  guardBreak() {
    const g = this.game;
    // Resolve shortens the reeling stagger (staggerRes = guard-break resistance)
    this.guardBreakT = CFG.duel.guardBreakStagger * (1 - (this.stats.staggerRes || 0) * 0.5);
    this.blocking = false;
    this.vmRecoil = 1.3;
    // a broken guard also chokes off any windup in progress
    if (this.attack.phase === 'windup') {
      this.attack.phase = 'idle';
      this.cooldown = Math.max(this.cooldown, 0.4);
      g.audio.chargeStop();
    }
    g.audio.guardBreak();
    this.fovPunch(cameraFeel().fovPunch.guardBreak); // the world lurches wider
    g.shake = Math.max(g.shake, 0.6);
    g.notify('GUARD BREAK!', '#ff5040');
    if (g.debugLine) g.debugLine('GUARD BREAK — you are wide open');
  }

  // ---- camera director (Batch 1 — contact quality) ----

  // Small directional camera push along the blade's travel direction on YOUR
  // hits. dirVec = world-space blade direction; power scales with weapon mass
  // (see CONTACT_WEAPON_MASS in main.js). Offsets decay in update() — during
  // hit-stop the decay slows too, so the frame "holds" on impact.
  camKick(dirVec, power = 1) {
    if (!dirVec || this.dead) return;
    const d = cameraFeel().camKick;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = -fz, rz = fx; // player's right (yaw=0 → +X)
    const side = dirVec.x * rx + dirVec.z * rz; // + = pushed toward player's right
    const vert = dirVec.y || 0;                 // + = pushed upward
    // yaw -= movementX turns right, so a rightward push is a NEGATIVE yaw kick
    this._kickYaw = _clampKick(this._kickYaw - side * d.yaw * power, d.max);
    this._kickPitch = _clampKick(this._kickPitch + vert * d.pitch * power, d.max);
    this._kickRoll = _clampKick(this._kickRoll + side * d.roll * power, d.max);
  }

  // Brief FOV widen on heavy impacts and guard breaks.
  fovPunch(amount = cameraFeel().fovPunch.heavyHit) {
    const d = cameraFeel().fovPunch;
    this._fovPunch = Math.min(d.max, Math.max(this._fovPunch, amount));
  }

  // YOUR attack got parried: the blade is batted aside — big recoil plus a
  // short visible shiver of the arms/viewmodel and a camera rebound nudge.
  parryJolt() {
    const d = cameraFeel().parryJolt;
    this.vmRecoil = Math.max(this.vmRecoil, d.recoil);
    this._joltT = d.t;
    // the rebound throws the blade back the way it came from
    const side = this.attack.dir === 'slashL' ? 1 : this.attack.dir === 'slashR' ? -1 : 0;
    this._kickYaw = _clampKick(this._kickYaw + side * d.yaw, cameraFeel().camKick.max);
    this._kickRoll = _clampKick(this._kickRoll + side * d.roll, cameraFeel().camKick.max);
  }

  // Full unmitigated damage intake. Blocking/parry/guard-break decisions are
  // made by the caller (game.damagePlayer) BEFORE this is invoked.
  takeDamage(dmg, srcPos) {
    if (this.dead || this.game.state !== 'run') return;
    const g = this.game;
    const toSrc = new THREE.Vector3().subVectors(srcPos, this.pos).setY(0).normalize();
    g.shake = Math.max(g.shake, 0.4 * (1 - this.stats.staggerRes));
    // knockback away from the attacker
    this.pos.addScaledVector(toSrc, -0.4 * (1 - this.stats.staggerRes));
    // getting hit mid-windup can interrupt your own swing
    if (isInterruptible(this.attack.phase) && Math.random() < interruptChance(dmg)) {
      this.attack.phase = 'idle';
      this.cooldown = Math.max(this.cooldown, 0.35);
      this.stamina = Math.max(0, this.stamina - 5);
      g.audio.chargeStop();
      g.notify('ATTACK INTERRUPTED', '#ff8040');
    }
    this.hp -= Math.round(dmg);
    g.uiDamageFlash();
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      g.audio.chargeStop();
      g.onPlayerDeath();
    }
  }

  update(dt) {
    const g = this.game;
    if (this.dead) return;

    // --- guard: RMB (tap = parry, hold = block), F = plain hold-block ---
    const wasBlocking = this.blocking;
    this.guardBreakT = Math.max(0, this.guardBreakT - dt);
    const wantBlock = (this.rmbHeld || this.keys.has('KeyF')) &&
      this.attack.phase === 'idle' && this.guardBreakT <= 0 &&
      g.time >= this.parryCdUntil;
    this.blocking = wantBlock && this.stamina > 0;
    if (this.blocking && !wasBlocking && !this._rmbGuard) {
      // F-raised (or re-raised while held): never an active parry
      this.blockStart = g.time - CFG.combat.parryWindow - 0.01;
    }

    // --- movement ---
    const fwd = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const str = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    this.sprinting = this.keys.has('ShiftLeft') && fwd > 0 && this.stamina > 1 && !this.blocking;
    let speed = (this.sprinting ? CFG.player.sprint : CFG.player.walk) * this.stats.speedMult;
    if (this.blocking) speed *= CFG.player.blockSpeedMult;
    if (this.guardBreakT > 0) speed *= CFG.duel.guardBreakSlow; // reeling

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const mx = (-sin * fwd + cos * str);
    const mz = (-cos * fwd - sin * str);
    const mlen = Math.hypot(mx, mz) || 1;
    this.moveStr = str;
    // --- horizontal inertia: accelerate ~0.25s, slide to a stop, sprint has more mass ---
    const moving = (fwd || str) && this.moveLock <= 0;
    const tx = moving ? (mx / mlen) * speed : 0;
    const tz = moving ? (mz / mlen) * speed : 0;
    const accelT = this.moveLock > 0 ? 0.1
      : (moving ? (this.sprinting ? CFG.player.accelSprint : CFG.player.accelWalk) : CFG.player.accelStop);
    const k = Math.min(1, dt / accelT);
    this.vel.x += (tx - this.vel.x) * k;
    this.vel.z += (tz - this.vel.z) * k;
    // --- dodge burst: overrides horizontal motion, grants i-frames ---
    this.dodgeCdT = Math.max(0, this.dodgeCdT - dt);
    const dodging = this.dodgeT > 0;
    if (dodging) {
      const sp = CFG.combat.dodgeDist / CFG.combat.dodgeT;
      this.vel.x = this.dodgeDir.x * sp;
      this.vel.z = this.dodgeDir.z * sp;
      this.dodgeT = Math.max(0, this.dodgeT - dt);
      this.invuln = this.dodgeT > (CFG.combat.dodgeT - CFG.combat.dodgeIframeT);
      if (this.dodgeT <= 0) this.invuln = false;
    } else {
      this.invuln = false;
    }
    this.moveLock = Math.max(0, this.moveLock - dt);
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    const actualSpeed = Math.hypot(this.vel.x, this.vel.z);
    if (actualSpeed > 0.5) {
      this.bobT += dt * actualSpeed * 1.65;
      // footsteps synced to the bob cycle: step on each descending zero-crossing
      const s = Math.sin(this.bobT);
      if (this._bobSin > 0 && s <= 0 && !this.blocking) {
        this._stepAlt = !this._stepAlt;
        g.audio.footstep(this._stepAlt);
      }
      this._bobSin = s;
    }
    g.level.collideCircle(this.pos, RADIUS, HEIGHT);

    // gravity / floor snap (handles stairs)
    this.vy -= CFG.player.gravity * dt;
    this.pos.y += this.vy * dt;
    const floor = g.level.floorHeightAt(this.pos.x, this.pos.z, this.pos.y + 0.5);
    if (this.pos.y <= floor) {
      if (!this._wasGrounded) {
        const fallSpeed = -this._prevVy;
        this._landDip = 0.2;      // landing dip
        g.shake = Math.max(g.shake, 0.1);
        g.audio.footstep(true);
        // momentum landing: thud + brief movement lock scaled by fall height
        const lock = landingLock(fallSpeed);
        if (lock > 0) {
          this.moveLock = lock;
          g.shake = Math.max(g.shake, 0.15 + lock * 0.4);
          g.audio.kickThud();
        }
        // heavy falls hurt
        const fd = fallDamage(fallSpeed);
        if (fd > 0) {
          this.hp -= fd;
          g.uiDamageFlash();
          g.notify('The fall crushes your legs', '#ff6040');
          if (this.hp <= 0) { this.hp = 0; this.dead = true; g.onPlayerDeath(); return; }
        }
      }
      this.pos.y = floor; this.vy = 0; this._wasGrounded = true;
    } else if (this.pos.y > floor + 0.05) {
      this._wasGrounded = false;
    }
    this._prevVy = this.vy;

    // --- stamina ---
    const regenMult = this.stats.regenMult || 1; // hero Resolve -> faster regen
    if (this.sprinting && this.dodgeT <= 0) this.stamina -= CFG.player.sprintStamina * dt;
    else if (this.blocking) this.stamina -= CFG.player.blockStaminaDrain * dt;
    else if (this.attack.phase === 'idle') this.stamina += CFG.player.regenStamina * regenMult * dt;
    else this.stamina += CFG.player.swingStaminaRegen * regenMult * dt;
    this.stamina = Math.max(0, Math.min(this.stats.maxStamina, this.stamina));
    // training room: bottomless lungs
    if (g.training && CFG.training.infiniteStamina) this.stamina = this.stats.maxStamina;

    // --- cursed weapon drain ---
    if (this.wstats.cursed) this.hp = Math.max(1, this.hp - 1.5 * dt);

    // --- attack state machine ---
    this.cooldown -= dt;
    this.kickT = Math.max(0, this.kickT - dt);
    this.combo.sinceEnd += dt;
    const w = this.wstats;
    const a = this.attack;
    if (a.phase === 'windup') {
      a.t += dt;
      // MORPH: a NEW flick (different direction) inside the morph window
      // redirects the attack for a stamina cost — beats a parry read.
      const d = pickDir(this._flickX, this._flickY);
      if (d) {
        if (!a.flickDir) {
          a.flickDir = d; // first flick commits the direction for free
          this._flickX = 0; this._flickY = 0;
        } else if (d !== a.flickDir && !a.morphed && canMorph(a.t)) {
          if (this.stamina >= CFG.duel.morphCost) {
            this.stamina -= CFG.duel.morphCost;
            a.morphed = true;
            a.flickDir = d;
            this._flickX = 0; this._flickY = 0;
            g.audio.morph();
            this.vmRecoil = Math.max(this.vmRecoil, 0.3); // view-model redirect jolt
            if (g.debugLine) g.debugLine(`MORPH → ${d} · -${CFG.duel.morphCost} st`);
          } else {
            a.morphed = true; // too tired: locked into the first direction
            g.notify('EXHAUSTED', '#7a9a5a');
          }
        }
      }
      // charge builds to the cap, auto-release after a short grace
      a.charge = Math.min(1, a.t / CFG.combat.chargeTime);
      g.audio.chargeLevel(a.charge);
      if (a.t >= CFG.combat.chargeTime + CFG.combat.chargeGrace) this._releaseLmb();
    } else if (a.phase === 'swing') {
      a.t += dt;
      // trail warp: drags stretch the ribbon late, accels snap it early
      const tw = timingWindow(a.timingOff || 0);
      const fr = Math.max(0, Math.min(1, (a.t / w.swing - tw[0]) / Math.max(0.05, tw[1] - tw[0])));
      this._writeTrail(fr);
      if (a.t >= w.swing) {
        a.phase = 'recover'; a.t = 0;
        // whiffed heavy costs extra wind
        if (a.heavy && a.hitSet.size === 0) {
          this.stamina = Math.max(0, this.stamina - CFG.combat.whiffHeavyCost);
        }
      }
    } else if (a.phase === 'recover') {
      a.t += dt;
      if (a.t >= w.recover) {
        a.phase = 'idle';
        this.cooldown = w.cooldown;
        // combo bookkeeping: heavy & charged swings break the chain;
        // quick slashes advance it
        if (a.heavy || a.charged) { this.combo.stage = 0; this.combo.sinceEnd = 99; }
        else { this.combo.stage = a.stage; this.combo.sinceEnd = 0; }
        // FLOW: alternating light-attack directions build the multiplier;
        // repeating a direction (or going heavy) resets it.
        const fdir = a.dir;
        if (a.heavy || a.charged) {
          this.combo.flow = 0;
        } else if (fdir) {
          if (this.combo.lastDir && fdir !== this.combo.lastDir) {
            this.combo.flow = Math.min(CFG.combat.flowMax, this.combo.flow + 1);
          } else if (fdir === this.combo.lastDir) {
            this.combo.flow = 0;
          }
        }
        if (fdir) this.combo.lastDir = fdir;
      }
    }
    if (a.phase !== 'swing' && this.trail.material.opacity > 0) {
      this.trail.material.opacity = Math.max(0, this.trail.material.opacity - dt * 3);
    }
    // crescent arc: fast expand + fade (~0.15s)
    if (this.crescent.visible) {
      this.crescent.material.opacity -= dt * (0.85 / 0.15);
      this.crescent.scale.addScalar(dt * 3.2);
      if (this.crescent.material.opacity <= 0) {
        this.crescent.material.opacity = 0;
        this.crescent.visible = false;
      }
    }

    // --- camera ---
    const bob = Math.sin(this.bobT) * 0.045 * (this.blocking ? 0.4 : 1); // braced stance bobs less
    this._landDip = Math.max(0, this._landDip - dt * 0.7);
    const cam = g.camera;
    cam.rotation.order = 'YXZ';
    // camera-director kicks (hit contacts, parries): decaying yaw/pitch/roll
    // offsets layered over the raw look angles — they never alter your aim
    const kd = cameraFeel().camKick;
    const kDecay = Math.max(0, 1 - kd.recover * dt);
    this._kickYaw *= kDecay;
    this._kickPitch *= kDecay;
    this._kickRoll *= kDecay;
    cam.rotation.y = this.yaw + this._kickYaw;
    cam.rotation.x = this.pitch + this._kickPitch;
    cam.rotation.z = Math.sin(this.bobT * 0.5) * 0.006 + this.moveStr * 0.025 + this._kickRoll; // strafe roll + kicks
    cam.position.set(this.pos.x, this.pos.y + EYE + bob - this._landDip, this.pos.z);
    if (g.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * g.shake * 0.14;
      cam.position.y += (Math.random() - 0.5) * g.shake * 0.14;
      cam.rotation.z += (Math.random() - 0.5) * g.shake * 0.03;
    }
    // FOV punch on heavy connects / guard breaks / armor breaks
    this._fovPunch = Math.max(0, this._fovPunch - dt * cameraFeel().fovPunch.decay);
    const fov = 72 + this._fovPunch;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }

    // mouse-lag weapon sway
    this._swayYaw += (this.yaw - this._swayYaw) * Math.min(1, 10 * dt);
    this._swayPitch += (this.pitch - this._swayPitch) * Math.min(1, 10 * dt);
    const lagYaw = this._swayYaw - this.yaw, lagPitch = this._swayPitch - this.pitch;

    // --- viewmodel animation (procedural directional swing) ---
    const vm = this.viewRoot;
    const pose = this._pose;
    if (this.guardBreakT > 0) {
      // weapon knocked aside: guard is gone, blade hangs wide
      pose[0] = 0.45; pose[1] = -1.15; pose[2] = 0.85; pose[3] = 0.55; pose[4] = -0.26; pose[5] = -0.50;
    } else if (this.blocking) {
      pose[0] = -1.15; pose[1] = 0; pose[2] = 0.35; pose[3] = 0.12; pose[4] = -0.30; pose[5] = -0.65;
    } else if (a.phase === 'windup') {
      const wp = SWING_POSE[this._windupDir()].windup;
      lerpPose6(REST_POSE, wp, Math.min(1, a.t / 0.3), pose);
      // charge feedback: the blade pulls back and rises as charge grows
      pose[5] -= 0.16 * a.charge;
      pose[0] += 0.22 * a.charge;
    } else if (a.phase === 'swing') {
      const sp = SWING_POSE[a.dir || 'slashR'];
      const k = 1 - Math.pow(1 - Math.min(1, a.t / w.swing), 3); // easeOutCubic snap
      lerpPose6(sp.windup, sp.end, k, pose);
    } else if (a.phase === 'recover') {
      const sp = SWING_POSE[a.dir || 'slashR'];
      const k = Math.max(0, Math.min(1, a.t / w.recover)); // t may start negative (feint/clash)
      lerpPose6(sp.end, REST_POSE, k * k, pose);
    } else {
      for (let i = 0; i < 6; i++) pose[i] = REST_POSE[i];
    }
    const lerpK = Math.min(1, 22 * dt);
    vm.rotation.x += (pose[0] - vm.rotation.x) * lerpK;
    vm.rotation.y += (pose[1] - vm.rotation.y) * lerpK;
    vm.rotation.z += (pose[2] - vm.rotation.z) * lerpK;
    vm.position.x += (pose[3] - vm.position.x) * lerpK;
    vm.position.y += (pose[4] + bob * 0.5 - vm.position.y) * lerpK;
    // z MUST be restored too — without this restoring lerp the recoil overlay
    // below accumulated forever and the weapon drifted away after every hit
    vm.position.z += (pose[5] - vm.position.z) * lerpK;
    // sway lag + kick jab + weapon-collision recoil on top of the swing pose
    vm.rotation.y += lagYaw * 0.6;
    vm.rotation.x += lagPitch * 0.6;
    this.vmRecoil *= Math.max(0, 1 - 6 * dt);
    if (Math.abs(this.vmRecoil) > 0.01) {
      vm.rotation.x += this.vmRecoil * 0.45;   // + blocked: kicked back / - flesh: bites in
      vm.position.z += this.vmRecoil * 0.12;
    }
    // parry jolt: brief decaying shiver of the arms after YOUR blow is turned
    // aside (world-dt scaled, so hit-stop holds the jolt pose a beat longer)
    if (this._joltT > 0) {
      this._joltT -= dt;
      const jd = cameraFeel().parryJolt;
      const env = Math.max(0, this._joltT) / jd.t; // 1 → 0 envelope
      const osc = Math.sin(this._joltT * jd.oscFreq) * env * jd.oscAmp;
      vm.rotation.z += osc;
      vm.position.x += osc * 0.06;
    }
    if (this.kickT > 0) vm.position.z = -0.65 - Math.sin((0.25 - this.kickT) / 0.25 * Math.PI) * 0.35;
  }

  // Ribbon along the swing's blade path (camera space; the trail mesh is
  // parented to the camera). Samples the same pose interpolation as the
  // viewmodel, so the arc matches the strike direction.
  _writeTrail(frac) {
    const w = this.wstats;
    const pos = this.trail.geometry.attributes.position.array;
    const sp = SWING_POSE[this.attack.dir || 'slashR'];
    const pose = this._trailPose;
    const N = 12;
    for (let i = 0; i < N; i++) {
      const f = frac * i / (N - 1);
      const k = 1 - Math.pow(1 - f, 3); // same easeOutCubic as the viewmodel
      lerpPose6(sp.windup, sp.end, k, pose);
      bladeDir(pose, _bd);
      const base = 0.5, tip = base + Math.min(1.1, w.range * 0.5);
      const i6 = i * 6;
      pos[i6]     = pose[3] + _bd.x * base; pos[i6 + 1] = pose[4] + _bd.y * base; pos[i6 + 2] = pose[5] + _bd.z * base;
      pos[i6 + 3] = pose[3] + _bd.x * tip;  pos[i6 + 4] = pose[4] + _bd.y * tip;  pos[i6 + 5] = pose[5] + _bd.z * tip;
    }
    this.trail.geometry.attributes.position.needsUpdate = true;
    this.trail.visible = true;
  }

  dispose() {
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mousedown', this._onMouseDown);
    document.removeEventListener('mouseup', this._onMouseUp);
    this.game.camera.remove(this.viewRoot);
    this.game.camera.remove(this.crescent);
    this.crescent.geometry.dispose();
    this.crescent.material.dispose();
    this.game.scene.remove(this.trail);
    this.game.camera.remove(this.trail);
    this.trail.geometry.dispose();
    this.trail.material.dispose();
  }
}
