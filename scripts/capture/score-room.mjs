/**
 * Score the 3D room against its art-direction checklist, with numbers.
 *
 * docs/specs/loop-harness.md §1: "every item of the part's art-direction
 * checklist is scored PASS / FAIL, each with the measurement that decided it."
 * This is those measurements. Each one is a CONTROLLED COMPARISON rather than a
 * single number read off a frame, because a single frame cannot say why a pixel
 * is bright:
 *
 *   one warm key       each light rendered ALONE; the key must out-light every
 *                      other light by 2x, and be the only warm point light
 *   rim <= 25% key     the pedestal lit by the rim alone vs the key alone
 *   bloom confined     the room with bloom and without; the difference is the
 *                      bloom, and it must fall on light SOURCES — flames, the
 *                      ring, the hologram — not on lit brass, parchment, stone
 *   flicker lands      everything held still, the candles set to the bottom and
 *                      the top of their flicker; the pedestal and the book
 *                      must each change visibly between the two
 *   shelves recede     the library with fog and without; it must be visible,
 *                      and the fog must be doing measurable work on it
 *   brass is brass     the camera moved; the pedestal's brightest point must
 *                      SLIDE across the drum, which a diffuse surface cannot do
 *   no cyan            every pixel of the canvas, by hue
 *
 * THE THRESHOLDS WERE FIXED BEFORE THE FIRST SCORE WAS READ, and are constants
 * below. Moving one after seeing a result is tuning the measurement until it
 * agrees, which is the thing the harness exists to prevent; if a threshold is
 * wrong, the change and its reason belong in the commit message.
 *
 * Reads pixels straight off the canvas with gl.readPixels, in the same task as
 * the render, so the nav rail and the HTML overlay never enter a measurement.
 *
 *   node scripts/capture/score-room.mjs            # uses the existing build
 *   node scripts/capture/score-room.mjs --build    # rebuilds with SNC_MEASURE=1
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { buildProduction, startServer, THRESHOLD_SEEN, THRESHOLD_STORAGE_KEY } from "./capture.mjs";
import { GPU_ARGS, isSoftware, readRenderer } from "./gpu-probe.mjs";

const REPO = resolve(import.meta.dirname, "..", "..");

/** Fixed before the first score. See the header. */
export const THRESHOLDS = {
  keyDominance: 2.0, //        key contribution >= 2x any other single light
  rimFraction: 0.25, //        moon <= 25% of key, on the pedestal AND over the frame
  //                              (Amendment 2; the frame half added with P2 ruling 3,
  //                              which reads the cap literally — stricter, not looser)
  rimVisible: 0.0008, //       and the rim must actually light something: added
  //                              after iteration 1, when the rim measured 0.00% and
  //                              passed the cap vacuously. This makes the check
  //                              stricter, never looser.
  bloomOnSurfaces: 0.1, //     <= 10% of bloom energy may land on lit surfaces
  flickerSwing: 0.02, //       >= 2% luminance swing on a surface, candles low->high
  shelfVisible: 0.03, //       library mean luminance >= 3% (not black)
  fogWork: 0.25, //            fog removes >= 25% of the library's luminance
  highlightSlide: 6, //        brightest point slides >= 6 px relative to the drum
  cyanFraction: 0.0005, //     < 0.05% of pixels cyan
  // Added after iteration 1 because the checklist had items the first scorer
  // did not measure at all — each threshold set BEFORE its first run:
  palmLines: 0.005, //         ring pixels over the palm <= 0.5% of the palm ([A2])
  handVolume: 0.2, //          hand interior >= 20% of its silhouette (a volume, A1)
  bookVisible: 0.04, //        book region mean luminance >= 4% (parchment reads)
  drapesVisible: 0.015, //     drape regions mean luminance >= 1.5% (velvet, not void)
};

/**
 * The two regions still drawn as stage boxes [x0, y0, x1, y1]: the drum's face,
 * where the key and the rim are compared, and the library. The flicker regions
 * [R10], the book and the drapes are derived per pixel from an object-ID and
 * world-position render (P2 rulings 1 and 2), not from boxes.
 */
const REGIONS = {
  pedestalFace: [360, 600, 700, 720],
  library: [60, 180, 380, 560],
};

