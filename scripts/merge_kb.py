#!/usr/bin/env python3
"""
Merge HastRekha KB batch files into one validated knowledge base.

Usage (from repo root):
  python scripts/merge_kb.py --in data/kb/batches --out data/kb/hastrekha_kb.json --version 0.2.0-cheiro-complete

Produces:
  data/kb/hastrekha_kb.json          merged KB (meta + rules) consumed by lib/hastrekha
  data/kb/hastrekha_kb.features.json every feature key with ops/values seen (drives the /read form + CV mapping)
Exit code 1 on any validation failure. Never writes a partially valid KB.
"""
from __future__ import annotations

import argparse
import collections
import glob
import json
import os
import re
import sys

RULE_ID = re.compile(r"^PALM-[A-Z]{3,5}-\d{3}$")
DEVANAGARI = re.compile(r"[\u0900-\u097F]")
REQUIRED = ["rule_id", "domain", "category", "conditions", "requires", "interpretation_hi_en",
            "polarity", "weight", "sources", "tags", "safety_class"]
CATEGORIES = {"career", "love", "wealth", "personality", "vitality", "timing", "travel",
              "obstacles", "children", "protection", "reading_method"}
POLARITIES = {"positive", "negative", "neutral"}
SAFETY = {"standard", "sensitive"}
OPS = {"gte", "lte", "eq", "in"}
WEIGHT_MIN, WEIGHT_MAX = 0.4, 0.85
SCHEMA_VERSION = "1.0"


