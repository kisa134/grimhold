// gore.js — blood particle bursts, persistent severed limbs & gib chunks
// (gravity + tumble + bounce, decals where they land), growing blood pools,
// arterial wall splats, crawl smear trails, armor-deflection sparks, and
// zonal-armor dent decals (armorDent — Batch 1 contact quality).
//
// GORE 2.0: everything reads CFG.gore / CFG.limbs at use-time (tuning panel).
// New: limbs can be kicked by walking into them and re-launched by weapon
// swings; severed parts bleed out a small pool where they come to rest;
// arterial fountains play synced wet squirts and streak nearby walls;
// spilled guts persist as props for the whole run.
// Budgets: particles are ring-buffered, decals/pools/limbs recycle oldest-first.
import * as THREE from 'three';
import { CFG } from './config.js';

const PARTICLE_POOL = 2000; // allocated once; CFG.gore.maxParticles is a soft cap

const GUT_MAT = new THREE.MeshLambertMaterial({ color: 0xc98f8f, emissive: 0x2a0d10 });
const BRAIN_MAT = new THREE.MeshLambertMaterial({ color: 0xe8b0bc, emissive: 0x2a1216 });
const SKULL_MAT = new THREE.MeshLambertMaterial({ color: 0xe8e4d0 });
// armor dent/scratch: dark gouge on plate (Batch 1 zonal armor feedback)
const DENT_MAT = new THREE.MeshBasicMaterial({ color: 0x14171c, side: THREE.DoubleSide });

const _ray = new THREE.Vector3();

export class Gore {
  constructor(scene, level) {
    this.scene = scene;
    this.level = level;

    // --- blood particle pool (single THREE.Points) ---
    this.pCount = PARTICLE_POOL;
    this.pPos = new Float32Array(this.pCount * 3);
    this.pVel = new Float32Array(this.pCount * 3);
    this.pLife = new Float32Array(this.pCount);
    for (let i = 0; i < this.pCount; i++) this.pPos[i * 3 + 1] = -999;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xe01020, size: 0.12, sizeAttenuation: true, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.pCursor = 0;

    this.limbs = [];   // severed parts & gibs
    this.decals = [];  // flat floor splats / trails
    this.pools = [];   // growing pools under corpses
    this.fountains = []; // pulsing neck stumps {pos, t}
    this.sparks = [];  // armor-deflection flashes

    this.decalMat = new THREE.MeshBasicMaterial({ color: 0x6e0810, transparent: true, opacity: 0.88 });
    this.poolMat = new THREE.MeshBasicMaterial({ color: 0x52060e, transparent: true, opacity: 0.94 });
    this.wallMat = new THREE.MeshBasicMaterial({ color: 0x7a0a14, transparent: true, opacity: 0.85 });
  }

  burst(pos, count, power, dir) {
    const g = CFG.gore;
    const softCap = Math.max(0, Math.min(this.pCount, Math.round(g.maxParticles)));
    if (softCap === 0) return;
    for (let n = 0; n < count; n++) {
      const i = this.pCursor;
      this.pCursor = (this.pCursor + 1) % softCap;
      const i3 = i * 3;
      this.pPos[i3]     = pos.x + (Math.random() - 0.5) * 0.25;
      this.pPos[i3 + 1] = pos.y + (Math.random() - 0.5) * 0.25;
      this.pPos[i3 + 2] = pos.z + (Math.random() - 0.5) * 0.25;
      const spread = power * 0.7;
      this.pVel[i3]     = (dir ? dir.x * power : 0) + (Math.random() - 0.5) * spread * 2;
      this.pVel[i3 + 1] = Math.random() * power * 1.1 + 1.2;
      this.pVel[i3 + 2] = (dir ? dir.z * power : 0) + (Math.random() - 0.5) * spread * 2;
      this.pLife[i] = g.particleLifeBase + Math.random() * g.particleLifeRand;
    }
  }

