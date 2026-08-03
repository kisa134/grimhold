// remotes.js — remote players & enemy proxies for LAN co-op (MVP).
//
// RemoteAvatar: another player's champion, built from the preset they
// announced at join, weapon on Hand_R (VERIFIED grip transform), floating name
// sprite. Interpolates to the latest broadcast state and mirrors the anim key.
//
// EnemyProxy (client side only): the host simulates enemies; clients render
// proxies from 10 Hz snapshots (id, type, x/z, yaw, animKey, hp, dead).
// Proxies carry the same invisible part hitboxes as real enemies so the local
// melee sweep still "feels" instant — the hit itself is sent to the host as an
// intent and the authoritative result flows back via snapshots.
// Severed regions are NOT synced in the MVP.
import * as THREE from 'three';
import {
  SKINNED, MATS, buildSkinnedCharacter, presetParts, enemyParts, Animator,
} from './skinned.js';
import { buildWeaponVisual } from './models.js';
import { toHost } from './net.js';
import { deathImpulse } from './combat.js';
import { CFG } from './config.js';

const ONESHOT = new Set(['atkA', 'atkB', 'atkC', 'atkHeavy', 'atkStab',
  'hitF', 'hitL', 'hitR', 'stagger', 'parry']);
const DEATH = new Set(['deathF', 'deathB']);

// VERIFIED grip transform (see enemy.js / champion.js) — do not change.
function attachWeapon(bones, key, oldVis) {
  const handR = bones.get('Hand_R');
  if (!handR) return null;
  if (oldVis) handR.remove(oldVis);
  const wv = buildWeaponVisual(key) || buildWeaponVisual('sword');
  if (!wv) return null;
  wv.scale.setScalar(100);
  wv.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  handR.add(wv);
  return wv;
}

function makeNameSprite(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 30px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.lineWidth = 5;
  ctx.strokeText(text, 128, 32);
  ctx.fillStyle = '#e8c85a';
  ctx.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, depthTest: false, transparent: true,
  }));
  spr.scale.set(1.5, 0.38, 1);
  spr.position.y = 2.1;
  spr.renderOrder = 5;
  return spr;
}

function lerpAngle(cur, want, k) {
  let diff = want - cur;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return cur + diff * k;
}

// ---------------- remote player avatar ----------------
export class RemoteAvatar {
  constructor(scene, info) { // info: {id, name, meta:{champion}}
    this.scene = scene;
    this.info = info;
    this.char = null;
    this.anim = null;
    this.weaponKey = null;
    this.weaponVis = null;
    this.targetPos = new THREE.Vector3();
    this.targetYaw = 0;
    this.lastAnim = '';
    this.dead = false;
    this._gotState = false;
  }

  _build() {
    if (!SKINNED.ready) return false;
    // remote players announce their created hero's part list at join
    const heroParts = this.info.meta.hero && this.info.meta.hero.parts;
    const parts = (Array.isArray(heroParts) && heroParts.length ? heroParts : null)
      || presetParts(String(this.info.meta.champion || '33'));
    if (!parts) return false;
    const c = buildSkinnedCharacter(parts, () => MATS.atlas());
    if (!c) return false;
    this.char = c;
    this.scene.add(c.group);
    if (typeof document !== 'undefined') c.group.add(makeNameSprite(this.info.name));
    this.anim = new Animator(c.root);
    this.anim.play('idle');
    this.weaponVis = attachWeapon(c.bones, this.weaponKey || 'sword', null);
    return true;
  }

  setState(d) {
    this._gotState = true;
    if (d.p) this.targetPos.set(d.p[0], d.p[1], d.p[2]);
    this.targetYaw = d.yaw || 0;
    if (d.w && d.w !== this.weaponKey) {
      this.weaponKey = d.w;
      if (this.char) this.weaponVis = attachWeapon(this.char.bones, d.w, this.weaponVis);
    }
    const key = d.anim || 'idle';
    if (this.anim && key !== this.lastAnim) {
      if (DEATH.has(key)) {
        if (!this.dead) { this.dead = true; this.anim.playOnce(key, { clamp: true }); }
      } else if (ONESHOT.has(key)) {
        this.anim.playOnce(key, { fade: 0.08 });
      } else {
        this.dead = false;
        this.anim.play(key);
      }
    }
    this.lastAnim = key;
  }

  update(dt, active) {
    if (!this._gotState || !active) return;
    if (!this.char) { this._build(); return; }
    const g = this.char.group;
    g.position.lerp(this.targetPos, Math.min(1, 12 * dt));
    g.rotation.y = lerpAngle(g.rotation.y, this.targetYaw + Math.PI, Math.min(1, 12 * dt));
    if (this.anim) this.anim.update(dt);
  }

