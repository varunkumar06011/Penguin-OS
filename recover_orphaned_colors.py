#!/usr/bin/env python3
"""
recover_orphaned_colors.py — One-time script to recover orphaned cell_data rows
whose item IDs no longer match current venture work item IDs due to the Settings
modal bug that saved items as plain strings.

The bug caused ensureItemIds() to generate new IDs (index-based) different from
the original IDs used when cell data was saved. Since the backend uses
upsert(..., on_conflict='id'), old rows were never deleted — they're orphaned
but intact with their original color/timeline/remarks data.

This script:
1. Fetches all cell_data rows and all ventures.
2. For each venture, builds a mapping of old item ID → current item ID via
   slug-matching on item labels.
3. For each orphaned cell (whose item_id doesn't match any current item),
   constructs a new cell ID using the current item ID.
4. If a row with the new ID already exists, merges timeline arrays and keeps
   the most recent color/remarks.
5. Otherwise, upserts the row with the new ID and original data.

Usage:
    python recover_orphaned_colors.py --dry-run          # Log only, no writes
    python recover_orphaned_colors.py --snapshot         # Dump cell_data to file
    python recover_orphaned_colors.py                    # Real run (writes to Supabase)
    python recover_orphaned_colors.py --venture tripura  # Only process one venture

Recommended sequence:
    1. python recover_orphaned_colors.py --snapshot
    2. python recover_orphaned_colors.py --dry-run
    3. (review log output, especially AMBIGUOUS entries)
    4. python recover_orphaned_colors.py
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


def slug_id(text):
    """Port of JS slugId() from app.js:647-648.
    Lowercase, replace non-alphanumeric with _, truncate to 30 chars.
    """
    return re.sub(r'[^a-z0-9]', '_', text.lower())[:30]


def parse_cell_id(cell_id, venture_id):
    """Parse a cell ID to extract block, floor, flat, work_item.
    Ported from app.py _parse_cell_id() to match exactly.
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


def extract_label_from_item_id(item_id):
    """Try to extract a human-readable label from an old item ID.
    Item IDs look like: item_civil_work_brick_work_1234567890 or item_brick_work_0
    The slug portion is between 'item_' and the last '_<digits>'.
    """
    rest = item_id
    if rest.startswith('item_'):
        rest = rest[5:]
    # Remove trailing _<digits> (timestamp or index)
    m = re.match(r'^(.+?)_(\d+)$', rest)
    if m:
        rest = m.group(1)
    # Convert slug back to approximate label: replace _ with space, title case
    label = rest.replace('_', ' ').strip()
    return label


def get_all_current_items(venture_data):
    """Extract all current work items from venture data.
    Returns list of {id, label, category} dicts.
    """
    items = []

    # From flat_view_items
    fvi = venture_data.get('flat_view_items', [])
    if isinstance(fvi, list):
        for item in fvi:
            if isinstance(item, dict) and item.get('id') and item.get('label'):
                items.append({'id': item['id'], 'label': item['label'], 'category': None})
            elif isinstance(item, str):
                items.append({'id': None, 'label': item, 'category': None})

    # From work_categories
    wc = venture_data.get('work_categories', {})
    if isinstance(wc, dict):
        for cat_name, cat_items in wc.items():
            if isinstance(cat_items, list):
                for item in cat_items:
                    if isinstance(item, dict) and item.get('id') and item.get('label'):
                        items.append({'id': item['id'], 'label': item['label'], 'category': cat_name})
                    elif isinstance(item, str):
                        items.append({'id': None, 'label': item, 'category': cat_name})

    # From super_structure_items
    ssi = venture_data.get('super_structure_items', [])
    if isinstance(ssi, list):
        for item in ssi:
            if isinstance(item, dict) and item.get('id') and item.get('label'):
                items.append({'id': item['id'], 'label': item['label'], 'category': '__super__'})
            elif isinstance(item, str):
                items.append({'id': None, 'label': item, 'category': '__super__'})

    return items


