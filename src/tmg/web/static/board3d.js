// A procedurally-built 3D chess board -- no model files, no textures, so no
// asset licensing to track and nothing to fail to load. Every piece is a
// stack of primitive geometry (cylinders, cones, spheres, boxes) tinted per
// faction.
//
// "Faction" here means an original, HOMM3-*inspired* army identity (name,
// color palette, and a roster of six unit archetypes standing in for the six
// chess roles) -- authored fresh from primitives below, never a model,
// texture, or sprite taken from that or any other game. The two sides in a
// game are always different factions (enforced by the caller, app.js);
// which faction plays which chess role never changes chess itself -- a
// "Griffin" still moves exactly like a bishop, because it IS the bishop,
// reskinned.
//
// This module knows nothing about chess rules. It parses a FEN's piece
// placement field well enough to know "what's on this square, whose is it,"
// so a click-to-select-then-click-to-move UI can tell friend from foe --
// legality itself stays server-side, exactly like the rest of this app: an
// illegal attempt is submitted, the server rejects it, and the caller reverts
// the board via a fresh setPosition(lastKnownFen).
import * as THREE from "three";
import { OrbitControls } from "https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js";

const FILES = "abcdefgh";
const SQUARE_SIZE = 1;

const COLORS = {
  light: 0xf6f1e7,
  dark: 0x8b5e3c,
  frame: 0x6b4626,
  selectEmissive: 0xb08d3e,
};

// Nine original army identities, each mapping the six chess roles onto a
// unit archetype in that army's own idiom and a two-tone color scheme of
// its own -- never white/black, so the two sides always read as two
// distinct armies rather than two shades of one design.
// Primary hues are spaced ~40-50 degrees apart around the color wheel
// (red/orange/green/teal/blue/indigo/purple/magenta, plus Conflux's pale
// desaturated look as the one deliberate outlier) rather than picked
// independently -- with the opponent's army assigned at random, ANY two
// factions can end up sharing a board, so pairwise separation matters more
// than any single palette looking good in isolation.
const FACTIONS = {
  castle: {
    label: "Castle",
    primary: 0x2f5a8c, // blue
    secondary: 0xc9a227,
    units: { p: "pikeman", n: "cavalier", b: "griffin", r: "crusader", q: "angel", k: "archangel" },
  },
  rampart: {
    label: "Rampart",
    primary: 0x2f7d3f, // green
    secondary: 0xc9a227,
    units: { p: "centaur", n: "pegasus", b: "woodelf", r: "dendroid", q: "unicorn", k: "golddragon" },
  },
  tower: {
    label: "Tower",
    primary: 0x7c8299, // steel-grey (lighter/less saturated than Castle's navy)
    secondary: 0xb8b8c8,
    units: { p: "gremlin", n: "gargoyle", b: "mage", r: "golem", q: "naga", k: "titan" },
  },
  inferno: {
    label: "Inferno",
    primary: 0x8c2f2f, // red
    secondary: 0xd97b2c,
    units: { p: "imp", n: "hellhound", b: "efreet", r: "pitfiend", q: "demon", k: "devil" },
  },
  necropolis: {
    label: "Necropolis",
    primary: 0x8c2f6b, // magenta/wine
    secondary: 0x8fae7a,
    units: { p: "skeleton", n: "wight", b: "lich", r: "zombie", q: "vampire", k: "bonedragon" },
  },
  dungeon: {
    label: "Dungeon",
    primary: 0x6b2f8c, // purple
    secondary: 0xb8a888,
    units: { p: "troglodyte", n: "harpy", b: "medusa", r: "minotaur", q: "manticore", k: "blackdragon" },
  },
  stronghold: {
    label: "Stronghold",
    primary: 0x8c5a2f, // orange-brown
    secondary: 0xb9822f,
    units: { p: "goblin", n: "wolfrider", b: "ogremage", r: "cyclops", q: "thunderbird", k: "behemoth" },
  },
  fortress: {
    label: "Fortress",
    primary: 0x1f6b85, // cyan-teal, shifted blue so it doesn't compete with Rampart's green
    secondary: 0x8a9b5c,
    units: { p: "gnoll", n: "dragonfly", b: "lizardman", r: "gorgon", q: "wyvern", k: "hydra" },
  },
  conflux: {
    label: "Conflux",
    primary: 0xcfd8e8, // pale, deliberately the one outlier -- ethereal, not saturated
    secondary: 0xe0c040,
    units: { p: "pixie", n: "airelemental", b: "fireelemental", r: "earthelemental", q: "psychicelemental", k: "phoenix" },
  },
};

