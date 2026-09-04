// Tower -- wizards, constructs and arcane guardians. Slate and silver, deep
// arcane blue, and a pulse of cyan glow through every rune. Built from the
// shared body plans in common.js; nothing is loaded from any game or asset
// pack.
import * as THREE from "three";
import {
  add,
  pair,
  addWings,
  humanoid,
  robed,
  serpentCoil,
  sword,
  staff,
  club,
  tail,
} from "/static/units/common.js";
import {
  polishedMetal,
  burnishedGold,
  cloth,
  skin,
  wood,
  stone,
  paintedMetal,
  glow,
} from "/static/units/materials.js";

const PALETTE = {
  steel: 0x7c8299,
  blue: 0x33478c,
  parchment: 0xded6c0,
  gold: 0xd9b04c,
  paleStone: 0x8a8f9c,
  iron: 0x5a6070,
  cyan: 0x66d8ff,
  skin: 0xe0c4a4,
  gremlin: 0x7a9c5a,
};

export const BASE_COLOR = 0x4a5060;
export const ACCENT_COLOR = 0xb8b8c8;
export const UNITS = { p: "gremlin", n: "gargoyle", b: "mage", r: "golem", q: "naga", k: "titan" };

// Fresh materials per piece: selection highlighting mutates a piece's
// emissive channel, and shared materials would light up every piece at once.
function makeMats() {
  return {
    iron: polishedMetal(PALETTE.iron),
    ironDark: polishedMetal(0x3f4550, { roughness: 0.5 }),
    steel: polishedMetal(PALETTE.steel),
    silver: polishedMetal(ACCENT_COLOR, { roughness: 0.45 }),
    gold: burnishedGold(PALETTE.gold),
    stone: stone(PALETTE.paleStone),
    arcaneBlue: cloth(PALETTE.blue, { sheen: 0.5 }),
    arcaneBlueDark: cloth(0x1f2c54, { sheen: 0.4 }),
    parchment: cloth(PALETTE.parchment),
    skin: skin(PALETTE.skin),
    blueSkin: skin(0xb9c6e0),
    gremlinSkin: skin(PALETTE.gremlin),
    shaft: wood(0x5a4a34, 0x2c2116, { repeat: 1 }),
    scaleGold: paintedMetal(PALETTE.gold),
    scaleBlue: paintedMetal(PALETTE.blue),
    glowCyan: glow(PALETTE.cyan, PALETTE.cyan, 1.0),
  };
}

// p -- a small, stooped servant. The humblest unit in the army.
function gremlin(m) {
  const built = humanoid({
    body: m.gremlinSkin,
    skin: m.gremlinSkin,
    cloth: m.parchment,
    accent: m.iron,
    boot: m.gremlinSkin,
    bulk: 0.8,
    legLen: 0.3,
    torsoLen: 0.26,
    headR: 0.085,
    hunch: 0.4,
  });
  club(built.group, { shaft: m.shaft, head: m.iron }, 0.16, { length: 0.26 });
  return built;
}

// n -- a crouching stone flyer.
function gargoyle(m) {
  const built = humanoid({
    body: m.stone,
    skin: m.stone,
    accent: m.ironDark,
    boot: m.stone,
    legs: "digitigrade",
    head: "beast",
    horns: { len: 0.09, r: 0.022, spread: 0.5, sweep: -0.3 },
    bulk: 1.0,
    hunch: 0.25,
  });
  addWings(built.group, m.stone, {
    x: 0.15,
    y: built.shoulderY,
    z: 0.06,
    span: 0.45,
    chord: 0.45 * 0.5,
    lift: 0.85,
    sweep: 0.5,
    type: "bat",
  });
  tail(built.group, m.stone, { y: built.hip * 0.5, z: 0.16, len: 0.3, r: 0.045, links: 4, droop: 0.4 });
  return built;
}

// b -- a robed arcane caster.
function mage(m) {
  const built = robed({
    robe: m.arcaneBlue,
    hood: m.arcaneBlueDark,
    trim: m.gold,
    face: m.skin,
    height: 1.05,
    r: 0.19,
  });
  staff(built.group, { shaft: m.shaft, orb: m.gold }, 0.15, {
    length: 1.15,
    handY: built.handY,
    orbR: 0.05,
    gem: glow(0x66d8ff, 0x66d8ff),
  });
  return built;
}

