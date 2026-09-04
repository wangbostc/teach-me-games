// Necropolis -- the undead legion. Grave stone and tarnished silver, bone
// and rotted cloth, with a sickly necromantic green kept to small glowing
// features (eyes, gems) so units read as creatures, not blobs of light.
// Built entirely from the shared body plans in common.js; nothing is loaded
// from any game.
import * as THREE from "three";
import {
  add,
  pair,
  addWings,
  humanoid,
  dragon,
  robed,
  ribcage,
  skullHead,
  glowEyes,
  sword,
  scythe,
  staff,
  roundShield,
} from "/static/units/common.js";
import { matte, cloth, polishedMetal, skin, hair, wood, glow } from "/static/units/materials.js";

const PALETTE = {
  bone: 0xded3bd,
  oldBone: 0xc2b393,
  winePurple: 0x8c2f6b,
  graveGrey: 0x4a4550,
  blackCloth: 0x241f28,
  tarnishedSilver: 0x9a9aa5,
  necroGreen: 0x86d16a,
  corpseFlesh: 0x8a9a86,
  rust: 0x7a5238,
};

export const BASE_COLOR = 0x3f3a48;
export const ACCENT_COLOR = 0x9a9aa5;
export const UNITS = { p: "skeleton", n: "wight", b: "lich", r: "zombie", q: "vampire", k: "bonedragon" };

// Fresh materials per piece: selection highlighting mutates a piece's
// emissive channel, and shared materials would light up every piece at once.
function makeMats() {
  return {
    bone: matte(PALETTE.bone, 0.55),
    oldBone: matte(PALETTE.oldBone, 0.6),
    void: matte(0x120e14, 0.3),
    blackCloth: cloth(PALETTE.blackCloth),
    winePurple: cloth(PALETTE.winePurple),
    silver: polishedMetal(PALETTE.tarnishedSilver, { roughness: 0.55, clearcoat: 0.2 }),
    rust: matte(PALETTE.rust, 0.8),
    corpseFlesh: skin(PALETTE.corpseFlesh),
    paleSkin: skin(0xe8ddd0),
    hairDark: hair(0x18141a),
    wood: wood(0x4a3428, 0x2a1c14, { repeat: 1.2, roughness: 0.75 }),
    necroGlow: glow(PALETTE.necroGreen, PALETTE.necroGreen, 1.1),
    bloodGlow: glow(0xc23b3b, 0xff1a1a, 1.0),
    graveGrey: matte(PALETTE.graveGrey, 0.75),
  };
}

// A humanoid's mid-torso y and height, for placing a ribcage over it --
// derived from the returned hip/shoulderY rather than re-deriving beltY's
// internal constant.
function torsoBand(built) {
  const beltY = built.hip + 0.05;
  const torsoTop = built.shoulderY + 0.02;
  return { y: (beltY + torsoTop) / 2, height: torsoTop - beltY };
}

// p -- skeleton: a bare-boned soldier, thin and plain.
function skeleton(m) {
  const bulk = 0.85;
  const built = humanoid({
    body: m.bone,
    skin: m.bone,
    accent: m.oldBone,
    boot: m.rust,
    eye: m.void,
    head: "skull",
    bulk,
  });
  const g = built.group;
  const band = torsoBand(built);
  ribcage(g, m.oldBone, { y: band.y, height: band.height, r: 0.11, count: 5 });
  const handY = built.shoulderY - 0.3;
  sword(g, { grip: m.rust, guard: m.rust, blade: m.oldBone }, 0.19 * bulk, { length: 0.36, handY });
  roundShield(g, { face: m.rust, rim: m.bone, boss: m.oldBone }, -0.19 * bulk, { r: 0.11, y: built.shoulderY - 0.15 });
  return { group: g, height: built.height };
}

// n -- wight: a hooded wraith that appears to hover, hands and empty hood
// hiding no skin -- only cloth, bone, and a pair of green eyes in the dark.
// A hovering shroud, built from robed() rather than humanoid(): a legless
// humanoid still renders its torso box between the robe and the hood, which
// reads as a lantern on a stand. A robe with an EMPTY hood -- no `face` --
// leaves the dark void that two points of witchlight then stare out of.
function wight(m) {
  const built = robed({
    robe: m.blackCloth,
    hood: m.blackCloth,
    trim: m.silver,
    face: null,
    height: 1.0,
    r: 0.19,
  });
  const g = built.group;
  glowEyes(g, m.necroGlow, { y: built.shoulderY + 0.07, x: 0.032, z: -0.055, r: 0.014 });
  // Skeletal hands emerging from the sleeves.
  pair((s) => add(g, new THREE.SphereGeometry(0.034, 8, 6), m.bone, s * 0.125, built.handY, -0.02));
  scythe(g, { shaft: m.rust, blade: m.silver }, 0.15, { length: 1.0, handY: built.handY + 0.02 });
  return { group: g, height: built.height };
}

