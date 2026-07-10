from flask import Flask, render_template, request, jsonify, session, redirect, url_for
import os
import json
import re
import base64
import io
from datetime import timedelta, datetime, date, timezone
from functools import wraps
from dotenv import load_dotenv
from supabase import create_client, Client
from werkzeug.security import check_password_hash, generate_password_hash

try:
    from PIL import Image
except ImportError:  # Pillow may not be installed in every environment
    Image = None

load_dotenv()

IST = timezone(timedelta(hours=5, minutes=30))

def now_ist():
    return datetime.now(IST)

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'vgrand-secret-key-2025')
app.permanent_session_lifetime = timedelta(days=30)
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024

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
            role = user.get('role') if isinstance(user, dict) else 'admin'
            if role not in allowed_roles:
                return jsonify({'error': 'Forbidden'}), 403
            return f(*args, **kwargs)
        return wrapped
    return decorator


def requires_role_or_override(*primary_roles):
    """Like requires_role, but admin and manager always have override access."""
    all_roles = set(primary_roles) | {'admin', 'manager'}
    def decorator(f):
        @wraps(f)
        @login_required
        def wrapped(*args, **kwargs):
            user = session.get('user')
            role = user.get('role') if isinstance(user, dict) else 'admin'
            if role not in all_roles:
                return jsonify({'error': 'Forbidden'}), 403
            return f(*args, **kwargs)
        return wrapped
    return decorator


def compress_image_data_url(data_url, max_size=(1024, 1024), quality=65):
    if Image is None:
        return data_url
    m = re.match(r'^data:image/(jpeg|png|webp);base64,(.*)$', data_url, re.IGNORECASE)
    if not m:
        return data_url
    try:
        raw = base64.b64decode(m.group(2), validate=True)
        img = Image.open(io.BytesIO(raw))
        if img.mode in ('RGBA', 'P'):
            rgb = Image.new('RGB', img.size, (255, 255, 255))
            if img.mode == 'P':
                img = img.convert('RGBA')
            if img.mode == 'RGBA':
                rgb.paste(img, mask=img.split()[3])
            else:
                rgb.paste(img)
            img = rgb
        elif img.mode != 'RGB':
            img = img.convert('RGB')
        img.thumbnail(max_size, Image.Resampling.LANCZOS)
        out = io.BytesIO()
        img.save(out, format='JPEG', quality=quality, optimize=True)
        out.seek(0)
        encoded = base64.b64encode(out.read()).decode('ascii')
        return f'data:image/jpeg;base64,{encoded}'
    except Exception as e:
        app.logger.warning(f'Image compression failed: {e}')
        return data_url


def compress_images_in_data(data):
    if isinstance(data, dict):
        return {k: compress_images_in_data(v) for k, v in data.items()}
    if isinstance(data, list):
        return [compress_images_in_data(v) for v in data]
    if isinstance(data, str) and data.startswith('data:image'):
        return compress_image_data_url(data)
    return data


@app.route('/login', methods=['POST'])
def login():
    data = request.get_json() or {}
    username = data.get('username', '')
    password = data.get('password', '')

    # Authenticate against the Supabase users table only.
    user_obj = None
    if supabase:
        try:
            res = supabase.table('users').select('*').eq('email', username).eq('active', True).execute()
            if res.data:
                row = res.data[0]
                pw_hash = row.get('password_hash', '')
                if pw_hash and check_password_hash(pw_hash, password):
                    user_obj = {'id': row['id'], 'email': row['email'], 'role': row['role'], 'org_id': row.get('org_id')}
        except Exception as e:
            print(f'Error loading user from Supabase: {e}')

    if user_obj:
        session['user'] = user_obj
        session.permanent = True
        return jsonify({'success': True, 'user': user_obj['email'], 'role': user_obj['role']})
    return jsonify({'success': False, 'error': 'Invalid credentials'}), 401


@app.route('/logout', methods=['POST'])
def logout():
    session.pop('user', None)
    session.pop('visitor_user', None)
    session.pop('security_user', None)
    return jsonify({'success': True})


# ============================================================
# OTP Service Abstraction
# ============================================================

def send_otp(mobile, code):
    """Send OTP to a mobile number. Replace this with Twilio/MSG91/etc.
    For development, the code is simply logged."""
    print(f'[OTP] Sending code {code} to {mobile}')
    return True


def generate_otp():
    """Generate a 4-digit OTP. In dev, always 1234."""
    return '1234'


# ============================================================
# Visitor Management API
# ============================================================

@app.route('/api/visitor/resident-login', methods=['POST'])
def visitor_resident_login():
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    body = request.get_json() or {}
    mobile = body.get('mobile', '').strip()
    if not mobile:
        return jsonify({'error': 'Mobile number required'}), 400
    try:
        res = supabase.table('residents').select('*').eq('mobile', mobile).eq('active', True).execute()
        if not res.data:
            return jsonify({'error': 'Resident not found'}), 404
        row = res.data[0]
        session['visitor_user'] = {
            'id': row['id'],
            'name': row['name'],
            'mobile': row['mobile'],
            'block': row['block'],
            'floor': row['floor'],
            'flat': row['flat'],
            'role': 'resident'
        }
        return jsonify({'success': True, 'resident': session['visitor_user']})
    except Exception as e:
        print(f'Error resident login: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/visitor/security-login', methods=['POST'])
