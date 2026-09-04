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
  glowEyes,
  measuredHeight,
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
    ironDark: polishedMetal(0x3f4550, { roughness: 0.6 }),
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

// r -- an ancient iron-and-stone construct: two tones (dark iron body,
// lighter steel plating) so the construction reads, plus a riveted chest
// plate, a glowing rune, and a squat brow-heavy helm-block head.
function golem(m) {
  const g = new THREE.Group();
  const legLen = 0.34;
  const legY = legLen / 2;
  const beltY = legLen + 0.02;
  const torsoLen = 0.42;
  const torsoTop = beltY + torsoLen;
  const headW = 0.15;
  const headH = 0.12;
  const browH = 0.045;
  const headY = torsoTop + headH / 2 + 0.03;
  const torsoFrontZ = -0.135;

  // Wide, heavy legs and broad feet -- a wide stance that looks planted.
  pair((s) => {
    add(g, new THREE.BoxGeometry(0.15, legLen, 0.17), m.ironDark, s * 0.11, legY, 0);
    add(g, new THREE.BoxGeometry(0.18, 0.06, 0.22), m.iron, s * 0.11, 0.03, -0.02);
  });

  // Heavy square torso, dark iron.
  add(g, new THREE.BoxGeometry(0.42, torsoLen, 0.27), m.ironDark, 0, beltY + torsoLen / 2, 0);

  // Raised chest plate, proud of the torso front -- lighter steel so the
  // two-tone construction reads.
  const plateW = 0.3;
  const plateH = torsoLen * 0.62;
  const plateD = 0.045;
  const plateY = beltY + torsoLen * 0.62;
  const plateZ = torsoFrontZ - plateD / 2 + 0.01;
  add(g, new THREE.BoxGeometry(plateW, plateH, plateD), m.steel, 0, plateY, plateZ);

  // A grid of rivet studs across the plate.
  const rivetZ = plateZ - plateD / 2 - 0.006;
  [-1, -0.34, 0.34, 1].forEach((rx) => {
    [-0.6, 0.6].forEach((ry) => {
      add(g, new THREE.SphereGeometry(0.012, 6, 6), m.silver, rx * plateW * 0.42, plateY + ry * plateH * 0.4, rivetZ);
    });
  });

  // A large glowing angular rune on the chest: a vertical bar with two
  // angled strokes, sized to be visible from the board camera.
  const runeZ = rivetZ - 0.006;
  add(g, new THREE.BoxGeometry(0.02, 0.12, 0.012), m.glowCyan, 0, plateY, runeZ);
  add(g, new THREE.BoxGeometry(0.02, 0.075, 0.012), m.glowCyan, 0.032, plateY + 0.025, runeZ, 0, 0, 0.6);
  add(g, new THREE.BoxGeometry(0.02, 0.075, 0.012), m.glowCyan, -0.032, plateY - 0.025, runeZ, 0, 0, 0.6);

  // Broad shoulder pauldrons, flattened caps in the lighter steel.
  pair((s) => {
    const pauldron = add(g, new THREE.SphereGeometry(0.1, 12, 10), m.steel, s * 0.24, torsoTop - 0.02, 0);
    pauldron.scale.set(1, 0.55, 0.85);
    [-0.03, 0.03].forEach((dx) => {
      add(g, new THREE.SphereGeometry(0.01, 6, 6), m.silver, s * 0.24 + dx, torsoTop + 0.02, -0.06);
    });
  });

  // Thick, heavy-hanging arms: an upper-arm block, then a gauntlet forearm
  // wider than the upper arm, studded with rivets.
  pair((s) => {
    add(g, new THREE.BoxGeometry(0.13, 0.24, 0.13), m.ironDark, s * 0.24, torsoTop - 0.19, 0);
    add(g, new THREE.BoxGeometry(0.17, 0.19, 0.17), m.steel, s * 0.24, torsoTop - 0.4, 0);
    [-0.045, 0.045].forEach((dx) => {
      add(g, new THREE.SphereGeometry(0.011, 6, 6), m.silver, s * 0.24 + dx, torsoTop - 0.36, -0.078);
    });
  });

  // Squat helm-block head with a heavy brow ridge overhanging the eye slits.
  add(g, new THREE.BoxGeometry(headW, headH, headW * 0.95), m.ironDark, 0, headY, 0);
  add(g, new THREE.BoxGeometry(headW * 1.08, browH, headW * 0.55), m.steel, 0, headY + headH * 0.28, -headW * 0.28);
  glowEyes(g, m.glowCyan, { y: headY, x: headW * 0.28, z: -headW * 0.44, r: 0.017 });

  return { group: g, height: headY + headH / 2 };
}

