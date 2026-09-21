/**
 * The finishing pass: bloom on the candles and the ring only, a vignette, 3% grain.
 *
 * Amendment 2: "subtle bloom (high threshold — candles and the ring only),
 * vignette, 3% film grain. No DOF unless ≥ 60 fps holds." DOF is left out; P6
 * measures whether there is headroom to consider it.
 *
 * NO NEW DEPENDENCY. These are Three.js's own passes from three/examples/jsm,
 * which ship inside the `three` package the room already loads. The popular
 * `postprocessing` package was ruled out by the chunk budget before it was ever
 * installed (spec [R9]).
 *
 * BLOOM IS CONFINED BY CONSTRUCTION, NOT BY THRESHOLD ALONE.
 *
 * ITERATION 5. Amendment 2 names a high threshold as the means and "candles
 * and the ring only" as the end. Four iterations showed the means cannot reach
 * the end in this room: the scorer found non-candle pixels at HDR luminance up
 * to 1844, then 917, while a flame's core is about 3 and the emissive ring
 * about 4. No single number lets a flame bloom and stops a 917 glint — a
 * threshold above the glint silences the flames, one below it blooms the
 * glint. So only the candle flames and the ring are put on BLOOM_LAYER, and
 * the bloom pass renders that layer and nothing else. A high threshold is
 * still applied within it, so the bloom stays subtle: only the flames' cores
 * and the ring's brightest arc cross it.
 *
 * ORDER:
 *
 *   bloom input  = the scene through BLOOM_LAYER only -> UnrealBloom
 *   final        = the scene -> + bloom -> output (tone map + sRGB) -> vignette + grain
 *
 * Bloom runs on LINEAR HDR, because that is where "brightest" means something.
 * Grain runs AFTER the output pass, on display values, so that "3%" is 3% of
 * what the reader sees rather than 3% of an HDR value later squashed by the
 * tone curve.
 */
import { ShaderMaterial, Vector2, type PerspectiveCamera, type Scene, type WebGLRenderer } from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

/** Amendment 2's 3%. */
export const FILM_GRAIN = 0.03;

/**
 * The layer an object joins to bloom. Only the candle flames (props.ts) and
 * the hologram's base ring (hologram.ts) enable it; the scorer checks that
 * nothing else does.
 */
export const BLOOM_LAYER = 1;

/**
 * Luminance, in linear HDR, above which a pixel ON THE BLOOM LAYER blooms.
 * Kept high so the bloom stays subtle: a flame's core and the ring's brightest
 * arc cross it, a flame's soft edge does not.
 */
export const BLOOM_THRESHOLD = 1.1;
export const BLOOM_STRENGTH = 0.6;
export const BLOOM_RADIUS = 0.42;

const VignetteGrainShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: FILM_GRAIN },
    uVignette: { value: 1.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uGrain; uniform float uVignette;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 colour = texture2D(tDiffuse, vUv);
      // Vignette: the room's edges fall into the stone, as the CSS room's shade does.
      vec2 centred = (vUv - 0.5) * vec2(1.0, 0.82);
      float fall = smoothstep(0.78, 0.26, length(centred) * uVignette);
      colour.rgb *= mix(0.42, 1.0, fall);
      // Grain: zero-mean, so it textures the image without lifting its blacks.
      float noise = hash(vUv * vec2(1733.0, 977.0) + fract(uTime * 7.13)) - 0.5;
      colour.rgb += noise * uGrain;
      gl_FragColor = colour;
    }`,
};

export interface RoomPost {
  readonly composer: EffectComposer;
  /** The bloom pass, so the scorer can switch it off and read its input. */
  readonly bloom: UnrealBloomPass;
  readonly render: (seconds: number) => void;
  readonly setSize: (width: number, height: number) => void;
  readonly dispose: () => void;
}

export function buildPost(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, width: number, height: number): RoomPost {
  /* The bloom input: the scene seen through BLOOM_LAYER alone. */
  const bloomComposer = new EffectComposer(renderer);
  bloomComposer.renderToScreen = false;
  bloomComposer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new Vector2(width, height), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
  bloomComposer.addPass(bloom);

  /* The final image: the whole scene, the bloom added over it. */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const mix = new ShaderPass(
    new ShaderMaterial({
      uniforms: { baseTexture: { value: null }, bloomTexture: { value: bloomComposer.renderTarget2.texture }, uBloom: { value: 1 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D baseTexture; uniform sampler2D bloomTexture; uniform float uBloom;
        varying vec2 vUv;
        void main() { gl_FragColor = texture2D(baseTexture, vUv) + uBloom * texture2D(bloomTexture, vUv); }`,
    }),
    "baseTexture",
  );
  mix.needsSwap = true;
  composer.addPass(mix);
  composer.addPass(new OutputPass());

  const finish = new ShaderPass(VignetteGrainShader);
  composer.addPass(finish);

  composer.setSize(width, height);
  bloomComposer.setSize(width, height);

  const mask = camera.layers.mask;

  return {
    composer,
    bloom,
    render: (seconds) => {
      if (bloom.enabled) {
        camera.layers.set(BLOOM_LAYER);
        bloomComposer.render();
        camera.layers.mask = mask;
      }
      mix.uniforms.uBloom!.value = bloom.enabled ? 1 : 0;
      finish.uniforms.uTime!.value = seconds;
      composer.render();
    },
    setSize: (w, h) => {
      composer.setSize(w, h);
      bloomComposer.setSize(w, h);
      bloom.resolution.set(w, h);
    },
    dispose: () => {
      bloom.dispose();
      mix.dispose?.();
      finish.dispose?.();
      bloomComposer.dispose();
      composer.dispose();
    },
  };
}
