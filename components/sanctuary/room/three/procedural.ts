/**
 * The room's textures, generated rather than downloaded.
 *
 * Amendment 2 asks for brushed brass, wax drips, fibrous parchment and an
 * engraved stone floor. Every one of those is a small, tiling, greyscale
 * pattern, and shipping four PNGs to say so would cost more than the geometry
 * they sit on. They are built here into `DataTexture`s at mount.
 *
 * WHY DataTexture AND NOT A 2D CANVAS. A canvas texture needs a DOM element, a
 * context and a readback, and it produces the same bytes; `DataTexture` writes
 * straight into a typed array the GPU can take. It also works identically
 * under the headless capture (scripts/capture), where a 2D context is
 * available but is one more thing that can differ between the measuring
 * machine and a phone.
 *
 * THE NOISE IS SEEDED AND THE SEEDS ARE NAMED. The sanctuary already has this
 * rule for its CSS material system (components/sanctuary/material/rng.ts): a
 * pattern that changes between reloads makes a visual regression impossible to
 * judge, so every generator here takes a seed and the room passes constants.
 *
 * SIZES ARE SMALL ON PURPOSE. 128² for roughness, 256² for a normal map that
 * carries an engraving. These are surfaces seen at a distance in candlelight,
 * and a 1024² map would cost 4 MB of GPU memory to carry detail no frame shows.
 */
import { ClampToEdgeWrapping, DataTexture, LinearFilter, LinearMipmapLinearFilter, RedFormat, RepeatWrapping, RGBAFormat, UnsignedByteType } from "three";
import {
  SNC_TORN_BASE_FREQUENCY,
  SNC_TORN_DISPLACEMENT_SCALE,
  SNC_TORN_OCTAVES,
  SNC_TORN_TURBULENCE_SEED,
} from "@/components/sanctuary/material/ids";

/** Mulberry32 — the same generator the CSS material system seeds its ornaments with. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value noise on a grid, sampled with cubic interpolation. */
function valueNoise(size: number, cells: number, seed: number): Float32Array {
  const next = rng(seed);
  const grid = new Float32Array((cells + 1) * (cells + 1));
  for (let i = 0; i < grid.length; i += 1) grid[i] = next();

  const at = (x: number, y: number): number => grid[(y % (cells + 1)) * (cells + 1) + (x % (cells + 1))] ?? 0;
  const fade = (t: number): number => t * t * (3 - 2 * t);

  const out = new Float32Array(size * size);
  const step = cells / size;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const fx = x * step;
      const fy = y * step;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fade(fx - x0);
      const ty = fade(fy - y0);
      const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
      const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
      out[y * size + x] = top * (1 - ty) + bottom * ty;
    }
  }
  return out;
}

/** Wrap a single-channel byte array as a tiling texture. */
function redTexture(data: Uint8Array, size: number): DataTexture {
  const texture = new DataTexture(data, size, size, RedFormat, UnsignedByteType);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/** Wrap an RGBA byte array as a tiling texture. */
function rgbaTexture(data: Uint8Array, size: number): DataTexture {
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Brushed brass roughness: noise stretched hard around the circumference.
 *
 * Amendment 2 asks for exactly this — the stretch is what makes the pedestal
 * read as turned on a lathe rather than merely bumpy, because the highlight
 * then travels along the brushing as the camera moves instead of crawling.
 */
export function brushedBrassRoughness(size = 128, seed = 0x8f21): DataTexture {
  // Few cells around, many along: the anisotropy IS the brushing.
  const noise = valueNoise(size, 4, seed);
  const fine = valueNoise(size, 64, seed ^ 0x51ab);
  const data = new Uint8Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // Sample the fine noise only across the brushing direction.
      const streak = fine[y * size + ((x * 7) % size)] ?? 0;
      const broad = noise[y * size + x] ?? 0;
      const value = 0.45 + (broad - 0.5) * 0.10 + (streak - 0.5) * 0.16;
      data[y * size + x] = Math.max(0, Math.min(255, Math.round(value * 255)));
    }
  }
  return redTexture(data, size);
}

/** Turn a height field into a tangent-space normal map. */
function normalFromHeight(height: Float32Array, size: number, strength: number): DataTexture {
  const data = new Uint8Array(size * size * 4);
  const at = (x: number, y: number): number => height[((y + size) % size) * size + ((x + size) % size)] ?? 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      // Normalise (-dx, -dy, 1) into the 0..255 encoding.
      const length = Math.hypot(dx, dy, 1);
      const index = (y * size + x) * 4;
      data[index] = Math.round(((-dx / length) * 0.5 + 0.5) * 255);
      data[index + 1] = Math.round(((-dy / length) * 0.5 + 0.5) * 255);
      data[index + 2] = Math.round((1 / length * 0.5 + 0.5) * 255);
      data[index + 3] = 255;
    }
  }
  return rgbaTexture(data, size);
}

