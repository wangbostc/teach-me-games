// Fortress -- swamp lizardfolk and the beasts of the mire. Hunched gnoll
// levies, upright lizardman archers, and a menagerie of reptilian and insect
// monstrosities culminating in a four-headed hydra. Built from the shared
// body plans in common.js; nothing is loaded from any game or asset pack.
import * as THREE from "three";
import {
  add,
  glowEyes,
  humanoid,
  quadruped,
  dragon,
  insect,
  spikeRow,
  club,
  bow,
  quiver,
} from "/static/units/common.js";
import {
  hide,
  matte,
  glow,
  paintedMetal,
  wood,
} from "/static/units/materials.js";

const PALETTE = {
  cyanTeal: 0x1f6b85,
  swampGreen: 0x4a6b3f,
  bone: 0xcfc6a8,
  olive: 0x8a9b5c,
  scaleGreen: 0x3f7a5a,
  gnollFur: 0x9c7a4a,
  venomGreen: 0x9fd14b,
  darkHide: 0x3a3428,
  gorgonOlive: 0x5c6b48,
  plateDark: 0x2b3324,
};

export const BASE_COLOR = 0x3a4a3a;
export const ACCENT_COLOR = PALETTE.olive;
export const UNITS = { p: "gnoll", n: "dragonfly", b: "lizardman", r: "gorgon", q: "wyvern", k: "hydra" };

// Fresh materials per piece: selection highlighting mutates a piece's
// emissive channel, and shared materials would light up every piece at once.
function makeMats() {
  return {
    fur: hide(PALETTE.gnollFur),
    scale: hide(PALETTE.scaleGreen),
    swamp: hide(PALETTE.swampGreen),
    teal: hide(PALETTE.cyanTeal),
    dark: hide(PALETTE.darkHide),
    bone: matte(PALETTE.bone, 0.55),
    venom: glow(PALETTE.venomGreen, PALETTE.venomGreen, 1.1),
    wood: wood(0x5a4530, 0x2c2216, { repeat: 2, roughness: 0.7 }),
    gorgonHide: hide(PALETTE.gorgonOlive),
    plate: paintedMetal(PALETTE.plateDark),
  };
}

// p -- a hyena-headed brute: hunched, digitigrade, minimally armored. The
// humblest unit in the roster; a club and a bone necklace, nothing more.
function gnoll(m) {
  const bulk = 0.95;
  const built = humanoid({
    body: m.fur,
    skin: m.fur,
    accent: m.bone,
    boot: m.dark,
    head: "beast",
    legs: "digitigrade",
    bulk,
    hunch: 0.3,
    legLen: 0.34,
    torsoLen: 0.28,
    headR: 0.088,
  });
  club(built.group, { shaft: m.wood, head: m.bone }, 0.19 * bulk);
  // A single strand of bone beads at the throat -- the only jewelry it owns.
  add(built.group, new THREE.TorusGeometry(0.065, 0.011, 6, 12), m.bone, 0, built.shoulderY + 0.06, 0.01, Math.PI / 2, 0, 0);
  return built;
}

// n -- a giant swamp dragonfly. insect() handles the segmented abdomen,
// thorax, legs, and both wing pairs; a stinger cone is grafted onto the
// abdomen's tip. insect() echoes its `height` input back verbatim rather
// than measuring the geometry it built, so the true top (the head sphere) is
// computed by hand here -- see the report for why.
function dragonfly(m) {
  const height = 0.72;
  const segments = 4;
  const built = insect({
    body: m.teal,
    accent: m.scale,
    wing: m.scale,
    eye: m.venom,
    height,
    wingSpan: 0.42,
    segments,
  });
  const bodyY = height * 0.52;
  const lastAbdomenZ = 0.06 + (segments - 1) * 0.11;
  add(built.group, new THREE.ConeGeometry(0.016, 0.05, 6), m.scale, 0, bodyY, lastAbdomenZ + 0.05, Math.PI / 2, 0, 0);
  built.height = height * 0.52 + 0.082; // true top: the head sphere's crown
  return built;
}

// b -- a scaled archer. Upright and lean, unlike the gnoll's hunch, with a
// crest of spikes along the skull, a bow, and a quiver.
function lizardman(m) {
  const bulk = 0.9;
  const headR = 0.09;
  const built = humanoid({
    body: m.scale,
    skin: m.scale,
    accent: m.bone,
    boot: m.dark,
    head: "beast",
    legs: "straight",
    bulk,
    legLen: 0.42,
    torsoLen: 0.34,
    headR,
  });
  spikeRow(built.group, m.bone, {
    from: -headR * 0.8,
    to: headR * 0.5,
    y: built.headY + headR * 0.6,
    count: 4,
    len: 0.05,
    r: 0.012,
  });
  bow(built.group, { limb: m.wood, string: m.bone }, 0.19 * bulk, { size: 0.24, handY: 0.5 });
  quiver(built.group, { body: m.dark, fletch: m.bone }, { x: -0.16 * bulk, y: 0.62, z: 0.11 });
  return built;
}

