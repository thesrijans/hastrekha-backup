"""
Cut a right hand out of the MakeHuman base mesh and write public/models/hand.glb.

PROVENANCE. The source is the MakeHuman base mesh, which the MakeHuman project
released under CC0 1.0 Universal; the file says so in its own header and
docs/reference/LICENSES.md records the statement, the URL and the SHA-256 of
the exact bytes this script was run against. Amendment 1 of the U3b brief asks
for a genuine hand mesh rather than a drawn outline, and forbids anything whose
licence cannot be verified. This is source (a) of that list.

WHY A SCRIPT AND NOT A CHECKED-IN BLOB ALONE. A 60 kB binary in public/ tells
nobody where it came from. This runs from the published URL, prints the numbers
that matter (triangles, bytes, the thumb angle) and can be re-run by anyone who
wants to check that the committed file is what it claims to be.

HOW THE HAND IS FOUND. The base mesh carries its whole skin as one group,
`body`, so there is no hand to select by name. What it does carry is a joint
skeleton as helper groups — joint-r-hand at the wrist, joint-r-finger-N-M down
each finger — and those give the cut plane. Vertices are kept when they lie
distal of the wrist along the forearm axis (elbow -> wrist), which is the
anatomical cut a surgeon would call a wrist disarticulation and the one the
hologram wants: a hand reaching up out of the frame, not a severed lump.

    python scripts/models/extract_hand.py            # fetch, cut, decimate, write
    python scripts/models/extract_hand.py --keep-src # leave the source obj on disk
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

import numpy as np
import trimesh

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "public" / "models" / "hand.glb"

SOURCE_URL = (
    "https://raw.githubusercontent.com/makehumancommunity/makehuman/"
    "master/makehuman/data/3dobjs/base.obj"
)

# Amendment 1's ceilings.
MAX_TRIS = 3000
MAX_BYTES = 60 * 1024

# Amendment 1: "thumb ~40 degrees abduction". MakeHuman rests it at 27.
TARGET_ABDUCTION = 40.0

# How far proximal of the wrist to keep, as a fraction of hand length: a short
# cuff so the wrist reads as continuing into the frame rather than cut flat.
CUFF = 0.06


def fetch_source(cache: Path) -> bytes:
    """Download the base mesh once, then reuse it."""
    if cache.exists():
        return cache.read_bytes()
    cache.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(SOURCE_URL, timeout=120) as response:
        data = response.read()
    cache.write_bytes(data)
    return data


def parse_obj(text: str) -> tuple[np.ndarray, list[list[int]], dict[str, list[int]]]:
    """
    Minimal OBJ reader that keeps group membership.

    trimesh loads this file happily but flattens the groups, and the groups are
    the only thing that locates the hand, so the parse is done here instead.
    Faces are quads; indices are 1-based and may carry /vt.
    """
    positions: list[tuple[float, float, float]] = []
    faces: list[list[int]] = []
    groups: dict[str, list[int]] = defaultdict(list)
    current = ""
    for line in text.splitlines():
        if line.startswith("v "):
            _, x, y, z = line.split()[:4]
            positions.append((float(x), float(y), float(z)))
        elif line.startswith("g "):
            current = line[2:].strip()
        elif line.startswith("f "):
            idx = [int(tok.split("/")[0]) - 1 for tok in line.split()[1:]]
            groups[current].append(len(faces))
            faces.append(idx)
    return np.asarray(positions, dtype=np.float64), faces, groups


def joint_centre(
    positions: np.ndarray, faces: list[list[int]], groups: dict[str, list[int]], name: str
) -> np.ndarray:
    """A joint helper is a small box; its centre is the joint."""
    verts = {v for f in groups[name] for v in faces[f]}
    if not verts:
        raise SystemExit(f"joint group {name!r} not found in the source mesh")
    return positions[sorted(verts)].mean(axis=0)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--keep-src", action="store_true")
    parser.add_argument("--max-tris", type=int, default=MAX_TRIS)
    parser.add_argument("--thumb-abduction", type=float, default=TARGET_ABDUCTION)
    args = parser.parse_args()

    cache = REPO / ".cache" / "makehuman-base.obj"
    raw = fetch_source(cache)
    digest = hashlib.sha256(raw).hexdigest()
    print(f"source   {SOURCE_URL}")
    print(f"sha256   {digest}")
    print(f"bytes    {len(raw):,}")

    positions, faces, groups = parse_obj(raw.decode("utf-8", errors="replace"))
    print(f"parsed   {len(positions):,} vertices, {len(faces):,} faces, {len(groups)} groups")

    wrist = joint_centre(positions, faces, groups, "joint-r-hand")
    elbow = joint_centre(positions, faces, groups, "joint-r-elbow")
    tip = joint_centre(positions, faces, groups, "joint-r-finger-3-4")

    axis = wrist - elbow
    axis /= np.linalg.norm(axis)
    hand_length = float(np.dot(tip - wrist, axis))
    cut = -CUFF * hand_length
    print(f"hand     length {hand_length:.3f} along the forearm axis; cut at {cut:+.3f}")

    # Keep body faces whose every corner is distal of the cut plane.
    body = groups["body"]
    reach = np.dot(positions - wrist, axis)
    keep = [f for f in body if all(reach[v] > cut for v in faces[f])]
    print(f"kept     {len(keep):,} of {len(body):,} body faces")

    used = sorted({v for f in keep for v in faces[f]})
    remap = {v: i for i, v in enumerate(used)}
    verts = positions[used]

    tris: list[tuple[int, int, int]] = []
    for f in keep:
        idx = [remap[v] for v in faces[f]]
        tris.append((idx[0], idx[1], idx[2]))
        if len(idx) == 4:
            tris.append((idx[0], idx[2], idx[3]))

    mesh = trimesh.Trimesh(vertices=verts, faces=np.asarray(tris), process=True)
    mesh.remove_unreferenced_vertices()

    # The plane above is an infinite half-space, and in the base mesh's A-pose
    # the forearm axis points down the body, so "distal of the wrist" also
    # catches both legs and both feet. The first render of this script was a
    # hand, a shin and two feet on one strip, and every budget passed — which is
    # the whole argument for looking at a capture rather than a triangle count.
    # Keep the connected component that actually holds the hand.
    parts = mesh.split(only_watertight=False)
    if len(parts) > 1:
        anchor = (wrist + tip) / 2.0
        mesh = min(parts, key=lambda part: float(np.linalg.norm(part.centroid - anchor)))
        print(f"split    {len(parts)} components; kept the one containing the hand")

    print(f"hand     {len(mesh.vertices):,} vertices, {len(mesh.faces):,} triangles before decimation")

    # Bring the thumb out to the abduction Amendment 1 asks for.
    #
    # MakeHuman's rest pose holds the thumb at 27 degrees from the index at the
    # wrist; the brief wants roughly 40, which is the difference between a hand
    # at rest and a hand held open as a symbol. The rotation is soft-bound: a
    # vertex moves in full when it is much closer to the thumb's own bones than
    # to the rest of the skeleton, not at all when the reverse is true, and
    # smoothly in between, so the web between thumb and palm stretches instead
    # of tearing. Posing before decimation means the simplifier sees the final
    # shape and spends its triangles on it.
    thumb_chain = np.array([joint_centre(positions, faces, groups, f"joint-r-finger-1-{b}") for b in range(1, 5)])
    other_chain = np.array(
        [wrist] + [joint_centre(positions, faces, groups, f"joint-r-finger-{f}-1") for f in range(2, 6)]
    )
    thumb_dir = thumb_chain[0] - wrist
    index_dir = other_chain[1] - wrist
    current = math.degrees(
        math.acos(
            max(-1.0, min(1.0, float(np.dot(thumb_dir, index_dir) / (np.linalg.norm(thumb_dir) * np.linalg.norm(index_dir)))))
        )
    )
    delta = math.radians(args.thumb_abduction - current)
    if abs(delta) > 1e-4:
        # Pivot at the wrist, not at the thumb's own base. Abduction is the
        # angle between the first and second metacarpals, so it is measured to
        # thumb_chain[0]; rotating about that point leaves the measured angle
        # exactly where it started, which is what the first attempt did.
        pivot = wrist
        # cross(index, thumb), not cross(thumb, index): by the right-hand rule
        # a positive rotation about the latter carries the thumb TOWARDS the
        # index and closes the angle. The first attempt took 27 degrees to 14.
        spin = np.cross(index_dir, thumb_dir)
        spin /= np.linalg.norm(spin)

        def nearest(points: np.ndarray, chain: np.ndarray) -> np.ndarray:
            return np.min(np.linalg.norm(points[:, None, :] - chain[None, :, :], axis=2), axis=1)

        verts_now = mesh.vertices
        d_thumb = nearest(verts_now, thumb_chain)
        d_other = nearest(verts_now, other_chain)
        ratio = d_thumb / np.maximum(d_thumb + d_other, 1e-9)
        # 1 well inside the thumb, 0 well outside it, smoothstep across the web.
        t = np.clip((0.55 - ratio) / 0.25, 0.0, 1.0)
        weight = t * t * (3.0 - 2.0 * t)

        moved = verts_now.copy()
        for angle in np.unique(np.round(weight, 3)):
            if angle <= 0:
                continue
            sel = np.round(weight, 3) == angle
            rot = trimesh.transformations.rotation_matrix(delta * float(angle), spin, pivot)
            moved[sel] = trimesh.transform_points(verts_now[sel], rot)
        mesh = trimesh.Trimesh(vertices=moved, faces=mesh.faces, process=False)

        full = trimesh.transformations.rotation_matrix(delta, spin, pivot)
        thumb_chain = trimesh.transform_points(thumb_chain, full)
        print(f"thumb    abduction posed {current:.1f} -> {args.thumb_abduction:.1f} degrees, {int((weight > 0).sum()):,} vertices moved")

    if len(mesh.faces) > args.max_tris:
        mesh = mesh.simplify_quadric_decimation(face_count=args.max_tris)
        print(f"decimate {len(mesh.vertices):,} vertices, {len(mesh.faces):,} triangles")

    # Centre on the palm and scale to a unit hand length, so the scene places it
    # in its own terms rather than inheriting MakeHuman's body coordinates. The
    # transform is kept explicitly because the landmarks below must ride it.
    offset = -mesh.centroid.copy()
    mesh.apply_translation(offset)
    scale = 1.0 / float(np.max(mesh.extents))
    mesh.apply_scale(scale)

    # Carry the joint skeleton across into the exported frame.
    #
    # Without it there is no way to measure the hand afterwards. The obvious
    # alternative — recover a palm frame by PCA on the finished mesh — was
    # tried and is wrong: this hand rests in a relaxed, slightly curled pose,
    # so its principal axes do not line up with wrist-to-fingertip, and a
    # thickness profile taken in that frame showed two separate wide regions
    # and reported three fingers on a mesh that plainly has four. Anatomy has
    # to come from the anatomy, so it is exported beside the mesh.
    def to_local(point: np.ndarray) -> list[float]:
        return [round(float(v), 6) for v in (point + offset) * scale]

    landmarks = {
        "source": "MakeHuman base mesh joint helpers, CC0 1.0 (see docs/reference/LICENSES.md)",
        "frame": "mesh-local, matching public/models/hand.glb after centring and unit scaling",
        "order": "wrist, then fingers 1..5 (thumb..little), each proximal -> tip",
        "wrist": to_local(wrist),
        "fingers": [
            [to_local(point) for point in thumb_chain]
        ]
        + [
            [
                to_local(joint_centre(positions, faces, groups, f"joint-r-finger-{finger}-{bone}"))
                for bone in range(1, 5)
            ]
            for finger in range(2, 6)
        ],
    }
    landmarks_path = OUT.with_name("hand.landmarks.json")
    landmarks_path.write_text(json.dumps(landmarks, indent=2) + "\n", encoding="utf-8")
    print(f"wrote    {landmarks_path.relative_to(REPO)}  21 landmarks")

    # Thumb abduction, measured rather than assumed: the angle at the wrist
    # between the thumb's first bone and the index's, which is what Amendment 1
    # means by "thumb ~40 degrees abduction".
    thumb = thumb_chain[0] - wrist
    index = joint_centre(positions, faces, groups, "joint-r-finger-2-1") - wrist
    cos = float(np.dot(thumb, index) / (np.linalg.norm(thumb) * np.linalg.norm(index)))
    print(f"thumb    abduction {math.degrees(math.acos(max(-1.0, min(1.0, cos)))):.1f} degrees")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(trimesh.exchange.gltf.export_glb(mesh))
    size = OUT.stat().st_size
    print(f"wrote    {OUT.relative_to(REPO)}  {size:,} bytes  ({size / 1024:.1f} kB)")

    if not args.keep_src:
        pass  # the cache is gitignored; keeping it makes re-runs instant

    ok = len(mesh.faces) <= args.max_tris and size <= MAX_BYTES
    print(f"budget   tris {len(mesh.faces)} <= {args.max_tris} and bytes {size} <= {MAX_BYTES}: {'PASS' if ok else 'FAIL'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