export const FACTION_KEYS = Object.keys(FACTIONS);

export function factionLabel(key) {
  return FACTIONS[key].label;
}

function squareToWorld(square) {
  const col = FILES.indexOf(square[0]);
  const row = parseInt(square[1], 10) - 1;
  return { x: (col - 3.5) * SQUARE_SIZE, z: (3.5 - row) * SQUARE_SIZE };
}

function parseFenPlacement(fen) {
  const placement = fen.split(" ")[0];
  const ranks = placement.split("/"); // rank 8 first, as FEN always is
  const board = {};
  ranks.forEach((rankStr, i) => {
    const rank = 8 - i;
    let file = 0;
    for (const ch of rankStr) {
      if (/[1-8]/.test(ch)) {
        file += parseInt(ch, 10);
        continue;
      }
      board[FILES[file] + rank] = {
        type: ch.toLowerCase(),
        color: ch === ch.toUpperCase() ? "w" : "b",
      };
      file += 1;
    }
  });
  return board;
}

// Chess-role height hierarchy, held constant across every faction: whichever
// army you're looking at, its tallest unit is always the king and its
// shortest is always the pawn, so a learner can read the board by silhouette
// alone before they've learned to recognize any one faction's units.
function pieceBodyHeight(type) {
  return { p: 0.42, n: 0.56, b: 0.62, r: 0.5, q: 0.72, k: 0.8 }[type];
}

function factionMaterials(factionKey) {
  const faction = FACTIONS[factionKey] || FACTIONS.castle;
  return {
    primary: new THREE.MeshStandardMaterial({ color: faction.primary, roughness: 0.55, metalness: 0.15 }),
    secondary: new THREE.MeshStandardMaterial({ color: faction.secondary, roughness: 0.5, metalness: 0.25 }),
  };
}

function glowMaterial(color) {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55, roughness: 0.25 });
}

// -- Ten reusable unit archetypes. Each is parameterized (height, a couple
// of booleans/colors) rather than one-off per unit, the same way HOMM3's own
// roster reuses body plans (several dragons, several elementals, many
// humanoids) across its nine towns. Distinctiveness between units comes from
// which archetype is chosen, its parameters, and each faction's own two-tone
// palette -- not from sculpting fifty-four unrelated shapes from scratch.

function humanoidWarrior(mat, mat2, { height, weapon = "sword", horns = false }) {
  const g = new THREE.Group();
  const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, height * 0.5, 12), mat);
  legs.position.y = height * 0.25;
  g.add(legs);
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.14, height * 0.38, 12), mat);
  torso.position.y = height * 0.5 + height * 0.19;
  g.add(torso);
  const shoulders = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.16, 0.08, 12), mat2);
  shoulders.position.y = height * 0.5 + height * 0.35;
  g.add(shoulders);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), mat);
  head.position.y = height * 0.98;
  g.add(head);
  if (horns) {
    [-1, 1].forEach((s) => {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.08, 6), mat2);
      horn.position.set(s * 0.06, head.position.y + 0.08, 0);
      horn.rotation.z = s * 0.35;
      g.add(horn);
    });
  }
  if (weapon === "spear") {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, height * 0.85, 6), mat2);
    pole.position.set(0.2, height * 0.55, 0);
    g.add(pole);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.1, 6), mat2);
    tip.position.set(0.2, height * 0.55 + height * 0.42 + 0.05, 0);
    g.add(tip);
  } else if (weapon === "sword") {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, height * 0.45, 0.012), mat2);
    blade.position.set(0.19, height * 0.75, 0);
    blade.rotation.z = 0.15;
    g.add(blade);
  } else if (weapon === "club") {
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, height * 0.3, 6), mat2);
    handle.position.set(0.18, height * 0.5, 0);
    g.add(handle);
    const bulb = new THREE.Mesh(new THREE.DodecahedronGeometry(0.06), mat2);
    bulb.position.set(0.18, height * 0.65, 0);
    g.add(bulb);
  } else if (weapon === "javelin") {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, height * 0.6, 6), mat2);
    shaft.position.set(0.2, height * 0.7, 0);
    shaft.rotation.z = -0.4;
    g.add(shaft);
  }
  return g;
}

