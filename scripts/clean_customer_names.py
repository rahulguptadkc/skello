#!/usr/bin/env python3
"""
Clean and normalize Indian customer names for Voice AI / TTS.
Strips out Voice AI artifacts, random single-letter prefixes, and trailing noise,
while preserving legitimate Indian initials (like K. Raina or V. Dwivedi).

Usage:
    python3 scripts/clean_customer_names.py <input.csv> [output.csv]
    python3 scripts/clean_customer_names.py input.csv --column customer_name
"""

import sys
import os
import re
import csv
import argparse

NAME_HEADER_CANDIDATES = [
    "customer_name",
    "customer name",
    "name",
    "full_name",
    "fullname",
    "contact_name",
    "cust_name",
    "client_name",
    "client name",
    "lead_name",
    "lead name",
]

def clean_indian_name(raw_name: str | None) -> str:
    """
    Cleans Indian names from Voice AI artifacts, random single-letter prefixes,
    and filler noise, while preserving standard Indian initials (like K. Raina).
    """
    if not raw_name or not isinstance(raw_name, str):
        return ""

    cleaned = raw_name.strip()
    if not cleaned:
        return ""

    # 1. Remove common voice AI filler words or text artifacts
    # (e.g., "called", "name is", "uh", "um", "mis", "miss")
    cleaned = re.sub(r'\b(called|my name is|name is|this is|i am|uh|um|mis|miss)\b', '', cleaned, flags=re.IGNORECASE)

    # 2. Fix floating single letters at the very start (e.g., "t Raina" -> "Raina")
    # This ignores legitimate initials that are followed by a dot (e.g., "K. Raina")
    cleaned = re.sub(r'^[a-zA-Z]\s+([a-zA-Z])', r'\1', cleaned.strip())

    # 3. Strip trailing floating initials (e.g., "TEJESH C S" -> "Tejesh")
    words = [w for w in cleaned.split() if w]
    has_main_name = any(len(re.sub(r'[^a-zA-Z]', '', w)) >= 3 for w in words)
    if has_main_name and len(words) > 1:
        while len(words) > 1 and len(words[-1]) == 1 and words[-1].isalpha():
            words.pop()
        cleaned = " ".join(words)

    # 4. Clean up extra spaces
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()

    # 5. Standardize Title Case (e.g., "raina dwivedi" -> "Raina Dwivedi", "k. rahul" -> "K. Rahul")
    # Preserve dotted initials in uppercase
    def format_word(w):
        if re.match(r'^[a-zA-Z]\.$', w):
            return w.upper()
        return w.capitalize()

    words = [format_word(w) for w in cleaned.split()]
    return " ".join(words)

def detect_name_column(fieldnames: list[str]) -> str | None:
    lower_fields = [f.lower().strip() for f in fieldnames]
    for candidate in NAME_HEADER_CANDIDATES:
        if candidate in lower_fields:
            return fieldnames[lower_fields.index(candidate)]
    for idx, f in enumerate(lower_fields):
        for candidate in NAME_HEADER_CANDIDATES:
            if candidate in f:
                return fieldnames[idx]
    return None

def process_csv(input_path: str, output_path: str, column_name: str | None = None):
    if not os.path.exists(input_path):
        print(f"Error: Input file '{input_path}' not found.", file=sys.stderr)
        sys.exit(1)

    with open(input_path, mode="r", encoding="utf-8-sig", newline="") as infile:
        reader = csv.DictReader(infile)
        if not reader.fieldnames:
            print("Error: CSV file is empty or has no header.", file=sys.stderr)
            sys.exit(1)

        fieldnames = list(reader.fieldnames)
        target_col = column_name or detect_name_column(fieldnames)

        if not target_col or target_col not in fieldnames:
            print(f"Error: Could not identify customer name column among {fieldnames}.", file=sys.stderr)
            print("Specify the column with --column <name>", file=sys.stderr)
            sys.exit(1)

        rows = list(reader)

    print(f"Loaded {len(rows)} rows from '{input_path}'.")
    print(f"Target name column: '{target_col}'")

    cleaned_count = 0
    sample_cleanups = []

    for row in rows:
        orig = row.get(target_col) or ""
        cleaned = clean_indian_name(orig)
        if cleaned != orig:
            cleaned_count += 1
            if len(sample_cleanups) < 6 and orig:
                sample_cleanups.append((orig, cleaned or "(empty)"))
        row[target_col] = cleaned

    if sample_cleanups:
        print("\nSample Cleanups:")
        for orig, clean in sample_cleanups:
            print(f"  • {orig} ➔ {clean}")
        print()

    with open(output_path, mode="w", encoding="utf-8-sig", newline="") as outfile:
        writer = csv.DictWriter(outfile, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Successfully wrote {len(rows)} rows ({cleaned_count} names cleaned) to '{output_path}'.")

def main():
    parser = argparse.ArgumentParser(description="Clean and normalize customer names in CSV for Voice AI.")
    parser.add_argument("input_csv", nargs="?", help="Path to input CSV file")
    parser.add_argument("output_csv", nargs="?", help="Path to output CSV file (defaults to input_cleaned.csv)")
    parser.add_argument("-c", "--column", help="Name of the customer name column to clean")

    args = parser.parse_args()

    if not args.input_csv:
        # Run test cases
        test_names = [
            "t Raina Dwivedi",   # Voice AI glitch
            "uh Amit Sharma",    # Filler word
            "k. rahul singh",    # Legitimate initial (preserved)
            " name is Priya",    # Sentence fragment
            "TEJESH C S",        # Trailing initials
        ]
        print("Running test cases:\n")
        for name in test_names:
            print(f"Original: {name:20} -> Cleaned: {clean_indian_name(name)}")
        return

    out_file = args.output_csv
    if not out_file:
        base, ext = os.path.splitext(args.input_csv)
        out_file = f"{base}_cleaned{ext}"

    process_csv(args.input_csv, out_file, args.column)

if __name__ == "__main__":
    main()
