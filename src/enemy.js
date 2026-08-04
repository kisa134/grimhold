// enemy.js — humanoid enemies: per-part HP (head/torso/arms/legs), sever logic,
// crawl state, flinch/stagger, and FSM AI (idle/patrol -> chase -> windup ->
// strike -> cooldown, plus stagger / block / dead).
//
// Rules (documented design choices):
// - Head hits crit x2. Head severed/destroyed or torso HP 0 = instant death.
// - Each lost arm: -40% damage dealt, +50% attack cooldown.
// - One leg destroyed = permanent CRAWL (drops to ground, very slow, still attacks).
// - BOTH legs destroyed = death (bleed-out). Chosen over permanent crawl for readability.
import * as THREE from 'three';
import { MODELS, buildBodyVisuals, buildWeaponVisual } from './models.js';
import {
  SKINNED, MATS, buildSkinnedCharacter, severRegion, enemyParts, Animator,
} from './skinned.js';
import {
  isExecutable, isWounded, isArmoredZone, isDeflected, chargeSeverBonus,
  deathImpulse, blockStaminaCost, chamberMatch, postureGain,
} from './combat.js';
import { CFG } from './config.js';

const WOUND_MAT = new THREE.MeshBasicMaterial({ color: 0x4a0408, side: THREE.DoubleSide });
const BONE_MAT = new THREE.MeshLambertMaterial({ color: 0xe8e4d0, side: THREE.DoubleSide });

// Ragdoll-lite corpse launches are LOCAL-COSMETIC: the flight is applied as a
// visual offset on the enemy's root group, never to this.pos — host MP
// snapshots therefore stream the logical (death) position and proxies are
// unaffected. Cap concurrent physics corpses (CFG.ragdoll.maxRagdolls); the
// oldest settles instantly.
const activeRagdolls = [];

export const ENEMY_TYPES = {
  knight: {
    name: 'Armored Knight', hpMult: 1.8, speed: 1.7, damage: 26, range: 2.2,
    cooldown: 1.8, windup: 0.6, armor: 0.35, canBlock: true, staggerResist: 0.5,
    strafe: false, color: 0x54627e,
  },
  bandit: {
    name: 'Rogue Bandit', hpMult: 0.7, speed: 3.4, damage: 12, range: 1.9,
    cooldown: 1.0, windup: 0.35, armor: 0, canBlock: false, staggerResist: 0,
    strafe: true, color: 0x5a6a34, sidestep: 0.45, sidestepCd: 3.0,
  },
  skeleton: {
    name: 'Undead Skeleton', hpMult: 1.0, speed: 2.3, damage: 16, range: 2.0,
    cooldown: 1.4, windup: 0.5, armor: 0.1, canBlock: false, staggerResist: 0.2,
    strafe: false, color: 0xe6dfc8, lunge: 0.3, lungeCd: 5.0,
  },
};

const PART_DEFS = {
  head:     { size: [0.30, 0.30, 0.30], pos: [0, 1.62, 0],     hp: 30, radius: 0.28, pivot: false },
  torso:    { size: [0.62, 0.62, 0.36], pos: [0, 1.12, 0],     hp: 80, radius: 0.46, pivot: false },
  leftArm:  { size: [0.18, 0.60, 0.18], pos: [-0.42, 1.40, 0], hp: 35, radius: 0.26, pivot: true },
  rightArm: { size: [0.18, 0.60, 0.18], pos: [0.42, 1.40, 0],  hp: 35, radius: 0.26, pivot: true },
  leftLeg:  { size: [0.22, 0.90, 0.22], pos: [-0.17, 0.45, 0], hp: 40, radius: 0.28, pivot: false },
  rightLeg: { size: [0.22, 0.90, 0.22], pos: [0.17, 0.45, 0],  hp: 40, radius: 0.28, pivot: false },
};

// ---- zonal armor (Batch 1: contact quality) ----
// Per-part plate HP pools, in the contract part vocabulary
// (head/torso/armL/armR/legL/legR). Only knight & boss ship with armor; the
// knight's plate is heavier on torso+head and his LIMBS ARE UNARMORED (0) —
// that matches the legacy zone rules (isArmoredZone covers torso/head only).
export const ARMOR_DEFAULTS = {
  knight: { head: 50, torso: 90, armL: 0, armR: 0, legL: 0, legR: 0 },
  boss:   { head: 80, torso: 140, armL: 40, armR: 40, legL: 40, legR: 40 },
};
// Fraction of incoming damage soaked by the plate while it holds, per damage
// type. DESIGN values: plate is genuinely tanky vs the sword (slash 0.6),
// the mace bypasses most of it (blunt 0.2) and wears the pool x1.6 below.
// smoke.mjs owns the exact combat-sim deltas — raise/lower these together
// with those assertions.
export const ARMOR_ABSORB = { slash: 0.6, pierce: 0.5, chop: 0.4, blunt: 0.2 };
// Blunt damage wears the armor POOL x1.6 — the mace is the armor breaker.
export const ARMOR_BLUNT_POOL_MULT = 1.6;
// Contract part names <-> internal part keys (both accepted by the API).
const ARMOR_PART_ALIASES = {
  head: 'head', torso: 'torso',
  armL: 'leftArm', armR: 'rightArm', legL: 'leftLeg', legR: 'rightLeg',
  leftArm: 'leftArm', rightArm: 'rightArm', leftLeg: 'leftLeg', rightLeg: 'rightLeg',
};
const ARMOR_SHORT_NAMES = {
  head: 'head', torso: 'torso', leftArm: 'armL', rightArm: 'armR', leftLeg: 'legL', rightLeg: 'legR',
};

// ---- cosmetic knockback (Batch 1) ----
// applyKnockback is a VISUAL shove on bodyG only — this.pos is never touched,
// so host MP snapshots keep streaming the logical position (MP-safe).
export const KNOCKBACK_DEFAULTS = {
  maxOffset: 0.5,  // hard clamp on the visual displacement (meters)
  maxSpeed: 4,     // shove velocity cap so stacked hits can't fling the mesh
  friction: 10,    // shove velocity decay (1/s)
  returnRate: 6,   // offset spring-back rate (1/s)
  dummyMult: 0.5,  // training dummies take half the shove
  stopSpeed: 0.05, // below this the shove is considered over
};

// Live zonal-armor + knockback knobs: CFG.armor mirrors the tables above
// (tuning panel writes it); the exported consts stay the fallback for tests.
// Read at USE-TIME everywhere so panel edits apply mid-fight.
function armorCfg() {
  const a = (typeof CFG !== 'undefined' && CFG.armor) || {};
  return {
    knight: {
      head: a.knightHead ?? ARMOR_DEFAULTS.knight.head,
      torso: a.knightTorso ?? ARMOR_DEFAULTS.knight.torso,
      armL: 0, armR: 0, legL: 0, legR: 0, // design: knight limbs stay flesh
    },
    boss: {
      head: a.bossHead ?? ARMOR_DEFAULTS.boss.head,
      torso: a.bossTorso ?? ARMOR_DEFAULTS.boss.torso,
      armL: a.bossLimb ?? ARMOR_DEFAULTS.boss.armL,
      armR: a.bossLimb ?? ARMOR_DEFAULTS.boss.armR,
      legL: a.bossLimb ?? ARMOR_DEFAULTS.boss.legL,
      legR: a.bossLimb ?? ARMOR_DEFAULTS.boss.legR,
    },
    absorb: {
      slash: a.absorbSlash ?? ARMOR_ABSORB.slash,
      pierce: a.absorbPierce ?? ARMOR_ABSORB.pierce,
      chop: a.absorbChop ?? ARMOR_ABSORB.chop,
      blunt: a.absorbBlunt ?? ARMOR_ABSORB.blunt,
    },
    bluntPoolMult: a.bluntPoolMult ?? ARMOR_BLUNT_POOL_MULT,
    knockbackMax: a.knockbackMax ?? KNOCKBACK_DEFAULTS.maxOffset,
    knockbackFriction: a.knockbackFriction ?? KNOCKBACK_DEFAULTS.friction,
    dummyMult: a.dummyMult ?? KNOCKBACK_DEFAULTS.dummyMult,
  };
}

const _v = new THREE.Vector3();

// Attack direction tables per archetype (drives chambers & player reads).
// Boss heavies are always overhead — and unparryable (CFG.enemies.bossUnparryable).
const ATK_DIRS = {
  knight:   ['slashR', 'slashL', 'overhead'],
  bandit:   ['slashL', 'slashR', 'stab'],
  skeleton: ['overhead', 'slashR'],
};
// Strike-phase timing per archetype: when the blow lands inside the strike
// phase, and how long the blade stays "live". Skeletons DRAG — late contact.
const STRIKE_T = {
  knight:   { contact: 0.10, dur: 0.24 },
  bandit:   { contact: 0.08, dur: 0.20 },
  skeleton: { contact: 0.18, dur: 0.34 },
  boss:     { contact: 0.12, dur: 0.26 },
};

// ---- duel resolvers (shared by main.js, smoke-tested headlessly) ----

