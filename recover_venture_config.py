"""
Recovery script for venture config overwritten by 'Apply to ALL Ventures'.

Reads cell_data rows for each affected venture, extracts old item IDs from
cell IDs, and reconstructs the original flat_view_items / work_categories /
super_structure_items by fuzzy-matching slug fragments to labels.

USAGE:
  1. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env
  2. python recover_venture_config.py
  3. Review the output JSON files (recovery_<venture_id>.json)
  4. When satisfied, run: python recover_venture_config.py --apply

This script is READ-ONLY by default. It only writes to the database
when run with --apply.
"""

import os
import re
import json
import sys
from collections import defaultdict
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SUPABASE_SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_KEY', '')
supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY) if SUPABASE_URL and SUPABASE_SERVICE_KEY else None

if not supabase:
    print('ERROR: Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env')
    sys.exit(1)


def slug_to_label(slug):
    """Best-effort: convert a slug like 'brick_work' to 'Brick Work'."""
    return ' '.join(w.capitalize() for w in slug.split('_') if w).strip()


def extract_item_id_from_cell(cell_id, venture_id):
    """Extract the item ID portion from a cell_data.id string.

    Cell ID formats (after venture prefix):
      1. {block}_floor{N}_{flatNum}_{itemId}          — flat view
      2. {block}_floor{N}_{catSlug}_{itemId}_{flatNum}  — work view
      3. superstructure_{block}_{itemId}                — super structure
    """
    prefix = venture_id + '_'
    if not cell_id.startswith(prefix):
        return None, None  # (item_id, source_type)

    rest = cell_id[len(prefix):]

    # Format 3: superstructure_{block}_{itemId}
    if rest.startswith('superstructure_'):
        ss_rest = rest[len('superstructure_'):]
        m = re.match(r'^([^_]+)_(.+)$', ss_rest)
        if m:
            return m.group(2), 'super_structure'
        return None, None

    # Format 1: {block}_floor{N}_{flatNum}_{itemId}
    # flatNum is 3 digits or P-XXX
    m = re.match(r'^(.+)_floor(\d+)_(\d{3}|P-\d{3})_(.+)$', rest)
    if m:
        return m.group(4), 'flat_view'

    # Format 2: {block}_floor{N}_{catSlug}_{itemId}_{flatNum}
    m = re.match(r'^(.+)_floor(\d+)_(.+?)_(item_.+)_(\d{3}|P-\d{3})$', rest)
    if m:
        return m.group(4), 'work_category'

    # Format 2 variant: non-item_ prefixed IDs
    m = re.match(r'^(.+)_floor(\d+)_(.+?)_([^_]+_\d+)_(\d{3}|P-\d{3})$', rest)
    if m:
        return m.group(4), 'work_category'

    return None, None


def get_all_ventures():
    """Fetch all ventures with their data."""
    res = supabase.table('ventures').select('id, name, data').execute()
    ventures = []
    for row in (res.data or []):
        vdata = row.get('data') or {}
        if isinstance(vdata, str):
            try:
                vdata = json.loads(vdata)
            except Exception:
                vdata = {}
        ventures.append({
            'id': row['id'],
            'name': row.get('name') or vdata.get('name', row['id']),
            'data': vdata
        })
    return ventures


def get_cell_data_for_venture(venture_id):
    """Fetch all cell_data rows for a venture, paginated."""
    all_rows = []
    offset = 0
    page_size = 1000
    while True:
        res = supabase.table('cell_data').select('id, data').filter(
            'data->>venture_id', 'eq', venture_id
        ).range(offset, offset + page_size - 1).execute()
        if not res.data:
            break
        all_rows.extend(res.data)
        if len(res.data) < page_size:
            break
        offset += page_size
    return all_rows


