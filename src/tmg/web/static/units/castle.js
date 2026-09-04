// Castle -- the human knightly order. Silver plate, red-and-white heraldry,
// gold trim, white-winged celestials. Built from the shared body plans in
// common.js; nothing is loaded from any game or asset pack.
import * as THREE from "three";
import {
  add,
  pair,
  addWings,
  humanoid,
  quadruped,
  spear,
  sword,
  roundShield,
  kiteShield,
} from "/static/units/common.js";
import {
  polishedMetal,
  burnishedGold,
  cloth,
  skin,
  hair,
  wood,
  hide,
  feathers,
  matte,
  glow,
} from "/static/units/materials.js";

const PALETTE = {
  steel: 0xd2d6de,
  steelDark: 0x7f8695,
  red: 0xb32f2a,
  white: 0xf4f0e8,
  gold: 0xd9b04c,
  blue: 0x2f5a8c,
  skin: 0xe9c7a6,
  blond: 0xe3c77d,
  wing: 0xf9f6f0,
  horse: 0x5c3d27,
  horseDark: 0x33210f,
  griffinBody: 0xbc8c46,
  griffinPale: 0xf3ecdd,
  beak: 0xe2b23f,
  wood: 0x6a4728,
  dark: 0x202128,
  stone: 0x4b5364,
};

export const BASE_COLOR = PALETTE.stone;
export const ACCENT_COLOR = PALETTE.gold;
export const UNITS = { p: "pikeman", n: "cavalier", b: "griffin", r: "crusader", q: "angel", k: "archangel" };

// Fresh materials per piece: selection highlighting mutates a piece's
// emissive channel, and shared materials would light up every piece at once.
// (The procedural textures underneath ARE shared -- see materials.js.)
function makeMats() {
  return {
    steel: polishedMetal(PALETTE.steel),
    steelDark: polishedMetal(PALETTE.steelDark, { roughness: 0.55, clearcoat: 0.2 }),
    red: cloth(PALETTE.red),
    white: cloth(PALETTE.white),
    gold: burnishedGold(PALETTE.gold),
    blue: cloth(PALETTE.blue, { sheen: 0.9 }),
    skin: skin(PALETTE.skin),
    blond: hair(PALETTE.blond),
    wing: feathers(PALETTE.wing),
    horse: hide(PALETTE.horse),
    horseDark: hide(PALETTE.horseDark),
    griffinBody: hide(PALETTE.griffinBody),
    griffinPale: feathers(PALETTE.griffinPale),
    beak: polishedMetal(PALETTE.beak, { roughness: 0.5, clearcoat: 0.6 }),
    wood: wood(PALETTE.wood, 0x3f2a16, { repeat: 2, roughness: 0.65 }),
    dark: matte(PALETTE.dark, 0.5),
    halo: glow(0xffe9a3, 0xffc94d, 0.9),
  };
}

function knightBody(m, opts) {
  return humanoid({
    body: m.steel,
    skin: m.skin,
    accent: m.gold,
    boot: m.steelDark,
    ...opts,
  });
}

function pikeman(m) {
  const built = knightBody(m, { cloth: m.red, emblem: m.white, emblemShape: "cross", helm: "kettle" });
  spear(built.group, { shaft: m.wood, head: m.steel }, 0.21);
  roundShield(built.group, { face: m.red, rim: m.steel, boss: m.gold }, -0.26);
  return built;
}

function crusader(m) {
  const built = knightBody(m, { cloth: m.white, emblem: m.red, emblemShape: "cross", helm: "great", bulk: 1.15 });
  add(built.group, new THREE.BoxGeometry(0.33, 0.55, 0.02), m.red, 0, 0.55, 0.13, -0.12, 0, 0);
  kiteShield(built.group, { face: m.white, device: m.red }, -0.29);
  sword(built.group, { grip: m.dark, guard: m.gold, blade: m.steel }, 0.25, { length: 0.45 });
  return built;
}

function cavalier(m) {
  const mount = quadruped({
    body: m.horse,
    mane: m.horseDark,
    accent: m.horseDark,
    hoof: m.horseDark,
    bodyLen: 0.42,
    bodyR: 0.17,
    legLen: 0.4,
    neckLen: 0.34,
    head: "horse",
    tailStyle: "hair",
  });
  const g = mount.group;

  // Caparison: cloth panels hanging down each flank with a gold hem, not a
  // slab across the barrel.
  pair((s) => {
    add(g, new THREE.BoxGeometry(0.02, 0.2, 0.26), m.red, s * 0.175, mount.bodyY - 0.08, 0.0);
    add(g, new THREE.BoxGeometry(0.026, 0.03, 0.27), m.gold, s * 0.175, mount.bodyY - 0.18, 0.0);
  });
  add(g, new THREE.BoxGeometry(0.3, 0.02, 0.3), m.red, 0, mount.backY - 0.01, 0.04);
  const saddleY = mount.backY + 0.02;
  add(g, new THREE.BoxGeometry(0.22, 0.06, 0.24), m.steelDark, 0, saddleY, 0);

  // Rider, seated so the hips land on the saddle.
  const riderScale = 0.78;
  const rider = knightBody(m, { cloth: m.red, emblem: m.white, emblemShape: "cross", helm: "plume", legs: "mounted" });
  roundShield(rider.group, { face: m.red, rim: m.steel, boss: m.gold }, -0.26);
  rider.group.scale.setScalar(riderScale);
  rider.group.position.set(0, saddleY - rider.hip * riderScale + 0.02, 0);
  g.add(rider.group);
  const riderTop = rider.group.position.y + rider.height * riderScale;

  // Lance, couched forward and slightly up from the rider's right hand.
  const tilt = -1.25;
  const dir = new THREE.Vector3(0, Math.cos(tilt), Math.sin(tilt));
  const center = new THREE.Vector3(0.21, saddleY + 0.16, -0.42);
  add(g, new THREE.CylinderGeometry(0.012, 0.012, 1.05, 8), m.wood, center.x, center.y, center.z, tilt, 0, 0);
  const tip = center.clone().addScaledVector(dir, 0.585);
  add(g, new THREE.ConeGeometry(0.03, 0.12, 8), m.steel, tip.x, tip.y, tip.z, tilt, 0, 0);

  return { group: g, height: Math.max(riderTop, mount.height) };
}

