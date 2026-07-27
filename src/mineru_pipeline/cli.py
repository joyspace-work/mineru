from __future__ import annotations

import argparse
import sys

from .pipeline import (
    action_aggregate,
    action_clean,
    action_delete,
    action_edit,
    action_extract,
    action_list,
    action_sync,
    run_pipeline,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Codex-run Excel vehicle source extraction and Feishu sync pipeline")
    parser.add_argument("positional_action", nargs="?", help="Optional action: run/extract/aggregate/list/edit/delete/sync/clean")
    parser.add_argument(
        "--action",
        choices=["run", "extract", "aggregate", "list", "edit", "delete", "sync", "clean"],
        help="Pipeline action",
    )
    parser.add_argument("--input", help="Excel file or folder. Defaults to input/")
    parser.add_argument("--dry-run", action="store_true", help="Generate outputs without SQLite staging or Feishu upload")
    parser.add_argument("--id", dest="record_id", help="Record id for edit/delete")
    parser.add_argument("--key", help="Column key for edit")
    parser.add_argument("--val", help="New value for edit")
    parser.add_argument("--raw-candidates", help="Codex-created candidate JSON file to validate and aggregate")
    parser.add_argument("--no-require-evidence", action="store_true", help="Allow candidate fields without per-field evidence")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    action = args.action or args.positional_action or "run"
    if action == "run":
        return run_pipeline(args)
    if action == "extract":
        return action_extract(args)
    if action == "aggregate":
        return action_aggregate(args)
    if action == "list":
        return action_list()
    if action == "edit":
        if not args.record_id or not args.key or args.val is None:
            parser.error("edit requires --id <id> --key <field> --val <value>")
        return action_edit(args.record_id, args.key, args.val)
    if action == "delete":
        if not args.record_id:
            parser.error("delete requires --id <id>")
        return action_delete(args.record_id)
    if action == "sync":
        return action_sync(args.dry_run)
    if action == "clean":
        return action_clean()
    parser.error(f"Unknown action: {action}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
