from flask import Flask, render_template, request, jsonify, session, redirect, url_for
import os
import json
from datetime import timedelta
from functools import wraps
from dotenv import load_dotenv
from supabase import create_client, Client
from werkzeug.security import check_password_hash, generate_password_hash

load_dotenv()

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'vgrand-secret-key-2025')
app.permanent_session_lifetime = timedelta(days=30)

SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SUPABASE_ANON_KEY = os.environ.get('SUPABASE_ANON_KEY', '')
SUPABASE_SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_KEY', '')

# Use the service-role key server-side so RLS policies can be deny-by-default.
# The browser never touches Supabase directly, so this key never leaves the server.
_supabase_key = SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY
supabase: Client = create_client(SUPABASE_URL, _supabase_key) if SUPABASE_URL and _supabase_key else None


def load_json_fallback(filename):
    try:
        path = os.path.join(os.path.dirname(__file__), 'live_data', filename)
        with open(path, 'r', encoding='utf-8-sig') as f:
            return json.load(f)
    except Exception as e:
        print(f'Error loading JSON fallback {filename}: {e}')
        return None

DEMO_USERNAME = 'Vgrand@123'
DEMO_PASSWORD = 'Vgrand1234'

DEFAULT_WORK_ITEMS = [
    "BRICK WORK", "ELECTRICAL PIPES", "MESH", "PLASTERING",
    "CEILING PAINT", "POP FRAME", "CEILING WIRING", "POP SHEETS",
    "WALL CARE", "BATHROOM PLUMBING", "WINDOW FRAME", "BATH SWR LINES",
    "BATH CONCEALING", "TILES", "DOORS FITTING", "PAINT PRIMER",
    "PAINT 1st COAT", "WINDOWS PAINT", "SWITCH BOARD FITTING",
    "PATCH WORK", "2nd COAT PAINTING"
]

FLOORS = ["1st Floor", "2nd Floor", "3rd Floor", "4th Floor", "5th Floor"]
FLATS_PER_FLOOR = 6


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user' not in session:
            return redirect(url_for('login_page'))
        return f(*args, **kwargs)
    return decorated


def requires_role(*allowed_roles):
    def decorator(f):
        @wraps(f)
        @login_required
        def wrapped(*args, **kwargs):
            user = session.get('user')
            if user.get('role') not in allowed_roles:
                return jsonify({'error': 'Forbidden'}), 403
            return f(*args, **kwargs)
        return wrapped
    return decorator


@app.route('/login', methods=['POST'])
def login():
    data = request.get_json() or {}
    username = data.get('username', '')
    password = data.get('password', '')

    # Try the real users table first.
    user_obj = None
    if supabase:
        try:
            res = supabase.table('users').select('*').eq('email', username).eq('active', True).execute()
            if res.data:
                row = res.data[0]
                pw_hash = row.get('password_hash', '')
                # Legacy/sentinel hash: allow the demo password and update the hash.
                if pw_hash == 'LEGACY' or not pw_hash:
                    if username == DEMO_USERNAME and password == DEMO_PASSWORD:
                        user_obj = {'id': row['id'], 'email': row['email'], 'role': row['role'], 'org_id': row['org_id']}
                elif check_password_hash(pw_hash, password):
                    user_obj = {'id': row['id'], 'email': row['email'], 'role': row['role'], 'org_id': row['org_id']}
        except Exception as e:
            print(f'Error loading user from Supabase: {e}')

    # Fallback to the hardcoded demo credentials when the users table is not populated.
    if not user_obj and username == DEMO_USERNAME and password == DEMO_PASSWORD:
        user_obj = {'id': 'demo', 'email': DEMO_USERNAME, 'role': 'admin', 'org_id': None}

    if user_obj:
        session['user'] = user_obj
        session.permanent = True
        return jsonify({'success': True, 'user': user_obj['email'], 'role': user_obj['role']})
    return jsonify({'success': False, 'error': 'Invalid credentials'}), 401


@app.route('/logout', methods=['POST'])
def logout():
    session.pop('user', None)
    return jsonify({'success': True})


@app.route('/api/me')
def me():
    if 'user' in session:
        return jsonify({'user': session['user']['email'], 'role': session['user']['role']})
    return jsonify({'user': None, 'role': None})