def get_current_items(venture_data):
    """Extract current item IDs and labels from venture data."""
    current = {
        'flat_view': {},      # id -> label
        'work_category': {},  # id -> (category, label)
        'super_structure': {} # id -> label
    }

    # flat_view_items
    for item in (venture_data.get('flat_view_items') or []):
        if isinstance(item, dict) and item.get('id'):
            current['flat_view'][item['id']] = item.get('label', '')
        elif isinstance(item, str):
            current['flat_view'][item] = item

    # work_categories
    for cat, items in (venture_data.get('work_categories') or {}).items():
        for item in items:
            if isinstance(item, dict) and item.get('id'):
                current['work_category'][item['id']] = (cat, item.get('label', ''))
            elif isinstance(item, str):
                current['work_category'][item] = (cat, item)

    # super_structure_items
    for item in (venture_data.get('super_structure_items') or []):
        if isinstance(item, dict) and item.get('id'):
            current['super_structure'][item['id']] = item.get('label', '')
        elif isinstance(item, str):
            current['super_structure'][item] = item

    return current


def fuzzy_match_label(old_id, current_items_map):
    """Try to match an old item ID to a current item by slug fragment.

    Returns (matched_id, matched_label, confidence) or (None, None, 0).
    """
    # Exact match
    if old_id in current_items_map:
        label = current_items_map[old_id]
        if isinstance(label, tuple):
            return old_id, label[1], 1.0
        return old_id, label, 1.0

    # Slug-based fuzzy match: extract the slug portion from old_id
    # old_id patterns: item_brick_work_1234567_abcde, ss_pile_caps_1234567_abcde
    # Try to match on the slug prefix (before the timestamp/random suffix)
    parts = old_id.split('_')
    # Remove trailing timestamp/random parts (numeric + alphanumeric)
    slug_parts = []
    for p in parts:
        if p.isdigit() or (len(p) <= 5 and p.isalnum() and not p.isalpha()):
            break
        slug_parts.append(p)

    if not slug_parts:
        return None, None, 0

    old_slug = '_'.join(slug_parts)

    best_match = None
    best_score = 0
    for curr_id, curr_label in current_items_map.items():
        if isinstance(curr_label, tuple):
            curr_label_text = curr_label[1]
        else:
            curr_label_text = curr_label or ''

        # Parse slug from current id
        c_parts = curr_id.split('_')
        c_slug_parts = []
        for p in c_parts:
            if p.isdigit() or (len(p) <= 5 and p.isalnum() and not p.isalpha()):
                break
            c_slug_parts.append(p)
        curr_slug = '_'.join(c_slug_parts)

        if curr_slug == old_slug:
            return curr_id, curr_label_text, 0.95

        # Partial match — only if the shorter slug is substantial (>= 8 chars)
        # to avoid false positives like 'item' matching 'item_civil_work_brick_work'
        shorter = min(len(curr_slug), len(old_slug))
        longer = max(len(curr_slug), len(old_slug))
        if shorter >= 8 and (old_slug in curr_slug or curr_slug in old_slug):
            score = shorter / longer
            if score > best_score:
                best_score = score
                best_match = (curr_id, curr_label_text, score)

    if best_match and best_score > 0.5:
        return best_match

    # Last resort: match by label slug
    guessed_label = slug_to_label(old_slug)
    for curr_id, curr_label in current_items_map.items():
        if isinstance(curr_label, tuple):
            curr_label_text = curr_label[1]
        else:
            curr_label_text = curr_label or ''
        if curr_label_text.lower().replace(' ', '_') == old_slug:
            return curr_id, curr_label_text, 0.8

    return None, None, 0