  dispose() {
    if (this.char) this.scene.remove(this.char.group);
    this.char = null;
    this.anim = null;
  }
}

// ---------------- enemy proxy (client view of a host-simulated enemy) ----------------
const PART_DEFS = {
  head:     { size: [0.30, 0.30, 0.30], pos: [0, 1.62, 0],     radius: 0.28 },
  torso:    { size: [0.62, 0.62, 0.36], pos: [0, 1.12, 0],     radius: 0.46 },
  leftArm:  { size: [0.18, 0.60, 0.18], pos: [-0.42, 1.40, 0], radius: 0.26 },
  rightArm: { size: [0.18, 0.60, 0.18], pos: [0.42, 1.40, 0],  radius: 0.26 },
  leftLeg:  { size: [0.22, 0.90, 0.22], pos: [-0.17, 0.45, 0], radius: 0.28 },
  rightLeg: { size: [0.22, 0.90, 0.22], pos: [0.17, 0.45, 0],  radius: 0.28 },
};
const TYPE_COLOR = { knight: 0x54627e, bandit: 0x5a6a34, skeleton: 0xe6dfc8, boss: 0x4a2a30 };
const TYPE_NAME = { knight: 'Armored Knight', bandit: 'Rogue Bandit', skeleton: 'Undead Skeleton', boss: 'The Gate Warden' };
const _v = new THREE.Vector3();

