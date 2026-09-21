/**
 * The room's objects, built against Amendment 2's material list.
 *
 * Each builder returns the object, an optional per-frame `tick`, and a
 * `dispose` that releases every geometry, material and texture it made. The
 * room is mounted and unmounted as the reader navigates, and a scene that
 * leaks its GPU buffers on each visit is how a sanctuary becomes a slow tab.
 *
 * POSITIONS COME FROM layout.ts, never from here. A builder may shape its
 * object freely, but where it stands is the CSS room's anchor read through the
 * camera, so the two rooms stay one room.
 *
 * TWO DECISIONS TAKEN HERE FOR THE FRAME BUDGET, both measured against in P6:
 *
 *  · CONTACT SHADOWS ARE DECALS. A shadow-casting point light renders a cube
 *    map — six shadow passes a frame — and the room's one key is a point
 *    light. That is the most likely single thing to lose 30 fps at 390 wide on
 *    a throttled CPU. Amendment 2 asks for "contact shadows under the pedestal
 *    and stand", which is exactly what a soft radial decal under each is.
 *  · THE FLAME AND ITS LIGHT SHARE ONE FLICKER. `flicker()` below is mirrored
 *    in the flame's GLSL, so the glow on screen and the light it casts rise
 *    and fall together; two separate wobbles would read as a flame lit by
 *    something else.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  MultiplyBlending,
  Object3D,
  PlaneGeometry,
  PointLight,
  Quaternion,
  ShaderMaterial,
  SpotLight,
  Texture,
  TorusGeometry,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Material,
} from "three";
import type { RoomLayout } from "./layout";
import { BLOOM_LAYER, DRAPE_LAYER } from "./post";
import { BACK_WALL_Z, DRAPE_Z } from "./layout";
import { albedo, FLAME, FLAME_WARM, GOLD_400, GOLD_500, GOLD_600, INK_RED, MOON, PARCHMENT, REFLECTANCE, STONE_700, STONE_800, WOOD } from "./palette";
import {
  brushedBrassRoughness,
  engravedStoneNormal,
  parchmentFibreNormal,
  tornEdgeAlpha,
  waxDripNormal,
} from "./procedural";

export interface Built {
  readonly object: Object3D;
  readonly tick?: (seconds: number) => void;
  readonly dispose: () => void;
}

/** Collects everything a builder allocates, so one call frees it all. */
class Owned {
  private readonly items: { dispose: () => void }[] = [];
  keep<T extends { dispose: () => void }>(item: T): T {
    this.items.push(item);
    return item;
  }
  dispose = (): void => {
    for (const item of this.items) item.dispose();
    this.items.length = 0;
  };
}

/* ------------------------------------------------------------------------ */
/* THE FLICKER                                                                */
/* ------------------------------------------------------------------------ */

/**
 * A candle's brightness at time `t`, 0.69..0.95 around 0.82.
 *
 * Two incommensurate sines, never a random walk: a flame that jitters per
 * frame reads as noise rather than flame, and it would also make two captures
 * of the same instant differ, which the harness cannot score. The period is
 * the CSS room's own (lib/sanctuary/room-composition.ts), so both rooms breathe
 * together. Mirrored exactly in FLICKER_GLSL.
 */
export function flicker(seconds: number, periodMs: number, seed: number): number {
  const phase = (seconds * 1000) / periodMs;
  return 0.82 + 0.13 * Math.sin(phase * Math.PI * 2) + 0.05 * Math.sin(phase * Math.PI * 2 * 1.618 + seed);
}

const FLICKER_GLSL = /* glsl */ `
float flicker(float t, float periodMs, float seed) {
  float phase = t * 1000.0 / periodMs;
  return 0.82 + 0.13 * sin(phase * 6.2831853) + 0.05 * sin(phase * 6.2831853 * 1.618 + seed);
}`;

/* ------------------------------------------------------------------------ */
/* GROUND AND WALLS                                                           */
/* ------------------------------------------------------------------------ */

