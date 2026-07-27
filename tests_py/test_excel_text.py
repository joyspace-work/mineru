from pathlib import Path

from openpyxl import Workbook

from mineru_pipeline.excel_text import iter_excel_files, render_excel_file


def test_render_excel_file_preserves_sheet_rows_columns_and_merged_values(tmp_path: Path):
    path = tmp_path / "supplier.xlsx"
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "报价表"
    sheet["A1"] = "地点"
    sheet["B1"] = "车型"
    sheet["C1"] = "FCA提货价 usd"
    sheet.merge_cells("A2:A3")
    sheet["A2"] = "霍尔果斯基地"
    sheet["B2"] = "车型A"
    sheet["C2"] = 9250
    sheet["B3"] = "车型B"
    sheet["C3"] = 9300
    workbook.save(path)

    rendered = render_excel_file(path)

    assert "# Source: supplier.xlsx" in rendered.text
    assert "## Sheet: 报价表" in rendered.text
    assert "merged: A2:A3=霍尔果斯基地" in rendered.text
    assert "row 2: A=霍尔果斯基地 | B=车型A | C=9250" in rendered.text
    assert "row 3: A=霍尔果斯基地 | B=车型B | C=9300" in rendered.text
    assert rendered.row_count == 3


def test_iter_excel_files_accepts_excel_and_csv_only(tmp_path: Path):
    (tmp_path / "a.xlsx").write_bytes(b"xlsx")
    (tmp_path / "b.csv").write_text("a,b", "utf-8")
    (tmp_path / "c.png").write_bytes(b"png")
    (tmp_path / "~$lock.xlsx").write_bytes(b"lock")

    files = [path.name for path in iter_excel_files(tmp_path)]

    assert files == ["a.xlsx", "b.csv"]
