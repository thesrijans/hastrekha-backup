"""Build public/models/hand_landmarker_lite.task — the M1.4 lite hand landmarker.

Google ships the MediaPipe Tasks hand landmarker as ONE bundle (hand_landmarker.task: a STORED zip of
hand_detector.tflite + hand_landmarks_detector.tflite, both the FULL models). The lite landmark model
exists only in the legacy `mp.solutions.hands` wheel (model_complexity=0). This rebuilds the bundle with
that model swapped in:

    hand_detector.tflite            FULL palm detector   (unchanged from the shipped bundle)
    hand_landmarks_detector.tflite  LITE landmark model  (mediapipe/modules/hand_landmark/hand_landmark_lite.tflite)

The lite detector is deliberately NOT used. In VIDEO mode the detector runs only when tracking is lost,
so the per-frame cost is the landmark model's; the lite detector only moved acquisition-frame landmarks
(15 session stills: lite+lite 9.2 px mean / 47 px max off the full model, full detector + lite landmarks
6.0 / 15, both ~11 ms vs 33 ms full on CPU).

Tasks refuses a float model without TFLite NormalizationOptions metadata, which the legacy files lack
or carry incompletely. The lite and full models have identical tensor signatures (224x224x3 in; 63, 1,
1, 63 out, same order), so the shipped full model's metadata and packed label files are grafted on with
MediaPipe's own MetadataPopulator. Grafting the full models the same way reproduces the shipped
bundle's landmarks exactly (0.0 px on all 15 stills), which is what validates the method.

    ../hastrekha-lab/.venv/Scripts/python.exe scripts/models/build-hand-landmarker-lite.py

Needs the lab venv (mediapipe 0.10.21). Deterministic: same inputs, same bytes.
"""
import hashlib
import pathlib
import sys
import time
import zipfile
from unittest import mock

import mediapipe
from mediapipe.tasks.python.metadata import metadata as md

REPO = pathlib.Path(__file__).resolve().parents[2]
SHIPPED = REPO / "public" / "models" / "hand_landmarker.task"
OUT = REPO / "public" / "models" / "hand_landmarker_lite.task"
WHEEL = pathlib.Path(mediapipe.__file__).parent / "modules"
LITE_LANDMARKS = WHEEL / "hand_landmark" / "hand_landmark_lite.tflite"
# The shipped bundle's entry timestamp, 2023-04-26 03:27:02.
PINNED_EPOCH = 1682479622.0
PINNED_LOCALTIME = time.struct_time((2023, 4, 26, 3, 27, 2, 2, 116, 0))


def graft(model_bytes: bytes, donor_bytes: bytes) -> bytes:
    donor = md.MetadataDisplayer.with_model_buffer(donor_bytes)
    try:
        already = set(md.MetadataDisplayer.with_model_buffer(model_bytes).get_packed_associated_file_list())
    except ValueError:  # no metadata at all
        already = set()
    populator = md.MetadataPopulator.with_model_buffer(model_bytes)
    populator.load_metadata_buffer(donor.get_metadata_buffer())
    wanted = {n: donor.get_associated_file_buffer(n) for n in donor.get_packed_associated_file_list() if n not in already}
    if wanted:
        populator.load_associated_file_buffers(wanted)
    # populate() re-zips the packed label files through ZipFile.writestr, which stamps each entry with
    # the wall clock (time.localtime(time.time())). Pinning both to the shipped bundle's own timestamp
    # is what makes this build byte-deterministic on any machine, in any timezone.
    with mock.patch("time.time", return_value=PINNED_EPOCH), mock.patch("time.localtime", return_value=PINNED_LOCALTIME):
        populator.populate()
    return populator.get_model_buffer()


def main() -> int:
    shipped = zipfile.ZipFile(SHIPPED)
    entries = {
        # The detector is taken byte-for-byte from the shipped bundle.
        "hand_detector.tflite": shipped.read("hand_detector.tflite"),
        "hand_landmarks_detector.tflite": graft(LITE_LANDMARKS.read_bytes(), shipped.read("hand_landmarks_detector.tflite")),
    }
    with zipfile.ZipFile(OUT, "w", compression=zipfile.ZIP_STORED) as bundle:
        for name, data in entries.items():
            # The shipped bundle's own layout: STORED, fixed timestamp, unix mode bits.
            info = zipfile.ZipInfo(name, date_time=(2023, 4, 26, 3, 27, 2))
            info.compress_type = zipfile.ZIP_STORED
            info.external_attr = 25165824
            info.create_system = 3
            bundle.writestr(info, data)
    digest = hashlib.sha1(OUT.read_bytes()).hexdigest()
    print(f"{OUT.relative_to(REPO)}  {OUT.stat().st_size} bytes  sha1 {digest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