/** A soft dark disc under an object: the contact shadow, as a decal. */
function contactShadow(owned: Owned, radius: number, strength: number): Mesh {
  const material = owned.keep(
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: MultiplyBlending,
      premultipliedAlpha: true,
      uniforms: { uStrength: { value: strength } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uStrength;
        varying vec2 vUv;
        void main() {
          float d = length(vUv - 0.5) * 2.0;
          float shade = 1.0 - uStrength * smoothstep(1.0, 0.0, d) * smoothstep(1.0, 0.35, d);
          gl_FragColor = vec4(vec3(shade), 1.0);
        }`,
    }),
  );
  const mesh = new Mesh(owned.keep(new PlaneGeometry(radius * 2, radius * 2)), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 1;
  return mesh;
}

export function buildGround(layout: RoomLayout): Built {
  const owned = new Owned();
  const group = new Group();
  group.name = "ground";

  // The desk / floor: dark stone, engraved, very rough. The mandala tile is
  // centred on the pedestal, where the key's light pools on it.
  const stoneNormal = owned.keep(engravedStoneNormal());
  const floor = new Mesh(
    owned.keep(new PlaneGeometry(22, 16)),
    owned.keep(
      new MeshStandardMaterial({
        color: albedo(STONE_800, REFLECTANCE.floorStone),
        roughness: 0.9,
        metalness: 0.02,
        normalMap: stoneNormal,
        normalScale: new Vector2(0.5, 0.5),
      }),
    ),
  );
  floor.name = "floor";
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(layout.pedestal.centre.x, 0, layout.pedestal.centre.z);
  group.add(floor);

  // The back wall, so the fog fades into stone rather than into nothing.
  const wall = new Mesh(
    owned.keep(new PlaneGeometry(26, 9)),
    owned.keep(new MeshStandardMaterial({ color: albedo(STONE_700, REFLECTANCE.wallStone), roughness: 0.95, metalness: 0 })),
  );
  wall.name = "wall";
  wall.position.set(0, 4.5, BACK_WALL_Z - 0.05);
  group.add(wall);

  // Contact shadows under the drum and under the lectern.
  const underPedestal = contactShadow(owned, layout.pedestal.radius * 1.35, 0.72);
  underPedestal.position.set(layout.pedestal.centre.x, 0.002, layout.pedestal.centre.z);
  group.add(underPedestal);

  const underStand = contactShadow(owned, 0.7, 0.6);
  underStand.position.set(layout.book.spine.x, 0.002, layout.book.spine.z);
  group.add(underStand);

  return { object: group, dispose: owned.dispose };
}

/* ------------------------------------------------------------------------ */
/* THE PEDESTAL                                                               */
/* ------------------------------------------------------------------------ */

export function buildPedestal(layout: RoomLayout, zodiacMask: Texture | null): Built {
  const owned = new Owned();
  const group = new Group();
  group.name = "pedestal";
  const { centre, radius, height } = layout.pedestal;
  group.position.set(centre.x, 0, centre.z);

  const roughnessMap = owned.keep(brushedBrassRoughness());
  // Stretched round the drum: the brushing runs around the circumference.
  roughnessMap.repeat.set(6, 1);

  const brass = owned.keep(
    new MeshStandardMaterial({
      color: GOLD_600,
      metalness: 0.85,
      roughness: 0.45,
      roughnessMap,
      emissive: new Color(GOLD_600),
      emissiveIntensity: 0.15,
    }),
  );

  // The drum, flaring slightly at its foot as the reference's does.
  const drum = new Mesh(owned.keep(new CylinderGeometry(radius, radius * 1.06, height * 0.82, 64, 1, false)), brass);
  drum.name = "drum";
  drum.position.y = height * 0.41;
  group.add(drum);

  // A plinth ring at the foot and a lip at the top, which is where the
  // highlight catches and where the reference's ornament sits.
  const foot = new Mesh(owned.keep(new CylinderGeometry(radius * 1.1, radius * 1.13, height * 0.1, 64)), brass);
  foot.name = "drum";
  foot.position.y = height * 0.05;
  group.add(foot);

  const lipMaterial = owned.keep(
    new MeshStandardMaterial({ color: GOLD_500, metalness: 0.9, roughness: 0.32, roughnessMap, emissive: new Color(GOLD_500), emissiveIntensity: 0.18 }),
  );
  const lip = new Mesh(owned.keep(new CylinderGeometry(radius * 1.02, radius, height * 0.1, 64)), lipMaterial);
  lip.name = "drum";
  lip.position.y = height * 0.87;
  group.add(lip);

  // The top face, carrying the engraved zodiac as an emissive mask (built at
  // build time from <CelestialRing> — scripts/textures/build-zodiac-mask.mjs).
  const faceMaterial = owned.keep(
    new MeshStandardMaterial({
      color: albedo(STONE_800, 0.06),
      metalness: 0.6,
      roughness: 0.55,
      emissive: new Color(1, 1, 1),
      emissiveIntensity: zodiacMask ? ZODIAC_EMISSIVE_INTENSITY : 0,
      emissiveMap: zodiacMask,
    }),
  );
  const face = new Mesh(owned.keep(new CircleGeometry(radius * 0.995, 96)), faceMaterial);
  face.name = "zodiac";
  face.rotation.x = -Math.PI / 2;
  face.position.y = height + 0.001;
  group.add(face);

  // The plaque on the drum's face — PAST · PRESENT · FUTURE in the reference.
  // A raised panel only; the words belong to the HTML over the room.
  const plaque = new Mesh(owned.keep(new BoxGeometry(radius * 0.9, height * 0.28, 0.02)), lipMaterial);
  plaque.position.set(0, height * 0.42, radius * 1.005);
  group.add(plaque);

  return { object: group, dispose: owned.dispose };
}

/**
 * Amendment 2: "emissive gold 0.15". The mask is the ring's own gold, so the
 * emissive colour is white and the engraving glows in the component's gold
 * rather than in gold multiplied by gold.
 */
export const ZODIAC_EMISSIVE_INTENSITY = 0.15;

/** Give the pedestal's face its zodiac once the mask texture has loaded. */
export function applyZodiacMask(pedestal: Object3D, mask: Texture): void {
  pedestal.traverse((node) => {
    if (node instanceof Mesh && node.geometry instanceof CircleGeometry) {
      const material = node.material as MeshStandardMaterial;
      material.emissive.setRGB(1, 1, 1);
      material.emissiveMap = mask;
      material.emissiveIntensity = ZODIAC_EMISSIVE_INTENSITY;
      material.needsUpdate = true;
    }
  });
}

/* ------------------------------------------------------------------------ */
/* THE CANDLES                                                                */
/* ------------------------------------------------------------------------ */

/**
 * A candle: a tapered wax body, a brass dish, a flame, and the light it casts.
 *
 * ONE BUILDER FOR EVERY CANDLE IN THE ROOM. The three composition candles, the
 * two on the shelves and the one on the lectern are all this, so every flame
 * in the room is lit, shaded and flickered identically; a room with two kinds
 * of candle reads as two rooms.
 *
 * The light has decay 2 — inverse square, a real flame — and a CUTOFF (`reach`)
 * set only far enough that the square law, not the cutoff, decides where the
 * light ends.
 */
interface CandleSpec {
  readonly base: Vector3;
  readonly height: number;
  readonly periodMs: number;
  readonly seed: number;
  readonly reach: number;
  readonly intensity: number;
  /** Which candle this is, for the scorer: a composition id, or "lectern" / "shelf" / "sconce". */
  readonly label: string;
}

/** A candle that flickers: the light and the flame shader share one clock. */
export interface Flickering {
  readonly object: Group;
  readonly tick: (seconds: number) => void;
}

function makeCandle(owned: Owned, wax: MeshStandardMaterial, brass: MeshStandardMaterial, spec: CandleSpec): Flickering {
  const holder = new Group();
  // Named so the scorer can tell a candle's bloom (allowed) from a surface's (not).
  holder.name = "candle";
  holder.userData.label = spec.label;
  holder.position.copy(spec.base);
  const h = spec.height;

  // Tapered: a candle burns thinner at the top.
  const body = new Mesh(owned.keep(new CylinderGeometry(h * 0.16, h * 0.21, h, 16)), wax);
  body.position.y = h / 2;
  holder.add(body);

  // A little brass dish under it, as every candle in the reference has.
  const dish = new Mesh(owned.keep(new CylinderGeometry(h * 0.42, h * 0.36, h * 0.06, 24)), brass);
  dish.position.y = h * 0.03;
  holder.add(dish);

  // The flame: an additive teardrop billboard flickering at the candle's own
  // period — 2 to 4 Hz, inside the token band.
  const flameMaterial = owned.keep(
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uPeriod: { value: spec.periodMs },
        uSeed: { value: spec.seed },
        uCore: { value: new Color(FLAME) },
        uEdge: { value: new Color(FLAME_WARM) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          // Billboard: keep the quad facing the camera around its own centre.
          vec4 centre = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          vec2 scale = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
          centre.xy += position.xy * scale;
          gl_Position = projectionMatrix * centre;
        }`,
      fragmentShader: /* glsl */ `
        ${FLICKER_GLSL}
        uniform float uTime; uniform float uPeriod; uniform float uSeed;
        uniform vec3 uCore; uniform vec3 uEdge;
        varying vec2 vUv;
        void main() {
          float f = flicker(uTime, uPeriod, uSeed);
          // A teardrop: narrow at the top, round at the base.
          vec2 p = vUv - vec2(0.5, 0.32);
          p.x *= 1.0 + p.y * 2.2;
          float d = length(p * vec2(2.4, 1.25));
          float body = smoothstep(0.5, 0.0, d);
          float core = smoothstep(0.22, 0.0, d);
          vec3 colour = mix(uEdge, uCore, core) * (body * 1.4 + core * 1.6) * f;
          gl_FragColor = vec4(colour, body * f);
        }`,
    }),
  );
  const flame = new Mesh(owned.keep(new PlaneGeometry(h * 0.34, h * 0.62)), flameMaterial);
  flame.position.y = h * 1.26;
  // The flame is one of the two things allowed to bloom (post.ts BLOOM_LAYER).
  flame.layers.enable(BLOOM_LAYER);
  holder.add(flame);

  // And the light it casts, which is the point of Amendment 2.
  const light = new PointLight(FLAME, spec.intensity, spec.reach, 2);
  light.position.y = h * 1.3;
  holder.add(light);

  return {
    object: holder,
    tick: (seconds) => {
      light.intensity = spec.intensity * flicker(seconds, spec.periodMs, spec.seed);
      flameMaterial.uniforms.uTime!.value = seconds;
    },
  };
}