// r -- a blocky iron construct, squat and immovable-looking.
function golem(m) {
  const g = new THREE.Group();
  const legLen = 0.32;
  const legY = legLen / 2;
  const beltY = legLen + 0.02;
  const torsoLen = 0.42;
  const torsoTop = beltY + torsoLen;
  const headSize = 0.14;
  const headY = torsoTop + headSize / 2 + 0.02;

  // Blocky legs and feet.
  pair((s) => {
    add(g, new THREE.BoxGeometry(0.13, legLen, 0.15), m.iron, s * 0.1, legY, 0);
    add(g, new THREE.BoxGeometry(0.16, 0.05, 0.2), m.ironDark, s * 0.1, 0.025, -0.02);
  });

  // Heavy square torso with a riveted breastplate.
  add(g, new THREE.BoxGeometry(0.4, torsoLen, 0.26), m.iron, 0, beltY + torsoLen / 2, 0);
  add(g, new THREE.BoxGeometry(0.3, torsoLen * 0.5, 0.02), m.steel, 0, beltY + torsoLen * 0.6, -0.135);
  [beltY + torsoLen * 0.4, beltY + torsoLen * 0.7].forEach((ry) => {
    [-0.13, -0.045, 0.045, 0.13].forEach((rx) => {
      add(g, new THREE.SphereGeometry(0.012, 6, 6), m.silver, rx, ry, -0.146);
    });
  });

  // Glowing rune slit standing in for a face.
  add(g, new THREE.BoxGeometry(0.16, 0.03, 0.02), m.glowCyan, 0, headY - 0.01, -0.075);

  // Shoulders and thick, blocky arms.
  pair((s) => {
    add(g, new THREE.BoxGeometry(0.14, 0.14, 0.14), m.iron, s * 0.24, torsoTop - 0.05, 0);
    add(g, new THREE.BoxGeometry(0.12, 0.26, 0.12), m.iron, s * 0.24, torsoTop - 0.24, 0);
    add(g, new THREE.BoxGeometry(0.15, 0.09, 0.15), m.ironDark, s * 0.24, torsoTop - 0.41, 0);
  });

  // Small, featureless head.
  add(g, new THREE.BoxGeometry(headSize, headSize, headSize), m.iron, 0, headY, 0);

  return { group: g, height: headY + headSize / 2 };
}

// q -- serpent-bodied, multi-armed swordswoman.
function naga(m) {
  const g = new THREE.Group();
  const seatY = serpentCoil(g, m.scaleGold, {
    accent: m.scaleBlue,
    coils: 5,
    r: 0.22,
    rise: 0.14,
  });

  const torso = humanoid({
    body: m.scaleBlue,
    skin: m.skin,
    accent: m.gold,
    legs: "bare",
    arms: 4,
    bulk: 0.95,
  });
  torso.group.position.set(0, seatY - torso.hip, 0);
  sword(torso.group, { grip: m.ironDark, guard: m.gold, blade: m.steel }, 0.19);
  sword(torso.group, { grip: m.ironDark, guard: m.gold, blade: m.steel }, -0.19);
  g.add(torso.group);

  return { group: g, height: torso.group.position.y + torso.height };
}

// k -- a towering giant, the grandest and tallest piece.
function titan(m) {
  const built = humanoid({
    body: m.gold,
    skin: m.blueSkin,
    cloth: m.arcaneBlue,
    emblem: m.gold,
    accent: m.silver,
    boot: m.gold,
    helm: "horned",
    bulk: 1.3,
    legLen: 0.46,
    torsoLen: 0.38,
    headR: 0.11,
  });

  // A glowing lightning bolt, held raised -- a jagged run of thin angled
  // box segments that must not count toward the reported height.
  const boltX = 0.27;
  let by = built.shoulderY - 0.32;
  let bz = -0.05;
  [
    { len: 0.15, rz: 0.55 },
    { len: 0.14, rz: -0.6 },
    { len: 0.16, rz: 0.5 },
  ].forEach(({ len, rz }) => {
    add(built.group, new THREE.BoxGeometry(0.028, len, 0.02), m.glowCyan, boltX, by + (len / 2) * Math.cos(rz), bz, 0, 0, rz);
    by += len * Math.cos(rz);
    bz -= len * Math.sin(rz) * 0.25;
  });

  return built;
}

const BUILDERS = { gremlin, gargoyle, mage, golem, naga, titan };

export function buildUnit(unitKey) {
  const builder = BUILDERS[unitKey] || gremlin;
  return builder(makeMats());
}
