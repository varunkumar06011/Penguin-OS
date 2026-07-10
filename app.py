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

# --- Pollinations AI (Feature 1: interior design) ---
POLLINATIONS_API_TOKEN = os.environ.get('POLLINATIONS_API_TOKEN', '')


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


def get_or_create_storage_bucket(bucket_name):
    """Ensure a Supabase Storage bucket exists. Returns True on success."""
    if not supabase:
        return False
    try:
        buckets = supabase.storage.list_buckets()
        if any(b.get('name') == bucket_name or b.name == bucket_name for b in buckets):
            return True
        supabase.storage.create_bucket(bucket_name, bucket_name, {'public': True})
        return True
    except Exception as e:
        app.logger.warning(f'Bucket check/create failed for {bucket_name}: {e}')
        return False


def upload_bytes_to_storage(bucket_name, path, data, content_type='application/octet-stream'):
    """Upload bytes to Supabase Storage and return the public URL, or (None, error) on failure."""
    if not supabase:
        return None, 'Supabase not connected'
    try:
        bucket_ok = get_or_create_storage_bucket(bucket_name)
        if not bucket_ok:
            # Bucket may already exist but list/create failed; still try upload.
            pass
        supabase.storage.from_(bucket_name).upload(path, data, {'content-type': content_type})
        url = supabase.storage.from_(bucket_name).get_public_url(path)
        return url, None
    except Exception as e:
        err = str(e)
        app.logger.warning(f'Upload to {bucket_name}/{path} failed: {err}')
        return None, err


def _get_public_image_url(bucket_name, path):
    """Return Supabase public URL for a storage path."""
    if not supabase:
        return None
    try:
        return supabase.storage.from_(bucket_name).get_public_url(path)
    except Exception as e:
        app.logger.warning(f'Public URL failed for {bucket_name}/{path}: {e}')
        return None


def _get_signed_image_url(bucket_name, path, expires_in=3600):
    """Return a signed URL for a private storage object."""
    if not supabase:
        return None
    try:
        res = supabase.storage.from_(bucket_name).create_signed_url(path, expires_in)
        return res.get('signedURL') if isinstance(res, dict) else res
    except Exception as e:
        app.logger.warning(f'Signed URL failed for {bucket_name}/{path}: {e}')
        return None


def _is_url_accessible(url, timeout=10):
    """Check that a URL is reachable over HTTP(S). Pollinations needs this."""
    if not url or url.startswith('data:'):
        return False
    import requests
    try:
        r = requests.head(url, timeout=timeout, allow_redirects=True)
        if r.status_code < 400:
            return True
    except Exception:
        pass
    try:
        r = requests.get(url, timeout=timeout, stream=True)
        r.close()
        return r.status_code < 400
    except Exception:
        return False
    return False


def get_fetchable_image_url(bucket_name, path, expiry=3600):
    """Return a URL Pollinations can fetch: public URL if reachable, else signed URL."""
    public_url = _get_public_image_url(bucket_name, path)
    if public_url and _is_url_accessible(public_url):
        return public_url
    signed_url = _get_signed_image_url(bucket_name, path, expiry)
    if signed_url and _is_url_accessible(signed_url):
        return signed_url
    return None


