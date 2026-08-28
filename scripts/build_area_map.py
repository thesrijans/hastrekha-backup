#!/usr/bin/env python3
"""
Build the HastRekha life-area map from the merged knowledge base.

Usage (from repo root):
  python scripts/build_area_map.py --in data/kb/hastrekha_kb.json --overrides data/areas/area-map.overrides.json --out data/areas/area-map.v1.json --report data/areas/area-map.report.md

Produces:
  data/areas/area-map.v1.json    per-rule area assignment + per-area rollup (the C2 scorer's input)
  data/areas/area-map.report.md  what mapped, what did not, and every signal that missed
Reads the KB strictly READ-ONLY — this script never writes inside data/kb.
Exit code 1 on any structural problem. Never writes a partial map.

Precedence, highest first. Exactly one of these decides a rule's primary_area:
  1 override   an explicit rule_id in the overrides file. Final — nothing else is consulted,
               so its secondary_areas are taken verbatim and tags are NOT read.
  2 prefix     PREFIX_AREA, keyed on the middle segment of PALM-<PREFIX>-NNN.
  3 category   CATEGORY_AREA, plus three special dispositions: obstacles is a MODIFIER routed
               only by its tags, timing is SKIPPED, reading_method is EXCLUDED.
  4 tag        TAG_AREA, an EXACT-MATCH allow-list. No substring or fuzzy matching anywhere.
               For everything except obstacles a tag may only ADD a secondary area; it can
               never override a primary. For obstacles it is the only route in, and a rule
               whose tags name no area is left unmapped rather than forced somewhere. When an
               obstacles rule's tags name MORE than one area the alphabetically first becomes
               primary and the rest secondary — arbitrary, but deterministic, and no rule in the
               shipped KB reaches it (all 19 tag-routed rules name exactly one area). Revisit
               the tie-break before it silently starts deciding something.

Determinism: every array is sorted, every dict is written with sorted keys, and weights are
copied from the KB rather than recomputed. `generated_at` is the SOURCE KB's extraction_date,
not the wall clock — a build stamp would make consecutive runs differ and there would be no
way to tell a real change from a re-run. Two runs over one KB produce byte-identical output.
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import sys

MAP_VERSION = "1.0"

# The five areas. Ids are fixed and are what every downstream layer keys on; labels follow the
# Hinglish register already used by CATEGORY_LABEL_HI in lib/hastrekha/narrator.ts.
AREA_IDS = ["dhan", "rishte", "karm", "sehat", "swabhav"]
AREA_LABELS = {
    "dhan": "Paisa aur Samriddhi",
    "rishte": "Pyaar aur Rishte",
    "karm": "Career aur Kaam",
    "sehat": "Urja aur Sehat",
    "swabhav": "Swabhav",
}

# Precedence 2. Keyed on the middle segment of PALM-<PREFIX>-NNN. Deliberately one entry in v1:
# MARR is the only prefix whose rules are scattered across categories that would mis-file them
# (love 21 / timing 4 / wealth 2), so it is the only one that earns a rule ahead of `category`.
PREFIX_AREA = {
    "MARR": "rishte",
}

# Precedence 3.
CATEGORY_AREA = {
    "wealth": "dhan",
    "love": "rishte",
    "children": "rishte",
    "career": "karm",
    "travel": "karm",
    "vitality": "sehat",
    "protection": "sehat",
    "personality": "swabhav",
}
# obstacles carries no area of its own — it says something went wrong, not what it went wrong in.
# Routed by tag only; unmapped when its tags name nothing.
CATEGORY_MODIFIER = "obstacles"
# timing describes WHEN, and the repo has no age-range logic to turn a phase into a date, so a
# timing rule has nothing to attach to yet. Skipped, not excluded: it is deferred work (C6).
CATEGORY_SKIP = "timing"
# reading_method is about how to read a hand. It is never shown to a user as a life-area finding.
CATEGORY_EXCLUDE = "reading_method"

# Precedence 4. EXACT match against rule.tags — no substring, no stemming, no prefix matching.
# A tag earns a place here only if it names a life domain on its own. Tags that merely describe
# a sign, a mount, a mechanism or a tone (island, mount_venus, dob_rule, softened, caution,
# gold_rule, shareable, legacy_category_*) are deliberately absent: they say where evidence came
# from, not what it is about. The report lists every entry that hit nothing.
TAG_AREA = {
    # dhan — money as the subject, not as a consequence
    "money": "dhan",
    "wealth": "dhan",
    "sasural_dhan": "dhan",
    "riches": "dhan",
    "prosperity": "dhan",
    # rishte
    "marriage": "rishte",
    "love": "rishte",
    "romance": "rishte",
    "union": "rishte",
    "children_lines": "rishte",
    # karm
    "career": "karm",
    "ambition": "karm",
    "leadership": "karm",
    "public_life": "karm",
    "travel_lines": "karm",
    "recognition": "karm",
    "service": "karm",
    "reputation": "karm",
    "fame": "karm",
    # sehat
    "vitality": "sehat",
    "protection": "sehat",
    "energy_leak": "sehat",
    # swabhav — character traits. The cluster from `pride` down appears almost only on obstacles
    # rules, which is what lets those be routed without spraying swabhav across the whole KB.
    "intellect": "swabhav",
    "imagination": "swabhav",
    "intuition": "swabhav",
    "communication": "swabhav",
    "sensitivity": "swabhav",
    "temper": "swabhav",
    "mood": "swabhav",
    "self_control": "swabhav",
    "self_awareness": "swabhav",
    "practical": "swabhav",
    "independence": "swabhav",
    "resilience": "swabhav",
    "magnetism": "swabhav",
    "intensity": "swabhav",
    "pride": "swabhav",
    "stubbornness": "swabhav",
    "impulsiveness": "swabhav",
    "confidence": "swabhav",
    "belief": "swabhav",
    "trust": "swabhav",
    "loneliness": "swabhav",
    "integrity": "swabhav",
    "focus": "swabhav",
    "excess": "swabhav",
    "pacing": "swabhav",
}

# How many segments of a dotted feature path make a root. "mounts.venus" and "lines.heart.depth"
# both collapse to two, which is the grain C2 needs: independence is a question about whether two
# rules read the same PART of the hand, not the same measurement of it.
FEATURE_ROOT_SEGMENTS = 2

THIN_AREA_RULES = 20
THIN_AREA_ROOTS = 4
OVER_MAPPED_AREAS = 3


def feature_roots(rule: dict) -> list[str]:
    """Distinct first-two-segment stems of every feature the rule's conditions read."""
    roots = set()
    for condition in rule.get("conditions", []):
        feature = condition.get("feature")
        if isinstance(feature, str) and feature:
            roots.add(".".join(feature.split(".")[:FEATURE_ROOT_SEGMENTS]))
    return sorted(roots)


