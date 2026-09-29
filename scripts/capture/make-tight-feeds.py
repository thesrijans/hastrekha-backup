"""Synthetic phone feeds for scan-complete G1.3: the reader's own framing, reproduced from the session stills.

The phone recordings of 2026-09-29 (docs/specs/phone-scan-2026-09-29-findings.md) show a back camera
held close: the chamber's `palm Npx` readout at 681-788 px in a 720x1280 frame, the thumb running off
the side, the fingertips leaving the top, the wrist well inside. That readout is the hand's largest
normalised landmark extent x the frame width (use-hand-scan.ts), so these crops are sized on exactly
that measure, from each still's stored landmarks:

  tight-NN   one per session still (15): hand extent 760-800 px (the readout's measure), the palm quad
             centred across the frame, the middle fingertip 40-85 px ABOVE the top edge, the wrist inside.
  normal     still 0 as make-phone-feed.py frames it (scale 0.67): the whole hand in view, ~45% wide.
  wrist-cut  still 0 at hand extent ~600 px, shifted down until the wrist sits 60 px BELOW the bottom.
  approach   (scan-complete G2) still 0 brought steadily closer, palm quad 0.45 -> 0.95 of the width over 2 s,
             held 1 s, 15 fps. A STATIC palm that close is never found by the landmarker at all (a sweep lost it
             between 0.50 and 0.56); a palm that arrives there is tracked in, and the meter must say too close.

A tight crop is an upscale (1.6-2.2x) of a laptop still, and upscaling is a low-pass: the palm box's
variance of Laplacian falls from 106-454 native to 8-90, under the rekha accumulator's floor (60) —
softer than any phone close-up, which has MORE crease pixels, not fewer. So the upscale is followed by a
phone-ISP-like unsharp mask (sigma 1.2 x scale, amount 1.0), which puts the crops at a median VoL of ~120
(the ramp is 60-220). Every feed's VoL is written to the manifest; nothing else is synthesised.

The stored landmarks are the landmarker's reading of the WHOLE still; on a crop it extrapolates the cut-off
fingertips afresh, and its extent comes out ~5-10% short of theirs. `--calibrate` closes that loop on the
readout's own number: given a funnel run on these feeds (scripts/capture/funnel-feeds.mjs), each tight crop's
scale is multiplied by target / the funnel's measured median, and the factor goes into the manifest.

Writes captures/ui/feeds/tight/ (git-ignored: raw palm frames never leave the machine): one .y4m (4
identical frames, which Chromium's fake camera loops) and one .png per feed, and manifest.json.

    ../hastrekha-lab/.venv/Scripts/python.exe scripts/capture/make-tight-feeds.py [--calibrate captures/ui/<run>/funnel.json] [--only approach,normal]

`--only` regenerates just the named feeds and carries every other one over from the manifest untouched, so a
new control feed never re-rolls the calibrated crops.
"""
import json
import pathlib
import sys

import cv2
import numpy as np

REPO = pathlib.Path(__file__).resolve().parents[2]
SESSION = next((REPO / "fixtures" / "golden").glob("session-*"))
OUT = REPO / "captures" / "ui" / "feeds" / "tight"
W, H, FRAMES = 720, 1280, 4
PALM_QUAD = (0, 1, 5, 17)  # WRIST, THUMB_CMC, INDEX_MCP, PINKY_MCP — lib/scan/rectify.ts PALM_ANCHORS
MIDDLE_TIP, WRIST = 12, 0
FINGERTIPS = (4, 8, 12, 16, 20)
USM_SIGMA, USM_AMOUNT = 1.2, 1.0
BBOX_PAD = 0.08  # lib/scan/rekha-persist.ts REKHA_BBOX_PAD_FRACTION


def landmarks_px(still: dict, width: int, height: int) -> list[tuple[float, float]]:
    return [(p["x"] * width, p["y"] * height) for p in still["landmarks"]]


