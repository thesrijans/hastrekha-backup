/**
 * The hologram: the real hand (P1), a column of warm light, three brass rings.
 *
 * Amendment 1's rendering, line by line: "faint additive volume,
 * Fresnel-brightened silhouette, gold tint, slow ±8° rotation, three thin brass
 * rings orbiting at different tilts." And [A2]: "No lines on the palm — it is a
 * symbol, not a reading." So the hand's material has no texture at all; it is
 * light, brightest where the surface turns away from the eye.
 *
 * GOLD, NOT CYAN. The reference renders its hologram cyan. Amendment 4 says
 * "no cyan" and Amendment 1 says "gold tint", and the amendments are the
 * brief, so the reference is followed for composition and overruled on colour.
 *
 * PALM-FORWARD IS DERIVED, NOT BAKED. The mesh keeps MakeHuman's axes (P1),
 * and hand.landmarks.json travels with it in the same frame. The palm frame is
 * built from those landmarks: the fingers' direction, the knuckle line across,
 * and the palm's normal. Which SIDE of the palm plane is the palm cannot be
 * read from the axes alone — a cross product picks one arbitrarily — so it is
 * settled by the thumb: an opposing thumb's tip sits on the palm side (P1
 * measured it 3.8x further off the palm plane than the index), so the normal
 * that points toward the thumb tip is the one turned to face the viewer.
 */
