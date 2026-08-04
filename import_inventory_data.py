#!/usr/bin/env python3
"""
One-time import script for historical inventory data.
Reads a JSON file with the structure:
{
  "Category Name": {
    "Material Name": [
      { "date": "15/10/25", "opening": 434, "purchase": null, "total": 434, "usage": 37, "balance": 397 },
      ...
    ],
    ...
  },
  ...
}

For each (category, material) pair:
  - Inserts one row into `materials` (venture_id = 'WAREHOUSE')
  - For each ledger row with purchase > 0: inserts an IN entry into stock_ledger
  - For each ledger row with usage > 0: inserts an OUT entry into stock_ledger
  - Skips rows where both purchase and usage are null/0
  - Skips header rows (date = "DATE") and invalid rows (date = ".")

Usage:
  python import_inventory_data.py path/to/inventory_data.json

Run with --dry-run first to preview without inserting:
  python import_inventory_data.py path/to/inventory_data.json --dry-run

Clean up previous import and re-run:
  python import_inventory_data.py path/to/inventory_data.json --clean
"""

import json
import os
import re
import sys
import uuid
from datetime import datetime
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SUPABASE_SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_KEY', '')
SUPABASE_ANON_KEY = os.environ.get('SUPABASE_ANON_KEY', '')

if not SUPABASE_URL or not (SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY):
    print('ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY (or SUPABASE_ANON_KEY) must be set in .env')
    sys.exit(1)

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY)

VENTURE_ID = 'WAREHOUSE'
CREATED_BY = 'inventory_import'

# Default units per category
CATEGORY_UNITS = {
    'Cement & Adhesive': 'bags',
    'Ceiling Material': 'sheets',
    'SWR (PVC)': 'pcs',
    'CPVC': 'pcs',
    'Electrical Material': 'pcs',
    'Wire': 'rolls',
}

# Per-material unit overrides (takes precedence over category default)
MATERIAL_UNITS = {
    'POP BAGS': 'bags',
    'POP SHEETS': 'sheets',
    'BOTTOM': 'pcs',
    'PARAMETER': 'pcs',
    'PATTI': 'pcs',
    'L CHANNELS': 'pcs',
}


def parse_date(raw):
    """Parse a date string from the spreadsheet into YYYY-MM-DD format.

    Handles multiple formats:
    - "DD/MM/YY" or "DD/MM/YYYY" → DD/MM/YYYY
    - "YYYY-XX-XX" → interpreted as YYYY-DD-MM (confirmed from data sequence)
    - Dates with extra text like "16/9/25 <201>" or "25/9/25(305)" → extract date part
    - Returns None for invalid/header rows
    """
    if not raw or not isinstance(raw, str):
        return None

    s = raw.strip()

    # Skip header rows and invalid entries
    if s in ('DATE', '.', '', 'OPENING') or s.upper() in ('DATE', 'OPENING'):
        return None

    # Extract date part before any parenthetical or angle-bracket text
    s = re.split(r'[\(<\[]', s)[0].strip()

    # Try DD/MM/YY or DD/MM/YYYY format
    m = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{2,4})$', s)
    if m:
        dd, mm, yy = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if yy < 100:
            yy += 2000
        try:
            return f'{yy:04d}-{mm:02d}-{dd:02d}'
        except (ValueError, IndexError):
            return None

    # Try YYYY-XX-XX format (interpreted as YYYY-DD-MM based on data analysis)
    m = re.match(r'^(\d{4})-(\d{1,2})-(\d{1,2})$', s)
    if m:
        yyyy, dd, mm = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            # Validate by constructing a date
            datetime(yyyy, mm, dd)
            return f'{yyyy:04d}-{mm:02d}-{dd:02d}'
        except ValueError:
            # Try the other interpretation (YYYY-MM-DD)
            try:
                datetime(yyyy, dd, mm)
                return f'{yyyy:04d}-{dd:02d}-{mm:02d}'
            except ValueError:
                print(f'  WARNING: Could not parse date "{raw}"')
                return None

    print(f'  WARNING: Unrecognized date format "{raw}"')
    return None


def to_number(val):
    """Convert a value to a number, returning None for null/empty/non-numeric."""
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val)
    s = str(val).strip()
    if not s or s.upper() in ('NULL', 'NAN', ''):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def slugify(text):
    """Create a deterministic ID from text."""
    return re.sub(r'[^a-z0-9]+', '_', text.lower()).strip('_')[:60]


