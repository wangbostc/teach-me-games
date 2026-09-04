// Dungeon -- subterranean tyrants. Blind cave-things, serpent sorceresses,
// bull-headed brutes, and a black dragon throned on gold. Built from the
// shared body plans in common.js; nothing is loaded from any game or asset
// pack.
import * as THREE from "three";
import {
  add,
  pair,
  addWings,
  humanoid,
  quadruped,
  dragon,
  serpentCoil,
  club,
  axe,
  bow,
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
  purple: 0x6b2f8c,
  blackScale: 0x241a2e,
  pallidTan: 0xb8a888,
  bloodRed: 0x8c2323,
  gold: 0xc9a227,
  iron: 0x4a4550,
  magentaGlow: 0xd24bd2,
  greyHide: 0x6f6478,
  bone: 0xcfc3a8,
  manticoreTawny: 0xb5822f,
  darkMane: 0x3b2415,
};

export const BASE_COLOR = 0x2e2438;
export const ACCENT_COLOR = PALETTE.gold;
export const UNITS = { p: "troglodyte", n: "harpy", b: "medusa", r: "minotaur", q: "manticore", k: "blackdragon" };

// Fresh materials per piece: selection highlighting mutates a piece's
// emissive channel, and shared materials would light up every piece at once.
// (The procedural textures underneath ARE shared -- see materials.js.)
function makeMats() {
  return {
    purple: cloth(PALETTE.purple),
    blackScale: hide(PALETTE.blackScale),
    pallidSkin: skin(PALETTE.pallidTan),
    bloodRed: cloth(PALETTE.bloodRed),
    manticoreBody: hide(PALETTE.manticoreTawny),
    darkMane: hide(PALETTE.darkMane),
    gold: burnishedGold(PALETTE.gold),
    iron: polishedMetal(PALETTE.iron, { roughness: 0.55 }),
    magentaGlow: glow(PALETTE.magentaGlow, PALETTE.magentaGlow, 1.0),
    greyHide: hide(PALETTE.greyHide),
    wingFeather: feathers(0x554b61),
    bone: matte(PALETTE.bone, 0.55),
    darkHair: hair(PALETTE.blackScale),
    wood: wood(0x3a2a1c, 0x1f150e, { repeat: 1.5, roughness: 0.7 }),
    dark: matte(0x140f1a, 0.5),
  };
}

// p -- a blind, pallid cave dweller. The humblest unit in the army.
function troglodyte(m) {
  const built = humanoid({
    body: m.pallidSkin,
    skin: m.pallidSkin,
    cloth: m.purple,
    accent: m.iron,
    boot: m.pallidSkin,
    bulk: 0.85,
    legLen: 0.36,
    hunch: 0.2,
    // No `eye` -- this thing is eyeless, and that's the point.
  });
  club(built.group, { shaft: m.wood, head: m.iron }, 0.17, { length: 0.3 });
  return built;
}

// n -- a winged bird-woman, slight and predatory.
function harpy(m) {
  const built = humanoid({
    body: m.greyHide,
    skin: m.pallidSkin,
    hair: m.darkHair,
    accent: m.iron,
    boot: m.iron,
    legs: "digitigrade",
    bulk: 0.9,
    legLen: 0.34,
  });
  const g = built.group;

  // Taloned feet: small claws stabbing forward past the boots.
  pair((s) => {
    for (let i = -1; i <= 1; i++) {
      add(g, new THREE.ConeGeometry(0.012, 0.055, 5), m.iron, s * 0.085, 0.02, -0.09 + i * 0.035, Math.PI / 2, 0, 0);
    }
  });

  // Large feather wings stand in for arms, mounted at the shoulders.
  addWings(g, m.wingFeather, {
    x: 0.16,
    y: built.shoulderY,
    z: 0.02,
    span: 0.5,
    chord: 0.28,
    lift: 0.95,
    sweep: 0.5,
    type: "feather",
  });

  return built;
}

// b -- a serpent-bodied archer with living snakes for hair.
function medusa(m) {
  const g = new THREE.Group();
  const seatY = serpentCoil(g, m.blackScale, { accent: m.purple, coils: 4, r: 0.2, rise: 0.14 });

  const torso = humanoid({
    body: m.blackScale,
    skin: m.pallidSkin,
    eye: m.magentaGlow,
    accent: m.gold,
    legs: "bare",
  });
  bow(torso.group, { limb: m.wood, string: m.dark }, 0.2);

  // Snake hair: a ring of tapering scale-colored cones angled outward.
  const headR = 0.095;
  const count = 6;
  let hairTop = 0;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const bx = Math.cos(a) * headR * 0.75;
    const bz = Math.sin(a) * headR * 0.75 - headR * 0.1;
    const len = 0.09 + (i % 2) * 0.03;
    const by = torso.headY + headR * 0.25;
    const snake = add(torso.group, new THREE.ConeGeometry(0.015, len, 6), m.blackScale, bx, by, bz);
    snake.lookAt(new THREE.Vector3(bx * 1.9, by + 0.07, bz * 1.9));
    snake.rotateX(Math.PI / 2);
    hairTop = Math.max(hairTop, by + len * 0.75);
  }
  // Small bone fangs.
  pair((s) =>
    add(torso.group, new THREE.ConeGeometry(0.01, 0.05, 5), m.bone, s * 0.03, torso.headY - headR * 0.5, -headR * 0.9, Math.PI / 2 + 0.3, 0, 0)
  );

  torso.group.position.set(0, seatY - torso.hip, 0);
  g.add(torso.group);

  return { group: g, height: seatY - torso.hip + Math.max(torso.height, hairTop) };
}

