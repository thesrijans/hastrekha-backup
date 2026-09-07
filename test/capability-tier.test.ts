/* ============================================================================
 * CAPABILITY TIER — the pure half of components/sanctuary/use-capability-tier
 *
 * What is pinned here and why:
 *
 *  1. prefers-reduced-motion is absolute. §10 makes FLOOR the reduced-motion
 *     target, so no combination of memory, cores or frame budget may talk the
 *     classifier out of it. Each reduced-motion case is paired with the same
 *     signals at prefersReducedMotion:false, so the assertion cannot pass
 *     vacuously on a set that was never HIGH to begin with.
 *
 *  2. Every threshold, on both sides. The thresholds are the product decision —
 *     which phone gets R3F and which gets a crossfade — and the only reason to
 *     trust the numbers in the JSDoc is a test that fails when they drift. Each
 *     boundary is asserted AT the documented value and one hair off it, with
 *     the other two signals held at HIGH-grade so the tier under test is the
 *     only thing deciding the answer.
 *
 *  3. Ignorance resolves downward, never upward. All-null gives the safe tier,
 *     not HIGH; any single missing signal caps a perfect device at MID. An
 *     unmeasured device that gets HIGH is the "WebGL showpiece that drops the
 *     scan to 12 fps" §14 forbids, so this is the assertion that actually
 *     protects the scan.
 *
 *  4. Totality and monotonicity. Every point of a hostile cartesian product
 *     (null, NaN, ±Infinity, 0, negatives) lands inside the four tiers, and
 *     improving one signal never lowers the result.
 *
 *  5. The frame probe returns the MEDIAN. Driven with a fake rAF and a fake
 *     clock through a series carrying one 900 ms outlier: the median rejects
 *     it, and the same series' MEAN is asserted to land on a different tier —
 *     which is the whole reason the probe is not a mean.
 *
 * No React, no DOM, no render — the hook is deliberately thin so that this
 * file can cover the policy.
 * ========================================================================== */
import assert from "node:assert/strict";
import {
  classifyCapability,
  probeFrameMs,
  CAPABILITY_TIERS,
  CORES_HIGH,
  CORES_LOW,
  CORES_MID,
  DEVICE_MEMORY_HIGH_GB,
  DEVICE_MEMORY_LOW_GB,
  DEVICE_MEMORY_MID_GB,
  FRAME_MS_HIGH,
  FRAME_MS_IMPLAUSIBLE,
  FRAME_MS_LOW,
  FRAME_MS_MID,
  FRAME_PROBE_SAMPLES,
  SAFE_CAPABILITY_TIER,
  UNMEASURED_SIGNAL_CEILING,
  type CapabilitySignals,
  type CapabilityTier,
  type RafScheduler,
} from "../components/sanctuary/use-capability-tier";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

/** Every signal absent by default, so each case states only the axis it is about. */
function signals(overrides: Partial<CapabilitySignals> = {}): CapabilitySignals {
  return {
    deviceMemory: null,
    hardwareConcurrency: null,
    frameMs: null,
    prefersReducedMotion: false,
    ...overrides,
  };
}

/** HIGH-grade on the two axes a boundary case is not testing, so the axis under test is the sole cause. */
const HIGH_MEMORY = DEVICE_MEMORY_HIGH_GB;
const HIGH_CORES = CORES_HIGH * 2;
const HIGH_FRAME = FRAME_MS_HIGH / 2;

const RANK: Readonly<Record<CapabilityTier, number>> = { FLOOR: 0, LOW: 1, MID: 2, HIGH: 3 };

