// Inferno -- demons and hellfire. Scorched stone and brass, dark reds and
// charcoal hide, lava-glow accents kept small (eyes, blade edges, flame
// tips) so units read as creatures, not blobs of light. Built entirely from
// the shared body plans in common.js; nothing is loaded from any game.
import * as THREE from "three";
import {
  add,
  pair,
  addWings,
  humanoid,
  quadruped,
  tail,
  smokeTail,
  spikeRow,
  curlHorns,
  sword,
  axe,
  club,
  trident,
} from "/static/units/common.js";
import { hide, polishedMetal, matte, wood, cloth, glow } from "/static/units/materials.js";

const PALETTE = {
  darkRed: 0x8c2f2f,
  ember: 0xd9622c,
  charcoal: 0x2a2024,
  brass: 0xb08d3e,
  ash: 0x6a5f5c,
  hide: 0xa84030,
  blackIron: 0x33302f,
  lavaGlow: 0xff6a1e,
  bone: 0xc9b89a,
};

export const BASE_COLOR = 0x3a2420;
export const ACCENT_COLOR = 0xb08d3e;
export const UNITS = { p: "imp", n: "hellhound", b: "efreet", r: "pitfiend", q: "demon", k: "devil" };

// Fresh materials per piece: selection highlighting mutates a piece's
// emissive channel, and shared materials would light up every piece at once.
function makeMats() {
  return {
    hide: hide(PALETTE.hide),
    darkHide: hide(PALETTE.darkRed),
    charcoal: hide(PALETTE.charcoal),
    ash: matte(PALETTE.ash, 0.8),
    brass: polishedMetal(PALETTE.brass, { roughness: 0.4, clearcoat: 0.4 }),
    blackIron: polishedMetal(PALETTE.blackIron, { roughness: 0.6, clearcoat: 0.15 }),
    bone: matte(PALETTE.bone, 0.55),
    wood: wood(0x4a2e1c, 0x2a180c, { repeat: 1.5, roughness: 0.7 }),
    darkCloak: cloth(0x1a1414),
    eyeGlow: glow(PALETTE.lavaGlow, 0xff3300, 1.2),
    lavaBlade: glow(PALETTE.lavaGlow, PALETTE.lavaGlow, 1.0),
    flame: glow(PALETTE.ember, PALETTE.lavaGlow, 1.1),
  };
}

// p -- imp: a wiry runt demon. Small, low, cowering silhouette.
function imp(m) {
  const bulk = 0.8;
  const built = humanoid({
    body: m.hide,
    skin: m.hide,
    accent: m.bone,
    boot: m.blackIron,
    eye: m.eyeGlow,
    head: "beast",
    legs: "digitigrade",
    bulk,
    legLen: 0.3,
    headR: 0.075,
    horns: { mat: m.bone, len: 0.05, r: 0.013, spread: 0.55 },
  });
  const g = built.group;
  const handY = built.shoulderY - 0.3;
  tail(g, m.hide, { y: built.hip, z: 0.11, len: 0.28, r: 0.035, links: 4, droop: 0.4, tipMat: m.blackIron, tipLen: 0.05 });
  addWings(g, m.charcoal, { x: 0.09, y: built.shoulderY, z: 0.04, span: 0.22, chord: 0.13, lift: 0.85, sweep: 0.6, type: "bat" });
  club(g, { shaft: m.wood, head: m.blackIron }, 0.19 * bulk, { length: 0.26, handY, spiked: true });
  return { group: g, height: built.height };
}

// n -- hellhound: a three-headed charcoal cerberus with a spiked mane.
function hellhound(m) {
  const bodyLen = 0.4;
  const bodyR = 0.15;
  const built = quadruped({
    body: m.charcoal,
    belly: m.ash,
    accent: m.blackIron,
    eye: m.eyeGlow,
    hoof: m.blackIron,
    bodyLen,
    bodyR,
    legLen: 0.3,
    neckLen: 0.22,
    head: "wolf",
    heads: 3,
    digitigrade: true,
    tailStyle: "reptile",
  });
  const g = built.group;
  // A row of small spikes along the shoulders, standing in for a mane.
  spikeRow(g, m.blackIron, { from: -bodyLen * 0.5, to: -bodyLen * 0.05, y: built.bodyY + bodyR * 0.85, count: 5, len: 0.05, r: 0.014 });
  return { group: g, height: built.height };
}

