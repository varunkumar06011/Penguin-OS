#!/usr/bin/env python3
"""
RWA Maintenance Invoice Generator
=================================
Standalone script to bulk-generate monthly maintenance invoices for all
completed flats. Can be run manually or scheduled via APScheduler / cron.

Usage:
    python generate_invoices.py --month 2025-01 --amount 2500 [--due-date 2025-01-15]

Environment variables (same as app.py):
    SUPABASE_URL, SUPABASE_SERVICE_KEY
"""

import argparse
import os
import sys
from datetime import date, timedelta
from supabase import create_client

def main():
    parser = argparse.ArgumentParser(description='Generate RWA maintenance invoices for all completed flats')
    parser.add_argument('--month', required=True, help='Billing month in YYYY-MM format')
    parser.add_argument('--amount', type=float, required=True, help='Invoice amount in INR')
    parser.add_argument('--due-date', help='Due date in YYYY-MM-DD format (default: end of billing month)')
    parser.add_argument('--dry-run', action='store_true', help='Print what would be created without inserting')
    args = parser.parse_args()

    supabase_url = os.environ.get('SUPABASE_URL')
    supabase_key = os.environ.get('SUPABASE_SERVICE_KEY') or os.environ.get('SUPABASE_ANON_KEY')
    if not supabase_url or not supabase_key:
        print('Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in environment')
        sys.exit(1)

    sb = create_client(supabase_url, supabase_key)

    # Calculate due date: end of billing month if not specified
    if args.due_date:
        due_date = args.due_date
    else:
        year, month = map(int, args.month.split('-'))
        if month == 12:
            due_date = f'{year}-12-31'
        else:
            next_month = date(year, month + 1, 1) - timedelta(days=1)
            due_date = next_month.isoformat()

    # Fetch all completed flats
    flats_res = sb.table('flats').select('id, block, floor, flat_number, owner_name').eq(
        'construction_status', 'completed').execute()
    flats = flats_res.data or []

    if not flats:
        print('No completed flats found. Nothing to invoice.')
        return

    # Check for existing invoices for this month to avoid duplicates
    existing_res = sb.table('rwa_invoices').select('flat_id, billing_month').eq(
        'billing_month', args.month).execute()
    existing = {(r.get('flat_id'), r.get('billing_month')) for r in (existing_res.data or [])}

    # Fetch residents linked to flats for resident_id mapping
    flat_ids = [f['id'] for f in flats]
    residents_res = sb.table('residents').select('id, flat_id, name').in_(
        'flat_id', flat_ids).execute()
    flat_to_resident = {}
    for r in (residents_res.data or []):
        flat_to_resident[r['flat_id']] = r['id']

    import uuid as _uuid

    created = 0
    skipped = 0
    for flat in flats:
        key = (flat['id'], args.month)
        if key in existing:
            skipped += 1
            continue

        invoice_number = f'RWA-{args.month.replace("-", "")}-{_uuid.uuid4().hex[:6].upper()}'
        row = {
            'flat_id': flat['id'],
            'invoice_number': invoice_number,
            'billing_month': args.month,
            'amount': args.amount,
            'due_date': due_date,
            'status': 'unpaid',
        }
        if flat['id'] in flat_to_resident:
            row['resident_id'] = flat_to_resident[flat['id']]

        if args.dry_run:
            print(f'[DRY RUN] Would create: {invoice_number} for {flat["block"]}-{flat["floor"]}-{flat["flat_number"]} (₹{args.amount})')
        else:
            sb.table('rwa_invoices').insert(row).execute()
            print(f'Created: {invoice_number} for {flat["block"]}-{flat["floor"]}-{flat["flat_number"]} (₹{args.amount})')
        created += 1

    print(f'\nDone: {created} invoices {"would be " if args.dry_run else ""}created, {skipped} skipped (already exist).')


if __name__ == '__main__':
    main()