def visitor_security_login():
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    body = request.get_json() or {}
    email = body.get('email', '').strip()
    password = body.get('password', '')
    if not email or not password:
        return jsonify({'error': 'Email and password required'}), 400
    try:
        res = supabase.table('security_users').select('*').eq('email', email).eq('active', True).execute()
        if not res.data:
            return jsonify({'error': 'Invalid credentials'}), 401
        row = res.data[0]
        if not check_password_hash(row.get('password_hash', ''), password):
            return jsonify({'error': 'Invalid credentials'}), 401
        session['security_user'] = {
            'id': row['id'],
            'name': row['name'],
            'email': row['email'],
            'role': 'security'
        }
        return jsonify({'success': True, 'security': session['security_user']})
    except Exception as e:
        print(f'Error security login: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/visitor/me')
def visitor_me():
    return jsonify({
        'resident': session.get('visitor_user'),
        'security': session.get('security_user')
    })


@app.route('/api/visitor/resident')
def api_visitor_resident():
    resident = session.get('visitor_user')
    if not resident:
        return jsonify({'error': 'Not logged in'}), 401
    return jsonify(resident)


def visitor_login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user' not in session and 'security_user' not in session and 'visitor_user' not in session:
            return redirect(url_for('login_page'))
        return f(*args, **kwargs)
    return decorated


@app.route('/api/visitor/resident-by-mobile/<mobile>')
@visitor_login_required
def api_visitor_resident_by_mobile(mobile):
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    try:
        res = supabase.table('residents').select('*').eq('mobile', mobile).eq('active', True).execute()
        if not res.data:
            return jsonify(None)
        row = res.data[0]
        return jsonify({
            'id': row['id'],
            'name': row['name'],
            'mobile': row['mobile'],
            'block': row['block'],
            'floor': row['floor'],
            'flat': row['flat']
        })
    except Exception as e:
        print(f'Error fetching resident by mobile: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/visitor/request', methods=['POST'])
@visitor_login_required
def api_visitor_request_create():
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    body = request.get_json() or {}
    required = ['resident_id', 'visitor_name']
    for field in required:
        if field not in body or not body[field]:
            return jsonify({'error': f'{field} is required'}), 400
    try:
        security = session.get('security_user') or session.get('user') or {}
        security_id = security.get('id') if security.get('role') == 'security' else None
        code = generate_otp()
        data = {
            'resident_id': body['resident_id'],
            'security_id': security_id,
            'visitor_name': body['visitor_name'],
            'visitor_mobile': body.get('visitor_mobile', ''),
            'purpose': body.get('purpose', ''),
            'visitor_count': int(body.get('visitor_count', 1) or 1),
            'vehicle_number': body.get('vehicle_number', ''),
            'id_proof_type': body.get('id_proof_type', ''),
            'remarks': body.get('remarks', ''),
            'status': 'waiting',
            'otp_code': code,
            'entry_time': now_ist().isoformat()
        }
        res = supabase.table('visitor_requests').insert(data).execute()
        visitor_id = res.data[0]['id']

        # Get resident mobile to send OTP
        resident_res = supabase.table('residents').select('mobile').eq('id', body['resident_id']).execute()
        mobile = resident_res.data[0]['mobile'] if resident_res.data else ''
        if mobile:
            send_otp(mobile, code)
            supabase.table('otp_log').insert({
                'visitor_id': visitor_id,
                'mobile': mobile,
                'otp_code': code,
                'status': 'pending'
            }).execute()

        return jsonify({'success': True, 'id': visitor_id, 'otp': code})
    except Exception as e:
        print(f'Error creating visitor request: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/visitor/verify-otp', methods=['POST'])
def api_visitor_verify_otp():
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    body = request.get_json() or {}
    visitor_id = body.get('visitor_id')
    mobile = body.get('mobile', '').strip()
    code = body.get('otp', '').strip()
    if not visitor_id or not mobile or not code:
        return jsonify({'error': 'visitor_id, mobile, and otp are required'}), 400
    try:
        # Find the latest pending OTP log
        res = supabase.table('otp_log').select('*').eq('visitor_id', visitor_id).eq('mobile', mobile).order('created_at', desc=True).limit(1).execute()
        if not res.data:
            return jsonify({'error': 'OTP request not found'}), 404
        log = res.data[0]
        if log['status'] != 'pending':
            return jsonify({'error': 'OTP already used or expired'}), 400
        if log['otp_code'] != code:
            return jsonify({'error': 'Invalid OTP'}), 400

        now = now_ist().isoformat()
        supabase.table('otp_log').update({'status': 'verified', 'verified_at': now}).eq('id', log['id']).execute()
        supabase.table('visitor_requests').update({
            'status': 'approved',
            'otp_verified_at': now
        }).eq('id', visitor_id).execute()

        return jsonify({'success': True, 'status': 'approved'})
    except Exception as e:
        print(f'Error verifying OTP: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/visitor/requests')