// r -- a heavy, armored bull-like beast: broad, squat, plated -- the
// immovable piece. Overlapping spine plates and a collar hump are what read
// as "armored" rather than a smooth lump; glowing venom eyes are its weapon.
// quadruped()'s "bull" head already curls a small pair of horns from the
// accent (bone) material -- passing `horns` here adds a second, much bigger
// straight pair (also bone), rather than duplicating the curl pair.
function gorgon(m) {
  const bodyLen = 0.44;
  const bodyR = 0.22;
  const legLen = 0.3;
  const neckLen = 0.22;
  const neckTilt = -0.5;
  const hornLen = 0.22;
  const hornSweep = -0.4;
  const built = quadruped({
    body: m.gorgonHide,
    belly: m.bone,
    accent: m.bone,
    eye: m.venom,
    hoof: m.dark,
    bodyLen,
    bodyR,
    legLen,
    neckLen,
    neckTilt,
    head: "bull",
    digitigrade: false,
    tailStyle: "reptile",
    horns: { len: hornLen, r: 0.045, spread: 0.7, sweep: hornSweep },
  });
  const g = built.group;

  // Overlapping armor plates down the spine, shoulder to rump: flattened,
  // overlapping domes read as plating where a smooth back reads as a lump.
  const plateCount = 4;
  const zFrom = -bodyLen * 0.32;
  const zTo = bodyLen * 0.42;
  for (let i = 0; i < plateCount; i++) {
    const t = i / (plateCount - 1);
    const z = zFrom + (zTo - zFrom) * t;
    const plate = add(g, new THREE.SphereGeometry(bodyR * 0.5, 10, 8), m.plate, 0, built.backY + 0.01, z);
    plate.scale.set(1.15, 0.4, 0.85);
  }
  // A raised, plated collar/hump at the shoulders.
  const collar = add(g, new THREE.SphereGeometry(bodyR * 0.62, 12, 10), m.plate, 0, built.backY + 0.05, -bodyLen * 0.38);
  collar.scale.set(1.1, 0.55, 0.95);

  // Head/neck position, replicated from quadruped()'s own math for a single
  // "bull" head, so the bigger eyes and the corrected height below don't
  // need to touch common.js.
  const neckBaseY = legLen + bodyR * 0.75 + bodyR * 0.5;
  const hY = neckBaseY + neckLen * 0.78;
  const neckZ = -bodyLen * 0.5;
  const hZ = neckZ - 0.06 - neckLen * 0.5 * Math.sin(-neckTilt) - 0.06;

  // Bigger venom-green eyes, layered directly over the pair quadruped()'s
  // "bull" head already placed at this same spot -- its gaze is its weapon.
  glowEyes(g, m.venom, { y: hY + 0.02, x: 0.05, z: hZ - 0.08, r: 0.024 });

  // quadruped() folds its own small curl-horn pair into the reported height,
  // but not the larger straight pair added via `horns` above -- horns this
  // big clear the skull, so the tip is measured by hand from the same
  // y/len/sweep common.js's hornPair call uses inside the "bull" branch.
  const headTop = hY + 0.12;
  const hornBaseY = hY + 0.08;
  const hornTipY = hornBaseY + (hornLen / 2) * Math.cos(hornSweep);
  built.height = Math.max(headTop, hornTipY);
  return built;
}

// q -- a lean, winged two-legged reptile (in spirit -- dragon() always
// builds two leg pairs; see the report). Smaller and sleeker than the
// hydra, with a long tail ending in a venomous sting.
function wyvern(m) {
  const bodyLen = 0.4;
  const bodyR = 0.13;
  const tailLen = 0.55;
  const built = dragon({
    body: m.scale,
    belly: m.bone,
    wing: m.teal,
    accent: m.bone,
    eye: m.venom,
    bodyLen,
    bodyR,
    legLen: 0.22,
    neckLen: 0.3,
    heads: 1,
    wingSpan: 0.6,
    wingType: "bat",
    tailLen,
    spikes: true,
  });
  // Cap the tail dragon() built with a venomous stinger, at the tip it
  // reports -- re-deriving the droop math here once produced a NaN position
  // (from a field the dragon no longer returned) that made the whole piece
  // vanish from the board.
  const tip = built.tailTip;
  add(built.group, new THREE.ConeGeometry(bodyR * 0.25, 0.15, 8), m.venom, tip.x, tip.y, tip.z, -1.1, 0, 0);
  return built;
}

// k -- a four-headed swamp hydra: broad and low rather than tall, so it
// reads as the widest, most alarming silhouette on the board. dragon()'s
// per-head loop applies glowing eyes to every head automatically.
function hydra(m) {
  return dragon({
    body: m.swamp,
    belly: m.bone,
    wing: m.dark,
    accent: m.bone,
    eye: m.venom,
    bodyLen: 0.6,
    bodyR: 0.22,
    legLen: 0.2,
    neckLen: 0.3,
    heads: 4,
    wingSpan: 0.16,
    wingType: "bat",
    tailLen: 0.5,
    spikes: true,
  });
}

const BUILDERS = { gnoll, dragonfly, lizardman, gorgon, wyvern, hydra };

export function buildUnit(unitKey) {
  const builder = BUILDERS[unitKey] || gnoll;
  return builder(makeMats());
}