def scaled_still(still: dict, k: float, sharpen: bool) -> np.ndarray:
    image = cv2.imread(str(SESSION / "raw" / still["rawFile"]))
    image = cv2.resize(image, None, fx=k, fy=k, interpolation=cv2.INTER_LANCZOS4 if k > 1 else cv2.INTER_AREA)
    if sharpen:
        blur = cv2.GaussianBlur(image, (0, 0), USM_SIGMA * k)
        image = np.clip(image.astype(np.float32) * (1 + USM_AMOUNT) - blur.astype(np.float32) * USM_AMOUNT, 0, 255).astype(np.uint8)
    return image


def window(image: np.ndarray, x0: int, y0: int) -> np.ndarray:
    """A WxH window at (x0, y0) of `image`; whatever falls outside it is padded from its edge rows and
    columns, then blurred and darkened (make-phone-feed.py's pad), so the pad reads as out-of-focus room."""
    h, w = image.shape[:2]
    left, top = max(0, -x0), max(0, -y0)
    right, bottom = max(0, x0 + W - w), max(0, y0 + H - h)
    padded = cv2.copyMakeBorder(image, top, bottom, left, right, cv2.BORDER_REPLICATE)
    frame = padded[y0 + top : y0 + top + H, x0 + left : x0 + left + W].copy()
    mask = np.zeros((H, W), np.uint8)
    inside_x0, inside_y0 = max(0, -x0), max(0, -y0)
    inside_x1, inside_y1 = min(W, w - x0), min(H, h - y0)
    mask[inside_y0:inside_y1, inside_x0:inside_x1] = 1
    if mask.min() == 0:
        soft = (cv2.GaussianBlur(frame, (0, 0), 25) * 0.55).astype(np.uint8)
        frame[mask == 0] = soft[mask == 0]
    return frame


def vol_palm_box(frame: np.ndarray, points: list[tuple[float, float]]) -> float:
    """lib/scan/rekha-persist.ts palmBoxVol at stride 1: the landmarks' box, padded, clamped to the frame."""
    xs = [x for x, _ in points]
    ys = [y for _, y in points]
    x0 = max(0, int((min(xs) / W - BBOX_PAD) * W))
    y0 = max(0, int((min(ys) / H - BBOX_PAD) * H))
    x1 = min(W, int((max(xs) / W + BBOX_PAD) * W))
    y1 = min(H, int((max(ys) / H + BBOX_PAD) * H))
    g = (0.2126 * frame[y0:y1, x0:x1, 2] + 0.7152 * frame[y0:y1, x0:x1, 1] + 0.0722 * frame[y0:y1, x0:x1, 0]).astype(np.float64)
    lap = 4 * g[1:-1, 1:-1] - g[1:-1, :-2] - g[1:-1, 2:] - g[:-2, 1:-1] - g[2:, 1:-1]
    return float(lap.var())


def geometry(points: list[tuple[float, float]]) -> dict:
    """What the gate and the readout will see, from the stored landmarks carried into the crop."""
    xs = [x for x, _ in points]
    ys = [y for _, y in points]
    span = max((max(xs) - min(xs)) / W, (max(ys) - min(ys)) / H)
    qx = [points[i][0] for i in PALM_QUAD]
    qy = [points[i][1] for i in PALM_QUAD]
    margin = 0.03 * min(W, H)
    return {
        "palmPx": round(span * W),
        "palmQuadWidth": round((max(qx) - min(qx)) / W, 3),
        "palmQuadInside": min(qx) >= margin and max(qx) <= W - margin and min(qy) >= margin and max(qy) <= H - margin,
        "fingertipsOut": [i for i in FINGERTIPS if not (0 <= points[i][0] <= W and 0 <= points[i][1] <= H)],
        "middleTipY": round(points[MIDDLE_TIP][1]),
        "wristY": round(points[WRIST][1]),
    }


def write_feed(name: str, frame: np.ndarray, meta: dict, manifest: list) -> None:
    yuv = cv2.cvtColor(frame, cv2.COLOR_BGR2YUV_I420)
    with (OUT / f"{name}.y4m").open("wb") as f:
        f.write(f"YUV4MPEG2 W{W} H{H} F30:1 Ip A1:1 C420jpeg\n".encode())
        for _ in range(FRAMES):
            f.write(b"FRAME\n")
            f.write(yuv.tobytes())
    cv2.imwrite(str(OUT / f"{name}.png"), frame)
    manifest.append({"feed": f"{name}.y4m", **meta})
    print(f"{name:10s} {json.dumps(meta)}")


