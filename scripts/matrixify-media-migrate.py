#!/usr/bin/env python3
"""
Matrixify Media Migration
=========================

Transformiert einen Matrixify-Produkt-Export so, dass er für den Re-Import
bereit ist. Ziel:

1. Alle Bilder aus dem Metafeld ``custom.we_temp_product_media`` werden in die
   normale Produktgalerie überführt und ersetzen (REPLACE) die bestehenden
   Galerie-Bilder. Reihenfolge = Reihenfolge im Metafeld.
2. Jede Farb-Variante bekommt ein Variantenbild. Regel: das ERSTE Bild (in
   Metafeld-Reihenfolge) mit passendem Alt-Text (case-insensitive) wird für
   alle Varianten dieser Farbe gesetzt.

Datenquellen:
- Products-Export (mit Varianten, Metafeld, Image-Spalten)
- Files-Export (File Name, Link, Alt Text) — liefert URL + Alt-Text pro Datei.

Der Metafeld-Wert enthält nur Dateinamen; die zugehörige URL und der Alt-Text
kommen aus dem Files-Export.

Nutzung:
    python3 scripts/matrixify-media-migrate.py \
        --products Products_export.csv \
        --files Files_export.csv \
        --out Products_import_ready.csv \
        --report migration_report.csv

Es werden keine Änderungen am Store gemacht — nur eine neue CSV erzeugt, die
anschließend via Matrixify importiert wird.
"""

from __future__ import annotations

import argparse
import csv
import sys
from collections import OrderedDict, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

METAFIELD_COL = "Metafield: custom.we_temp_product_media [list.file_reference]"

# Option-Namen, die als "Farbe" gewertet werden (case-insensitive).
COLOR_OPTION_NAMES = {"farbe", "color", "colour", "couleur"}

# Spalten der erzeugten Import-Datei.
OUTPUT_COLUMNS = [
    "ID",
    "Handle",
    "Title",
    "Command",
    "Image Src",
    "Image Position",
    "Image Command",
    "Image Alt Text",
    "Variant ID",
    "Variant Command",
    "Option1 Name",
    "Option1 Value",
    "Option2 Name",
    "Option2 Value",
    "Option3 Name",
    "Option3 Value",
    "Variant Image",
]


@dataclass
class Variant:
    variant_id: str
    options: list[tuple[str, str]]  # [(name, value), ...]


@dataclass
class Product:
    product_id: str
    handle: str = ""
    title: str = ""
    metafield_files: list[str] = field(default_factory=list)
    variants: list[Variant] = field(default_factory=list)


@dataclass
class FileEntry:
    link: str
    alt: str


