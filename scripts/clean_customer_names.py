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

PREFIX_PATTERN = re.compile(
    r'^(?:'
    r'mr|mrs|ms|miss|mis|mz|mister|master|mast|madam|mdm|sir|mx|'
    r'dr|doctor|doc|prof|professor|er|engr|engineer|ca|cma|arch|architect|'
    r'adv|advocate|judge|justice|hon|honorable|'
    r'shri|shree|sri|sree|smt|shrimati|srimati|kumari|km|pt|pandit|pundit|babu|'
    r'swami|sant|sadhu|guru|guruji|acharya|'
    r'maulana|mufti|qazi|syed|sayed|sheikh|shaikh|haji|alhaj|'
    r'sardar|sardarji|giani|gyani|'
    r'late|swargiya|swg|'
    r'capt|captain|col|colonel|maj|major|gen|general|lt|lieutenant|brig|brigadier|subedar|havaldar|inspector|'
    r'श्री|श्रीमान|श्रीमती|सुश्री|कुमारी|कु|डॉ|डॉक्टर|प्रो|प्रोफेसर|पं|पंडित|स्वामी|संत|आचार्य|स्वर्गीय|स्व|बाबू|मौलाना|मुफ्ती|हाजी|सरदार'
    r')[\.\-_/:\s]+',
    flags=re.IGNORECASE
)

def clean_indian_name(raw_name: str | None, first_name_only: bool = True) -> str:
    """
    Cleans Indian names by thoroughly removing all prefixes/honorifics (Dr, Mr, Mrs, Shri, etc.),
    Voice AI artifacts, filler noise, and extracts the first name (e.g., 'Dr. Raina Dwivedi' -> 'Raina').
    """
    if not raw_name or not isinstance(raw_name, str):
        return ""

    cleaned = raw_name.strip()
    if not cleaned:
        return ""

    # 1. Remove speech-to-text filler phrases
    cleaned = re.sub(r'\b(called|my name is|name is|this is|i am|i\'m|speaking with|call from|here is|uh|um|ah|er)\b', '', cleaned, flags=re.IGNORECASE)

    # 2. Iteratively strip all known honorifics and prefixes (handles chained ones like "Late Shri Dr. Ramesh")
    while True:
        prev = cleaned
        cleaned = PREFIX_PATTERN.sub('', cleaned).strip()
        if cleaned == prev:
            break

    # 3. Fix floating single letters at the very start (e.g., "t Raina" -> "Raina")
    # This ignores legitimate initials that are followed by a dot (e.g., "K. Raina")
    cleaned = re.sub(r'^[a-zA-Z]\s+([a-zA-Z])', r'\1', cleaned.strip())

    # 4. Strip trailing annotations in parentheses or hyphens, e.g. "Raina Dwivedi (Shop)"
    cleaned = re.sub(r'\s*[\(\[\{][^\)\]\}]*[\)\]\}]\s*$', '', cleaned)
    cleaned = re.sub(r'\s*[\-\|\/].*$', '', cleaned)

    # 5. Strip trailing floating initials (e.g., "TEJESH C S" -> "Tejesh")
    words = [w for w in cleaned.split() if w]
    has_main_name = any(len(re.sub(r'[^a-zA-Z]', '', w)) >= 3 for w in words)
    if has_main_name and len(words) > 1:
        while len(words) > 1 and len(words[-1]) == 1 and words[-1].isalpha():
            words.pop()
        cleaned = " ".join(words)

    # 6. Clean up extra spaces
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()

    # 7. Standardize Title Case (e.g., "raina dwivedi" -> "Raina Dwivedi", "k. rahul" -> "K. Rahul")
    def format_word(w):
        if re.match(r'^[a-zA-Z]\.$', w):
            return w.upper()
        return w.capitalize()

    formatted_words = [format_word(w) for w in cleaned.split() if w]

    if not formatted_words:
        return ""

    # Discard single letters / initials-only names (e.g. "R T", "R", "A B C")
    has_real_word = any(len(re.sub(r'[^a-zA-Z\u0900-\u097F]', '', w)) >= 2 for w in formatted_words)
    if not has_real_word:
        return ""

    if first_name_only:
        # If the first word is a single initial (like "K." or "K") and there is a subsequent full word,
        # pick the first full name (e.g., "K. Suresh" -> "Suresh")
        for word in formatted_words:
            clean_word = re.sub(r'[^a-zA-Z\u0900-\u097F]', '', word)
            if len(clean_word) >= 2:
                return word
        return ""

    full = " ".join(formatted_words)
    if len(re.sub(r'[^a-zA-Z\u0900-\u097F]', '', full)) < 2:
        return ""
    return full

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