def main():
    if len(sys.argv) < 2:
        print('Usage: python import_inventory_data.py <json_file_path> [--dry-run]')
        sys.exit(1)

    json_path = sys.argv[1]
    dry_run = '--dry-run' in sys.argv
    clean = '--clean' in sys.argv

    if not os.path.exists(json_path):
        print(f'ERROR: File not found: {json_path}')
        sys.exit(1)

    if clean and not dry_run:
        print('=== CLEANUP: Deleting previous import data ===')
        # Delete ledger entries from previous import
        deleted = supabase.table('stock_ledger').delete().eq('created_by', CREATED_BY).execute()
        print(f'  Deleted {len(deleted.data) if deleted.data else 0} stock_ledger rows')
        # Delete imported materials
        deleted_m = supabase.table('materials').delete().like('id', 'imp_%').execute()
        print(f'  Deleted {len(deleted_m.data) if deleted_m.data else 0} materials rows')
        print('  Cleanup complete.\n')

    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    print(f'Loaded {len(data)} categories from {json_path}')
    if dry_run:
        print('=== DRY RUN — no data will be inserted ===\n')
    else:
        print('=== LIVE RUN — data will be inserted into Supabase ===\n')

    # Phase 1: Create materials
    material_map = {}  # (category, material_name) -> material_id
    stats = {
        'materials_created': 0,
        'materials_skipped': 0,
        'in_entries': 0,
        'out_entries': 0,
        'rows_skipped': 0,
        'dates_failed': 0,
    }

    for category, materials in data.items():
        cat_unit = CATEGORY_UNITS.get(category, 'pcs')
        print(f'\n--- Category: {category} (default unit: {cat_unit}) ---')

        for material_name, ledger_rows in materials.items():
            unit = MATERIAL_UNITS.get(material_name, cat_unit)
            material_id = f'imp_{slugify(category)}_{slugify(material_name)}'

            # Check if material already exists
            existing = supabase.table('materials').select('id').eq('id', material_id).execute()
            if existing.data:
                material_map[(category, material_name)] = material_id
                stats['materials_skipped'] += 1
                print(f'  [SKIP] Material already exists: {material_name} (id: {material_id})')
            else:
                material_row = {
                    'id': material_id,
                    'venture_id': VENTURE_ID,
                    'name': material_name,
                    'category': category,
                    'unit': unit,
                    'min_threshold': 0,
                }
                if not dry_run:
                    supabase.table('materials').insert(material_row).execute()
                material_map[(category, material_name)] = material_id
                stats['materials_created'] += 1
                print(f'  [INSERT] Material: {material_name} (id: {material_id})')

            # Phase 2: Insert ledger entries
            for row in ledger_rows:
                parsed_date = parse_date(row.get('date'))
                if not parsed_date:
                    stats['dates_failed'] += 1
                    continue

                purchase = to_number(row.get('purchase'))
                usage = to_number(row.get('usage'))

                has_purchase = purchase is not None and purchase > 0
                has_usage = usage is not None and usage > 0

                if not has_purchase and not has_usage:
                    stats['rows_skipped'] += 1
                    continue

                # Insert IN entry (purchase)
                if has_purchase:
                    entry_id = str(uuid.uuid4())
                    in_row = {
                        'id': entry_id,
                        'venture_id': VENTURE_ID,
                        'material_id': material_id,
                        'entry_type': 'IN',
                        'qty': purchase,
                        'entry_date': parsed_date,
                        'cost_per_unit': 0,
                        'remarks': 'Historical import',
                        'created_by': CREATED_BY,
                    }
                    if not dry_run:
                        supabase.table('stock_ledger').insert(in_row).execute()
                    stats['in_entries'] += 1

                # Insert OUT entry (usage)
                if has_usage:
                    entry_id = str(uuid.uuid4())
                    out_row = {
                        'id': entry_id,
                        'venture_id': VENTURE_ID,
                        'material_id': material_id,
                        'entry_type': 'OUT',
                        'qty': usage,
                        'entry_date': parsed_date,
                        'cost_per_unit': 0,
                        'remarks': 'Historical import',
                        'created_by': CREATED_BY,
                    }
                    if not dry_run:
                        supabase.table('stock_ledger').insert(out_row).execute()
                    stats['out_entries'] += 1

    # Summary
    print(f'\n{"=" * 60}')
    print(f'IMPORT SUMMARY {"(DRY RUN)" if dry_run else ""}')
    print(f'{"=" * 60}')
    print(f'  Materials created:  {stats["materials_created"]}')
    print(f'  Materials skipped:  {stats["materials_skipped"]}')
    print(f'  IN entries:         {stats["in_entries"]}')
    print(f'  OUT entries:        {stats["out_entries"]}')
    print(f'  Rows skipped:       {stats["rows_skipped"]} (no purchase/usage)')
    print(f'  Dates failed:       {stats["dates_failed"]} (unparseable dates)')

    if not dry_run:
        print(f'\n✓ Import complete. Verify stock_balance matches the sheet\'s last balance per material.')
        print(f'  Run: SELECT material_id, balance FROM stock_balance WHERE venture_id = \'WAREHOUSE\' ORDER BY material_id;')
    else:
        print(f'\n→ To run the actual import, remove --dry-run flag.')


if __name__ == '__main__':
    main()