function mountedRider(mat, mat2, { height }) {
  const g = new THREE.Group();
  const mountBody = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.17, height * 0.5, 12), mat2);
  mountBody.rotation.z = Math.PI / 2;
  mountBody.position.y = height * 0.28;
  g.add(mountBody);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, height * 0.35, 10), mat2);
  neck.position.set(0.14, height * 0.42, 0);
  neck.rotation.x = -0.5;
  g.add(neck);
  const mountHead = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 8), mat2);
  mountHead.position.set(0.22, height * 0.62, 0);
  mountHead.rotation.x = Math.PI / 2 - 0.2;
  g.add(mountHead);
  const rider = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, height * 0.3, 10), mat);
  rider.position.y = height * 0.55 + height * 0.15;
  g.add(rider);
  const riderHead = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), mat);
  riderHead.position.y = height * 0.55 + height * 0.34;
  g.add(riderHead);
  const lance = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, height * 0.7, 6), mat2);
  lance.position.set(0.1, height * 0.7, 0.1);
  lance.rotation.x = -0.3;
  g.add(lance);
  return g;
}

function wingedFlyer(mat, mat2, { height, wingspan = 0.4, beak = true }) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.13, height * 0.6, 10), mat);
  body.rotation.x = Math.PI / 2;
  body.position.y = height * 0.5;
  g.add(body);
  [-1, 1].forEach((s) => {
    const wing = new THREE.Mesh(new THREE.ConeGeometry(wingspan * 0.5, 0.05, 3), mat2);
    wing.rotation.z = s * 1.3;
    wing.rotation.y = 0.3;
    wing.position.set(s * wingspan * 0.35, height * 0.6, -0.05);
    g.add(wing);
  });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), mat);
  head.position.set(0, height * 0.85, 0.12);
  g.add(head);
  if (beak) {
    const beakMesh = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.1, 6), mat2);
    beakMesh.rotation.x = Math.PI / 2;
    beakMesh.position.set(0, height * 0.85, 0.22);
    g.add(beakMesh);
  }
  return g;
}

function golemBlocky(mat, mat2, { height, horns = false }) {
  const g = new THREE.Group();
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.28, height * 0.4, 0.22), mat);
  legs.position.y = height * 0.2;
  g.add(legs);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.34, height * 0.4, 0.26), mat2);
  torso.position.y = height * 0.4 + height * 0.2;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), mat);
  head.position.y = height * 0.9;
  g.add(head);
  [-1, 1].forEach((s) => {
    const shoulder = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), mat2);
    shoulder.position.set(s * 0.2, height * 0.72, 0);
    g.add(shoulder);
  });
  if (horns) {
    [-1, 1].forEach((s) => {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.1, 6), mat2);
      horn.position.set(s * 0.05, height * 0.98, 0.06);
      horn.rotation.x = -0.3;
      g.add(horn);
    });
  }
  return g;
}

function serpentine(mat, mat2, { height, snakeHair = false }) {
  const g = new THREE.Group();
  const coilCount = 4;
  for (let i = 0; i < coilCount; i++) {
    const r = 0.22 - i * 0.03;
    const coil = new THREE.Mesh(new THREE.TorusGeometry(r, 0.05, 8, 16), mat);
    coil.position.y = 0.06 + i * (height * 0.16);
    coil.rotation.x = Math.PI / 2;
    g.add(coil);
  }
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, height * 0.3, 12), mat2);
  torso.position.y = height * 0.78;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), mat);
  head.position.y = height * 0.98;
  g.add(head);
  if (snakeHair) {
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2;
      const snake = new THREE.Mesh(new THREE.ConeGeometry(0.015, 0.09, 6), mat2);
      snake.position.set(Math.cos(angle) * 0.08, height * 1.05, Math.sin(angle) * 0.08);
      snake.rotation.x = Math.cos(angle) * 0.4;
      snake.rotation.z = Math.sin(angle) * 0.4;
      g.add(snake);
    }
  }
  return g;
}

