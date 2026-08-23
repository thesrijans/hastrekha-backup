import assert from "node:assert/strict";
import { sanitizeReadingRequest } from "../lib/hastrekha/sanitize";
import { checkRateLimit, resetRateLimits } from "../lib/hastrekha/rate-limit";

const ok = sanitizeReadingRequest({
  tier: "deep",
  question: "career kab badlega?\u0000<script>",
  features: { mounts: { jupiter: 1.7, venus: -2, "DROP TABLE": 1 }, user: { birth_date: "1994-03-25", role: "admin" }, hacks: { x: 1 } },
  categories: ["career", "bogus"],
}, 500);
assert.ok(ok.ok);
if (ok.ok) {
  const mounts = ok.request.features.mounts as { jupiter: number; venus: number };
  assert.equal(mounts.jupiter, 1);
  assert.equal(mounts.venus, 0);
  assert.deepEqual(ok.request.features.user, { birth_date: "1994-03-25" });
  assert.equal("hacks" in ok.request.features, false);
  assert.equal(ok.request.question, "career kab badlega?<script>");
  assert.deepEqual(ok.request.categories, ["career"]);
  assert.equal(ok.request.tier, "deep");
}
assert.equal(sanitizeReadingRequest({}, 10).ok, false);
assert.equal(sanitizeReadingRequest({ features: { mounts: { jupiter: 0.5 } } }, 99_999).ok, false);
assert.equal(sanitizeReadingRequest({ features: { user: { birth_date: "25-03-1994" } } }, 10).ok, false);

resetRateLimits();
for (let i = 0; i < 3; i += 1) assert.ok(checkRateLimit("ip", 3, 1000, 1_000 + i).allowed);
const blocked = checkRateLimit("ip", 3, 1000, 1_010);
assert.equal(blocked.allowed, false);
assert.ok(blocked.retryAfterSeconds >= 1);
assert.ok(checkRateLimit("ip", 3, 1000, 2_100).allowed, "window slides");
console.log("SANITIZE + RATE LIMIT PASSED");