def write_sequence(name: str, frames: list, fps: int, meta: dict, manifest: list) -> None:
    """A feed that MOVES: `frames` in order at `fps`, which Chromium's fake camera loops. The .png is the last."""
    with (OUT / f"{name}.y4m").open("wb") as f:
        f.write(f"YUV4MPEG2 W{W} H{H} F{fps}:1 Ip A1:1 C420jpeg\n".encode())
        for frame in frames:
            f.write(b"FRAME\n")
            f.write(cv2.cvtColor(frame, cv2.COLOR_BGR2YUV_I420).tobytes())
    cv2.imwrite(str(OUT / f"{name}.png"), frames[-1])
    manifest.append({"feed": f"{name}.y4m", **meta})
    print(f"{name:10s} {json.dumps(meta)}")


def calibration() -> tuple[str | None, dict[str, float]]:
    """Per tight feed, the landmarker's measured median extent from a funnel run, if one was given."""
    if "--calibrate" not in sys.argv:
        return None, {}
    path = pathlib.Path(sys.argv[sys.argv.index("--calibrate") + 1]).resolve()
    run = json.loads(path.read_text(encoding="utf-8"))
    measured = {entry["feed"]: entry["funnel"]["palmPx"]["median"] for entry in run["feeds"] if entry.get("funnel") and entry["funnel"].get("palmPx")}
    return str(path.relative_to(REPO)), measured


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    meta = json.loads((SESSION / "metadata.json").read_text(encoding="utf-8"))
    stills = meta["stills"]
    manifest: list = []
    calibrated_from, measured = calibration()
    old_manifest = json.loads((OUT / "manifest.json").read_text(encoding="utf-8")) if (OUT / "manifest.json").exists() else {"feeds": []}
    # Keyed like the funnel run (feed name without ".y4m"), which is what `measured` is keyed by.
    previous = {pathlib.Path(entry["feed"]).stem: entry for entry in old_manifest["feeds"]}
    only = set(sys.argv[sys.argv.index("--only") + 1].split(",")) if "--only" in sys.argv else None
    if only is not None:
        calibrated_from = old_manifest.get("calibratedFrom")

    def wanted(name: str) -> bool:
        """Regenerate this feed? Otherwise its manifest entry (and its files) are kept exactly as they were."""
        if only is None or name in only:
            return True
        if name in previous:
            manifest.append(previous[name])
        return False

    for i, still in enumerate(stills):
        if not wanted(f"tight-{i:02d}"):
            continue
        pts = landmarks_px(still, still["width"], still["height"])
        hand_x = max(x for x, _ in pts) - min(x for x, _ in pts)
        hand_y = max(y for _, y in pts) - min(y for _, y in pts)
        target = 760 + 10 * (i % 5)
        # The readout's measure is max(x extent / W, y extent / H) x W; upright hands in a portrait frame are
        # wider than they are tall in those units, so the x extent is the one sized.
        k = target / hand_x
        name = f"tight-{i:02d}"
        correction = 1.0
        if calibrated_from is not None and name in measured and name in previous:
            # The run measured the crop made at the PREVIOUS scale; carry that scale to the target.
            correction = previous[name]["scale"] * target / measured[name] / k
        k *= correction
        assert hand_x * k / W >= hand_y * k / H, f"still {i}: the y extent would dominate"
        image = scaled_still(still, k, sharpen=True)
        scaled = [(x * k, y * k) for x, y in pts]
        qx = [scaled[j][0] for j in PALM_QUAD]
        overshoot = 40 + 15 * (i % 4)  # the middle fingertip this far above the top edge
        x0 = int(round((min(qx) + max(qx)) / 2 - W / 2))
        y0 = int(round(scaled[MIDDLE_TIP][1] + overshoot))
        frame = window(image, x0, y0)
        crop_pts = [(x - x0, y - y0) for x, y in scaled]
        g = geometry(crop_pts)
        assert g["palmQuadInside"], f"still {i}: the palm quad left the frame"
        assert MIDDLE_TIP in g["fingertipsOut"], f"still {i}: the middle fingertip is still in view"
        extra = {"target": target, "calibration": round(correction, 4)} if calibrated_from is not None else {"target": target}
        write_feed(name, frame, {"still": i, "scale": round(k, 4), "vol": round(vol_palm_box(frame, crop_pts)), **extra, **g}, manifest)

    still = stills[0]
    pts = landmarks_px(still, still["width"], still["height"])
    xs = [x for x, _ in pts]
    ys = [y for _, y in pts]

    # normal: make-phone-feed.py's framing — scale 0.67, the hand's box centred, nothing sharpened.
    if wanted("normal"):
        normal_feed(still, pts, xs, ys, manifest)
    if wanted("wrist-cut"):
        wrist_cut_feed(still, pts, xs, manifest)
    if wanted("approach"):
        approach_feed(still, pts, manifest)

    (OUT / "manifest.json").write_text(json.dumps({"session": SESSION.name, "size": [W, H], "sharpen": {"sigmaPerScale": USM_SIGMA, "amount": USM_AMOUNT}, "calibratedFrom": calibrated_from, "feeds": manifest}, indent=2), encoding="utf-8")
    regenerated = f" (regenerated: {', '.join(sorted(only))})" if only else ""
    print(f"\n{len(manifest)} feeds -> {OUT.relative_to(REPO)}{regenerated}")
    return 0


