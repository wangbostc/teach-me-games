// Rampart -- elves, dwarves and forest creatures defending the deep wood.
// Mossy stone and gold, living wood, and white beasts of legend. Built from
// the shared body plans in common.js; nothing is loaded from any game or
// asset pack.
import * as THREE from "three";
import {
  add,
  addWings,
  humanoid,
  quadruped,
  dragon,
  bow,
  quiver,
} from "/static/units/common.js";
import {
  hide,
  hair,
  skin,
  cloth,
  matte,
  wood,
  burnishedGold,
  feathers,
  glow,
} from "/static/units/materials.js";

const PALETTE = {
  forest: 0x2f7d3f,
  oak: 0x6b4a2a,
  bark: 0x5a4630,
  leaf: 0x4f8f3a,
  silver: 0xe8e4d8,
  gold: 0xc9a227,
  unicornWhite: 0xf4f2ea,
  dragonGold: 0xe0b458,
  elfSkin: 0xe3c9a8,
  fairHair: 0xd8c48a,
};

export const BASE_COLOR = 0x3d5a3a;
export const ACCENT_COLOR = 0xc9a227;
export const UNITS = { p: "centaur", n: "pegasus", b: "woodelf", r: "dendroid", q: "unicorn", k: "golddragon" };

// Fresh materials per piece: selection highlighting mutates a piece's
// emissive channel, and shared materials would light up every piece at once.
function makeMats() {
  return {
    gold: burnishedGold(PALETTE.gold),
    horseHide: hide(PALETTE.oak),
    leather: hide(PALETTE.bark),
    mane: hair(PALETTE.bark),
    unicornHide: hide(PALETTE.unicornWhite),
    silverMane: hair(PALETTE.silver),
    wingFeather: feathers(PALETTE.unicornWhite),
    skin: skin(PALETTE.elfSkin),
    hair: hair(PALETTE.fairHair),
    green: cloth(PALETTE.forest),
    bowWood: wood(PALETTE.oak, 0x3f2a16, { repeat: 1 }),
    // Living bark, not charred wood: the first pass paired dark browns with
    // an even darker grain, and the dendroid rendered essentially black.
    trunk: wood(0x8a6740, 0x6b4f30, { repeat: 2, rings: 3 }),
    bark: wood(0x7a5b3a, 0x584026, { repeat: 2, rings: 3 }),
    leaf: matte(PALETTE.leaf, 0.85),
    string: matte(PALETTE.silver, 0.4),
    dragonBody: burnishedGold(PALETTE.dragonGold),
    dragonBelly: burnishedGold(0xb98f3a),
    dragonWing: burnishedGold(PALETTE.dragonGold),
    glowEye: glow(0xfff2b0, 0xffcc33, 1.0),
  };
}

// p -- horse body with an elf archer's torso grafted at the withers.
function centaur(m) {
  const bodyLen = 0.5;
  const bodyR = 0.17;
  const mount = quadruped({
    body: m.horseHide,
    mane: m.mane,
    accent: m.gold,
    hoof: m.gold,
    bodyLen,
    bodyR,
    legLen: 0.36,
    head: "none",
    tailStyle: "hair",
  });
  const g = mount.group;

  // Elf torso, built at default proportions so the stock bow/quiver hand
  // offsets line up, then scaled down and seated where the horse's neck
  // would rise.
  const torso = humanoid({
    body: m.leather,
    skin: m.skin,
    cloth: m.green,
    accent: m.gold,
    hair: m.hair,
    boot: m.leather,
    legs: "bare",
  });
  bow(torso.group, { limb: m.bowWood, string: m.string }, 0.22);
  quiver(torso.group, { body: m.leather, fletch: m.string });

  const scale = 0.8;
  torso.group.scale.setScalar(scale);
  torso.group.position.set(0, mount.backY - torso.hip * scale, -bodyLen * 0.32);
  g.add(torso.group);

  const topY = torso.group.position.y + torso.height * scale;
  return { group: g, height: Math.max(topY, mount.height) };
}

// n -- white winged horse.
function pegasus(m) {
  const bodyLen = 0.42;
  const bodyR = 0.16;
  const built = quadruped({
    body: m.unicornHide,
    mane: m.silverMane,
    accent: m.silverMane,
    hoof: m.gold,
    bodyLen,
    bodyR,
    legLen: 0.36,
    neckLen: 0.3,
    head: "horse",
    tailStyle: "hair",
  });
  addWings(built.group, m.wingFeather, {
    x: bodyR * 0.9,
    y: built.bodyY + bodyR * 0.75,
    z: 0.03,
    span: 0.6,
    chord: 0.6 * 0.55,
    lift: 1.0,
    sweep: 0.5,
    type: "feather",
  });
  return { group: built.group, height: built.height };
}