// CHAMBER: the player just started a swing that mirrors an incoming attack.
// Either called on the player's swing start (enemy still winding up) or at the
// enemy's contact frame (player swung at the last instant). No damage either
// side; the enemy is bounced into a short recovery, the player's blade
// continues (that's the reward). Returns the chambered enemy or null.
export function resolveChamber(game, player) {
  if (!player || player.dead || player.blocking) return null;
  const pa = player.attack;
  if (!pa || pa.phase !== 'swing' || !pa.dir) return null;
  const range = (player.wstats ? player.wstats.range : 2.5) + 1.3;
  for (const e of game.enemies) {
    if (e.dead || e.dummy || e.state === 'rise') continue;
    const inWindup = e.state === 'windup' &&
      (e.type.windup - e.stateT) <= CFG.duel.chamberWindow;
    const inStrike = e.state === 'strike' && !e.contactDone &&
      (game.time - (pa.swingStart || 0)) <= CFG.duel.chamberWindow;
    if (!inWindup && !inStrike) continue;
    if (!e.atkDir || !chamberMatch(pa.dir, e.atkDir)) continue;
    if (e.pos.distanceTo(player.pos) > range) continue;
    // CHAMBER! blades meet — gold sparks, metallic shriek, tiny mutual stagger
    e.strikeCanceled = true;
    e.willFeint = false;
    e.staggerT = Math.max(e.staggerT, 0.12);
    e.state = 'chase';
    e.stateT = 0;
    e.cooldownT = Math.max(e.cooldownT, CFG.duel.chamberRecovery);
    e.parts.rightArm.mesh.rotation.x = 0;
    _v.copy(e.pos).setY(e.pos.y + 1.4).add(player.pos).multiplyScalar(0.5);
    _v.y = (e.pos.y + 1.4 + player.pos.y + 1.5) * 0.5;
    if (game.sparks) game.sparks.burst(_v, 30, 'gold');
    game.audio.chamber(_v);
    if (game.debugLine) game.debugLine(`CHAMBER! ${pa.dir} vs ${e.atkDir}`);
    return e;
  }
  return null;
}

// WEAPON CLASH mid-swing: the player's sweep volume meets an enemy's live
// blade (enemy in strike phase, contact not yet dealt, facing each other).
// Both recover. Cosmetic + local-feel only; host-authoritative damage is
// unaffected (the enemy's blow is canceled before it lands).
export function resolveClash(game, player) {
  if (!CFG.duel.clashEnabled || !player || player.dead) return null;
  const pa = player.attack;
  if (!pa || pa.phase !== 'swing' || pa.clashed) return null;
  const pfx = -Math.sin(player.yaw || 0), pfz = -Math.cos(player.yaw || 0);
  for (const e of game.enemies) {
    if (e.dead || e.dummy || e.state !== 'strike' || e.contactDone) continue;
    if (e.pos.distanceTo(player.pos) > CFG.duel.clashRange) continue;
    // facing each other?
    const ex = e.pos.x - player.pos.x, ez = e.pos.z - player.pos.z;
    const d = Math.hypot(ex, ez) || 1;
    if (pfx * (ex / d) + pfz * (ez / d) < 0.3) continue;
    const efx = Math.sin(e.yaw), efz = Math.cos(e.yaw);
    if (efx * (-ex / d) + efz * (-ez / d) < 0.3) continue;
    // CLASH — orange sparks, grinding clang, both recover
    pa.clashed = true;
    pa.phase = 'recover';
    pa.t = (player.wstats ? player.wstats.recover : 0.2) - CFG.duel.clashRecovery; // may go negative = longer
    e.strikeCanceled = true;
    e.willFeint = false;
    e.staggerT = Math.max(e.staggerT, 0.12);
    e.state = 'chase';
    e.stateT = 0;
    e.cooldownT = Math.max(e.cooldownT, CFG.duel.clashRecovery);
    e.parts.rightArm.mesh.rotation.x = 0;
    _v.copy(e.pos).setY(e.pos.y + 1.3).lerp(new THREE.Vector3(player.pos.x, player.pos.y + 1.5, player.pos.z), 0.5);
    if (game.sparks) game.sparks.burst(_v, 26, 'orange');
    game.audio.clash(_v);
    if (game.debugLine) game.debugLine('CLASH — blades meet mid-swing');
    return e;
  }
  return null;
}