def enhance_design_prompt(room_type, style, budget_tier, area_sqft=120):
    """
    Uses GLM (via Pollinations text API) to turn simple selections into a rich
    kontext editing instruction. Falls back to a detailed template if GLM fails —
    never let a text-generation hiccup block image generation.
    """
    import requests

    budget_materials = {
        'economy': {
            'Living Room': 'laminate flooring, budget fabric sofa, simple TV unit, basic curtains',
            'Bedroom': 'vinyl flooring, engineered-wood bed frame, budget wardrobe, simple bedding',
            'Kitchen': 'laminate cabinets, granite-look countertop, basic chimney, SS sink',
            'Bathroom': 'ceramic wall tiles, PVC vanity, budget sanitaryware, simple mirror',
            'Dining Room': 'engineered wood dining table, basic upholstered chairs, simple pendant light',
            'Home Office': 'laminate desk, basic ergonomic chair, open shelves, task lamp',
            'Balcony': 'outdoor tiles, plastic/wooden planters, basic outdoor seating',
        },
        'mid-range': {
            'Living Room': 'engineered wood flooring, sectional sofa, built-in TV unit, designer curtains',
            'Bedroom': 'engineered wood flooring, upholstered bed, modular wardrobe, premium bedding',
            'Kitchen': 'acrylic cabinets, quartz countertop, branded chimney, SS appliances',
            'Bathroom': 'vitrified wall tiles, ceramic vanity, branded sanitaryware, LED mirror',
            'Dining Room': 'solid wood dining table, upholstered chairs, modern chandelier',
            'Home Office': 'wooden desk, ergonomic chair, closed cabinets, ambient lighting',
            'Balcony': 'wooden deck tiles, metal planters, weather-resistant lounge seating',
        },
        'premium': {
            'Living Room': 'Italian marble flooring, designer leather sofa, custom TV wall, smart lighting',
            'Bedroom': 'Italian marble flooring, luxury upholstered bed, walk-in wardrobe, silk bedding',
            'Kitchen': 'high-gloss modular cabinets, quartzite countertop, built-in oven, chimney hob',
            'Bathroom': 'imported marble tiles, designer vanity, premium sanitaryware, rainfall shower',
            'Dining Room': 'imported marble flooring, designer dining set, statement chandelier, artwork',
            'Home Office': 'executive wooden desk, leather chair, custom library, designer lighting',
            'Balcony': 'premium deck tiles, designer planters, outdoor sofa set, ambient lights',
        },
    }
    materials = budget_materials.get(budget_tier.lower(), budget_materials['mid-range']).get(room_type, 'mid-range furnishings')

    style_directive = {
        'Modern': 'clean lines, minimal ornamentation, neutral palette with bold accents',
        'Minimalist': 'very sparse, white and wood tones, hidden storage, no clutter',
        'Traditional': 'classic carved wood, warm colors, ornate details, rich textiles',
        'Luxury': 'rich materials, gold/brass accents, plush textures, statement pieces',
        'Industrial': 'exposed brick/metal, Edison bulbs, raw wood, loft aesthetic',
        'Scandinavian': 'light wood, white walls, cozy textiles, functional furniture',
        'Contemporary': 'mixed textures, curved forms, muted colors, art-forward',
    }.get(style, 'modern interior design')

    fallback = (
        f"interior design renovation of the same {room_type} photograph, approximately {area_sqft} sqft, "
        f"preserve the exact camera angle, room proportions, wall positions, window placements, and ceiling height, "
        f"apply a {style} look with {style_directive}, "
        f"use {materials} suitable for a {budget_tier} budget, "
        f"photorealistic 3D render, consistent daylight, same viewpoint"
    )

    if not POLLINATIONS_API_TOKEN:
        return fallback

    system_prompt = (
        "You write short, specific image-editing instructions for an AI interior design tool. "
        "Output ONE paragraph, under 70 words, no preamble, no markdown. "
        "Describe concrete materials, furniture, and finishes. "
        "Emphasize preserving the exact camera angle, room shape, walls, windows, and layout."
    )
    user_prompt = f"Room type: {room_type} ({area_sqft} sqft). Style: {style}. Budget level: {budget_tier}. Materials: {materials}."

    try:
        resp = requests.post(
            "https://gen.pollinations.ai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {POLLINATIONS_API_TOKEN}",
                "Content-Type": "application/json",
            },
            json={
                "model": "glm",
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "max_tokens": 120,
            },
            timeout=20,
        )
        if resp.status_code == 200:
            text = resp.json()["choices"][0]["message"]["content"].strip()
            if text:
                return text
        return fallback
    except Exception:
        return fallback


