// playerbody.js — VISIBLE FIRST-PERSON BODY: the local player's champion as a
// full skinned character standing in the world (not glued to the camera).
// The head meshes are hidden (the camera lives inside the skull) and the whole
// body is shifted slightly BACKWARD along the facing direction so the chest
// never blocks the near plane while arms/legs stay visible when looking down.
// The classic procedural viewmodel is kept — hybrid FPS viewmodel + body.
//
// Animation is driven from Player state every frame (update() is called AFTER
// player.update() positioned the camera, so the body never jitters):
//   idle/walk/run by horizontal speed, atkA/atkB/atkC by combo stage,
//   atkHeavy on heavy, block loop while blocking, hitF on damage taken,
//   deathF/deathB (clamped) on death.
import * as THREE from 'three';
import {
  SKINNED, MATS, buildSkinnedCharacter, presetParts, Animator,
} from './skinned.js';
import { buildWeaponVisual } from './models.js';
import { getChampionId } from './champion.js';
import { getHeroParts } from './hero.js';

const BACK_OFF = 0.3;   // m — how far the body stands behind the camera
const WALK_MAX = 5.5;   // m/s — above this we play 'run'
const IDLE_MAX = 0.6;   // m/s — below this we play 'idle'

export class PlayerBody {
  constructor(game) {
    this.game = game;
    this.char = null;
    this.anim = null;
    this.weaponKey = null;
    this.weaponVis = null;
    this.animKey = 'idle';    // last key played — also broadcast by mp.js
    this._busy = false;       // a one-shot (attack / hit react) is playing
    this._lastPhase = 'idle';
    this._lastHp = null;
    this._dead = false;
  }

  _build() {
    if (!SKINNED.ready) return false;
    // created hero (if any) drives the first-person body; else the champion preset
    const parts = getHeroParts() || presetParts(String(getChampionId()));
    if (!parts) return false;
    const c = buildSkinnedCharacter(parts, () => MATS.atlas());
    if (!c) return false;
    // the camera lives inside the head — hide every head-region mesh
    for (const m of c.regionMeshes.head) m.visible = false;
    this.game.scene.add(c.group);
    this.char = c;
    this.anim = new Animator(c.root);
    this.anim.play('idle');
    this._mountWeapon(true);
    return true;
  }

  _mountWeapon(force) {
    const p = this.game.player;
    if (!p || !this.char) return;
    const key = p.wstats.key;
    if (!force && key === this.weaponKey) return;
    this.weaponKey = key;
    const handR = this.char.bones.get('Hand_R');
    if (!handR) return;
    if (this.weaponVis) handR.remove(this.weaponVis);
    const wv = buildWeaponVisual(key) || buildWeaponVisual('sword');
    if (!wv) { this.weaponVis = null; return; }
    // VERIFIED grip transform (bone space is centimeters — counter-scale x100)
    wv.scale.setScalar(100);
    wv.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    handR.add(wv);
    this.weaponVis = wv;
  }

  _oneShot(key, timeScale = 1) {
    if (!this.anim) return;
    this._busy = true;
    this.anim.playOnce(key, {
      fade: 0.07, timeScale,
      onDone: () => { this._busy = false; },
    });
    this.animKey = key;
  }

  update(dt) {
    const p = this.game.player;
    if (!p) return;
    if (!this.char) { this._build(); return; }
    this._mountWeapon(false); // poll weapon key — rebuilds on slot switch

    // --- transform: yaw ONLY (pitch must never tilt the body), nudged back ---
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    this.char.group.position.set(
      p.pos.x - fx * BACK_OFF, p.pos.y, p.pos.z - fz * BACK_OFF);
    this.char.group.rotation.y = p.yaw + Math.PI; // rig faces +Z; player faces -Z

    // --- animation state ---
    const a = p.attack;
    if (p.dead) {
      if (!this._dead) {
        this._dead = true;
        this._busy = true;
        const key = Math.random() < 0.5 ? 'deathF' : 'deathB';
        this.anim.playOnce(key, { clamp: true, fade: 0.15 });
        this.animKey = key;
      }
    } else if (a.phase === 'swing' && this._lastPhase !== 'swing') {
      // strike released — one-shot matched to the attack TYPE:
      // slashR -> atkA, slashL -> atkB, overhead -> atkHeavy, stab -> atkStab,
      // un-flicked combo third hit (slashR side) -> atkC
      const w = p.wstats;
      const key = (a.heavy || a.dir === 'overhead') ? 'atkHeavy'
        : a.dir === 'stab' ? 'atkStab'
        : a.dir === 'slashL' ? 'atkB'
        : (a.stage === 3 ? 'atkC' : 'atkA');
      // time-scale the clip so its contact frame lands inside the swing window
      const ts = THREE.MathUtils.clamp(
        (this.anim.clipDuration(key) * 0.55) / (w.swing + w.recover), 0.6, 2.2);
      this._oneShot(key, ts);
    } else if (p.hp < (this._lastHp ?? p.hp) && !this._busy) {
      this._oneShot('hitF');
    } else if (!this._busy && a.phase === 'idle') {
      if (p.blocking) {
        this.anim.play('block');
        this.animKey = 'block';
      } else {
        const speed = Math.hypot(p.vel.x, p.vel.z);
        if (speed > WALK_MAX) {
          this.anim.play('run', { timeScale: THREE.MathUtils.clamp(speed / 6, 0.8, 1.5) });
          this.animKey = 'run';
        } else if (speed > IDLE_MAX) {
          this.anim.play('walk', { timeScale: THREE.MathUtils.clamp(speed / 2.4, 0.6, 1.8) });
          this.animKey = 'walk';
        } else {
          this.anim.play('idle');
          this.animKey = 'idle';
        }
      }
    }
    this._lastPhase = a.phase;
    this._lastHp = p.hp;

    this.anim.update(dt);
  }

  dispose() {
    if (this.char) this.game.scene.remove(this.char.group);
    this.char = null;
    this.anim = null;
  }
}