export class EnemyProxy {
  constructor(game, id, type) {
    this.game = game;
    this.id = id;
    this.kind = type;
    this.isProxy = true;
    this.boss = type === 'boss';
    this.name = TYPE_NAME[type] || type;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.dead = false;
    this.state = 'proxy';
    this.staggerT = 0;
    this.knock = new THREE.Vector3();
    this.sidestepT = 0;
    this._target = new THREE.Vector3();
    this._targetYaw = 0;
    this._lastAnim = '';
    this._hasSnap = false;
    this._rag = null; // local cosmetic corpse flight (group offset only)

    this.group = new THREE.Group();
    game.scene.add(this.group);

    // invisible-until-fallback part hitboxes (same layout as real enemies so
    // the local melee sweep feels identical)
    this.parts = {};
    const color = TYPE_COLOR[type] || 0x666666;
    for (const [key, def] of Object.entries(PART_DEFS)) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(...def.size),
        new THREE.MeshLambertMaterial({ color }));
      mesh.position.set(...def.pos);
      this.group.add(mesh);
      this.parts[key] = { key, mesh, radius: def.radius, state: 'intact' };
    }

    this.skinned = null;
    this.anim = null;
    if (SKINNED.ready) this._buildSkinned();
  }

  _buildSkinned() {
    const partNames = enemyParts(this.kind);
    if (!partNames) return;
    const baseMat = this.kind === 'skeleton' ? MATS.bone()
      : this.kind === 'boss' ? MATS.boss() : MATS.atlas();
    const c = buildSkinnedCharacter(partNames, () => baseMat.clone());
    if (!c) return;
    this.skinned = c;
    this.group.add(c.group);
    for (const p of Object.values(this.parts)) p.mesh.material.visible = false;
    const wkey = this.kind === 'bandit' ? 'dagger'
      : this.kind === 'skeleton' ? 'axe' : 'sword';
    attachWeapon(c.bones, wkey, null);
    this.anim = new Animator(c.root);
    this.anim.play(this.kind === 'skeleton' ? 'menacing' : 'idle');
  }

  applySnap(s) {
    const y = this.game.level.floorHeightAt(s.x, s.z, (this.pos.y || 0) + 1.5);
    this._target.set(s.x, y, s.z);
    this._targetYaw = s.yaw;
    if (!this._hasSnap) {
      // first sighting: appear exactly where the host says, no glide-in
      this.pos.copy(this._target);
      this.yaw = s.yaw;
    }
    this._hasSnap = true;
    if (s.dead) {
      if (!this.dead) {
        this.dead = true;
        if (this.anim) this.anim.playOnce(DEATH.has(s.anim) ? s.anim : 'deathF', { clamp: true });
        else this.group.rotation.x = 1.35; // box corpse keels over
        // local-cosmetic corpse launch on the death snapshot (host streams no
        // force info, so pick a random direction — purely visual)
        const a = Math.random() * Math.PI * 2;
        const imp = deathImpulse({ dirX: Math.cos(a), dirZ: Math.sin(a) });
        this._rag = {
          off: new THREE.Vector3(),
          vel: new THREE.Vector3(imp.vx, imp.vy, imp.vz),
          ang: new THREE.Vector3(imp.ax, imp.ay, imp.az),
          rest: false,
        };
      }
      return;
    }
    if (this.dead) {
      // host restarted the run — same enemy id is alive again
      this.dead = false;
      this._rag = null;
      this.group.rotation.x = 0;
      this._lastAnim = '';
    }
    if (this.boss) this.game.bossName = true;
    const key = s.anim || 'idle';
    if (this.anim && key !== this._lastAnim) {
      if (ONESHOT.has(key)) this.anim.playOnce(key, { fade: 0.08 });
      else this.anim.play(key);
    }
    this._lastAnim = key;
  }

  // Local-feel hit: blood + damage number happen here instantly; the real
  // damage is applied by the host and confirmed through snapshots.
  takeHit(partKey, dmg, dtype, wstats, heavy, srcPos, opts = {}) {
    if (this.dead) return null;
    const part = this.parts[partKey];
    if (!part || part.state !== 'intact') return null;
    part.mesh.getWorldPosition(_v);
    const dir = _v.clone().sub(srcPos).setY(0).normalize();
    this.game.gore.burst(_v, 14, 2.4, dir);
    toHost({
      k: 'hit', id: this.id, part: partKey, dmg, heavy: !!heavy,
      w: { key: wstats.key, rarity: wstats.rarity }, grazed: !!opts.grazed,
      p: [srcPos.x, srcPos.y, srcPos.z],
      // additive fields: attack direction + charge (old fields unchanged)
      dir: opts.dir || null, chg: opts.charge || 0,
    });
    return {
      dmg, crit: partKey === 'head', killed: false,
      executed: false, deflected: false, grazed: !!opts.grazed,
    };
  }

  applyKick(dmg, srcPos) {
    if (this.dead) return;
    toHost({ k: 'kick', id: this.id, dmg, x: srcPos.x, z: srcPos.z });
    this.parts.torso.mesh.getWorldPosition(_v);
    this.game.gore.burst(_v, 6, 1.6, null);
  }

  // Kicking/whacking the proxy corpse: local cosmetic slide + blood, no sync
  // (corpse positions are cosmetic everywhere; the host's logical pos is king).
  nudgeCorpse(srcPos, power = 1.6) {
    if (!this.dead) return;
    if (!this._rag) {
      this._rag = { off: new THREE.Vector3(), vel: new THREE.Vector3(), ang: new THREE.Vector3(), rest: true };
    }
    const r = this._rag;
    const dir = _v.set(this.pos.x - srcPos.x, 0, this.pos.z - srcPos.z);
    if (dir.lengthSq() < 1e-4) dir.set(1, 0, 0);
    dir.normalize();
    r.rest = false;
    r.vel.x += dir.x * power; r.vel.z += dir.z * power;
    r.vel.y = Math.max(r.vel.y, 1.0);
    r.ang.set((Math.random() - 0.5) * 4, 0, (Math.random() - 0.5) * 4);
    this.parts.torso.mesh.getWorldPosition(_v);
    this.game.gore.burst(_v, 12, 1.8, dir);
  }

  update(dt) {
    if (!this._hasSnap) return;
    if (this.anim) this.anim.update(dt);
    this.pos.lerp(this._target, Math.min(1, 10 * dt));
    this.yaw = lerpAngle(this.yaw, this._targetYaw, Math.min(1, 10 * dt));
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    // corpse flight physics (visual offset on top of the snapped position)
    if (this._rag) {
      const r = this._rag;
      const rc = CFG.ragdoll;
      if (!r.rest) {
        r.vel.y -= rc.gravity * dt;
        r.off.addScaledVector(r.vel, dt);
        this.group.rotation.x += r.ang.x * dt;
        this.group.rotation.z += r.ang.z * dt;
        const floorY = this.game.level.floorHeightAt(
          this.pos.x + r.off.x, this.pos.z + r.off.z, this.pos.y + r.off.y + 1) - this.pos.y;
        if (r.off.y <= floorY) {
          r.off.y = floorY;
          if (Math.abs(r.vel.y) > 1.0) {
            r.vel.y *= -rc.bounce;
            r.vel.x *= rc.bounceDampen; r.vel.z *= rc.bounceDampen;
            r.ang.multiplyScalar(0.5);
          } else {
            r.vel.y = 0;
            r.vel.x *= Math.max(0, 1 - rc.slideFriction * dt);
            r.vel.z *= Math.max(0, 1 - rc.slideFriction * dt);
            r.ang.multiplyScalar(Math.max(0, 1 - rc.angDampen * dt));
            if (Math.hypot(r.vel.x, r.vel.z) < rc.settleSpeed) { r.rest = true; r.vel.set(0, 0, 0); r.ang.set(0, 0, 0); }
          }
        }
      }
      this.group.position.add(r.off);
    }
  }

  dispose() {
    this.game.scene.remove(this.group);
  }
}