def normal_feed(still: dict, pts: list, xs: list, ys: list, manifest: list) -> None:
    k = 0.67
    image = scaled_still(still, k, sharpen=False)
    scaled = [(x * k, y * k) for x, y in pts]
    cx = (min(xs) + max(xs)) / 2 * k
    cy = (min(ys) + max(ys)) / 2 * k
    x0, y0 = int(round(cx - W / 2)), int(round(cy - H / 2))
    frame = window(image, x0, y0)
    crop_pts = [(x - x0, y - y0) for x, y in scaled]
    write_feed("normal", frame, {"still": 0, "scale": k, "vol": round(vol_palm_box(frame, crop_pts)), **geometry(crop_pts)}, manifest)


def wrist_cut_feed(still: dict, pts: list, xs: list, manifest: list) -> None:
    """The whole hand's width in view, the wrist 60 px below the bottom edge."""
    k = 600 / (max(xs) - min(xs))
    image = scaled_still(still, k, sharpen=True)
    scaled = [(x * k, y * k) for x, y in pts]
    qx = [scaled[j][0] for j in PALM_QUAD]
    x0 = int(round((min(qx) + max(qx)) / 2 - W / 2))
    y0 = int(round(scaled[WRIST][1] - H - 60))
    frame = window(image, x0, y0)
    crop_pts = [(x - x0, y - y0) for x, y in scaled]
    g = geometry(crop_pts)
    assert g["wristY"] > H, "the wrist is still in view"
    write_feed("wrist-cut", frame, {"still": 0, "scale": round(k, 3), "vol": round(vol_palm_box(frame, crop_pts)), **g}, manifest)


def approach_feed(still: dict, pts: list, manifest: list) -> None:
    """G2: the phone brought steadily closer — the palm quad from 0.45 of the width to 0.95 over 2 s (the
    tight crops' placement: the middle fingertip 60 px above the top), then held there for 1 s, at 15 fps, looped.
    Too close for the landmarker to find from a standing start, so whether it follows the palm in or lets go
    of it, the chamber's answer at the end must be the same: too close."""
    qx = [pts[j][0] for j in PALM_QUAD]
    frames = []
    fills = [0.45 + (0.95 - 0.45) * i / 29 for i in range(30)] + [0.95] * 15
    for fill in fills:
        k = fill * W / (max(qx) - min(qx))
        image = scaled_still(still, k, sharpen=True)
        scaled = [(x * k, y * k) for x, y in pts]
        x0 = int(round((min(qx) + max(qx)) / 2 * k - W / 2))
        y0 = int(round(scaled[MIDDLE_TIP][1] + 60))
        frames.append(window(image, x0, y0))
    write_sequence("approach", frames, 15, {"still": 0, "fills": [round(fills[0], 2), round(fills[-1], 2)], "frames": len(frames), "fps": 15}, manifest)


if __name__ == "__main__":
    raise SystemExit(main())