def load_files(files_path: Path) -> dict[str, FileEntry]:
    """Dateiname -> {link, alt} aus dem Matrixify Files-Export."""
    lookup: dict[str, FileEntry] = {}
    with files_path.open(newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        required = {"File Name", "Link", "Alt Text"}
        missing = required - set(reader.fieldnames or [])
        if missing:
            sys.exit(
                f"Files-Export fehlen Spalten: {', '.join(sorted(missing))}. "
                f"Gefunden: {reader.fieldnames}"
            )
        for row in reader:
            name = (row.get("File Name") or "").strip()
            if not name:
                continue
            # Erste Nennung gewinnt (falls Duplikate im Files-Export).
            lookup.setdefault(
                name,
                FileEntry(
                    link=(row.get("Link") or "").strip(),
                    alt=(row.get("Alt Text") or "").strip(),
                ),
            )
    return lookup


def load_products(products_path: Path) -> "OrderedDict[str, Product]":
    """Gruppiert die Produkt-Zeilen nach Produkt-ID (Reihenfolge bleibt erhalten)."""
    products: "OrderedDict[str, Product]" = OrderedDict()
    with products_path.open(newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        if METAFIELD_COL not in (reader.fieldnames or []):
            sys.exit(
                f"Products-Export fehlt die Spalte '{METAFIELD_COL}'.\n"
                f"Gefunden: {reader.fieldnames}"
            )
        for row in reader:
            pid = (row.get("ID") or "").strip()
            if not pid:
                continue
            product = products.get(pid)
            if product is None:
                product = Product(product_id=pid)
                products[pid] = product

            if not product.handle:
                product.handle = (row.get("Handle") or "").strip()
            if not product.title:
                product.title = (row.get("Title") or "").strip()

            mf_raw = (row.get(METAFIELD_COL) or "").strip()
            if mf_raw and not product.metafield_files:
                product.metafield_files = [
                    part.strip() for part in mf_raw.split(",") if part.strip()
                ]

            variant_id = (row.get("Variant ID") or "").strip()
            if variant_id:
                options: list[tuple[str, str]] = []
                for i in (1, 2, 3):
                    name = (row.get(f"Option{i} Name") or "").strip()
                    value = (row.get(f"Option{i} Value") or "").strip()
                    if name or value:
                        options.append((name, value))
                product.variants.append(Variant(variant_id=variant_id, options=options))
    return products


def find_color_index(variant: Variant) -> int | None:
    """Index der Farb-Option innerhalb der Options-Liste oder None."""
    for idx, (name, _value) in enumerate(variant.options):
        if name.strip().lower() in COLOR_OPTION_NAMES:
            return idx
    return None


def build_gallery(
    product: Product, files: dict[str, FileEntry], report_rows: list[dict]
) -> list[dict]:
    """Baut die neuen Galerie-Bild-Zeilen aus der Metafeld-Reihenfolge."""
    gallery: list[dict] = []
    position = 0
    for filename in product.metafield_files:
        entry = files.get(filename)
        if entry is None or not entry.link:
            report_rows.append(
                {
                    "handle": product.handle,
                    "type": "gallery",
                    "severity": "error",
                    "detail": f"Metafeld-Datei ohne URL im Files-Export: {filename}",
                }
            )
            continue
        position += 1
        gallery.append(
            {
                "src": entry.link,
                "alt": entry.alt,
                "position": position,
                "filename": filename,
            }
        )
    return gallery


def build_color_image_map(
    product: Product, files: dict[str, FileEntry]
) -> dict[str, str]:
    """Farbe (lowercase) -> URL des ersten passenden Metafeld-Bildes."""
    first_by_alt: dict[str, str] = {}
    for filename in product.metafield_files:
        entry = files.get(filename)
        if entry is None or not entry.link or not entry.alt:
            continue
        key = entry.alt.strip().lower()
        if key not in first_by_alt:
            first_by_alt[key] = entry.link
    return first_by_alt


def process_product(
    product: Product,
    files: dict[str, FileEntry],
    report_rows: list[dict],
) -> list[dict]:
    """Erzeugt die Output-Zeilen (Galerie + Varianten) für ein Produkt."""
    rows: list[dict] = []

    if not product.metafield_files:
        # Kein befülltes Metafeld -> Produkt unverändert lassen (nicht ausgeben).
        report_rows.append(
            {
                "handle": product.handle,
                "type": "skip",
                "severity": "info",
                "detail": "Kein Metafeld-Wert, Produkt übersprungen.",
            }
        )
        return rows

    gallery = build_gallery(product, files, report_rows)
    if not gallery:
        report_rows.append(
            {
                "handle": product.handle,
                "type": "gallery",
                "severity": "error",
                "detail": "Keine gültigen Galerie-Bilder aufgebaut; Produkt übersprungen.",
            }
        )
        return rows

    base = {col: "" for col in OUTPUT_COLUMNS}
    base["ID"] = product.product_id
    base["Handle"] = product.handle
    base["Title"] = product.title

    # --- Galerie-Zeilen ---
    for i, img in enumerate(gallery):
        row = dict(base)
        if i == 0:
            row["Command"] = "MERGE"           # Produkt-Ebene: nur aktualisieren
            row["Image Command"] = "REPLACE"    # Galerie komplett ersetzen
        else:
            row["Image Command"] = "MERGE"
        row["Image Src"] = img["src"]
        row["Image Position"] = str(img["position"])
        row["Image Alt Text"] = img["alt"]
        rows.append(row)

    # --- Varianten-Zeilen ---
    if not product.variants:
        return rows

    color_index = find_color_index(product.variants[0])
    if color_index is None:
        report_rows.append(
            {
                "handle": product.handle,
                "type": "variant",
                "severity": "info",
                "detail": "Keine Farb-Option gefunden; nur Galerie migriert.",
            }
        )
        return rows

    color_to_url = build_color_image_map(product, files)

    for variant in product.variants:
        if color_index >= len(variant.options):
            continue
        color_value = variant.options[color_index][1]
        color_key = color_value.strip().lower()
        url = color_to_url.get(color_key)

        row = dict(base)
        row["Variant ID"] = variant.variant_id
        row["Variant Command"] = "MERGE"
        for i, (name, value) in enumerate(variant.options[:3], start=1):
            row[f"Option{i} Name"] = name
            row[f"Option{i} Value"] = value

        if url:
            row["Variant Image"] = url
        else:
            report_rows.append(
                {
                    "handle": product.handle,
                    "type": "variant",
                    "severity": "warning",
                    "detail": (
                        f"Kein Bild für Farbe '{color_value}' "
                        f"(kein Metafeld-Bild mit passendem Alt-Text)."
                    ),
                }
            )
        rows.append(row)

    return rows


def write_output(out_path: Path, rows: list[dict]) -> None:
    with out_path.open("w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.DictWriter(fh, fieldnames=OUTPUT_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)


def write_report(report_path: Path, report_rows: list[dict]) -> None:
    with report_path.open("w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.DictWriter(
            fh, fieldnames=["handle", "type", "severity", "detail"]
        )
        writer.writeheader()
        writer.writerows(report_rows)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--products", required=True, type=Path, help="Matrixify Products-Export CSV")
    parser.add_argument("--files", required=True, type=Path, help="Matrixify Files-Export CSV")
    parser.add_argument("--out", required=True, type=Path, help="Ziel-CSV für den Import")
    parser.add_argument("--report", type=Path, default=None, help="Optionale Report-CSV")
    parser.add_argument(
        "--only-handle",
        default=None,
        help="Nur ein einzelnes Produkt-Handle verarbeiten (für Testläufe).",
    )
    args = parser.parse_args()

    for path in (args.products, args.files):
        if not path.exists():
            sys.exit(f"Datei nicht gefunden: {path}")

    files = load_files(args.files)
    products = load_products(args.products)

    report_rows: list[dict] = []
    out_rows: list[dict] = []

    stats = defaultdict(int)
    for product in products.values():
        if args.only_handle and product.handle != args.only_handle:
            continue
        stats["products_seen"] += 1
        product_rows = process_product(product, files, report_rows)
        if product_rows:
            stats["products_written"] += 1
            stats["image_rows"] += sum(1 for r in product_rows if r["Image Src"])
            stats["variant_rows"] += sum(1 for r in product_rows if r["Variant ID"])
            stats["variant_with_image"] += sum(
                1 for r in product_rows if r["Variant ID"] and r["Variant Image"]
            )
        out_rows.extend(product_rows)

    write_output(args.out, out_rows)
    if args.report is not None:
        write_report(args.report, report_rows)

    warnings = sum(1 for r in report_rows if r["severity"] == "warning")
    errors = sum(1 for r in report_rows if r["severity"] == "error")

    print("=== Matrixify Media Migration ===")
    print(f"Files im Lookup:            {len(files)}")
    print(f"Produkte gesehen:           {stats['products_seen']}")
    print(f"Produkte in Output:         {stats['products_written']}")
    print(f"Galerie-Bildzeilen:         {stats['image_rows']}")
    print(f"Varianten-Zeilen:           {stats['variant_rows']}")
    print(f"  davon mit Variantenbild:  {stats['variant_with_image']}")
    print(f"Warnungen:                  {warnings}")
    print(f"Fehler:                     {errors}")
    print(f"Output:                     {args.out}")
    if args.report is not None:
        print(f"Report:                     {args.report}")
    if warnings or errors:
        print("\nHinweis: Report prüfen (fehlende Alt-Texte / nicht gematchte Farben).")


if __name__ == "__main__":
    main()
