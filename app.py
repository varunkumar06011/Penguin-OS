from flask import Flask, render_template, request, jsonify, session, redirect, url_for
import os
from functools import wraps
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'vgrand-secret-key-2025')

SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SUPABASE_ANON_KEY = os.environ.get('SUPABASE_ANON_KEY', '')

supabase: Client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY) if SUPABASE_URL and SUPABASE_ANON_KEY else None

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


@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    username = data.get('username', '')
    password = data.get('password', '')

    if username == DEMO_USERNAME and password == DEMO_PASSWORD:
        session['user'] = username
        return jsonify({'success': True, 'user': username})
    return jsonify({'success': False, 'error': 'Invalid credentials'}), 401


@app.route('/logout', methods=['POST'])
def logout():
    session.pop('user', None)
    return jsonify({'success': True})


@app.route('/api/me')
def me():
    if 'user' in session:
        return jsonify({'user': session['user']})
    return jsonify({'user': None})


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
        return jsonify({}), 500
    res = supabase.table('cell_data').select('*').execute()
    data = {}
    for row in res.data:
        merged = {**(row.get('data') or {})}
        merged['id'] = row['id']
        data[row['id']] = merged
    return jsonify(data)


@app.route('/api/cell/<cell_id>')
@login_required
def api_cell(cell_id):
    if not supabase:
        return jsonify({}), 500
    res = supabase.table('cell_data').select('*').eq('id', cell_id).execute()
    if res.data:
        row = res.data[0]
        merged = {**(row.get('data') or {})}
        merged['id'] = row['id']
        return jsonify(merged)
    return jsonify({}), 404


@app.route('/api/cell/<cell_id>', methods=['POST'])
@login_required
def api_cell_post(cell_id):
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    body = request.get_json() or {}
    try:
        supabase.table('cell_data').upsert({
            'id': cell_id,
            'data': body
        }).execute()
        return jsonify({'success': True})
    except Exception as e:
        print(f'Error saving cell {cell_id}: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/cells/batch', methods=['POST'])
@login_required
def api_cells_batch():
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    body = request.get_json() or {}
    cells = body.get('cells', [])
    if not cells:
        return jsonify({'success': True})
    rows = [{'id': c['id'], 'data': c.get('data', {})} for c in cells]
    try:
        supabase.table('cell_data').upsert(rows).execute()
        return jsonify({'success': True, 'count': len(rows)})
    except Exception as e:
        print(f'Error in batch upsert: {e}')
        return jsonify({'error': str(e)}), 500


# ========================
# Ventures API
# ========================

@app.route('/api/ventures')
@login_required
def api_ventures():
    if not supabase:
        return jsonify([]), 500
    res = supabase.table('ventures').select('*').execute()
    return jsonify([row['data'] for row in res.data])


@app.route('/api/ventures', methods=['POST'])
@login_required
def api_ventures_post():
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    body = request.get_json() or []
    for v in body:
        supabase.table('ventures').upsert({
            'id': v['id'],
            'data': v
        }).execute()
    return jsonify({'success': True})


@app.route('/api/venture/<venture_id>', methods=['DELETE'])
@login_required
def api_venture_delete(venture_id):
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    supabase.table('ventures').delete().eq('id', venture_id).execute()
    return jsonify({'success': True})


# ========================
# Invoices API
# ========================

@app.route('/api/invoices')
@login_required
def api_invoices():
    if not supabase:
        return jsonify([]), 500
    res = supabase.table('invoices').select('*').execute()
    return jsonify([row['data'] for row in res.data])


@app.route('/api/invoice', methods=['POST'])
@login_required
def api_invoice_post():
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    inv = request.get_json() or {}
    supabase.table('invoices').upsert({
        'id': inv['id'],
        'data': inv
    }).execute()
    return jsonify({'success': True})


@app.route('/api/invoice/<inv_id>', methods=['DELETE'])
@login_required
def api_invoice_delete(inv_id):
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    supabase.table('invoices').delete().eq('id', inv_id).execute()
    return jsonify({'success': True})


# ========================
# Purchase Orders API
# ========================

@app.route('/api/pos')
@login_required
def api_pos():
    if not supabase:
        return jsonify([]), 500
    res = supabase.table('purchase_orders').select('*').execute()
    return jsonify([row['data'] for row in res.data])


@app.route('/api/po', methods=['POST'])
@login_required
def api_po_post():
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    po = request.get_json() or {}
    supabase.table('purchase_orders').upsert({
        'id': po['id'],
        'data': po
    }).execute()
    return jsonify({'success': True})


@app.route('/api/po/<po_id>', methods=['DELETE'])
@login_required
def api_po_delete(po_id):
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    supabase.table('purchase_orders').delete().eq('id', po_id).execute()
    return jsonify({'success': True})


# ========================
# Vendors API
# ========================

@app.route('/api/vendors')
@login_required
def api_vendors():
    if not supabase:
        return jsonify([]), 500
    res = supabase.table('vendors').select('*').execute()
    return jsonify([row['data'] for row in res.data])


@app.route('/api/vendor', methods=['POST'])
@login_required
def api_vendor_post():
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    vendor = request.get_json() or {}
    supabase.table('vendors').upsert({
        'id': vendor['id'],
        'data': vendor
    }).execute()
    return jsonify({'success': True})


@app.route('/api/vendor/<vendor_id>', methods=['DELETE'])
@login_required
def api_vendor_delete(vendor_id):
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    supabase.table('vendors').delete().eq('id', vendor_id).execute()
    return jsonify({'success': True})


# ========================
# Settings API
# ========================

@app.route('/api/settings/<key>')
@login_required
def api_settings_get(key):
    if not supabase:
        return jsonify(None), 500
    res = supabase.table('settings').select('*').eq('key', key).execute()
    if res.data:
        return jsonify(res.data[0]['value'])
    return jsonify(None)


@app.route('/api/settings/<key>', methods=['POST'])
@login_required
def api_settings_post(key):
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    value = request.get_json()
    supabase.table('settings').upsert({
        'key': key,
        'value': value
    }).execute()
    return jsonify({'success': True})


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