def generate_room_design(image_url, prompt, seed=0):
    """Calls Pollinations' image-to-image API to redesign a room photo."""
    import requests
    from urllib.parse import quote
    from time import sleep

    encoded_prompt = quote(prompt)
    url = f"https://image.pollinations.ai/prompt/{encoded_prompt}"
    params = {
        "model": "kontext",
        "image": image_url,
        "width": 1024,
        "height": 1024,
        "seed": seed,
    }
    if POLLINATIONS_API_TOKEN:
        params["nologo"] = "true"
    headers = {"Authorization": f"Bearer {POLLINATIONS_API_TOKEN}"} if POLLINATIONS_API_TOKEN else {}

    last_error = "Unknown error"
    for attempt in range(3):
        try:
            resp = requests.get(url, params=params, headers=headers, timeout=120)
            content_type = resp.headers.get('content-type', '')
            if resp.status_code == 200 and 'image' in content_type:
                return True, resp.content
            last_error = f"Pollinations error {resp.status_code} ({content_type}): {resp.text[:200]}"
        except requests.exceptions.RequestException as e:
            last_error = f"Request failed: {e}"
        if attempt < 2:
            sleep(2 ** attempt)
    return False, last_error


def compute_design_cost_estimate(room_type, budget_tier, area_sqft=120):
    """Return a cost estimate dict scaled to the provided area in sqft."""
    try:
        area = float(area_sqft)
        if area <= 0:
            area = 120
    except (TypeError, ValueError):
        area = 120

    if supabase:
        try:
            res = supabase.table('design_cost_rates').select('*').eq(
                'room_type', room_type).eq('budget_tier', budget_tier).limit(1).execute()
            if res.data:
                row = res.data[0]
                return {
                    'room_type': room_type,
                    'budget_tier': budget_tier,
                    'area_sqft': area,
                    'material_rate_per_sqft': float(row['material_rate_per_sqft']),
                    'labor_rate_per_sqft': float(row['labor_rate_per_sqft']),
                    'sample_area_sqft': area,
                    'material_cost': round(float(row['material_rate_per_sqft']) * area, 2),
                    'labor_cost': round(float(row['labor_rate_per_sqft']) * area, 2),
                    'total_estimate': round((float(row['material_rate_per_sqft']) + float(row['labor_rate_per_sqft'])) * area, 2),
                    'currency': 'INR'
                }
        except Exception as e:
            app.logger.warning(f'Cost rate lookup failed: {e}')

    defaults = {
        'economy': (250, 150),
        'mid-range': (450, 250),
        'premium': (900, 500),
    }
    material, labor = defaults.get(budget_tier.lower(), (450, 250))
    return {
        'room_type': room_type,
        'budget_tier': budget_tier,
        'area_sqft': area,
        'material_rate_per_sqft': material,
        'labor_rate_per_sqft': labor,
        'sample_area_sqft': area,
        'material_cost': round(material * area, 2),
        'labor_cost': round(labor * area, 2),
        'total_estimate': round((material + labor) * area, 2),
        'currency': 'INR',
        'note': 'fallback estimate'
    }