def tag_areas(rule: dict) -> list[str]:
    """Areas named by this rule's tags, exact-match only, sorted and deduplicated."""
    return sorted({TAG_AREA[tag] for tag in rule.get("tags", []) if tag in TAG_AREA})


def decide(rule: dict, overrides: dict) -> tuple[str | None, list[str], str, str | None]:
    """
    One decision per rule.

    Returns (primary_area, secondary_areas, mapped_by, disposition). primary_area is None when
    the rule is not mapped; `disposition` then names why ("excluded", "timing_skipped",
    "modifier_no_area"), which is what the report groups on.
    """
    rule_id = rule["rule_id"]

    entry = overrides.get(rule_id)
    if entry is not None:
        # Final. Tags are not consulted, so whatever the author wrote is the whole answer.
        secondary = sorted({a for a in entry.get("secondary_areas", []) if a != entry["primary_area"]})
        return entry["primary_area"], secondary, "override", None

    from_tags = tag_areas(rule)

    prefix = rule_id.split("-")[1] if rule_id.count("-") >= 2 else ""
    if prefix in PREFIX_AREA:
        primary = PREFIX_AREA[prefix]
        return primary, [a for a in from_tags if a != primary], "prefix", None

    category = rule.get("category")
    if category == CATEGORY_EXCLUDE:
        return None, [], "", "excluded"
    if category == CATEGORY_SKIP:
        return None, [], "", "timing_skipped"
    if category == CATEGORY_MODIFIER:
        # Tags are the only way in. Never force an assignment — a modifier with no area is a
        # finding for the report, not a rule to be filed somewhere plausible.
        if not from_tags:
            return None, [], "", "modifier_no_area"
        return from_tags[0], from_tags[1:], "tag", None
    if category in CATEGORY_AREA:
        primary = CATEGORY_AREA[category]
        return primary, [a for a in from_tags if a != primary], "category", None

    return None, [], "", "unknown_category"


