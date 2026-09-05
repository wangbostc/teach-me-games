// Physically-based materials with procedurally generated surface detail.
// Every texture here is painted onto a <canvas> at load time -- brushed-metal
// streaks, cloth weave, wood grain, fur, stone grain -- so the pieces get
// real micro-surface variation without a single image file to host or
// license.
//
// Textures are cached and SHARED (they're read-only). Materials are created
// fresh per call: selection highlighting mutates a material's emissive
// channel, so two pieces must never share one.
import * as THREE from "three";

const textureCache = new Map();

// The cache above is the one GPU resource this module owns that outlives
// any single material -- a texture here is referenced by many materials
// across many pieces, so disposing it must happen exactly once, from
// outside, once nothing needs the cache anymore, rather than each material
// disposing a map it merely borrowed. Board3D.dispose() calls this once per
// game (finding 1); nothing else in this module should call it.
export function disposeTextureCache() {
  for (const texture of textureCache.values()) texture.dispose();
  textureCache.clear();
}

function canvas(size) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return c;
}

function finishTexture(c, repeat) {
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 4;
  return tex;
}

// Value noise, optionally streaked along x (brushed metal) or y (fur, grain).
function noiseTexture(key, { size = 256, base = 128, amp = 40, repeat = 2, streakX = 0, streakY = 0 } = {}) {
  if (textureCache.has(key)) return textureCache.get(key);
  const c = canvas(size);
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(size, size);
  const rand = new Float32Array(size * size);
  for (let i = 0; i < rand.length; i++) rand[i] = Math.random();
  const data = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      let n = 0;
      for (let k = -streakX; k <= streakX; k++) {
        for (let j = -streakY; j <= streakY; j++) {
          v += rand[((y + j + size) % size) * size + ((x + k + size) % size)];
          n++;
        }
      }
      v /= n;
      const val = Math.max(0, Math.min(255, base + (v - 0.5) * 2 * amp));
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = val;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = finishTexture(c, repeat);
  textureCache.set(key, tex);
  return tex;
}

// Wear and tarnish for metal: a mostly-neutral map with sparse dark blotches
// and scratches. Used as a colour multiplier (map) AND as roughness, so worn
// spots are both darker and duller -- exactly how real armour tarnishes.
// Uniformly clean metal is the surest tell that a surface is rendered.
function wearTexture(key, { size = 256, repeat = 2, density = 0.0009, scratches = 24 } = {}) {
  if (textureCache.has(key)) return textureCache.get(key);
  const c = canvas(size);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "rgb(236,236,236)";
  ctx.fillRect(0, 0, size, size);
  // Soft tarnish blotches.
  const blotches = Math.round(size * size * density);
  for (let i = 0; i < blotches; i++) {
    const r = 6 + Math.random() * 22;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    const dark = 150 + Math.random() * 50;
    g.addColorStop(0, `rgba(${dark},${dark},${dark},0.55)`);
    g.addColorStop(1, "rgba(200,200,200,0)");
    ctx.save();
    ctx.translate(Math.random() * size, Math.random() * size);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // Fine scratches.
  ctx.strokeStyle = "rgba(120,120,120,0.35)";
  ctx.lineWidth = 0.7;
  for (let i = 0; i < scratches; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const a = Math.random() * Math.PI;
    const len = 10 + Math.random() * 40;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  // Brushed grain underneath.
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    const row = (Math.random() - 0.5) * 18;
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const v = row + (Math.random() - 0.5) * 6;
      d[i] = Math.max(0, Math.min(255, d[i] + v));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + v));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + v));
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = finishTexture(c, repeat);
  textureCache.set(key, tex);
  return tex;
}

// A woven cloth bump: alternating warp/weft cells with a little noise.
function weaveTexture(key, { size = 128, repeat = 12 } = {}) {
  if (textureCache.has(key)) return textureCache.get(key);
  const c = canvas(size);
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(size, size);
  const cell = 4;
  const data = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const warp = Math.floor(x / cell) % 2 === Math.floor(y / cell) % 2;
      const within = warp ? (x % cell) / cell : (y % cell) / cell;
      const ridge = Math.sin(within * Math.PI);
      const val = 110 + ridge * 90 + (Math.random() - 0.5) * 20;
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.max(0, Math.min(255, val));
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = finishTexture(c, repeat);
  textureCache.set(key, tex);
  return tex;
}