# --- Marketplace seed data (verified July 2026) ---
MARKETPLACE_SEED_DATA = [
    {
        "category": "Structural", "material": "OPC 53 Grade Cement", "unit": "50kg bag",
        "suppliers": [
            {"company_name": "UltraTech Cement (Aditya Birla Group)", "brand_name": "UltraTech",
             "price_low": 340, "price_high": 465, "trust_level": "Verified — market leader",
             "email": "ultratech.communication@adityabirla.com", "phone": "1800 210 3311",
             "price_last_verified_at": "2026-07-10",
             "source_note": "Toll-free + email confirmed via ultratechcement.com"},
            {"company_name": "ACC Limited (Adani Group)", "brand_name": "ACC",
             "price_low": 370, "price_high": 470, "trust_level": "Verified",
             "email": "", "phone": "1800 1033 444",
             "price_last_verified_at": "2026-07-10",
             "source_note": "Toll-free confirmed via acclimited.com; no public direct email found"},
            {"company_name": "Ambuja Cements Ltd (Adani Group)", "brand_name": "Ambuja",
             "price_low": 360, "price_high": 435, "trust_level": "Verified",
             "email": "corporate.communications@ambujacement.com", "phone": "1800 22 3010",
             "price_last_verified_at": "2026-07-10",
             "source_note": "Confirmed via ambujacement.com contact page"},
            {"company_name": "Shree Cement Ltd", "brand_name": "Shree Cement",
             "price_low": 320, "price_high": 370, "trust_level": "Verified — value pick",
             "email": "", "phone": "1800 180 6003",
             "price_last_verified_at": "2026-07-10",
             "source_note": "Toll-free confirmed; no public direct email found"},
            {"company_name": "Dalmia Cement (Bharat) Ltd", "brand_name": "Dalmia Cement",
             "price_low": 290, "price_high": 420, "trust_level": "Verified — competitive bulk pricing",
             "email": "marketing@dalmiacement.com", "phone": "011-23310121",
             "price_last_verified_at": "2026-07-10",
             "source_note": "Confirmed via dalmiacement.com"},
        ],
    },
    {
        "category": "Structural", "material": "TMT Steel Bars (Fe 500/500D/550D)", "unit": "per kg",
        "suppliers": [
            {"company_name": "Tata Steel Ltd (Tata Tiscon)", "brand_name": "Tata Tiscon",
             "price_low": 57, "price_high": 78, "trust_level": "Verified — premium/widest network",
             "email": "sntitatasteel@conneqtcorp.com", "phone": "1800 108 8282",
             "price_last_verified_at": "2026-07-10",
             "source_note": "Confirmed via tatatiscon.co.in"},
            {"company_name": "JSW Steel Ltd (JSW Neosteel)", "brand_name": "JSW Neosteel",
             "price_low": 61, "price_high": 78, "trust_level": "Verified — seismic-grade focus",
             "email": "", "phone": "",
             "price_last_verified_at": "2026-07-10",
             "source_note": "Price range from dealer aggregators; direct contact pending — do not fabricate"},
            {"company_name": "Steel Authority of India Ltd (SAIL)", "brand_name": "SAIL TMT",
             "price_low": 59, "price_high": 75, "trust_level": "Verified — government-backed",
             "email": "", "phone": "",
             "price_last_verified_at": "2026-07-10",
             "source_note": "Price range from dealer aggregators; direct contact pending — do not fabricate"},
            {"company_name": "Rashtriya Ispat Nigam Ltd (Vizag Steel)", "brand_name": "Vizag Steel",
             "price_low": 44, "price_high": 56, "trust_level": "Verified — regional value leader (South India)",
             "email": "", "phone": "",
             "price_last_verified_at": "2026-07-10",
             "source_note": "Price range from Vizag-region dealer trackers"},
            {"company_name": "Jindal Steel & Power (Jindal Panther)", "brand_name": "Jindal Panther",
             "price_low": 59, "price_high": 75, "trust_level": "Verified — competitive mid-tier value",
             "email": "", "phone": "",
             "price_last_verified_at": "2026-07-10",
             "source_note": "Price range from dealer aggregators; direct contact pending — do not fabricate"},
        ],
    },
]


def run_marketplace_seed():
    """Idempotent: upserts on (material name, company_name), never duplicates rows,
    never overwrites manually-edited admin data."""
    if not supabase:
        return
    for entry in MARKETPLACE_SEED_DATA:
        existing = supabase.table('marketplace_materials').select('id').eq('name', entry['material']).execute()
        if existing.data:
            material_id = existing.data[0]['id']
        else:
            inserted = supabase.table('marketplace_materials').insert({
                'category': entry['category'], 'name': entry['material'], 'unit': entry['unit'],
            }).execute()
            material_id = inserted.data[0]['id'] if inserted.data else None
            if not material_id:
                continue

        for s in entry['suppliers']:
            existing_supplier = supabase.table('marketplace_suppliers').select('id').eq(
                'material_id', material_id).eq('company_name', s['company_name']).execute()
            if existing_supplier.data:
                continue  # don't overwrite — admin may have edited this row already
            supabase.table('marketplace_suppliers').insert({**s, 'material_id': material_id}).execute()


@app.route('/login', methods=['POST'])
def login():
    data = request.get_json() or {}
    username = data.get('username', '').strip()
    password = data.get('password', '')

    if not username or not password:
        return jsonify({'success': False, 'error': 'Username and password are required'}), 400

    # Authenticate against the Supabase users table only.
    user_obj = None
    if supabase:
        try:
            res = supabase.table('users').select('*').ilike('email', username).eq('active', True).execute()
            if res.data:
                row = res.data[0]
                pw_hash = row.get('password_hash', '')
                if pw_hash and check_password_hash(pw_hash, password):
                    user_obj = {'id': row['id'], 'email': row['email'], 'role': row['role'], 'org_id': row.get('org_id')}
                else:
                    print(f'Login failed for "{username}": password mismatch')
            else:
                print(f'Login failed for "{username}": no active user found')
        except Exception as e:
            print(f'Error loading user from Supabase: {e}')
    else:
        print('Login failed: Supabase not connected')

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
    q = supabase.table('payroll').select('*')
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
# Budgets API (Admin-only)
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


