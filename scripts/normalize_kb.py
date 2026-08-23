#!/usr/bin/env python3
"""
Normalize legacy HastRekha batch files (schema drift from batches 1–5A) to strict schema v1.0.

Usage:
  python scripts/normalize_kb.py --in data/kb/batches --report data/kb/normalize_report.json
Rewrites files IN PLACE (keeps a .bak copy on first run). Idempotent: clean files are left untouched.

What it fixes (every change is logged in the report):
  ops        equals→eq · contains→eq (scalar on array feature) · exists stays (engine supports it since engine v0.1.1)
  polarity   caution→negative
  category   legacy names → the 11 v1.0 categories; original kept as tag legacy_category_<name>
  weight     clamp to [0.4, 0.85]
  requires   added as [] when missing
  features   key renames that would otherwise collide with nested keys or bypass the API sanitiser
  windows    legacy birth-window ids (jun21_jul21 …) → canonical MARS_POS … ids from batch 5B
  head.quality  string "strong_clear" → numeric gte 0.6 (5B uses a 0–1 scale)
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import shutil
import sys

WEIGHT_MIN, WEIGHT_MAX = 0.4, 0.85

OP_MAP = {"equals": "eq", "contains": "eq", "eq": "eq", "gte": "gte", "lte": "lte", "in": "in", "exists": "exists"}

POLARITY_MAP = {"positive": "positive", "negative": "negative", "neutral": "neutral", "caution": "negative"}

CATEGORY_MAP = {
    # v1.0 canonical
    "career": "career", "love": "love", "wealth": "wealth", "personality": "personality", "vitality": "vitality",
    "timing": "timing", "travel": "travel", "obstacles": "obstacles", "children": "children",
    "protection": "protection", "reading_method": "reading_method",
    # legacy
    "personality_career": "career", "money_style": "wealth", "personality_communication": "personality",
    "willpower": "personality", "mentality": "personality", "mentality_creative": "personality",
    "life_events": "timing", "wellbeing": "vitality", "love_career_crossover": "love",
    "career_destiny": "career", "marriage": "love", "marriage_influence": "love",
    "relationships_caution": "love", "career_caution": "career", "life_events_caution": "obstacles",
    "success": "career", "marriage_success": "love", "success_caution": "obstacles",
    "marriage_timing": "timing", "marriage_wellbeing": "love", "marriage_caution": "love",
    "marriage_prosperity": "wealth", "marriage_interference": "love", "marriage_romance": "love",
    "love_nature": "love", "health": "vitality",
}

# Exact-key renames (collisions with nested keys, or groups the API sanitiser does not accept).
FEATURE_RENAME = {
    "thumb": "thumb.present",
    "lines.travel": "lines.travel.present",
    "hand_shape": "hand.shape",
    "hands.comparison_available": "reading.hands_comparison_available",
    "fingers.mercury_length": "fingers.mercury.length",
}
# Prefix renames.
FEATURE_PREFIX_RENAME = {
    "hand_shape_detail.": "hand.shape_detail.",
    "line_quality.": "lines.quality.",
}

# Legacy travel-caution window ids (batch 4) → canonical 5B ids. jan21_feb21 is shared by SAT/SUN/MOON_NEG;
# SAT_NEG is enough because the DOB resolver emits all three for that span.
WINDOW_MAP = {
    "jun21_jul21": "MOON_POS", "oct21_nov21": "MARS_NEG", "feb21_mar21": "JUP_NEG",
    "apr21_may21": "VEN_POS", "aug21_sep21": "MER_NEG", "dec21_jan21": "SAT_POS",
    "may21_jun21": "MER_POS", "sep21_oct21": "VEN_NEG", "jan21_feb21": "SAT_NEG",
}

HEAD_QUALITY_STRING_TO_NUMERIC = {"strong_clear": ("gte", 0.6), "weak": ("lte", 0.4), "poor": ("lte", 0.4)}


def rename_feature(key: str) -> str:
    if key in FEATURE_RENAME:
        return FEATURE_RENAME[key]
    for old, new in FEATURE_PREFIX_RENAME.items():
        if key.startswith(old):
            return new + key[len(old):]
    return key


def normalize_rule(rule: dict, log: list[dict]) -> dict:
    rid = rule.get("rule_id", "?")
    out = dict(rule)

    def note(kind: str, before, after) -> None:
        log.append({"rule_id": rid, "change": kind, "before": before, "after": after})

    # requires
    if "requires" not in out:
        out["requires"] = []
        note("requires_added", None, [])

    # category
    cat = out.get("category")
    mapped = CATEGORY_MAP.get(cat)
    if mapped is None:
        raise SystemExit(f"{rid}: unknown legacy category {cat!r} — add it to CATEGORY_MAP")
    if mapped != cat:
        tags = list(out.get("tags", []))
        legacy_tag = f"legacy_category_{cat}"
        if legacy_tag not in tags:
            tags.append(legacy_tag)
        out["tags"] = tags
        out["category"] = mapped
        note("category", cat, mapped)

    # polarity
    pol = out.get("polarity")
    mapped_pol = POLARITY_MAP.get(pol)
    if mapped_pol is None:
        raise SystemExit(f"{rid}: unknown polarity {pol!r}")
    if mapped_pol != pol:
        out["polarity"] = mapped_pol
        note("polarity", pol, mapped_pol)

    # weight
    weight = out.get("weight")
    if isinstance(weight, (int, float)):
        clamped = max(WEIGHT_MIN, min(WEIGHT_MAX, float(weight)))
        if clamped != weight:
            out["weight"] = clamped
            note("weight_clamped", weight, clamped)

    # conditions
    new_conditions = []
    for cond in out.get("conditions", []):
        c = dict(cond)
        op = OP_MAP.get(c.get("op"))
        if op is None:
            raise SystemExit(f"{rid}: unknown op {c.get('op')!r}")
        if op != c.get("op"):
            note("op", c["op"], op)
            c["op"] = op
        feat = c.get("feature", "")
        renamed = rename_feature(feat)
        if renamed != feat:
            note("feature_renamed", feat, renamed)
            c["feature"] = renamed
        # legacy birth windows
        if c["feature"] == "user.birth_window":
            val = c["value"]
            if isinstance(val, list):
                newv = [WINDOW_MAP.get(v, v) for v in val]
            else:
                newv = WINDOW_MAP.get(val, val)
            if newv != val:
                note("birth_window_ids", val, newv)
                c["value"] = newv
        # head quality string → numeric
        if c["feature"] == "lines.head.quality" and isinstance(c["value"], str):
            conv = HEAD_QUALITY_STRING_TO_NUMERIC.get(c["value"])
            if conv is None:
                raise SystemExit(f"{rid}: unmapped lines.head.quality value {c['value']!r}")
            note("head_quality_numeric", {"op": c["op"], "value": c["value"]}, {"op": conv[0], "value": conv[1]})
            c["op"], c["value"] = conv
        new_conditions.append(c)
    out["conditions"] = new_conditions
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--in", dest="in_dir", required=True)
    parser.add_argument("--report", dest="report", default=None)
    args = parser.parse_args()

    report: dict[str, object] = {"files": {}, "total_changes": 0}
    for path in sorted(glob.glob(os.path.join(args.in_dir, "hastrekha_kb_*.json"))):
        name = os.path.basename(path)
        raw = open(path, encoding="utf-8").read()
        doc = json.loads(raw)
        log: list[dict] = []
        doc["rules"] = [normalize_rule(r, log) for r in doc["rules"]]
        if log:
            backup = path + ".bak"
            if not os.path.exists(backup):
                shutil.copyfile(path, backup)
            meta = doc.setdefault("meta", {})
            meta["schema_version"] = "1.0"
            meta["normalized_to_v1"] = True
            meta["rule_count"] = len(doc["rules"])
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(doc, fh, ensure_ascii=False, indent=2)
        kinds: dict[str, int] = {}
        for entry in log:
            kinds[entry["change"]] = kinds.get(entry["change"], 0) + 1
        report["files"][name] = {"changes": len(log), "by_kind": kinds, "log": log}
        report["total_changes"] = int(report["total_changes"]) + len(log)
        print(f"{name}: {len(log)} changes {kinds if kinds else '(clean)'}")

    if args.report:
        with open(args.report, "w", encoding="utf-8") as fh:
            json.dump(report, fh, ensure_ascii=False, indent=2)
        print(f"report → {args.report}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