// Build a sword via the shared sword() recipe, then wrap the pieces it added
// in a pivot group hinged at the hand so the blade can fan outward or cross
// inward -- sword() itself has no notion of a tilted grip.
function angledSword(g, mats, x, opts, tiltZ) {
  const handY = opts.handY ?? 0.45;
  const before = g.children.length;
  sword(g, mats, x, opts);
  const added = g.children.splice(before);
  const pivot = new THREE.Group();
  added.forEach((mesh) => {
    mesh.position.x -= x;
    mesh.position.y -= handY;
    pivot.add(mesh);
  });
  pivot.position.set(x, handY, 0);
  pivot.rotation.z = tiltZ;
  g.add(pivot);
  return pivot;
}

// q -- a regal serpent-woman warrior: a banded-scale coil rising into a
// dressed, four-armed torso crowned with a gold cobra-hood.
function naga(m) {
  const headR = 0.095;
  const g = new THREE.Group();
  const seatY = serpentCoil(g, m.scaleGold, {
    accent: m.gold,
    coils: 5,
    r: 0.22,
    rise: 0.14,
  });

  const torso = humanoid({
    body: m.scaleBlue,
    skin: m.blueSkin,
    cloth: m.arcaneBlue,
    emblem: m.gold,
    emblemShape: "diamond",
    accent: m.gold,
    legs: "bare",
    arms: 4,
    bulk: 0.95,
    headR,
  });
  const tg = torso.group;
  tg.position.set(0, seatY - torso.hip, 0);
  g.add(tg);

  // Scaled-armor bands at waist and ribs, over the tabard.
  [torso.hip + 0.09, torso.hip + 0.24, torso.hip + 0.39].forEach((ry) => {
    const band = add(tg, new THREE.TorusGeometry(0.148, 0.01, 6, 20), m.gold, 0, ry, 0, Math.PI / 2, 0, 0);
    band.scale.z = 0.76;
  });

  // Face: glowing cyan eyes.
  glowEyes(tg, m.glowCyan, { y: torso.headY + headR * 0.15, x: headR * 0.4, z: -headR * 0.88, r: headR * 0.14 });

  // Gold circlet on the brow.
  add(tg, new THREE.TorusGeometry(headR * 0.98, 0.011, 8, 20), m.gold, 0, torso.headY, 0, Math.PI / 2, 0, 0);

  // Cobra-hood: a flattened gold flare behind the head, ribbed with a fan
  // of thin slats rising above the crown -- the feature that reads as
  // "naga" rather than "bare-headed swordswoman" at board distance.
  const hood = add(tg, new THREE.SphereGeometry(headR * 1.45, 16, 12), m.gold, 0, torso.headY + headR * 0.25, headR * 0.55);
  hood.scale.set(1.1, 1.25, 0.28);
  const slatCount = 5;
  for (let i = 0; i < slatCount; i++) {
    const t = (i - (slatCount - 1) / 2) / ((slatCount - 1) / 2); // -1..1
    const len = headR * (1.5 - Math.abs(t) * 0.6);
    const x = t * headR * 1.05;
    add(
      tg,
      new THREE.CylinderGeometry(0.008, 0.013, len, 6),
      m.gold,
      x,
      torso.headY + headR * 0.35 + (len / 2) * 0.85,
      headR * 0.6,
      -0.5,
      0,
      t * 0.4
    );
  }

  // Upper arms: swords fanned outward into a "V".
  angledSword(tg, { grip: m.ironDark, guard: m.gold, blade: m.steel }, 0.19, {}, 0.35);
  angledSword(tg, { grip: m.ironDark, guard: m.gold, blade: m.steel }, -0.19, {}, -0.35);
  // Lower arms: swords held lower, crossed slightly inward.
  angledSword(tg, { grip: m.ironDark, guard: m.gold, blade: m.steel }, 0.13, { handY: 0.29, length: 0.34 }, -0.22);
  angledSword(tg, { grip: m.ironDark, guard: m.gold, blade: m.steel }, -0.13, { handY: 0.29, length: 0.34 }, 0.22);

  return { group: g, height: measuredHeight(g) };
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