def build(kb: dict, overrides: dict) -> tuple[dict, dict]:
    """Returns (area_map, diagnostics). Diagnostics carry everything the report needs."""
    rules = sorted(kb["rules"], key=lambda r: r["rule_id"])
    mapped: list[dict] = []
    unmapped: list[dict] = []
    excluded: list[dict] = []
    tags_hit: set[str] = set()

    for rule in rules:
        primary, secondary, mapped_by, disposition = decide(rule, overrides)
        for tag in rule.get("tags", []):
            if tag in TAG_AREA:
                tags_hit.add(tag)
        record = {
            "rule_id": rule["rule_id"],
            "category": rule["category"],
            "polarity": rule["polarity"],
            "tags": list(rule.get("tags", [])),
            "disposition": disposition,
        }
        if primary is None:
            (excluded if disposition == "excluded" else unmapped).append(record)
            continue
        mapped.append({
            "rule_id": rule["rule_id"],
            "primary_area": primary,
            "secondary_areas": secondary,
            # Copied from the KB, never re-derived — the engine's polarity is the only polarity.
            "polarity": rule["polarity"],
            "weight": rule["weight"],
            "safety_class": rule["safety_class"],
            "feature_roots": feature_roots(rule),
            "mapped_by": mapped_by,
        })

    areas: dict[str, dict] = {}
    for area in AREA_IDS:
        members = [m for m in mapped if m["primary_area"] == area or area in m["secondary_areas"]]
        roots: set[str] = set()
        split = {"positive": 0, "neutral": 0, "negative": 0}
        for member in members:
            roots.update(member["feature_roots"])
            split[member["polarity"]] += 1
        areas[area] = {
            "label_hi_en": AREA_LABELS[area],
            "rule_ids": sorted(m["rule_id"] for m in members),
            "feature_roots": sorted(roots),
            "polarity_split": split,
        }

    area_map = {
        "meta": {
            "map_version": MAP_VERSION,
            "kb_version": kb["meta"]["kb_version"],
            # The source KB's own stamp. See the determinism note in the module docstring.
            "generated_at": kb["meta"]["extraction_date"],
            "rule_count_in": len(rules),
            "mapped": len(mapped),
            "unmapped": len(unmapped),
            "excluded": len(excluded),
        },
        "areas": areas,
        "rules": mapped,
    }
    diagnostics = {
        "mapped": mapped,
        "unmapped": unmapped,
        "excluded": excluded,
        "tags_missed": sorted(set(TAG_AREA) - tags_hit),
    }
    return area_map, diagnostics