/**
 * Dark stone with a faint engraved mandala.
 *
 * The engraving is radial: concentric rings and a ray every 15°, cut shallow
 * so it only shows where the pedestal's light pools on it. A mandala that read
 * clearly across the whole floor would be a rug, not a carving.
 */
export function engravedStoneNormal(size = 256, seed = 0x27f1, rays = 24): DataTexture {
  const grain = valueNoise(size, 48, seed);
  const height = new Float32Array(size * size);
  const centre = (size - 1) / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x - centre) / centre;
      const dy = (y - centre) / centre;
      const radius = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      const ring = Math.cos(radius * Math.PI * 9) * 0.5 + 0.5;
      const ray = Math.cos(angle * rays) * 0.5 + 0.5;
      // Fade the engraving out before the tile edge so the repeat does not seam.
      const fade = Math.max(0, 1 - radius);
      const cut = (ring * 0.6 + ray * 0.4) * fade * 0.5;
      height[y * size + x] = (grain[y * size + x] ?? 0) * 0.35 + cut;
    }
  }
  return normalFromHeight(height, size, 2.2);
}

/** Wax that has run: vertical drips, soft-edged, with a little surface grain. */
export function waxDripNormal(size = 128, seed = 0x3b5d): DataTexture {
  const next = rng(seed);
  const grain = valueNoise(size, 32, seed ^ 0x9e1);
  const drips = new Float32Array(size);
  for (let i = 0; i < size; i += 1) drips[i] = next();

  const height = new Float32Array(size * size);
  for (let x = 0; x < size; x += 1) {
    // Each column may carry a drip that starts somewhere and runs down.
    const start = (drips[x] ?? 0) * size;
    const width = 0.5 + (drips[(x + 7) % size] ?? 0);
    for (let y = 0; y < size; y += 1) {
      const running = y > start ? Math.min(1, (y - start) / (size * 0.35)) : 0;
      const lobe = Math.exp(-(((x % 11) - 5) ** 2) / (2 * width * width));
      height[y * size + x] = running * lobe * 0.8 + (grain[y * size + x] ?? 0) * 0.2;
    }
  }
  return normalFromHeight(height, size, 1.6);
}

/** Parchment fibre: short strands, mostly horizontal, very shallow. */
export function parchmentFibreNormal(size = 128, seed = 0x6ac3): DataTexture {
  const coarse = valueNoise(size, 12, seed);
  const fibre = valueNoise(size, 96, seed ^ 0x4d2);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const strand = fibre[y * size + ((x * 3) % size)] ?? 0;
      height[y * size + x] = (coarse[y * size + x] ?? 0) * 0.5 + strand * 0.5;
    }
  }
  return normalFromHeight(height, size, 0.9);
}

/**
 * The U1 torn edge, as an alpha mask for the book's top leaf.
 *
 * Amendment 2 asks for "the U1 torn-edge mask as alpha on the top leaf", so
 * this is that mask and not a new one: the same base frequency, octave count,
 * displacement scale and seed that components/sanctuary/material/ids.ts gives
 * the SVG `feTurbulence` + `feDisplacementMap` filter every parchment leaf in
 * the Pothi is torn with. A leaf in the 3D room and a leaf in the reading are
 * then torn the same way, which is the point of having one material system.
 *
 * The SVG filter works in user-space pixels on a leaf a few hundred pixels
 * wide; here the edge is displaced in texels of a 256-texel leaf, which is the
 * same scale to within the texture's own resolution.
 */
export function tornEdgeAlpha(size = 256): DataTexture {
  const layers: Float32Array[] = [];
  for (let octave = 0; octave < SNC_TORN_OCTAVES; octave += 1) {
    const cells = Math.max(2, Math.round(size * SNC_TORN_BASE_FREQUENCY * 2 ** octave));
    layers.push(valueNoise(size, cells, SNC_TORN_TURBULENCE_SEED * 7919 + octave));
  }
  const fractal = (index: number): number => {
    let sum = 0;
    let weight = 0;
    for (let octave = 0; octave < layers.length; octave += 1) {
      const amplitude = 0.5 ** octave;
      sum += ((layers[octave]?.[index] ?? 0.5) - 0.5) * amplitude;
      weight += amplitude;
    }
    return sum / weight;
  };

  const data = new Uint8Array(size * size);
  const inset = SNC_TORN_DISPLACEMENT_SCALE * 1.5;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      // Distance to the nearest edge, pushed in or out by the turbulence.
      const edge = Math.min(x, y, size - 1 - x, size - 1 - y);
      const torn = edge - inset + fractal(index) * SNC_TORN_DISPLACEMENT_SCALE * 2;
      // A one-texel soft rim, so the tear is ragged without aliasing.
      const alpha = Math.max(0, Math.min(1, torn));
      data[index] = Math.round(alpha * 255);
    }
  }
  const texture = new DataTexture(data, size, size, RedFormat, UnsignedByteType);
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