/** Shared by every candle in the room. */
function candleMaterials(owned: Owned): { wax: MeshStandardMaterial; brass: MeshStandardMaterial } {
  const normal = owned.keep(waxDripNormal());
  return {
    wax: owned.keep(new MeshStandardMaterial({ color: 0xe6d8bc, roughness: 0.62, metalness: 0, normalMap: normal })),
    brass: owned.keep(new MeshStandardMaterial({ color: GOLD_600, metalness: 0.85, roughness: 0.4 })),
  };
}

/**
 * The three composition candles' reach and brightness.
 *
 * ITERATION 2. Iteration 1 had all three at 1.1 with a 2.6 m reach, and the one
 * at the pedestal's right — nearest the camera — lit the frame at 0.0385
 * against the key's 0.0324: a candle out-lighting the key, which is the
 * opposite of Amendment 4's "one warm key, everything else falling off from
 * it". It stood on a large area of floor right in front of the lens. The key
 * is the fix for most of that (world.ts); these are trimmed so no single
 * candle can compete with it, while staying bright enough near the drum for
 * its flicker to land there.
 */
const COMPOSITION_CANDLE: Readonly<Record<string, { reach: number; intensity: number }>> = {
  "pedestal-left": { reach: 2.0, intensity: 0.8 },
  // ITERATION 4: 0.6 -> 0.3, reach 1.6 -> 1.2. Still the candle that lit the
  // frame more than the key (0.0230 vs 0.0186) — it stands closest to the lens,
  // over the widest stretch of floor in view.
  "pedestal-right": { reach: 1.2, intensity: 0.3 },
  book: { reach: 2.2, intensity: 0.7 },
};

export function buildCandles(layout: RoomLayout): Built {
  const owned = new Owned();
  const group = new Group();
  group.name = "candles";
  const { wax, brass } = candleMaterials(owned);

  const candles = layout.candles.map((candle, index) => {
    const tuning = COMPOSITION_CANDLE[candle.id] ?? { reach: 2.0, intensity: 0.7 };
    const built = makeCandle(owned, wax, brass, {
      base: candle.base,
      height: candle.height,
      periodMs: candle.periodMs,
      seed: index * 1.7,
      reach: tuning.reach,
      intensity: tuning.intensity,
      label: candle.id,
    });
    group.add(built.object);
    return built;
  });

  return {
    object: group,
    tick: (seconds) => {
      for (const candle of candles) candle.tick(seconds);
    },
    dispose: owned.dispose,
  };
}

