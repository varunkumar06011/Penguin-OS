#!/usr/bin/env python3
"""
backfill_cell_metadata.py — One-time script to patch existing cell_data rows
with venture_id, block, and floor fields derived from the cell ID string.

Usage:
    python backfill_cell_metadata.py --dry-run          # Log only, no writes
    python backfill_cell_metadata.py --snapshot         # Dump cell_data to file
    python backfill_cell_metadata.py                    # Real run (writes to Supabase)

Recommended sequence:
    1. python backfill_cell_metadata.py --snapshot
    2. python backfill_cell_metadata.py --dry-run
    3. (review log output)
    4. python backfill_cell_metadata.py
"""

import os
import re
import json
import argparse
from datetime import datetime
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SUPABASE_SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_KEY', '')
SUPABASE_ANON_KEY = os.environ.get('SUPABASE_ANON_KEY', '')

_supabase_key = SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY

if not SUPABASE_URL or not _supabase_key:
    print('ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY (or SUPABASE_ANON_KEY) must be set in .env')
    exit(1)

sb = create_client(SUPABASE_URL, _supabase_key)


def parse_cell_id(cell_id, venture_id):
    """Parse a cell ID to extract block, floor, flat, work_item.
    Ported from app.py _parse_cell_id() to match exactly.

    Supports three formats:
    1. Flat view: {venture}_{block}_floor{N}_{flatNum}_{itemId}
    2. Work view: {venture}_{block}_floor{N}_{categorySlug}_{itemId}_{flatNum}
    3. Super structure: {venture}_superstructure_{block}_{itemId}

    Returns dict with block, floor, flat, item_id or None if parsing fails.
    """
    prefix = venture_id + '_'
    if not cell_id.startswith(prefix):
        return None
    rest = cell_id[len(prefix):]

    # Format 3: superstructure_{block}_{itemId}
    if rest.startswith('superstructure_'):
        ss_rest = rest[len('superstructure_'):]
        m = re.match(r'^([^_]+)_(.+)$', ss_rest)
        if m:
            return {
                'block': m.group(1),
                'floor': None,
                'flat': None,
                'item_id': m.group(2)
            }
        return None

    # Format 1: {block}_floor{N}_{flatNum}_{itemId}
    m = re.match(r'^(.+)_floor(\d+)_(\d{3}|P-\d{3})_(.+)$', rest)
    if m:
        flat_str = m.group(3)
        flat_val = int(flat_str) if flat_str.isdigit() else flat_str
        return {
            'block': m.group(1),
            'floor': int(m.group(2)),
            'flat': flat_val,
            'item_id': m.group(4)
        }

    # Format 2: {block}_floor{N}_{categorySlug}_{itemId}_{flatNum}
    m = re.match(r'^(.+)_floor(\d+)_(.+?)_(item_.+)_(\d{3}|P-\d{3})$', rest)
    if m:
        flat_str = m.group(5)
        flat_val = int(flat_str) if flat_str.isdigit() else flat_str
        return {
            'block': m.group(1),
            'floor': int(m.group(2)),
            'flat': flat_val,
            'item_id': m.group(4),
            'category_slug': m.group(3)
        }

    # Format 2 variant: non-item_ prefixed IDs (e.g., corridor_0, elevation_0)
    m = re.match(r'^(.+)_floor(\d+)_(.+?)_([^_]+_\d+)_(\d{3}|P-\d{3})$', rest)
    if m:
        flat_str = m.group(5)
        flat_val = int(flat_str) if flat_str.isdigit() else flat_str
        return {
            'block': m.group(1),
            'floor': int(m.group(2)),
            'flat': flat_val,
            'item_id': m.group(4),
            'category_slug': m.group(3)
        }

    return None


def discover_venture_ids(rows):
    """Extract unique venture IDs from cell_data row IDs by finding common prefixes.
    A venture ID is the prefix before the first _block_ or _superstructure_ or _floor pattern.
    """
    venture_ids = set()
    for row in rows:
        cell_id = row.get('id', '')
        if not cell_id:
            continue
        # Try to extract venture_id by looking for known patterns
        # Pattern: ventureId_blockId_floorN_...
        m = re.match(r'^(.+?)_[A-Za-z]_floor\d+', cell_id)
        if m:
            venture_ids.add(m.group(1))
            continue
        # Pattern: ventureId_superstructure_...
        m = re.match(r'^(.+?)_superstructure_', cell_id)
        if m:
            venture_ids.add(m.group(1))
            continue
        # Fallback: also check data JSON for venture_id
        data = row.get('data') or {}
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except Exception:
                data = {}
        vid = data.get('venture_id')
        if vid:
            venture_ids.add(vid)
    return venture_ids


