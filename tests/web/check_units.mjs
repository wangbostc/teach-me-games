// Load every faction module in Node with a stubbed `three`, then build,
// scale and place all 54 units. Exits non-zero if any module fails to load
// or any unit ends up with non-finite geometry.
//
// Two real bugs motivated this, both invisible to `node --check`:
//   * a helper named `boot` shadowed the `boot` material parameter, which is
//     a module-load error, and broke every army at once;
//   * a caller read a field the dragon body plan no longer returned, so one
//     unit's tail cone was placed at NaN, its bounding box became NaN, and
//     fitToRole's grounding offset made the whole piece silently vanish.
//
// Driven by tests/web/test_units_js.py. Stand-alone:
//   node tests/web/check_units.mjs src/tmg/web/static
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { readdirSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

const STATIC = resolvePath(process.argv[2] || "src/tmg/web/static");
const ROLES = ["p", "n", "b", "r", "q", "k"];

const GEOMETRIES = ["BoxGeometry", "SphereGeometry", "CylinderGeometry", "ConeGeometry", "TorusGeometry", "CapsuleGeometry", "LatheGeometry", "ExtrudeGeometry", "ShapeGeometry", "IcosahedronGeometry", "DodecahedronGeometry", "TetrahedronGeometry", "OctahedronGeometry", "TubeGeometry"];

// A minimal geometric `three`: enough of Vector/Box/Group/Mesh to compute a
// real bounding box from the positions and scales the builders set, with
// every geometry/material/texture constructor a no-op. This is NOT a render
// -- it's a check that the numbers the builders produce are numbers.
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
// Every geometry records a rough radius so a bounding box has extent.
class Geo { constructor(...a){this.type=new.target.name;this.args=a;this.r=Math.max(0.02,...a.filter(v=>typeof v==="number"&&isFinite(v)).slice(0,3).map(Math.abs));this.attributes={position:{count:0}};} dispose(){} }
class Mat { constructor(p={}){Object.assign(this,p);this.emissive=new Color(0);this.userData={};} dispose(){} }
class Shape { moveTo(){return this;} lineTo(){return this;} quadraticCurveTo(){return this;} closePath(){return this;} }
class CatmullRomCurve3 { constructor(pts){this.pts=pts;} getPointAt(t){const i=Math.min(this.pts.length-1,Math.floor(t*(this.pts.length-1)));return this.pts[i].clone();} getTangentAt(){return new Vector3(0,0,1);} }
// A Box3 that walks the tree with the same position/scale math the real one
// uses (rotation ignored; radii are conservative), so NaN anywhere propagates.
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
class CanvasTexture { constructor(){this.repeat=new Vector2(1,1);} }
export { Vector2, Vector3, Color, Group, Mesh, Shape, Box3, CatmullRomCurve3, CanvasTexture, Mat as MeshStandardMaterial, Mat as MeshPhysicalMaterial };
${GEOMETRIES.map((g) => `export class ${g} extends Geo {}`).join("\n")}
export const RepeatWrapping=1, SRGBColorSpace=1, DoubleSide=2;
`;

register("data:text/javascript," + encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    if (spec === "three") return { url: "three:stub", shortCircuit: true };
    if (spec.startsWith("/static/")) return { url: "file://${STATIC}" + spec.slice(7), shortCircuit: true };
    return next(spec, ctx);
  }
  export async function load(url, ctx, next) {
    if (url === "three:stub") return { format: "module", source: ${JSON.stringify(THREE_STUB)}, shortCircuit: true };
    return next(url, ctx);
  }
`));

// The browser-only canvas API used by materials.js: make document.createElement
// return a canvas that yields plain arrays.
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

const dir = STATIC + "/units";
const files = readdirSync(dir).filter((n) => n.endsWith(".js") && !["common.js", "materials.js"].includes(n)).sort();
const { fitToRole } = await import(pathToFileURL(dir + "/common.js").href);
const THREE = await import("three");

let problems = 0;
for (const f of files) {
  let mod;
  try {
    mod = await import(pathToFileURL(dir + "/" + f).href);
  } catch (e) {
    problems++;
    console.log(`FAIL ${f}: module failed to load -> ${e.message}`);
    continue;
  }
  for (const role of ROLES) {
    const unitKey = mod.UNITS[role];
    try {
      const built = mod.buildUnit(unitKey);
      fitToRole(built, role);
      const box = new THREE.Box3().setFromObject(built.group);
      const vals = [...box.min.toArray(), ...box.max.toArray(), built.group.position.y, built.group.scale.x, built.height];
      if (!vals.every(Number.isFinite)) {
        problems++;
        console.log(`FAIL ${f} ${unitKey} (${role}): non-finite geometry -- this piece would vanish from the board`);
      }
    } catch (e) {
      problems++;
      console.log(`FAIL ${f} ${unitKey} (${role}): builder threw -> ${e.message}`);
    }
  }
  if (!problems) console.log(`OK   ${f}`);
}
console.log(problems ? `${problems} problem(s)` : `all ${files.length * ROLES.length} units OK`);
process.exit(problems ? 1 : 0);
