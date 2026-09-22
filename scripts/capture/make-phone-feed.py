"""A synthetic PORTRAIT camera feed for the phone-chamber layout captures (M1.3).

Chromium's fake capture device plays a .y4m file on loop. A phone held upright delivers portrait
frames, so this cuts a 720x1280 window out of one of the local session stills, centred on the hand
(its stored landmarks give the centre), at natural scale — the hand then spans about two thirds of the
frame's width at natural scale; SCALE (default 0.67) brings that to ~45%, which is how a phone's back
camera frames a palm at its 0.25 m focus distance (a ~0.25 m wide portrait view of a ~0.1 m hand). The rows
above and below the still are padded from its edge rows, blurred and darkened, so the pad reads as
out-of-focus room rather than as a stripe.

Writes into captures/ (git-ignored: raw palm frames are biometric and never leave the machine).

    ../hastrekha-lab/.venv/Scripts/python.exe scripts/capture/make-phone-feed.py [still-index]
"""
import json
import pathlib
import sys

import cv2
import numpy as np

REPO = pathlib.Path(__file__).resolve().parents[2]
SESSION = next((REPO / "fixtures" / "golden").glob("session-*"))
OUT = REPO / "captures" / "ui" / "feeds" / "palm-portrait.y4m"
W, H, FRAMES = 720, 1280, 4
SCALE = float(sys.argv[2]) if len(sys.argv) > 2 else 0.67


def main() -> int:
    index = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    meta = json.loads((SESSION / "metadata.json").read_text())
    still = meta["stills"][index]
    image = cv2.imread(str(SESSION / "raw" / still["rawFile"]))
    image = cv2.resize(image, None, fx=SCALE, fy=SCALE, interpolation=cv2.INTER_AREA)
    h, w = image.shape[:2]
    xs = [p["x"] * w for p in still["landmarks"]]
    ys = [p["y"] * h for p in still["landmarks"]]
    cx, cy = int((min(xs) + max(xs)) / 2), int((min(ys) + max(ys)) / 2)

    if w < W:
        image = cv2.copyMakeBorder(image, 0, 0, 0, W - w, cv2.BORDER_REPLICATE)
        w = W
    x0 = min(max(0, cx - W // 2), w - W)
    top_pad = max(0, H // 2 - cy)
    bottom_pad = max(0, H - top_pad - h)
    strip = image[:, x0 : x0 + W]
    padded = cv2.copyMakeBorder(strip, top_pad, bottom_pad, 0, 0, cv2.BORDER_REPLICATE)
    for band in (slice(0, top_pad), slice(top_pad + h, top_pad + h + bottom_pad)):
        if band.stop > band.start:
            region = padded[band]
            padded[band] = (cv2.GaussianBlur(region, (0, 0), 25) * 0.55).astype(np.uint8)
    frame = padded[:H]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    yuv = cv2.cvtColor(frame, cv2.COLOR_BGR2YUV_I420)
    with OUT.open("wb") as f:
        f.write(f"YUV4MPEG2 W{W} H{H} F30:1 Ip A1:1 C420jpeg\n".encode())
        for _ in range(FRAMES):
            f.write(b"FRAME\n")
            f.write(yuv.tobytes())
    cv2.imwrite(str(OUT.with_suffix(".png")), frame)
    print(f"{OUT.relative_to(REPO)}  {W}x{H}  still {index}  scale {SCALE}  hand {int(max(xs) - min(xs))}px wide ({(max(xs) - min(xs)) / W:.0%})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