def reconstruct_venture_config(venture_id, venture_name, venture_data):
    """Main reconstruction logic for a single venture."""

    # Get current items
    current = get_current_items(venture_data)
    current_flat_ids = set(current['flat_view'].keys())
    current_work_ids = set(current['work_category'].keys())
    current_ss_ids = set(current['super_structure'].keys())

    # Get all cell_data rows
    cells = get_cell_data_for_venture(venture_id)
    print(f'  [{venture_id}] Found {len(cells)} cell_data rows')

    # Extract old item IDs from cell IDs
    old_flat_items = {}      # id -> set of blocks/floors where used
    old_work_items = {}      # id -> (category_slug, set of blocks/floors)
    old_ss_items = {}        # id -> set of blocks

    for row in cells:
        cell_id = row.get('id', '')
        old_item_id, source_type = extract_item_id_from_cell(cell_id, venture_id)
        if not old_item_id:
            continue

        if source_type == 'flat_view':
            if old_item_id not in old_flat_items:
                old_flat_items[old_item_id] = 0
            old_flat_items[old_item_id] += 1
        elif source_type == 'work_category':
            # Try to extract category slug from cell ID
            prefix = venture_id + '_'
            rest = cell_id[len(prefix):]
            cat_match = re.match(r'^(.+)_floor(\d+)_(.+?)_(item.+|[^_]+_\d+)_(\d{3}|P-\d{3})$', rest)
            cat_slug = cat_match.group(3) if cat_match else 'unknown'
            if old_item_id not in old_work_items:
                old_work_items[old_item_id] = {'cat_slug': cat_slug, 'count': 0}
            old_work_items[old_item_id]['count'] += 1
        elif source_type == 'super_structure':
            if old_item_id not in old_ss_items:
                old_ss_items[old_item_id] = 0
            old_ss_items[old_item_id] += 1

    print(f'  [{venture_id}] Extracted: {len(old_flat_items)} flat items, '
          f'{len(old_work_items)} work items, {len(old_ss_items)} super structure items')

    # Check which old IDs are already in current config
    orphaned_flat = {oid for oid in old_flat_items if oid not in current_flat_ids}
    orphaned_work = {oid for oid in old_work_items if oid not in current_work_ids}
    orphaned_ss = {oid for oid in old_ss_items if oid not in current_ss_ids}

    print(f'  [{venture_id}] Orphaned (not in current config): '
          f'{len(orphaned_flat)} flat, {len(orphaned_work)} work, {len(orphaned_ss)} super structure')

    if not orphaned_flat and not orphaned_work and not orphaned_ss:
        print(f'  [{venture_id}] No orphaned items — venture config looks intact. Skipping.')
        return None

    # Build recovery data
    # For flat_view_items: merge current items + reconstructed orphaned items
    recovered_flat_items = list(venture_data.get('flat_view_items') or [])
    # Ensure current items have proper format
    if recovered_flat_items and isinstance(recovered_flat_items[0], str):
        recovered_flat_items = [{'id': oid, 'label': oid} for oid in recovered_flat_items]

    for old_id in orphaned_flat:
        matched_id, matched_label, conf = fuzzy_match_label(old_id, current['flat_view'])
        if matched_id and conf >= 0.95:
            # Already exists under a different ID — just note it
            print(f'    [flat] {old_id} -> matches current {matched_id} ({matched_label}) conf={conf:.2f}')
        else:
            # Reconstruct label from slug
            parts = old_id.split('_')
            slug_parts = []
            for p in parts:
                if p.isdigit() or (len(p) <= 5 and p.isalnum() and not p.isalpha()):
                    break
                slug_parts.append(p)
            label = slug_to_label('_'.join(slug_parts)) if slug_parts else old_id
            if conf > 0:
                label = f'{label} (fuzzy match: {matched_label})'
            recovered_flat_items.append({'id': old_id, 'label': label})
            print(f'    [flat] {old_id} -> RECOVERED as "{label}" (uses={old_flat_items[old_id]})')

    # For work_categories: merge current + reconstructed
    recovered_work_cats = dict(venture_data.get('work_categories') or {})
    # Ensure current items have proper format
    for cat, items in recovered_work_cats.items():
        if items and isinstance(items[0], str):
            recovered_work_cats[cat] = [{'id': oid, 'label': oid} for oid in items]

    # Group orphaned work items by category slug
    orphaned_by_cat = defaultdict(list)
    for old_id, info in old_work_items.items():
        if old_id in orphaned_work:
            orphaned_by_cat[info['cat_slug']].append((old_id, info['count']))

    for cat_slug, items_info in orphaned_by_cat.items():
        # Try to find existing category with matching slug
        cat_label = slug_to_label(cat_slug)
        matched_cat = None
        for existing_cat in recovered_work_cats:
            if slug_to_label(existing_cat).lower().replace(' ', '_') == cat_slug:
                matched_cat = existing_cat
                break

        if matched_cat:
            # Add orphaned items to existing category
            existing_ids = {i['id'] for i in recovered_work_cats[matched_cat] if isinstance(i, dict) and i.get('id')}
            for old_id, uses in items_info:
                if old_id not in existing_ids:
                    parts = old_id.split('_')
                    slug_parts = []
                    for p in parts:
                        if p.isdigit() or (len(p) <= 5 and p.isalnum() and not p.isalpha()):
                            break
                        slug_parts.append(p)
                    label = slug_to_label('_'.join(slug_parts)) if slug_parts else old_id
                    recovered_work_cats[matched_cat].append({'id': old_id, 'label': label})
                    print(f'    [work] {old_id} -> added to "{matched_cat}" as "{label}" (uses={uses})')
        else:
            # Create new category
            recovered_work_cats[cat_label] = []
            for old_id, uses in items_info:
                parts = old_id.split('_')
                slug_parts = []
                for p in parts:
                    if p.isdigit() or (len(p) <= 5 and p.isalnum() and not p.isalpha()):
                        break
                    slug_parts.append(p)
                label = slug_to_label('_'.join(slug_parts)) if slug_parts else old_id
                recovered_work_cats[cat_label].append({'id': old_id, 'label': label})
                print(f'    [work] {old_id} -> new category "{cat_label}" as "{label}" (uses={uses})')

    # For super_structure_items: merge current + reconstructed
    recovered_ss_items = list(venture_data.get('super_structure_items') or [])
    if recovered_ss_items and isinstance(recovered_ss_items[0], str):
        recovered_ss_items = [{'id': oid, 'label': oid} for oid in recovered_ss_items]

    for old_id in orphaned_ss:
        matched_id, matched_label, conf = fuzzy_match_label(old_id, current['super_structure'])
        if matched_id and conf >= 0.95:
            print(f'    [ss] {old_id} -> matches current {matched_id} ({matched_label}) conf={conf:.2f}')
        else:
            parts = old_id.split('_')
            slug_parts = []
            for p in parts:
                if p.isdigit() or (len(p) <= 5 and p.isalnum() and not p.isalpha()):
                    break
                slug_parts.append(p)
            label = slug_to_label('_'.join(slug_parts)) if slug_parts else old_id
            if conf > 0:
                label = f'{label} (fuzzy match: {matched_label})'
            recovered_ss_items.append({'id': old_id, 'label': label})
            print(f'    [ss] {old_id} -> RECOVERED as "{label}" (uses={old_ss_items[old_id]})')

    # Build the recovery data — only the keys we're changing
    recovery = {
        'venture_id': venture_id,
        'venture_name': venture_name,
        'stats': {
            'total_cells': len(cells),
            'old_flat_items': len(old_flat_items),
            'old_work_items': len(old_work_items),
            'old_ss_items': len(old_ss_items),
            'orphaned_flat': len(orphaned_flat),
            'orphaned_work': len(orphaned_work),
            'orphaned_ss': len(orphaned_ss),
        },
        'current_data': venture_data,
        'recovered_data': dict(venture_data),  # copy all existing keys
    }
    recovery['recovered_data']['flat_view_items'] = recovered_flat_items
    recovery['recovered_data']['work_categories'] = recovered_work_cats
    recovery['recovered_data']['super_structure_items'] = recovered_ss_items

    return recovery