  // Generic flying chunk. opts: {persistent, gib, size:[w,h,d], color}
  _chunk(pos, size, color, opts = {}) {
    const g = new THREE.Group();
    const flesh = new THREE.MeshLambertMaterial({ color: color || 0x6a5a4a });
    const stump = new THREE.MeshLambertMaterial({ color: 0xa00d14, emissive: 0x330204 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), opts.gib ? stump : flesh);
    g.add(body);
    if (!opts.gib) {
      const tip = new THREE.Mesh(
        new THREE.BoxGeometry(size[0] * 1.05, Math.min(0.1, size[1] * 0.3), size[2] * 1.05), stump);
      tip.position.y = size[1] / 2;
      g.add(tip);
      // pale bone cross-section at the cut face
      const bone = new THREE.Mesh(
        new THREE.CylinderGeometry(size[0] * 0.28, size[0] * 0.28, 0.02, 8),
        new THREE.MeshLambertMaterial({ color: 0xe8e4d0 }));
      bone.position.y = size[1] / 2 + Math.min(0.1, size[1] * 0.3) + 0.005;
      g.add(bone);
    }
    return this._addLimb(g, pos, Math.max(size[0], size[1], size[2]) / 2, opts);
  }

  // Register a pre-built group as a physics chunk (gravity/tumble/bounce/settle).
  _addLimb(g, pos, half, opts = {}) {
    g.position.copy(pos);
    g.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    this.scene.add(g);
    const limb = {
      mesh: g,
      vel: new THREE.Vector3((Math.random() - 0.5) * (opts.gib ? 7 : 5),
        2.5 + Math.random() * (opts.gib ? 4 : 2.5), (Math.random() - 0.5) * (opts.gib ? 7 : 5)),
      ang: new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12),
      half,
      life: opts.persistent ? 9999 : 10,
      rest: false,
      grounded: false,
      twitchT: 0,
      landed: false,
      persistent: !!opts.persistent, // severed parts bleed a trail mid-flight
      squishy: !!opts.squishy,       // organs land with a wet squelch
    };
    this.limbs.push(limb);
    const cap = Math.max(1, Math.round(CFG.limbs.maxLimbs));
    while (this.limbs.length > cap) {
      const old = this.limbs.shift();
      this.scene.remove(old.mesh);
    }
    return limb;
  }

  // Intestine gib: a short chain of pink-grey segments along a wobble curve.
  _gutMesh() {
    const g = new THREE.Group();
    const n = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.075, 0.15), GUT_MAT);
      s.position.set(
        Math.sin(i * 1.7) * 0.06,
        Math.cos(i * 2.3) * 0.03,
        (i - (n - 1) / 2) * 0.13);
      s.rotation.set(Math.random() * 0.9, Math.random() * 0.9, Math.random() * 0.9);
      g.add(s);
    }
    return g;
  }

  // Lumpy pale-pink brain blob (jittered icosahedron, built once per spawn).
  _brainMesh() {
    const geo = new THREE.IcosahedronGeometry(0.085, 1);
    const pa = geo.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      pa.setXYZ(i,
        pa.getX(i) * (0.85 + Math.random() * 0.35),
        pa.getY(i) * (0.75 + Math.random() * 0.3),
        pa.getZ(i) * (0.85 + Math.random() * 0.35));
    }
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, BRAIN_MAT);
  }

  // Guts spill: coiled intestine gibs, squishy physics + extra blood.
  // Gore 2.0: they PERSIST as props for the rest of the run.
  spawnGuts(pos, n = null) {
    const count = n ?? (CFG.gore.gutsBase + Math.floor(Math.random() * CFG.gore.gutsRand));
    for (let i = 0; i < count; i++) {
      this._addLimb(this._gutMesh(), new THREE.Vector3(
        pos.x + (Math.random() - 0.5) * 0.3,
        pos.y + Math.random() * 0.3,
        pos.z + (Math.random() - 0.5) * 0.3), 0.16, { gib: true, squishy: true, persistent: true });
    }
    this.burst(pos, 26, 2.6, null); // extra blood with the viscera
  }

  // Head destruction: 1-2 brain chunks + 2-3 bone-white skull shards.
  spawnBrains(pos) {
    const brains = 1 + (Math.random() < 0.5 ? 1 : 0);
    for (let i = 0; i < brains; i++) {
      this._addLimb(this._brainMesh(), new THREE.Vector3(
        pos.x + (Math.random() - 0.5) * 0.2,
        pos.y + 0.1,
        pos.z + (Math.random() - 0.5) * 0.2), 0.09, { gib: true, squishy: true });
    }
    const shards = 2 + (Math.random() < 0.5 ? 1 : 0);
    for (let i = 0; i < shards; i++) {
      const s = 0.05 + Math.random() * 0.06;
      const m = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.5, s * 1.4), SKULL_MAT);
      this._addLimb(m, new THREE.Vector3(
        pos.x + (Math.random() - 0.5) * 0.25,
        pos.y + Math.random() * 0.2,
        pos.z + (Math.random() - 0.5) * 0.25), s, { gib: true });
    }
  }

  // Severed body part — persists for the whole run (capped).
  // Severed body part as a REAL cloned mesh (not a box). mesh: THREE.Object3D
  // (the hidden region mesh from the enemy). Falls back to chunk if no mesh.
  spawnSeveredMesh(mesh, worldPos, opts = {}) {
    if (!mesh) return this._chunk(worldPos, opts.size || [0.2, 0.6, 0.2], opts.color || 0x6a5a4a, { persistent: true });
    const clone = mesh.clone(true);
    clone.traverse((o) => { if (o.isMesh) { o.visible = true; o.material = o.material.clone(); } });
    clone.position.copy(worldPos);
    clone.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    const box = new THREE.Box3().setFromObject(clone);
    const half = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z) / 2 || 0.3;
    return this._addLimb(clone, worldPos, half, { persistent: true });
  }

  spawnLimb(pos, partKey, size, color) {
    // kept for compatibility; real severing now passes a mesh via spawnSeveredMesh
    return this._chunk(pos, size, color, { persistent: true });
  }

  // Torso-burst gibs: small red chunks that paint the floor where they land.
  spawnGibs(pos, color, n = 4) {
    for (let i = 0; i < n; i++) {
      const s = 0.14 + Math.random() * 0.16;
      this._chunk(new THREE.Vector3(
        pos.x + (Math.random() - 0.5) * 0.4,
        pos.y + Math.random() * 0.4,
        pos.z + (Math.random() - 0.5) * 0.4), [s, s, s], color, { gib: true });
    }
  }

  // Walking into a severed part kicks it along; called each frame with the
  // player's position + horizontal velocity. Cheap sphere-vs-circle check.
  kickLimbs(playerPos, velX, velZ) {
    const speed = Math.hypot(velX, velZ);
    if (speed < 1.2) return;
    const lc = CFG.limbs;
    for (const l of this.limbs) {
      const mp = l.mesh.position;
      if (Math.abs(mp.y - playerPos.y) > 1.4) continue;
      const dx = mp.x - playerPos.x, dz = mp.z - playerPos.z;
      const r = l.half + 0.42;
      if (dx * dx + dz * dz > r * r) continue;
      const inv = 1 / (speed || 1);
      l.vel.x += velX * inv * lc.kickPush;
      l.vel.z += velZ * inv * lc.kickPush;
      l.vel.y = Math.max(l.vel.y, lc.kickLift * (0.6 + Math.random() * 0.6));
      l.rest = false;
      l.grounded = false;
      l.twitchT = 0;
      l.ang.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
    }
  }

  // A weapon swing re-launches any chunk caught in the sweep corridor.
  // Returns how many were launched (one call per swing).
  launchNearRay(origin, dir, range, power) {
    let launched = 0;
    for (const l of this.limbs) {
      const mp = l.mesh.position;
      _ray.copy(mp).sub(origin);
      const t = _ray.dot(dir);
      if (t < 0.15 || t > range + 0.4) continue;
      const latSq = Math.max(0, _ray.lengthSq() - t * t);
      if (latSq > 0.45) continue; // ~0.67 m corridor
      l.vel.x += dir.x * power + (Math.random() - 0.5) * 1.5;
      l.vel.z += dir.z * power + (Math.random() - 0.5) * 1.5;
      l.vel.y = Math.max(l.vel.y, power * 0.45 + Math.random() * 1.2);
      l.rest = false;
      l.grounded = false;
      l.twitchT = 0;
      l.ang.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
      launched++;
      this.burst(mp, 5, 1.4, null); // squeeze out a little more blood
    }
    return launched;
  }

  decal(x, y, z, scale) {
    const r = (0.5 + Math.random() * 0.5) * (scale || 1);
    this._flatDecal(x, y + 0.02 + Math.random() * 0.015, z, r, this.decalMat, false);
  }

  // Smeared crawl trail (legless enemies drag themselves through their own blood)
  crawlTrail(x, y, z) {
    this._flatDecal(x + (Math.random() - 0.5) * 0.2, y + 0.015, z + (Math.random() - 0.5) * 0.2,
      0.16 + Math.random() * 0.1, this.decalMat, false);
  }

  // Growing pool under a corpse: spreads to its full radius over
  // CFG.gore.poolGrowTime seconds, then persists for the run.
  pool(x, y, z, scale = 1) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.5, 14), this.poolMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y + 0.018 + Math.random() * 0.01, z);
    m.userData.t = 0;
    m.userData.maxR = CFG.gore.poolMaxR * scale;
    m.userData.scale0 = 0.6 * scale;
    m.scale.setScalar(m.userData.scale0);
    this.scene.add(m);
    this.pools.push(m);
    const cap = Math.max(1, Math.round(CFG.gore.maxPools));
    while (this.pools.length > cap) {
      const old = this.pools.shift();
      this.scene.remove(old); old.geometry.dispose();
    }
  }

  // Arterial spray on a nearby wall (vertical splat facing the hit)
  wallSplat(from, dir) {
    const hit = this.level.raycastWall(from, dir, 3.2);
    if (!hit) return;
    const r = 0.3 + Math.random() * 0.35;
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 10), this.wallMat);
    m.position.copy(hit.point).addScaledVector(hit.normal, 0.03);
    m.position.y = Math.max(hit.point.y - 0.2 + Math.random() * 0.8, 0.3);
    m.lookAt(m.position.clone().add(hit.normal));
    m.rotation.z = Math.random() * Math.PI * 2;
    this.scene.add(m);
    this.decals.push(m);
    this._capDecals();
  }

  _flatDecal(x, y, z, r, mat) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 12), mat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.random() * Math.PI * 2;
    m.position.set(x, y, z);
    this.scene.add(m);
    this.decals.push(m);
    this._capDecals();
  }

  _capDecals() {
    const cap = Math.max(1, Math.round(CFG.gore.maxDecals));
    while (this.decals.length > cap) {
      const old = this.decals.shift();
      this.scene.remove(old); old.geometry.dispose();
    }
  }

  // Armor-deflection spark: bright flash that pops and dies in 0.12s.
  spark(pos) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.14, 0.14),
      new THREE.MeshBasicMaterial({ color: 0xffd870, transparent: true, opacity: 1 }));
    m.position.copy(pos);
    m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    this.scene.add(m);
    this.sparks.push({ mesh: m, t: 0.12 });
    this.burst(pos, 6, 1.8, null); // a few hot flecks with it
  }

  // Armor dent: a dark scratch/gouge decal at the hit position, following the
  // enemy wound-decal pattern (bone-attached on skinned rigs — bone space is
  // in centimeters — surface plane on box bodies). The decal is owned by the
  // enemy part (dies with it), capped at CFG.gore.woundMax per part. Accepts
  // the contract part names (armL/legR/...) as well as internal part keys.
  armorDent(enemy, partName, pos) {
    if (!enemy || !enemy.parts) return;
    const ALIAS = { armL: 'leftArm', armR: 'rightArm', legL: 'leftLeg', legR: 'rightLeg' };
    const key = ALIAS[partName] || partName;
    const part = enemy.parts[key];
    if (!part) return;
    const dents = part.dents || (part.dents = []);
    if (dents.length >= CFG.gore.woundMax) return; // share the wound budget
    const local = pos && pos.isVector3 ? pos.clone() : null;
    if (enemy.skinned && typeof enemy._boneForPart === 'function') {
      const bone = enemy._boneForPart(key);
      if (!bone) return;
      const d = new THREE.Mesh(
        new THREE.PlaneGeometry(6 + Math.random() * 5, 2.5 + Math.random() * 2.5), DENT_MAT);
      if (local) {
        bone.worldToLocal(local);
        d.position.set(
          THREE.MathUtils.clamp(local.x + (Math.random() - 0.5) * 6, -14, 14),
          THREE.MathUtils.clamp(local.y + (Math.random() - 0.5) * 6, -14, 14), 8);
      } else {
        d.position.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, 8);
      }
      d.rotation.z = Math.random() * Math.PI;
      bone.add(d);
      dents.push(d);
      return;
    }
    const s = part.size;
    const d = new THREE.Mesh(
      new THREE.PlaneGeometry(0.07 + Math.random() * 0.05, 0.025 + Math.random() * 0.025), DENT_MAT);
    if (local) {
      part.mesh.worldToLocal(local);
      d.position.set(
        THREE.MathUtils.clamp(local.x + (Math.random() - 0.5) * s[0] * 0.3, -s[0] * 0.45, s[0] * 0.45),
        THREE.MathUtils.clamp(local.y + (Math.random() - 0.5) * s[1] * 0.3, -s[1] * 0.45, s[1] * 0.45),
        s[2] / 2 + 0.007);
    } else {
      d.position.set(
        (Math.random() - 0.5) * s[0] * 0.6,
        (Math.random() - 0.5) * s[1] * 0.6,
        s[2] / 2 + 0.007);
    }
    d.rotation.z = Math.random() * Math.PI;
    part.mesh.add(d);
    dents.push(d);
  }

  // Pulsing arterial fountain from a stump. scale < 1 = limb stumps (smaller,
  // shorter sprays); scale 1 = neck stump after decapitation.
  fountain(pos, dur = 2.0, scale = 1) {
    this.fountains.push({ pos: pos.clone(), t: dur, dur, drip: 0, scale, sqCd: 0, wallT: 0.2 });
  }

  // dt: frame delta. player: optional {pos, vel} for limb kick-nudges.
  update(dt, player) {
    const g = CFG.gore, lc = CFG.limbs;

    // stump fountains pump bursts in heartbeat-like pulses, synced with wet
    // squirting audio; close walls catch streak decals
    for (let i = this.fountains.length - 1; i >= 0; i--) {
      const f = this.fountains[i];
      f.t -= dt;
      if (f.t <= 0) { this.fountains.splice(i, 1); continue; }
      const pulse = 0.5 + 0.5 * Math.sin(f.t * g.pulseRate);
      const n = Math.round((3 + pulse * 9) * (f.t / f.dur) * f.scale);
      if (n > 0) this.burst(f.pos, n, (2.6 + pulse * 1.4) * (0.6 + 0.4 * f.scale), null);
      // wet squirt synced to each pulse peak
      f.sqCd -= dt;
      if (pulse > 0.85 && f.sqCd <= 0) {
        f.sqCd = Math.PI * 2 / g.pulseRate;
        if (this.audio) this.audio.arterialSquirt(f.pos);
      }
      // arterial streaks on nearby walls
      f.wallT -= dt;
      if (f.wallT <= 0) {
        f.wallT = 0.35;
        if (Math.random() < g.sprayWallChance) {
          const a = Math.random() * Math.PI * 2;
          this.wallSplat(f.pos, _ray.set(Math.cos(a), 0.15, Math.sin(a)).normalize());
        }
      }
      f.drip -= dt;
      if (f.drip <= 0) {
        f.drip = g.dripT;
        this.decal(f.pos.x + (Math.random() - 0.5) * 0.7, f.pos.y - 1.4, f.pos.z + (Math.random() - 0.5) * 0.7, 0.7 * f.scale);
      }
    }

    // particles
    for (let i = 0; i < this.pCount; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      const i3 = i * 3;
      if (this.pLife[i] <= 0) { this.pPos[i3 + 1] = -999; continue; }
      this.pVel[i3 + 1] -= g.particleGravity * dt;
      this.pPos[i3]     += this.pVel[i3] * dt;
      this.pPos[i3 + 1] += this.pVel[i3 + 1] * dt;
      this.pPos[i3 + 2] += this.pVel[i3 + 2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;

    // player wading through the leftovers kicks loose chunks along
    if (player && !player.dead) this.kickLimbs(player.pos, player.vel.x, player.vel.z);

    // limb & gib chunks: tumble -> bounce -> roll with friction -> settle -> twitch
    for (let i = this.limbs.length - 1; i >= 0; i--) {
      const l = this.limbs[i];
      l.life -= dt;
      if (l.life <= 0) {
        this.scene.remove(l.mesh);
        this.limbs.splice(i, 1);
        continue;
      }
      if (!l.rest) {
        l.vel.y -= lc.gravity * dt;
        l.mesh.position.addScaledVector(l.vel, dt);
        if (!l.grounded) {
          l.mesh.rotation.x += l.ang.x * dt;
          l.mesh.rotation.y += l.ang.y * dt;
          l.mesh.rotation.z += l.ang.z * dt;
        } else {
          // grounded roll: friction + roll-from-velocity (slides down steps)
          l.vel.x *= Math.max(0, 1 - lc.groundFriction * dt);
          l.vel.z *= Math.max(0, 1 - lc.groundFriction * dt);
          l.mesh.rotation.x += (l.vel.z / l.half) * dt;
          l.mesh.rotation.z -= (l.vel.x / l.half) * dt;
        }
        // severed parts squirt a blood trail while airborne (until first bounce)
        if (!l.grounded && l.persistent) {
          const sp = l.vel.length();
          if (sp > 2 && Math.random() < 0.6) {
            this.burst(l.mesh.position, Math.min(3, 1 + Math.floor(sp * 0.25)), 0.9, null);
          }
        }
        const floor = this.level.floorHeightAt(l.mesh.position.x, l.mesh.position.z, l.mesh.position.y + 0.5) + l.half;
        if (l.mesh.position.y <= floor) {
          l.mesh.position.y = floor;
          if (!l.grounded && Math.abs(l.vel.y) > 1.2) {
            l.vel.y *= -lc.restitution;
            l.vel.x *= lc.bounceDampen; l.vel.z *= lc.bounceDampen; // one bounce, then it rolls
            if (l.squishy && !l._squished) {
              l._squished = true;
              if (this.audio) this.audio.squelch(l.mesh.position);
            }
          } else if (!l.grounded) {
            l.grounded = true;
            l.vel.y = 0;
            if (!l.landed) {
              l.landed = true;
              // paint the floor where the chunk lands
              this.decal(l.mesh.position.x, floor - l.half, l.mesh.position.z, 0.8);
              if (l.squishy && !l._squished) {
                l._squished = true;
                if (this.audio) this.audio.squelch(l.mesh.position);
              }
            }
          } else {
            l.vel.y = 0;
            if (Math.hypot(l.vel.x, l.vel.z) < 0.25) {
              l.rest = true;
              l.twitchT = lc.twitchMin + Math.random() * lc.twitchRand; // post-mortem twitch
              // bleed-out: a severed part soaks a small pool where it rests
              if (l.persistent && lc.restPoolScale > 0 && !l._restPooled) {
                l._restPooled = true;
                this.pool(l.mesh.position.x, floor - l.half, l.mesh.position.z, lc.restPoolScale);
              }
            }
          }
        }
      } else if (l.twitchT > 0) {
        l.twitchT -= dt;
        l.mesh.rotation.z += (Math.random() - 0.5) * 0.22;
        l.mesh.scale.setScalar(1 + 0.12 * Math.sin(l.twitchT * 30));
        if (l.twitchT <= 0) l.mesh.scale.setScalar(1);
      }
    }

    // armor sparks pop and die
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.t -= dt;
      if (s.t <= 0) {
        this.scene.remove(s.mesh);
        s.mesh.geometry.dispose(); s.mesh.material.dispose();
        this.sparks.splice(i, 1);
        continue;
      }
      s.mesh.scale.addScalar(6 * dt);
      s.mesh.material.opacity = s.t / 0.12;
    }

    // pools spread to full size over poolGrowTime seconds, then hold
    for (const p of this.pools) {
      if (p.scale.x < p.userData.maxR) {
        p.userData.t += dt;
        const k = Math.min(1, p.userData.t / Math.max(0.1, g.poolGrowTime));
        const s = Math.min(p.userData.maxR,
          p.userData.scale0 + (p.userData.maxR - p.userData.scale0) * k);
        p.scale.set(s, s, 1);
      }
    }
  }

  reset() {
    for (let i = 0; i < this.pCount; i++) { this.pLife[i] = 0; this.pPos[i * 3 + 1] = -999; }
    this.points.geometry.attributes.position.needsUpdate = true;
    for (const l of this.limbs) this.scene.remove(l.mesh);
    this.limbs.length = 0;
    for (const d of this.decals) { this.scene.remove(d); d.geometry.dispose(); }
    this.decals.length = 0;
    for (const p of this.pools) { this.scene.remove(p); p.geometry.dispose(); }
    this.pools.length = 0;
    this.fountains.length = 0;
    for (const s of this.sparks) { this.scene.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh.material.dispose(); }
    this.sparks.length = 0;
  }
}