// r -- a massive bull-headed warrior, broad and heavily armored.
function minotaur(m) {
  const built = humanoid({
    body: m.iron,
    skin: m.greyHide,
    accent: m.gold,
    boot: m.iron,
    cloth: m.bloodRed,
    head: "bull",
    legs: "digitigrade",
    bulk: 1.35,
    torsoLen: 0.38,
  });
  const g = built.group;

  // Broad chest plate to sell the heavy-shouldered silhouette.
  add(g, new THREE.BoxGeometry(0.32, 0.24, 0.03), m.iron, 0, built.shoulderY - 0.06, -0.105 * 1.35);

  axe(g, { shaft: m.wood, head: m.iron }, 0.28, { length: 0.85, twoBlade: true });
  return built;
}

// q -- a lion-bodied beast with bat wings and a scorpion tail: recognizably
// a big cat first, monster second.
function manticore(m) {
  const bodyLen = 0.46;
  const bodyR = 0.17;
  const legLen = 0.36;
  const neckLen = 0.28;
  const neckTilt = -0.7; // quadruped()'s default -- named here so the hand
  // math below (mane and tail placement, and the corrected height) tracks it
  // honestly if it's ever changed.
  const built = quadruped({
    body: m.manticoreBody,
    mane: m.darkMane,
    accent: m.bloodRed,
    eye: m.magentaGlow,
    hoof: m.iron,
    head: "lion",
    bodyLen,
    bodyR,
    legLen,
    neckLen,
    digitigrade: true,
    tailStyle: "scorpion",
  });
  const g = built.group;

  // Head/neck position, replicated from quadruped()'s own math for a single
  // "lion" head, so the reinforced mane and extra tail below can be placed
  // -- and the reported height corrected -- without touching common.js.
  const bodyY = built.bodyY;
  const neckBaseY = bodyY + bodyR * 0.5;
  const hY = neckBaseY + neckLen * 0.78;
  const neckZ = -bodyLen * 0.5;
  const hZ = neckZ - 0.06 - neckLen * 0.5 * Math.sin(-neckTilt) - 0.06;

  // Reinforce the mane: the "lion" head already drops a thin torus, which
  // reads as a disc from a distance. A second, larger ring plus a scatter of
  // overlapping dark tufts around the head/neck sells an unmistakable mane.
  const maneY = hY;
  const maneZ = hZ + 0.05;
  const maneMainR = 0.14;
  const maneTubeR = 0.05;
  add(g, new THREE.TorusGeometry(maneMainR, maneTubeR, 8, 16), m.darkMane, 0, maneY, maneZ, 0.1, 0, 0);
  const tuftCount = 7;
  for (let i = 0; i < tuftCount; i++) {
    const a = (i / tuftCount) * Math.PI * 2;
    add(
      g,
      new THREE.SphereGeometry(0.045, 8, 8),
      m.darkMane,
      Math.cos(a) * 0.12,
      maneY + Math.sin(a) * 0.09,
      maneZ + (i % 2 === 0 ? 0.015 : -0.015)
    );
  }

  // A second, thicker, plated scorpion tail alongside the thin one that
  // tailStyle:"scorpion" already built: tapering cylinder links curling up
  // and forward over the back, capped with a hooked, venom-glowing stinger.
  let tpy = bodyY + 0.02;
  let tpz = bodyLen * 0.5 + 0.03;
  const tailLinks = 5;
  for (let i = 0; i < tailLinks; i++) {
    const rr = 0.055 - i * 0.008;
    add(g, new THREE.CylinderGeometry(rr * 0.8, rr, 0.11, 8), m.dark, 0, tpy, tpz, 1.05 - i * 0.42, 0, 0);
    tpy += 0.09 - i * 0.006;
    tpz -= 0.02 + i * 0.012;
  }
  add(g, new THREE.ConeGeometry(0.034, 0.1, 8), m.dark, 0, tpy + 0.03, tpz - 0.05, -2.3, 0, 0);
  add(g, new THREE.SphereGeometry(0.022, 8, 8), m.magentaGlow, 0, tpy + 0.09, tpz - 0.11);

  // Bat wings at the shoulders, in a dark membrane material.
  addWings(g, m.blackScale, {
    x: 0.17,
    y: bodyY + 0.06,
    z: 0.04,
    span: 0.55,
    chord: 0.3,
    lift: 0.95,
    sweep: 0.5,
    type: "bat",
  });

  // quadruped()'s reported height already tracks the head (and, via its own
  // thin scorpion tail, sometimes a touch more) -- but the contract excludes
  // tails and stingers, and the reinforced mane can now stand a little proud
  // of the skull, so the true head-only top is recomputed by hand instead of
  // trusted from the built-in tail's contribution.
  const headTop = hY + 0.12;
  const maneTop = maneY + maneMainR + maneTubeR;
  built.height = Math.max(headTop, maneTop);
  return built;
}

// k -- a great black dragon, the grandest piece in the army.
function blackdragon(m) {
  return dragon({
    body: m.blackScale,
    belly: m.iron,
    wing: m.blackScale,
    accent: m.gold,
    eye: m.magentaGlow,
    bodyLen: 0.56,
    bodyR: 0.22,
    legLen: 0.3,
    neckLen: 0.42,
    wingSpan: 0.75,
    wingType: "bat",
    tailLen: 0.5,
    spikes: true,
  });
}

const BUILDERS = { troglodyte, harpy, medusa, minotaur, manticore, blackdragon };

export function buildUnit(unitKey) {
  const builder = BUILDERS[unitKey] || troglodyte;
  return builder(makeMats());
}