def validate_rule(rule: dict, problems: list[str]) -> None:
    rid = rule.get("rule_id", "<no id>")
    for key in REQUIRED:
        if key not in rule:
            problems.append(f"{rid}: missing {key}")
    extra = [k for k in rule if k not in REQUIRED]
    if extra:
        problems.append(f"{rid}: unexpected fields {extra}")
    if not RULE_ID.match(str(rid)):
        problems.append(f"{rid}: bad rule_id format")
    if rule.get("domain") != "palmistry":
        problems.append(f"{rid}: domain")
    if rule.get("category") not in CATEGORIES:
        problems.append(f"{rid}: category {rule.get('category')}")
    if rule.get("polarity") not in POLARITIES:
        problems.append(f"{rid}: polarity")
    if rule.get("safety_class") not in SAFETY:
        problems.append(f"{rid}: safety_class")
    weight = rule.get("weight")
    if not isinstance(weight, (int, float)) or not (WEIGHT_MIN <= weight <= WEIGHT_MAX):
        problems.append(f"{rid}: weight {weight}")
    conditions = rule.get("conditions")
    if not isinstance(conditions, list) or not conditions:
        problems.append(f"{rid}: conditions empty")
    else:
        for cond in conditions:
            if not isinstance(cond, dict) or set(cond) != {"feature", "op", "value"}:
                problems.append(f"{rid}: bad condition {cond}")
            elif cond["op"] not in OPS:
                problems.append(f"{rid}: bad op {cond['op']}")
    interp = rule.get("interpretation_hi_en", "")
    if not isinstance(interp, str) or not interp.strip():
        problems.append(f"{rid}: empty interpretation")
    elif DEVANAGARI.search(interp):
        problems.append(f"{rid}: Devanagari in interpretation")
    sources = rule.get("sources")
    if not isinstance(sources, list) or not sources:
        problems.append(f"{rid}: sources missing")
    else:
        for src in sources:
            if not isinstance(src, dict) or set(src) != {"text", "loc", "year"}:
                problems.append(f"{rid}: bad source {src}")
    if not isinstance(rule.get("tags"), list) or not rule["tags"]:
        problems.append(f"{rid}: tags missing")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--in", dest="in_dir", required=True, help="directory with hastrekha_kb_*.json batch files")
    parser.add_argument("--out", dest="out_path", required=True)
    parser.add_argument("--version", dest="version", required=True, help="kb_version for the merged file")
    args = parser.parse_args()

    paths = sorted(glob.glob(os.path.join(args.in_dir, "hastrekha_kb_*.json")))
    if not paths:
        print(f"no batch files in {args.in_dir}", file=sys.stderr)
        return 1

    problems: list[str] = []
    rules: list[dict] = []
    seen: dict[str, str] = {}
    birth_windows = None
    per_batch: dict[str, int] = {}
    sources_seen: set[str] = set()
    exclusions: list[dict] = []
    latest_date = ""

    for path in paths:
        raw = open(path, encoding="utf-8").read()
        if DEVANAGARI.search(raw):
            problems.append(f"{os.path.basename(path)}: Devanagari present somewhere in file")
        doc = json.loads(raw)
        meta, batch_rules = doc.get("meta", {}), doc.get("rules", [])
        name = os.path.basename(path)
        if meta.get("schema_version") != SCHEMA_VERSION:
            problems.append(f"{name}: schema_version {meta.get('schema_version')}")
        if meta.get("rule_count") != len(batch_rules):
            problems.append(f"{name}: meta.rule_count {meta.get('rule_count')} != {len(batch_rules)}")
        if meta.get("mount_birth_windows"):
            birth_windows = meta["mount_birth_windows"]
        latest_date = max(latest_date, str(meta.get("extraction_date", "")))
        for item in meta.get("safety_exclusion_policy", {}).get("excluded_in_this_batch", []) or []:
            exclusions.append({"batch": name, **item})
        per_batch[name] = len(batch_rules)
        for rule in batch_rules:
            validate_rule(rule, problems)
            rid = rule.get("rule_id")
            if rid in seen:
                problems.append(f"{rid}: duplicate (also in {seen[rid]})")
                continue
            seen[rid] = name
            rules.append(rule)
            for src in rule.get("sources", []):
                if isinstance(src, dict):
                    sources_seen.add(src.get("text", ""))

    if problems:
        print("MERGE FAILED")
        for problem in problems[:50]:
            print(" -", problem)
        if len(problems) > 50:
            print(f" ... {len(problems) - 50} more")
        return 1

    # Feature vocabulary — what the UI form / CV mapper must be able to supply.
    features: dict[str, dict] = {}
    for rule in rules:
        for cond in rule["conditions"]:
            entry = features.setdefault(cond["feature"], {"ops": set(), "values": set(), "rule_count": 0})
            entry["ops"].add(cond["op"])
            vals = cond["value"] if isinstance(cond["value"], list) else [cond["value"]]
            for val in vals:
                entry["values"].add(json.dumps(val))
            entry["rule_count"] += 1
    features_out = {
        key: {
            "ops": sorted(entry["ops"]),
            "values": sorted(json.loads(v) for v in entry["values"]) if all(isinstance(json.loads(v), (int, float)) for v in entry["values"]) else sorted(entry["values"]),
            "rule_count": entry["rule_count"],
        }
        for key, entry in sorted(features.items())
    }

    # Collision report: same concept under different keys (e.g. lines.head.quality vs lines.head.* from batch 1)
    stems = collections.defaultdict(list)
    for key in features:
        stems[".".join(key.split(".")[:2])].append(key)
    collisions = {stem: keys for stem, keys in stems.items() if len(keys) > 1}

    rules.sort(key=lambda r: r["rule_id"])
    merged = {
        "meta": {
            "kb_name": "HastRekha AI — Rules Knowledge Base",
            "kb_version": args.version,
            "schema_version": SCHEMA_VERSION,
            "extraction_date": latest_date,
            "rule_count": len(rules),
            "sources": sorted(s for s in sources_seen if s),
            "batches": per_batch,
            "by_prefix": dict(collections.Counter(r["rule_id"].split("-")[1] for r in rules)),
            "by_category": dict(collections.Counter(r["category"] for r in rules)),
            "sensitive_count": sum(r["safety_class"] == "sensitive" for r in rules),
            "mount_birth_windows": birth_windows,
            "safety_exclusions": exclusions,
        },
        "rules": rules,
    }

    os.makedirs(os.path.dirname(os.path.abspath(args.out_path)), exist_ok=True)
    with open(args.out_path, "w", encoding="utf-8") as fh:
        json.dump(merged, fh, ensure_ascii=False, indent=2)
    features_path = re.sub(r"\.json$", ".features.json", args.out_path)
    with open(features_path, "w", encoding="utf-8") as fh:
        json.dump({"features": features_out, "possible_collisions": collisions}, fh, ensure_ascii=False, indent=2)

    print(f"OK  rules={len(rules)}  batches={len(paths)}  features={len(features_out)}  sensitive={merged['meta']['sensitive_count']}")
    print("by_prefix:", merged["meta"]["by_prefix"])
    if collisions:
        print("REVIEW possible feature-key collisions:")
        for stem, keys in collisions.items():
            print(f"  {stem}: {keys}")
    print(f"wrote {args.out_path} and {features_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
