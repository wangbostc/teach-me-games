// Stronghold -- orcs, ogres and brutes. Packed earth and crude bronze,
// green hide and rust iron, with a storm-bird totem and a horned behemoth at
// the top of the roster. Built from the shared body plans in common.js;
// nothing is loaded from any game or asset pack.
import * as THREE from "three";
import {
  add,
  pair,
  addWings,
  glowEyes,
  humanoid,
  quadruped,
  spear,
  staff,
  club,
  spikedShield,
} from "/static/units/common.js";
import {
  polishedMetal,
  cloth,
  skin,
  wood,
  hide,
  feathers,
  matte,
  glow,
} from "/static/units/materials.js";

const PALETTE = {
  orcGreen: 0x6b7f45,
  rustBrown: 0x8c5a2f,
  tanHide: 0xb9822f,
  ironGrey: 0x6a6a70,
  bloodRed: 0x8c2f2f,
  bone: 0xded3bd,
  ogreBlue: 0x4a6b8c,
  darkLeather: 0x4a3728,
  lightningYellow: 0xffe066,
};

export const BASE_COLOR = 0x4a3a2a;
export const ACCENT_COLOR = PALETTE.tanHide;
export const UNITS = { p: "goblin", n: "wolfrider", b: "ogremage", r: "cyclops", q: "thunderbird", k: "behemoth" };

// Fresh materials per piece: selection highlighting mutates a piece's
// emissive channel, and shared materials would light up every piece at once.
// (The procedural textures underneath ARE shared -- see materials.js.)
function makeMats() {
  return {
    orcSkin: skin(PALETTE.orcGreen),
    tanHide: skin(PALETTE.tanHide),
    rustHide: hide(PALETTE.rustBrown),
    bellyHide: hide(PALETTE.tanHide),
    wolfHide: hide(PALETTE.ironGrey),
    wolfMane: hide(0x55525c),
    ironGrey: polishedMetal(PALETTE.ironGrey, { roughness: 0.6 }),
    bloodRed: cloth(PALETTE.bloodRed),
    darkLeather: cloth(PALETTE.darkLeather, { sheen: 0.15 }),
    bone: matte(PALETTE.bone, 0.55),
    ogreBlue: skin(PALETTE.ogreBlue),
    lightningGlow: glow(PALETTE.lightningYellow, PALETTE.lightningYellow, 1.0),
    stormFeather: feathers(PALETTE.rustBrown),
    stormFeatherWing: feathers(0x6f4526),
    beak: polishedMetal(0x3a3530, { roughness: 0.4 }),
    eyeDark: matte(0x161616, 0.35),
    wood: wood(0x5c4028, 0x2e1f10, { repeat: 1.5, roughness: 0.7 }),
  };
}

// p -- a small, crude orc. Scrappy, the humblest unit in the army.
function goblin(m) {
  const built = humanoid({
    body: m.orcSkin,
    skin: m.orcSkin,
    cloth: m.darkLeather,
    accent: m.ironGrey,
    boot: m.darkLeather,
    bulk: 0.8,
    legLen: 0.32,
  });
  spear(built.group, { shaft: m.wood, head: m.ironGrey }, 0.17, { length: 0.9 });
  spikedShield(built.group, { face: m.darkLeather, rim: m.ironGrey, spike: m.ironGrey }, -0.22, { r: 0.1 });
  return built;
}

// n -- a goblin mounted on a great wolf. Follows castle.js's cavalier
// technique: build the mount, then seat a scaled rider on its `backY`.
function wolfrider(m) {
  const mount = quadruped({
    body: m.wolfHide,
    mane: m.wolfMane,
    accent: m.ironGrey,
    eye: m.eyeDark,
    hoof: m.ironGrey,
    bodyLen: 0.44,
    bodyR: 0.17,
    legLen: 0.32,
    neckLen: 0.28,
    head: "wolf",
    digitigrade: true,
    tailStyle: "reptile",
  });
  const g = mount.group;

  // A crude leather saddle strapped over the withers.
  const saddleY = mount.backY + 0.015;
  add(g, new THREE.BoxGeometry(0.16, 0.03, 0.2), m.darkLeather, 0, saddleY, 0);

  // Rider, seated so the hips land on the saddle.
  const riderScale = 0.72;
  const rider = humanoid({
    body: m.orcSkin,
    skin: m.orcSkin,
    cloth: m.darkLeather,
    accent: m.ironGrey,
    boot: m.ironGrey,
    legs: "mounted",
    bulk: 0.85,
  });
  spear(rider.group, { shaft: m.wood, head: m.ironGrey }, 0.18, { length: 0.85 });
  rider.group.scale.setScalar(riderScale);
  rider.group.position.set(0, saddleY - rider.hip * riderScale + 0.02, 0);
  g.add(rider.group);
  const riderTop = rider.group.position.y + rider.height * riderScale;

  return { group: g, height: Math.max(riderTop, mount.height) };
}