function quadrupedBeast(mat, mat2, { height, horns = false, wings = false, tailSpike = false }) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, height * 0.55, 12), mat);
  body.rotation.z = Math.PI / 2;
  body.position.y = height * 0.35;
  g.add(body);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 10), mat);
  head.rotation.z = Math.PI / 2;
  head.position.set(0.28, height * 0.45, 0);
  g.add(head);
  if (horns) {
    [-1, 1].forEach((s) => {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.1, 6), mat2);
      horn.position.set(0.32, height * 0.55, s * 0.05);
      horn.rotation.x = s * 0.3;
      g.add(horn);
    });
  }
  if (wings) {
    [-1, 1].forEach((s) => {
      const wing = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.05, 3), mat2);
      wing.rotation.z = s * 1.2;
      wing.position.set(-0.05, height * 0.55, s * 0.18);
      g.add(wing);
    });
  }
  if (tailSpike) {
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.3, 8), mat2);
    tail.rotation.z = -Math.PI / 2.3;
    tail.position.set(-0.32, height * 0.5, 0);
    g.add(tail);
  }
  const legLen = height * 0.35;
  [
    [-0.15, 0.1],
    [0.15, 0.1],
    [-0.15, -0.1],
    [0.15, -0.1],
  ].forEach(([x, z]) => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, legLen, 8), mat);
    leg.position.set(x, legLen / 2, z);
    g.add(leg);
  });
  return g;
}

function dragonLarge(mat, mat2, { height, wingspan = 0.6, twoHeads = false }) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, height * 0.55, 12), mat);
  body.rotation.z = Math.PI / 2;
  body.position.y = height * 0.4;
  g.add(body);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, height * 0.4, 10), mat);
  neck.position.set(0, height * 0.55, 0);
  g.add(neck);
  const buildHead = (xOffset) => {
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.28, 10), mat);
    head.rotation.x = Math.PI / 2;
    head.position.set(xOffset, height * 0.75, 0.14);
    g.add(head);
    [-1, 1].forEach((s) => {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.015, 0.07, 6), mat2);
      horn.position.set(xOffset + s * 0.04, height * 0.85, 0.05);
      g.add(horn);
    });
  };
  if (twoHeads) {
    buildHead(-0.1);
    buildHead(0.1);
  } else {
    buildHead(0);
  }
  [-1, 1].forEach((s) => {
    const wing = new THREE.Mesh(new THREE.ConeGeometry(wingspan * 0.5, 0.06, 3), mat2);
    wing.rotation.z = s * 1.1;
    wing.rotation.y = 0.4;
    wing.position.set(s * wingspan * 0.4, height * 0.55, -0.1);
    g.add(wing);
  });
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.4, 10), mat);
  tail.rotation.z = Math.PI / 2;
  tail.position.set(0, height * 0.32, -0.4);
  g.add(tail);
  return g;
}

function elementalOrb(mat, mat2, { height, glowColor }) {
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(height * 0.32, 0), mat);
  core.position.y = height * 0.5;
  g.add(core);
  const shardMat = glowMaterial(glowColor);
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    const shard = new THREE.Mesh(new THREE.TetrahedronGeometry(0.07), shardMat);
    shard.position.set(
      Math.cos(angle) * height * 0.32,
      height * 0.5 + Math.sin(i) * 0.1,
      Math.sin(angle) * height * 0.32
    );
    g.add(shard);
  }
  return g;
}

function casterRobed(mat, mat2, { height, orbColor }) {
  const g = new THREE.Group();
  const robe = new THREE.Mesh(new THREE.ConeGeometry(0.19, height * 0.65, 16, 1, true), mat);
  robe.position.y = height * 0.35;
  g.add(robe);
  const hood = new THREE.Mesh(new THREE.ConeGeometry(0.13, height * 0.35, 14), mat2);
  hood.position.y = height * 0.7 + height * 0.15;
  g.add(hood);
  const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.055), glowMaterial(orbColor));
  orb.position.y = height + 0.05;
  g.add(orb);
  return g;
}

