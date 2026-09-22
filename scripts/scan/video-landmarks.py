"""
Hand landmarks for frames extracted from a scan recording (S2 overlay captures).

The live app runs MediaPipe's HandLandmarker in the browser; offline, the same
model (public/models/hand_landmarker.task) runs through MediaPipe's Python
Tasks API in IMAGE mode. Output: one JSON object keyed by frame file name,
each with the 21 landmarks normalised 0-1 to the frame and the handedness.

The recording is of the CHAMBER, whose UI dims and desaturates the camera
feed (docs/reference/scan-video-*.png), and the hand is large and cut at the
top edge: on the raw frames the landmarker found a hand in 1 of 16. So each
frame is tried under several treatments — padded above, cropped round the
palm, gamma
stretched, landmarks mapped back to the full frame. See VARIANTS.

Runs in the lab's venv (mediapipe 0.10.21, see hastrekha-lab/requirements):
  ../hastrekha-lab/.venv/Scripts/python.exe scripts/scan/video-landmarks.py \
      captures/video-2026-09-21 captures/video-2026-09-21/landmarks.json
"""
import json
import sys
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

frames_dir = Path(sys.argv[1])
out_path = Path(sys.argv[2])
model = Path(__file__).resolve().parents[2] / "public" / "models" / "hand_landmarker.task"

options = vision.HandLandmarkerOptions(
    base_options=mp_python.BaseOptions(model_asset_path=str(model)),
    running_mode=vision.RunningMode.IMAGE,
    num_hands=1,
    min_hand_detection_confidence=0.3,
    min_hand_presence_confidence=0.3,
)
MIN_SCORE = 0.8
VARIANTS = [
    (0, 1.0, 0.0, 1.0, 1.0),
    (400, 0.6, 0.15, 0.7, 1.0),
    (300, 0.7, 0.15, 0.7, 2.2),
    (400, 0.5, 0.0, 1.0, 1.0),
    (500, 0.5, 0.1, 0.75, 1.6),
    (300, 0.8, 0.2, 0.7, 1.4),
]
result = {}
with vision.HandLandmarker.create_from_options(options) as landmarker:
    for frame in sorted(frames_dir.glob("f-*.png")):
        bgr = cv2.imread(str(frame))
        h, w = bgr.shape[:2]
        found = None
        # (pad top, scale, crop x0, crop x1, gamma): the recording's hand is large, grey and cut at the
        # top edge, and no single treatment reads every frame; the first variant that finds a hand
        # with score >= MIN_SCORE wins, and its landmarks are mapped back to the full frame.
        for pad, scale, cx0, cx1, gamma in VARIANTS:
            x0, x1 = int(w * cx0), int(w * cx1)
            img = bgr[:, x0:x1]
            if gamma != 1.0:
                img = np.clip(((img / 255.0) ** gamma) * 255, 0, 255).astype(np.uint8)
            side = pad // 3
            img = cv2.copyMakeBorder(img, pad, side, side, side, cv2.BORDER_CONSTANT, value=(128, 128, 128))
            img = cv2.resize(img, None, fx=scale, fy=scale)
            det = landmarker.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))))
            if det.hand_landmarks and det.handedness[0][0].score >= MIN_SCORE:
                ih, iw = img.shape[:2]
                def back(p):
                    px = p.x * iw / scale - side + x0
                    py = p.y * ih / scale - pad
                    return {"x": px / w, "y": py / h, "z": p.z}
                found = (f"pad{pad}/s{scale}/x{cx0}-{cx1}/g{gamma}", det, back)
                break
        if found is None:
            result[frame.name] = None
            print(f"{frame.name}: no hand")
            continue
        label, detection, back = found
        lms = detection.hand_landmarks[0]
        hand = detection.handedness[0][0]
        result[frame.name] = {
            "width": w,
            "height": h,
            "via": label,
            "handedness": hand.category_name,
            "score": hand.score,
            "landmarks": [back(p) for p in lms],
        }
        print(f"{frame.name}: {hand.category_name} {hand.score:.2f} via {label}")
out_path.write_text(json.dumps(result, indent=1))
print(f"wrote {out_path}")