// b -- efreet: a legless fire genie standing on a column of smoke and flame.
function efreet(m) {
  const g = new THREE.Group();
  smokeTail(g, m.flame, { y: 0, r: 0.19, height: 0.4, twists: 4 });
  const built = humanoid({
    body: m.hide,
    skin: m.hide,
    accent: m.brass,
    eye: m.eyeGlow,
    head: "human",
    legs: "bare",
    bulk: 1.05,
    horns: { mat: m.bone, len: 0.05, r: 0.014 },
  });
  g.add(built.group);

  // Brass arm bands.
  pair((s) => {
    add(g, new THREE.TorusGeometry(0.044, 0.011, 6, 12), m.brass, s * 0.19 * 1.05, built.shoulderY - 0.1, 0, Math.PI / 2, 0, 0);
  });

  // A crown of small flame cones ringing the head.
  const headR = 0.095;
  const crownY = built.headY + headR * 0.5;
  const count = 7;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    add(g, new THREE.ConeGeometry(0.012, 0.05, 6), m.flame, Math.cos(a) * headR * 0.8, crownY, Math.sin(a) * headR * 0.8);
  }

  return { group: g, height: built.height };
}

// r -- pitfiend: a bulky, armored brute in black-iron plate.
function pitfiend(m) {
  const bulk = 1.3;
  const built = humanoid({
    body: m.hide,
    skin: m.hide,
    accent: m.blackIron,
    boot: m.blackIron,
    eye: m.eyeGlow,
    head: "beast",
    helm: "horned",
    legs: "digitigrade",
    bulk,
  });
  const g = built.group;
  // Chest plate and pauldrons over the hide body.
  add(g, new THREE.BoxGeometry(0.2, 0.22, 0.03), m.blackIron, 0, built.shoulderY - 0.1, -0.1 * bulk);
  pair((s) => {
    add(g, new THREE.SphereGeometry(0.095 * bulk, 10, 8), m.blackIron, s * 0.165 * bulk, built.shoulderY + 0.06, 0);
  });
  axe(g, { shaft: m.wood, head: m.blackIron }, 0.19 * bulk, { length: 0.75, handY: built.shoulderY - 0.3, twoBlade: true });
  return { group: g, height: built.height };
}

// q -- demon: a tall horned warrior in brass plate, wielding a flaming sword.
function demon(m) {
  const bulk = 1.1;
  const built = humanoid({
    body: m.brass,
    skin: m.darkHide,
    accent: m.blackIron,
    boot: m.blackIron,
    eye: m.eyeGlow,
    head: "beast",
    legs: "digitigrade",
    bulk,
    horns: { mat: m.bone, len: 0.11, r: 0.026 },
  });
  const g = built.group;
  const handY = built.shoulderY - 0.3;
  tail(g, m.darkHide, { y: built.hip, z: 0.1, len: 0.36, r: 0.05, links: 4, droop: 0.35, tipMat: m.blackIron, tipLen: 0.07 });
  addWings(g, m.charcoal, { x: 0.12, y: built.shoulderY, z: 0.05, span: 0.4, chord: 0.22, lift: 0.9, sweep: 0.55, type: "bat" });
  sword(g, { grip: m.blackIron, guard: m.brass, blade: m.lavaBlade }, 0.19 * bulk, { length: 0.46, handY });
  return { group: g, height: built.height };
}

// k -- devil: a tall, gaunt arch-devil -- the most imposing piece.
function devil(m) {
  const bulk = 1.15;
  const built = humanoid({
    body: m.charcoal,
    skin: m.charcoal,
    accent: m.brass,
    boot: m.blackIron,
    eye: m.eyeGlow,
    head: "human",
    legs: "digitigrade",
    bulk,
  });
  const g = built.group;
  const headR = 0.095;
  curlHorns(g, m.bone, { y: built.headY + headR * 0.7, x: headR * 0.55, len: 0.13, r: 0.032, links: 3 });
  addWings(g, m.charcoal, { x: 0.13, y: built.shoulderY + 0.05, z: 0.06, span: 0.68, chord: 0.34, lift: 1.0, sweep: 0.5, type: "bat" });
  tail(g, m.charcoal, { y: built.hip, z: 0.12, len: 0.46, r: 0.055, links: 5, droop: 0.3, tipMat: m.brass, tipLen: 0.08 });
  // A dark cloak panel behind the shoulders.
  add(g, new THREE.BoxGeometry(0.36, 0.58, 0.02), m.darkCloak, 0, built.shoulderY - 0.05, 0.13, -0.1, 0, 0);
  trident(g, { shaft: m.blackIron, head: m.brass }, 0.19 * bulk, { length: 1.2, handY: built.shoulderY - 0.3 });
  return { group: g, height: built.height };
}

const BUILDERS = { imp, hellhound, efreet, pitfiend, demon, devil };

export function buildUnit(unitKey) {
  const builder = BUILDERS[unitKey] || imp;
  return builder(makeMats());
}
