"""
Remove the chamber's burned-in overlay from scan-recording frames (S2.5b).

The recording is of the chamber, so the OLD overlay — the fitted curves, the
celestial wheel, the leader lines, all in gold — is burned into every frame.
In luma those strokes are BRIGHT lines, and to a black-hat the dark gap between
two bright strokes is a deep valley: traced as recorded, the tracer followed the
old overlay (captures/ui/*-s2-video/crop-69s.png, the white wedge in the valley
map). The chamber shows the camera feed dimmed and desaturated, while the
overlay is saturated gold, so the overlay separates by colour: pixels with
gold hue and real saturation are masked, dilated 2 px, and inpainted (Telea).

Runs in the lab's venv (opencv):
  ../hastrekha-lab/.venv/Scripts/python.exe scripts/scan/video-clean.py IN_DIR OUT_DIR
"""
import sys
from pathlib import Path

import cv2
import numpy as np

src = Path(sys.argv[1])
dst = Path(sys.argv[2])
dst.mkdir(parents=True, exist_ok=True)
for frame in sorted(src.glob("f-*.png")):
    bgr = cv2.imread(str(frame))
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    # OpenCV hue is 0-179: gold/amber sits around 15-35. Saturation well above the grey feed's.
    gold = ((h >= 12) & (h <= 38) & (s >= 70) & (v >= 70)).astype(np.uint8) * 255
    gold = cv2.dilate(gold, np.ones((5, 5), np.uint8))
    clean = cv2.inpaint(bgr, gold, 3, cv2.INPAINT_TELEA)
    cv2.imwrite(str(dst / frame.name), clean)
    print(f"{frame.name}: masked {int((gold > 0).sum())} px")