function insectoidFlyer(mat, mat2, { height, wingspan = 0.35 }) {
  const g = new THREE.Group();
  const abdomen = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, height * 0.5, 10), mat);
  abdomen.rotation.z = Math.PI / 2;
  abdomen.position.y = height * 0.4;
  g.add(abdomen);
  const thorax = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), mat2);
  thorax.position.set(0.15, height * 0.5, 0);
  g.add(thorax);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), mat);
  head.position.set(0.24, height * 0.53, 0);
  g.add(head);
  [-1, 1].forEach((s) => {
    const wing = new THREE.Mesh(new THREE.ConeGeometry(wingspan * 0.4, 0.02, 3), mat2);
    wing.rotation.z = s * 1.4;
    wing.position.set(0.05, height * 0.62, s * wingspan * 0.3);
    g.add(wing);
  });
  return g;
}

// Every faction's six roles, dispatched onto the ten archetypes above. Roles
// are picked for fit (a mount for the knight, a caster for the bishop, a
// bulky guardian for the rook, the army's own flagship unit for the king)
// rather than mirroring any game's literal tier order.
function buildUnit(unitKey, mat, mat2, height) {
  switch (unitKey) {
    // Castle
    case "pikeman":
      return humanoidWarrior(mat, mat2, { height, weapon: "spear" });
    case "cavalier":
      return mountedRider(mat, mat2, { height });
    case "griffin":
      return wingedFlyer(mat, mat2, { height, wingspan: 0.45 });
    case "crusader":
      return humanoidWarrior(mat, mat2, { height, weapon: "sword" });
    case "angel":
      return wingedFlyer(mat, mat2, { height, wingspan: 0.55, beak: false });
    case "archangel":
      return dragonLarge(mat, mat2, { height, wingspan: 0.7 });
    // Rampart
    case "centaur":
      return quadrupedBeast(mat, mat2, { height });
    case "pegasus":
      return wingedFlyer(mat, mat2, { height, wingspan: 0.5, beak: false });
    case "woodelf":
      return humanoidWarrior(mat, mat2, { height, weapon: "javelin" });
    case "dendroid":
      return golemBlocky(mat, mat2, { height });
    case "unicorn":
      return quadrupedBeast(mat, mat2, { height, horns: true });
    case "golddragon":
      return dragonLarge(mat, mat2, { height, wingspan: 0.65 });
    // Tower
    case "gremlin":
      return humanoidWarrior(mat, mat2, { height, weapon: "club" });
    case "gargoyle":
      return wingedFlyer(mat, mat2, { height, wingspan: 0.4 });
    case "mage":
      return casterRobed(mat, mat2, { height, orbColor: 0x88aaff });
    case "golem":
      return golemBlocky(mat, mat2, { height });
    case "naga":
      return serpentine(mat, mat2, { height });
    case "titan":
      return humanoidWarrior(mat, mat2, { height, weapon: "club" });
    // Inferno
    case "imp":
      return humanoidWarrior(mat, mat2, { height, weapon: "club", horns: true });
    case "hellhound":
      return quadrupedBeast(mat, mat2, { height, tailSpike: true });
    case "efreet":
      return wingedFlyer(mat, mat2, { height, wingspan: 0.4, beak: false });
    case "pitfiend":
      return golemBlocky(mat, mat2, { height, horns: true });
    case "demon":
      return humanoidWarrior(mat, mat2, { height, weapon: "sword", horns: true });
    case "devil":
      return dragonLarge(mat, mat2, { height, wingspan: 0.6 });
    // Necropolis
    case "skeleton":
      return humanoidWarrior(mat, mat2, { height, weapon: "sword" });
    case "wight":
      return wingedFlyer(mat, mat2, { height, wingspan: 0.3, beak: false });
    case "lich":
      return casterRobed(mat, mat2, { height, orbColor: 0x88ff88 });
    case "zombie":
      return golemBlocky(mat, mat2, { height });
    case "vampire":
      return wingedFlyer(mat, mat2, { height, wingspan: 0.42, beak: false });
    case "bonedragon":
      return dragonLarge(mat, mat2, { height, wingspan: 0.6 });
    // Dungeon
    case "troglodyte":
      return humanoidWarrior(mat, mat2, { height, weapon: "club" });
    case "harpy":
      return wingedFlyer(mat, mat2, { height, wingspan: 0.38 });
    case "medusa":
      return serpentine(mat, mat2, { height, snakeHair: true });
    case "minotaur":
      return golemBlocky(mat, mat2, { height, horns: true });
    case "manticore":
      return quadrupedBeast(mat, mat2, { height, wings: true, tailSpike: true });
    case "blackdragon":
      return dragonLarge(mat, mat2, { height, wingspan: 0.68 });
    // Stronghold
    case "goblin":
      return humanoidWarrior(mat, mat2, { height, weapon: "spear" });
    case "wolfrider":
      return mountedRider(mat, mat2, { height });
    case "ogremage":
      return casterRobed(mat, mat2, { height, orbColor: 0xffaa44 });
    case "cyclops":
      return golemBlocky(mat, mat2, { height });
    case "thunderbird":
      return wingedFlyer(mat, mat2, { height, wingspan: 0.5 });
    case "behemoth":
      return quadrupedBeast(mat, mat2, { height, horns: true, tailSpike: true });
    // Fortress
    case "gnoll":
      return humanoidWarrior(mat, mat2, { height, weapon: "spear" });
    case "dragonfly":
      return insectoidFlyer(mat, mat2, { height, wingspan: 0.36 });
    case "lizardman":
      return humanoidWarrior(mat, mat2, { height, weapon: "javelin" });
    case "gorgon":
      return golemBlocky(mat, mat2, { height, horns: true });
    case "wyvern":
      return dragonLarge(mat, mat2, { height, wingspan: 0.55 });
    case "hydra":
      return dragonLarge(mat, mat2, { height, wingspan: 0.3, twoHeads: true });
    // Conflux
    case "pixie":
      return wingedFlyer(mat, mat2, { height, wingspan: 0.3, beak: false });
    case "airelemental":
      return elementalOrb(mat, mat2, { height, glowColor: 0xbfe0ff });
    case "fireelemental":
      return elementalOrb(mat, mat2, { height, glowColor: 0xff8844 });
    case "earthelemental":
      return golemBlocky(mat, mat2, { height });
    case "psychicelemental":
      return elementalOrb(mat, mat2, { height, glowColor: 0xdd88ff });
    case "phoenix":
      return wingedFlyer(mat, mat2, { height, wingspan: 0.55 });
    default:
      return humanoidWarrior(mat, mat2, { height });
  }
}

