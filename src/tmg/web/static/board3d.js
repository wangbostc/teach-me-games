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
// Bare specifiers resolved through the "three/addons/" entry in index.html's
// importmap -- the SAME pin that resolves "three" itself. A hardcoded
// absolute unpkg URL here used to duplicate that pin; bump one without the
// other and the page loads two separate copies of three.js, which fails in
// ways that are very hard to diagnose (see index.html's importmap comment).
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import * as castle from "/static/units/castle.js";
import * as rampart from "/static/units/rampart.js";
import * as tower from "/static/units/tower.js";
import * as inferno from "/static/units/inferno.js";
import * as necropolis from "/static/units/necropolis.js";
import * as dungeon from "/static/units/dungeon.js";
import * as stronghold from "/static/units/stronghold.js";
import * as fortress from "/static/units/fortress.js";
import * as conflux from "/static/units/conflux.js";
import { wood, stone, burnishedGold } from "/static/units/materials.js";
import { fitToRole } from "/static/units/common.js";

const FILES = "abcdefgh";
const SQUARE_SIZE = 1;

const COLORS = {
  light: 0xf6f1e7,
  dark: 0x8b5e3c,
  frame: 0x6b4626,
  selectEmissive: 0xb08d3e,
};

// Nine original army identities. Each is a module under units/ that owns its
// own palette and its own six unit builders -- an army's look lives with the
// army, not in one central table. Which faction plays which chess role never
// changes chess itself: a Griffin still moves exactly like a bishop, because
// it IS the bishop, reskinned.
const FACTIONS = {
  castle: { label: "Castle", mod: castle },
  rampart: { label: "Rampart", mod: rampart },
  tower: { label: "Tower", mod: tower },
  inferno: { label: "Inferno", mod: inferno },
  necropolis: { label: "Necropolis", mod: necropolis },
  dungeon: { label: "Dungeon", mod: dungeon },
  stronghold: { label: "Stronghold", mod: stronghold },
  fortress: { label: "Fortress", mod: fortress },
  conflux: { label: "Conflux", mod: conflux },
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

const _PIECE_LETTER_RE = /[prnbqk]/i;

// Bounded and validated: a malformed or truncated FEN used to overflow
// `FILES[file]` past "h" into `undefined`, producing a piece keyed
// "undefined5" that squareToWorld then placed at NaN, and a stray
// non-piece, non-digit character (e.g. a typo'd "9") fell straight through
// to the piece branch and got recorded as a piece of that literal letter --
// both silent failures one level up from what check_units.mjs already
// guards against for unit geometry (finding 10). Every failure mode here
// throws instead: a bad FEN is a caller bug, not a rendering decision.
export function parseFenPlacement(fen) {
  const placement = fen.split(" ")[0];
  const ranks = placement.split("/"); // rank 8 first, as FEN always is
  if (ranks.length !== 8) {
    throw new Error(`parseFenPlacement: expected 8 ranks, got ${ranks.length} (${JSON.stringify(placement)})`);
  }
  const board = {};
  ranks.forEach((rankStr, i) => {
    const rank = 8 - i;
    let file = 0;
    for (const ch of rankStr) {
      if (/[1-8]/.test(ch)) {
        file += parseInt(ch, 10);
        continue;
      }
      if (!_PIECE_LETTER_RE.test(ch)) {
        throw new Error(`parseFenPlacement: rank ${rank} has an unrecognized character ${JSON.stringify(ch)} (${JSON.stringify(rankStr)})`);
      }
      if (file >= 8) {
        throw new Error(`parseFenPlacement: rank ${rank} overflows past the h-file (${JSON.stringify(rankStr)})`);
      }
      board[FILES[file] + rank] = {
        type: ch.toLowerCase(),
        color: ch === ch.toUpperCase() ? "w" : "b",
      };
      file += 1;
    }
    if (file !== 8) {
      throw new Error(`parseFenPlacement: rank ${rank} covers ${file} square(s), not 8 (${JSON.stringify(rankStr)})`);
    }
  });
  return board;
}

// One piece: a plinth plus the faction's unit for this chess role, scaled by
// fitToRole to the shared per-role height (see units/common.js). That height
// table is what keeps the hierarchy readable across every army -- whichever
// faction you are looking at, its tallest unit is the king and its shortest
// the pawn, so the board can be read by silhouette before a learner knows
// any one army's units.
function buildPieceMesh(type, factionKey, color) {
  const faction = FACTIONS[factionKey];
  if (!faction) {
    // Silently rendering Castle for an unrecognized key used to leave the
    // matchup line (app.js's showMatchup) announcing the army the user
    // actually picked while the board showed a different one -- text and
    // pieces actively disagreeing, with nothing to say why (finding 11).
    // A bad faction key is a caller bug (app.js only ever passes
    // FACTION_KEYS-derived strings), so fail loudly instead.
    throw new Error(
      `buildPieceMesh: unknown faction key ${JSON.stringify(factionKey)} (expected one of ${FACTION_KEYS.join(", ")})`
    );
  }
  const mod = faction.mod;

  // A stone plinth, ringed in the army's accent metal. Its colour is the
  // army's own stone pushed hard toward light or dark depending on WHICH
  // SIDE it belongs to: with nine armies paired at random, some matchups
  // (Necropolis vs. Dungeon, say) are two dark purples and become genuinely
  // hard to tell apart. Encoding the side in the plinth restores the one
  // thing a chess set must never lose -- whose piece is whose -- without
  // flattening the armies into a plain light/dark set.
  const group = new THREE.Group();
  const sideStone = new THREE.Color(mod.BASE_COLOR).lerp(
    new THREE.Color(color === "w" ? 0xf2eee2 : 0x121017),
    0.62
  );
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.1, 32), stone(sideStone.getHex()));
  base.position.y = 0.05;
  group.add(base);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.012, 8, 40), burnishedGold(mod.ACCENT_COLOR));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.1;
  group.add(ring);

  const unit = fitToRole(mod.buildUnit(mod.UNITS[type]), type);
  unit.position.y += 0.1; // fitToRole already grounded it; lift onto the plinth
  // Units are authored facing -z (white's forward); black's face the other way.
  if (color === "b") unit.rotation.y = Math.PI;
  group.add(unit);

  group.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
  return group;
}