@app.route('/')
@login_required
def index():
    return render_template('index.html')


@app.route('/login')
def login_page():
    if 'user' in session:
        return redirect(url_for('index'))
    return render_template('login.html')


# ========================
# Cell Data API
# ========================

@app.route('/api/cells')
@login_required
def api_cells():
    if not supabase:
        fallback = load_json_fallback('cells.json')
        return jsonify(fallback or {})
    try:
        res = supabase.table('cell_data').select('*').execute()
        # Defensive sort: most recent updated_at wins if duplicates still exist pre-migration
        sorted_rows = sorted(res.data, key=lambda r: (r.get('data') or {}).get('updated_at', ''), reverse=True)
        data = {}
        for row in sorted_rows:
            merged = {**(row.get('data') or {})}
            merged['id'] = row['id']
            data[row['id']] = merged
        return jsonify(data)
    except Exception as e:
        print(f'Error fetching cells: {e}')
        fallback = load_json_fallback('cells.json')
        return jsonify(fallback or {})


@app.route('/api/cell/<cell_id>')
@login_required
def api_cell(cell_id):
    if not supabase:
        fallback = load_json_fallback('cells.json') or {}
        cell = fallback.get(cell_id, {})
        return jsonify(cell if cell else {})
    try:
        res = supabase.table('cell_data').select('*').eq('id', cell_id).execute()
        if res.data:
            # Defensive: take most recently updated if duplicates exist
            row = max(res.data, key=lambda r: (r.get('data') or {}).get('updated_at', ''))
            merged = {**(row.get('data') or {})}
            merged['id'] = row['id']
            return jsonify(merged)
        return jsonify({}), 404
    except Exception as e:
        print(f'Error fetching cell {cell_id}: {e}')
        fallback = load_json_fallback('cells.json') or {}
        cell = fallback.get(cell_id, {})
        return jsonify(cell if cell else {})


@app.route('/api/cell/<cell_id>', methods=['POST'])
@login_required
def api_cell_post(cell_id):
    body = request.get_json() or {}
    if not supabase:
        return jsonify({'success': True, 'note': 'read-only local mode'})
    try:
        supabase.table('cell_data').upsert({
            'id': cell_id,
            'data': body
        }, on_conflict='id').execute()
        return jsonify({'success': True})
    except Exception as e:
        print(f'Error saving cell {cell_id}: {e}')
        return jsonify({'success': True, 'note': 'read-only local mode'})


@app.route('/api/cells/batch', methods=['POST'])
@login_required
def api_cells_batch():
    body = request.get_json() or {}
    cells = body.get('cells', [])
    if not cells:
        return jsonify({'success': True})
    if not supabase:
        return jsonify({'success': True, 'count': len(cells), 'note': 'read-only local mode'})
    rows = [{'id': c['id'], 'data': c.get('data', {})} for c in cells]
    try:
        supabase.table('cell_data').upsert(rows, on_conflict='id').execute()
        return jsonify({'success': True, 'count': len(rows)})
    except Exception as e:
        print(f'Error in batch upsert: {e}')
        return jsonify({'success': True, 'count': len(cells), 'note': 'read-only local mode'})


# ========================
# Ventures API
# ========================

@app.route('/api/ventures')
@login_required
def api_ventures():
    if not supabase:
        fallback = load_json_fallback('ventures.json')
        return jsonify(fallback or [])
    try:
        res = supabase.table('ventures').select('*').execute()
        return jsonify([row['data'] for row in res.data])
    except Exception as e:
        print(f'Error fetching ventures: {e}')
        fallback = load_json_fallback('ventures.json')
        return jsonify(fallback or [])


