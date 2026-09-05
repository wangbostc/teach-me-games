// Loads board3d.js in Node with stubbed `three`/`three/addons/` (same
// technique as check_units.mjs) and exercises the pieces of it that don't
// need a real WebGL renderer or DOM: parseFenPlacement, the click-to-move
// promotion rule, and the incremental piece-mesh diff/rebuild (finding 2).
//
// _syncPieceMeshes is exercised through the REAL Board3D.prototype method
// (via Object.create(Board3D.prototype), not a live instance -- no
// renderer/canvas needed for that), so a regression that reintroduces a
// full rebuild on every move fails this check even though nothing here
// ever calls `new Board3D(...)`.
//
// Driven by tests/web/test_board3d_js.py. Stand-alone:
//   node tests/web/check_board3d.mjs src/tmg/web/static
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";

const STATIC = resolvePath(process.argv[2] || "src/tmg/web/static");

// The same minimal geometric `three` stub check_units.mjs uses to prove unit
// builders produce finite numbers -- reused here because building a real
// piece mesh (in the _syncPieceMeshes checks below) runs the exact same
// faction builder code check_units.mjs already exercises. CanvasTexture
// additionally needs a dispose() here: Board3D no longer exists without one
// (finding 1's disposeTextureCache), even though this file never calls it.
const THREE_STUB = `
class Vector2 { constructor(x=0,y=0){this.x=x;this.y=y;} set(x,y){this.x=x;this.y=y;return this;} }
class Vector3 {
  constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  clone(){return new Vector3(this.x,this.y,this.z);}
  add(v){this.x+=v.x;this.y+=v.y;this.z+=v.z;return this;}
  addScaledVector(v,s){this.x+=v.x*s;this.y+=v.y*s;this.z+=v.z*s;return this;}
  multiplyScalar(s){this.x*=s;this.y*=s;this.z*=s;return this;}
  setScalar(s){this.x=this.y=this.z=s;return this;}
  toArray(){return [this.x,this.y,this.z];}
  lerp(v,t){this.x+=(v.x-this.x)*t;this.y+=(v.y-this.y)*t;this.z+=(v.z-this.z)*t;return this;}
  project(){return this;} lookAt(){return this;}
}
class Euler { constructor(){this.x=0;this.y=0;this.z=0;this.order="XYZ";} set(x,y,z){this.x=x;this.y=y;this.z=z;return this;} }
class Color {
  constructor(c){ if (typeof c==="number"){this.r=((c>>16)&255)/255;this.g=((c>>8)&255)/255;this.b=(c&255)/255;} else {this.r=this.g=this.b=1;} }
  lerp(c,t){this.r+=(c.r-this.r)*t;this.g+=(c.g-this.g)*t;this.b+=(c.b-this.b)*t;return this;}
  clone(){const c=new Color(0);c.r=this.r;c.g=this.g;c.b=this.b;return c;}
  getHex(){return (Math.round(this.r*255)<<16)|(Math.round(this.g*255)<<8)|Math.round(this.b*255);}
  setHex(){return this;}
}
class Object3D {
  constructor(){this.position=new Vector3();this.rotation=new Euler();this.scale=new Vector3(1,1,1);this.children=[];this.parent=null;this.userData={};}
  add(...cs){for(const c of cs){c.parent=this;this.children.push(c);}return this;}
  remove(c){this.children=this.children.filter(x=>x!==c);return this;}
  traverse(fn){fn(this);for(const c of this.children)c.traverse(fn);}
  lookAt(){return this;} rotateX(){return this;}
}
class Group extends Object3D { constructor(){super();this.type="Group";} }
class Mesh extends Object3D {
  constructor(geometry,material){super();this.isMesh=true;this.type="Mesh";this.geometry=geometry;this.material=material;this.castShadow=false;this.receiveShadow=false;}
}
class Geo { constructor(...a){this.type=new.target.name;this.args=a;this.r=Math.max(0.02,...a.filter(v=>typeof v==="number"&&isFinite(v)).slice(0,3).map(Math.abs));this.attributes={position:{count:0}};} dispose(){} }
class Mat { constructor(p={}){Object.assign(this,p);this.emissive=new Color(0);this.userData={};} dispose(){} }
class Shape { moveTo(){return this;} lineTo(){return this;} quadraticCurveTo(){return this;} closePath(){return this;} }
class CatmullRomCurve3 { constructor(pts){this.pts=pts;} getPointAt(t){const i=Math.min(this.pts.length-1,Math.floor(t*(this.pts.length-1)));return this.pts[i].clone();} getTangentAt(){return new Vector3(0,0,1);} }
class Box3 {
  constructor(){this.min=new Vector3(Infinity,Infinity,Infinity);this.max=new Vector3(-Infinity,-Infinity,-Infinity);}
  setFromObject(obj){
    const walk=(o,px,py,pz,s)=>{
      const x=px+o.position.x*s, y=py+o.position.y*s, z=pz+o.position.z*s;
      const ns=s*o.scale.x;
      if(o.isMesh){const r=(o.geometry&&o.geometry.r||0.02)*ns;
        for(const [a,v] of [["x",x],["y",y],["z",z]]){this.min[a]=Math.min(this.min[a],v-r);this.max[a]=Math.max(this.max[a],v+r);}}
      for(const c of o.children)walk(c,x,y,z,ns);
    };
    walk(obj,0,0,0,1);return this;
  }
  getCenter(t){t.set((this.min.x+this.max.x)/2,(this.min.y+this.max.y)/2,(this.min.z+this.max.z)/2);return t;}
}
class CanvasTexture { constructor(){this.repeat=new Vector2(1,1);} dispose(){} }
export { Vector2, Vector3, Color, Group, Mesh, Shape, Box3, CatmullRomCurve3, CanvasTexture, Mat as MeshStandardMaterial, Mat as MeshPhysicalMaterial };
export class BoxGeometry extends Geo {}
export class SphereGeometry extends Geo {}
export class CylinderGeometry extends Geo {}
export class ConeGeometry extends Geo {}
export class TorusGeometry extends Geo {}
export class CapsuleGeometry extends Geo {}
export class LatheGeometry extends Geo {}
export class ExtrudeGeometry extends Geo {}
export class ShapeGeometry extends Geo {}
export class IcosahedronGeometry extends Geo {}
export class DodecahedronGeometry extends Geo {}
export class TetrahedronGeometry extends Geo {}
export class OctahedronGeometry extends Geo {}
export class TubeGeometry extends Geo {}
export const RepeatWrapping=1, SRGBColorSpace=1, DoubleSide=2;
`;

