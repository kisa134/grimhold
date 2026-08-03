// sparks.js — metal-on-metal spark bursts for parries, blocks, armor deflects
// and blade-on-stone. One pooled additive THREE.Points (white-hot -> orange,
// gravity, ~0.3-0.5s life) + ONE shared PointLight flash that is repositioned
// and re-spiked per burst (~0.12s decay) — no per-burst lights, 60fps-safe.
import * as THREE from 'three';

const MAX_SPARKS = 320;
const FLASH_T = 0.12;
const FLASH_I = 26;

// tints: 'white' (parry / default), 'gold' (chamber), 'orange' (weapon clash),
// 'bone' (pale ivory — bone hits), 'armor' (blue-white — armor hits/breaks).
// coolG/coolB = [base, mul]: end-of-life channel target is base + mul * lifeFrac,
// letting pale/blue sparks cool toward their own hue instead of universal orange.
export const TINTS = {
  white:  { hot: [1.0, 1.0, 0.92],  light: 0xfff4e0, coolG: [0.35, 0.55], coolB: [0.0, 0.25] },
  gold:   { hot: [1.0, 0.82, 0.30], light: 0xffd76a, coolG: [0.35, 0.55], coolB: [0.0, 0.25] },
  orange: { hot: [1.0, 0.55, 0.16], light: 0xff9a30, coolG: [0.35, 0.55], coolB: [0.0, 0.25] },
  bone:   { hot: [0.96, 0.94, 0.85], light: 0xf2e8d0, coolG: [0.42, 0.45], coolB: [0.06, 0.30] },
  armor:  { hot: [0.78, 0.87, 1.0],  light: 0xbfd8ff, coolG: [0.45, 0.40], coolB: [0.18, 0.45] },
};

export class Sparks {
  constructor(scene) {
    this.scene = scene;
    this.count = MAX_SPARKS;
    this.pos = new Float32Array(this.count * 3);
    this.vel = new Float32Array(this.count * 3);
    this.col = new Float32Array(this.count * 3);
    this.life = new Float32Array(this.count);
    this.maxLife = new Float32Array(this.count);
    // per-spark cool targets, packed [gBase, gMul, bBase, bMul] — set per burst
    // from the tint so each hue dies toward its own color (default: white's)
    this.coolA = new Float32Array(this.count * 4);
    for (let i = 0; i < this.count; i++) {
      this.pos[i * 3 + 1] = -999;
      const i4 = i * 4;
      this.coolA[i4] = 0.35; this.coolA[i4 + 1] = 0.55;
      this.coolA[i4 + 2] = 0.0; this.coolA[i4 + 3] = 0.25;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.055, vertexColors: true, sizeAttenuation: true,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.cursor = 0;

    // the one and only flash light — pooled, never created per burst
    this.light = new THREE.PointLight(0xffd9a8, 0, 5.5, 2);
    scene.add(this.light);
    this.flashT = 0;
  }

  burst(pos, count = 26, tint = 'white') {
    const tc = TINTS[tint] || TINTS.white;
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.count;
      const i3 = i * 3;
      this.pos[i3] = pos.x; this.pos[i3 + 1] = pos.y; this.pos[i3 + 2] = pos.z;
      const a = Math.random() * Math.PI * 2;
      const sp = 2.5 + Math.random() * 4.5;
      this.vel[i3] = Math.cos(a) * sp * (0.3 + Math.random() * 0.7);
      this.vel[i3 + 1] = (0.35 + Math.random() * 0.9) * sp * 0.8;
      this.vel[i3 + 2] = Math.sin(a) * sp * (0.3 + Math.random() * 0.7);
      this.life[i] = this.maxLife[i] = 0.3 + Math.random() * 0.2;
      // hot core tinted by the mechanic, cooling handled in update()
      const hot = 0.75 + Math.random() * 0.25;
      this.col[i3] = tc.hot[0]; this.col[i3 + 1] = tc.hot[1] * (0.7 + 0.3 * hot); this.col[i3 + 2] = tc.hot[2] * hot;
      const i4 = i * 4;
      this.coolA[i4] = tc.coolG[0]; this.coolA[i4 + 1] = tc.coolG[1];
      this.coolA[i4 + 2] = tc.coolB[0]; this.coolA[i4 + 3] = tc.coolB[1];
    }
    // pooled flash: spike, decay handled in update
    this.light.position.copy(pos);
    this.light.color.setHex(tc.light);
    this.light.intensity = FLASH_I;
    this.flashT = FLASH_T;
  }

  update(dt) {
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const i3 = i * 3;
      if (this.life[i] <= 0) { this.pos[i3 + 1] = -999; continue; }
      this.vel[i3 + 1] -= 16 * dt;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      // cool toward the tint's own dying hue as the spark dies
      const k = this.life[i] / this.maxLife[i];
      const i4 = i * 4;
      this.col[i3 + 1] = Math.min(this.col[i3 + 1], this.coolA[i4] + this.coolA[i4 + 1] * k);
      this.col[i3 + 2] = this.coolA[i4 + 2] + this.coolA[i4 + 3] * k;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.light.intensity = this.flashT > 0 ? FLASH_I * (this.flashT / FLASH_T) : 0;
    }
  }

  reset() {
    for (let i = 0; i < this.count; i++) { this.life[i] = 0; this.pos[i * 3 + 1] = -999; }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.flashT = 0;
    this.light.intensity = 0;
  }
}
