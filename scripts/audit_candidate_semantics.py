from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

SRC_ROOT = Path(__file__).resolve().parents[1] / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from mineru_pipeline.field_semantics import lint_candidate_semantics, summarize_semantic_issues


def load_records(path: Path) -> list[dict[str, Any]]:
    data = json.loads(path.read_text("utf-8"))
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get("records"), list):
        return data["records"]
    raise ValueError("input must be a JSON list or an object with records[]")


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit candidate model/variant field semantics.")
    parser.add_argument("input", help="Candidate JSON list or object with records[].")
    parser.add_argument("--fail-on-issues", action="store_true", help="Exit 1 when semantic issues are found.")
    args = parser.parse_args()

    records = load_records(Path(args.input))
    summary = summarize_semantic_issues(records)
    issue_rows = []
    for index, record in enumerate(records, start=1):
        issues = lint_candidate_semantics(record)
        if issues:
            issue_rows.append(
                {
                    "index": index,
                    "record_id": record.get("record_id"),
                    "brand": record.get("brand"),
                    "model": record.get("model"),
                    "variant": record.get("variant"),
                    "issues": [issue.__dict__ for issue in issues],
                }
            )

    print(json.dumps({"records": len(records), "summary": summary, "examples": issue_rows[:20]}, ensure_ascii=False, indent=2))
    return 1 if args.fail_on_issues and issue_rows else 0


if __name__ == "__main__":
    raise SystemExit(main())
