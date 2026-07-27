"""CLI Entrypoint alias delegating to pipeline module."""

from .pipeline import build_parser, main

__all__ = ["build_parser", "main"]

if __name__ == "__main__":
    import sys
    sys.exit(main())
