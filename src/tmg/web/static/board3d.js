// A procedurally-built 3D chess board -- no model files, no textures, so no
// asset licensing to track and nothing to fail to load. Every piece is a
// stack of primitive geometry (cylinders, cones, spheres, boxes) tinted from
// the same palette as the rest of the page.
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
  whitePiece: 0xf3ead8,
  blackPiece: 0x2a211a,
  selectEmissive: 0xb08d3e,
};

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

function pieceBodyHeight(type) {
  return { p: 0.42, n: 0.56, b: 0.62, r: 0.5, q: 0.72, k: 0.8 }[type];
}

// Each builder stacks primitives on a shared base; the silhouette (a lifted
// head for the knight, a mitre for the bishop, a crowned sphere for the
// queen, a cross for the king) is what makes the type readable from a
// distance without a single texture or imported model.
function buildPieceMesh(type, color) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: color === "w" ? COLORS.whitePiece : COLORS.blackPiece,
    roughness: 0.55,
    metalness: 0.06,
  });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.1, 24), material);
  base.position.y = 0.05;
  group.add(base);

  const h = pieceBodyHeight(type);
  const stemTop = 0.1 + h;

  switch (type) {
    case "p": {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.19, h, 16), material);
      stem.position.y = 0.1 + h / 2;
      group.add(stem);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), material);
      head.position.y = stemTop + 0.1;
      group.add(head);
      break;
    }
    case "r": {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.25, h, 16), material);
      stem.position.y = 0.1 + h / 2;
      group.add(stem);
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.22, 0.13, 8), material);
      crown.position.y = stemTop + 0.06;
      group.add(crown);
      break;
    }
    case "n": {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.25, h * 0.75, 16), material);
      stem.position.y = 0.1 + (h * 0.75) / 2;
      group.add(stem);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.32, 0.4), material);
      head.position.set(0, 0.1 + h * 0.75 + 0.16, 0.05);
      head.rotation.x = -0.4;
      group.add(head);
      break;
    }
    case "b": {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.23, h * 0.7, 16), material);
      stem.position.y = 0.1 + (h * 0.7) / 2;
      group.add(stem);
      const mitre = new THREE.Mesh(new THREE.ConeGeometry(0.18, h * 0.4, 16), material);
      mitre.position.y = 0.1 + h * 0.7 + (h * 0.4) / 2;
      group.add(mitre);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), material);
      tip.position.y = 0.1 + h + 0.04;
      group.add(tip);
      break;
    }
    case "q": {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.27, h * 0.78, 16), material);
      stem.position.y = 0.1 + (h * 0.78) / 2;
      group.add(stem);
      const crown = new THREE.Mesh(new THREE.SphereGeometry(0.21, 16, 12), material);
      crown.position.y = 0.1 + h * 0.78 + 0.13;
      crown.scale.y = 0.72;
      group.add(crown);
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), material);
      orb.position.y = 0.1 + h * 0.78 + 0.3;
      group.add(orb);
      break;
    }
    case "k": {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, h * 0.82, 16), material);
      stem.position.y = 0.1 + (h * 0.82) / 2;
      group.add(stem);
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.19, 0.15, 16), material);
      crown.position.y = 0.1 + h * 0.82 + 0.075;
      group.add(crown);
      const crossBase = 0.1 + h * 0.82 + 0.15;
      const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.05), material);
      crossV.position.y = crossBase + 0.1;
      group.add(crossV);
      const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.05), material);
      crossH.position.y = crossBase + 0.15;
      group.add(crossH);
      break;
    }
    default:
      break;
  }

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
  constructor(container, { orientation = "white", onMove = () => {} } = {}) {
    this.container = container;
    this.orientation = orientation;
    this.onMove = onMove;
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
      const mesh = buildPieceMesh(piece.type, piece.color);
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
