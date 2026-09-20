"""
Render public/models/hand.glb to a PNG so a human can confirm it is a hand.

The loop harness (docs/specs/loop-harness.md §3) will not take a mesh on its
triangle count: 2,999 triangles is equally consistent with a hand and with a
lump. Amendment 1's checklist asks whether the thing "has knuckles, a thenar
bulge, and an opposing thumb", and the only way to answer that is to look.

Three orthographic views with flat Lambert shading, rasterised with a z-buffer
in numpy — no GL context, so it runs anywhere the extraction runs.

    python scripts/models/preview_hand.py
    python scripts/models/preview_hand.py --out some/where.png --size 720
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image

REPO = Path(__file__).resolve().parents[2]
MODEL = REPO / "public" / "models" / "hand.glb"

# Palm-forward, edge-on, and side — enough to judge bulges and thumb opposition.
VIEWS = {
    "palm": (0, 1, 2),
    "edge": (2, 1, 0),
    "back": (0, 2, 1),
}


def load(path: Path) -> trimesh.Trimesh:
    loaded = trimesh.load(path, force="mesh")
    if not isinstance(loaded, trimesh.Trimesh):
        raise SystemExit(f"{path} did not load as a single mesh")
    return loaded


def render(mesh: trimesh.Trimesh, axes: tuple[int, int, int], size: int) -> np.ndarray:
    """Orthographic z-buffer raster with one warm key light."""
    ax_x, ax_y, ax_z = axes
    verts = mesh.vertices.copy()
    tris = mesh.faces

    pts = verts[:, [ax_x, ax_y]]
    lo, hi = pts.min(axis=0), pts.max(axis=0)
    span = float(np.max(hi - lo)) or 1.0
    margin = size * 0.08
    scale = (size - 2 * margin) / span
    centred = (pts - (lo + hi) / 2.0) * scale
    screen = np.empty_like(centred)
    screen[:, 0] = centred[:, 0] + size / 2.0
    screen[:, 1] = size / 2.0 - centred[:, 1]
    depth = verts[:, ax_z]

    image = np.zeros((size, size), dtype=np.float64)
    zbuf = np.full((size, size), -np.inf)

    normals = mesh.face_normals
    light = np.array([0.4, 0.6, 0.7])
    light = light / np.linalg.norm(light)
    shade = np.clip(normals @ light, 0.0, 1.0) * 0.82 + 0.18

    for tri, lit in zip(tris, shade):
        p = screen[tri]
        z = depth[tri].mean()
        min_x = max(int(np.floor(p[:, 0].min())), 0)
        max_x = min(int(np.ceil(p[:, 0].max())), size - 1)
        min_y = max(int(np.floor(p[:, 1].min())), 0)
        max_y = min(int(np.ceil(p[:, 1].max())), size - 1)
        if min_x > max_x or min_y > max_y:
            continue
        xs = np.arange(min_x, max_x + 1)
        ys = np.arange(min_y, max_y + 1)
        gx, gy = np.meshgrid(xs, ys)
        # Barycentric inside-test.
        x1, y1 = p[0]
        x2, y2 = p[1]
        x3, y3 = p[2]
        den = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3)
        if abs(den) < 1e-12:
            continue
        a = ((y2 - y3) * (gx - x3) + (x3 - x2) * (gy - y3)) / den
        b = ((y3 - y1) * (gx - x3) + (x1 - x3) * (gy - y3)) / den
        c = 1.0 - a - b
        inside = (a >= 0) & (b >= 0) & (c >= 0)
        if not inside.any():
            continue
        yy, xx = gy[inside], gx[inside]
        closer = z > zbuf[yy, xx]
        if not closer.any():
            continue
        yy, xx = yy[closer], xx[closer]
        zbuf[yy, xx] = z
        image[yy, xx] = lit
    return image


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, default=MODEL)
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--size", type=int, default=520)
    args = parser.parse_args()

    mesh = load(args.model)
    print(f"mesh     {len(mesh.vertices):,} vertices, {len(mesh.faces):,} triangles")
    print(f"watertight {mesh.is_watertight}  euler {mesh.euler_number}")

    panels = [render(mesh, axes, args.size) for axes in VIEWS.values()]
    strip = np.concatenate(panels, axis=1)

    # Warm gold on near-black, so it reads like the room rather than a CAD app.
    rgb = np.zeros((*strip.shape, 3), dtype=np.uint8)
    rgb[..., 0] = np.clip(strip * 255 * 1.00, 0, 255)
    rgb[..., 1] = np.clip(strip * 255 * 0.78, 0, 255)
    rgb[..., 2] = np.clip(strip * 255 * 0.42, 0, 255)

    out = args.out or (REPO / "captures" / "ui" / "hand-preview.png")
    out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgb).save(out)
    print(f"wrote    {out}  ({', '.join(VIEWS)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
