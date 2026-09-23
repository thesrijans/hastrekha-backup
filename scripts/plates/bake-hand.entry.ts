/**
 * The browser half of scripts/plates/bake-hand.mjs.
 *
 * Bundled by esbuild (so it can reach the room's own modules and Three.js) and
 * run once in headless Chromium on the real GPU. It renders the P1 hand
 * (public/models/hand.glb) three ways and hands each back as a PNG data URL on
 * `window.__bake`; the Node side encodes them into plates.
 *
 *   hologram   the SCENE's own hand: world.ts built as the room builds it,
 *              everything but the hand hidden, the resting pose (tick(0), so
 *              the ±8° sway is at zero), drawn through the room's camera cut to
 *              HOLOGRAM_HAND_REGION. What the 3D room shows at rest, so the
 *              CSS plate and the live scene agree at the crossfade.
 *   plate      the Pothi's and the Rekha Monitor's hand: the mesh palm-forward
 *              under an engraved-gold material, MIRRORED (thumb on the left, as
 *              the rectified crop frames it) and warped by a homography so its
 *              four joints land on lib/scan/rectify.ts CANONICAL_ANCHORS — the
 *              same registration the rectifier gives a real palm.
 *   tradition  the tradition's palm: the same material, thumb on the right,
 *              fitted by an affine so its wrist and two outer knuckles land on
 *              TRADITION_HAND_LANDMARKS, the points the classical lines were
 *              drawn against.
 */