# ========================
# Interior Design Studio API (Admin/Manager)
# ========================

@app.route('/api/interior-design/generate', methods=['POST'])
@requires_role('manager', 'admin')
def api_interior_design_generate():
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500

    room_type = request.form.get('room_type', '').strip()
    style = request.form.get('style', '').strip()
    budget_tier = request.form.get('budget_tier', '').strip()
    area_sqft = request.form.get('area_sqft', '120').strip()
    if not room_type or not style or not budget_tier:
        return jsonify({'error': 'room_type, style, and budget_tier are required'}), 400
    try:
        area_sqft_val = float(area_sqft) if area_sqft else 120
        if area_sqft_val <= 0:
            area_sqft_val = 120
    except ValueError:
        area_sqft_val = 120

    file = request.files.get('image')
    if not file:
        return jsonify({'error': 'image is required'}), 400
    file_bytes = file.read()
    if not file_bytes:
        return jsonify({'error': 'image is empty'}), 400

    ext = (file.filename or '').rsplit('.', 1)[-1].lower() if '.' in (file.filename or '') else 'jpg'
    if ext not in ('jpg', 'jpeg', 'png', 'webp'):
        ext = 'jpg'
    content_type = f"image/{'jpeg' if ext in ('jpg', 'jpeg') else ext}"

    user = session.get('user', {})
    user_id = user.get('id') if isinstance(user, dict) else None
    ts = now_ist().strftime('%Y%m%d_%H%M%S')
    import uuid as _uuid
    path = f"{user_id or 'anon'}_{ts}_{_uuid.uuid4().hex[:8]}.{ext}"

    upload_url, upload_error = upload_bytes_to_storage('interior-uploads', path, file_bytes, content_type)
    if not upload_url:
        return jsonify({'error': 'Failed to upload image to storage', 'details': upload_error}), 500

    # Pollinations must fetch the source image via URL. Prefer the public URL,
    # but fall back to a signed URL if the bucket is private.
    fetchable_url = get_fetchable_image_url('interior-uploads', path)
    if not fetchable_url:
        return jsonify({'error': 'Uploaded image is not reachable; check Supabase Storage bucket permissions'}), 500
    upload_url = fetchable_url

    try:
        res = supabase.table('interior_designs').insert({
            'created_by': user_id,
            'room_type': room_type,
            'style': style,
            'budget_tier': budget_tier,
            'upload_image_url': upload_url,
            'status': 'pending',
            'generated_images': [],
            'cost_estimate': None,
        }).execute()
        design_id = res.data[0]['id']
    except Exception as e:
        print(f'Error creating interior design record: {e}')
        return jsonify({'error': 'Failed to create design record'}), 500

    def generate_in_background(did, img_url, rt, st, bt, sqft):
        from time import sleep
        try:
            prompt = enhance_design_prompt(rt, st, bt, sqft)
            supabase.table('interior_designs').update({'enhanced_prompt': prompt}).eq('id', did).execute()
            generated = []
            # Single variant keeps generation reliably under 30 seconds on the free tier.
            for idx, seed in enumerate((0,)):
                if idx > 0:
                    sleep(4)
                ok, result = generate_room_design(img_url, prompt, seed)
                if ok:
                    out_path = f"generated_{did}_{seed}.jpg"
                    out_url, out_err = upload_bytes_to_storage('interior-uploads', out_path, result, 'image/jpeg')
                    if not out_url:
                        # Fallback: embed generated image as base64 data URL.
                        out_url = f"data:image/jpeg;base64,{base64.b64encode(result).decode('ascii')}"
                    generated.append({'seed': seed, 'url': out_url})
                else:
                    generated.append({'seed': seed, 'url': None, 'error': result})
                    app.logger.warning(f'Design {did} seed {seed} failed: {result}')
            cost = compute_design_cost_estimate(rt, bt, sqft)
            successful = [g for g in generated if g.get('url')]
            failed = [g for g in generated if not g.get('url')]
            status = 'completed' if successful else 'failed'
            error_message = None
            if failed:
                parts = [g.get('error') or 'unknown error' for g in failed]
                if not successful:
                    error_message = '; '.join(parts)[:500]
                else:
                    error_message = 'Some images failed to generate'
            supabase.table('interior_designs').update({
                'generated_images': generated,
                'cost_estimate': cost,
                'status': status,
                'error_message': error_message
            }).eq('id', did).execute()
        except Exception as e:
            print(f'Background generation error for {did}: {e}')
            try:
                supabase.table('interior_designs').update({
                    'status': 'failed',
                    'error_message': str(e)
                }).eq('id', did).execute()
            except Exception:
                pass

    import threading
    threading.Thread(target=generate_in_background, args=(
        design_id, upload_url, room_type, style, budget_tier, area_sqft_val
    ), daemon=True).start()

    return jsonify({'id': design_id, 'status': 'pending'}), 200