@visitor_login_required
def api_visitor_requests():
    if not supabase:
        return jsonify([])
    try:
        resident = session.get('visitor_user')
        security = session.get('security_user')
        user = session.get('user')

        query = supabase.table('visitor_requests').select('*, residents(name, mobile, block, floor, flat), security_users(name)')
        if resident:
            query = query.eq('resident_id', resident['id'])
        # Admin/manager/supervisor from main app can see all
        res = query.order('created_at', desc=True).execute()

        rows = []
        for r in res.data or []:
            resident_data = r.get('residents') or {}
            security_data = r.get('security_users') or {}
            rows.append({
                'id': r['id'],
                'resident_id': r['resident_id'],
                'resident_name': resident_data.get('name'),
                'resident_mobile': resident_data.get('mobile'),
                'block': resident_data.get('block'),
                'floor': resident_data.get('floor'),
                'flat': resident_data.get('flat'),
                'security_name': security_data.get('name'),
                'visitor_name': r['visitor_name'],
                'visitor_mobile': r.get('visitor_mobile'),
                'purpose': r.get('purpose'),
                'visitor_count': r.get('visitor_count', 1),
                'vehicle_number': r.get('vehicle_number'),
                'id_proof_type': r.get('id_proof_type'),
                'remarks': r.get('remarks'),
                'status': r.get('status'),
                'entry_time': r.get('entry_time'),
                'exit_time': r.get('exit_time'),
                'created_at': r.get('created_at')
            })
        return jsonify(rows)
    except Exception as e:
        print(f'Error fetching visitor requests: {e}')
        return jsonify([])


@app.route('/api/visitor/request/<req_id>', methods=['PATCH'])
@visitor_login_required
def api_visitor_request_patch(req_id):
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    body = request.get_json() or {}
    allowed = {}
    if 'status' in body and body['status'] in ('waiting','approved','rejected','inside','completed'):
        allowed['status'] = body['status']
        if body['status'] == 'inside':
            allowed['entry_time'] = now_ist().isoformat()
        if body['status'] == 'completed':
            allowed['exit_time'] = now_ist().isoformat()
    if not allowed:
        return jsonify({'error': 'Nothing to update'}), 400
    try:
        supabase.table('visitor_requests').update(allowed).eq('id', req_id).execute()
        return jsonify({'success': True})
    except Exception as e:
        print(f'Error updating visitor request: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/visitor/dashboard-stats')
@visitor_login_required
def api_visitor_dashboard_stats():
    if not supabase:
        return jsonify({})
    try:
        today = now_ist().date().isoformat()
        base = supabase.table('visitor_requests').select('*')
        res = base.execute()
        rows = res.data or []
        today_rows = [r for r in rows if (r.get('created_at') or '').startswith(today)]
        return jsonify({
            'total_today': len(today_rows),
            'pending': len([r for r in rows if r.get('status') == 'waiting']),
            'approved': len([r for r in rows if r.get('status') == 'approved']),
            'rejected': len([r for r in rows if r.get('status') == 'rejected']),
            'inside': len([r for r in rows if r.get('status') == 'inside']),
            'completed': len([r for r in rows if r.get('status') == 'completed'])
        })
    except Exception as e:
        print(f'Error visitor dashboard stats: {e}')
        return jsonify({})


# ============================================================
# Main App Login & Me
# ============================================================

@app.route('/api/me')
def me():
    user = session.get('user')
    if isinstance(user, str):
        # Legacy session from before RBAC
        return jsonify({'user': user, 'role': 'admin'})
    if isinstance(user, dict):
        return jsonify({'user': user.get('email'), 'role': user.get('role', 'supervisor')})
    return jsonify({'user': None, 'role': None})


@app.route('/')
@login_required
def index():
    return render_template('index.html')


@app.route('/login')
def login_page():
    if 'user' in session or 'security_user' in session or 'visitor_user' in session:
        return redirect(url_for('index'))
    return render_template('login.html')


@app.route('/visitor-portal')
def visitor_portal_page():
    if not session.get('security_user') and not session.get('visitor_user') and not session.get('user'):
        return redirect(url_for('login_page'))
    return render_template('visitor_portal.html')


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
        query = supabase.table('cell_data').select('*')
        # Optional filter params for lazy-loading a specific venture/block/floor slice
        venture_id = request.args.get('venture_id')
        block = request.args.get('block')
        floor = request.args.get('floor')
        if venture_id:
            query = query.filter('data->>venture_id', 'eq', venture_id)
        if block:
            query = query.filter('data->>block', 'eq', block)
        if floor:
            query = query.filter('data->>floor', 'eq', str(floor))
        res = query.execute()
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
    body = compress_images_in_data(body)
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
    rows = [{'id': c['id'], 'data': compress_images_in_data(c.get('data', {}))} for c in cells]
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
# Inventory API
# ========================

@app.route('/api/materials')
@login_required
def api_materials():
    if not supabase:
        return jsonify([]), 500
    venture_id = request.args.get('venture_id')
    q = supabase.table('materials').select('*')
    if venture_id:
        q = q.eq('venture_id', venture_id)
    res = q.execute()
    return jsonify(res.data or [])


@app.route('/api/material', methods=['POST'])
@login_required
def api_material_post():
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    m = request.get_json() or {}
    supabase.table('materials').upsert(m, on_conflict='id').execute()
    return jsonify({'success': True})


@app.route('/api/material/<material_id>', methods=['DELETE'])
@login_required
def api_material_delete(material_id):
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    supabase.table('materials').delete().eq('id', material_id).execute()
    return jsonify({'success': True})


