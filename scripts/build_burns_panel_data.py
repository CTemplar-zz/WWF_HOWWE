"""Export the AP/year burn workbook to the small M3 browser dataset."""

import json
from pathlib import Path

from openpyxl import load_workbook


ROOT = Path(__file__).resolve().parents[1]
WORKBOOK = ROOT / "assets/downloads/Superficie_Quemas_AP_2016_2023.xlsx"
OUTPUT = ROOT / "assets/capas/geo_burns_m3.js"


def main():
    sheet = load_workbook(WORKBOOK, read_only=True, data_only=True).active
    values = list(sheet.values)
    years = list(range(2016, 2024))
    rows = []
    for row in values[5:]:
        if not isinstance(row[0], int):
            continue
        rows.append({
            "id": row[0],
            "name": row[1],
            "apHa": row[2],
            "annual": {str(year): row[3 + 2 * i] or 0 for i, year in enumerate(years)},
            "fraction": {str(year): row[4 + 2 * i] or 0 for i, year in enumerate(years)},
        })
    data = {"years": years, "rows": rows, "source": WORKBOOK.name}
    OUTPUT.write_text("window.BURNS_M3=" + json.dumps(data, ensure_ascii=True, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(f"{len(rows)} AP exportadas: {OUTPUT}")


if __name__ == "__main__":
    main()
