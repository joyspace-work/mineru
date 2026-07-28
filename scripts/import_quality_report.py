from __future__ import annotations

import argparse
from pathlib import Path
import sys

SRC_ROOT = Path(__file__).resolve().parents[1] / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from mineru_pipeline.import_quality import build_quality_report, load_records, load_summary, write_report_files


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate import quality reports for prepared vehicle-source candidates.")
    parser.add_argument("--candidates", required=True, help="Candidate JSON file. Accepts a JSON list or an object with records[].")
    parser.add_argument("--summary", default=None, help="Optional summary JSON emitted by manual_excel_summary.py.")
    parser.add_argument("--raw", default=None, help="Optional raw intermediate JSON before prepare_current_feishu_candidates.py.")
    parser.add_argument("--output-prefix", required=True, help="Output path prefix, without suffix.")
    args = parser.parse_args()

    records = load_records(args.candidates)
    summary = load_summary(args.summary)
    raw_records = load_records(args.raw) if args.raw else None
    report = build_quality_report(records, summary=summary, raw_records=raw_records)
    paths = write_report_files(report, Path(args.output_prefix))
    for name, path in paths.items():
        print(f"{name}={path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
