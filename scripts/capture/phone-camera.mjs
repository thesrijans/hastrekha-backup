/**
 * The phone a desktop Chromium cannot be, shared by the phone harnesses (capture-chamber-phone.mjs,
 * funnel-feeds.mjs): Android's user agent, its camera permission model and cameras, and a mid-range
 * device's signals. Each stub is an init script that Playwright serialises into the page, so each is
 * self-contained — no closures over this module.
 */

export const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";

/**
 * The phone the desktop cannot be — AS ANDROID BEHAVES (F1). Two cameras, a torch on the back one, the
 * facing each open reports, client hints; and the permission model: until the first getUserMedia is
 * granted, enumerateDevices() answers ONE entry with no label and no id, and the first getUserMedia
 * waits a prompt's delay before it is granted (or refused, with __refuseCamera). Every call is logged
 * on window.__camera — opens (with the constraints as asked), enumerations (labelled or not, and
 * whether any open had happened yet), prompts, torch constraints — so the checklist can prove the
 * ORDER of things, not just the outcome.
 *
 * G4b: with window.__hrRelay set (an init script before this one), each opened stream is relayed through a
 * canvas at the camera's own size, and window.__hrBlackout(ms) blanks it — the hand leaves the frame for that
 * long — so a capture can time a hand loss exactly (chakra spec §6: 2 s kept, 8 s after three majors completes).
 */