def main():
    apply = '--apply' in sys.argv

    ventures = get_all_ventures()
    print(f'Found {len(ventures)} ventures\n')

    any_recovered = False
    for v in ventures:
        print(f'\n=== {v["name"]} ({v["id"]}) ===')
        recovery = reconstruct_venture_config(v['id'], v['name'], v['data'])
        if recovery:
            any_recovered = True
            filename = f'recovery_{v["id"]}.json'
            with open(filename, 'w', encoding='utf-8') as f:
                json.dump(recovery, f, indent=2, ensure_ascii=False)
            print(f'  -> Written to {filename}')

            if apply:
                print(f'  -> APPLYING recovery to {v["id"]}...')
                supabase.table('ventures').update({
                    'data': recovery['recovered_data']
                }).eq('id', v['id']).execute()
                print(f'  -> Applied successfully.')
            else:
                print(f'  -> Review {filename} then re-run with --apply to write to database.')
        else:
            print(f'  -> No recovery needed.')

    if not apply and any_recovered:
        print('\n\n=== DRY RUN COMPLETE ===')
        print('Review the recovery_*.json files above.')
        print('When ready to apply, run: python recover_venture_config.py --apply')
    elif apply and any_recovered:
        print('\n\n=== RECOVERY APPLIED ===')
        print('All affected ventures have been updated.')
    else:
        print('\n\nNo ventures needed recovery.')


if __name__ == '__main__':
    main()