def process_csv(input_path: str, output_path: str, column_name: str | None = None, first_name_only: bool = True):
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
    print(f"Extraction mode: {'First Name Only (e.g. Raina Dwivedi -> Raina)' if first_name_only else 'Full Name'}")

    cleaned_count = 0
    sample_cleanups = []
    blank_cleaned = []

    for idx, row in enumerate(rows, start=2):
        orig = row.get(target_col) or ""
        cleaned = clean_indian_name(orig, first_name_only=first_name_only)
        if cleaned != orig:
            cleaned_count += 1
            if len(sample_cleanups) < 6 and orig:
                sample_cleanups.append((orig, cleaned or "(empty)"))
        if not cleaned:
            blank_cleaned.append((idx, orig))
        row[target_col] = cleaned

    if sample_cleanups:
        print("\nSample Cleanups:")
        for orig, clean in sample_cleanups:
            print(f"  • {orig} ➔ {clean}")
        print()

    if blank_cleaned:
        print(f"\n DispositionERROR: {len(blank_cleaned)} customer name(s) are blank after cleaning for Voice AI!", file=sys.stderr)
        print(" (Please manually update in sheet)\n", file=sys.stderr)
        for row_num, orig_val in blank_cleaned[:5]:
            display_orig = orig_val if orig_val.strip() else "(empty in CSV)"
            print(f"   • Row {row_num}: '{display_orig}' ➔ (blank)", file=sys.stderr)
        if len(blank_cleaned) > 5:
            print(f"   ... and {len(blank_cleaned) - 5} more blank row(s)", file=sys.stderr)
        print(file=sys.stderr)

    with open(output_path, mode="w", encoding="utf-8-sig", newline="") as outfile:
        writer = csv.DictWriter(outfile, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Successfully wrote {len(rows)} rows ({cleaned_count} names cleaned) to '{output_path}'.")

def main():
    parser = argparse.ArgumentParser(description="Clean customer names in CSV for Voice AI (extracts first name by default).")
    parser.add_argument("input_csv", nargs="?", help="Path to input CSV file")
    parser.add_argument("output_csv", nargs="?", help="Path to output CSV file (defaults to input_cleaned.csv)")
    parser.add_argument("-c", "--column", help="Name of the customer name column to clean")
    parser.add_argument("--full-name", action="store_true", help="Keep full cleaned name instead of extracting just the first name")

    args = parser.parse_args()
    first_name_only = not args.full_name

    if not args.input_csv:
        # Run test cases
        test_names = [
            "Raina Dwivedi",     # First name extraction
            "t Raina Dwivedi",   # Voice AI glitch
            "uh Amit Sharma",    # Filler word
            "k. rahul singh",    # Legitimate initial -> Rahul
            " name is Priya",    # Sentence fragment
            "TEJESH C S",        # Trailing initials
            "DR. PRIYA SHARMA",  # Salutation
            "Suresh Kumar",      # Standard Indian full name
        ]
        print("Running test cases (First Name Mode):\n")
        for name in test_names:
            print(f"Original: {name:25} -> First Name: {clean_indian_name(name, first_name_only=True)}")
        return

    out_file = args.output_csv
    if not out_file:
        base, ext = os.path.splitext(args.input_csv)
        out_file = f"{base}_cleaned{ext}"

    process_csv(args.input_csv, out_file, args.column, first_name_only=first_name_only)

if __name__ == "__main__":
    main()