/* --------------------------------------------------------------------------
 * 1. prefers-reduced-motion forces FLOOR and short-circuits everything
 * ----------------------------------------------------------------------- */
{
  const otherwiseHigh: readonly Partial<CapabilitySignals>[] = [
    { deviceMemory: HIGH_MEMORY, hardwareConcurrency: HIGH_CORES, frameMs: HIGH_FRAME },
    { deviceMemory: 64, hardwareConcurrency: 32, frameMs: 8.3 },
    { deviceMemory: DEVICE_MEMORY_HIGH_GB, hardwareConcurrency: CORES_HIGH, frameMs: FRAME_MS_HIGH },
  ];

  for (const set of otherwiseHigh) {
    ok(
      classifyCapability(signals(set)) === "HIGH",
      `control: ${JSON.stringify(set)} really is HIGH without the motion preference`,
    );
    ok(
      classifyCapability(signals({ ...set, prefersReducedMotion: true })) === "FLOOR",
      `reduced motion beats ${JSON.stringify(set)} — §10 makes FLOOR the prefers-reduced-motion target`,
    );
  }

  /* The short-circuit is ahead of the unknown-signal path too, so FLOOR wins over the safe default. */
  ok(
    classifyCapability(signals({ prefersReducedMotion: true })) === "FLOOR",
    "reduced motion with no signals at all is FLOOR, not the safe tier",
  );
  ok(
    classifyCapability(signals({ deviceMemory: 0.25, hardwareConcurrency: 1, prefersReducedMotion: true })) === "FLOOR",
    "reduced motion on a weak device is still FLOOR — the short-circuit cannot make things worse",
  );
}

/* --------------------------------------------------------------------------
 * 2. Thresholds, both sides of every boundary
 * ----------------------------------------------------------------------- */
{
  const byMemory = (deviceMemory: number): CapabilityTier =>
    classifyCapability(signals({ deviceMemory, hardwareConcurrency: HIGH_CORES, frameMs: HIGH_FRAME }));

  ok(byMemory(DEVICE_MEMORY_HIGH_GB) === "HIGH", `${DEVICE_MEMORY_HIGH_GB} GB (reported cap: desktop / flagship) is HIGH`);
  ok(byMemory(DEVICE_MEMORY_HIGH_GB - 0.01) === "MID", "a hair under 8 GB drops to MID — the HIGH bound is inclusive");
  ok(byMemory(DEVICE_MEMORY_MID_GB) === "MID", `${DEVICE_MEMORY_MID_GB} GB (mid-range Android) is MID`);
  ok(byMemory(DEVICE_MEMORY_MID_GB - 0.01) === "LOW", "a hair under 4 GB drops to LOW");
  ok(byMemory(DEVICE_MEMORY_LOW_GB) === "LOW", `${DEVICE_MEMORY_LOW_GB} GB (entry-level Android / old iPad) is LOW`);
  ok(byMemory(DEVICE_MEMORY_LOW_GB - 0.01) === "FLOOR", "a hair under 2 GB drops to FLOOR — no motion is affordable there");
  ok(byMemory(0.5) === "FLOOR", "0.5 GB, the bottom of the reported quantisation, is FLOOR");

  const byCores = (hardwareConcurrency: number): CapabilityTier =>
    classifyCapability(signals({ deviceMemory: HIGH_MEMORY, hardwareConcurrency, frameMs: HIGH_FRAME }));

  ok(byCores(CORES_HIGH) === "HIGH", `${CORES_HIGH} logical cores leaves one free for the detector worker — HIGH`);
  ok(byCores(CORES_HIGH - 1) === "MID", "7 cores is MID — R3F and the pipeline would be taking turns");
  ok(byCores(CORES_MID) === "MID", `${CORES_MID} cores (mid-range floor) is MID`);
  ok(byCores(CORES_MID - 1) === "LOW", "3 cores is LOW");
  ok(byCores(CORES_LOW) === "LOW", `${CORES_LOW} cores is LOW — the last point above one shared thread`);
  ok(byCores(CORES_LOW - 1) === "FLOOR", "1 core is FLOOR: the render loop and the pipeline are literally the same thread");

  const byFrame = (frameMs: number): CapabilityTier =>
    classifyCapability(signals({ deviceMemory: HIGH_MEMORY, hardwareConcurrency: HIGH_CORES, frameMs }));

  ok(byFrame(16.7) === "HIGH", "a 60 Hz panel idling on time (16.7 ms) is HIGH");
  ok(byFrame(8.3) === "HIGH", "a 120 Hz panel idling on time (8.3 ms) is HIGH");
  ok(byFrame(FRAME_MS_HIGH) === "HIGH", `${FRAME_MS_HIGH} ms (a 50 Hz panel idling on time) is the inclusive HIGH bound`);
  ok(byFrame(FRAME_MS_HIGH + 0.01) === "MID", "a hair over 20 ms is MID — under 50 fps at rest buys no WebGL");
  ok(byFrame(FRAME_MS_MID) === "MID", `${FRAME_MS_MID} ms (~38 fps at rest) is the inclusive MID bound`);
  ok(byFrame(FRAME_MS_MID + 0.01) === "LOW", "a hair over 26 ms is LOW — particles come off");
  ok(byFrame(FRAME_MS_LOW) === "LOW", `${FRAME_MS_LOW} ms (~30 fps at rest) is the inclusive LOW bound — crossfades still read`);
  ok(byFrame(FRAME_MS_LOW + 0.01) === "FLOOR", "a hair over 34 ms is FLOOR: parallax there is judder, not motion");
  ok(byFrame(120) === "FLOOR", "120 ms at rest is a genuinely overwhelmed device — FLOOR");

  /* The implausibility cliff is a deliberate discontinuity: below it the reading is evidence,
     at it the reading is a throttled background tab and becomes UNKNOWN (hence the MID cap). */
  ok(
    byFrame(FRAME_MS_IMPLAUSIBLE - 0.01) === "FLOOR",
    "just under 250 ms is still believed, and it means FLOOR",
  );
  ok(
    byFrame(FRAME_MS_IMPLAUSIBLE) === UNMEASURED_SIGNAL_CEILING,
    "at 250 ms (~4 fps) the reading is discarded as a throttled tab, not believed as a 4 fps device",
  );
  ok(
    byFrame(1000) === UNMEASURED_SIGNAL_CEILING,
    "a 1 Hz background-tab reading must not pin a flagship to FLOOR for the session",
  );
}