function buildPieceMesh(type, factionKey) {
  const faction = FACTIONS[factionKey] || FACTIONS.castle;
  const mats = factionMaterials(factionKey);

  const group = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.1, 24), mats.primary);
  base.position.y = 0.05;
  group.add(base);

  const height = pieceBodyHeight(type);
  const unit = buildUnit(faction.units[type], mats.primary, mats.secondary, height);
  unit.position.y = 0.1;
  group.add(unit);

  group.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
  return group;
}

function buildBoard(scene) {
  const squareMeshes = {};
  const squareGeo = new THREE.BoxGeometry(SQUARE_SIZE * 0.98, 0.1, SQUARE_SIZE * 0.98);
  for (let col = 0; col < 8; col++) {
    for (let row = 0; row < 8; row++) {
      const isLight = (col + row) % 2 === 0;
      const material = new THREE.MeshStandardMaterial({
        color: isLight ? COLORS.light : COLORS.dark,
        roughness: 0.85,
      });
      const mesh = new THREE.Mesh(squareGeo, material);
      mesh.position.set((col - 3.5) * SQUARE_SIZE, 0, (3.5 - row) * SQUARE_SIZE);
      mesh.receiveShadow = true;
      mesh.userData.square = FILES[col] + (row + 1);
      squareMeshes[mesh.userData.square] = mesh;
      scene.add(mesh);
    }
  }

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(SQUARE_SIZE * 8 + 0.6, 0.16, SQUARE_SIZE * 8 + 0.6),
    new THREE.MeshStandardMaterial({ color: COLORS.frame, roughness: 0.6 })
  );
  frame.position.y = -0.06;
  frame.receiveShadow = true;
  scene.add(frame);

  return squareMeshes;
}

export class Board3D {
  constructor(
    container,
    { orientation = "white", onMove = () => {}, factions = { w: "castle", b: "stronghold" } } = {}
  ) {
    this.container = container;
    this.orientation = orientation;
    this.onMove = onMove;
    this.factions = factions;
    this.interactive = false;
    this.selected = null;
    this.boardState = {};
    this.pieceMeshes = {};

    this._onClick = this._onClick.bind(this);
    this._onResize = this._onResize.bind(this);
    this._animate = this._animate.bind(this);

    this._initScene();
    window.addEventListener("resize", this._onResize);
    requestAnimationFrame(this._animate);
  }