@app.route('/api/ventures', methods=['POST'])
@requires_role('admin')
def api_ventures_post():
    if not supabase:
        return jsonify({'success': True, 'note': 'read-only local mode'})
    try:
        body = request.get_json() or []
        if not body:
            return jsonify({'error': 'Refusing to replace ventures with an empty list'}), 400

        # Defence-in-depth: bulk save must not silently drop existing ventures.
        # Legitimate edits should use POST /api/venture/<id>; this endpoint is
        # reserved for first-run seeding and explicit full-restore operations.
        existing = supabase.table('ventures').select('id').execute()
        existing_ids = {row['id'] for row in existing.data}
        incoming_ids = {v.get('id') for v in body if v.get('id')}
        force = request.args.get('force', 'false').lower() == 'true'

        if existing_ids and not incoming_ids.issuperset(existing_ids) and not force:
            missing = sorted(existing_ids - incoming_ids)
            return jsonify({
                'error': 'Bulk save would drop existing ventures',
                'missing': missing,
                'hint': 'Use per-record POST /api/venture/<id> for edits, DELETE /api/venture/<id> for removal, or pass force=true for a full restore.'
            }), 409

        for v in body:
            supabase.table('ventures').upsert({
                'id': v['id'],
                'data': v
            }, on_conflict='id').execute()
        return jsonify({'success': True})
    except Exception as e:
        print(f'Error saving ventures: {e}')
        return jsonify({'success': True, 'note': 'read-only local mode'})


@app.route('/api/venture/<venture_id>', methods=['POST'])
@requires_role('manager', 'admin')
def api_venture_post(venture_id):
    if not supabase:
        return jsonify({'success': True, 'note': 'read-only local mode'})
    try:
        v = request.get_json() or {}
        v['id'] = venture_id
        supabase.table('ventures').upsert({
            'id': venture_id,
            'data': v
        }, on_conflict='id').execute()
        return jsonify({'success': True})
    except Exception as e:
        print(f'Error saving venture {venture_id}: {e}')
        return jsonify({'success': True, 'note': 'read-only local mode'})


@app.route('/api/venture/<venture_id>', methods=['DELETE'])
@requires_role('manager', 'admin')
def api_venture_delete(venture_id):
    if not supabase:
        return jsonify({'success': True, 'note': 'read-only local mode'})
    try:
        supabase.table('ventures').delete().eq('id', venture_id).execute()
        return jsonify({'success': True})
    except Exception as e:
        print(f'Error deleting venture {venture_id}: {e}')
        return jsonify({'success': True, 'note': 'read-only local mode'})


# ========================
# Invoices API
# ========================

@app.route('/api/invoices')
@requires_role('manager', 'admin')
def api_invoices():
    if not supabase:
        fallback = load_json_fallback('invoices.json')
        return jsonify(fallback or [])
    try:
        res = supabase.table('invoices').select('*').execute()
        return jsonify([row['data'] for row in res.data])
    except Exception as e:
        print(f'Error fetching invoices: {e}')
        fallback = load_json_fallback('invoices.json')
        return jsonify(fallback or [])


@app.route('/api/invoice', methods=['POST'])
@requires_role('manager', 'admin')
def api_invoice_post():
    if not supabase:
        return jsonify({'success': True, 'note': 'read-only local mode'})
    try:
        inv = request.get_json() or {}
        supabase.table('invoices').upsert({
            'id': inv['id'],
            'data': inv
        }, on_conflict='id').execute()
        return jsonify({'success': True})
    except Exception as e:
        print(f'Error saving invoice: {e}')
        return jsonify({'success': True, 'note': 'read-only local mode'})


@app.route('/api/invoice/<inv_id>', methods=['DELETE'])
@requires_role('manager', 'admin')
def api_invoice_delete(inv_id):
    if not supabase:
        return jsonify({'success': True, 'note': 'read-only local mode'})
    try:
        supabase.table('invoices').delete().eq('id', inv_id).execute()
        return jsonify({'success': True})
    except Exception as e:
        print(f'Error deleting invoice {inv_id}: {e}')
        return jsonify({'success': True, 'note': 'read-only local mode'})


# ========================
# Purchase Orders API
# ========================

@app.route('/api/pos')
@requires_role('manager', 'admin')
def api_pos():
    if not supabase:
        fallback = load_json_fallback('pos.json')
        return jsonify(fallback or [])
    try:
        res = supabase.table('purchase_orders').select('*').execute()
        return jsonify([row['data'] for row in res.data])
    except Exception as e:
        print(f'Error fetching POs: {e}')
        fallback = load_json_fallback('pos.json')
        return jsonify(fallback or [])