@app.route('/api/stock')
@login_required
def api_stock():
    if not supabase:
        return jsonify([]), 500
    q = supabase.table('stock_ledger').select('*')
    for f in ['venture_id', 'material_id', 'entry_type', 'block', 'floor', 'vendor_id']:
        v = request.args.get(f)
        if v:
            q = q.eq(f, v)
    from_date = request.args.get('from')
    to_date = request.args.get('to')
    if from_date:
        q = q.gte('entry_date', from_date)
    if to_date:
        q = q.lte('entry_date', to_date)
    res = q.execute()
    return jsonify(res.data or [])


@app.route('/api/stock', methods=['POST'])
@login_required
def api_stock_post():
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    entry = request.get_json() or {}
    supabase.table('stock_ledger').upsert(entry, on_conflict='id').execute()
    return jsonify({'success': True})


@app.route('/api/stock/summary')
@login_required
def api_stock_summary():
    if not supabase:
        return jsonify([]), 500
    venture_id = request.args.get('venture_id')
    q = supabase.table('stock_balance').select('*')
    if venture_id:
        q = q.eq('venture_id', venture_id)
    res = q.execute()
    return jsonify(res.data or [])


@app.route('/api/stock/location-report')
@login_required
def api_stock_location_report():
    if not supabase:
        return jsonify([]), 500
    venture_id = request.args.get('venture_id')
    material_id = request.args.get('material_id')
    q = supabase.table('stock_ledger').select('*').eq('entry_type', 'OUT')
    if venture_id:
        q = q.eq('venture_id', venture_id)
    if material_id:
        q = q.eq('material_id', material_id)
    res = q.execute()
    return jsonify(res.data or [])


@app.route('/api/stock/vendor-report')
@login_required
def api_stock_vendor_report():
    if not supabase:
        return jsonify([]), 500
    vendor_id = request.args.get('vendor_id')
    venture_id = request.args.get('venture_id')
    q = supabase.table('stock_ledger').select('*').eq('entry_type', 'IN')
    if vendor_id:
        q = q.eq('vendor_id', vendor_id)
    if venture_id:
        q = q.eq('venture_id', venture_id)
    res = q.execute()
    return jsonify(res.data or [])


# ========================
# Cells Reorder API
# ========================

@app.route('/api/cells/reorder', methods=['POST'])
@requires_role_or_override('supervisor')
def api_cells_reorder():
    if not supabase:
        return jsonify({'success': True, 'note': 'read-only local mode'})
    body = request.get_json() or {}
    venture_id = body.get('venture_id')
    work_item = body.get('work_item')
    ordered_ids = body.get('ordered_ids', [])
    if not ordered_ids:
        return jsonify({'success': True})
    try:
        for idx, cid in enumerate(ordered_ids):
            supabase.table('category_sets').update({
                'sort_order': idx
            }).eq('venture_id', venture_id).eq('name', work_item).execute()
        return jsonify({'success': True})
    except Exception as e:
        print(f'Error reordering cells: {e}')
        return jsonify({'error': str(e)}), 500


# ========================
# Category Creation API
# ========================

@app.route('/api/category', methods=['POST'])
@requires_role_or_override('supervisor')
def api_category_create():
    if not supabase:
        return jsonify({'success': True, 'note': 'read-only local mode'})
    body = request.get_json() or {}
    venture_id = body.get('venture_id')
    name = body.get('name', '').strip()
    if not name or not venture_id:
        return jsonify({'error': 'venture_id and name are required'}), 400
    try:
        # Get org_id from venture
        vres = supabase.table('ventures').select('*').eq('id', venture_id).execute()
        org_id = None
        if vres.data:
            org_id = (vres.data[0].get('data') or {}).get('org_id')
        # Get max sort_order
        existing = supabase.table('category_sets').select('sort_order').eq(
            'venture_id', venture_id).eq('category_type', 'work_group').order(
            'sort_order', desc=True).limit(1).execute()
        next_order = (existing.data[0]['sort_order'] + 1) if existing.data else 0
        res = supabase.table('category_sets').insert({
            'org_id': org_id or '11111111-1111-1111-1111-111111111111',
            'venture_id': venture_id,
            'category_type': 'work_group',
            'name': name,
            'sort_order': next_order
        }).execute()
        return jsonify({'success': True, 'id': res.data[0]['id'] if res.data else None})
    except Exception as e:
        print(f'Error creating category: {e}')
        return jsonify({'error': str(e)}), 500


# ========================
# Instant Reports API (Admin-only)
# ========================