def build_slug_to_items_map(current_items):
    """Build a map: slug(label) → list of items with that slug.
    If a slug maps to more than one item, it's a collision.
    """
    slug_map = {}
    for item in current_items:
        if not item.get('label'):
            continue
        slug = slug_id(item['label'])
        if slug not in slug_map:
            slug_map[slug] = []
        slug_map[slug].append(item)
    return slug_map


def build_current_item_id_set(current_items):
    """Build a set of all current item IDs for quick orphan detection."""
    id_set = set()
    for item in current_items:
        if item.get('id'):
            id_set.add(item['id'])
    return id_set


def merge_timelines(tl1, tl2):
    """Merge two timeline arrays, sort by date, dedupe identical entries."""
    merged = list(tl1 or []) + list(tl2 or [])
    seen = set()
    unique = []
    for entry in merged:
        key = json.dumps(entry, sort_keys=True)
        if key not in seen:
            seen.add(key)
            unique.append(entry)
    def sort_key(e):
        d = e.get('date', '') if isinstance(e, dict) else ''
        return d or ''
    unique.sort(key=sort_key)
    return unique


def snapshot_cell_data(rows, label='pre_recovery'):
    """Dump entire cell_data table to a timestamped JSON file."""
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    filename = f'cell_data_snapshot_{label}_{ts}.json'
    filepath = os.path.join(os.path.dirname(os.path.abspath(__file__)), filename)
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)
    print(f'Snapshot saved: {filepath} ({len(rows)} rows)')
    return filepath


def reconstruct_cell_id(venture_id, parsed, new_item_id):
    """Reconstruct a cell ID with the new item ID, preserving the original format."""
    if parsed is None:
        return None

    block = parsed.get('block', '')
    floor = parsed.get('floor')
    flat = parsed.get('flat')
    category_slug = parsed.get('category_slug')

    # Super structure format: {venture}_superstructure_{block}_{itemId}
    if floor is None and flat is None and block:
        return f'{venture_id}_superstructure_{block}_{new_item_id}'

    # Work view format: {venture}_{block}_floor{N}_{categorySlug}_{itemId}_{flatNum}
    if category_slug and floor is not None and flat is not None:
        flat_str = str(flat) if isinstance(flat, int) else str(flat)
        if isinstance(flat, int) and flat < 100:
            flat_str = f'{flat:03d}'
        return f'{venture_id}_{block}_floor{floor}_{category_slug}_{new_item_id}_{flat_str}'

    # Flat view format: {venture}_{block}_floor{N}_{flatNum}_{itemId}
    if floor is not None and flat is not None:
        flat_str = str(flat) if isinstance(flat, int) else str(flat)
        if isinstance(flat, int) and flat < 100:
            flat_str = f'{flat:03d}'
        return f'{venture_id}_{block}_floor{floor}_{flat_str}_{new_item_id}'

    return None