// b -- lich: a robed sorcerer with a skull for a face and a gem-topped staff.
function lich(m) {
  const height = 1.05;
  const r = 0.2;
  const built = robed({
    robe: m.blackCloth,
    hood: m.blackCloth,
    trim: m.silver,
    height,
    r,
  });
  const g = built.group;
  const robeH = height * 0.68;
  const faceY = robeH + height * 0.14;
  const faceZ = -r * 0.16;
  skullHead(g, m.bone, m.void, { y: faceY, r: 0.085, z: faceZ });
  staff(g, { shaft: m.wood, orb: m.silver }, r * 0.72, { length: 1.1, handY: built.handY, orbR: 0.06, gem: m.necroGlow });
  return { group: g, height: built.height };
}

// r -- zombie: a shambling, slumped corpse with exposed ribs and a broken
// plank instead of a proper weapon.
function zombie(m) {
  const bulk = 1.15;
  const built = humanoid({
    body: m.corpseFlesh,
    skin: m.corpseFlesh,
    cloth: m.blackCloth,
    boot: m.rust,
    head: "human",
    hunch: 0.35,
    bulk,
  });
  const g = built.group;
  const band = torsoBand(built);
  ribcage(g, m.oldBone, { y: band.y, height: band.height, r: 0.13, count: 4 });
  const handY = built.shoulderY - 0.3;
  add(g, new THREE.BoxGeometry(0.045, 0.3, 0.02), m.wood, 0.19 * bulk, handY + 0.05, -0.04, 0, 0, 0.2);
  return { group: g, height: built.height };
}

// q -- vampire: a pale noble in a high-collared cloak, wine-purple lining,
// bat wings, and a thin blade.
function vampire(m) {
  const built = humanoid({
    body: m.blackCloth,
    skin: m.paleSkin,
    cloth: m.winePurple,
    hair: m.hairDark,
    accent: m.silver,
    eye: m.bloodGlow,
    head: "human",
  });
  const g = built.group;
  // A tall collar flanking the head.
  pair((s) => {
    add(g, new THREE.BoxGeometry(0.04, 0.2, 0.09), m.blackCloth, s * 0.09, built.headY - 0.05, 0.04, 0, 0, s * 0.35);
  });
  // A cloak panel behind, with wine-purple lining showing at the edges.
  add(g, new THREE.BoxGeometry(0.3, 0.5, 0.02), m.blackCloth, 0, built.shoulderY - 0.05, 0.12, -0.1, 0, 0);
  add(g, new THREE.BoxGeometry(0.32, 0.52, 0.01), m.winePurple, 0, built.shoulderY - 0.05, 0.125, -0.1, 0, 0);
  addWings(g, m.graveGrey, { x: 0.11, y: built.shoulderY, z: 0.1, span: 0.45, chord: 0.22, lift: 0.9, sweep: 0.6, type: "bat" });
  sword(g, { grip: m.silver, guard: m.silver, blade: m.silver }, 0.19, { length: 0.4, handY: built.shoulderY - 0.3 });
  return { group: g, height: built.height };
}

// k -- bonedragon: a skeletal dragon, the grandest piece in the army.
function bonedragon(m) {
  const built = dragon({
    body: m.bone,
    accent: m.graveGrey,
    eye: m.necroGlow,
    bodyLen: 0.48,
    bodyR: 0.16,
    legLen: 0.26,
    neckLen: 0.36,
    heads: 1,
    wingSpan: 0.7,
    wingType: "bone",
    tailLen: 0.44,
    skeletal: true,
  });
  return { group: built.group, height: built.height };
}

const BUILDERS = { skeleton, wight, lich, zombie, vampire, bonedragon };

export function buildUnit(unitKey) {
  const builder = BUILDERS[unitKey] || skeleton;
  return builder(makeMats());
}