@app.route('/api/reports/instant')
@requires_role('admin')
def api_instant_reports():
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    venture_id = request.args.get('venture_id')
    if not venture_id:
        return jsonify({'error': 'venture_id is required'}), 400
    try:
        result = {'venture_id': venture_id, 'blocks': [], 'spend': {}, 'consumption': []}
        # Cell status summary: % complete per block/floor
        cells_res = supabase.table('cell_data').select('*').execute()
        cell_stats = {}
        for row in cells_res.data:
            d = row.get('data') or {}
            v_id = d.get('venture_id')
            if v_id != venture_id:
                continue
            block = d.get('block', 'Unknown')
            floor = d.get('floor', 'Unknown')
            color = d.get('color', '')
            key = f'{block}|{floor}'
            if key not in cell_stats:
                cell_stats[key] = {'total': 0, 'completed': 0}
            cell_stats[key]['total'] += 1
            if color == 'green':
                cell_stats[key]['completed'] += 1
        for key, stats in cell_stats.items():
            block, floor = key.split('|')
            pct = round((stats['completed'] / stats['total'] * 100), 1) if stats['total'] else 0
            result['blocks'].append({
                'block': block, 'floor': floor,
                'total': stats['total'], 'completed': stats['completed'],
                'pct_complete': pct
            })
        # Spend from invoices
        inv_res = supabase.table('invoices').select('*').execute()
        total_invoice = 0
        for inv in inv_res.data:
            d = inv.get('data') or {}
            if d.get('venture_id') == venture_id or inv.get('venture_id') == venture_id:
                amt = d.get('amount') or inv.get('amount') or 0
                total_invoice += float(amt)
        result['spend']['invoices'] = round(total_invoice, 2)
        # Spend from POs
        po_res = supabase.table('purchase_orders').select('*').execute()
        total_po = 0
        for po in po_res.data:
            d = po.get('data') or {}
            if d.get('venture_id') == venture_id or po.get('venture_id') == venture_id:
                amt = d.get('billAmount') or d.get('quotedAmount') or po.get('amount') or 0
                total_po += float(amt)
        result['spend']['purchase_orders'] = round(total_po, 2)
        # Consumption from stock_ledger
        stock_res = supabase.table('stock_ledger').select('*').eq('venture_id', venture_id).execute()
        consumption = {}
        for entry in stock_res.data:
            if entry.get('entry_type') == 'OUT':
                mid = entry.get('material_id', 'unknown')
                if mid not in consumption:
                    consumption[mid] = {'material_id': mid, 'total_qty': 0}
                consumption[mid]['total_qty'] += float(entry.get('qty', 0))
        result['consumption'] = list(consumption.values())
        return jsonify(result)
    except Exception as e:
        print(f'Error generating instant reports: {e}')
        return jsonify({'error': str(e)}), 500


# ========================
# Payroll API (Admin-only for release; Manager can view)
# ========================

@app.route('/api/payroll')
@requires_role_or_override('supervisor')
def api_payroll_list():
    if not supabase:
        return jsonify([]), 500
    venture_id = request.args.get('venture_id')
    q = supabase.table('payroll').select('*, milestones(id,status,work_item,description)')
    if venture_id:
        q = q.eq('venture_id', venture_id)
    res = q.execute()
    return jsonify(res.data or [])


@app.route('/api/payroll', methods=['POST'])
@requires_role('admin')
def api_payroll_create():
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    body = request.get_json() or {}
    user = session.get('user', {})
    try:
        row = {
            'venture_id': body.get('venture_id'),
            'subcontractor_id': body.get('subcontractor_id'),
            'milestone_id': body.get('milestone_id'),
            'amount': body.get('amount', 0),
            'status': 'pending',
            'created_by': user.get('id') if isinstance(user, dict) else None,
        }
        res = supabase.table('payroll').insert(row).execute()
        return jsonify({'success': True, 'id': res.data[0]['id'] if res.data else None})
    except Exception as e:
        print(f'Error creating payroll: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/payroll/<payroll_id>/release', methods=['POST'])
@requires_role('admin')
def api_payroll_release(payroll_id):
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    try:
        supabase.table('payroll').update({
            'status': 'unlocked',
            'updated_at': datetime.utcnow().isoformat()
        }).eq('id', payroll_id).execute()
        return jsonify({'success': True})
    except Exception as e:
        err_msg = str(e)
        # Surface the Postgres trigger's exception message directly
        if 'Cannot unlock payroll' in err_msg:
            return jsonify({'error': err_msg}), 400
        print(f'Error releasing payroll {payroll_id}: {e}')
        return jsonify({'error': err_msg}), 500


# ========================
# Inventory Audit API (Admin-only)
# ========================

@app.route('/api/inventory/audit')
@requires_role('admin')
def api_inventory_audit():
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    venture_id = request.args.get('venture_id')
    if not venture_id:
        return jsonify({'error': 'venture_id is required'}), 400
    try:
        # Get all materials for this venture
        mats_res = supabase.table('materials').select('*').eq('venture_id', venture_id).execute()
        materials = mats_res.data or []
        # Get stock balances
        bal_res = supabase.table('stock_balance').select('*').eq('venture_id', venture_id).execute()
        balances = {b['material_id']: b for b in (bal_res.data or [])}
        # Get PO line items
        po_li_res = supabase.table('po_line_items').select('*').eq('venture_id', venture_id).execute()
        po_items = po_li_res.data or []
        ordered_qty = {}
        for li in po_items:
            mid = li.get('material_id', 'unknown')
            ordered_qty[mid] = ordered_qty.get(mid, 0) + float(li.get('qty', 0))
        # Build audit rows
        audit_rows = []
        for mat in materials:
            mid = mat['id']
            bal = balances.get(mid, {})
            received = float(bal.get('total_in', 0))
            consumed = float(bal.get('total_out', 0))
            expected_remaining = received - consumed
            actual_balance = float(bal.get('balance', 0))
            tolerance = float(mat.get('min_threshold', 0)) * 0.1  # 10% of min_threshold
            discrepancy = abs(expected_remaining - actual_balance) > max(tolerance, 0.01)
            short_delivery = ordered_qty.get(mid, 0) - received
            audit_rows.append({
                'material_id': mid,
                'material_name': mat.get('name', mid),
                'unit': mat.get('unit', ''),
                'ordered_qty': round(ordered_qty.get(mid, 0), 2),
                'received_qty': round(received, 2),
                'consumed_qty': round(consumed, 2),
                'expected_remaining': round(expected_remaining, 2),
                'actual_balance': round(actual_balance, 2),
                'short_delivery': round(short_delivery, 2),
                'discrepancy_flag': discrepancy,
                'linked_work_item': mat.get('linked_work_item')
            })
        return jsonify(audit_rows)
    except Exception as e:
        print(f'Error in inventory audit: {e}')
        return jsonify({'error': str(e)}), 500