import {
  ACESFilmicToneMapping,
  Box3,
  Color,
  Group,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix3,
  Mesh,
  NoBlending,
  NoToneMapping,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
  type BufferGeometry,
  type Object3D,
  type PerspectiveCamera,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { HAND_LANDMARKS_URL, HAND_MODEL_URL, palmForwardRotation } from "@/components/sanctuary/room/three/hologram";
import { GOLD_400, GOLD_500, GOLD_600 } from "@/components/sanctuary/room/three/palette";
import { applyHorizon, CAMERA_SANCTUARY, worldToStage } from "@/components/sanctuary/room/three/stage-projection";
import { buildWorld } from "@/components/sanctuary/room/three/world";
import { HOLOGRAM_HAND_REGION } from "@/lib/sanctuary/room-composition";
import { TRADITION_HAND_LANDMARKS, TRADITION_HAND_PLATE_BOX } from "@/lib/sanctuary/tradition-hand";
import { CANONICAL_ANCHORS, solveHomography } from "@/lib/scan/rectify";
import type { Point2 } from "@/lib/scan/types";

interface Landmarks {
  readonly wrist: readonly number[];
  readonly fingers: readonly (readonly (readonly number[])[])[];
}

interface Region {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface BakeResult {
  readonly png: string;
  readonly width: number;
  readonly height: number;
  readonly registration: Record<string, unknown>;
}

const v = (p: readonly number[]): Vector3 => new Vector3(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0);

/* ------------------------------------------------------------------------ */
/* THE SCENE'S CAMERA, CUT TO A WINDOW                                        */
/* ------------------------------------------------------------------------ */

/**
 * The room's camera cut to one stage rectangle — stage-projection.ts
 * applyHorizon's window, the same cut the phone profile renders through — so
 * the rectangle renders at any resolution as exactly the pixels it occupies
 * in the full frame. Nothing here is a fit: a stage point projects to the
 * same place through both cameras, and the bake checks.
 */
function regionCamera(full: PerspectiveCamera, region: Region): PerspectiveCamera {
  const camera = full.clone();
  applyHorizon(camera, CAMERA_SANCTUARY.horizon, region);
  return camera;
}

/** Where a world point lands in a region camera's frame, in stage units. */
function throughRegion(camera: PerspectiveCamera, region: Region, point: Vector3): { x: number; y: number } {
  const ndc = point.clone().project(camera);
  return { x: region.x + ((ndc.x + 1) / 2) * region.w, y: region.y + ((1 - ndc.y) / 2) * region.h };
}

function isUnder(node: Object3D, ancestor: Object3D): boolean {
  let cursor: Object3D | null = node;
  while (cursor !== null) {
    if (cursor === ancestor) return true;
    cursor = cursor.parent;
  }
  return false;
}

/* ------------------------------------------------------------------------ */
/* 1. THE HOLOGRAM — the scene's own hand at rest                             */
/* ------------------------------------------------------------------------ */

async function bakeHologram(renderer: WebGLRenderer, scale: number): Promise<BakeResult> {
  const world = buildWorld();
  await world.settled;
  world.tick(0);

  const holder = world.scene.getObjectByName("hand");
  if (holder === undefined) throw new Error("the world has no hand holder");
  let handMeshes = 0;
  world.scene.traverse((node) => {
    const drawable = node as Object3D & { isMesh?: boolean; isPoints?: boolean; isLine?: boolean; isSprite?: boolean };
    if (drawable.isMesh || drawable.isPoints || drawable.isLine || drawable.isSprite) {
      node.visible = isUnder(node, holder);
      if (node.visible) handMeshes += 1;
    }
  });
  if (handMeshes === 0) throw new Error("the hand did not load — nothing under the holder draws");
  world.scene.background = null;
  world.scene.fog = null;

  const region = HOLOGRAM_HAND_REGION;
  const camera = regionCamera(world.camera, region);
  const width = region.w * scale;
  const height = region.h * scale;
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  renderer.render(world.scene, camera);
  const png = renderer.domElement.toDataURL("image/png");

  /* The registration, checked: the hand's box through both cameras. */
  const box = new Box3().setFromObject(holder);
  const centre = box.getCenter(new Vector3());
  const full = worldToStage(world.camera, centre);
  const cut = throughRegion(camera, region, centre);
  const corners = [
    new Vector3(box.min.x, box.min.y, centre.z),
    new Vector3(box.max.x, box.max.y, centre.z),
  ].map((point) => worldToStage(world.camera, point));
  const error = Math.hypot(full.x - cut.x, full.y - cut.y);
  if (error > 0.01) throw new Error(`region camera disagrees with the room's by ${error.toFixed(4)} stage units`);

  world.dispose();
  return {
    png,
    width,
    height,
    registration: {
      region,
      pose: "rest — world.tick(0), sway 0",
      camera: { position: CAMERA_SANCTUARY.position.toArray(), fov: CAMERA_SANCTUARY.fov, horizon: CAMERA_SANCTUARY.horizon },
      handCentreStage: { x: Number(full.x.toFixed(2)), y: Number(full.y.toFixed(2)) },
      handBoxStage: { from: corners[0], to: corners[1] },
      cameraAgreementStageUnits: Number(error.toFixed(5)),
    },
  };
}

/* ------------------------------------------------------------------------ */
/* 2 & 3. THE STILL BAKES — engraved gold, registered by its joints           */
/* ------------------------------------------------------------------------ */

interface LoadedHand {
  readonly group: Group;
  readonly marks: Record<"wrist" | "thumbCmc" | "indexMcp" | "littleMcp", Vector3>;
  /** All 21 joints, for reporting how far the warped hand reaches. */
  readonly joints: Vector3[];
}

/**
 * Engraved gold: a gold-500 body falling to gold-600 where the surface turns
 * from the light, a gold-400 Fresnel rim, opaque. The key is GRAZING — from
 * the upper left, well off the camera's axis — because a palm seen straight on
 * is nearly flat, and a light near the eye lights all of it alike: the first
 * bake came out a stencil. A hemisphere term keeps the shadow side from going
 * black. No tone mapping — the tokens are the display colours the plate carries.
 */
function engravedMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    blending: NoBlending,
    uniforms: {
      uBody: { value: new Color(GOLD_500) },
      uShadow: { value: new Color(GOLD_600) },
      uRim: { value: new Color(GOLD_400) },
      uLight: { value: new Vector3(-0.62, 0.62, 0.48).normalize() },
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
      uniform vec3 uBody; uniform vec3 uShadow; uniform vec3 uRim; uniform vec3 uLight;
      varying vec3 vNormal; varying vec3 vView;
      void main() {
        vec3 n = normalize(vNormal);
        float facing = max(dot(n, normalize(vView)), 0.0);
        float fresnel = pow(1.0 - facing, 2.6);
        float key = max(dot(n, uLight), 0.0);
        float hemi = 0.5 + 0.5 * n.y;
        float shade = 0.3 * hemi + 0.7 * key;
        vec3 body = mix(uShadow, uBody, smoothstep(0.08, 0.72, shade));
        vec3 colour = mix(body, uRim, fresnel * 0.75);
        gl_FragColor = vec4(colour, 1.0);
      }`,
  });
}

async function loadHand(): Promise<LoadedHand> {
  const [gltf, marks] = await Promise.all([
    new GLTFLoader().loadAsync(HAND_MODEL_URL),
    fetch(HAND_LANDMARKS_URL).then((response) => response.json() as Promise<Landmarks>),
  ]);
  const material = engravedMaterial();
  const hand: Object3D = gltf.scene;
  hand.traverse((node) => {
    if (node instanceof Mesh) {
      (node.geometry as BufferGeometry).computeVertexNormals();
      node.material = material;
    }
  });
  const oriented = new Group();
  oriented.add(hand);
  const rotation = palmForwardRotation(marks);
  oriented.applyMatrix4(rotation);
  const centre = new Box3().setFromObject(oriented).getCenter(new Vector3());
  oriented.position.sub(centre);
  oriented.updateMatrixWorld(true);

  const mark = (p: readonly number[]): Vector3 => v(p).applyMatrix4(rotation).sub(centre);
  return {
    group: oriented,
    joints: [mark(marks.wrist), ...marks.fingers.flatMap((finger) => finger.map(mark))],
    marks: {
      wrist: mark(marks.wrist),
      thumbCmc: mark(marks.fingers[0]?.[0] ?? [0, 0, 0]),
      indexMcp: mark(marks.fingers[1]?.[0] ?? [0, 0, 0]),
      littleMcp: mark(marks.fingers[4]?.[0] ?? [0, 0, 0]),
    },
  };
}

/** The source render: the hand palm-on under an orthographic camera, into a square multisampled target. */
const SOURCE_PX = 2048;

const WarpShader = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tSrc; uniform mat3 uToSrc; uniform vec2 uOut; uniform float uSrc; uniform float uMirror;
    varying vec2 vUv;
    void main() {
      vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uOut;
      vec3 s = uToSrc * vec3(px, 1.0);
      vec2 sp = s.xy / s.z;
      if (uMirror > 0.5) sp.x = uSrc - sp.x;
      vec2 uv = vec2(sp.x / uSrc, 1.0 - sp.y / uSrc);
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { gl_FragColor = vec4(0.0); return; }
      gl_FragColor = texture2D(tSrc, uv);
      #include <colorspace_fragment>
    }`,
};

interface StillSpec {
  readonly out: { readonly width: number; readonly height: number };
  readonly mirror: boolean;
  /** The correspondences: mesh joints (in source pixels, after any mirror) and where each must land (output pixels). */
  readonly pairs: (marks: Record<string, Point2>) => { readonly src: Point2[]; readonly dst: Point2[]; readonly names: string[] };
  readonly note: Record<string, unknown>;
}

async function bakeStill(renderer: WebGLRenderer, hand: LoadedHand, spec: StillSpec): Promise<BakeResult> {
  /* The source render. */
  const scene = new Scene();
  scene.add(hand.group);
  const box = new Box3().setFromObject(hand.group);
  const size = box.getSize(new Vector3());
  const half = Math.max(size.x, size.y) * 0.55;
  const camera = new OrthographicCamera(-half, half, half, -half, 0.1, 20);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  const target = new WebGLRenderTarget(SOURCE_PX, SOURCE_PX, {
    type: HalfFloatType,
    samples: 4,
    minFilter: LinearMipmapLinearFilter,
    magFilter: LinearFilter,
    generateMipmaps: true,
  });
  renderer.toneMapping = NoToneMapping;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);

  /* The joints, in source pixels. */
  const toSourcePx = (point: Vector3): Point2 => {
    const ndc = point.clone().project(camera);
    const x = ((ndc.x + 1) / 2) * SOURCE_PX;
    return { x: spec.mirror ? SOURCE_PX - x : x, y: ((1 - ndc.y) / 2) * SOURCE_PX };
  };
  const marks: Record<string, Point2> = Object.fromEntries(Object.entries(hand.marks).map(([name, point]) => [name, toSourcePx(point)]));
  const { src, dst, names } = spec.pairs(marks);
  const toSrc = solveHomography(dst, src);
  if (toSrc === null) throw new Error("the registration is degenerate");

  /* The warp: every output pixel samples where its homography says. */
  const quad = new Mesh(
    new PlaneGeometry(2, 2),
    new ShaderMaterial({
      ...WarpShader,
      blending: NoBlending,
      depthTest: false,
      uniforms: {
        tSrc: { value: target.texture },
        uToSrc: { value: new Matrix3().set(toSrc[0], toSrc[1], toSrc[2], toSrc[3], toSrc[4], toSrc[5], toSrc[6], toSrc[7], toSrc[8]) },
        uOut: { value: new Vector2(spec.out.width, spec.out.height) },
        uSrc: { value: SOURCE_PX },
        uMirror: { value: spec.mirror ? 1 : 0 },
      },
    }),
  );
  const warpScene = new Scene();
  warpScene.add(quad);
  renderer.setPixelRatio(1);
  renderer.setSize(spec.out.width, spec.out.height, false);
  renderer.render(warpScene, camera);
  const png = renderer.domElement.toDataURL("image/png");

  /* Prove the registration: each joint through the forward map lands on its target. */
  const forward = solveHomography(src, dst);
  const landed = names.map((name, i) => {
    const s = src[i]!;
    const h = forward!;
    const w = h[6] * s.x + h[7] * s.y + h[8];
    const p = { x: (h[0] * s.x + h[1] * s.y + h[2]) / w, y: (h[3] * s.x + h[4] * s.y + h[5]) / w };
    return { name, target: dst[i], landed: { x: Number(p.x.toFixed(3)), y: Number(p.y.toFixed(3)) }, errorPx: Number(Math.hypot(p.x - dst[i]!.x, p.y - dst[i]!.y).toFixed(4)) };
  });
  const worst = Math.max(...landed.map((l) => l.errorPx));
  if (worst > 0.05) throw new Error(`registration residual ${worst} px`);
  const through = (p: Point2): Point2 => {
    const h = forward!;
    const w = h[6] * p.x + h[7] * p.y + h[8];
    return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
  };
  const reach = hand.joints.map((joint) => through(toSourcePx(joint)));
  const extent = {
    minX: Number(Math.min(...reach.map((p) => p.x)).toFixed(1)),
    maxX: Number(Math.max(...reach.map((p) => p.x)).toFixed(1)),
    minY: Number(Math.min(...reach.map((p) => p.y)).toFixed(1)),
    maxY: Number(Math.max(...reach.map((p) => p.y)).toFixed(1)),
  };

  scene.remove(hand.group);
  target.dispose();
  quad.geometry.dispose();
  (quad.material as ShaderMaterial).dispose();
  return { png, width: spec.out.width, height: spec.out.height, registration: { ...spec.note, sourcePx: SOURCE_PX, mirrored: spec.mirror, joints: landed, worstResidualPx: worst, jointExtentPx: extent } };
}

/* ------------------------------------------------------------------------ */
/* THE RUN                                                                    */
/* ------------------------------------------------------------------------ */

declare global {
  interface Window {
    __bake?: Record<string, BakeResult>;
    __bakeError?: string;
  }
}

async function main(): Promise<void> {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
  document.body.appendChild(renderer.domElement);
  const out: Record<string, BakeResult> = {};

  out["hand-hologram"] = await bakeHologram(renderer, 3);

  const hand = await loadHand();
  const PLATE_PX = 1536;
  const anchorNames = ["wrist", "thumbCmc", "indexMcp", "littleMcp"] as const;
  out["hand-plate"] = await bakeStill(renderer, hand, {
    out: { width: PLATE_PX, height: PLATE_PX },
    mirror: true,
    pairs: (marks) => ({
      names: [...anchorNames],
      src: anchorNames.map((name) => marks[name]!),
      dst: CANONICAL_ANCHORS.map((a) => ({ x: a.x * PLATE_PX, y: a.y * PLATE_PX })),
    }),
    note: { frame: "canonical rectified crop (lib/scan/rectify.ts CANONICAL_ANCHORS: wrist, thumb CMC, index MCP, little MCP)", anchors: CANONICAL_ANCHORS },
  });

  /* The tradition plate: hand units to pixels at 3x, inside TRADITION_HAND_PLATE_BOX (which
     extends above the drawing's box, because the real hand's fingers do). */
  const box = TRADITION_HAND_PLATE_BOX;
  const k = 900 / box.width;
  const tradition = { width: 900, height: Math.round(box.height * k) };
  const toBoxPx = (p: Point2): Point2 => ({ x: (p.x - box.x) * k, y: (p.y - box.y) * k });
  out["hand-tradition"] = await bakeStill(renderer, hand, {
    out: tradition,
    mirror: false,
    pairs: (marks) => {
      /* Three points fix an affine; the fourth completes the parallelogram on both sides so the
         homography solver returns exactly that affine. */
      const names = ["wrist", "indexMcp", "littleMcp"] as const;
      const src = names.map((name) => marks[name]!);
      const dst = names.map((name) => toBoxPx(TRADITION_HAND_LANDMARKS[name]));
      const fourth = (p: Point2[]): Point2 => ({ x: p[1]!.x + p[2]!.x - p[0]!.x, y: p[1]!.y + p[2]!.y - p[0]!.y });
      return { names: [...names, "parallelogram"], src: [...src, fourth(src)], dst: [...dst, fourth(dst)] };
    },
    note: {
      frame: "tradition hand box (lib/sanctuary/tradition-hand.ts): TRADITION_HAND_LANDMARKS, baked into TRADITION_HAND_PLATE_BOX at " + k.toFixed(5) + " px per unit",
      landmarks: TRADITION_HAND_LANDMARKS,
      box,
    },
  });

  window.__bake = out;
}

main().catch((error: unknown) => {
  window.__bakeError = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
});