// b -- slim elf archer on foot.
function woodelf(m) {
  const built = humanoid({
    body: m.leather,
    skin: m.skin,
    cloth: m.green,
    hair: m.hair,
    accent: m.gold,
    boot: m.leather,
    helm: "hood",
    bulk: 0.9,
  });
  bow(built.group, { limb: m.bowWood, string: m.string }, 0.22);
  quiver(built.group, { body: m.leather, fletch: m.string });
  return built;
}

// r -- a walking, rooted tree.
function dendroid(m) {
  const built = humanoid({
    body: m.trunk,
    accent: m.bark,
    boot: m.bark,
    legs: "straight",
    head: "none",
    bulk: 1.35,
    legLen: 0.42,
    torsoLen: 0.38,
  });
  const g = built.group;

  // Gnarled trunk overlay: stacked tapering cylinders up the spine so the
  // silhouette reads as bark, not armor plate.
  const trunkYs = [0.12, 0.3, 0.48, 0.66];
  trunkYs.forEach((y, i) => {
    const r = 0.16 - i * 0.02;
    add(g, new THREE.CylinderGeometry(r * 0.9, r, 0.22, 10), m.bark, 0, y, 0.02);
  });

  // Root flares splaying out from the base like roots gripping the earth.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    add(
      g,
      new THREE.ConeGeometry(0.038, 0.24, 6),
      m.bark,
      Math.cos(a) * 0.15,
      0.03,
      Math.sin(a) * 0.15,
      Math.PI / 2.6,
      a,
      0
    );
  }

  // Branch arms reaching out of the trunk, so the shoulders read as limbs
  // of a tree rather than pauldrons.
  [-1, 1].forEach((s) => {
    add(g, new THREE.CylinderGeometry(0.03, 0.05, 0.3, 8), m.bark, s * 0.22, 0.72, -0.02, 0.2, 0, s * 1.0);
    add(g, new THREE.CylinderGeometry(0.018, 0.03, 0.2, 7), m.bark, s * 0.34, 0.86, -0.04, -0.3, 0, s * 0.6);
  });

  // Leafy crown where the head would be: overlapping leaf-green puffs, wide
  // enough to read as a canopy over the trunk.
  const crownY = built.headY - 0.02;
  const crownPuffs = [
    [0, 0.1, 0, 0.23],
    [0.17, 0.0, 0.06, 0.17],
    [-0.17, 0.0, -0.04, 0.17],
    [0.05, 0.22, -0.1, 0.16],
    [-0.09, 0.17, 0.13, 0.15],
    [0.0, 0.05, -0.18, 0.14],
  ];
  let topY = 0;
  crownPuffs.forEach(([dx, dy, dz, r]) => {
    add(g, new THREE.IcosahedronGeometry(r, 0), m.leaf, dx, crownY + dy, dz);
    topY = Math.max(topY, crownY + dy + r);
  });

  return { group: g, height: topY };
}

// q -- white horse with a single spiral horn.
function unicorn(m) {
  const built = quadruped({
    body: m.unicornHide,
    mane: m.silverMane,
    accent: m.gold,
    hoof: m.gold,
    horn: m.gold,
    bodyLen: 0.44,
    bodyR: 0.165,
    legLen: 0.4,
    neckLen: 0.32,
    head: "horse",
    tailStyle: "hair",
  });
  return { group: built.group, height: built.height };
}

// k -- the grandest piece: a great gold dragon.
function golddragon(m) {
  const built = dragon({
    body: m.dragonBody,
    belly: m.dragonBelly,
    wing: m.dragonWing,
    accent: m.gold,
    eye: m.glowEye,
    bodyLen: 0.56,
    bodyR: 0.21,
    legLen: 0.3,
    neckLen: 0.4,
    wingSpan: 0.72,
    wingType: "bat",
    tailLen: 0.5,
    spikes: true,
  });
  return { group: built.group, height: built.height };
}

const BUILDERS = { centaur, pegasus, woodelf, dendroid, unicorn, golddragon };

export function buildUnit(unitKey) {
  const builder = BUILDERS[unitKey] || woodelf;
  return builder(makeMats());
}