# ========================
# Date-wise Expense Check API (Admin-only)
# ========================

@app.route('/api/expenses/date-check')
@requires_role('admin')
def api_expenses_date_check():
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    venture_id = request.args.get('venture_id')
    from_date = request.args.get('from')
    to_date = request.args.get('to')
    if not venture_id or not from_date or not to_date:
        return jsonify({'error': 'venture_id, from, and to are required'}), 400
    try:
        # Sum invoices by day
        inv_res = supabase.table('invoices').select('*').execute()
        daily_spend = {}
        for inv in inv_res.data:
            d = inv.get('data') or {}
            v_id = d.get('venture_id') or inv.get('venture_id')
            if v_id != venture_id:
                continue
            inv_date = d.get('date') or inv.get('due_date')
            if not inv_date:
                continue
            amt = float(d.get('amount', 0) or inv.get('amount', 0) or 0)
            day = inv_date[:10]
            daily_spend[day] = daily_spend.get(day, 0) + amt
        # Sum stock_ledger OUT entries by day (valued via material rate)
        stock_res = supabase.table('stock_ledger').select('*').eq(
            'venture_id', venture_id).eq('entry_type', 'OUT').execute()
        for entry in stock_res.data:
            entry_day = entry.get('entry_date', '')[:10]
            if not entry_day:
                continue
            rate = float(entry.get('rate', 0) or 0)
            qty = float(entry.get('qty', 0) or 0)
            daily_spend[entry_day] = daily_spend.get(entry_day, 0) + (rate * qty)
        # Build date range
        start = datetime.strptime(from_date, '%Y-%m-%d').date()
        end = datetime.strptime(to_date, '%Y-%m-%d').date()
        result = []
        current = start
        while current <= end:
            day_str = current.isoformat()
            result.append({
                'date': day_str,
                'amount': round(daily_spend.get(day_str, 0), 2)
            })
            current += timedelta(days=1)
        return jsonify(result)
    except Exception as e:
        print(f'Error in date-check expenses: {e}')
        return jsonify({'error': str(e)}), 500


# ========================
# Expenditure API
# ========================

@app.route('/api/expenditures')
@login_required
def api_expenditures():
    if not supabase:
        return jsonify([])
    venture_id = request.args.get('venture_id')
    try:
        if venture_id:
            res = supabase.table('expenditures').select('*').eq('venture_id', venture_id).order('created_at', desc=True).execute()
        else:
            res = supabase.table('expenditures').select('*').order('created_at', desc=True).execute()
        rows = []
        for r in res.data or []:
            data = r.get('data') or {}
            data['id'] = r['id']
            data['created_by'] = r.get('created_by')
            data['created_at'] = r.get('created_at')
            rows.append(data)
        return jsonify(rows)
    except Exception as e:
        print(f'Error fetching expenditures: {e}')
        return jsonify([])


@app.route('/api/expenditure', methods=['POST'])
@login_required
def api_expenditure_post():
    if not supabase:
        return jsonify({'success': True, 'note': 'read-only local mode'})
    body = request.get_json() or {}
    required = ['venture_id', 'paid_to', 'amount', 'reason', 'date']
    for field in required:
        if field not in body or body[field] in (None, ''):
            return jsonify({'error': f'{field} is required'}), 400
    try:
        entry = {
            'venture_id': body['venture_id'],
            'paid_to': body['paid_to'],
            'amount': float(body['amount']),
            'reason': body['reason'],
            'approved_by': body.get('approved_by', ''),
            'date': body['date']
        }
        user = session.get('user')
        created_by = user.get('email') if isinstance(user, dict) else user
        res = supabase.table('expenditures').insert({
            'venture_id': entry['venture_id'],
            'data': entry,
            'created_by': created_by
        }).execute()
        return jsonify({'success': True, 'id': res.data[0]['id'] if res.data else None})
    except Exception as e:
        print(f'Error creating expenditure: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/expenditure/<exp_id>', methods=['DELETE'])
@login_required
def api_expenditure_delete(exp_id):
    if not supabase:
        return jsonify({'success': True, 'note': 'read-only local mode'})
    try:
        supabase.table('expenditures').delete().eq('id', exp_id).execute()
        return jsonify({'success': True})
    except Exception as e:
        print(f'Error deleting expenditure: {e}')
        return jsonify({'error': str(e)}), 500


# ========================
# Material Leakage Check API
# ========================