// Wood grain: rings running along v, wobbled so they read as planks not stripes.
function woodTexture(key, { size = 256, light, dark, rings = 5, repeat = 1 }) {
  if (textureCache.has(key)) return textureCache.get(key);
  const c = canvas(size);
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(size, size);
  const data = img.data;
  const lc = new THREE.Color(light);
  const dc = new THREE.Color(dark);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Slow, gentle drift so rings bow like a real plank without zig-zagging.
      const wobble = Math.sin((y / size) * Math.PI * 1.3) * 0.7;
      const t = 0.5 + 0.5 * Math.sin((x / size) * rings * Math.PI * 2 + wobble);
      // Soft contrast between early and late wood, plus faint fine grain.
      const grain = 0.35 + Math.pow(t, 1.4) * 0.65 + (Math.random() - 0.5) * 0.05;
      const k = Math.max(0, Math.min(1, grain));
      const i = (y * size + x) * 4;
      data[i] = (dc.r + (lc.r - dc.r) * k) * 255;
      data[i + 1] = (dc.g + (lc.g - dc.g) * k) * 255;
      data[i + 2] = (dc.b + (lc.b - dc.b) * k) * 255;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = finishTexture(c, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  textureCache.set(key, tex);
  return tex;
}

// Feather barbs: fine lines fanning slightly, as a bump map for wings.
function featherTexture(key, { size = 256, repeat = 3 } = {}) {
  if (textureCache.has(key)) return textureCache.get(key);
  const c = canvas(size);
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(size, size);
  const data = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const barb = Math.sin((y + x * 0.35) * 0.9) * 0.5 + 0.5;
      const shaft = Math.abs(((x / size) * 6) % 1 - 0.5) < 0.03 ? 0.35 : 0;
      const val = 120 + barb * 70 - shaft * 120 + (Math.random() - 0.5) * 14;
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.max(0, Math.min(255, val));
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = finishTexture(c, repeat);
  textureCache.set(key, tex);
  return tex;
}

// -- Material recipes ------------------------------------------------------

// Fully metallic surfaces reflect only their environment, and a neutral
// room map is fairly dim -- so metalness is held back a little and the env
// intensity pushed up, which keeps armor reading as bright steel rather than
// gunmetal under this scene's lighting.
export function polishedMetal(color, { roughness = 0.42, clearcoat = 0.5, envMapIntensity = 2.2 } = {}) {
  const wear = wearTexture("wear-steel", { repeat: 2 });
  return new THREE.MeshPhysicalMaterial({
    color,
    map: wear,
    metalness: 0.8,
    roughness,
    roughnessMap: wear,
    clearcoat,
    clearcoatRoughness: 0.15,
    envMapIntensity,
  });
}

export function burnishedGold(color = 0xe0b458) {
  const wear = wearTexture("wear-gold", { repeat: 2, density: 0.0005, scratches: 14 });
  return new THREE.MeshPhysicalMaterial({
    color,
    map: wear,
    metalness: 0.85,
    roughness: 0.32,
    roughnessMap: wear,
    clearcoat: 0.3,
    clearcoatRoughness: 0.2,
    envMapIntensity: 2.4,
  });
}

export function cloth(color, { sheen = 0.7 } = {}) {
  const c = new THREE.Color(color);
  const sheenColor = c.clone().lerp(new THREE.Color(0xffffff), 0.45);
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0,
    roughness: 0.92,
    sheen,
    sheenColor,
    sheenRoughness: 0.75,
    bumpMap: weaveTexture("weave"),
    bumpScale: 0.004,
    envMapIntensity: 0.6,
  });
}

export function skin(color = 0xe9c7a6) {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0,
    roughness: 0.62,
    sheen: 0.25,
    sheenColor: 0xffd9c4,
    sheenRoughness: 0.9,
    bumpMap: noiseTexture("pores", { base: 128, amp: 30, repeat: 6 }),
    bumpScale: 0.0015,
    envMapIntensity: 0.7,
  });
}

export function hair(color) {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0,
    roughness: 0.55,
    sheen: 0.8,
    sheenColor: 0xfff1c4,
    sheenRoughness: 0.4,
    bumpMap: noiseTexture("strands", { base: 128, amp: 60, repeat: 4, streakY: 6 }),
    bumpScale: 0.005,
    envMapIntensity: 0.8,
  });
}

export function wood(light = 0x8b5e3c, dark = 0x54341c, { repeat = 1, roughness = 0.75, rings = 5 } = {}) {
  const map = woodTexture(`wood-${light}-${dark}-${repeat}-${rings}`, { light, dark, repeat, rings });
  return new THREE.MeshPhysicalMaterial({
    map,
    metalness: 0,
    roughness,
    bumpMap: map,
    bumpScale: 0.0015,
    clearcoat: 0.25,
    clearcoatRoughness: 0.35,
    envMapIntensity: 0.9,
  });
}

export function hide(color) {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0,
    roughness: 0.78,
    sheen: 0.45,
    sheenColor: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.3),
    sheenRoughness: 0.6,
    bumpMap: noiseTexture("fur", { base: 128, amp: 60, repeat: 5, streakY: 5 }),
    bumpScale: 0.006,
    envMapIntensity: 0.7,
  });
}

export function feathers(color = 0xf9f6f0) {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0,
    roughness: 0.7,
    sheen: 0.6,
    sheenColor: 0xffffff,
    sheenRoughness: 0.5,
    bumpMap: featherTexture("feathers"),
    bumpScale: 0.006,
    envMapIntensity: 0.8,
  });
}

export function stone(color) {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0.05,
    roughness: 0.95,
    bumpMap: noiseTexture("grit", { base: 128, amp: 90, repeat: 4 }),
    bumpScale: 0.01,
    envMapIntensity: 0.5,
  });
}

export function matte(color, roughness = 0.7) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.05, envMapIntensity: 0.7 });
}

export function glow(color, emissive, intensity = 0.9) {
  return new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: intensity, roughness: 0.3 });
}

// Flat-colored but physically shaded -- the fallback for factions that don't
// yet have hand-authored units.
export function paintedMetal(color) {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.35,
    roughness: 0.5,
    roughnessMap: noiseTexture("brushed", { base: 150, amp: 70, repeat: 3, streakX: 7 }),
    clearcoat: 0.3,
    clearcoatRoughness: 0.3,
    envMapIntensity: 1.0,
  });
}