  _initScene() {
    const width = this.container.clientWidth || 480;
    const height = this.container.clientHeight || width;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLORS.light);

    this.camera = new THREE.PerspectiveCamera(46, width / height, 0.1, 100);
    this._setDefaultCameraPose();

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.container.appendChild(this.renderer.domElement);
    this.renderer.domElement.addEventListener("click", this._onClick);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 20;
    this.controls.target.set(0, 0, 0);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xfff3e0, 0.9);
    key.position.set(4, 8, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xdce8ff, 0.3);
    fill.position.set(-4, 4, -4);
    this.scene.add(fill);

    this.squareMeshes = buildBoard(this.scene);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
  }

  _setDefaultCameraPose() {
    const z = this.orientation === "white" ? 8.6 : -8.6;
    this.camera.position.set(0, 8.4, z);
    this.camera.lookAt(0, 0, 0);
  }

  setOrientation(orientation) {
    this.orientation = orientation;
    this._setDefaultCameraPose();
  }

  setFactions(factions) {
    this.factions = factions;
    this._syncPieceMeshes();
  }

  setInteractive(enabled) {
    this.interactive = enabled;
    this.container.style.cursor = enabled ? "grab" : "default";
    if (!enabled) this._clearSelection();
  }

  setPosition(fen) {
    this.boardState = parseFenPlacement(fen);
    this._syncPieceMeshes();
    this._clearSelection();
  }

  _syncPieceMeshes() {
    Object.values(this.pieceMeshes).forEach((group) => {
      this.scene.remove(group);
      group.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
    });
    this.pieceMeshes = {};

    Object.entries(this.boardState).forEach(([square, piece]) => {
      const mesh = buildPieceMesh(piece.type, this.factions[piece.color]);
      const { x, z } = squareToWorld(square);
      mesh.position.set(x, 0.1, z);
      mesh.userData.square = square;
      this.scene.add(mesh);
      this.pieceMeshes[square] = mesh;
    });
  }

  _onClick(event) {
    if (!this.interactive) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const pickables = [
      ...Object.values(this.pieceMeshes).flatMap((group) => group.children),
      ...Object.values(this.squareMeshes),
    ];
    const hits = this.raycaster.intersectObjects(pickables, false);
    if (!hits.length) return;

    let obj = hits[0].object;
    while (obj && !obj.userData.square) obj = obj.parent;
    if (!obj) return;
    this._handleSquareClick(obj.userData.square);
  }

  _handleSquareClick(square) {
    const piece = this.boardState[square];

    if (this.selected === square) {
      this._clearSelection();
      return;
    }

    if (this.selected) {
      const fromSquare = this.selected;
      const fromPiece = this.boardState[fromSquare];
      if (piece && piece.color === fromPiece.color) {
        this._clearSelection();
        this._selectSquare(square);
        return;
      }
      this._clearSelection();
      let uci = fromSquare + square;
      const isPromotion = fromPiece.type === "p" && (square[1] === "8" || square[1] === "1");
      if (isPromotion) uci += "q";
      this.onMove(uci);
      return;
    }

    if (piece) this._selectSquare(square);
  }

  _selectSquare(square) {
    this.selected = square;
    const mesh = this.pieceMeshes[square];
    if (!mesh) return;
    mesh.position.y = 0.26;
    mesh.traverse((obj) => {
      if (obj.material && obj.material.emissive) {
        obj.material.emissive.setHex(COLORS.selectEmissive);
        obj.material.emissiveIntensity = 0.35;
      }
    });
  }

  _clearSelection() {
    if (this.selected && this.pieceMeshes[this.selected]) {
      const mesh = this.pieceMeshes[this.selected];
      mesh.position.y = 0.1;
      mesh.traverse((obj) => {
        if (obj.material && obj.material.emissive) {
          obj.material.emissive.setHex(0);
          obj.material.emissiveIntensity = 0;
        }
      });
    }
    this.selected = null;
  }

  _onResize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight || width;
    if (!width || !height) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  _animate() {
    this._animationFrame = requestAnimationFrame(this._animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    cancelAnimationFrame(this._animationFrame);
    window.removeEventListener("resize", this._onResize);
    this.renderer.domElement.removeEventListener("click", this._onClick);
    this.controls.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