@app.route('/api/materials/leakage-check')
@requires_role_or_override('supervisor')
def api_materials_leakage_check():
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    venture_id = request.args.get('venture_id')
    if not venture_id:
        return jsonify({'error': 'venture_id is required'}), 400
    try:
        # Materials
        mats_res = supabase.table('materials').select('*').eq('venture_id', venture_id).execute()
        materials = mats_res.data or []
        # Stock balances
        bal_res = supabase.table('stock_balance').select('*').eq('venture_id', venture_id).execute()
        balances = {b['material_id']: b for b in (bal_res.data or [])}
        # PO line items for ordered qty
        po_li_res = supabase.table('po_line_items').select('*').eq('venture_id', venture_id).execute()
        po_items = po_li_res.data or []
        ordered_qty = {}
        for li in po_items:
            mid = li.get('material_id', 'unknown')
            ordered_qty[mid] = ordered_qty.get(mid, 0) + float(li.get('qty', 0))
        # Stock ledger for received and consumed
        stock_res = supabase.table('stock_ledger').select('*').eq('venture_id', venture_id).execute()
        received_qty = {}
        consumed_qty = {}
        for entry in stock_res.data:
            mid = entry.get('material_id', 'unknown')
            if entry.get('entry_type') == 'IN':
                received_qty[mid] = received_qty.get(mid, 0) + float(entry.get('qty', 0))
            elif entry.get('entry_type') == 'OUT':
                consumed_qty[mid] = consumed_qty.get(mid, 0) + float(entry.get('qty', 0))
        # Build result
        rows = []
        for mat in materials:
            mid = mat['id']
            bal = balances.get(mid, {})
            received = received_qty.get(mid, 0)
            consumed = consumed_qty.get(mid, 0)
            ordered = ordered_qty.get(mid, 0)
            expected_remaining = received - consumed
            actual_balance = float(bal.get('balance', 0))
            tolerance = float(mat.get('min_threshold', 0)) * 0.1
            discrepancy = abs(expected_remaining - actual_balance) > max(tolerance, 0.01)
            short_delivery = ordered - received
            rows.append({
                'material_id': mid,
                'material_name': mat.get('name', mid),
                'unit': mat.get('unit', ''),
                'ordered_qty': round(ordered, 2),
                'received_qty': round(received, 2),
                'consumed_qty': round(consumed, 2),
                'expected_remaining': round(expected_remaining, 2),
                'actual_balance': round(actual_balance, 2),
                'short_delivery': round(short_delivery, 2),
                'discrepancy_flag': discrepancy,
                'short_delivery_flag': short_delivery > max(tolerance, 0.01),
                'linked_work_item': mat.get('linked_work_item')
            })
        return jsonify(rows)
    except Exception as e:
        print(f'Error in material leakage check: {e}')
        return jsonify({'error': str(e)}), 500


# ========================
# Milestone API
# ========================

@app.route('/api/milestone', methods=['POST'])
@requires_role_or_override('supervisor')
def api_milestone_create():
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    body = request.get_json() or {}
    user = session.get('user', {})
    try:
        row = {
            'venture_id': body.get('venture_id'),
            'subcontractor_id': body.get('subcontractor_id'),
            'work_item': body.get('work_item'),
            'block': body.get('block'),
            'floor': body.get('floor'),
            'flat': body.get('flat'),
            'description': body.get('description', ''),
            'required_photo_pair': body.get('required_photo_pair', True),
            'status': 'pending',
        }
        res = supabase.table('milestones').insert(row).execute()
        return jsonify({'success': True, 'id': res.data[0]['id'] if res.data else None})
    except Exception as e:
        print(f'Error creating milestone: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/milestone/<milestone_id>/photo', methods=['POST'])
@requires_role_or_override('supervisor')
def api_milestone_photo(milestone_id):
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    body = request.get_json() or {}
    photo_type = body.get('photo_type')  # 'before' or 'after'
    photo_url = body.get('photo_url')
    taken_at = body.get('taken_at')
    user = session.get('user', {})
    if photo_type not in ('before', 'after'):
        return jsonify({'error': 'photo_type must be before or after'}), 400
    if not photo_url:
        return jsonify({'error': 'photo_url is required'}), 400
    try:
        res = supabase.table('milestone_photos').insert({
            'milestone_id': milestone_id,
            'photo_type': photo_type,
            'photo_url': photo_url,
            'taken_at': taken_at,
            'uploaded_by': user.get('id') if isinstance(user, dict) else None,
        }).execute()
        return jsonify({'success': True, 'id': res.data[0]['id'] if res.data else None})
    except Exception as e:
        print(f'Error uploading milestone photo: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/milestone/<milestone_id>/submit', methods=['POST'])
@requires_role_or_override('supervisor')
def api_milestone_submit(milestone_id):
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    user = session.get('user', {})
    try:
        # Check both before and after photos exist
        photos_res = supabase.table('milestone_photos').select('*').eq(
            'milestone_id', milestone_id).execute()
        photos = photos_res.data or []
        has_before = any(p.get('photo_type') == 'before' for p in photos)
        has_after = any(p.get('photo_type') == 'after' for p in photos)
        if not has_before or not has_after:
            return jsonify({'error': 'Both before and after photos are required before submission'}), 400
        supabase.table('milestones').update({
            'status': 'submitted',
            'submitted_by': user.get('id') if isinstance(user, dict) else None,
            'submitted_at': datetime.utcnow().isoformat()
        }).eq('id', milestone_id).execute()
        return jsonify({'success': True})
    except Exception as e:
        print(f'Error submitting milestone: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/milestone/<milestone_id>/verify', methods=['POST'])