export const ANDROID_CAMERA_STUB = () => {
  const media = navigator.mediaDevices;
  const realOpen = media.getUserMedia.bind(media);
  /* R1 A/B: with __frontOnly the phone has only its front camera, so the same feed runs MIRRORED
     (ideal: environment falls back to the only camera there is); otherwise it opens the back one. */
  const DEVICES = [
    { kind: "videoinput", deviceId: "android-back", groupId: "g0", label: "camera2 0, facing back", facing: "environment", torch: true },
    { kind: "videoinput", deviceId: "android-front", groupId: "g1", label: "camera2 1, facing front", facing: "user", torch: false },
  ].filter((device) => !window.__frontOnly || device.facing === "user");
  const state = { granted: false, prompts: 0, opens: [], enumerations: [], torch: [] };
  window.__camera = state;
  const facingOf = (video) => {
    const facing = video && typeof video === "object" ? video.facingMode : undefined;
    if (facing === undefined) return { value: null, exact: false };
    if (typeof facing === "string") return { value: facing, exact: false };
    return { value: facing.exact ?? facing.ideal ?? null, exact: facing.exact !== undefined };
  };
  /* G4b: the relay — the camera's frames through a canvas, blanked on request (a hand gone for so long). */
  const relayOf = async (source) => {
    const settings = source.getVideoTracks()[0]?.getSettings() ?? {};
    const width = settings.width ?? 720;
    const height = settings.height ?? 1280;
    const feed = document.createElement("video");
    feed.muted = true;
    feed.playsInline = true;
    feed.srcObject = source;
    await feed.play().catch(() => undefined);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    let blankUntil = 0;
    const log = [];
    window.__hrBlackout = (ms) => {
      blankUntil = performance.now() + ms;
      log.push({ at: Math.round(performance.now()), ms });
    };
    window.__hrBlackouts = log;
    const timer = setInterval(() => {
      if (performance.now() < blankUntil) {
        context.fillStyle = "#3b3631";
        context.fillRect(0, 0, width, height);
      } else if (feed.readyState >= 2) {
        context.drawImage(feed, 0, 0, width, height);
      }
    }, 1000 / 30);
    const relayed = canvas.captureStream(30);
    for (const track of relayed.getVideoTracks()) {
      const stop = track.stop.bind(track);
      track.stop = () => {
        clearInterval(timer);
        for (const inner of source.getTracks()) inner.stop();
        stop();
      };
    }
    return relayed;
  };
  const deviceIdOf = (video) => {
    const id = video && typeof video === "object" ? video.deviceId : undefined;
    if (id === undefined) return null;
    return typeof id === "string" ? id : (id.exact ?? id.ideal ?? null);
  };
  media.enumerateDevices = async () => {
    const list = state.granted
      ? DEVICES.map((d) => ({ kind: d.kind, deviceId: d.deviceId, groupId: d.groupId, label: d.label, toJSON() { return this; } }))
      : [{ kind: "videoinput", deviceId: "", groupId: "", label: "", toJSON() { return this; } }];
    state.enumerations.push({ granted: state.granted, count: list.length, labelled: list.filter((d) => d.label !== "").length, beforeAnyOpen: state.opens.length === 0 });
    return list;
  };
  media.getUserMedia = async (constraints) => {
    const asked = constraints?.video;
    if (!state.granted) {
      /* The prompt: a real one takes a reader's tap. */
      state.prompts += 1;
      await new Promise((resolve) => setTimeout(resolve, 350));
      if (window.__refuseCamera) throw new DOMException("Permission denied", "NotAllowedError");
      state.granted = true;
    }
    const facing = facingOf(asked);
    const byId = DEVICES.find((d) => d.deviceId === deviceIdOf(asked));
    const device = byId ?? DEVICES.find((d) => d.facing === (facing.value ?? "user")) ?? DEVICES[DEVICES.length - 1];
    if (facing.exact && device.facing !== facing.value) throw new DOMException("no camera faces that way", "OverconstrainedError");
    const video = asked && typeof asked === "object" ? { ...asked } : asked;
    if (video && typeof video === "object") {
      delete video.facingMode;
      delete video.deviceId;
      /* A phone held upright delivers PORTRAIT frames for a landscape request (the sensor's modes are
         landscape; the browser rotates). Chromium's fake device does not rotate, so the request is. */
      if (window.innerHeight > window.innerWidth && video.width && video.height) {
        [video.width, video.height] = [video.height, video.width];
      }
    }
    const opened = await realOpen({ ...constraints, video });
    const stream = window.__hrRelay ? await relayOf(opened) : opened;
    for (const track of stream.getVideoTracks()) {
      const settings = track.getSettings.bind(track);
      track.getSettings = () => ({ ...settings(), facingMode: device.facing, deviceId: device.deviceId });
      Object.defineProperty(track, "label", { configurable: true, get: () => device.label });
      const capabilities = track.getCapabilities ? track.getCapabilities.bind(track) : () => ({});
      track.getCapabilities = () => ({ ...capabilities(), torch: device.torch });
      const apply = track.applyConstraints.bind(track);
      track.applyConstraints = async (next) => {
        const advanced = next?.advanced?.[0];
        if (advanced && "torch" in advanced) {
          state.torch.push(advanced.torch);
          const rest = { ...advanced };
          delete rest.torch;
          if (Object.keys(rest).length === 0) return;
          return apply({ advanced: [rest] });
        }
        return apply(next);
      };
    }
    state.opens.push({
      asked: asked && typeof asked === "object" ? { facingMode: asked.facingMode ?? null, deviceId: asked.deviceId ?? null } : asked,
      facing: device.facing,
      device: device.deviceId,
      promptsSoFar: state.prompts,
      enumerationsBefore: state.enumerations.length,
      width: stream.getVideoTracks()[0]?.getSettings().width,
      height: stream.getVideoTracks()[0]?.getSettings().height,
    });
    return stream;
  };
  Object.defineProperty(navigator, "userAgentData", { configurable: true, get: () => ({ mobile: true, platform: "Android", brands: [] }) });
};

/** Force the capability tier's device signals to a mid-range phone's, so the lite profile runs. */
export const MID_TIER_STUB = () => {
  Object.defineProperty(navigator, "deviceMemory", { configurable: true, get: () => 4 });
  Object.defineProperty(navigator, "hardwareConcurrency", { configurable: true, get: () => 4 });
};