/* ------------------------------------------------------------------------ */
/* THE BOOK                                                                   */
/* ------------------------------------------------------------------------ */

/** Bend a page stack's top surface up towards its outer edge, as an open book's leaves do. */
function bendPages(geometry: BufferGeometry, width: number, lift: number): void {
  const position = geometry.attributes.position!;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    // 0 at the spine, 1 at the outer edge.
    const t = Math.min(1, Math.max(0, x / width + 0.5));
    position.setY(i, position.getY(i) + Math.sin(t * Math.PI * 0.5) * lift);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

/**
 * How far the lectern leans its pages toward the reader, radians (~26°).
 *
 * ITERATION 5, and a sign error. It was -0.12, which tilted the pages AWAY from
 * the viewer, and nearly flat: with the key up in the hologram column and to
 * the book's front-left, it reached the page tops at a grazing ~6°, so the
 * parchment lit at almost nothing and the book region measured 1.63% against a
 * 4% bar. A real lectern leans its book toward the reader, and doing so here
 * also turns the pages toward the key.
 */
const LECTERN_TILT = 0.45;

/**
 * The lectern top's width, metres.
 *
 * P2.1: 1.42 -> 1.9. The book's candle now stands ON the lectern (see below),
 * and 1.42 left only 10 cm of top beyond the pages — too little for a flame to
 * stand 15-25 cm from their near edge.
 */
const LECTERN_TOP_WIDTH = 1.9;

/** Where the book's candle stands: this far beyond the near page edge (P2.1: 15-25 cm). */
const BOOK_CANDLE_FROM_EDGE = 0.22;

/**
 * How far above the page edge's own height the flame sits, metres.
 *
 * P2.1 iteration 3. Exactly level with the raised outer edge (iteration 1), the
 * flame grazed the page tops — the pages rise toward that edge, so their
 * surface faces inward, away from a candle outboard of it — and it added
 * 0.0003 to the parchment's mean luminance: it lit the edge, not the page. A
 * few centimetres up, still level with the page block, it reaches the surface.
 */
const BOOK_FLAME_ABOVE_EDGE = 0.045;

export function buildBook(layout: RoomLayout): Built {
  const owned = new Owned();
  const group = new Group();
  group.name = "book";
  const { spine } = layout.book;
  group.position.copy(spine);
  // Turned a little toward the pedestal, as the reference's book is.
  group.rotation.y = -0.34;

  // The lectern: dark wood, roughness 0.7, its top slanted toward the reader.
  const wood = owned.keep(new MeshStandardMaterial({ color: albedo(WOOD, REFLECTANCE.darkWood), roughness: 0.7, metalness: 0.02 }));
  const stand = new Mesh(owned.keep(new BoxGeometry(1.25, spine.y - 0.04, 0.72)), wood);
  stand.name = "lectern";
  stand.position.y = -(spine.y - 0.04) / 2 - 0.02;
  group.add(stand);

  const top = new Mesh(owned.keep(new BoxGeometry(LECTERN_TOP_WIDTH, 0.05, 0.86)), wood);
  top.name = "lectern-top";
  top.position.y = -0.02;
  top.rotation.x = LECTERN_TILT;
  group.add(top);

  // Two page stacks, each bending up at its outer edge.
  const fibre = owned.keep(parchmentFibreNormal());
  fibre.repeat.set(3, 3);
  const parchment = owned.keep(
    new MeshStandardMaterial({ color: PARCHMENT, roughness: 0.86, metalness: 0, normalMap: fibre, normalScale: new Vector2(0.35, 0.35) }),
  );
  const pageWidth = 0.6;
  for (const side of [-1, 1] as const) {
    const geometry = owned.keep(new BoxGeometry(pageWidth, 0.07, 0.78, 24, 2, 4));
    bendPages(geometry, pageWidth, 0.09);
    const stack = new Mesh(geometry, parchment);
    stack.name = "parchment";
    stack.scale.x = side;
    stack.position.set(side * (pageWidth / 2 + 0.01), 0.04, 0);
    stack.rotation.x = LECTERN_TILT;
    group.add(stack);
  }

  // The top leaf, lifted mid-turn, with the U1 tear as its alpha.
  const tear = owned.keep(tornEdgeAlpha());
  const leafMaterial = owned.keep(
    new MeshStandardMaterial({
      color: PARCHMENT,
      roughness: 0.84,
      metalness: 0,
      normalMap: fibre,
      alphaMap: tear,
      transparent: true,
      alphaTest: 0.35,
      side: DoubleSide,
    }),
  );
  const leafGeometry = owned.keep(new PlaneGeometry(pageWidth * 0.96, 0.74, 20, 1));
  // Curl it: the free edge rises and rolls back over the spine.
  const lp = leafGeometry.attributes.position!;
  for (let i = 0; i < lp.count; i += 1) {
    const t = lp.getX(i) / (pageWidth * 0.96) + 0.5;
    lp.setZ(i, Math.sin(t * Math.PI * 0.85) * 0.22);
  }
  lp.needsUpdate = true;
  leafGeometry.computeVertexNormals();
  const leaf = new Mesh(leafGeometry, leafMaterial);
  leaf.name = "parchment";
  leaf.rotation.x = -Math.PI / 2 + LECTERN_TILT + 0.2;
  leaf.rotation.z = -0.5;
  leaf.position.set(pageWidth * 0.34, 0.16, -0.02);
  group.add(leaf);

  // A candle on the lectern, as the reference has beside its book.
  //
  // ITERATION 2. The book measured 0.52% luminance in iteration 1 against a 4%
  // bar: it is ~3.5 m from the key and from the composition candle named for
  // it, which the CSS room draws low in the frame and so sits near the camera
  // in depth. A flame on the lectern is what lights a book in the reference,
  // and it lights this one by candle falloff, exactly as Amendment 2 intends.
  const { wax, brass } = candleMaterials(owned);
  // P2.1: back ON the lectern, on a small brass holder, flame at page level.
  //
  // Iteration 4 moved it to the desk because, on the lectern, it stood 5 cm
  // from the pages and scorched them into a bloom hotspot. On the desk its
  // flame sat ~0.19 m BELOW the lectern top, so every lectern-top and page
  // surface nearest it faced away from it and caught exactly nothing: the [R10]
  // book flicker measured 0.00%. Bloom is now confined by layer (post.ts), so
  // a bright page edge cannot bloom whatever lights it; the candle can stand
  // where a reader would put one — on the lectern, flame level with the page
  // edge, 22 cm from it.
  const edge = -(pageWidth + 0.01);
  const holderX = edge - BOOK_CANDLE_FROM_EDGE;
  // The page edge rises to ~0.165 m; the candle's flame is at base + 1.26 h.
  const candleHeight = 0.08;
  const stemHeight = 0.165 + BOOK_FLAME_ABOVE_EDGE - 1.26 * candleHeight - 0.005;
  const stem = new Mesh(owned.keep(new CylinderGeometry(0.012, 0.022, stemHeight, 12)), brass);
  stem.position.set(holderX, 0.005 + stemHeight / 2, 0);
  group.add(stem);
  const lecternCandle = makeCandle(owned, wax, brass, {
    base: new Vector3(holderX, 0.005 + stemHeight, 0),
    height: candleHeight,
    periodMs: 401,
    seed: 4.1,
    reach: 1.6,
    intensity: 0.6,
    label: "lectern",
  });
  group.add(lecternCandle.object);

  return { object: group, tick: lecternCandle.tick, dispose: owned.dispose };
}

/* ------------------------------------------------------------------------ */
/* THE LIBRARY — shelves and tied leaf bundles                                */
/* ------------------------------------------------------------------------ */

/** Seeded, so the bundles lean the same way on every visit and every capture. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    return state / 4294967296;
  };
}

const SHELF_ROWS = 5;
const BUNDLES_PER_ROW = 9;

export function buildLibrary(layout: RoomLayout): Built {
  const owned = new Owned();
  const group = new Group();
  group.name = "library";
  const { centre } = layout.library;
  group.position.copy(centre);
  // Angled toward the room, as a side wall's shelves are.
  group.rotation.y = 0.55;

  // Lit only by candle falloff: no emissive, dark wood, very rough.
  const wood = owned.keep(new MeshStandardMaterial({ color: albedo(WOOD, REFLECTANCE.darkWood), roughness: 0.82, metalness: 0 }));
  const shelfWidth = 2.1;
  const rowGap = 0.44;
  const plank = owned.keep(new BoxGeometry(shelfWidth, 0.04, 0.34));
  const planks = new InstancedMesh(plank, wood, SHELF_ROWS + 1);
  const dummy = new Object3D();
  for (let row = 0; row <= SHELF_ROWS; row += 1) {
    dummy.position.set(0, row * rowGap - (SHELF_ROWS * rowGap) / 2, 0);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    planks.setMatrixAt(row, dummy.matrix);
  }
  group.add(planks);

  for (const x of [-shelfWidth / 2, shelfWidth / 2]) {
    const upright = new Mesh(owned.keep(new BoxGeometry(0.05, SHELF_ROWS * rowGap + 0.1, 0.36)), wood);
    upright.position.set(x, 0, 0);
    group.add(upright);
  }

  // The bundles: palm-leaf manuscripts, boards top and bottom, a red thread.
  const random = seeded(0x51f3);
  const count = SHELF_ROWS * BUNDLES_PER_ROW;
  const bundleGeometry = owned.keep(new BoxGeometry(0.2, 0.07, 0.24));
  const bundleMaterial = owned.keep(new MeshStandardMaterial({ color: 0x6b5236, roughness: 0.78, metalness: 0 }));
  const bundles = new InstancedMesh(bundleGeometry, bundleMaterial, count);

  const threadGeometry = owned.keep(new TorusGeometry(0.075, 0.004, 4, 16));
  const threadMaterial = owned.keep(new MeshStandardMaterial({ color: INK_RED, roughness: 0.6, metalness: 0 }));
  const threads = new InstancedMesh(threadGeometry, threadMaterial, count);

  // Where the shelf candles stand. Each takes a bundle's slot.
  //
  // ITERATION 4. Iteration 3 stood them on the plank's front edge, 1 cm from a
  // bundle's face; a point light that close, under inverse square, lit that
  // face to an HDR luminance of 1844 against a bloom threshold of 1.4. A
  // candle in its own slot is ~0.22 m from its neighbours.
  const CANDLE_SLOTS = [
    { row: 1, slot: 1, periodMs: 283, seed: 5.3 },
    { row: 3, slot: 7, periodMs: 457, seed: 6.7 },
  ];
  const slotX = (slot: number): number => -shelfWidth / 2 + 0.16 + slot * ((shelfWidth - 0.32) / (BUNDLES_PER_ROW - 1));
  const taken = new Set(CANDLE_SLOTS.map((c) => `${c.row}:${c.slot}`));

  const matrix = new Matrix4();
  const q = new Quaternion();
  const scale = new Vector3(1, 1, 1);
  let index = 0;
  for (let row = 0; row < SHELF_ROWS; row += 1) {
    const y = row * rowGap - (SHELF_ROWS * rowGap) / 2 + 0.06;
    for (let slot = 0; slot < BUNDLES_PER_ROW; slot += 1) {
      if (taken.has(`${row}:${slot}`)) continue;
      const x = slotX(slot);
      // Randomised rotation: a real shelf is never squared up.
      dummy.position.set(x + (random() - 0.5) * 0.04, y + random() * 0.03, (random() - 0.5) * 0.05);
      dummy.rotation.set((random() - 0.5) * 0.08, (random() - 0.5) * 0.5, (random() - 0.5) * 0.12);
      scale.set(0.85 + random() * 0.3, 0.8 + random() * 0.6, 0.9 + random() * 0.2);
      dummy.scale.copy(scale);
      dummy.updateMatrix();
      bundles.setMatrixAt(index, dummy.matrix);

      // The thread wraps the bundle's middle, around its long axis.
      q.setFromEuler(dummy.rotation);
      matrix.compose(dummy.position, q.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2)), new Vector3(scale.x, scale.z, scale.y));
      threads.setMatrixAt(index, matrix);
      index += 1;
    }
  }
  // Fewer instances than allocated: draw only the ones placed.
  bundles.count = index;
  threads.count = index;
  group.add(bundles, threads);

  // Candles on the shelves, as the reference has.
  //
  // ITERATION 2. Amendment 2 lights the shelves "only by candle falloff", and
  // iteration 1 had no candle within metres of them: the library measured 1.44%
  // luminance against a 3% bar, and because it was dark with fog or without,
  // the fog could only remove 16.67% of nothing. Two flames on the planks,
  // standing just in front of the bundles.
  const { wax, brass } = candleMaterials(owned);
  const shelfCandles = CANDLE_SLOTS.map((spot) => {
    const plankY = spot.row * rowGap - (SHELF_ROWS * rowGap) / 2 + 0.02;
    const built = makeCandle(owned, wax, brass, {
      base: new Vector3(slotX(spot.slot), plankY, 0),
      height: 0.11,
      periodMs: spot.periodMs,
      seed: spot.seed,
      reach: 1.8,
      // ITERATION 5: 0.5 -> 0.9. The library measured 1.95% against 3%, with
      // fog already doing its share (34%); the shelves needed more candle.
      intensity: 0.9,
      label: "shelf",
    });
    group.add(built.object);
    return built;
  });

  return {
    object: group,
    tick: (seconds) => {
      for (const candle of shelfCandles) candle.tick(seconds);
    },
    dispose: owned.dispose,
  };
}

/* ------------------------------------------------------------------------ */
/* THE WINDOW                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * The moonlight — the room's one cold light.
 *
 * Amendment 2 caps the cold rim at 25% of the key. A directional light and a
 * point light are not in the same units — one has no falloff, the other falls
 * with the square of distance — so comparing their `intensity` numbers would
 * say nothing. What the cap means is how much each brightens the pedestal, and
 * that is what P6 measures: the room rendered with the key alone and with the
 * rim alone, and the pedestal's luminance compared.
 *
 * ITERATION 2: 0.3 -> 2.4. At 0.3 the rim lit the frame at 0.0000 — the moon's
 * colour is a deep blue (#2B3A52, about 4% luminance), so a low intensity of a
 * dark colour is no light at all, and the cap was met by a rim that did not
 * exist. It comes from behind, so it lifts the edges and the floor and adds
 * little to the drum's lit face, which is why it can be visible and still
 * stay under 25% of the key there.
 *
 * ITERATION 4: 2.4 -> 10. Now that surfaces have real reflectance (palette.ts
 * albedo) the rim registered, but at 0.0002 against 0.0008; on the pedestal it
 * was 0.29% of the key, leaving ample room under the 25% cap.
 *
 * ITERATION 6 (P2 ruling 3, shelves only): a directional RIM becomes a SHAFT
 * of moonlight through the window, aimed at the far shelves as a dim cool
 * fill. The shelves measured 1.65% against 3% after five iterations: 8.5 m
 * back in fog, lit only by two candles. Amendment 2 permits one cold light
 * from the window at <= 25% of the key, and the product owner ruled that it be
 * used here, so the shelves' recession comes from physics — a cold shaft
 * across the far wall, warm candle falloff in front of it — rather than from a
 * brighter room. It is a SPOT, not a directional light, because moonlight
 * through a window is bounded by the window's aperture: a directional light
 * has no falloff and no edge, and would have washed the whole floor in front
 * of the lens, which is the key's to light.
 */
export const MOONLIGHT_INTENSITY = 160;

/**
 * The shaft's half-angle and edge softness.
 *
 * ITERATION 7. Iteration 6 raised the shelves to 2.83% but the moon lit the
 * frame at 25.32% of the key, over the cap — and nearly half of that was spill
 * onto the drape beside the window, which stood in the shaft's path ~1.4 m from
 * its source while the shelves are ~6 m away. The source moves to the top of
 * the glass, so the shaft slants down across the room and the drape sits ~24°
 * off its axis; the cone narrows (0.3 -> 0.26 rad, penumbra 0.7 -> 0.5) to hold
 * the shelves (~10° either side) and not the drape; and the intensity rises
 * 120 -> 160 for the shelves' remaining 0.17 points.
 */
export const MOONLIGHT_ANGLE = 0.26;
export const MOONLIGHT_PENUMBRA = 0.5;

export interface BuiltWindow extends Built {
  /** World-space, so the room adds it to the scene rather than to the window's group. */
  readonly moonlight: SpotLight;
}

/**
 * Sconce candles flanking the window, as the reference has candles by its.
 *
 * ITERATION 5. The drapes that frame the window measured 0.36% and 0.09%
 * against a 1.5% bar. Nothing lit their faces: the key is ~5 m away and the
 * moon comes from BEHIND them, through the window, so it lights their backs.
 * The darker of the two stands at stage x 1478, outside the composition's safe
 * band (230-1370) and under the vignette, which is why it needed a light of its
 * own rather than a brighter room.
 */
const SCONCES = [
  { side: -1, periodMs: 331, seed: 7.9 },
  { side: 1, periodMs: 479, seed: 8.3 },
] as const;

/**
 * P2.1: one more sconce, beside the right drape — the same bracket and candle
 * as the other two. Its bracket reaches FORWARD of the drape's plane: the
 * first two stand on 16 cm brackets, behind the drapes that hang 25 cm out, so
 * they light only the drapes' backs and the edges of their folds. The right
 * drape measured 0.27% after moving inward into the safe band, away from them.
 */
const DRAPE_SCONCE = { fromDrapeEdge: 0.18, depth: 0.42, height: 0.1, periodMs: 353, seed: 9.1 } as const;

/**
 * P2.1 iteration 3: where each window sconce stands, window-local.
 *
 * After the flag the drapes are lit only by these, and iteration 2 measured
 * them at 0.77% and 0.62% against 1.5%. The left one moves forward of its
 * drape's plane (it stood behind it, lighting only its back) and lower, so it
 * lights the drape's lower length strongly and, by the square law, the part
 * behind the masthead far less. The right drape's lower half is hidden behind
 * the lectern, so its sconce moves up to the part that shows.
 */
const SCONCE_Y = { left: -0.6, right: -0.455 } as const;
const SCONCE_Z = { left: 0.42, right: 0.16 } as const;

/** The window's glass, metres. */
export const WINDOW_WIDTH = 1.7;
export const WINDOW_HEIGHT = 2.5;

/**
 * The moon's disc radius, and where it sits across the glass as a fraction of
 * its width.
 *
 * P2 RULING 2's consequence: 0.2 -> 0.08. Bringing the right drape wholly
 * inside the safe band left 8 cm between it and the moon; at the narrowest
 * width that still reads as cloth (0.28 m) it would have covered part of the
 * disc. The moon moves 0.2 m left and stays right of the window's centre, in
 * its upper half. Nothing in the CSS room anchors the 3D moon, so the two rooms
 * still agree.
 */
export const MOON_RADIUS = 0.2;
export const MOON_X_FRACTION = 0.08;

export function buildWindow(layout: RoomLayout): BuiltWindow {
  const owned = new Owned();
  const group = new Group();
  group.name = "window";
  const { centre } = layout.window;
  group.position.copy(centre);

  const width = WINDOW_WIDTH;
  const height = WINDOW_HEIGHT;

  // The night outside: an emissive plane, cold and dark, never flat black.
  const sky = new Mesh(
    owned.keep(new PlaneGeometry(width, height)),
    owned.keep(new MeshBasicMaterial({ color: new Color(MOON).multiplyScalar(0.55), fog: false })),
  );
  sky.position.z = -0.02;
  group.add(sky);

  // The moon: a soft emissive disc, upper right of the arch as in the reference.
  const moon = new Mesh(
    owned.keep(new CircleGeometry(MOON_RADIUS, 48)),
    owned.keep(new MeshBasicMaterial({ color: 0xdfe6ee, transparent: true, opacity: 0.92, fog: false })),
  );
  moon.position.set(width * MOON_X_FRACTION, height * 0.22, -0.01);
  group.add(moon);

  const halo = new Mesh(
    owned.keep(new CircleGeometry(0.48, 48)),
    owned.keep(new MeshBasicMaterial({ color: MOON, transparent: true, opacity: 0.35, blending: AdditiveBlending, depthWrite: false, fog: false })),
  );
  halo.position.set(width * MOON_X_FRACTION, height * 0.22, -0.015);
  group.add(halo);

  // The mullioned frame: dark stone, an arch approximated by a lintel and
  // two mullions dividing the glass into lights.
  const frame = owned.keep(new MeshStandardMaterial({ color: albedo(STONE_700, REFLECTANCE.wallStone), roughness: 0.92, metalness: 0 }));
  const bar = (w: number, h: number, x: number, y: number): void => {
    const mesh = new Mesh(owned.keep(new BoxGeometry(w, h, 0.12)), frame);
    mesh.position.set(x, y, 0);
    group.add(mesh);
  };
  bar(width + 0.28, 0.16, 0, height / 2 + 0.06);
  bar(width + 0.28, 0.16, 0, -height / 2 - 0.06);
  bar(0.16, height + 0.2, -width / 2 - 0.06, 0);
  bar(0.16, height + 0.2, width / 2 + 0.06, 0);
  bar(0.05, height, -width / 6, 0);
  bar(0.05, height, width / 6, 0);
  bar(width, 0.05, 0, height * 0.12);

  // The cold rim: moonlight through the window, raking across the room from
  // behind. At most 25% of the key (Amendment 2), and measured against it.
  // The moon's colour at unit luminance: the token is a display colour (about
  // 4% luminance), and a light's colour carries only its hue — its strength is
  // MOONLIGHT_INTENSITY. Same correction as palette.ts albedo().
  const moonlight = new SpotLight(albedo(MOON, 1), MOONLIGHT_INTENSITY, 0, MOONLIGHT_ANGLE, MOONLIGHT_PENUMBRA, 2);
  moonlight.name = "moon";
  // From the top of the glass, down and across the room to the far shelves.
  moonlight.position.set(centre.x, centre.y + WINDOW_HEIGHT * 0.48, centre.z + 0.3);
  moonlight.target.position.copy(layout.library.centre);

  const { wax, brass } = candleMaterials(owned);
  const drapeEdge = layout.rightDrape.x + rightDrapeWidth(layout) / 2 - centre.x;
  const placements = [
    ...SCONCES.map((spot) => ({
      x: spot.side * (width / 2 + 0.2),
      y: spot.side < 0 ? SCONCE_Y.left : SCONCE_Y.right,
      z: spot.side < 0 ? SCONCE_Z.left : SCONCE_Z.right,
      periodMs: spot.periodMs,
      seed: spot.seed,
    })),
    { x: drapeEdge + DRAPE_SCONCE.fromDrapeEdge, y: DRAPE_SCONCE.height, z: DRAPE_SCONCE.depth, periodMs: DRAPE_SCONCE.periodMs, seed: DRAPE_SCONCE.seed },
  ];
  const sconces = placements.map((spot) => {
    const x = spot.x;
    const bracket = new Mesh(owned.keep(new BoxGeometry(0.16, 0.03, spot.z + 0.02)), brass);
    bracket.position.set(x, spot.y - 0.015, spot.z / 2);
    group.add(bracket);
    const built = makeCandle(owned, wax, brass, {
      base: new Vector3(x, spot.y, spot.z),
      height: 0.13,
      periodMs: spot.periodMs,
      seed: spot.seed,
      reach: 2.2,
      intensity: 0.9,
      label: "sconce",
    });
    group.add(built.object);
    return built;
  });

  return {
    object: group,
    tick: (seconds) => {
      for (const sconce of sconces) sconce.tick(seconds);
    },
    dispose: owned.dispose,
    moonlight,
  };
}

/* ------------------------------------------------------------------------ */
/* THE DRAPES                                                                 */
/* ------------------------------------------------------------------------ */

function drape(owned: Owned, material: Material, width: number, height: number, folds: number): Mesh {
  const geometry = owned.keep(new PlaneGeometry(width, height, 48, 8));
  const position = geometry.attributes.position!;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    // Sinusoidal folds, deeper toward the hem where the cloth is gathered less.
    const depth = 0.06 + 0.05 * (0.5 - y / height);
    position.setZ(i, Math.sin((x / width) * Math.PI * 2 * folds) * depth);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return new Mesh(geometry, material);
}

/** Space kept between the moon's disc and the right drape's inner edge, metres. */
const DRAPE_MOON_GAP = 0.03;
/** Narrower than this and a drape stops reading as cloth. */
const DRAPE_MIN_WIDTH = 0.28;

/** The right drape's width: as wide as it can be without covering the moon. */
export function rightDrapeWidth(layout: RoomLayout): number {
  const moonRight = layout.window.centre.x + WINDOW_WIDTH * MOON_X_FRACTION + MOON_RADIUS + DRAPE_MOON_GAP;
  return Math.min(0.9, Math.max(DRAPE_MIN_WIDTH, 2 * (layout.rightDrape.x - moonRight)));
}

export function buildDrapes(layout: RoomLayout): Built {
  const owned = new Owned();
  const group = new Group();
  group.name = "drapes";

  // Velvet: deep red, very rough, with a sheen that lifts at grazing angles —
  // which is what makes velvet read as velvet rather than as red paint.
  const velvet = owned.keep(
    new MeshPhysicalMaterial({
      color: albedo(INK_RED, REFLECTANCE.velvet),
      roughness: 0.95,
      metalness: 0,
      sheen: 0.8,
      sheenRoughness: 0.55,
      sheenColor: new Color(GOLD_400).multiplyScalar(0.35),
      side: DoubleSide,
    }),
  );

  const { centre } = layout.window;
  // Framing the window, as in the reference. The left drape hangs where it
  // always did, inside the safe band.
  const leftOfWindow = drape(owned, velvet, 0.9, 3.4, 5);
  leftOfWindow.name = "drape";
  // [R11] Flagged from the moon: on its own layer (post.ts DRAPE_LAYER).
  leftOfWindow.layers.set(DRAPE_LAYER);
  leftOfWindow.position.set(centre.x - 1.35, centre.y + 0.3, DRAPE_Z);
  group.add(leftOfWindow);

  // P2 RULING 2: the right drape comes inward to layout.rightDrape, inside the
  // safe band. From there it hangs over the glass's right edge — a curtain
  // mostly drawn back — so its width is set to stop just short of the moon,
  // which must stay in view; the extra folds are how a gathered curtain reads.
  const rightWidth = rightDrapeWidth(layout);
  const rightOfWindow = drape(owned, velvet, rightWidth, 3.4, Math.max(3, Math.round((5 * 0.9) / rightWidth)));
  rightOfWindow.name = "drape";
  rightOfWindow.layers.set(DRAPE_LAYER);
  rightOfWindow.position.set(layout.rightDrape.x, centre.y + 0.3, DRAPE_Z);
  group.add(rightOfWindow);

  // And the heavy drape at the room's upper left, over the library.
  const left = drape(owned, velvet, 1.4, 3.6, 6);
  left.name = "drape";
  left.position.set(layout.library.centre.x + 0.4, layout.library.centre.y + 1.1, BACK_WALL_Z + 0.4);
  left.rotation.y = 0.35;
  group.add(left);

  return { object: group, dispose: owned.dispose };
}