// Maple and walnut squares in a walnut frame -- wood grain on all three, so
// the board reads as a made object, not two flat paint colors.
function buildBoard(scene) {
  const squareMeshes = {};
  const squareGeo = new THREE.BoxGeometry(SQUARE_SIZE * 0.98, 0.1, SQUARE_SIZE * 0.98);
  // Few, low-contrast rings: a square is only one board-square wide, so a
  // busy grain reads as stripes rather than as timber.
  const lightMat = wood(0xe6d9c0, 0xd8c8a8, { repeat: 1, roughness: 0.55, rings: 2 });
  const darkMat = wood(0x7d5230, 0x654024, { repeat: 1, roughness: 0.55, rings: 2 });
  for (let col = 0; col < 8; col++) {
    for (let row = 0; row < 8; row++) {
      const isLight = (col + row) % 2 === 0;
      const mesh = new THREE.Mesh(squareGeo, isLight ? lightMat : darkMat);
      mesh.position.set((col - 3.5) * SQUARE_SIZE, 0, (3.5 - row) * SQUARE_SIZE);
      // Vary each square's grain direction so neighbors don't tile identically.
      mesh.rotation.y = ((col * 3 + row * 5) % 4) * (Math.PI / 2);
      mesh.receiveShadow = true;
      mesh.userData.square = FILES[col] + (row + 1);
      squareMeshes[mesh.userData.square] = mesh;
      scene.add(mesh);
    }
  }

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(SQUARE_SIZE * 8 + 0.6, 0.16, SQUARE_SIZE * 8 + 0.6),
    wood(0x5e3a1f, 0x452a14, { repeat: 4, roughness: 0.5, rings: 3 })
  );
  frame.position.y = -0.06;
  frame.receiveShadow = true;
  frame.castShadow = true;
  scene.add(frame);

  // The desk the board sits on: a broad, dark leather-topped surface that
  // catches the board's shadow and fades into the room's fog. Without it the
  // board floats in a void, and floating is the least "real" thing an
  // object can do.
  const desk = new THREE.Mesh(
    new THREE.CylinderGeometry(15, 15, 0.3, 48),
    new THREE.MeshStandardMaterial({ color: 0x3b2a22, roughness: 0.85, metalness: 0.02, envMapIntensity: 0.4 })
  );
  desk.position.y = -0.29;
  desk.receiveShadow = true;
  scene.add(desk);

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
    // The stage is sized in CSS from the viewport (100vh) and from whatever
    // the Learning Mode cards leave beside it, so its size can change without
    // a window resize event -- and it may not have settled when the first
    // frame is drawn. Observe the container itself.
    this._resizeObserver = new ResizeObserver(this._onResize);
    this._resizeObserver.observe(this.container);
    requestAnimationFrame(this._animate);
    // Dev hook: lets a console (or a review script) reposition the camera.
    window.__tmgBoard = this;
  }

  // Frame a close review view of one rank -- `rank` 1 shows white's back
  // row from in front of it (the side the opponent sees).
  reviewRank(rank = 1, distance = 3.2, height = 1.6) {
    const z = 3.5 - (rank - 1);
    const facing = rank <= 4 ? -1 : 1;
    this.controls.target.set(0, 0.45, z);
    this.camera.position.set(0.6, height, z + facing * distance);
    this.controls.update();
  }

  _initScene() {
    const width = this.container.clientWidth || 480;
    const height = this.container.clientHeight || width;

    this.scene = new THREE.Scene();
    // A warm, dim room behind a board lit from above: the pieces read as
    // objects in a space, not cut-outs on the page colour. A touch of fog
    // lets the desk fade out instead of ending at a hard edge.
    this.scene.background = new THREE.Color(0x2a2420);
    this.scene.fog = new THREE.Fog(0x2a2420, 12, 26);

    this.camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    this._setDefaultCameraPose();

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.container.appendChild(this.renderer.domElement);
    this.renderer.domElement.addEventListener("click", this._onClick);

    // Metallic armor and gold trim need something to reflect; a neutral
    // room environment gives them highlights without any texture files.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 18;
    this.controls.target.set(0, 0.2, 0);

    // Three-point lighting: a warm key from high front-left casting the one
    // shadow, a cool fill from the opposite side, and a low rim light from
    // behind so silhouettes separate from the dark room.
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.22));
    const key = new THREE.DirectionalLight(0xfff1dc, 2.0);
    key.position.set(-4, 9, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    // Fit the shadow frustum to the board so the 2048 map isn't spent on
    // empty space, and bias away the acne that fine geometry otherwise gets.
    key.shadow.camera.left = key.shadow.camera.bottom = -6.5;
    key.shadow.camera.right = key.shadow.camera.top = 6.5;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 26;
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.02;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xcfdcff, 0.55);
    fill.position.set(5, 4, -2);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffd9a8, 0.7);
    rim.position.set(0, 2.5, -9);
    this.scene.add(rim);

    this.squareMeshes = buildBoard(this.scene);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
  }

  // Close and fairly low -- the view of someone sitting at the board, not a
  // ceiling camera. The far rank still fits; the near pieces fill the frame.
  _setDefaultCameraPose() {
    const z = this.orientation === "white" ? 8.2 : -8.2;
    this.camera.position.set(0, 6.4, z);
    this.camera.lookAt(0, 0.1, 0);
    if (this.controls) this.controls.target.set(0, 0.1, 0);
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
      const mesh = buildPieceMesh(piece.type, this.factions[piece.color], piece.color);
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

    // Recursive: a piece is a plinth plus a nested Group of unit geometry, and
    // a Group has nothing to hit. A non-recursive cast against the direct
    // children only ever found the plinth, so clicking a unit's body did
    // nothing -- the one interaction the whole board exists for.
    const pickables = [...Object.values(this.pieceMeshes), ...Object.values(this.squareMeshes)];
    const hits = this.raycaster.intersectObjects(pickables, true);
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

  // Selection tints every material's emissive channel, so remember what each
  // one had first -- a unit's own glow (an archangel's halo, a mage's orb)
  // has to survive being selected and deselected.
  _selectSquare(square) {
    this.selected = square;
    const mesh = this.pieceMeshes[square];
    if (!mesh) return;
    mesh.position.y = 0.26;
    mesh.traverse((obj) => {
      const mat = obj.material;
      if (mat && mat.emissive) {
        mat.userData.savedEmissive = mat.emissive.getHex();
        mat.userData.savedEmissiveIntensity = mat.emissiveIntensity;
        mat.emissive.setHex(COLORS.selectEmissive);
        mat.emissiveIntensity = 0.35;
      }
    });
  }

  _clearSelection() {
    if (this.selected && this.pieceMeshes[this.selected]) {
      const mesh = this.pieceMeshes[this.selected];
      mesh.position.y = 0.1;
      mesh.traverse((obj) => {
        const mat = obj.material;
        if (mat && mat.emissive && mat.userData.savedEmissive !== undefined) {
          mat.emissive.setHex(mat.userData.savedEmissive);
          mat.emissiveIntensity = mat.userData.savedEmissiveIntensity;
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
    if (this._resizeObserver) this._resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener("click", this._onClick);
    this.controls.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