def main():
    parser = argparse.ArgumentParser(description='Recover orphaned cell_data colors by remapping old item IDs to current item IDs')
    parser.add_argument('--dry-run', action='store_true', help='Log proposed recovery without writing')
    parser.add_argument('--snapshot', action='store_true', help='Dump cell_data to JSON file and exit')
    parser.add_argument('--venture', type=str, default=None, help='Only process rows for this venture ID')
    args = parser.parse_args()

    print(f'{"[DRY RUN] " if args.dry_run else ""}Fetching data from Supabase...')

    # Fetch all cell_data rows
    cells_res = sb.table('cell_data').select('*').execute()
    all_cells = cells_res.data or []
    print(f'Fetched {len(all_cells)} cell_data rows.')

    if args.snapshot:
        snapshot_cell_data(all_cells, label='manual')
        return

    # Fetch all ventures
    vent_res = sb.table('ventures').select('*').execute()
    ventures = vent_res.data or []
    print(f'Fetched {len(ventures)} ventures.')

    # Build venture lookup: id → venture_data
    venture_map = {}
    for v in ventures:
        vid = v.get('id', '')
        vdata = v.get('data') or {}
        if isinstance(vdata, str):
            try:
                vdata = json.loads(vdata)
            except Exception:
                vdata = {}
        venture_map[vid] = vdata

    if args.venture:
        venture_map = {k: v for k, v in venture_map.items() if k == args.venture}
        print(f'Filtered to venture: {args.venture}')

    # Build cell_data lookup by ID for merge detection
    cell_by_id = {}
    for row in all_cells:
        cell_by_id[row['id']] = row

    stats = {
        'recovered': 0,
        'merged': 0,
        'ambiguous': 0,
        'already_current': 0,
        'no_venture': 0,
        'unparseable': 0,
        'no_current_match': 0,
    }

    operations = []

    for vid, vdata in venture_map.items():
        print(f'\n=== Processing venture: {vid} ===')

        current_items = get_all_current_items(vdata)
        current_item_ids = build_current_item_id_set(current_items)
        slug_map = build_slug_to_items_map(current_items)

        print(f'  Current items: {len(current_items)}, Current item IDs: {len(current_item_ids)}')

        # Find all cells for this venture
        venture_cells = [r for r in all_cells if r['id'].startswith(vid + '_')]
        print(f'  Cell rows: {len(venture_cells)}')

        for row in venture_cells:
            cell_id = row['id']
            data = row.get('data') or {}
            if isinstance(data, str):
                try:
                    data = json.loads(data)
                except Exception:
                    data = {}

            parsed = parse_cell_id(cell_id, vid)
            if not parsed:
                stats['unparseable'] += 1
                if args.dry_run:
                    print(f'    [SKIP] Cannot parse: {cell_id}')
                continue

            old_item_id = parsed.get('item_id', '')

            # Check if this cell's item_id is already current
            if old_item_id in current_item_ids:
                stats['already_current'] += 1
                continue

            # Try to find the label from the old item_id
            old_label = extract_label_from_item_id(old_item_id)
            old_slug = slug_id(old_label)

            # Look up current items with matching slug
            matching_items = slug_map.get(old_slug, [])

            # Category-aware disambiguation: if multiple matches, try to narrow
            # by category context derived from the cell ID format.
            if len(matching_items) > 1:
                is_super = (parsed.get('floor') is None and parsed.get('flat') is None)
                cat_slug = parsed.get('category_slug')
                if is_super:
                    # Superstructure cells should only match __super__ items
                    filtered = [i for i in matching_items if i.get('category') == '__super__']
                    if len(filtered) == 1:
                        matching_items = filtered
                    elif len(filtered) > 1:
                        matching_items = filtered
                elif cat_slug:
                    # Work view cells: try to match category by slug
                    filtered = [i for i in matching_items if i.get('category') and slug_id(i['category']) == cat_slug]
                    if len(filtered) == 1:
                        matching_items = filtered
                    elif len(filtered) > 1:
                        matching_items = filtered

            if len(matching_items) == 0:
                stats['no_current_match'] += 1
                if args.dry_run:
                    print(f'    [NO MATCH] {cell_id} -> slug="{old_slug}" (label="{old_label}") not found in current items')
                continue

            if len(matching_items) > 1:
                stats['ambiguous'] += 1
                if args.dry_run:
                    labels = [i['label'] for i in matching_items]
                    print(f'    [AMBIGUOUS] {cell_id} -> slug="{old_slug}" matches {len(matching_items)} items: {labels} -- SKIPPING for manual review')
                continue

            # Exactly one match — proceed
            new_item = matching_items[0]
            new_item_id = new_item['id']
            if not new_item_id:
                stats['no_current_match'] += 1
                if args.dry_run:
                    print(f'    [NO ID] {cell_id} -> matched "{new_item["label"]}" but item has no ID')
                continue

            # Reconstruct the new cell ID
            new_cell_id = reconstruct_cell_id(vid, parsed, new_item_id)
            if not new_cell_id:
                stats['unparseable'] += 1
                continue

            # Check if a row with the new cell ID already exists
            if new_cell_id in cell_by_id:
                # Merge
                existing_row = cell_by_id[new_cell_id]
                existing_data = existing_row.get('data') or {}
                if isinstance(existing_data, str):
                    try:
                        existing_data = json.loads(existing_data)
                    except Exception:
                        existing_data = {}

                merged_data = dict(existing_data)
                merged_data['timeline'] = merge_timelines(
                    existing_data.get('timeline'),
                    data.get('timeline')
                )
                old_updated = data.get('updated_at', '')
                new_updated = existing_data.get('updated_at', '')
                if old_updated > new_updated:
                    merged_data['color'] = data.get('color', existing_data.get('color'))
                    merged_data['remarks'] = data.get('remarks', existing_data.get('remarks'))
                    merged_data['updated_at'] = old_updated
                else:
                    merged_data['color'] = existing_data.get('color', data.get('color'))
                    merged_data['remarks'] = existing_data.get('remarks', data.get('remarks'))
                    merged_data['updated_at'] = new_updated
                merged_data['venture_id'] = vid
                if parsed.get('block'):
                    merged_data['block'] = parsed['block']
                if parsed.get('floor') is not None:
                    merged_data['floor'] = str(parsed['floor'])

                operations.append({
                    'action': 'merge',
                    'old_id': cell_id,
                    'new_id': new_cell_id,
                    'data': merged_data,
                })
                stats['merged'] += 1
                if args.dry_run:
                    tl_count = len(merged_data.get('timeline', []))
                    print(f'    [MERGE]  {cell_id} -> {new_cell_id} (color={merged_data.get("color")}, timeline_entries={tl_count})')
            else:
                # Upsert new row
                new_data = dict(data)
                new_data['venture_id'] = vid
                if parsed.get('block'):
                    new_data['block'] = parsed['block']
                if parsed.get('floor') is not None:
                    new_data['floor'] = str(parsed['floor'])

                operations.append({
                    'action': 'upsert',
                    'old_id': cell_id,
                    'new_id': new_cell_id,
                    'data': new_data,
                })
                stats['recovered'] += 1
                if args.dry_run:
                    print(f'    [RECOVER] {cell_id} -> {new_cell_id} (color={new_data.get("color")})')

    print(f'\n--- Summary ---')
    print(f'  Recovered (new upsert):    {stats["recovered"]}')
    print(f'  Merged (into existing):    {stats["merged"]}')
    print(f'  Ambiguous (manual review): {stats["ambiguous"]}')
    print(f'  Already current:           {stats["already_current"]}')
    print(f'  No current match:          {stats["no_current_match"]}')
    print(f'  Unparseable:               {stats["unparseable"]}')

    if args.dry_run:
        print(f'\n[DRY RUN] No writes performed. Review the log above.')
        if stats['ambiguous'] > 0:
            print(f'  WARNING: {stats["ambiguous"]} ambiguous rows need manual review before real run!')
        return

    if not operations:
        print('No recovery operations needed. Exiting.')
        return

    # Take snapshot before writing
    print('\nTaking pre-write snapshot...')
    snapshot_cell_data(all_cells, label='pre_recovery')

    # Apply operations
    print(f'\nApplying {len(operations)} recovery operations to Supabase...')
    success = 0
    errors = 0
    for op in operations:
        try:
            if op['action'] == 'merge':
                sb.table('cell_data').update({'data': op['data']}).eq('id', op['new_id']).execute()
            else:
                sb.table('cell_data').upsert({'id': op['new_id'], 'data': op['data']}).execute()
            success += 1
        except Exception as e:
            print(f'  [ERROR] Failed {op["action"]} on {op["new_id"]}: {e}')
            errors += 1

    print(f'\nDone. Success: {success}, Errors: {errors}')
    if stats['ambiguous'] > 0:
        print(f'  WARNING: {stats["ambiguous"]} ambiguous rows still need manual review!')


if __name__ == '__main__':
    main()