import {
  AdditiveBlending,
  Box3,
  Color,
  CylinderGeometry,
  FrontSide,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  ShaderMaterial,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Object3D,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { RoomLayout } from "./layout";
import { GOLD_400, GOLD_500, GOLD_600 } from "./palette";
import { BLOOM_LAYER } from "./post";
import type { Built } from "./props";

export const HAND_MODEL_URL = "/models/hand.glb";
export const HAND_LANDMARKS_URL = "/models/hand.landmarks.json";

/** Amendment 1: "slow ±8° rotation". */
export const HAND_SWAY_DEG = 8;
/** One full sway every 14 s — slow enough to read as breathing, not as spinning. */
const HAND_SWAY_PERIOD_S = 14;

/** The base ring's emission — bright enough to bloom by itself (see post.ts BLOOM_THRESHOLD). */
export const RING_GLOW = 4.5;

/** The hand fills this fraction of the column's height. */
const HAND_FILL = 0.62;

interface Landmarks {
  readonly wrist: readonly number[];
  readonly fingers: readonly (readonly (readonly number[])[])[];
}

const THUMB = 0;
const INDEX = 1;
const LITTLE = 4;

const v = (p: readonly number[]): Vector3 => new Vector3(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0);

/**
 * The rotation that turns the mesh palm-forward, fingers up, thumb on the
 * viewer's right — the orientation tradition-hand.ts draws and the reference
 * shows: a right hand, palm toward the viewer.
 */
export function palmForwardRotation(marks: Landmarks): Matrix4 {
  const wrist = v(marks.wrist);
  const mcp = [INDEX, 2, 3, LITTLE].map((f) => v(marks.fingers[f]?.[0] ?? [0, 0, 0]));
  const knuckles = mcp.reduce((sum, p) => sum.add(p), new Vector3()).multiplyScalar(1 / mcp.length);

  const fingers = knuckles.clone().sub(wrist).normalize();
  const across = mcp[0]!.clone().sub(mcp[3]!);
  let palm = new Vector3().crossVectors(fingers, across).normalize();

  // Settle which side is the palm by where the opposing thumb's tip sits.
  const thumbTip = v(marks.fingers[THUMB]?.[3] ?? [0, 0, 0]).sub(wrist);
  if (thumbTip.dot(palm) < 0) palm = palm.negate();

  // Target: fingers -> +Y, palm -> +Z (toward the camera), X completes it.
  const side = new Vector3().crossVectors(fingers, palm).normalize();
  const recomputedPalm = new Vector3().crossVectors(side, fingers).normalize();
  const basis = new Matrix4().makeBasis(side, fingers, recomputedPalm);
  // makeBasis maps world axes onto (side, fingers, palm); invert to map the
  // hand's own axes onto world axes.
  return basis.invert();
}

/** A warm, faint volume whose silhouette brightens — Fresnel, not a texture. */
function hologramMaterial(strength: number): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: FrontSide,
    uniforms: {
      uColour: { value: new Color(GOLD_400) },
      uRim: { value: new Color(GOLD_500) },
      uStrength: { value: strength },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vNormal = normalize(mat3(modelMatrix) * normal);
        vView = normalize(cameraPosition - world.xyz);
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColour; uniform vec3 uRim; uniform float uStrength; uniform float uTime;
      varying vec3 vNormal; varying vec3 vView;
      void main() {
        float facing = abs(dot(normalize(vNormal), normalize(vView)));
        float fresnel = pow(1.0 - facing, 2.4);
        // A faint body, a bright edge: light gathering where the surface turns.
        float body = 0.07;
        float breathe = 0.92 + 0.08 * sin(uTime * 0.9);
        vec3 colour = mix(uColour * body, uRim * 1.6, fresnel) * breathe;
        gl_FragColor = vec4(colour * uStrength, (body + fresnel) * uStrength);
      }`,
  });
}

export interface BuiltHologram extends Built {
  /** Resolves once the hand has loaded; the room renders without it until then. */
  readonly ready: Promise<void>;
}

export function buildHologram(layout: RoomLayout): BuiltHologram {
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  const group = new Group();
  group.name = "hologram";
  const { base, height } = layout.hologram;
  group.position.copy(base);
  const radius = layout.pedestal.radius * 0.42;

  // The column: an open cylinder of warm light rising from the drum.
  const columnMaterial = keep(hologramMaterial(0.55));
  const column = new Mesh(keep(new CylinderGeometry(radius, radius, height, 64, 1, true)), columnMaterial);
  // Named for the scorer: the column is one of the subjects the moonlight cap is measured on.
  column.name = "column";
  column.position.y = height / 2;
  group.add(column);

  // The canopy ring the column hangs from, and the base ring it rises out of.
  const brass = keep(
    new MeshStandardMaterial({ color: GOLD_500, metalness: 0.9, roughness: 0.34, emissive: new Color(GOLD_600), emissiveIntensity: 0.25 }),
  );
  // The canopy is brass, lit like the drum.
  const canopy = new Mesh(keep(new TorusGeometry(radius * 1.02, 0.018, 10, 72)), brass);
  canopy.rotation.x = Math.PI / 2;
  canopy.position.y = height;
  group.add(canopy);

  // The base is a RING OF LIGHT — the reference's glowing ring where the
  // hologram rises from the drum, and "the ring" Amendment 2 lets bloom.
  //
  // ITERATION 3. It was brass, lit by the key, so it could only bloom by
  // specular reflection — which meant the brass drum beside it, lit by the same
  // key, bloomed too (the four beads of highlight down the drum's front). A
  // bloom threshold cannot tell two pieces of the same brass apart. Made
  // emissive, the ring is bright in its own right, well above a threshold that
  // reflected brass stays under.
  const glow = keep(
    new MeshStandardMaterial({ color: GOLD_400, metalness: 0, roughness: 0.4, emissive: new Color(GOLD_400), emissiveIntensity: RING_GLOW }),
  );
  const baseRing = new Mesh(keep(new TorusGeometry(radius * 1.02, 0.018, 10, 72)), glow);
  baseRing.name = "ring";
  // "The ring" of "candles and the ring only" (Amendment 2): on the bloom layer.
  baseRing.layers.enable(BLOOM_LAYER);
  baseRing.rotation.x = Math.PI / 2;
  baseRing.position.y = 0.02;
  group.add(baseRing);

  // Three thin brass rings orbiting at different tilts — two round the wrist,
  // one above the fingertips, NEVER across the palm.
  //
  // ITERATION 2, two fixes in one place:
  //
  //  · [A2] "No lines on the palm." Iteration 1 hung all three at 36-52% of the
  //    column's height, which is exactly where the palm is (the hand spans about
  //    16% to 78%, the palm its lower half), and the scorer found 110 ring
  //    pixels over 871 palm pixels — 12.6%, read by any viewer as lines drawn on
  //    the hand. The reference hangs its rings at the base and the canopy.
  //  · They did not orbit. Each spun about its own axis, and a torus is the same
  //    shape at every such angle, so the spin was invisible and the rings were
  //    static. The tilt now PRECESSES about the vertical (Euler order YXZ), so
  //    each ring's high point travels round the hand. Precession does not change
  //    a ring's vertical reach (r sin tilt), so the palm stays clear at every
  //    moment, not only at the instant a capture happens to take.
  const orbits: { mesh: Mesh; tilt: number; speed: number; phase: number }[] = [];
  const orbitSpecs = [
    { r: radius * 0.86, tilt: 0.15, speed: 0.19, phase: 0.0, y: height * 0.09 },
    { r: radius * 0.9, tilt: -0.21, speed: -0.13, phase: 1.9, y: height * 0.05 },
    { r: radius * 0.82, tilt: 0.3, speed: 0.09, phase: 3.7, y: height * 0.88 },
  ];
  for (const spec of orbitSpecs) {
    const mesh = new Mesh(keep(new TorusGeometry(spec.r, 0.006, 6, 96)), brass);
    mesh.name = "orbit";
    mesh.position.y = spec.y;
    mesh.rotation.order = "YXZ";
    group.add(mesh);
    orbits.push({ mesh, tilt: spec.tilt, speed: spec.speed, phase: spec.phase });
  }

  // The hand itself, loaded by this chunk and only this chunk.
  const handHolder = new Group();
  handHolder.name = "hand";
  handHolder.position.y = height * 0.47;
  group.add(handHolder);
  const handMaterial = keep(hologramMaterial(1));

  const ready = (async () => {
    const [gltf, marks] = await Promise.all([
      new GLTFLoader().loadAsync(HAND_MODEL_URL),
      fetch(HAND_LANDMARKS_URL).then((response) => response.json() as Promise<Landmarks>),
    ]);

    const hand: Object3D = gltf.scene;
    hand.traverse((node) => {
      if (node instanceof Mesh) {
        (node.geometry as BufferGeometry).computeVertexNormals();
        node.material = handMaterial;
        disposables.push(node.geometry as BufferGeometry);
      }
    });

    const oriented = new Group();
    oriented.add(hand);
    oriented.applyMatrix4(palmForwardRotation(marks));

    // Fit to the column, centred.
    const box = new Box3().setFromObject(oriented);
    const size = box.getSize(new Vector3());
    const scale = (height * HAND_FILL) / Math.max(size.y, 1e-6);
    oriented.scale.setScalar(scale);
    const centred = new Box3().setFromObject(oriented).getCenter(new Vector3());
    oriented.position.sub(centred);

    handHolder.add(oriented);
  })();

  return {
    object: group,
    ready,
    tick: (seconds) => {
      const sway = (HAND_SWAY_DEG * Math.PI) / 180;
      handHolder.rotation.y = Math.sin((seconds / HAND_SWAY_PERIOD_S) * Math.PI * 2) * sway;
      columnMaterial.uniforms.uTime!.value = seconds;
      handMaterial.uniforms.uTime!.value = seconds;
      for (const orbit of orbits) {
        // Tilt about X, then carry that tilt round the vertical: a precession.
        orbit.mesh.rotation.set(Math.PI / 2 + orbit.tilt, seconds * orbit.speed + orbit.phase, 0);
      }
    },
    dispose: () => {
      for (const item of disposables) item.dispose();
      disposables.length = 0;
    },
  };
}