@app.route('/api/interior-design/<design_id>/status')
@login_required
def api_interior_design_status(design_id):
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    try:
        res = supabase.table('interior_designs').select('*').eq('id', design_id).limit(1).execute()
        if not res.data:
            return jsonify({'error': 'Design not found'}), 404
        row = res.data[0]
        return jsonify({
            'id': row['id'],
            'status': row['status'],
            'room_type': row['room_type'],
            'style': row['style'],
            'budget_tier': row['budget_tier'],
            'upload_image_url': row['upload_image_url'],
            'enhanced_prompt': row.get('enhanced_prompt'),
            'generated_images': row.get('generated_images') or [],
            'cost_estimate': row.get('cost_estimate'),
            'error_message': row.get('error_message'),
            'created_at': row.get('created_at')
        })
    except Exception as e:
        print(f'Error fetching design status: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/interior-design/history')
@login_required
def api_interior_design_history():
    if not supabase:
        return jsonify([])
    try:
        res = supabase.table('interior_designs').select('*').order('created_at', desc=True).limit(100).execute()
        return jsonify(res.data or [])
    except Exception as e:
        print(f'Error fetching design history: {e}')
        return jsonify([])


@app.route('/api/interior-design/<design_id>', methods=['DELETE'])
@requires_role('manager', 'admin')
def api_interior_design_delete(design_id):
    if not supabase:
        return jsonify({'success': True, 'note': 'read-only local mode'})
    try:
        supabase.table('interior_designs').delete().eq('id', design_id).execute()
        return jsonify({'success': True})
    except Exception as e:
        print(f'Error deleting interior design: {e}')
        return jsonify({'error': str(e)}), 500


# ========================
# Construction Marketplace API
# ========================

@app.route('/api/marketplace/materials')
@login_required
def api_marketplace_materials():
    if not supabase:
        return jsonify([])
    category = request.args.get('category', '').strip()
    q = supabase.table('marketplace_materials').select('*').eq('is_active', True)
    if category:
        q = q.eq('category', category)
    try:
        res = q.order('category', desc=False).order('name', desc=False).execute()
        return jsonify(res.data or [])
    except Exception as e:
        print(f'Error fetching marketplace materials: {e}')
        return jsonify([])


@app.route('/api/marketplace/materials/<material_id>/suppliers')
@login_required
def api_marketplace_suppliers(material_id):
    if not supabase:
        return jsonify([])
    min_price = request.args.get('min_price')
    max_price = request.args.get('max_price')
    verified_only = request.args.get('verified_only', '').lower() == 'true'
    try:
        q = supabase.table('marketplace_suppliers').select('*').eq('material_id', material_id)
        if verified_only:
            q = q.ilike('trust_level', '%Verified%')
        res = q.execute()
        rows = res.data or []
        if min_price is not None:
            try:
                min_p = float(min_price)
                rows = [r for r in rows if float(r.get('price_low', 0)) >= min_p]
            except ValueError:
                pass
        if max_price is not None:
            try:
                max_p = float(max_price)
                rows = [r for r in rows if float(r.get('price_low', 0)) <= max_p]
            except ValueError:
                pass
        rows.sort(key=lambda r: (
            0 if 'verified' in (r.get('trust_level') or '').lower() else 1,
            float(r.get('price_low', 0))
        ))
        return jsonify(rows[:5])
    except Exception as e:
        print(f'Error fetching marketplace suppliers: {e}')
        return jsonify([])