/* --------------------------------------------------------------------------
 * 3. Unknown signals degrade toward safe, never upward
 * ----------------------------------------------------------------------- */
{
  const blind = classifyCapability(signals());
  ok(blind === SAFE_CAPABILITY_TIER, "all-null gives the safe tier");
  ok(blind !== "HIGH", "all-null is emphatically NOT HIGH — §14's failure mode starts exactly here");
  ok(SAFE_CAPABILITY_TIER === "LOW", "the safe tier is LOW: cheap enough for anything, and not a false promise of FLOOR");

  ok(
    classifyCapability(signals({ deviceMemory: HIGH_MEMORY, hardwareConcurrency: HIGH_CORES, frameMs: HIGH_FRAME })) ===
      "HIGH",
    "all three signals present and excellent is the ONLY way to reach HIGH",
  );

  const oneMissing: readonly Partial<CapabilitySignals>[] = [
    { hardwareConcurrency: HIGH_CORES, frameMs: HIGH_FRAME }, // Safari / Firefox: no deviceMemory
    { deviceMemory: HIGH_MEMORY, frameMs: HIGH_FRAME },
    { deviceMemory: HIGH_MEMORY, hardwareConcurrency: HIGH_CORES }, // before the probe resolves
  ];
  for (const set of oneMissing) {
    ok(
      classifyCapability(signals(set)) === UNMEASURED_SIGNAL_CEILING,
      `one missing signal caps a perfect device at ${UNMEASURED_SIGNAL_CEILING}: ${JSON.stringify(set)}`,
    );
  }

  /* Unusable readings must behave exactly like absence — a broken clock buys nothing and costs nothing. */
  for (const junk of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    ok(
      classifyCapability(signals({ deviceMemory: junk, hardwareConcurrency: HIGH_CORES, frameMs: HIGH_FRAME })) ===
        UNMEASURED_SIGNAL_CEILING,
      `deviceMemory ${String(junk)} is treated as unknown, not as a tier`,
    );
    ok(
      classifyCapability(signals({ deviceMemory: HIGH_MEMORY, hardwareConcurrency: HIGH_CORES, frameMs: junk })) ===
        UNMEASURED_SIGNAL_CEILING,
      `frameMs ${String(junk)} is treated as unknown, not as a tier`,
    );
  }

  /* The cap is a ceiling, not a floor: a known-weak axis still drags the answer below MID. */
  ok(
    classifyCapability(signals({ deviceMemory: 1 })) === "FLOOR",
    "a known-terrible signal beats the unknown ceiling downward — the combiner is a minimum",
  );
  ok(
    classifyCapability(signals({ hardwareConcurrency: CORES_LOW })) === "LOW",
    "one weak known signal with two unknowns lands at LOW, not at the MID ceiling",
  );
}