// board3d.js imports OrbitControls/RoomEnvironment by bare specifier through
// the "three/addons/" importmap entry (finding 4) -- neither is ever
// constructed here (no _initScene call), so the stub only needs to resolve.
const ADDONS_STUB = `
export class OrbitControls { constructor(){} dispose(){} }
export class RoomEnvironment { constructor(){} }
`;

register("data:text/javascript," + encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    if (spec === "three") return { url: "three:stub", shortCircuit: true };
    if (spec.startsWith("three/addons/")) return { url: "three-addons:stub", shortCircuit: true };
    if (spec.startsWith("/static/")) return { url: "file://${STATIC}" + spec.slice(7), shortCircuit: true };
    return next(spec, ctx);
  }
  export async function load(url, ctx, next) {
    if (url === "three:stub") return { format: "module", source: ${JSON.stringify(THREE_STUB)}, shortCircuit: true };
    if (url === "three-addons:stub") return { format: "module", source: ${JSON.stringify(ADDONS_STUB)}, shortCircuit: true };
    return next(url, ctx);
  }
`));

// The browser-only canvas API used by materials.js (exercised for real when
// _syncPieceMeshes below actually builds a piece's plinth/unit materials).
globalThis.document = {
  createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData() {}, fillRect() {}, save() {}, restore() {}, translate() {}, beginPath() {}, arc() {}, fill() {},
      moveTo() {}, lineTo() {}, stroke() {}, createRadialGradient: () => ({ addColorStop() {} }),
      set fillStyle(v) {}, set strokeStyle(v) {}, set lineWidth(v) {},
    }),
  }),
};

const { Board3D, parseFenPlacement, buildMoveUci, diffOccupiedSquares } = await import(
  pathToFileURL(STATIC + "/board3d.js").href
);

let problems = 0;
function check(label, ok) {
  if (ok) {
    console.log(`OK   ${label}`);
  } else {
    problems++;
    console.log(`FAIL ${label}`);
  }
}
function checkThrows(label, fn) {
  try {
    fn();
    check(label, false);
  } catch {
    check(label, true);
  }
}

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const AFTER_E4_FEN = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
// 1. e4 e5 2. Nf3 Nc6 3. Bb5 -- a genuinely mid-game FEN, several plies in
// with pieces developed on both sides, distinct from AFTER_E4_FEN's single
// move above.
const RUY_LOPEZ_FEN = "r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3";

// -- parseFenPlacement: start position -------------------------------------
const start = parseFenPlacement(START_FEN);
check("start position has all 32 pieces", Object.keys(start).length === 32);
check("start a1 is a white rook", start.a1?.type === "r" && start.a1?.color === "w");
check("start e1 is a white king", start.e1?.type === "k" && start.e1?.color === "w");
check("start e8 is a black king", start.e8?.type === "k" && start.e8?.color === "b");
check("start a8 is a black rook", start.a8?.type === "r" && start.a8?.color === "b");
check("start e2 is a white pawn", start.e2?.type === "p" && start.e2?.color === "w");
check("start e7 is a black pawn", start.e7?.type === "p" && start.e7?.color === "b");
check("start e4 is empty", start.e4 === undefined);

// -- parseFenPlacement: a mid-game FEN -------------------------------------
const ruyLopez = parseFenPlacement(RUY_LOPEZ_FEN);
check("mid-game has all 32 pieces (no captures yet)", Object.keys(ruyLopez).length === 32);
check("mid-game b5 is a white bishop", ruyLopez.b5?.type === "b" && ruyLopez.b5?.color === "w");
check("mid-game c6 is a black knight", ruyLopez.c6?.type === "n" && ruyLopez.c6?.color === "b");
check("mid-game f3 is a white knight", ruyLopez.f3?.type === "n" && ruyLopez.f3?.color === "w");
check("mid-game e4 is a white pawn", ruyLopez.e4?.type === "p" && ruyLopez.e4?.color === "w");
check("mid-game e5 is a black pawn", ruyLopez.e5?.type === "p" && ruyLopez.e5?.color === "b");
check("mid-game e2 and e7 are empty (both pawns already advanced)", ruyLopez.e2 === undefined && ruyLopez.e7 === undefined);
check("mid-game f1 and g1 are empty (bishop and knight developed)", ruyLopez.f1 === undefined && ruyLopez.g1 === undefined);

// -- parseFenPlacement: bounded and validated (finding 10) -----------------
checkThrows("a rank overflowing past the h-file throws", () =>
  parseFenPlacement("pppppppp1/8/8/8/8/8/8/8 w - - 0 1")
);
checkThrows("a rank with a non-piece, non-digit character throws", () =>
  parseFenPlacement("8/8/8/8/8/8/8/pppppppz w - - 0 1")
);
checkThrows("a rank covering fewer than 8 squares throws", () =>
  parseFenPlacement("7/8/8/8/8/8/8/8 w - - 0 1")
);
checkThrows("fewer than 8 ranks throws", () => parseFenPlacement("8/8/8/8/8/8/8 w - - 0 1"));

// -- buildMoveUci: the promotion suffix rule -------------------------------
check("a white pawn reaching the 8th rank promotes to queen", buildMoveUci("e7", "e8", "p") === "e7e8q");
check("a black pawn reaching the 1st rank promotes to queen", buildMoveUci("e2", "e1", "p") === "e2e1q");
check("a pawn NOT reaching the back rank does not promote", buildMoveUci("e2", "e4", "p") === "e2e4");
check("a non-pawn reaching the back rank does not promote", buildMoveUci("e1", "e8", "q") === "e1e8");

// -- diffOccupiedSquares: the diff _syncPieceMeshes rebuilds from ----------
const startAgain = parseFenPlacement(START_FEN); // a fresh object, same content
check("the same position diffs to nothing", diffOccupiedSquares(start, startAgain).length === 0);

const afterE4 = parseFenPlacement(AFTER_E4_FEN);
const moveDiff = diffOccupiedSquares(start, afterE4).slice().sort();
check(
  "one move diffs to exactly its two squares",
  moveDiff.length === 2 && moveDiff[0] === "e2" && moveDiff[1] === "e4"
);

// -- _syncPieceMeshes: exercised through the real Board3D.prototype method,
// not a reimplementation, so a regression back to a full rebuild on every
// move (finding 2) fails this even though nothing here calls `new Board3D`.
const fake = Object.create(Board3D.prototype);
fake.scene = { add() {}, remove() {} };
fake.factions = { w: "castle", b: "stronghold" };
fake.pieceMeshes = {};
fake._lastSyncedState = {};
fake.boardState = parseFenPlacement(START_FEN);
fake._syncPieceMeshes();
check("first sync builds all 32 piece meshes", Object.keys(fake.pieceMeshes).length === 32);

const meshesAfterFirstSync = { ...fake.pieceMeshes };
fake.boardState = parseFenPlacement(AFTER_E4_FEN);
fake._syncPieceMeshes();
check("after one move, e2's mesh is gone", fake.pieceMeshes.e2 === undefined);
check(
  "after one move, e4 has a newly built mesh (not e2's old one)",
  fake.pieceMeshes.e4 !== undefined && fake.pieceMeshes.e4 !== meshesAfterFirstSync.e2
);
const untouchedSquares = Object.keys(meshesAfterFirstSync).filter((sq) => sq !== "e2");

check(
  // e4 was empty before the move, so it was never a key in
  // meshesAfterFirstSync -- excluding only "e2" (the square that just
  // emptied) leaves the other 31 pre-existing meshes, every one of which
  // must be the exact same object post-move, not rebuilt.
  "every one of the other 31 pre-existing meshes is the SAME object -- not rebuilt",
  untouchedSquares.length === 31 &&
    untouchedSquares.every((sq) => fake.pieceMeshes[sq] === meshesAfterFirstSync[sq])
);
check("still exactly 32 pieces after the move", Object.keys(fake.pieceMeshes).length === 32);

const meshesAfterMove = { ...fake.pieceMeshes };
fake.boardState = parseFenPlacement(AFTER_E4_FEN); // a fresh object, same position again
fake._syncPieceMeshes();
check(
  "re-syncing the identical position rebuilds nothing at all",
  Object.keys(meshesAfterMove).every((sq) => fake.pieceMeshes[sq] === meshesAfterMove[sq])
);

console.log(problems ? `${problems} problem(s)` : "all board3d.js checks OK");
process.exit(problems ? 1 : 0);
