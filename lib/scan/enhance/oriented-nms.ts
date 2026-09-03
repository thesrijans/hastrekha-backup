/**
 * @file Oriented non-maximum suppression.
 *
 * Keeps a pixel only if its response is maximal across the local line
 * normal. Unlike morphological thinning of a thresholded blob, this follows the
 * estimated orientation, so a curving crease yields a continuous one-pixel
 * ridge instead of a ragged skeleton with spurs. The output is the natural
 * input for polyline extraction.
 *
 * Layer: lib/scan/enhance (production). Pure. Imports nothing from lib/scan/dev.
 */
import { sampleBilinear } from "./kernels";
import type { OrientationField } from "./orientation";

/** Distance along the normal at which the two comparison samples are taken. */
export const NMS_NORMAL_STEP_PX = 1.0;

/**
 * Suppress non-maxima across the line normal.
 * Ties are kept on both sides, so a perfectly flat two-pixel plateau survives
 * as two pixels; real detector profiles are peaked and yield one.
 * @param response Response map in [0, 1], size×size row-major.
 * @param field Orientation field of the same frame.
 * @param size Image side length.
 * @param out Destination buffer, may not alias `response`.
 * @param minResponse Responses below this are zeroed before the comparison.
 */
export function orientedNonMaxSuppressionInto(
  response: Float32Array,
  field: OrientationField,
  size: number,
  out: Float32Array,
  minResponse = 0,
): void {
  const { theta } = field;
  for (let y = 0; y < size; y += 1) {
    const row = y * size;
    for (let x = 0; x < size; x += 1) {
      const i = row + x;
      const r = response[i] ?? 0;
      if (r < minResponse || r <= 0) {
        out[i] = 0;
        continue;
      }
      const t = theta[i] ?? 0;
      const nx = -Math.sin(t) * NMS_NORMAL_STEP_PX;
      const ny = Math.cos(t) * NMS_NORMAL_STEP_PX;
      const forward = sampleBilinear(response, size, x + nx, y + ny);
      const backward = sampleBilinear(response, size, x - nx, y - ny);
      out[i] = r >= forward && r >= backward ? r : 0;
    }
  }
}