def write_report(path: str, area_map: dict, diag: dict) -> list[str]:
    """Writes the markdown report. Returns the warning lines, so main() can echo them."""
    meta = area_map["meta"]
    mapped = diag["mapped"]
    by_area_primary = collections.Counter(m["primary_area"] for m in mapped)
    warnings: list[str] = []
    out: list[str] = []

    out.append("# Area map — build report")
    out.append("")
    out.append(f"Generated by `scripts/build_area_map.py` from KB `{meta['kb_version']}` "
               f"(extraction {meta['generated_at']}). Map version {meta['map_version']}.")
    out.append("")
    out.append(f"**{meta['mapped']} of {meta['rule_count_in']} rules mapped** "
               f"({100.0 * meta['mapped'] / meta['rule_count_in']:.1f}%) · "
               f"{meta['unmapped']} unmapped · {meta['excluded']} excluded.")
    out.append("")

    out.append("## Per area")
    out.append("")
    out.append("`rules` counts every rule for which the area is primary OR secondary — that is the "
               "evidence pool, and the denominator a coverage number should use. `primary` is the "
               "subset the area owns outright.")
    out.append("")
    out.append("| area | label | rules | primary | positive | neutral | negative | feature_roots |")
    out.append("|---|---|---:|---:|---:|---:|---:|---:|")
    for area in AREA_IDS:
        block = area_map["areas"][area]
        split = block["polarity_split"]
        out.append(f"| `{area}` | {block['label_hi_en']} | {len(block['rule_ids'])} | "
                   f"{by_area_primary[area]} | {split['positive']} | {split['neutral']} | "
                   f"{split['negative']} | {len(block['feature_roots'])} |")
    out.append("")

    out.append("### Thin-area check")
    out.append("")
    out.append(f"Flagged when an area holds fewer than {THIN_AREA_RULES} rules or fewer than "
               f"{THIN_AREA_ROOTS} distinct feature roots. A thin area cannot carry a verdict: it "
               "either has too little evidence to disagree with itself, or every rule in it reads "
               "the same part of the hand.")
    out.append("")
    for area in AREA_IDS:
        block = area_map["areas"][area]
        problems = []
        if len(block["rule_ids"]) < THIN_AREA_RULES:
            problems.append(f"{len(block['rule_ids'])} rules < {THIN_AREA_RULES}")
        if len(block["feature_roots"]) < THIN_AREA_ROOTS:
            problems.append(f"{len(block['feature_roots'])} feature roots < {THIN_AREA_ROOTS}")
        if problems:
            line = f"- **THIN — `{area}`**: {'; '.join(problems)}."
            out.append(line)
            warnings.append(f"THIN {area}: {'; '.join(problems)}")
    if not warnings:
        out.append("- No area is thin.")
    out.append("")

    over = sorted((m for m in mapped if 1 + len(m["secondary_areas"]) >= OVER_MAPPED_AREAS),
                  key=lambda m: (-(1 + len(m["secondary_areas"])), m["rule_id"]))
    out.append(f"### Rules in {OVER_MAPPED_AREAS}+ areas — over-mapping signal")
    out.append("")
    if over:
        out.append(f"{len(over)} rules. A rule that is evidence everywhere is evidence nowhere: each "
                   "of these is a candidate for a tighter tag table or an explicit override.")
        out.append("")
        out.append("| rule_id | primary | secondary | mapped_by |")
        out.append("|---|---|---|---|")
        for m in over:
            out.append(f"| `{m['rule_id']}` | `{m['primary_area']}` | "
                       f"{', '.join('`' + a + '`' for a in m['secondary_areas'])} | {m['mapped_by']} |")
        warnings.append(f"OVER-MAPPED {len(over)} rules in {OVER_MAPPED_AREAS}+ areas")
    else:
        out.append("None.")
    out.append("")

    out.append("## Unmapped rules")
    out.append("")
    out.append("The full list, so an override can be written against it. `timing_skipped` is "
               "deferred by design (see docs/AREA_VERDICTS.md); `modifier_no_area` is an "
               "`obstacles` rule whose tags named no area and which was deliberately NOT forced "
               "into one.")
    out.append("")
    for disposition in ["modifier_no_area", "timing_skipped", "unknown_category"]:
        group = [r for r in diag["unmapped"] if r["disposition"] == disposition]
        if not group:
            continue
        out.append(f"### `{disposition}` — {len(group)}")
        out.append("")
        out.append("| rule_id | category | tags |")
        out.append("|---|---|---|")
        for r in group:
            out.append(f"| `{r['rule_id']}` | {r['category']} | {', '.join(r['tags'])} |")
        out.append("")

    out.append("## Excluded rules")
    out.append("")
    out.append(f"`{CATEGORY_EXCLUDE}` — how to read a hand, never a finding about a life. "
               f"{len(diag['excluded'])} rules, excluded by design and not counted against coverage.")
    out.append("")
    out.append("| rule_id | tags |")
    out.append("|---|---|")
    for r in diag["excluded"]:
        out.append(f"| `{r['rule_id']}` | {', '.join(r['tags'])} |")
    out.append("")

    out.append("## Tag table")
    out.append("")
    out.append("Exact match only. For every category except `obstacles` a tag may add a SECONDARY "
               "area and can never change a primary; for `obstacles` it is the only route in.")
    out.append("")
    out.append("| area | tags |")
    out.append("|---|---|")
    for area in AREA_IDS:
        tags = sorted(t for t, a in TAG_AREA.items() if a == area)
        out.append(f"| `{area}` | {', '.join('`' + t + '`' for t in tags)} |")
    out.append("")
    out.append("### Tags in the table that matched no rule")
    out.append("")
    if diag["tags_missed"]:
        out.append(", ".join(f"`{t}`" for t in diag["tags_missed"]))
        out.append("")
        out.append("These are dead entries — either the tag was renamed in the KB or it was never "
                   "used. They cost nothing at runtime but they are misleading to read, so they "
                   "should be removed or corrected before v2.")
        warnings.append(f"DEAD TAGS {len(diag['tags_missed'])}: {', '.join(diag['tags_missed'])}")
    else:
        out.append("None — every tag in the table matched at least one rule.")
    out.append("")

    out.append("## How each mapped rule got its area")
    out.append("")
    out.append("| mapped_by | rules |")
    out.append("|---|---:|")
    for source, count in sorted(collections.Counter(m["mapped_by"] for m in mapped).items()):
        out.append(f"| `{source}` | {count} |")
    out.append("")

    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(out) + "\n")
    return warnings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--in", dest="in_path", required=True, help="merged KB json (read-only)")
    parser.add_argument("--overrides", dest="overrides_path", required=True)
    parser.add_argument("--out", dest="out_path", required=True)
    parser.add_argument("--report", dest="report_path", required=True)
    args = parser.parse_args()

    with open(args.in_path, encoding="utf-8") as fh:
        kb = json.load(fh)
    with open(args.overrides_path, encoding="utf-8") as fh:
        overrides_doc = json.load(fh)

    problems: list[str] = []
    if not isinstance(kb.get("rules"), list) or not kb["rules"]:
        problems.append("KB has no rules")
    overrides = overrides_doc.get("overrides", {})
    if not isinstance(overrides, dict):
        problems.append("overrides.overrides is not an object")
        overrides = {}
    known = {r["rule_id"] for r in kb.get("rules", [])}
    for rule_id, entry in sorted(overrides.items()):
        if rule_id not in known:
            problems.append(f"override {rule_id}: no such rule in the KB")
        if entry.get("primary_area") not in AREA_IDS:
            problems.append(f"override {rule_id}: primary_area {entry.get('primary_area')!r}")
        for area in entry.get("secondary_areas", []):
            if area not in AREA_IDS:
                problems.append(f"override {rule_id}: secondary_area {area!r}")
        if not str(entry.get("why", "")).strip():
            problems.append(f"override {rule_id}: `why` is mandatory")
    if problems:
        print("FAIL  overrides/KB problems:", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        return 1

    area_map, diag = build(kb, overrides)

    os.makedirs(os.path.dirname(os.path.abspath(args.out_path)), exist_ok=True)
    with open(args.out_path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(area_map, fh, ensure_ascii=False, indent=2, sort_keys=True)
        fh.write("\n")
    warnings = write_report(args.report_path, area_map, diag)

    meta = area_map["meta"]
    print(f"OK  mapped={meta['mapped']}/{meta['rule_count_in']}  "
          f"unmapped={meta['unmapped']}  excluded={meta['excluded']}")
    print("per-area (rules/primary/roots):", {
        area: (len(area_map["areas"][area]["rule_ids"]),
               sum(1 for m in area_map["rules"] if m["primary_area"] == area),
               len(area_map["areas"][area]["feature_roots"]))
        for area in AREA_IDS
    })
    for warning in warnings:
        print(f"WARN  {warning}")
    print(f"wrote {args.out_path} and {args.report_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
