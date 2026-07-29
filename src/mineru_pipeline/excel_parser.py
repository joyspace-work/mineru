"""Excel Parser alias delegating to parser module."""

from .parser import (
    extract_path_metadata,
    is_vertical_parameter_table,
    normalize_header_cell,
    parse_excel_file,
    parse_unstructured_text_rows,
    parse_vertical_parameter_table,
)

__all__ = [
    "extract_path_metadata",
    "is_vertical_parameter_table",
    "normalize_header_cell",
    "parse_excel_file",
    "parse_unstructured_text_rows",
    "parse_vertical_parameter_table",
]