@requires_role('admin')
def api_milestone_verify(milestone_id):
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    user = session.get('user', {})
    try:
        supabase.table('milestones').update({
            'status': 'verified',
            'verified_by': user.get('id') if isinstance(user, dict) else None,
            'verified_at': datetime.utcnow().isoformat()
        }).eq('id', milestone_id).execute()
        return jsonify({'success': True})
    except Exception as e:
        print(f'Error verifying milestone: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/milestone/<milestone_id>/reject', methods=['POST'])
@requires_role('admin')
def api_milestone_reject(milestone_id):
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    try:
        supabase.table('milestones').update({
            'status': 'rejected'
        }).eq('id', milestone_id).execute()
        return jsonify({'success': True})
    except Exception as e:
        print(f'Error rejecting milestone: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/milestones')
@requires_role_or_override('supervisor')
def api_milestones_list():
    if not supabase:
        return jsonify([]), 500
    venture_id = request.args.get('venture_id')
    status = request.args.get('status')
    q = supabase.table('milestones').select('*, milestone_photos(*)')
    if venture_id:
        q = q.eq('venture_id', venture_id)
    if status:
        q = q.eq('status', status)
    res = q.execute()
    return jsonify(res.data or [])


# ========================
# Budgets & Burn Report API (Admin-only)
# ========================

@app.route('/api/budgets', methods=['GET', 'POST'])
@requires_role('admin')
def api_budgets():
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    if request.method == 'GET':
        venture_id = request.args.get('venture_id')
        q = supabase.table('budgets').select('*')
        if venture_id:
            q = q.eq('venture_id', venture_id)
        res = q.execute()
        return jsonify(res.data or [])
    else:
        body = request.get_json() or {}
        user = session.get('user', {})
        try:
            row = {
                'venture_id': body.get('venture_id'),
                'budget_date': body.get('budget_date'),
                'daily_budget': body.get('daily_budget', 0),
                'interval': body.get('interval', 'daily'),
                'created_by': user.get('id') if isinstance(user, dict) else None,
            }
            res = supabase.table('budgets').insert(row).execute()
            return jsonify({'success': True, 'id': res.data[0]['id'] if res.data else None})
        except Exception as e:
            print(f'Error saving budget: {e}')
            return jsonify({'error': str(e)}), 500


@app.route('/api/budgets/burn-report')
@requires_role('admin')
def api_budgets_burn_report():
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    venture_id = request.args.get('venture_id')
    from_date = request.args.get('from')
    to_date = request.args.get('to')
    if not venture_id or not from_date or not to_date:
        return jsonify({'error': 'venture_id, from, and to are required'}), 400
    try:
        # Get budgets for this venture
        budget_res = supabase.table('budgets').select('*').eq('venture_id', venture_id).execute()
        budgets = budget_res.data or []
        # Build daily budget map (expand weekly into 7 days)
        daily_budget_map = {}
        for b in budgets:
            bdate = b.get('budget_date', '')[:10]
            amt = float(b.get('daily_budget', 0))
            if b.get('interval') == 'weekly':
                for i in range(7):
                    d = (datetime.strptime(bdate, '%Y-%m-%d').date() + timedelta(days=i)).isoformat()
                    daily_budget_map[d] = daily_budget_map.get(d, 0) + amt
            else:
                daily_budget_map[bdate] = daily_budget_map.get(bdate, 0) + amt
        # Actual spend: invoices + stock_ledger IN
        inv_res = supabase.table('invoices').select('*').execute()
        daily_spend = {}
        for inv in inv_res.data:
            d = inv.get('data') or {}
            v_id = d.get('venture_id') or inv.get('venture_id')
            if v_id != venture_id:
                continue
            inv_date = d.get('date') or inv.get('due_date')
            if not inv_date:
                continue
            amt = float(d.get('amount', 0) or inv.get('amount', 0) or 0)
            day = inv_date[:10]
            daily_spend[day] = daily_spend.get(day, 0) + amt
        stock_res = supabase.table('stock_ledger').select('*').eq(
            'venture_id', venture_id).eq('entry_type', 'IN').execute()
        for entry in stock_res.data:
            entry_day = entry.get('entry_date', '')[:10]
            if not entry_day:
                continue
            amt = float(entry.get('amount', 0) or 0)
            daily_spend[entry_day] = daily_spend.get(entry_day, 0) + amt
        # Build date range
        start = datetime.strptime(from_date, '%Y-%m-%d').date()
        end = datetime.strptime(to_date, '%Y-%m-%d').date()
        result = []
        mtd_budget = 0
        mtd_actual = 0
        current = start
        while current <= end:
            day_str = current.isoformat()
            budget = daily_budget_map.get(day_str, 0)
            actual = daily_spend.get(day_str, 0)
            variance = budget - actual
            variance_pct = round((variance / budget * 100), 1) if budget else 0
            result.append({
                'date': day_str,
                'budget': round(budget, 2),
                'actual': round(actual, 2),
                'variance': round(variance, 2),
                'variance_pct': variance_pct
            })
            mtd_budget += budget
            mtd_actual += actual
            current += timedelta(days=1)
        return jsonify({
            'days': result,
            'mtd_budget': round(mtd_budget, 2),
            'mtd_actual': round(mtd_actual, 2),
            'mtd_variance': round(mtd_budget - mtd_actual, 2)
        })
    except Exception as e:
        print(f'Error generating burn report: {e}')
        return jsonify({'error': str(e)}), 500


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
