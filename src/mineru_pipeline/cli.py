from __future__ import annotations

import argparse
import sys

from .pipeline import (
    action_clean,
    action_delete,
    action_edit,
    action_list,
    action_sync,
    run_pipeline,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="MinerU vehicle source recognition pipeline")
    parser.add_argument("positional_action", nargs="?", help="Optional action: run/list/edit/delete/sync/clean")
    parser.add_argument("--action", choices=["run", "list", "edit", "delete", "sync", "clean"], help="Pipeline action")
    parser.add_argument("--dry-run", action="store_true", help="Generate outputs without SQLite staging or Feishu upload")
    parser.add_argument("--skip-classify", action="store_true", help="Use existing input/classified directory")
    parser.add_argument("--skip-ocr", action="store_true", help="Use existing MinerU output manifest")
    parser.add_argument("--force-ocr", action="store_true", help="Ignore MinerU cache and reprocess")
    parser.add_argument("--vision-fallback", action="store_true", help="Use LLM vision fallback after MinerU failure")
    parser.add_argument("--no-vision-fallback", action="store_true", help="Disable LLM vision fallback")
    parser.add_argument("--id", dest="record_id", help="Record id for edit/delete")
    parser.add_argument("--key", help="Column key for edit")
    parser.add_argument("--val", help="New value for edit")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    action = args.action or args.positional_action or "run"
    if action == "run":
        return run_pipeline(args)
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