async function scoreInPage({ regions }) {
  const room = window.__sncRoom;
  await room.world.settled;
  room.pause();
  const { renderer, world, post } = room;
  const gl = renderer.getContext();
  const T = 1.0;

  const grab = () => {
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return { w, h, px };
  };
  const shot = (t = T) => {
    room.renderAt(t);
    return grab();
  };
  // sRGB byte -> linear, then Rec.709 luminance, 0..1.
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const lumAt = (img, i) => 0.2126 * lin(img.px[i]) + 0.7152 * lin(img.px[i + 1]) + 0.0722 * lin(img.px[i + 2]);
  // Stage box -> the pixels it covers (readPixels rows are bottom-up).
  const pixelsIn = (img, [x0, y0, x1, y1]) => {
    const out = [];
    const px0 = Math.floor((x0 / 1600) * img.w);
    const px1 = Math.ceil((x1 / 1600) * img.w);
    const py0 = Math.floor((y0 / 900) * img.h);
    const py1 = Math.ceil((y1 / 900) * img.h);
    for (let y = py0; y < py1; y += 2) {
      for (let x = px0; x < px1; x += 2) {
        out.push(((img.h - 1 - y) * img.w + x) * 4);
      }
    }
    return out;
  };
  const meanLum = (img, box) => {
    const idx = pixelsIn(img, box);
    return idx.reduce((sum, i) => sum + lumAt(img, i), 0) / Math.max(1, idx.length);
  };
  const frameLum = (img) => meanLum(img, [0, 0, 1600, 900]);

  /* ---- lights ------------------------------------------------------- */
  const lights = [];
  world.scene.traverse((node) => {
    if (node.isLight) lights.push(node);
  });
  // Intensities are set AFTER the tick. renderAt() runs world.tick(), and the
  // candles' tick writes their flicker intensity back — the first version of
  // this scorer set intensities before rendering, so the candles came back on
  // in every render, including the all-dark baseline, and cancelled out of
  // every comparison: they read 0.0000 and the key read 973x dominant. That was
  // a measurement artefact. Tick first, then override, then render the post
  // stack directly.
  const saved = lights.map((l) => l.intensity);
  const lit = (setup) => {
    world.tick(T);
    setup();
    post.render(T);
    return grab();
  };
  const only = (target) => () => lights.forEach((l, i) => (l.intensity = l === target ? saved[i] : 0));
  const none = () => lights.forEach((l) => (l.intensity = 0));
  const restore = () => lights.forEach((l, i) => (l.intensity = saved[i]));

  const darkImg = lit(none);
  const dark = frameLum(darkImg);
  const darkPedestal = meanLum(darkImg, regions.pedestalFace);
  restore();

  const contribution = lights.map((light) => {
    const img = lit(only(light));
    const c = {
      name: light.name || light.type,
      type: light.type,
      colour: `#${light.color.getHexString()}`,
      frame: frameLum(img) - dark,
      pedestal: meanLum(img, regions.pedestalFace) - darkPedestal,
    };
    restore();
    return c;
  });

  const key = contribution.find((c) => c.name === "key");
  const others = contribution.filter((c) => c !== key && c.type !== "AmbientLight");
  const strongestOther = Math.max(0, ...others.map((c) => c.frame));
  const warmPoints = lights.filter((l) => l.isPointLight && l.color.r > l.color.b && l.name === "key");

  /* ---- bloom: WHAT crosses the threshold, object by object ---------- */
  // ITERATION 3. The first version measured where bloom's HALO landed, inside
  // hand-drawn stage boxes. But the "floor" box contains the candle flames,
  // which are ALLOWED to bloom, so their halos were counted as surface bloom.
  // Amendment 2 says bloom is "confined to candles and the ring": a statement
  // about which things BLOOM, i.e. which pixels cross the threshold. So this
  // renders linear HDR — what the bloom pass itself reads — and asks, of every
  // pixel above the threshold, whether it belongs to a candle, the hologram
  // (whose base ring is "the ring"), or the zodiac face; anything else is a
  // violation. The 10% bar is unchanged.
  const threshold = post.bloom.threshold;
  const BW = gl.drawingBufferWidth;
  const BH = gl.drawingBufferHeight;
  const target = room.hdrTarget(BW, BH);
  const readHdr = () => {
    renderer.setRenderTarget(target);
    renderer.render(world.scene, world.camera);
    const buf = new Float32Array(BW * BH * 4);
    renderer.readRenderTargetPixels(target, 0, 0, BW, BH, buf);
    renderer.setRenderTarget(null);
    return buf;
  };
  const hdrLum = (buf, i) => 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
  // STRICTER in iteration 5: "candles and the ring", read literally. Earlier
  // iterations also allowed the whole hologram; the hand is meant to be a FAINT
  // volume (Amendment 1), and blooming would contradict that.
  const allowedAncestor = (node) => {
    for (let n = node; n; n = n.parent) {
      if (n.name === "candle" || n.name === "ring") return true;
      if (n.name === "pedestal" && node.geometry?.type === "CircleGeometry") return true;
    }
    return false;
  };

  // Read what the bloom pass actually sees: the scene through BLOOM_LAYER.
  // ITERATION 5 — bloom is confined by construction (post.ts), so the honest
  // measurement is of that pass's input, not of the whole frame.
  const BLOOM_LAYER = 1;
  let offLayer = 0;
  world.scene.traverse((node) => {
    if ((node.isMesh || node.isPoints) && node.layers.isEnabled(BLOOM_LAYER) && !allowedAncestor(node)) offLayer += 1;
  });
  world.tick(T);
  const layersWas = world.camera.layers.mask;
  world.camera.layers.set(BLOOM_LAYER);
  const hdrFull = readHdr();
  world.camera.layers.mask = layersWas;

  // The hdrAllowed mask: only candles, the hologram and the zodiac face, drawn on
  // black with no fog, so any lit pixel is theirs.
  const drawn = [];
  world.scene.traverse((node) => {
    if (node.isMesh || node.isPoints) drawn.push([node, node.visible]);
  });
  const background = world.scene.background;
  const fogDensity = world.scene.fog.density;
  world.scene.background = null;
  world.scene.fog.density = 0;
  for (const [node] of drawn) node.visible = allowedAncestor(node);
  const hdrAllowed = readHdr();
  for (const [node, was] of drawn) node.visible = was;
  world.scene.background = background;
  world.scene.fog.density = fogDensity;
  target.dispose();

  let totalBloom = 0;
  let bloomOnSurfaces = 0;
  let sourcePx = 0;
  let violationPx = 0;
  let worstViolation = 0;
  for (let i = 0; i < hdrFull.length; i += 4) {
    const l = hdrLum(hdrFull, i);
    if (l <= threshold) continue;
    const energy = l - threshold;
    totalBloom += energy;
    sourcePx += 1;
    if (hdrLum(hdrAllowed, i) < 1e-4) {
      bloomOnSurfaces += energy;
      violationPx += 1;
      if (l > worstViolation) worstViolation = l;
    }
  }

  /* ---- object ID and world position, per pixel ---------------------- */
  // P2 rulings 1 and 2: every measured region is derived from the scene, not
  // drawn by eye. One render writes, for each pixel, the world position of the
  // surface it shows (rgb) and which object that surface belongs to (alpha).
  // Things that do not occlude — additive light, dust, haze, decals — are left
  // out, so a pixel is attributed to the surface a reader actually sees there.
  const ID = { background: 0, other: 1, floor: 2, drum: 3, lecternTop: 4, parchment: 5, candle: 6, drape: 10 };
  const idTarget = room.hdrTarget(BW, BH);
  const swapped = [];
  let drapeIndex = 0;
  const drapeIds = [];
  const idOf = (node) => {
    for (let n = node; n; n = n.parent) if (n.name === "candle") return ID.candle;
    if (node.name === "floor") return ID.floor;
    if (node.name === "drum") return ID.drum;
    if (node.name === "lectern-top") return ID.lecternTop;
    if (node.name === "parchment") return ID.parchment;
    if (node.name === "drape") {
      const id = ID.drape + drapeIndex;
      drapeIds.push({ id, node });
      drapeIndex += 1;
      return id;
    }
    return ID.other;
  };
  // The ShaderMaterial class, reached through a material the scene already
  // holds (the page has no `three` import of its own).
  let MaterialClass = null;
  world.scene.traverse((node) => {
    if (!MaterialClass && node.material?.isShaderMaterial) MaterialClass = node.material.constructor;
  });
  world.tick(T);
  world.scene.traverse((node) => {
    if (!(node.isMesh || node.isPoints)) return;
    const material = node.material;
    const occludes = node.isMesh && (!material.transparent || material.alphaTest > 0);
    swapped.push([node, node.material, node.visible]);
    if (!occludes) {
      node.visible = false;
      return;
    }
    node.material = new MaterialClass({
      uniforms: { uId: { value: idOf(node) } },
      side: material.side,
      vertexShader: `
        varying vec3 vWorld;
        void main() {
          vec4 p = vec4(position, 1.0);
          #ifdef USE_INSTANCING
          p = instanceMatrix * p;
          #endif
          vec4 w = modelMatrix * p;
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: `
        uniform float uId;
        varying vec3 vWorld;
        void main() { gl_FragColor = vec4(vWorld, uId); }`,
    });
  });
  const bgWas = world.scene.background;
  world.scene.background = null;
  const clearAlphaWas = renderer.getClearAlpha();
  renderer.setClearAlpha(0);
  renderer.setRenderTarget(idTarget);
  renderer.clear();
  renderer.render(world.scene, world.camera);
  const geo = new Float32Array(BW * BH * 4);
  renderer.readRenderTargetPixels(idTarget, 0, 0, BW, BH, geo);
  renderer.setRenderTarget(null);
  renderer.setClearAlpha(clearAlphaWas);
  world.scene.background = bgWas;
  for (const [node, material, visible] of swapped) {
    if (node.material !== material) node.material.dispose();
    node.material = material;
    node.visible = visible;
  }
  idTarget.dispose();
  const idAt = (i) => Math.round(geo[i + 3]);

  /* ---- [R10] where the candles physically light ---------------------- */
  const holders = [];
  world.scene.traverse((node) => {
    if (node.name === "candle") holders.push(node);
  });
  const flameOf = (holder) => {
    const light = holder.children.find((c) => c.isPointLight);
    return light.getWorldPosition(light.position.clone());
  };
  const pedestalCandles = holders
    .filter((h) => h.userData.label === "pedestal-left" || h.userData.label === "pedestal-right")
    .map((h) => {
      const base = h.getWorldPosition(h.position.clone());
      const flame = flameOf(h);
      // The IES field convention: the pool is where the candle's own floor
      // illuminance is >= 10% of its peak, i.e. radius h * sqrt(10^(2/3) - 1).
      const radius = flame.y * Math.sqrt(10 ** (2 / 3) - 1);
      return { label: h.userData.label, base, flame, radius };
    });
  const axis = world.layout.pedestal.centre;
  const drumHeight = world.layout.pedestal.height;
  const FOOT_BAND = 1 / 3;
  const FOOT_ARC = Math.PI / 4;
  const drumFoot = [];
  const floorPool = [];
  const bookNear = [];
  const lecternHolder = holders.find((h) => h.userData.label === "lectern");
  const lecternFlame = lecternHolder ? flameOf(lecternHolder) : null;
  const bookCandidates = [];
  for (let i = 0; i < geo.length; i += 4) {
    const id = idAt(i);
    const x = geo[i];
    const y = geo[i + 1];
    const z = geo[i + 2];
    if (id === ID.drum && y <= drumHeight * FOOT_BAND) {
      const ax = x - axis.x;
      const az = z - axis.z;
      const facing = pedestalCandles.some((c) => {
        const cx = c.base.x - axis.x;
        const cz = c.base.z - axis.z;
        const cos = (ax * cx + az * cz) / Math.max(1e-9, Math.hypot(ax, az) * Math.hypot(cx, cz));
        return Math.acos(Math.max(-1, Math.min(1, cos))) <= FOOT_ARC;
      });
      if (facing) drumFoot.push(i);
    } else if (id === ID.floor) {
      if (pedestalCandles.some((c) => Math.hypot(x - c.base.x, z - c.base.z) <= c.radius)) floorPool.push(i);
    } else if ((id === ID.lecternTop || id === ID.parchment) && lecternFlame) {
      bookCandidates.push([i, Math.hypot(x - lecternFlame.x, y - lecternFlame.y, z - lecternFlame.z)]);
    }
  }
  // The book: the nearest quarter of the lectern-top and parchment pixels' range
  // of distance from its candle's flame — the edge nearest it, not the centre.
  let bookNearCut = 0;
  if (bookCandidates.length > 0) {
    let dMin = Infinity;
    let dMax = -Infinity;
    for (const [, d] of bookCandidates) {
      if (d < dMin) dMin = d;
      if (d > dMax) dMax = d;
    }
    bookNearCut = dMin + 0.25 * (dMax - dMin);
    for (const [i, d] of bookCandidates) if (d <= bookNearCut) bookNear.push(i);
  }
  const parchmentPx = [];
  const drapePx = new Map(drapeIds.map(({ id }) => [id, []]));
  for (let i = 0; i < geo.length; i += 4) {
    const id = idAt(i);
    if (id === ID.parchment) parchmentPx.push(i);
    else if (drapePx.has(id)) drapePx.get(id).push(i);
  }

  /* ---- flicker on surfaces ----------------------------------------- */
  const candles = lights.filter((l) => l.isPointLight && l.name !== "key");
  const candleSaved = candles.map((l) => l.intensity);
  // The flicker's own range, from props.ts flicker(): 0.69 .. 0.95 of nominal.
  const setCandles = (factor) => candles.forEach((l, i) => (l.intensity = (candleSaved[i] / 0.82) * factor));
  // Tick once at T, then override the candles AFTER the tick so the tick's own
  // flicker does not overwrite them; render the composer directly.
  const shotCandles = (factor) => {
    world.tick(T);
    setCandles(factor);
    post.render(T);
    return grab();
  };
  const low = shotCandles(0.69);
  const high = shotCandles(0.95);
  candles.forEach((l, i) => (l.intensity = candleSaved[i]));
  const meanOver = (img, indices) => indices.reduce((sum, i) => sum + lumAt(img, i), 0) / Math.max(1, indices.length);
  const swing = (indices) => {
    const a = meanOver(low, indices);
    const b = meanOver(high, indices);
    return { pixels: indices.length, low: a, high: b, swing: (b - a) / Math.max(1e-6, (a + b) / 2) };
  };

  /* ---- fog ---------------------------------------------------------- */
  const density = world.scene.fog.density;
  const fogOn = meanLum(shot(), regions.library);
  world.scene.fog.density = 0;
  const fogOff = meanLum(shot(), regions.library);
  world.scene.fog.density = density;

  /* ---- specular slides --------------------------------------------- */
  const cam = world.camera;
  const home = cam.position.clone();
  const brightest = (img, box) => {
    let best = -1;
    let at = [0, 0];
    const [x0, y0, x1, y1] = box;
    for (let y = Math.floor((y0 / 900) * img.h); y < Math.ceil((y1 / 900) * img.h); y += 1) {
      for (let x = Math.floor((x0 / 1600) * img.w); x < Math.ceil((x1 / 1600) * img.w); x += 1) {
        const l = lumAt(img, ((img.h - 1 - y) * img.w + x) * 4);
        if (l > best) {
          best = l;
          at = [x, y];
        }
      }
    }
    return at;
  };
  // Where a fixed point on the drum lands, to separate "the highlight moved"
  // from "the whole drum moved on screen".
  const drumPoint = world.layout.pedestal.centre.clone();
  drumPoint.y *= 0.5;
  drumPoint.z += world.layout.pedestal.radius;
  const screenOf = (p, img) => {
    const q = p.clone().project(cam);
    return [((q.x + 1) / 2) * img.w, ((1 - q.y) / 2) * img.h];
  };
  post.bloom.enabled = false;
  const box = [300, 580, 760, 740];
  const a = shot();
  const hA = brightest(a, box);
  const dA = screenOf(drumPoint, a);
  cam.position.x = home.x + 0.35;
  cam.updateMatrixWorld(true);
  const b = shot();
  const hB = brightest(b, box);
  const dB = screenOf(drumPoint, b);
  cam.position.copy(home);
  cam.updateMatrixWorld(true);
  post.bloom.enabled = true;
  const slide = Math.hypot(hB[0] - hA[0] - (dB[0] - dA[0]), hB[1] - hA[1] - (dB[1] - dA[1]));

  /* ---- the hologram, part by part --------------------------------- */
  // Render straight through the renderer (tone mapped, no bloom, no grain) with
  // everything hidden but one part, so a mask is that part and nothing else.
  const hologram = world.scene.getObjectByName("hologram");
  const topLevel = [...world.scene.children];
  const visibleWas = new Map(topLevel.map((o) => [o, o.visible]));
  const partsWas = new Map(hologram.children.map((o) => [o, o.visible]));
  const isolate = (keep) => {
    for (const o of topLevel) o.visible = o === hologram;
    for (const o of hologram.children) o.visible = keep(o);
    world.tick(T);
    renderer.render(world.scene, cam);
    const img = grab();
    for (const [o, v] of visibleWas) o.visible = v;
    for (const [o, v] of partsWas) o.visible = v;
    return img;
  };
  const handImg = isolate((o) => o.name === "hand");
  const ringImg = isolate((o) => o.name === "orbit");
  const MASK = 0.01;
  const W = handImg.w;
  const H = handImg.h;
  const hand = new Uint8Array(W * H);
  let top = H;
  let bottom = -1;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = ((H - 1 - y) * W + x) * 4;
      if (lumAt(handImg, i) > MASK) {
        hand[y * W + x] = 1;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  // The palm: the hand's lower 55%, below where the fingers leave it.
  const palmFrom = top + (bottom - top) * 0.45;
  let palmPx = 0;
  let ringOnPalm = 0;
  let interiorSum = 0;
  let interiorN = 0;
  let edgeSum = 0;
  let edgeN = 0;
  const R = 3; // erosion radius, px
  for (let y = R; y < H - R; y += 1) {
    for (let x = R; x < W - R; x += 1) {
      if (!hand[y * W + x]) continue;
      const i = ((H - 1 - y) * W + x) * 4;
      if (y >= palmFrom) {
        palmPx += 1;
        if (lumAt(ringImg, i) > MASK) ringOnPalm += 1;
      }
      const inside = hand[(y - R) * W + x] && hand[(y + R) * W + x] && hand[y * W + x - R] && hand[y * W + x + R];
      const l = lumAt(handImg, i);
      if (inside) {
        interiorSum += l;
        interiorN += 1;
      } else {
        edgeSum += l;
        edgeN += 1;
      }
    }
  }

  /* ---- the book and the drapes ------------------------------------- */
  // P2 ruling 2: each object's own silhouette, from the ID render.
  const everything = shot();
  const book = { pixels: parchmentPx.length, lum: meanOver(everything, parchmentPx) };
  const drapes = drapeIds.map(({ id }) => {
    const px = drapePx.get(id);
    let sx = 0;
    for (const i of px) sx += (((i / 4) % BW) / BW) * 1600;
    return { pixels: px.length, at: Math.round(sx / Math.max(1, px.length)), lum: meanOver(everything, px) };
  });

  /* ---- cyan --------------------------------------------------------- */
  const full = shot();
  let cyan = 0;
  let counted = 0;
  for (let i = 0; i < full.px.length; i += 16) {
    const r = full.px[i] / 255;
    const g = full.px[i + 1] / 255;
    const bl = full.px[i + 2] / 255;
    const max = Math.max(r, g, bl);
    const min = Math.min(r, g, bl);
    counted += 1;
    if (max < 0.2 || max - min < 0.35 * max) continue;
    let hue;
    if (max === r) hue = 60 * (((g - bl) / (max - min)) % 6);
    else if (max === g) hue = 60 * ((bl - r) / (max - min) + 2);
    else hue = 60 * ((r - g) / (max - min) + 4);
    if (hue < 0) hue += 360;
    if (hue >= 165 && hue <= 200) cyan += 1;
  }

  return {
    size: [full.w, full.h],
    contribution,
    key: key ?? null,
    strongestOther,
    warmPointKeys: warmPoints.length,
    // Found by name: from iteration 6 the moonlight is a spot through the window
    // (P2 ruling 3), no longer a directional rim.
    rim: contribution.find((c) => c.name === "moon") ?? null,
    bloom: { total: totalBloom, onSurfaces: bloomOnSurfaces, threshold, sourcePx, violationPx, worstViolation, offLayer },
    flicker: {
      pedestal: swing([...drumFoot, ...floorPool]),
      drumFoot: swing(drumFoot),
      floorPool: swing(floorPool),
      book: swing(bookNear),
      pools: pedestalCandles.map((c) => ({ label: c.label, radius: c.radius })),
      bookNearCut,
    },
    fog: { on: fogOn, off: fogOff },
    slide,
    cyan: { fraction: cyan / counted },
    palm: { pixels: palmPx, ringPixels: ringOnPalm, handPixels: hand.reduce((a, b) => a + b, 0) },
    handVolume: { interior: interiorN ? interiorSum / interiorN : 0, edge: edgeN ? edgeSum / edgeN : 0 },
    book,
    drapes,
  };
}

function verdicts(m) {
  const t = THRESHOLDS;
  const pct = (x) => `${(x * 100).toFixed(2)}%`;
  const rows = [];
  const add = (item, pass, measurement) => rows.push({ item, pass, measurement });

  const keyFrame = m.key?.frame ?? 0;
  add(
    "exactly one warm key light, everything else falling off from it",
    m.warmPointKeys === 1 && keyFrame >= t.keyDominance * m.strongestOther,
    `${m.warmPointKeys} warm key; key lights the frame ${keyFrame.toFixed(4)}, strongest other light ${m.strongestOther.toFixed(4)} (${(keyFrame / Math.max(1e-6, m.strongestOther)).toFixed(2)}x, need ${t.keyDominance}x)`,
  );
  // Two halves, both required: Amendment 2 asks for a cold rim that EXISTS and
  // stays under 25% of the key. The first version tested only the cap, which a
  // rim of zero meets vacuously — and iteration 1's rim measured 0.00%.
  const rimRatio = (m.rim?.pedestal ?? 0) / Math.max(1e-6, m.key?.pedestal ?? 0);
  const rimFrame = m.rim?.frame ?? 0;
  const rimFrameRatio = rimFrame / Math.max(1e-6, m.key?.frame ?? 0);
  add(
    "the cold moonlight exists, and is <= 25% of the key",
    rimFrame >= t.rimVisible && rimRatio <= t.rimFraction && rimFrameRatio <= t.rimFraction,
    `moon lights the frame ${rimFrame.toFixed(4)} (need ${t.rimVisible}); ${pct(rimFrameRatio)} of the key over the frame, ${pct(rimRatio)} on the pedestal (max ${pct(t.rimFraction)} each)`,
  );
  const bloomShare = m.bloom.onSurfaces / Math.max(1e-6, m.bloom.total);
  add(
    "bloom confined to candles and the ring",
    m.bloom.sourcePx > 0 && m.bloom.offLayer === 0 && bloomShare <= t.bloomOnSurfaces,
    `${m.bloom.offLayer} non-candle/non-ring objects on the bloom layer; of the bloom pass's input, ${pct(bloomShare)} of above-threshold energy is not a candle or the ring (max ${pct(t.bloomOnSurfaces)}); ${m.bloom.sourcePx} source px bloom (must be > 0), threshold ${m.bloom.threshold}`,
  );
  // [R10]: measured where the candles physically light — the drum's foot and
  // the floor pool round each pedestal candle; for the book, the lectern top
  // and page edge nearest its candle. The 2% bar is unchanged.
  const f = m.flicker;
  add(
    "flicker lands on the pedestal [R10]",
    f.pedestal.pixels > 0 && f.pedestal.swing >= t.flickerSwing,
    `drum foot + floor pools ${pct(f.pedestal.swing)} over ${f.pedestal.pixels} px (need ${pct(t.flickerSwing)}); foot ${pct(f.drumFoot.swing)} over ${f.drumFoot.pixels} px, pools ${pct(f.floorPool.swing)} over ${f.floorPool.pixels} px (radii ${f.pools.map((q) => `${q.radius.toFixed(3)} m`).join(", ")})`,
  );
  add(
    "flicker lands on the book [R10]",
    f.book.pixels > 0 && f.book.swing >= t.flickerSwing,
    `lectern top + page edge nearest its candle ${pct(f.book.swing)} over ${f.book.pixels} px, within ${f.bookNearCut.toFixed(3)} m of the flame (need ${pct(t.flickerSwing)})`,
  );
  const fogWork = (m.fog.off - m.fog.on) / Math.max(1e-6, m.fog.off);
  add(
    "shelves recede into fog rather than sitting flat",
    m.fog.on >= t.shelfVisible && fogWork >= t.fogWork,
    `library luminance ${pct(m.fog.on)} with fog (need ${pct(t.shelfVisible)}); fog removes ${pct(fogWork)} (need ${pct(t.fogWork)})`,
  );
  add("brass reads as brass — the highlight slides with the camera", m.slide >= t.highlightSlide, `highlight slides ${m.slide.toFixed(1)} px across the drum for a 0.35 m camera move (need ${t.highlightSlide})`);
  add("no cyan", m.cyan.fraction < t.cyanFraction, `${pct(m.cyan.fraction)} of pixels cyan`);
  const palmShare = m.palm.ringPixels / Math.max(1, m.palm.pixels);
  add(
    "no lines on the palm — the rings pass around it, not across it",
    m.palm.pixels > 0 && palmShare <= t.palmLines,
    `${m.palm.ringPixels} ring px over ${m.palm.pixels} palm px (${pct(palmShare)}, max ${pct(t.palmLines)})`,
  );
  const volume = m.handVolume.interior / Math.max(1e-6, m.handVolume.edge);
  add(
    "the hand is a faint volume, not an outline",
    m.palm.handPixels > 0 && volume >= t.handVolume,
    `interior ${m.handVolume.interior.toFixed(4)} vs silhouette ${m.handVolume.edge.toFixed(4)} (${volume.toFixed(2)}, need ${t.handVolume})`,
  );
  add(
    "the book reads as parchment",
    m.book.pixels > 0 && m.book.lum >= t.bookVisible,
    `parchment silhouette ${pct(m.book.lum)} over ${m.book.pixels} px (need ${pct(t.bookVisible)})`,
  );
  const darkest = m.drapes.length ? Math.min(...m.drapes.map((d) => d.lum)) : 0;
  add(
    "the velvet drapes read, rather than vanishing",
    m.drapes.length > 0 && m.drapes.every((d) => d.pixels > 0) && darkest >= t.drapesVisible,
    `${m.drapes.length} drapes by silhouette; darkest ${pct(darkest)} (need ${pct(t.drapesVisible)}) — ${m.drapes.map((d) => `${pct(d.lum)} over ${d.pixels} px at stage x ${d.at}`).join("; ")}`,
  );
  return rows;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--build")) await buildProduction();
  const server = await startServer();
  const browser = await chromium.launch({ headless: true, args: GPU_ARGS });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: "dark" });
    await context.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [THRESHOLD_STORAGE_KEY, THRESHOLD_SEEN]);
    const page = await context.newPage();
    const gpu = await readRenderer(page);
    if (!gpu.ok || isSoftware(gpu.renderer)) throw new Error(`Refusing to score on a software renderer: ${gpu.renderer}`);

    await page.goto(`${server.base}/sanctuary?snc-measure=1`, { waitUntil: "load", timeout: 60_000 });
    await page.waitForFunction(() => Boolean(window.__sncRoom), null, { timeout: 30_000 });

    const measured = await page.evaluate(scoreInPage, { regions: REGIONS });
    const rows = verdicts(measured);

    console.log(`GPU: ${gpu.renderer}`);
    console.log(`canvas ${measured.size[0]}x${measured.size[1]}\n`);
    const pad = Math.max(...rows.map((r) => r.item.length));
    for (const row of rows) console.log(`${row.pass ? "PASS" : "FAIL"}  ${row.item.padEnd(pad)}  ${row.measurement}`);
    const fails = rows.filter((r) => !r.pass).length;
    console.log(`\n${rows.length - fails}/${rows.length} pass, ${fails} FAIL`);

    console.log("\nlight contributions (frame luminance, pedestal-face luminance):");
    for (const c of measured.contribution) console.log(`  ${c.name.padEnd(16)} ${c.colour}  frame ${c.frame.toFixed(4)}  pedestal ${c.pedestal.toFixed(4)}`);

    const dir = join(REPO, "captures", "ui", "scores");
    await mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replaceAll(":", "-").slice(0, 19);
    await writeFile(join(dir, `${stamp}.json`), JSON.stringify({ gpu: gpu.renderer, thresholds: THRESHOLDS, measured, rows }, null, 2));
    process.exitCode = fails === 0 ? 0 : 1;
  } finally {
    await browser.close();
    server.child.kill();
  }
}

if (import.meta.filename === process.argv[1]) {
  main().catch((err) => {
    console.error(err.stack ?? err.message);
    process.exitCode = 2;
  });
}