@app.route('/api/marketplace/materials', methods=['POST'])
@requires_role('admin')
def api_marketplace_material_post():
    if not supabase:
        return jsonify({'success': True, 'note': 'read-only local mode'})
    body = request.get_json() or {}
    required = ['category', 'name', 'unit']
    for field in required:
        if not body.get(field):
            return jsonify({'error': f'{field} is required'}), 400
    try:
        row = {
            'category': body['category'],
            'name': body['name'],
            'unit': body['unit'],
            'description': body.get('description', ''),
            'is_active': body.get('is_active', True),
        }
        if body.get('id'):
            row['id'] = body['id']
            supabase.table('marketplace_materials').upsert(row, on_conflict='id').execute()
            return jsonify({'success': True})
        res = supabase.table('marketplace_materials').insert(row).execute()
        return jsonify({'success': True, 'id': res.data[0]['id'] if res.data else None})
    except Exception as e:
        print(f'Error saving marketplace material: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/marketplace/suppliers', methods=['POST'])
@requires_role('admin')
def api_marketplace_supplier_post():
    if not supabase:
        return jsonify({'success': True, 'note': 'read-only local mode'})
    body = request.get_json() or {}
    required = ['material_id', 'company_name', 'brand_name', 'price_low', 'price_high']
    for field in required:
        if field not in body or body[field] in (None, ''):
            return jsonify({'error': f'{field} is required'}), 400
    try:
        row = {
            'material_id': body['material_id'],
            'company_name': body['company_name'],
            'brand_name': body['brand_name'],
            'price_low': float(body['price_low']),
            'price_high': float(body['price_high']),
            'currency': body.get('currency', 'INR'),
            'trust_level': body.get('trust_level', ''),
            'email': body.get('email', ''),
            'phone': body.get('phone', ''),
            'price_last_verified_at': body.get('price_last_verified_at'),
            'source_note': body.get('source_note', ''),
        }
        if body.get('id'):
            row['id'] = body['id']
            supabase.table('marketplace_suppliers').upsert(row, on_conflict='id').execute()
            return jsonify({'success': True})
        res = supabase.table('marketplace_suppliers').insert(row).execute()
        return jsonify({'success': True, 'id': res.data[0]['id'] if res.data else None})
    except Exception as e:
        print(f'Error saving marketplace supplier: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/marketplace/materials/<material_id>', methods=['DELETE'])
@requires_role('admin')
def api_marketplace_material_delete(material_id):
    if not supabase:
        return jsonify({'success': True, 'note': 'read-only local mode'})
    try:
        supabase.table('marketplace_suppliers').delete().eq('material_id', material_id).execute()
        supabase.table('marketplace_materials').delete().eq('id', material_id).execute()
        return jsonify({'success': True})
    except Exception as e:
        print(f'Error deleting marketplace material: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/marketplace/suppliers/<supplier_id>', methods=['DELETE'])
@requires_role('admin')
def api_marketplace_supplier_delete(supplier_id):
    if not supabase:
        return jsonify({'success': True, 'note': 'read-only local mode'})
    try:
        supabase.table('marketplace_suppliers').delete().eq('id', supplier_id).execute()
        return jsonify({'success': True})
    except Exception as e:
        print(f'Error deleting marketplace supplier: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/marketplace/seed', methods=['POST'])
@requires_role('admin')
def api_marketplace_seed():
    if not supabase:
        return jsonify({'success': True, 'note': 'read-only local mode'})
    try:
        run_marketplace_seed()
        return jsonify({'success': True})
    except Exception as e:
        print(f'Error seeding marketplace: {e}')
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    # Disable reloader: background image-generation threads must not be killed
    # when source files change during a design request.
    app.run(debug=True, host='0.0.0.0', port=5000, use_reloader=False)