// b -- a hulking blue-skinned ogre shaman. Bulky, not tall.
function ogremage(m) {
  const built = humanoid({
    body: m.ogreBlue,
    skin: m.ogreBlue,
    cloth: m.darkLeather,
    accent: m.bone,
    boot: m.darkLeather,
    bulk: 1.35,
    legLen: 0.36,
    torsoLen: 0.34,
  });
  const g = built.group;

  // A big sagging belly, bulging out over the front of the belt.
  add(g, new THREE.SphereGeometry(0.17, 14, 10), m.ogreBlue, 0, built.hip + 0.14, -0.06);

  // Tusks jutting up from the jaw.
  pair((s) => add(g, new THREE.ConeGeometry(0.016, 0.09, 6), m.bone, s * 0.035, built.headY - 0.1, -0.085, -0.35, 0, s * 0.15));

  // Bone jewelry: a necklace of small beads worn over the chest.
  for (let i = -2; i <= 2; i++) {
    add(g, new THREE.SphereGeometry(0.018, 8, 6), m.bone, i * 0.03, built.shoulderY - 0.02 + Math.abs(i) * 0.012, -0.13);
  }

  staff(g, { shaft: m.wood, orb: m.bone }, -0.24, { length: 1.0, orbR: 0.05, gem: m.bone });
  return built;
}

// r -- a one-eyed giant, tan-hided and minimally armored. The heaviest
// silhouette on foot.
function cyclops(m) {
  const built = humanoid({
    body: m.tanHide,
    skin: m.tanHide,
    accent: m.ironGrey,
    boot: m.ironGrey,
    cloth: m.darkLeather,
    eye: m.bloodRed,
    head: "cyclops",
    bulk: 1.4,
    legLen: 0.4,
    torsoLen: 0.36,
    headR: 0.11,
  });
  club(built.group, { shaft: m.wood, head: m.ironGrey }, 0.27, { length: 0.55, spiked: true });
  return built;
}

// q -- a great storm bird, built from scratch (no shared body plan fits a
// bipedal bird torso).
function thunderbird(m) {
  const g = new THREE.Group();
  const bodyY = 0.34;

  // Torso and chest.
  add(g, new THREE.CapsuleGeometry(0.13, 0.22, 6, 12), m.stormFeather, 0, bodyY, 0, Math.PI / 2, 0, 0);
  add(g, new THREE.SphereGeometry(0.1, 12, 10), m.stormFeather, 0, bodyY + 0.02, -0.16);

  // Neck and head with a hooked beak.
  add(g, new THREE.CylinderGeometry(0.05, 0.07, 0.14, 10), m.stormFeather, 0, bodyY + 0.16, -0.24, -0.5, 0, 0);
  const headY = bodyY + 0.27;
  add(g, new THREE.SphereGeometry(0.075, 12, 10), m.stormFeather, 0, headY, -0.31);
  add(g, new THREE.ConeGeometry(0.03, 0.13, 8), m.beak, 0, headY - 0.01, -0.4, -Math.PI / 2, 0, 0);
  glowEyes(g, m.lightningGlow, { y: headY + 0.02, x: 0.035, z: -0.34, r: 0.014 });

  // Lightning-yellow crest feathers.
  for (let i = 0; i < 3; i++) {
    add(g, new THREE.ConeGeometry(0.012, 0.05 - i * 0.01, 5), m.lightningGlow, 0, headY + 0.07 + i * 0.02, -0.28 + i * 0.03, -0.3, 0, 0);
  }
  const crestTop = headY + 0.07 + 2 * 0.02 + (0.05 - 2 * 0.01) / 2;

  // Taloned legs.
  pair((s) => {
    add(g, new THREE.CylinderGeometry(0.03, 0.035, 0.28, 8), m.beak, s * 0.07, 0.17, -0.02);
    for (let i = -1; i <= 1; i++) {
      add(g, new THREE.ConeGeometry(0.012, 0.06, 5), m.beak, s * 0.07 + i * 0.02, 0.02, -0.07 + (i === 0 ? -0.02 : 0), Math.PI / 2, 0, 0);
    }
  });

  // A fanned tail of feather points.
  for (let i = -2; i <= 2; i++) {
    const t = i / 2;
    add(g, new THREE.ConeGeometry(0.02, 0.22 - Math.abs(t) * 0.06, 6), m.stormFeather, i * 0.03, bodyY - 0.02, 0.2 + Math.abs(t) * 0.02, Math.PI / 2 + t * 0.15, 0, 0);
  }

  // Great feathered wings, spanning wide.
  addWings(g, m.stormFeatherWing, { x: 0.13, y: bodyY + 0.05, z: -0.02, span: 0.65, chord: 0.36, lift: 0.95, sweep: 0.5, type: "feather" });
  // Small lightning accents at the wing roots.
  pair((s) => add(g, new THREE.SphereGeometry(0.02, 8, 8), m.lightningGlow, s * 0.15, bodyY + 0.1, -0.01));

  return { group: g, height: Math.max(headY + 0.075, crestTop) };
}

// k -- a colossal horned beast on four legs. The largest, most massive
// piece in the army.
function behemoth(m) {
  return quadruped({
    body: m.rustHide,
    belly: m.bellyHide,
    accent: m.ironGrey,
    eye: m.eyeDark,
    hoof: m.ironGrey,
    head: "bull",
    horns: { len: 0.22, r: 0.05, spread: 0.6, sweep: -0.3 },
    spikes: { count: 9, len: 0.1, r: 0.028 },
    // Massive, but standing tall rather than sprawling: at bodyLen 0.64 /
    // bodyR 0.29 it read as an enormous cow, and the footprint clamp then
    // shrank the whole piece to fit its square. Shorter barrel, longer legs,
    // higher shoulder -- bulk without the sprawl.
    bodyLen: 0.46,
    bodyR: 0.24,
    legLen: 0.46,
    neckLen: 0.28,
    tailStyle: "reptile",
    digitigrade: false,
  });
}

const BUILDERS = { goblin, wolfrider, ogremage, cyclops, thunderbird, behemoth };

export function buildUnit(unitKey) {
  const builder = BUILDERS[unitKey] || goblin;
  return builder(makeMats());
}