def snapshot_cell_data(rows, label='pre_backfill'):
    """Dump entire cell_data table to a timestamped JSON file."""
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    filename = f'cell_data_snapshot_{label}_{ts}.json'
    filepath = os.path.join(os.path.dirname(os.path.abspath(__file__)), filename)
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)
    print(f'Snapshot saved: {filepath} ({len(rows)} rows)')
    return filepath


def main():
    parser = argparse.ArgumentParser(description='Backfill venture_id/block/floor into cell_data JSON')
    parser.add_argument('--dry-run', action='store_true', help='Log proposed patches without writing')
    parser.add_argument('--snapshot', action='store_true', help='Dump cell_data to JSON file and exit')
    parser.add_argument('--venture', type=str, default=None, help='Only process rows for this venture ID')
    args = parser.parse_args()

    print(f'{"[DRY RUN] " if args.dry_run else ""}Fetching all cell_data rows from Supabase...')
    res = sb.table('cell_data').select('*').execute()
    rows = res.data or []
    print(f'Fetched {len(rows)} rows.')

    if args.snapshot:
        snapshot_cell_data(rows, label='manual')
        return

    # Discover venture IDs
    venture_ids = discover_venture_ids(rows)
    print(f'Discovered venture IDs: {sorted(venture_ids)}')

    if args.venture:
        venture_ids = {args.venture}
        print(f'Filtered to venture: {args.venture}')

    stats = {'patched': 0, 'already_had_fields': 0, 'unparseable': 0, 'no_venture_match': 0}
    patches = []

    for row in rows:
        cell_id = row.get('id', '')
        if not cell_id:
            stats['unparseable'] += 1
            continue

        data = row.get('data') or {}
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except Exception:
                data = {}

        # Check if already has venture_id
        if data.get('venture_id'):
            stats['already_had_fields'] += 1
            continue

        # Try each venture ID to find a match
        parsed = None
        matched_venture = None
        for vid in venture_ids:
            parsed = parse_cell_id(cell_id, vid)
            if parsed:
                matched_venture = vid
                break

        if not parsed:
            stats['unparseable'] += 1
            if args.dry_run:
                print(f'  [SKIP] Cannot parse: {cell_id}')
            continue

        # Build the patch
        patch = {}
        patch['venture_id'] = matched_venture
        if parsed.get('block'):
            patch['block'] = parsed['block']
        if parsed.get('floor') is not None:
            patch['floor'] = str(parsed['floor'])

        merged_data = {**data, **patch}
        patches.append({
            'id': cell_id,
            'old_data': data,
            'new_data': merged_data,
            'parsed': parsed,
            'venture_id': matched_venture,
        })
        stats['patched'] += 1

        if args.dry_run:
            print(f'  [PATCH] {cell_id}')
            print(f'          venture_id={matched_venture}, block={patch.get("block")}, floor={patch.get("floor")}')

    print(f'\n--- Summary ---')
    print(f'  Total rows:     {len(rows)}')
    print(f'  To patch:       {stats["patched"]}')
    print(f'  Already OK:     {stats["already_had_fields"]}')
    print(f'  Unparseable:    {stats["unparseable"]}')

    if args.dry_run:
        print(f'\n[DRY RUN] No writes performed. Review the log above, then run without --dry-run.')
        return

    if not patches:
        print('No patches needed. Exiting.')
        return

    # Take snapshot before writing
    print('\nTaking pre-write snapshot...')
    snapshot_cell_data(rows, label='pre_backfill')

    # Apply patches
    print(f'\nApplying {len(patches)} patches to Supabase...')
    success = 0
    errors = 0
    for p in patches:
        try:
            sb.table('cell_data').update({'data': p['new_data']}).eq('id', p['id']).execute()
            success += 1
        except Exception as e:
            print(f'  [ERROR] Failed to patch {p["id"]}: {e}')
            errors += 1

    print(f'\nDone. Patched: {success}, Errors: {errors}')


if __name__ == '__main__':
    main()
