/**
 * What hangs in the room's air: gold dust and incense haze.
 *
 * The fog itself lives on the scene (world.ts) because it is a property of
 * every material's shading, not an object. These are the two things Amendment 2
 * lists beside it: "gold dust as instanced points; incense haze as two additive
 * sprites".
 *
 * THE DUST IS ONE DRAW CALL. Points, not meshes: a few hundred motes as one
 * buffer, drifting by a transform on the whole cloud plus a per-mote bob in the
 * vertex shader, so their motion costs the CPU nothing per mote.
 *
 * SEEDED, like every generated thing in the sanctuary, so two captures of the
 * same moment are the same picture and the harness can compare them.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  Group,
  LinearFilter,
  Mesh,
  PlaneGeometry,
  Points,
  RedFormat,
  ShaderMaterial,
  UnsignedByteType,
} from "three";
import type { RoomLayout } from "./layout";
import { GOLD_400, GOLD_500 } from "./palette";
import type { Built } from "./props";

/** How many motes. Enough to catch the light, few enough to be free. */
export const DUST_COUNT = 260;

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A soft, lumpy puff: radial falloff broken up by low-frequency noise. */
function hazeTexture(size = 128, seed = 0x7a11): DataTexture {
  const random = seeded(seed);
  const blobs = Array.from({ length: 7 }, () => ({ x: random(), y: random(), r: 0.18 + random() * 0.22 }));
  const data = new Uint8Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / (size - 1);
      const w = y / (size - 1);
      let density = 0;
      for (const blob of blobs) {
        const d = Math.hypot(u - blob.x, w - blob.y) / blob.r;
        density += Math.max(0, 1 - d * d);
      }
      const edge = Math.max(0, 1 - Math.hypot(u - 0.5, w - 0.5) * 2);
      data[y * size + x] = Math.round(Math.min(1, density * 0.45) * edge * 255);
    }
  }
  const texture = new DataTexture(data, size, size, RedFormat, UnsignedByteType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function buildAtmosphere(layout: RoomLayout): Built {
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(item: T): T => {
    disposables.push(item);
    return item;
  };
  const group = new Group();
  group.name = "atmosphere";

  /* ---- Gold dust ---------------------------------------------------- */
  const random = seeded(0x2d17);
  const positions = new Float32Array(DUST_COUNT * 3);
  const phases = new Float32Array(DUST_COUNT);
  const { centre } = layout.pedestal;
  for (let i = 0; i < DUST_COUNT; i += 1) {
    // Denser around the pedestal, where the key lights them.
    const spread = random() < 0.6 ? 1.6 : 4.2;
    positions[i * 3] = centre.x + (random() - 0.5) * spread * 2;
    positions[i * 3 + 1] = 0.2 + random() * 2.6;
    positions[i * 3 + 2] = centre.z + (random() - 0.5) * spread * 1.4;
    phases[i] = random() * Math.PI * 2;
  }
  const dustGeometry = keep(new BufferGeometry());
  dustGeometry.setAttribute("position", new BufferAttribute(positions, 3));
  dustGeometry.setAttribute("aPhase", new BufferAttribute(phases, 1));

  const dustMaterial = keep(
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uColour: { value: new Color(GOLD_400) }, uSize: { value: 22 } },
      vertexShader: /* glsl */ `
        attribute float aPhase;
        uniform float uTime; uniform float uSize;
        varying float vTwinkle;
        void main() {
          vec3 p = position;
          p.y += sin(uTime * 0.21 + aPhase) * 0.05;
          p.x += cos(uTime * 0.17 + aPhase * 1.3) * 0.04;
          vec4 view = modelViewMatrix * vec4(p, 1.0);
          vTwinkle = 0.55 + 0.45 * sin(uTime * 0.8 + aPhase * 2.0);
          gl_PointSize = uSize / -view.z;
          gl_Position = projectionMatrix * view;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColour;
        varying float vTwinkle;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.0, d);
          gl_FragColor = vec4(uColour * a * vTwinkle * 0.55, a * vTwinkle * 0.55);
        }`,
    }),
  );
  const dust = new Points(dustGeometry, dustMaterial);
  dust.frustumCulled = false;
  group.add(dust);

  /* ---- Incense haze: two additive sprites --------------------------- */
  const puff = keep(hazeTexture());
  const hazeMaterial = (opacity: number): ShaderMaterial =>
    keep(
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: { uMap: { value: puff }, uColour: { value: new Color(GOLD_500) }, uOpacity: { value: opacity }, uTime: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap; uniform vec3 uColour; uniform float uOpacity; uniform float uTime;
          varying vec2 vUv;
          void main() {
            vec2 uv = vUv + vec2(sin(uTime * 0.05) * 0.03, -uTime * 0.012);
            float density = texture2D(uMap, fract(uv)).r;
            gl_FragColor = vec4(uColour * density * uOpacity, density * uOpacity);
          }`,
      }),
    );

  const hazes: { mesh: Mesh; material: ShaderMaterial; rise: number }[] = [];
  const hazeSpecs = [
    { x: centre.x - layout.pedestal.radius * 1.4, z: centre.z + 0.3, w: 1.6, h: 2.4, opacity: 0.1, rise: 0.02 },
    { x: centre.x + layout.pedestal.radius * 0.6, z: centre.z - 0.6, w: 2.4, h: 2.0, opacity: 0.07, rise: 0.013 },
  ];
  for (const spec of hazeSpecs) {
    const material = hazeMaterial(spec.opacity);
    const mesh = new Mesh(keep(new PlaneGeometry(spec.w, spec.h)), material);
    mesh.position.set(spec.x, spec.h / 2 + 0.3, spec.z);
    group.add(mesh);
    hazes.push({ mesh, material, rise: spec.rise });
  }

  return {
    object: group,
    tick: (seconds) => {
      dustMaterial.uniforms.uTime!.value = seconds;
      dust.rotation.y = seconds * 0.006;
      for (const haze of hazes) haze.material.uniforms.uTime!.value = seconds;
    },
    dispose: () => {
      for (const item of disposables) item.dispose();
      disposables.length = 0;
    },
  };
}