@app.route('/api/po', methods=['POST'])
@requires_role('manager', 'admin')
def api_po_post():
    if not supabase:
        return jsonify({'success': True, 'note': 'read-only local mode'})
    try:
        po = request.get_json() or {}
        supabase.table('purchase_orders').upsert({
            'id': po['id'],
            'data': po
        }, on_conflict='id').execute()
        return jsonify({'success': True})
    except Exception as e:
        print(f'Error saving PO: {e}')
        return jsonify({'success': True, 'note': 'read-only local mode'})


@app.route('/api/po/<po_id>', methods=['DELETE'])
@requires_role('manager', 'admin')
def api_po_delete(po_id):
    if not supabase:
        return jsonify({'success': True, 'note': 'read-only local mode'})
    try:
        supabase.table('purchase_orders').delete().eq('id', po_id).execute()
        return jsonify({'success': True})
    except Exception as e:
        print(f'Error deleting PO {po_id}: {e}')
        return jsonify({'success': True, 'note': 'read-only local mode'})


# ========================
# Vendors API
# ========================

@app.route('/api/vendors')
@login_required
def api_vendors():
    if not supabase:
        fallback = load_json_fallback('vendors.json')
        return jsonify(fallback or [])
    try:
        res = supabase.table('vendors').select('*').execute()
        return jsonify([row['data'] for row in res.data])
    except Exception as e:
        print(f'Error fetching vendors: {e}')
        fallback = load_json_fallback('vendors.json')
        return jsonify(fallback or [])


@app.route('/api/vendor', methods=['POST'])
@requires_role('manager', 'admin')
def api_vendor_post():
    if not supabase:
        return jsonify({'success': True, 'note': 'read-only local mode'})
    try:
        vendor = request.get_json() or {}
        supabase.table('vendors').upsert({
            'id': vendor['id'],
            'data': vendor
        }, on_conflict='id').execute()
        return jsonify({'success': True})
    except Exception as e:
        print(f'Error saving vendor: {e}')
        return jsonify({'success': True, 'note': 'read-only local mode'})


@app.route('/api/vendor/<vendor_id>', methods=['DELETE'])
@requires_role('manager', 'admin')
def api_vendor_delete(vendor_id):
    if not supabase:
        return jsonify({'success': True, 'note': 'read-only local mode'})
    try:
        supabase.table('vendors').delete().eq('id', vendor_id).execute()
        return jsonify({'success': True})
    except Exception as e:
        print(f'Error deleting vendor {vendor_id}: {e}')
        return jsonify({'success': True, 'note': 'read-only local mode'})


# ========================
# Settings API
# ========================

@app.route('/api/settings/<key>')
@login_required
def api_settings_get(key):
    if not supabase:
        return jsonify(None)
    try:
        # Defensive sort: if duplicate rows exist pre-migration, take the latest id.
        res = supabase.table('settings').select('*').eq('key', key).order('id', desc=True).execute()
        if res.data:
            return jsonify(res.data[0]['value'])
        return jsonify(None)
    except Exception as e:
        print(f'Error fetching setting {key}: {e}')
        return jsonify(None)


@app.route('/api/settings/<key>', methods=['POST'])
@requires_role('manager', 'admin')
def api_settings_post(key):
    if not supabase:
        return jsonify({'success': True, 'note': 'read-only local mode'})
    try:
        value = request.get_json()
        supabase.table('settings').upsert({
            'key': key,
            'value': value
        }, on_conflict='key').execute()
        return jsonify({'success': True})
    except Exception as e:
        print(f'Error saving setting {key}: {e}')
        return jsonify({'success': True, 'note': 'read-only local mode'})


# ========================
# Test DB
# ========================

@app.route('/api/test-db')
@login_required
def api_test_db():
    if not supabase:
        return jsonify({'status': 'error', 'error': 'Supabase not configured'}), 500
    try:
        res = supabase.table('cell_data').select('*', count='exact').execute()
        return jsonify({'status': 'connected', 'rows': res.count if hasattr(res, 'count') and res.count is not None else len(res.data)})
    except Exception as e:
        return jsonify({'status': 'error', 'error': str(e)}), 500


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