export class Enemy {
  constructor(game, spawn) {
    this.game = game;
    this.kind = spawn.type; // 'knight' | 'bandit' | 'skeleton' (mp snapshots)
    this.boss = !!spawn.boss;
    this.dummy = !!spawn.dummy; // training-room practice dummy: no AI
    this.bossPhase = 1;
    this.refreshType(); // this.type = static archetype + live CFG overrides
    this.name = this.boss ? 'The Gate Warden' : this.type.name;

    this.pos = new THREE.Vector3(spawn.x, 0, spawn.z);
    // explicit spawn height wins (labyrinth spawns sit under ground-level floors)
    this.pos.y = spawn.y !== undefined ? spawn.y : game.level.floorHeightAt(spawn.x, spawn.z, 2);
    this.home = this.pos.clone();
    this.yaw = Math.random() * Math.PI * 2;
    this.knock = new THREE.Vector3();
    // cosmetic knockback: visual shove offset on bodyG (never this.pos)
    this.kbOff = new THREE.Vector3();
    this.kbVel = new THREE.Vector3();
    // zonal armor pools (knight/boss): per-part plate HP; missing key = none
    this.armor = {};       // partKey -> remaining pool
    this.armorMax = {};    // partKey -> starting pool (0/absent = never armored)
    this.armorBroken = {}; // partKey -> true once the break hook has fired
    const armorTable = armorCfg()[this.boss ? 'boss' : this.kind];
    if (armorTable) {
      for (const [short, hp] of Object.entries(armorTable)) {
        const key = ARMOR_PART_ALIASES[short];
        if (key && hp > 0) { this.armor[key] = hp; this.armorMax[key] = hp; }
      }
    }

    this.state = 'idle';
    this.stateT = 0;
    this.cooldownT = 0;
    this.staggerT = 0;
    this.blockT = 0;
    this.blockCd = 0;
    this.crawl = false;
    this.dead = false;
    this.deathT = 0;
    this.aggro = false;
    this.patrolTarget = null;
    this.dmgMult = 1;
    this.cdMult = 1;
    this.strafeT = Math.random() * 10;
    this.sidestepT = 0;      // active sidestep velocity timer
    this.sidestepDir = 1;
    this.sidestepCd = 0;
    this.lungeCd = 0;
    this.lungeBoostT = 0;
    this.flinchT = 0;        // sympathetic flinch (ally decapitated)
    this.executed = false;
    this.bleeds = [];        // open-wound timers
    // ---- duel state (stamina war, directional attacks, feints/parries) ----
    this.maxStamina = CFG.duel.enemyStamina;
    this.stamina = this.maxStamina;
    // ---- posture (poise) meter: fills on hits, breaks into a long stagger ----
    this.posture = 0;
    this.postureDown = false;
    const pk = this.boss
      ? { max: CFG.enemies.bossPostureMax, reg: CFG.enemies.bossPostureRegen,
          br: CFG.enemies.bossPostureBreakStagger }
      : { max: (this.type.postureMax ?? 100), reg: (this.type.postureRegen ?? 14),
          br: (this.type.postureBreakStagger ?? 2.2) };
    this.postureMax = pk.max ?? 100;
    this.postureRegen = pk.reg ?? 14;
    this.postureBreakStagger = pk.br ?? 2.2;
    this.atkDir = null;         // direction of the current/last attack
    this.atkUnparryable = false;// boss red-flash heavy: smashes through parries
    this.willFeint = false;     // rolled at windup start
    this.feints = 0;            // lifetime feint counter (debug/tests)
    this.strikeCanceled = false;// chambered or clashed out of this strike
    this.contactDone = false;   // strike contact frame already resolved
    this.parryUntil = -99;      // game.time deadline for an ACTIVE enemy parry
    this.guardBroken = false;   // guard smashed by stamina exhaustion
    this._bleedAcc = 0;
    this._dripT = 0;
    this._dominoT = 0;
    this._lastHitDir = null;
    this.deathDir = null;
    this.riseT = spawn.rise ? 1.1 : 0; // ambush: claw up from the floor
    if (this.riseT > 0) this.state = 'rise';

    // --- build body ---
    this.group = new THREE.Group();
    this.group.rotation.order = 'YXZ'; // yaw, then pitch — used by the death fall
    this.group.position.copy(this.pos);
    this.bodyG = new THREE.Group();
    this.group.add(this.bodyG);
    game.scene.add(this.group);

    const baseColor = this.boss ? 0x4a2a30 : this.type.color;
    this.parts = {};
    for (const [key, def] of Object.entries(PART_DEFS)) {
      const mat = new THREE.MeshLambertMaterial({ color: baseColor });
      const geo = new THREE.BoxGeometry(...def.size);
      if (def.pivot) geo.translate(0, -def.size[1] / 2 + 0.05, 0); // shoulder pivot
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(...def.pos);
      this.bodyG.add(mesh);
      const php = (CFG.parts[key] && CFG.parts[key].hp) || def.hp;
      this.parts[key] = {
        key, mesh,
        hp: php * this.type.hpMult, maxHp: php * this.type.hpMult,
        radius: def.radius, size: def.size, pivot: def.pivot,
        state: 'intact', flashT: 0, wounds: [],
      };
    }
    // head detail: glowing eyes for skeleton, plume for boss
    if (spawn.type === 'skeleton') {
      const eyes = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 0.06, 0.05),
        new THREE.MeshBasicMaterial({ color: 0x66ff66 })
      );
      eyes.position.set(0, 0.03, 0.16);
      this.parts.head.mesh.add(eyes);
    }
    if (this.boss) {
      const plume = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.3, 0.24),
        new THREE.MeshLambertMaterial({ color: 0xa01220 })
      );
      plume.position.y = 0.26;
      this.parts.head.mesh.add(plume);
    } else if (spawn.type === 'knight') {
      // silhouette marker: dark blue plume so knights read at distance
      const plume = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.24, 0.2),
        new THREE.MeshLambertMaterial({ color: 0x2a3a5a })
      );
      plume.position.y = 0.24;
      this.parts.head.mesh.add(plume);
    }
    // crude hand weapon (telegraphs attacks; disappears if the arm is severed)
    const wmat = new THREE.MeshLambertMaterial({ color: 0x8a8f9a });
    this.handWeapon = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.8, 0.06), wmat);
    this.handWeapon.position.set(0, -0.65, 0.1);
    this.parts.rightArm.mesh.add(this.handWeapon);

    // --- character visuals ---
    // Priority 1: REAL Synty skinned rig + mocap clips (src/skinned.js).
    // Priority 2: static Synty parts on the hitboxes. Fallback: boxes.
    this.hasModel = false;
    this.skinned = null;
    this.anim = null;
    this._ovrT = 0;         // one-shot animation override timer
    this.wieldVisual = null;
    this.shieldVisual = null;
    if (SKINNED.ready) {
      const kind = this.boss ? 'boss' : spawn.type;
      const partNames = enemyParts(kind);
      if (partNames) {
        const baseMat = kind === 'skeleton' ? MATS.bone() : kind === 'boss' ? MATS.boss() : MATS.atlas();
        this.regionMats = {};
        const c = buildSkinnedCharacter(partNames, (region) =>
          this.regionMats[region] ||= baseMat.clone());
        if (c) {
          this.skinned = c;
          this.anim = new Animator(c.root);
          this.bodyG.add(c.group);
          for (const p of Object.values(this.parts)) {
            p.mesh.material.visible = false; // hitboxes become pure logic
            if (this.regionMats[p.key]) p.flashMats = [this.regionMats[p.key]];
          }
          this.handWeapon.visible = false;
          // real weapon parented to the right-hand bone (bone space is in
          // centimeters — the rig wrapper is scaled 0.01, hence counter-x100)
          const handR = c.bones.get('Hand_R');
          const wkey = spawn.type === 'bandit' ? 'dagger'
            : spawn.type === 'skeleton' ? 'axe' : 'sword';
          const wv = buildWeaponVisual(this.boss ? 'sword' : wkey);
          if (handR && wv) {
            wv.scale.setScalar(100);
            wv.rotation.set(Math.PI / 2, 0, Math.PI / 2); // verified via grip.html test
            handR.add(wv);
            this.wieldVisual = wv;
          }
          if (spawn.type === 'knight' || this.boss) {
            const handL = c.bones.get('Hand_L');
            const sh = buildWeaponVisual('shield');
            if (handL && sh) {
              sh.scale.setScalar(100);
              sh.rotation.set(Math.PI / 2, 0, Math.PI / 2);
              handL.add(sh);
              this.shieldVisual = sh;
            }
          }
          if (spawn.type === 'skeleton') {
            // glowing eyes on the head bone — undead readability in the dark
            const headBone = c.bones.get('Head');
            if (headBone) {
              const eyes = new THREE.Mesh(
                new THREE.BoxGeometry(20, 5, 4),
                new THREE.MeshBasicMaterial({ color: 0x66ff66 }));
              eyes.position.set(0, 10, 9);
              headBone.add(eyes);
            }
          }
          this.anim.play(kind === 'skeleton' ? 'menacing' : 'idle');
          this.hasModel = true;
        }
      }
    }
    if (!this.hasModel && MODELS.ready) {
      const vis = buildBodyVisuals(spawn.type, this.boss);
      if (vis) {
        this.hasModel = true;
        for (const [key, list] of Object.entries(vis)) {
          const part = this.parts[key];
          if (!part) continue;
          part.flashMats = part.flashMats || [];
          for (const v of list) {
            part.mesh.add(v);
            v.traverse((o) => { if (o.isMesh && o.material) part.flashMats.push(o.material); });
          }
        }
        // hide placeholder box geometry; the mesh stays as logic anchor
        for (const p of Object.values(this.parts)) p.mesh.material.visible = false;
        // real weapon models in hand (blade points up along the hanging arm)
        this.handWeapon.visible = false;
        const wkey = spawn.type === 'bandit' ? 'dagger'
          : spawn.type === 'skeleton' ? 'axe' : 'sword';
        const wv = buildWeaponVisual(this.boss ? 'sword' : wkey);
        if (wv) {
          wv.position.set(0, -0.62, 0.06);
          this.parts.rightArm.mesh.add(wv);
        }
        if (spawn.type === 'knight' || this.boss) {
          const sh = buildWeaponVisual('shield');
          if (sh) {
            sh.position.set(-0.06, -0.38, 0);
            sh.rotation.z = Math.PI / 2;
            this.parts.leftArm.mesh.add(sh);
          }
        }
      }
    }

    this.armsLost = 0;
    this.legsLost = 0;
    // Task 4: limp + footsteps state
    this._stepAcc = 0;       // distance walked since the last step sound
    this._stepAlt = false;
    this._lastStepPos = this.pos.clone();
    this._limpPhase = 0;     // procedural limp roll phase
    this._gutsSpilled = false;
  }

  // Build (or rebuild) this.type from the static archetype + live CFG
  // overrides. Called at spawn and whenever the tuning panel touches the
  // enemies group, so speed/damage edits apply to living enemies too.
  refreshType() {
    const base = ENEMY_TYPES[this.kind] || ENEMY_TYPES.bandit;
    this.type = { ...base, ...(CFG.enemies[this.kind] || {}) };
    if (this.boss) {
      this.type = {
        ...this.type,
        hpMult: CFG.enemies.bossHpMult,
        damage: CFG.enemies.bossDamage,
        speed: CFG.enemies.bossSpeed,
        windup: CFG.enemies.bossWindup,
      };
      this.baseWindup = this.type.windup;
      if (this.bossPhase === 2) {
        // re-apply the enrage mutations on top of the fresh base
        this.type.canBlock = false;
        this.type.windup = this.baseWindup * 0.55;
        this.type.cooldown *= 0.6;
        this.type.speed *= 1.25;
      }
    }
  }

  // Bone attachment point for gore decals on skinned bodies (rig is in cm —
  // children of bones counter-scale automatically, see skinned.js header).
  _boneForPart(key) {
    if (!this.skinned) return null;
    const MAP = {
      head: ['Head'],
      torso: ['Spine2', 'Spine1', 'Spine', 'Hips'],
      leftArm: ['Hand_L', 'Hips'],
      rightArm: ['Hand_R', 'Hips'],
      leftLeg: ['Foot_L', 'Hips'],
      rightLeg: ['Foot_R', 'Hips'],
    };
    for (const n of MAP[key] || []) {
      const b = this.skinned.bones.get(n);
      if (b) return b;
    }
    return null;
  }

  // ---- zonal armor API (Batch 1) ----

  // Remaining plate HP on a part; 0 means unarmored or broken. Accepts the
  // contract names (head/torso/armL/armR/legL/legR) and internal part keys.
  armorAt(partName) {
    const key = ARMOR_PART_ALIASES[partName];
    return key ? (this.armor[key] || 0) : 0;
  }

  // Soak a blow with the part's plate while it holds. Returns { absorbed,
  // broke }: absorbed = damage the armor ate (caller subtracts it from the
  // flesh damage), broke = true only on the hit that depletes the pool.
  // Blunt wears the pool x bluntPoolMult (mace = armor breaker).
  // On depletion the plate is PERMANENTLY broken for this enemy part and
  // game.onArmorBreak(enemy, partName, pos) fires exactly once.
  damageArmor(partName, dmg, damageType = 'slash') {
    if (this.dead) return { absorbed: 0, broke: false };
    const key = ARMOR_PART_ALIASES[partName];
    if (!key || dmg <= 0) return { absorbed: 0, broke: false };
    const pool = this.armor[key] || 0;
    if (pool <= 0) return { absorbed: 0, broke: false };
    const A = armorCfg();
    const absorbed = dmg * (A.absorb[damageType] ?? A.absorb.slash);
    const wear = dmg * (damageType === 'blunt' ? A.bluntPoolMult : 1);
    this.armor[key] = Math.max(0, pool - wear);
    let broke = false;
    if (this.armor[key] <= 0 && !this.armorBroken[key]) {
      this.armorBroken[key] = true;
      broke = true;
      this._onArmorBreak(key);
    }
    return { absorbed, broke };
  }

  // Plate gives out on a part: dent decal + the one-shot game hook (sparks,
  // audio.armorBreak, hitstop etc. are wired from main.js via onArmorBreak).
  _onArmorBreak(partKey) {
    const part = this.parts[partKey];
    const pos = new THREE.Vector3();
    if (part) part.mesh.getWorldPosition(pos); else pos.copy(this.pos);
    if (this.game.gore && typeof this.game.gore.armorDent === 'function') {
      this.game.gore.armorDent(this, partKey, pos);
    }
    const short = ARMOR_SHORT_NAMES[partKey] || partKey;
    if (typeof this.game.onArmorBreak === 'function') this.game.onArmorBreak(this, short, pos);
    if (this.game.notify) this.game.notify(`${this.name} — ${short.toUpperCase()} ARMOR BROKEN!`, '#ffd040');
    if (this.game.debugLine) this.game.debugLine(`ARMOR BREAK: ${this.name} ${short}`);
  }

  // ---- cosmetic knockback (Batch 1) ----

  // Visual knockback shove: a short displacement on bodyG that springs back
  // to zero (like flinch). this.pos is NEVER touched — MP-safe cosmetic;
  // remote proxies can play this locally. Dummies take half. power ~1 = a
  // light hit, ~2.5 = a heavy mace blow; the offset clamps at ~0.5 m.
  applyKnockback(dirVec3, power = 1) {
    if (this.dead || !dirVec3) return;
    const k = KNOCKBACK_DEFAULTS;
    const p = power * (this.dummy ? armorCfg().dummyMult : 1);
    this.kbVel.x += dirVec3.x * p;
    this.kbVel.z += dirVec3.z * p;
    if (dirVec3.y) this.kbVel.y += dirVec3.y * p * 0.3; // mostly horizontal
    const s = this.kbVel.length();
    if (s > k.maxSpeed) this.kbVel.multiplyScalar(k.maxSpeed / s);
  }

  // Limping: one leg WOUNDED (below half HP) but neither destroyed (that crawls).
  get limping() {
    if (this.crawl || this.dead) return false;
    const l = this.parts.leftLeg, r = this.parts.rightLeg;
    return isWounded(l) || isWounded(r);
  }

  get voiceKind() { return this.boss ? 'boss' : this.kind; }

  // ---- damage entry point (called by the melee sweep) ----
  takeHit(partKey, baseDmg, dtype, wstats, heavy, srcPos, opts = {}) {
    if (this.dead) return null;
    const part = this.parts[partKey];
    if (!part || part.state !== 'intact') return null;

    const p = this.game.player;
    const riposte = p && this.game.time <= p.riposteUntil;
    const executing = heavy && isExecutable(this);
    const grazed = !!opts.grazed;
    const wasBlocking = this.state === 'block'; // weapon caught on their guard

    // ENEMY ACTIVE PARRY (knights): the blow is turned aside entirely —
    // no damage, no stagger; the defender immediately looks for a punish.
    if (this.state === 'block' && this.game.time <= this.parryUntil) {
      this.parryUntil = -99;
      this.cooldownT = Math.min(this.cooldownT, 0.15); // punish attempt
      part.mesh.getWorldPosition(_v);
      if (this.game.sparks) this.game.sparks.burst(_v, 26, 'white');
      this.game.audio.clangHeavy(_v);
      this.game.audio.blockPing(true);
      if (this.game.debugLine) this.game.debugLine(`${this.name} PARRIES your blow`);
      return { dmg: 0, crit: false, killed: false, executed: false,
        deflected: false, grazed: !!opts.grazed, blocked: true, parried: true };
    }

    // Zonal armor: while the part's plate holds it soaks a fraction of the
    // blow (ARMOR_ABSORB) and the pool wears down; once broken, hits go
    // straight to flesh at FULL damage and light blows no longer deflect.
    const armorPool = this.armorAt(partKey);
    const deflected = isDeflected(this.type, partKey, dtype, heavy, executing, riposte) && armorPool > 0;
    this._lastHitHeavy = heavy;
    // remember the blow that may kill us — drives the ragdoll 2.0 launch
    this._lastWeaponKey = wstats.key || 'sword';
    this._lastAttackDir = opts.dir || null;
    this._lastCharge = opts.charge || 0;

    let crit = partKey === 'head' ? 2 : 1;
    if (riposte) crit *= opts.riposteMult || 2;
    // pipeline: base * crit * (execute / graze / block) first, armor soaks last
    const preArmor = baseDmg * crit * (executing ? CFG.combat.executeDmgMult : 1)
      * (grazed ? CFG.combat.grazeDmgMult : 1)
      * (this.state === 'block' && !executing ? 0.25 : 1); // executions ignore block
    let dmg;
    let armorRes = null;
    if (deflected) {
      dmg = Math.round(preArmor * CFG.combat.deflectMult);
    } else if (!executing && armorPool > 0) {
      armorRes = this.damageArmor(partKey, preArmor, dtype);
      dmg = Math.round(preArmor - armorRes.absorbed);
    } else if (!executing && isArmoredZone(this.type, partKey) && dtype !== 'blunt' &&
        !this.armorMax[partKey]) {
      dmg = Math.round(preArmor * (1 - this.type.armor)); // legacy flat armor (non-zoned)
    } else {
      dmg = Math.round(preArmor);
    }
    part.hp -= dmg;
    part.flashT = 0.12;

    // blood (flesh) or sparks (armor deflection) + flinch + knockback
    part.mesh.getWorldPosition(_v);
    const dir = _v.clone().sub(srcPos).setY(0).normalize();
    this._lastHitDir = dir.clone();
    if (deflected) {
      this.game.gore.spark(_v);
    } else if (armorRes && armorRes.absorbed > 0.5) {
      // plate soaked the blow: dent the armor, only a little blood seeps out
      if (typeof this.game.gore.armorDent === 'function') this.game.gore.armorDent(this, partKey, _v);
      const g = CFG.gore;
      const n = Math.min(g.bloodMax, g.bloodBase + Math.round(dmg * g.bloodPerDmg));
      this.game.gore.burst(_v, Math.max(2, Math.round(n * 0.25)), 1.6, dir);
    } else {
      const g = CFG.gore;
      const n = Math.min(g.bloodMax, g.bloodBase + Math.round(dmg * g.bloodPerDmg));
      this.game.gore.burst(_v, grazed ? Math.round(n * 0.4) : n, 2.6, dir);
      this._addWoundDecal(part);
    }
    const staggerMult = deflected ? 0.4 : grazed ? 0.5 : 1;
    this.staggerT = Math.min(CFG.enemies.staggerCap, this.staggerT + wstats.stagger * (heavy ? 1.5 : 1)
      * (1 - this.type.staggerResist) * staggerMult);
    if (this.state !== 'block') this.state = 'stagger';
    this.stateT = 0;
    // blocked hits bleed the defender's stamina; at zero the guard BREAKS
    if (this.state === 'block' && !executing) {
      this.stamina -= blockStaminaCost(dmg);
      if (this.stamina <= 0) {
        this.stamina = this.maxStamina * 0.35;
        this.blockT = 0;
        this.guardBroken = true;
        this.staggerT = CFG.duel.guardBreakStagger;
        this.state = 'stagger';
        this.stateT = 0;
        this.parts.rightArm.mesh.rotation.x = 0;
        part.mesh.getWorldPosition(_v);
        this.game.audio.guardBreak(_v);
        this.game.notify(`${this.name}'s guard is BROKEN!`, '#ff5040');
        if (this.game.debugLine) this.game.debugLine(`GUARD BREAK on ${this.name}`);
        this.playOvr('stagger', CFG.duel.guardBreakStagger * 0.7);
      }
    }
    // mocap hit reaction: big staggers get the full stagger clip, ordinary
    // hits a directional flinch (front/left/right read from the blow)
    if (this.anim && this.state === 'stagger') {
      const big = this.staggerT > 0.85;
      if (big || this._ovrT <= 0.25) {
        let key = 'stagger';
        let dur = 0.85;
        if (!big) {
          const rightX = Math.cos(this.yaw), rightZ = -Math.sin(this.yaw);
          const side = rightX * dir.x + rightZ * dir.z;
          key = side > 0.5 ? 'hitR' : side < -0.5 ? 'hitL' : 'hitF';
          dur = 0.5;
        }
        this.playOvr(key, dur);
      }
    }
    this.knock.addScaledVector(dir, (2 + wstats.stagger * 2) * (1 - this.type.staggerResist)
      * (grazed ? 0.5 : 1));
    // cosmetic shove on top of the logical knock (decays back; MP-safe)
    this.applyKnockback(dir, (heavy ? 2.2 : 1.1) * (1 - this.type.staggerResist) * (grazed ? 0.5 : 1));
    this.aggro = true;

    // heavy non-lethal blow: a short pained grunt from the victim
    if (!this.dead && !deflected && !grazed && heavy && dmg >= 18) {
      this.game.audio.scream(this.voiceKind, 'grunt', _v);
    }
    // heavy torso trauma: viscera squeezes out even before the killing blow
    if (!this.dead && !deflected && partKey === 'torso' && heavy && dmg >= 25) {
      this._gutsSpilled = true;
      this.game.gore.spawnGuts(_v.clone(), 1);
    }

    // charge carried on the swing raises the sever roll (Task 1)
    const chargeSever = opts.charge ? chargeSeverBonus(opts.charge) : 0;
    if (executing) {
      this.executed = true;
      this.game.audio.executeBoom(_v);
      this.game.onExecution(this, part);
      // force the sever of the aimed part
      this._destroyPart(part, dtype, wstats, heavy, dir, 2.0 + chargeSever);
    } else if (part.hp <= 0) {
      this._destroyPart(part, dtype, wstats, heavy, dir,
        (riposte ? (opts.severBonus || 0) : 0) + chargeSever);
    }

    // overkill: heavy chop into an already dead/dying body bursts the torso
    if (this.dead && !this.gibbed && heavy && dtype === 'chop' && dmg >= CFG.combat.gibOverkillDmg) {
      this.gib();
    }
    if (riposte && p) p.riposteUntil = -99; // consume the riposte window

    // wound tint when a surviving part drops below half HP
    this._applyWoundTint(part);

    const res = { dmg, crit: crit > 1, killed: this.dead, executed: executing, deflected, grazed,
      blocked: wasBlocking, absorbed: armorRes ? Math.round(armorRes.absorbed) : 0,
      armorBroke: !!(armorRes && armorRes.broke), postureBroke: false };

    // ---- posture accrual: chip the poise even through a raised guard ----
    const g = postureGain(res.dmg, (wstats && wstats.key) || 'sword', heavy, !!res.blocked);
    this.posture = Math.min(this.postureMax, this.posture + g);
    if (this.posture >= this.postureMax && !this.postureDown && !this.dead) {
      res.postureBroke = true;
      this.postureBreak();
    }
    return res;
  }

  // Poise shattered: long stagger (> executeStaggerMin, so an execution opens).
  postureBreak() {
    this.postureDown = true;
    this.staggerT = Math.max(this.staggerT, this.postureBreakStagger);
    if (this.game?.ui?.notify) this.game.ui.notify(`${this.name} POSTURE BROKEN!`, '#ffd24a');
  }

  // Dark wound spot that sticks to the part (max CFG.gore.woundMax per part).
  // Skinned bodies: a small dark plane parented to the nearest bone (bone
  // space is in centimeters, so ~10 units ≈ 10 cm of wound).
  _addWoundDecal(part) {
    if (part.wounds.length >= CFG.gore.woundMax) return;
    if (this.skinned) {
      const bone = this._boneForPart(part.key);
      if (!bone) return;
      const w = new THREE.Mesh(
        new THREE.PlaneGeometry(9 + Math.random() * 7, 9 + Math.random() * 7), WOUND_MAT);
      w.position.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, 8);
      w.rotation.z = Math.random() * Math.PI;
      bone.add(w);
      part.wounds.push(w);
      return;
    }
    const s = part.size;
    const w = new THREE.Mesh(
      new THREE.PlaneGeometry(0.1 + Math.random() * 0.08, 0.1 + Math.random() * 0.08), WOUND_MAT);
    w.position.set(
      (Math.random() - 0.5) * s[0] * 0.6,
      (Math.random() - 0.5) * s[1] * 0.6,
      s[2] / 2 + 0.006);
    w.rotation.z = Math.random() * Math.PI;
    part.mesh.add(w);
    part.wounds.push(w);
  }

  // Wounded part: dark bloody tint (pivot arms also dangle — see update()).
  _applyWoundTint(part) {
    if (part.wounded || !isWounded(part)) return;
    part.wounded = true;
    part.mesh.material.color.multiplyScalar(0.55);
    part.mesh.material.color.lerp(new THREE.Color(0x5a0a0a), 0.45);
    if (part.flashMats) {
      for (const m of part.flashMats) {
        m.color.multiplyScalar(0.55);
        m.color.lerp(new THREE.Color(0x5a0a0a), 0.45);
      }
    }
  }

  // Parried: long stagger + expose for EXECUTE. The ATTACKER (this enemy)
  // bleeds stamina for getting parried — the stamina war cuts both ways.
  applyParry() {
    this.staggerT = CFG.combat.parryStagger;
    this.stamina = Math.max(0, this.stamina - CFG.duel.parryStaminaDmg);
    this.state = 'stagger';
    this.stateT = 0;
    this.aggro = true;
    this.parts.rightArm.mesh.rotation.x = 0;
    this.playOvr('stagger', CFG.combat.parryStagger * 0.75);
  }

  // Kicked: tiny damage, big stagger, breaks block.
  applyKick(dmg, srcPos) {
    if (this.dead) return;
    this.parts.torso.hp -= dmg;
    this.parts.torso.flashT = 0.12;
    this.blockT = 0;
    this.staggerT = Math.max(this.staggerT, CFG.combat.kickStagger);
    this.state = 'stagger';
    this.stateT = 0;
    this.aggro = true;
    this.playOvr('stagger', 1.0);
    const kickDir = this.pos.clone().sub(srcPos).setY(0).normalize();
    this.knock.addScaledVector(kickDir, 3.2 * (1 - this.type.staggerResist));
    this.applyKnockback(kickDir, 1.8 * (1 - this.type.staggerResist)); // cosmetic shove
    this.parts.torso.mesh.getWorldPosition(_v);
    this.game.gore.burst(_v, 8, 1.6, null);
    this._applyWoundTint(this.parts.torso);
    if (this.parts.torso.hp <= 0) this.die();
  }

  // Sympathetic flinch when a nearby ally is decapitated.
  flinch(t) {
    if (this.dead) return;
    this.flinchT = Math.max(this.flinchT, t);
    if (this.state === 'windup') { this.state = 'chase'; this.parts.rightArm.mesh.rotation.x = 0; }
    if (this._ovrT <= 0.2) this.playOvr('hitF', 0.45);
  }

  // Torso burst: the body explodes into gib chunks.
  gib() {
    if (this.gibbed) return;
    this.gibbed = true;
    this._gutsSpilled = true;
    this.parts.torso.mesh.getWorldPosition(_v);
    const gc = CFG.gore;
    this.game.gore.spawnGibs(_v.clone(), 0x8a1016,
      gc.gibBase + Math.floor(Math.random() * gc.gibRand));
    this.game.gore.spawnGuts(_v.clone()); // viscera rides the burst
    this.game.gore.burst(_v, gc.gibBurst, 4.4, null);
    this.game.gore.wallSplat(_v.clone(), _v.clone().sub(this.game.player.pos).setY(0).normalize());
    this.parts.torso.mesh.visible = false;
    this.parts.torso.state = 'destroyed';
    if (this.skinned) {
      // the whole body is gone — hide every region
      for (const r of Object.keys(this.skinned.regionMeshes)) severRegion(this.skinned, r);
      if (this.wieldVisual) this.wieldVisual.visible = false;
      if (this.shieldVisual) this.shieldVisual.visible = false;
    }
    this.game.onGib();
    if (!this.dead) this.die();
  }

  _destroyPart(part, dtype, wstats, heavy, dir, severBonus = 0) {
    // roll sever: weapon sever * heavy bonus; blunt rarely severs
    let chance = (wstats.sever + severBonus) * (heavy ? 1.5 : 1);
    if (dtype === 'blunt') chance *= 0.4;
    if (part.key === 'head') chance *= 1.2;
    const severed = Math.random() < chance;

    part.mesh.getWorldPosition(_v);
    if (severed) {
      // grab the real region mesh BEFORE hiding it, so gore can drop a real model chunk
      const regionMeshes = (this.skinned && this.skinned.regionMeshes[part.key]) || [];
      const realMesh = regionMeshes.find((m) => m.visible) || regionMeshes[0] || null;
      part.state = 'severed';
      part.mesh.visible = false;
      if (this.skinned) {
        severRegion(this.skinned, part.key);
        if (part.key === 'rightArm' && this.wieldVisual) this.wieldVisual.visible = false;
        if (part.key === 'leftArm' && this.shieldVisual) this.shieldVisual.visible = false;
      }
      // drop the REAL body part (not a box) using its cloned mesh
      this.game.gore.spawnSeveredMesh(realMesh, _v.clone(), { size: part.size, color: part.mesh.material.color.getHex() });
      // limb logic handled in _applyPartEffects (arms -> no attack, legs -> crawl)
      // arterial spray oriented along the cut, away from the body
      const sprayDir = dir.clone().multiplyScalar(1.4);
      this.game.gore.burst(_v, CFG.gore.severBurst, CFG.gore.severBurstPower, sprayDir);
      this.game.notify(`${this.name} — ${part.key.toUpperCase()} SEVERED!`, '#ff4040');
      this.game.audio.severCrunch(_v);
      this.game.audio.scream(this.voiceKind, 'sever', _v); // big yell
      if (part.key === 'head') {
        // decapitation spectacle: fountain, wall spray, slow-mo, allied flinch
        this._decapitated = true;
        this.game.gore.fountain(_v.clone().add(new THREE.Vector3(0, -0.15, 0)), CFG.gore.fountainDecapDur);
        this.game.gore.wallSplat(_v.clone(), dir);
        this.game.audio.decapitation(_v);
        this.game.decapSlowmo();
        this.game.onDecapitation();
        for (const e of this.game.enemies) {
          if (e !== this && !e.dead && e.pos.distanceTo(this.pos) < CFG.combat.allyFlinchRadius) {
            e.flinch(CFG.combat.allyFlinchT);
          }
        }
      } else {
        // limb stump: smaller, shorter-lived pulsing spray from the wound
        this.game.gore.fountain(_v.clone(), CFG.gore.fountainLimbDur, CFG.gore.fountainLimbScale);
        if (heavy) this.game.gore.wallSplat(_v.clone(), dir);
      }
    } else {
      part.state = 'destroyed';
      part.mesh.material.color.multiplyScalar(0.45);
      if (part.flashMats) for (const m of part.flashMats) m.color.multiplyScalar(0.45);
      this.game.gore.burst(_v, 40, 2.6, dir);
      this.game.audio.severCrunch(_v);
      if (this.skinned) {
        // mangled beyond use — hide the region, drop anything it held
        severRegion(this.skinned, part.key);
        if (part.key === 'rightArm' && this.wieldVisual) this.wieldVisual.visible = false;
        if (part.key === 'leftArm' && this.shieldVisual) this.shieldVisual.visible = false;
      } else {
        // exposed bone in the wound
        const bone = new THREE.Mesh(
          new THREE.BoxGeometry(part.size[0] * 0.4, Math.min(0.14, part.size[1] * 0.3), part.size[2] * 0.4),
          BONE_MAT);
        bone.position.y = part.pivot ? -(part.size[1] - 0.14) : part.size[1] / 2 - 0.05;
        part.mesh.add(bone);
      }
    }
    this.game.gore.decal(this.pos.x, this.pos.y, this.pos.z, severed ? 1.6 : 1.0);
    // organ gore: torso blows spill guts, head blows burst brains + skull shards
    if (part.key === 'torso') {
      this._gutsSpilled = true;
      this.game.gore.spawnGuts(_v.clone());
    } else if (part.key === 'head') {
      this.game.gore.spawnBrains(_v.clone());
      this.game.audio.squelch(_v);
    }
    this._applyPartEffects();

    if (part.key === 'head') this.die(); // torso cannot be severed; only hp 0 kills (see update)
    else this.bleeds.push(CFG.combat.bleedT); // an open limb wound bleeds
  }

  _applyPartEffects() {
    this.armsLost = ['leftArm', 'rightArm'].filter(k => this.parts[k].state !== 'intact').length;
    this.legsLost = ['leftLeg', 'rightLeg'].filter(k => this.parts[k].state !== 'intact').length;
    this.dmgMult = 1 - 0.4 * this.armsLost;
    this.cdMult = 1 + 0.5 * this.armsLost;
    this.canAttack = this.armsLost < 2; // both arms gone -> cannot strike
    // crawl on ANY leg loss (one leg limps, two legs crawls — never stands)
    if (this.legsLost >= 1 && !this.crawl) {
      this.crawl = true;
      this.game.notify(`${this.name} is CRAWLING!`, '#ffa040');
    }
    // both legs lost = permanent crawl (bleed-out handled in update), NOT instant death
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.state = 'dead';
    this.deathT = 0;
    this.bleeds.length = 0;
    // ragdoll-lite: the corpse falls away from the killing blow
    const d = this._lastHitDir;
    this.deathYaw = d ? Math.atan2(d.x, d.z) : this.yaw;
    // mocap death: fall forward or backward depending on the killing blow
    if (this.anim) {
      const facingX = Math.sin(this.yaw), facingZ = Math.cos(this.yaw);
      const fromFront = d ? (facingX * d.x + facingZ * d.z) < 0 : true;
      this.anim.playOnce(fromFront ? 'deathB' : 'deathF', { clamp: true, fade: 0.12 });
    }
    // violent deaths (heavy / execution / decapitation) LAUNCH the corpse:
    // flight is a cosmetic group offset — this.pos stays the logical spot.
    // Ragdoll 2.0: direction & magnitude driven by the killing blow (attack
    // direction, weapon mass, charge) via deathImpulse().
    if (this._lastHitHeavy || this.executed || this._decapitated) {
      const dir = d || new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
      const imp = deathImpulse({
        dirX: dir.x, dirZ: dir.z,
        attackDir: this._lastAttackDir,
        weaponKey: this._lastWeaponKey,
        charge: this._lastCharge,
        boss: this.boss, executed: this.executed,
      });
      this.ragdoll = {
        off: new THREE.Vector3(),
        vel: new THREE.Vector3(imp.vx, imp.vy, imp.vz),
        ang: new THREE.Vector3(imp.ax, imp.ay, imp.az),
        rest: false,
        grounded: false,
        smearT: 0,
      };
      activeRagdolls.push(this);
      if (activeRagdolls.length > CFG.ragdoll.maxRagdolls) activeRagdolls[0]._settleRagdoll();
    }
    this.parts.torso.mesh.getWorldPosition(_v);
    this.game.gore.burst(_v, CFG.gore.deathBurst, 3.2, null);
    this.game.gore.decal(this.pos.x, this.pos.y, this.pos.z, 2.2);
    // severed-heavy kills paint a bigger pool; gut-spilled torsos bigger still
    const severs = Object.values(this.parts).filter(pt => pt.state === 'severed').length;
    this.game.gore.pool(this.pos.x, this.pos.y, this.pos.z,
      (this.boss ? 1.6 : 1.0) * (1 + 0.22 * severs + (this._gutsSpilled ? 0.35 : 0)));
    this.game.audio.scream(this.voiceKind, 'death', _v); // death cry
    this.game.onEnemyKilled(this);
  }

  // Corpse flight: airborne tumble -> ground slide with friction -> settle.
  // While sliding it smears a blood trail (wider when disemboweled).
  _updateRagdoll(dt) {
    const r = this.ragdoll;
    if (!r || r.rest) return;
    const rc = CFG.ragdoll;
    r.vel.y -= rc.gravity * dt;
    r.off.addScaledVector(r.vel, dt);
    this.group.rotation.x += r.ang.x * dt;
    this.group.rotation.z += r.ang.z * dt;
    const wx = this.pos.x + r.off.x, wz = this.pos.z + r.off.z;
    const floorY = this.game.level.floorHeightAt(wx, wz, this.pos.y + r.off.y + 1) - this.pos.y;
    if (r.off.y <= floorY) {
      r.off.y = floorY;
      if (!r.grounded && Math.abs(r.vel.y) > 1.0) {
        r.vel.y *= -rc.bounce;                     // bounce
        r.vel.x *= rc.bounceDampen; r.vel.z *= rc.bounceDampen;
        r.ang.multiplyScalar(0.5);
        this.parts.torso.mesh.getWorldPosition(_v);
        this.game.gore.burst(_v, 6, 1.4, null); // impact squirt
        this.game.audio.ragdollThud(_v);        // body meets stone
      } else {
        r.grounded = true;
        r.vel.y = 0;
        const speed = Math.hypot(r.vel.x, r.vel.z);
        r.vel.x *= Math.max(0, 1 - rc.slideFriction * dt); // slide friction
        r.vel.z *= Math.max(0, 1 - rc.slideFriction * dt);
        r.ang.multiplyScalar(Math.max(0, 1 - rc.angDampen * dt));
        // blood smear decal dragged under the sliding corpse
        if (speed > 0.6) {
          r.smearT -= dt;
          if (r.smearT <= 0) {
            r.smearT = rc.smearT;
            const gy = this.pos.y + r.off.y;
            if (this._gutsSpilled) this.game.gore.decal(wx, gy, wz, 0.6);
            else this.game.gore.crawlTrail(wx, gy, wz);
          }
        }
        if (speed < rc.settleSpeed) this._settleRagdoll();
      }
    }
    // keep the flying corpse inside the room
    _v.set(wx, this.pos.y, wz);
    this.game.level.collideCircle(_v, 0.4, 1.7);
    r.off.x = _v.x - this.pos.x; r.off.z = _v.z - this.pos.z;
    this.group.position.set(this.pos.x + r.off.x, this.pos.y + r.off.y, this.pos.z + r.off.z);
  }

  _settleRagdoll() {
    const r = this.ragdoll;
    if (r) { r.rest = true; r.vel.set(0, 0, 0); r.ang.set(0, 0, 0); }
    const i = activeRagdolls.indexOf(this);
    if (i >= 0) activeRagdolls.splice(i, 1);
  }

  // Hitting or kicking an ALREADY DEAD corpse: small impulse + blood burst.
  nudgeCorpse(srcPos, power = 1.6) {
    if (!this.dead) return;
    const dir = _v.set(this.pos.x - srcPos.x, 0, this.pos.z - srcPos.z);
    if (dir.lengthSq() < 1e-4) dir.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    dir.normalize();
    if (!this.ragdoll) {
      this.ragdoll = { off: new THREE.Vector3(), vel: new THREE.Vector3(), ang: new THREE.Vector3(),
        rest: true, grounded: false, smearT: 0 };
    }
    const r = this.ragdoll;
    r.rest = false;
    r.grounded = false;
    r.smearT = 0;
    r.vel.x += dir.x * power; r.vel.z += dir.z * power;
    r.vel.y = Math.max(r.vel.y, 0.9 + Math.random() * 0.6);
    r.ang.set((Math.random() - 0.5) * 4, 0, (Math.random() - 0.5) * 4);
    if (!activeRagdolls.includes(this)) {
      activeRagdolls.push(this);
      if (activeRagdolls.length > CFG.ragdoll.maxRagdolls) activeRagdolls[0]._settleRagdoll();
    }
    this.parts.torso.mesh.getWorldPosition(_v);
    this.game.gore.burst(_v, 14, 2.0, dir);
  }

  // One-shot animation override (attacks, hit reacts, staggers).
  playOvr(key, dur, ts = 1) {
    if (!this.anim) return;
    this.anim.playOnce(key, { timeScale: ts });
    this._ovrT = dur;
  }

  // Attack clip chosen per archetype; time-scaled so the contact frame
  // lands exactly when the FSM strike deals damage.
  _startAttackAnim() {
    if (!this.anim) return;
    let key;
    if (this.boss) key = 'atkHeavy';
    else if (this.kind === 'knight') key = Math.random() < 0.5 ? 'atkA' : 'atkB';
    else if (this.kind === 'bandit') {
      key = ['atkA', 'atkB', 'atkC'][Math.floor(Math.random() * 3)];
    } else key = 'atkStab'; // skeleton
    const dur = this.anim.clipDuration(key);
    const contact = (key === 'atkHeavy' || key === 'atkStab') ? 0.55 : 0.5;
    const ts = THREE.MathUtils.clamp((dur * contact) / this.type.windup, 0.55, 2.4);
    this.playOvr(key, dur / ts, ts);
  }

  // Locomotion layer — runs only when no one-shot override is playing.
  _animLocomotion() {
    if (!this.anim || this.dead || this._ovrT > 0) return;
    let key = 'idle';
    let ts = 1;
    if (this.state === 'block') key = 'block';
    else if (this.state === 'patrol') { key = 'walk'; ts = 0.85; }
    else if (this.state === 'chase') {
      key = this.crawl ? 'walk' : 'run';
      ts = this.crawl ? 0.55 : THREE.MathUtils.clamp(this.type.speed / 3.4, 0.7, 1.3);
    } else if (this.aggro && !this.dummy) key = 'menacing';
    if (this.limping && (key === 'walk' || key === 'run')) ts *= 0.7; // hobble
    this.anim.play(key, { timeScale: ts });
  }

  update(dt) {
    const g = this.game;

    // mocap mixer always ticks (hit reacts, deaths, attacks included)
    if (this.anim) {
      this.anim.update(dt);
      if (this._ovrT > 0) this._ovrT -= dt;
    }

    // hit flash decay
    for (const p of Object.values(this.parts)) {
      if (p.flashT > 0) {
        p.flashT -= dt;
        const hex = p.flashT > 0 ? 0x881111 : 0x000000;
        p.mesh.material.emissive.setHex(hex);
        if (p.flashMats) for (const m of p.flashMats) m.emissive.setHex(hex);
      }
    }

    // cosmetic knockback: integrate the shove, friction-decay the velocity,
    // spring the offset back to zero. MP-SAFE: this.pos is never involved;
    // the displacement lives on bodyG only (clamped ~0.5 m).
    if (this.kbVel.lengthSq() > 1e-8 || this.kbOff.lengthSq() > 1e-8) {
      const k = KNOCKBACK_DEFAULTS;
      const ac = armorCfg();
      this.kbOff.addScaledVector(this.kbVel, dt);
      this.kbVel.multiplyScalar(Math.max(0, 1 - ac.knockbackFriction * dt));
      if (this.kbVel.length() < k.stopSpeed) this.kbVel.set(0, 0, 0);
      this.kbOff.multiplyScalar(Math.max(0, 1 - k.returnRate * dt));
      const m = this.kbOff.length();
      if (m > ac.knockbackMax) this.kbOff.multiplyScalar(ac.knockbackMax / m);
      if (this.kbOff.lengthSq() < 1e-6 && this.kbVel.lengthSq() === 0) this.kbOff.set(0, 0, 0);
    }
    this.bodyG.position.x = this.kbOff.x;
    this.bodyG.position.z = this.kbOff.z;

    if (this.dead) {
      this.deathT += dt;
      if (this.ragdoll) this._updateRagdoll(dt); // death clip keeps playing in flight
      if (this.skinned) return; // mocap death clip owns the corpse pose
      const t = Math.min(1, this.deathT / 0.45);
      if (this.ragdoll) {
        // ragdoll owns the root transform; just droop the surviving limbs
        for (const k of ['leftArm', 'rightArm']) {
          if (this.parts[k].state === 'intact') this.parts[k].mesh.rotation.x = 1.1 * t;
        }
        if (this.parts.head.state === 'intact') this.parts.head.mesh.rotation.x = 0.5 * t;
        return;
      }
      // directional fall: pitch over along the killing-blow direction,
      // with a single small settle bounce at the end
      this.group.rotation.y = this.deathYaw ?? this.yaw;
      const bounce = t >= 1 ? Math.abs(Math.sin((this.deathT - 0.45) * 9)) * Math.max(0, 1 - (this.deathT - 0.45) * 3) * 0.06 : 0;
      this.group.rotation.x = 1.35 * t - bounce;
      // limbs loosen and droop during the fall
      for (const k of ['leftArm', 'rightArm']) {
        if (this.parts[k].state === 'intact') this.parts[k].mesh.rotation.x = 1.1 * t;
      }
      if (this.parts.head.state === 'intact') this.parts.head.mesh.rotation.x = 0.5 * t;
      else this.bodyG.rotation.x += (0.5 - this.bodyG.rotation.x) * Math.min(1, 6 * dt);
      return;
    }

    // ambush rise: claw up out of the floor
    if (this.state === 'rise') {
      this.riseT -= dt;
      this._ground();
      this.bodyG.position.y = -1.7 * Math.max(0, this.riseT / 1.1);
      if (this.anim && this._ovrT <= 0) this.anim.play('menacing');
      if (this.riseT <= 0) {
        this.state = this.dummy ? 'idle' : 'chase';
        this.aggro = !this.dummy;
        this.bodyG.position.y = 0;
      }
      return;
    }

    // Gate Warden phase 2: at half HP he drops his guard and goes berserk
    if (this.boss && this.bossPhase === 1 && this.parts.torso.hp <= this.parts.torso.maxHp * 0.5) {
      this.bossPhase = 2;
      this.type.canBlock = false;
      this.type.windup = this.baseWindup * 0.55;
      this.type.cooldown *= 0.6;
      this.type.speed *= 1.25;
      this.staggerT = 1.4;
      this.state = 'stagger';
      this.game.notify('THE GATE WARDEN IS ENRAGED — he drops his guard!', '#ff4040');
      this.game.audio.armorClang();
    }

    // bleeding: open wounds drain HP and drip a trail
    if (this.bleeds.length > 0 || this.crawl) {
      let dps = 0;
      for (let i = this.bleeds.length - 1; i >= 0; i--) {
        this.bleeds[i] -= dt;
        if (this.bleeds[i] <= 0) this.bleeds.splice(i, 1);
        else dps += CFG.combat.bleedDps;
      }
      if (this.crawl) dps += CFG.combat.crawlBleedDps; // legless crawlers bleed out
      if (dps > 0) {
        this._bleedAcc += dps * dt;
        const tick = Math.floor(this._bleedAcc);
        if (tick > 0) {
          this._bleedAcc -= tick;
          this.parts.torso.hp -= tick;
          if (this.parts.torso.hp <= 0) { this.die(); return; }
        }
        this._dripT -= dt;
        if (this._dripT <= 0) {
          this._dripT = CFG.combat.bleedDripT;
          this.game.gore.crawlTrail(this.pos.x, this.pos.y, this.pos.z);
        }
      }
    }

    // knockback with friction decay
    this.pos.addScaledVector(this.knock, dt);
    this.knock.multiplyScalar(Math.max(0, 1 - 8 * dt));

    // domino effect: a flying body bowls into the next one
    this._dominoT -= dt;
    if (this._dominoT <= 0 && this.knock.length() > CFG.combat.dominoMinSpeed) {
      for (const e of this.game.enemies) {
        if (e === this || e.dead || e.state === 'rise') continue;
        if (this.pos.distanceTo(e.pos) < CFG.combat.dominoDist) {
          this._dominoT = 1;
          e.staggerT = Math.max(e.staggerT, CFG.combat.dominoStagger);
          e.knock.addScaledVector(this.knock, 0.5);
          e.flinch(0.3);
          this.knock.multiplyScalar(0.5);
          break;
        }
      }
    }

    // sympathetic flinch
    if (this.flinchT > 0) {
      this.flinchT -= dt;
      this.bodyG.rotation.z = Math.sin(this.game.time * 30) * 0.08;
      this._ground();
      return;
    }

    // stagger
    if (this.staggerT > 0) {
      this.staggerT -= dt;
      this.bodyG.rotation.z = Math.sin(this.staggerT * 40) * 0.06;
      this._ground();
      return;
    }
    this.bodyG.rotation.z = 0;

    // ---- posture: recovers while on its feet; the break clears once the
    // long stagger runs out ----
    if (this.postureDown && this.staggerT <= 0 && !this.dead) {
      this.posture = 0;
      this.postureDown = false;
    }
    if (this.staggerT <= 0 && !this.postureDown) {
      this.posture = Math.max(0, this.posture - this.postureRegen * dt);
    }

    // training-room dummy: full damage/gore reactions above, but no AI —
    // stands its ground, never chases, never swings.
    if (this.dummy) {
      this._ground();
      this._animLocomotion();
      return;
    }

    // mp host: target the nearest living player (remote shims included);
    // single-player: g.pickTarget is undefined — behavior unchanged
    const player = g.pickTarget ? (g.pickTarget(this) || g.player) : g.player;
    const playerAlive = player && !player.dead;
    const dist = playerAlive ? this.pos.distanceTo(player.pos) : Infinity;
    if (playerAlive && dist < CFG.enemies.aggroRange) this.aggro = true;

    // stamina war: the guard regens wind while it's lowered
    if (this.state !== 'block') {
      this.stamina = Math.min(this.maxStamina, this.stamina + CFG.duel.enemyStaminaRegen * dt);
    }

    // knight raises block in response to a nearby incoming swing — and READS
    // the player: held charges are parried (parryChance scales with charge),
    // gassed-out players are blocked more, and a broken guard gets punished.
    if (this.type.canBlock && this.blockCd <= 0 && playerAlive &&
        player.attack.phase === 'swing' && dist < 3.5) {
      const charge = player.attack.charge || 0;
      const pChance = (this.type.parryChance || 0) * (0.35 + 0.65 * charge);
      const stFrac = player.stamina / player.stats.maxStamina;
      const bChance = stFrac < 0.35 ? 0.22 : 0.06;
      const roll = Math.random();
      if (roll < pChance) {
        // ACTIVE PARRY: guard raised exactly as the blow lands
        this.state = 'block';
        this.blockT = 0.6;
        this.blockCd = 3.0;
        this.parryUntil = g.time + CFG.combat.parryWindow;
      } else if (roll < pChance + bChance) {
        this.state = 'block';
        this.blockT = 1.1;
        this.blockCd = 3.0;
        this.parryUntil = -99;
      }
    }
    // punish a guard-broken player: close in for the kill immediately
    if (playerAlive && player.guardBreakT > 0 && this.cooldownT > 0.15) {
      this.cooldownT = 0.15;
    }
    this.blockCd -= dt;
    this.sidestepCd -= dt;
    this.lungeCd -= dt;

    if (this.boss) this.game.bossName = this.state === 'chase' || this.state === 'windup' || this.state === 'strike';

    switch (this.state) {
      case 'block':
        this.blockT -= dt;
        this.parts.rightArm.mesh.rotation.x = -1.4; // shield-ish pose
        if (this.blockT <= 0) { this.state = 'chase'; this.parts.rightArm.mesh.rotation.x = 0; }
        this._face(playerAlive ? player.pos : null, dt);
        break;

      case 'idle':
      case 'patrol': {
        if (this.aggro && playerAlive) { this.state = 'chase'; break; }
        if (!this.patrolTarget || this.pos.distanceTo(this.patrolTarget) < 0.5) {
          this.patrolTarget = this.home.clone().add(new THREE.Vector3(
            (Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 6));
        }
        this._moveToward(this.patrolTarget, this.type.speed * 0.35 * (this.limping ? CFG.enemies.limpMult : 1), dt);
        this._face(this.patrolTarget, dt);
        this.state = 'patrol';
        break;
      }

      case 'chase': {
        if (!playerAlive) { this.state = 'idle'; this.aggro = false; break; }
        this.cooldownT -= dt;
        let speed = this.crawl ? CFG.enemies.crawlSpeed : this.type.speed;
        if (this.limping) speed *= CFG.enemies.limpMult; // bad leg: visibly slower
        this.strafeT += dt;
        let target = player.pos;
        if (this.type.strafe && dist < 6) {
          const side = new THREE.Vector3().subVectors(player.pos, this.pos)
            .cross(new THREE.Vector3(0, 1, 0)).normalize()
            .multiplyScalar(Math.sin(this.strafeT * 1.8) * 1.5);
          target = player.pos.clone().add(side);
        }
        if (dist > this.type.range * 0.85) this._moveToward(target, speed, dt);
        this._separate(dt);
        this._face(player.pos, dt);

        // rogue counterplay: sidestep out of a heavy windup (or a big charge)
        if (this.type.sidestep && this.sidestepCd <= 0 && !this.crawl && dist < 3.5 &&
            player.attack.phase === 'windup' &&
            (player.attack.heavy || player.attack.charge > 0.4) &&
            Math.random() < this.type.sidestep) {
          this.sidestepT = 0.35;
          this.sidestepDir = Math.random() < 0.5 ? 1 : -1;
          this.sidestepCd = this.type.sidestepCd;
        }
        if (this.sidestepT > 0) {
          this.sidestepT -= dt;
          const side = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
          this.pos.addScaledVector(side, this.sidestepDir * 4.5 * dt);
          this.game.level.collideCircle(this.pos, 0.4, 1.7);
        }

        // skeleton counterplay: sudden lunge to close distance
        if (this.type.lunge && this.lungeCd <= 0 && !this.crawl && dist > 3 && dist < 8 &&
            Math.random() < this.type.lunge * dt * 4) {
          this.lungeBoostT = 0.3;
          this.lungeCd = this.type.lungeCd;
        }
        if (this.lungeBoostT > 0) {
          this.lungeBoostT -= dt;
          this._moveToward(player.pos, speed * 3.5, dt);
        }

        if (dist < this.type.range && this.cooldownT <= 0 && this.canAttack) {
          this.state = 'windup';
          this.stateT = 0;
          // directional attack: the player can read & chamber/mirror this
          const dirs = ATK_DIRS[this.boss ? 'knight' : this.kind] || ATK_DIRS.bandit;
          this.atkDir = this.boss ? 'overhead' : dirs[Math.floor(Math.random() * dirs.length)];
          // boss red-flash heavies smash through parries (CFG toggle)
          this.atkUnparryable = !!(this.boss && CFG.enemies.bossUnparryable);
          // feint roll: bandits fake constantly, knights occasionally
          this.willFeint = Math.random() < (this.type.feintChance || 0);
          this.strikeCanceled = false;
          this.contactDone = false;
          if (this.atkUnparryable) {
            // distinct audio + red weapon glow telegraph: DO NOT PARRY THIS
            this.game.audio.bossTelegraph(this.pos);
            if (this.game.debugLine) this.game.debugLine('UNPARRYABLE heavy incoming — dodge or kick!');
          }
          this._startAttackAnim();
        }
        break;
      }

      case 'windup': {
        this.stateT += dt;
        this._face(playerAlive ? player.pos : null, dt);
        // telegraph: weapon arm rises
        this.parts.rightArm.mesh.rotation.x = -2.3 * Math.min(1, this.stateT / this.type.windup);
        // unparryable telegraph: the blade/arm flashes red for the whole windup
        if (this.atkUnparryable) {
          this.parts.rightArm.flashT = 0.1;
          this.handWeapon.material.emissive.setHex(
            Math.sin(this.game.time * 25) > 0 ? 0xaa1010 : 0x330000);
        }
        // FEINT: the windup chokes off at ~60% — a mind-game, then a quick
        // re-attack from chase. Drains the feinting enemy's stamina a touch.
        if (this.willFeint && this.stateT >= this.type.windup * 0.6) {
          this.willFeint = false;
          this.feints++;
          this.stamina = Math.max(0, this.stamina - CFG.duel.feintCost * 0.5);
          this.state = 'chase';
          this.stateT = 0;
          this.cooldownT = CFG.duel.feintReattack;
          this.parts.rightArm.mesh.rotation.x = 0;
          if (this.atkUnparryable) this.handWeapon.material.emissive.setHex(0x000000);
          this.game.audio.feint(this.pos);
          if (this.game.debugLine) this.game.debugLine(`${this.name} FEINTS`);
          break;
        }
        if (this.stateT >= this.type.windup) {
          this.state = 'strike';
          this.stateT = 0;
          this.contactDone = false;
          this.parts.rightArm.mesh.rotation.x = 0.9;
          if (this.atkUnparryable) this.handWeapon.material.emissive.setHex(0x000000);
        }
        break;
      }

      case 'strike': {
        this.stateT += dt;
        const st = STRIKE_T[this.boss ? 'boss' : this.kind] || STRIKE_T.bandit;
        this.parts.rightArm.mesh.rotation.x = 0.9 - (this.stateT / st.dur) * 0.9;
        // contact frame: the blow lands here (skeletons drag it LATE)
        if (!this.contactDone && this.stateT >= st.contact) {
          // last-instant CHAMBER: the local player's mirrored swing
          // started inside the window cancels this blow entirely
          const chambered = !this.strikeCanceled && playerAlive &&
            dist < this.type.range + 0.5 && player === g.player &&
            resolveChamber(g, player);
          this.contactDone = true;
          if (!chambered && !this.strikeCanceled && playerAlive && dist < this.type.range + 0.5) {
            if (g.hurtTarget) g.hurtTarget(player, this.type.damage * this.dmgMult, this.pos, this);
            else g.damagePlayer(this.type.damage * this.dmgMult, this.pos, this);
          }
        }
        if (this.stateT >= st.dur) {
          this.cooldownT = this.type.cooldown * this.cdMult;
          this.parts.rightArm.mesh.rotation.x = 0;
          this.state = 'chase';
        }
        break;
      }

      default:
        this.state = 'chase';
    }

    // footsteps: distance-accumulated stride, one positional voice per step.
    // Stride period follows locomotion (run ~1.9 m, walk ~1.4 m, crawl drags).
    const stepDist = this.pos.distanceTo(this._lastStepPos);
    this._lastStepPos.copy(this.pos);
    if (this.state === 'chase' || this.state === 'patrol') {
      this._stepAcc += stepDist;
      const stride = this.crawl ? 0.9 : this.state === 'chase' ? 1.9 : 1.4;
      if (this._stepAcc >= stride) {
        this._stepAcc = 0;
        this._stepAlt = !this._stepAlt;
        let gm = this.crawl ? 0.6 : 1;
        if (this.limping && !this.crawl) {
          // asymmetric limp steps: the wounded side lands softer
          const leftHurt = isWounded(this.parts.leftLeg);
          const woundedStep = leftHurt ? this._stepAlt : !this._stepAlt;
          gm = woundedStep ? 0.55 : 1.15;
        }
        this.game.audio.enemyStep(this.voiceKind, this._stepAlt, this.pos, gm);
      }
    }

    this._ground();

    // limp: lean onto the good leg — body roll synced to the step cycle
    if (this.limping && (this.state === 'chase' || this.state === 'patrol')) {
      this._limpPhase += dt * (this.state === 'chase' ? 7 : 4.5);
      const lean = isWounded(this.parts.leftLeg) ? 1 : -1; // roll off the bad leg
      this.bodyG.rotation.z += lean * (0.06 + 0.10 * Math.sin(this._limpPhase));
      this.bodyG.position.y -= 0.03 * (0.5 + 0.5 * Math.sin(this._limpPhase * 2));
    }
    this._animLocomotion();
  }

  _moveToward(target, speed, dt) {
    const dir = _v.subVectors(target, this.pos).setY(0);
    if (dir.lengthSq() < 0.01) return;
    dir.normalize();
    this.pos.addScaledVector(dir, speed * dt);
    this.game.level.collideCircle(this.pos, 0.4, 1.7);
  }

  _separate(dt) {
    for (const e of this.game.enemies) {
      if (e === this || e.dead) continue;
      const dx = this.pos.x - e.pos.x, dz = this.pos.z - e.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 1 && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        this.pos.x += (dx / d) * (1 - d) * 2 * dt;
        this.pos.z += (dz / d) * (1 - d) * 2 * dt;
      }
    }
  }

  _face(target, dt) {
    if (!target) return;
    const want = Math.atan2(target.x - this.pos.x, target.z - this.pos.z);
    let diff = want - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += diff * Math.min(1, 8 * dt);
  }

  _ground() {
    this.pos.y = this.game.level.floorHeightAt(this.pos.x, this.pos.z, this.pos.y + 0.5);
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    // crawl posture: body drops and pitches forward
    const targetY = this.crawl ? -0.85 : 0;
    const targetRX = this.crawl ? 0.9 : 0;
    this.bodyG.position.y += (targetY - this.bodyG.position.y) * 0.15;
    this.bodyG.rotation.x += (targetRX - this.bodyG.rotation.x) * 0.15;
    // wounded arms hang low (not while blocking or winding up a strike)
    const armBusy = this.state === 'block' || this.state === 'windup' || this.state === 'strike';
    if (!armBusy) {
      for (const k of ['leftArm', 'rightArm']) {
        const pt = this.parts[k];
        if (pt.state === 'intact' && pt.wounded) pt.mesh.rotation.x = 0.55;
      }
    }
  }

  dispose() {
    this._settleRagdoll(); // also unregisters from the active-physics list
    this.game.scene.remove(this.group);
  }
}