/* --------------------------------------------------------------------------
 * 4. Totality and monotonicity
 * ----------------------------------------------------------------------- */
{
  const CANDIDATES: readonly (number | null)[] = [
    null,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -8,
    0,
    0.25,
    1,
    2,
    3.99,
    4,
    7.99,
    8,
    16,
    26,
    34,
    250,
    5000,
  ];

  let checked = 0;
  let outside = 0;
  for (const deviceMemory of CANDIDATES) {
    for (const hardwareConcurrency of CANDIDATES) {
      for (const frameMs of CANDIDATES) {
        for (const prefersReducedMotion of [false, true]) {
          const tier = classifyCapability({ deviceMemory, hardwareConcurrency, frameMs, prefersReducedMotion });
          if (!CAPABILITY_TIERS.includes(tier)) outside += 1;
          checked += 1;
        }
      }
    }
  }
  ok(checked === CANDIDATES.length ** 3 * 2, `the product really was exhaustive (${checked} points)`);
  ok(outside === 0, "every signal set lands inside the four tiers — the classifier is total");
  ok(CAPABILITY_TIERS.length === 4, "there are exactly four tiers, ordered weakest to strongest");
  ok(
    CAPABILITY_TIERS.every((tier, index) => index === 0 || RANK[tier] > RANK[CAPABILITY_TIERS[index - 1]]),
    "CAPABILITY_TIERS is strictly ascending, so index comparison is a valid 'at least MID' test",
  );

  /* Monotonicity: more memory or more cores can never make the answer worse. */
  const ascending: readonly number[] = [0.5, 1, 2, 3, 4, 6, 8, 16];
  for (let i = 1; i < ascending.length; i += 1) {
    const lower = classifyCapability(signals({ deviceMemory: ascending[i - 1], hardwareConcurrency: HIGH_CORES, frameMs: HIGH_FRAME }));
    const higher = classifyCapability(signals({ deviceMemory: ascending[i], hardwareConcurrency: HIGH_CORES, frameMs: HIGH_FRAME }));
    ok(RANK[higher] >= RANK[lower], `more memory never lowers the tier (${ascending[i - 1]} -> ${ascending[i]} GB)`);

    const fewer = classifyCapability(signals({ deviceMemory: HIGH_MEMORY, hardwareConcurrency: ascending[i - 1], frameMs: HIGH_FRAME }));
    const more = classifyCapability(signals({ deviceMemory: HIGH_MEMORY, hardwareConcurrency: ascending[i], frameMs: HIGH_FRAME }));
    ok(RANK[more] >= RANK[fewer], `more cores never lowers the tier (${ascending[i - 1]} -> ${ascending[i]})`);
  }

  /* And a slower frame never RAISES it, for every believed reading (the 250 ms cliff is tested above as a discontinuity). */
  const slower: readonly number[] = [4, 8.3, 16.7, 20, 21, 26, 30, 34, 40, 100, 249];
  for (let i = 1; i < slower.length; i += 1) {
    const fast = classifyCapability(signals({ deviceMemory: HIGH_MEMORY, hardwareConcurrency: HIGH_CORES, frameMs: slower[i - 1] }));
    const slow = classifyCapability(signals({ deviceMemory: HIGH_MEMORY, hardwareConcurrency: HIGH_CORES, frameMs: slower[i] }));
    ok(RANK[slow] <= RANK[fast], `a slower frame never raises the tier (${slower[i - 1]} -> ${slower[i]} ms)`);
  }
}