// Built directly rather than via quadruped(): a griffin's front half is an
// eagle and its back half a lion, so it needs its own chest, neck, and
// talon-vs-paw split that the shared four-legged plan doesn't cover.
function griffin(m) {
  const g = new THREE.Group();

  // Lion hindquarters and barrel.
  add(g, new THREE.CapsuleGeometry(0.14, 0.3, 6, 14), m.griffinBody, 0, 0.4, 0.02, Math.PI / 2, 0, 0);
  // Eagle chest, neck and head rising in front.
  add(g, new THREE.SphereGeometry(0.15, 14, 10), m.griffinPale, 0, 0.46, -0.18);
  add(g, new THREE.CylinderGeometry(0.07, 0.1, 0.22, 10), m.griffinPale, 0, 0.64, -0.3, -0.6, 0, 0);
  add(g, new THREE.SphereGeometry(0.105, 14, 10), m.griffinPale, 0, 0.77, -0.38);
  add(g, new THREE.ConeGeometry(0.04, 0.16, 8), m.beak, 0, 0.75, -0.5, -Math.PI / 2, 0, 0);
  pair((s) => {
    add(g, new THREE.SphereGeometry(0.018, 6, 6), m.dark, s * 0.06, 0.8, -0.45);
    add(g, new THREE.ConeGeometry(0.02, 0.08, 6), m.griffinPale, s * 0.05, 0.88, -0.36, -0.3, 0, s * 0.3);
  });

  // Taloned forelegs, padded hind paws.
  [
    [-0.1, -0.15, m.beak], [0.1, -0.15, m.beak], [-0.1, 0.16, m.griffinBody], [0.1, 0.16, m.griffinBody],
  ].forEach(([x, z, footMat]) => {
    add(g, new THREE.CylinderGeometry(0.04, 0.045, 0.28, 8), m.griffinBody, x, 0.14, z);
    add(g, new THREE.BoxGeometry(0.09, 0.04, 0.12), footMat, x, 0.02, z - 0.02);
  });

  // Tufted lion tail.
  add(g, new THREE.CylinderGeometry(0.018, 0.03, 0.3, 8), m.griffinBody, 0, 0.52, 0.31, 0.83, 0, 0);
  add(g, new THREE.SphereGeometry(0.04, 8, 6), m.griffinBody, 0, 0.62, 0.42);

  addWings(g, m.wing, { x: 0.1, y: 0.55, z: 0.0, span: 0.6, chord: 0.32, lift: 1.0, sweep: 0.45 });
  return { group: g, height: 0.85 };
}

function celestial(m, { armor, bulk = 1, wingSpan, swordLen, halo, sash = false }) {
  const built = humanoid({
    body: armor,
    skin: m.skin,
    accent: m.gold,
    hair: m.blond,
    boot: m.white,
    helm: "none",
    bulk,
  });
  const g = built.group;
  // A white tunic hanging to the ankles.
  add(g, new THREE.ConeGeometry(0.2 * bulk, 0.44, 16, 1, true), m.white, 0, 0.26, 0);
  if (sash) add(g, new THREE.BoxGeometry(0.06, 0.36, 0.03), m.blue, 0, 0.66, -0.1, 0, 0, 0.5);
  add(g, new THREE.TorusGeometry(0.13, 0.014, 8, 28), halo, 0, built.headY + 0.13, 0, Math.PI / 2, 0, 0);
  sword(g, { grip: m.dark, guard: m.gold, blade: m.steel }, 0.23 * bulk, { length: swordLen });
  addWings(g, m.wing, { x: 0.1, y: built.shoulderY + 0.06, z: 0.09, span: wingSpan, chord: wingSpan * 0.54, lift: 0.95, sweep: 0.6 });
  return { group: g, height: built.height };
}

function angel(m) {
  return celestial(m, { armor: m.steel, wingSpan: 0.65, swordLen: 0.5, halo: m.gold });
}

function archangel(m) {
  return celestial(m, { armor: m.gold, bulk: 1.08, wingSpan: 0.78, swordLen: 0.58, halo: m.halo, sash: true });
}

const BUILDERS = { pikeman, cavalier, griffin, crusader, angel, archangel };

export function buildUnit(unitKey) {
  const builder = BUILDERS[unitKey] || pikeman;
  return builder(makeMats());
}