/* --------------------------------------------------------------------------
 * 5. The frame probe is a median, driven by an injected rAF and clock
 * ----------------------------------------------------------------------- */

interface ProbeRun {
  readonly frameMs: number;
  readonly rafCalls: number;
}

/**
 * Drives probeFrameMs synchronously through a scripted timeline. `timeline[0]`
 * is consumed by the baseline callback (which records no sample), so the
 * samples the probe actually sees are `timeline.slice(1)`.
 */
async function drive(timeline: readonly number[]): Promise<ProbeRun> {
  let clock = 1_000;
  let rafCalls = 0;
  const raf: RafScheduler = (callback) => {
    clock += rafCalls < timeline.length ? timeline[rafCalls] : 16.7;
    rafCalls += 1;
    callback();
    return rafCalls;
  };
  const frameMs = await probeFrameMs(raf, () => clock);
  return { frameMs, rafCalls };
}

const mean = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

async function main(): Promise<void> {
  ok(FRAME_PROBE_SAMPLES % 2 === 1, "the sample count is odd, so the median is an observed frame and not an average of two");

  {
    /* Eight healthy 60 Hz frames and one 900 ms GC pause. */
    const samples = Array.from({ length: FRAME_PROBE_SAMPLES }, (_unused, index) => (index === 3 ? 900 : 16));
    const run = await drive([7, ...samples]);

    ok(run.frameMs === 16, "the median rejects the 900 ms outlier entirely");
    ok(run.rafCalls === FRAME_PROBE_SAMPLES + 1, "one baseline frame plus one frame per sample — the first gap is not a frame");

    const asMean = mean(samples);
    ok(asMean > 100, `the mean of the same series is ${asMean.toFixed(1)} ms — one pause swamps it`);
    const byMedian = classifyCapability(signals({ deviceMemory: HIGH_MEMORY, hardwareConcurrency: HIGH_CORES, frameMs: run.frameMs }));
    const byMean = classifyCapability(signals({ deviceMemory: HIGH_MEMORY, hardwareConcurrency: HIGH_CORES, frameMs: asMean }));
    ok(byMedian === "HIGH", "on the median this device is HIGH, which is what it is");
    ok(byMean === "FLOOR", "on the mean the same device would be FLOOR — this is why the probe is a median");
  }

  {
    /* An order statistic, not the first, last or extreme sample. */
    const samples = Array.from({ length: FRAME_PROBE_SAMPLES }, (_unused, index) => 10 + index);
    const run = await drive([99, ...samples]);
    const expected = samples[(FRAME_PROBE_SAMPLES - 1) / 2];
    ok(run.frameMs === expected, `an ascending series yields its middle sample (${expected} ms)`);
    ok(run.frameMs !== samples[0] && run.frameMs !== samples[samples.length - 1], "not the first sample and not the last");
  }

  {
    /* Outliers on both ends, and a genuinely slow device that must still read as slow. */
    const slow = Array.from({ length: FRAME_PROBE_SAMPLES }, (_unused, index) => (index === 0 ? 1 : index === 8 ? 4000 : 42));
    const run = await drive([16, ...slow]);
    ok(run.frameMs === 42, "a fast outlier cannot rescue a slow device, and a slow outlier cannot sink it further");
    ok(
      classifyCapability(signals({ deviceMemory: HIGH_MEMORY, hardwareConcurrency: HIGH_CORES, frameMs: run.frameMs })) ===
        "FLOOR",
      "a device that really does idle at 42 ms is FLOOR, outliers or not",
    );
  }

  {
    /* A scheduler that never fires leaves the promise pending — the caller keeps its safe tier. */
    const SENTINEL = "still-pending";
    const dead: RafScheduler = () => 0;
    const race = await Promise.race([
      probeFrameMs(dead, () => 0).then(() => "resolved"),
      Promise.resolve(SENTINEL),
    ]);
    ok(race === SENTINEL, "a dead rAF chain never resolves the probe — never measuring is safe, guessing is not");
  }

  console.log(`CAPABILITY TIER ASSERTIONS PASSED (${assertions})`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
