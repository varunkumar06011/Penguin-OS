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

try:
    import sys
    import io as _io
    _weasy_err = _io.StringIO()
    _orig_stderr = sys.stderr
    sys.stderr = _weasy_err
    from weasyprint import HTML
    sys.stderr = _orig_stderr
except (ImportError, OSError):
    sys.stderr = _orig_stderr
    HTML = None
finally:
    sys.stderr = _orig_stderr

load_dotenv()

IST = timezone(timedelta(hours=5, minutes=30))

def now_ist():
    return datetime.now(IST)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__, static_folder=os.path.join(BASE_DIR, 'static'), template_folder=os.path.join(BASE_DIR, 'templates'))
app.secret_key = os.environ.get('SECRET_KEY', 'vgrand-secret-key-2025')
app.permanent_session_lifetime = timedelta(days=30)
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024

@app.template_filter('inr')
def format_inr_filter(num):
    """Jinja filter: format a number as Indian Rupees (Cr/Lakh)."""
    return _format_inr(num)

SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SUPABASE_ANON_KEY = os.environ.get('SUPABASE_ANON_KEY', '')
SUPABASE_SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_KEY', '')

# Use the service-role key server-side so RLS policies can be deny-by-default.
# The browser never touches Supabase directly, so this key never leaves the server.
_supabase_key = SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY
supabase: Client = create_client(SUPABASE_URL, _supabase_key) if SUPABASE_URL and _supabase_key else None

if supabase:
    print(f'[OK] Supabase connected: {SUPABASE_URL}')
else:
    print('[WARN] Supabase not connected. Check SUPABASE_URL and SUPABASE_SERVICE_KEY in .env')

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
    """Calls Pollinations' image-to-image API to redesign a room photo.
    Tries the paid gen.pollinations.ai endpoint first, then falls back to
    the free legacy image.pollinations.ai endpoint."""
    import requests
    from urllib.parse import quote
    from time import sleep

    encoded_prompt = quote(prompt)
    base_params = {
        "model": "flux",
        "image": image_url,
        "width": 1024,
        "height": 1024,
        "seed": seed,
        "negative": "changed room layout, moved walls, removed windows, added windows, different camera angle, different perspective, altered room shape, different ceiling, exterior view",
    }

    endpoints = []
    if POLLINATIONS_API_TOKEN:
        endpoints.append(("https://gen.pollinations.ai/image/", {"Authorization": f"Bearer {POLLINATIONS_API_TOKEN}"}, {**base_params, "nologo": "true"}))
    endpoints.append(("https://image.pollinations.ai/prompt/", {}, dict(base_params)))

    last_error = "Unknown error"
    for ep_url, ep_headers, ep_params in endpoints:
        url = f"{ep_url}{encoded_prompt}"
        for attempt in range(3):
            try:
                resp = requests.get(url, params=ep_params, headers=ep_headers, timeout=120)
                content_type = resp.headers.get('content-type', '')
                if resp.status_code == 200 and 'image' in content_type:
                    return True, resp.content
                last_error = f"Pollinations error {resp.status_code} ({content_type}): {resp.text[:200]}"
                if resp.status_code in (401, 402, 403):
                    break
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
        res = supabase.table('security_users').select('*').ilike('email', email).eq('active', True).execute()
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


@app.route('/api/users')
@requires_role('admin')
def api_users():
    if not supabase:
        return jsonify([])
    try:
        res = supabase.table('users').select('email, role, active, full_name').execute()
        return jsonify(res.data or [])
    except Exception as e:
        print(f'Error fetching users: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/users/change-password', methods=['POST'])
@requires_role('admin')
def api_users_change_password():
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    data = request.get_json() or {}
    email = data.get('email', '').strip()
    new_password = data.get('new_password', '')
    if not email or not new_password:
        return jsonify({'error': 'Email and new password are required'}), 400
    if len(new_password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters'}), 400
    try:
        res = supabase.table('users').select('*').ilike('email', email).execute()
        if not res.data:
            return jsonify({'error': 'User not found'}), 404
        user = res.data[0]
        new_hash = generate_password_hash(new_password)
        supabase.table('users').update({'password_hash': new_hash}).eq('id', user['id']).execute()
        return jsonify({'success': True})
    except Exception as e:
        print(f'Error changing password: {e}')
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


@app.route('/api/visitor/resident-profile', methods=['GET', 'PATCH'])
@visitor_login_required
def api_visitor_resident_profile():
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    resident = session.get('visitor_user')
    if not resident:
        return jsonify({'error': 'Not logged in'}), 401
    if request.method == 'GET':
        try:
            res = supabase.table('residents').select('*').eq('id', resident['id']).single().execute()
            if not res.data:
                return jsonify({'error': 'Resident not found'}), 404
            r = res.data
            return jsonify({
                'id': r['id'], 'name': r['name'], 'mobile': r['mobile'],
                'email': r.get('email'), 'photo_url': r.get('photo_url'),
                'block': r['block'], 'floor': r['floor'], 'flat': r['flat'],
                'directory_opt_in': r.get('directory_opt_in', False),
                'active': r.get('active', True), 'created_at': r.get('created_at')
            })
        except Exception as e:
            print(f'Error fetching resident profile: {e}')
            return jsonify({'error': str(e)}), 500
    else:
        body = request.get_json() or {}
        allowed = {k: v for k, v in body.items() if k in ('name', 'email', 'photo_url', 'directory_opt_in')}
        if not allowed:
            return jsonify({'error': 'Nothing to update'}), 400
        try:
            supabase.table('residents').update(allowed).eq('id', resident['id']).execute()
            if 'name' in allowed:
                resident['name'] = allowed['name']
                session['visitor_user'] = resident
            return jsonify({'success': True})
        except Exception as e:
            print(f'Error updating resident profile: {e}')
            return jsonify({'error': str(e)}), 500


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
        # Overstay alert: visitors inside longer than 4 hours
        overstay_threshold = now_ist() - timedelta(hours=4)
        overstaying = []
        for r in rows:
            if r.get('status') == 'inside' and r.get('entry_time'):
                try:
                    entry = datetime.fromisoformat(r['entry_time'].replace('Z', '+00:00'))
                    if entry.tzinfo is None:
                        entry = entry.replace(tzinfo=IST)
                    if entry < overstay_threshold:
                        overstaying.append({
                            'id': r['id'],
                            'visitor_name': r.get('visitor_name'),
                            'entry_time': r.get('entry_time'),
                            'duration_hours': round((now_ist() - entry).total_seconds() / 3600, 1)
                        })
                except Exception:
                    pass
        result = {
            'total_today': len(today_rows),
            'pending': len([r for r in rows if r.get('status') == 'waiting']),
            'approved': len([r for r in rows if r.get('status') == 'approved']),
            'rejected': len([r for r in rows if r.get('status') == 'rejected']),
            'inside': len([r for r in rows if r.get('status') == 'inside']),
            'completed': len([r for r in rows if r.get('status') == 'completed']),
            'overstaying': overstaying
        }
        return jsonify(result)
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


@app.route('/api/health')
def api_health():
    """Public health check: reports Supabase connection and seeded user counts."""
    result = {'supabase_connected': bool(supabase)}
    if supabase:
        try:
            users = supabase.table('users').select('id', count='exact').execute()
            security = supabase.table('security_users').select('id', count='exact').execute()
            result['users_count'] = users.count if hasattr(users, 'count') else len(users.data or [])
            result['security_users_count'] = security.count if hasattr(security, 'count') else len(security.data or [])
        except Exception as e:
            result['error'] = str(e)
    return jsonify(result)


# ========================
# Cell Data API
# ========================

@app.route('/api/cells')
@requires_role('supervisor', 'manager', 'admin')
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
@requires_role('supervisor', 'manager', 'admin')
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
@requires_role_or_override('supervisor')
def api_cell_post(cell_id):
    body = request.get_json() or {}
    if not supabase:
        return jsonify({'success': True, 'note': 'read-only local mode'})
    color = body.get('color')
    if color is not None and color not in ('red', 'yellow', 'blue', 'green', ''):
        return jsonify({'error': f'Invalid color value: {color}'}), 400
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
@requires_role_or_override('supervisor')
def api_cells_batch():
    body = request.get_json() or {}
    cells = body.get('cells', [])
    if not cells:
        return jsonify({'success': True})
    for c in cells:
        d = c.get('data') or {}
        color = d.get('color')
        if color is not None and color not in ('red', 'yellow', 'blue', 'green', ''):
            return jsonify({'error': f'Invalid color value: {color}'}), 400
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
@requires_role_or_override('supervisor')
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
@requires_role('manager', 'admin')
def api_settings_get(key):
    if not supabase:
        return jsonify(None)
    try:
        res = supabase.table('settings').select('*').eq('key', key).execute()
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
@requires_role_or_override('supervisor')
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
@requires_role_or_override('supervisor')
def api_material_post():
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    m = request.get_json() or {}
    supabase.table('materials').upsert(m, on_conflict='id').execute()
    return jsonify({'success': True})


@app.route('/api/material/<material_id>', methods=['DELETE'])
@requires_role_or_override('supervisor')
def api_material_delete(material_id):
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    supabase.table('materials').delete().eq('id', material_id).execute()
    return jsonify({'success': True})


@app.route('/api/stock')
@requires_role_or_override('supervisor')
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
@requires_role_or_override('supervisor')
def api_stock_post():
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    entry = request.get_json() or {}
    supabase.table('stock_ledger').upsert(entry, on_conflict='id').execute()
    return jsonify({'success': True})


@app.route('/api/stock/summary')
@requires_role_or_override('supervisor')
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
@requires_role_or_override('supervisor')
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
@requires_role_or_override('supervisor')
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
# Lender Progress Report PDF
# ========================

def _lender_color_to_pct(color):
    """Map cell color to completion percentage for lender reports."""
    return {'green': 100, 'blue': 75, 'yellow': 40, 'red': 0}.get(color, 0)


def _lender_compute_progress(venture_id):
    """Compute % completion per block/floor from cell_data colors."""
    if not supabase:
        return {'blocks': [], 'overall_pct': 0, 'total_cells': 0}
    try:
        res = supabase.table('cell_data').select('*').execute()
        block_stats = {}
        total_weighted = 0
        total_cells = 0
        for row in res.data:
            d = row.get('data') or {}
            if d.get('venture_id') != venture_id:
                continue
            block = d.get('block', 'Unknown')
            floor = d.get('floor', 'Unknown')
            color = d.get('color', 'red')
            pct = _lender_color_to_pct(color)
            key = block
            if key not in block_stats:
                block_stats[key] = {'block': block, 'floors': {}, 'total_pct': 0, 'cell_count': 0}
            floor_key = floor
            if floor_key not in block_stats[key]['floors']:
                block_stats[key]['floors'][floor_key] = {'floor': floor, 'total_pct': 0, 'cell_count': 0}
            block_stats[key]['floors'][floor_key]['total_pct'] += pct
            block_stats[key]['floors'][floor_key]['cell_count'] += 1
            block_stats[key]['total_pct'] += pct
            block_stats[key]['cell_count'] += 1
            total_weighted += pct
            total_cells += 1
        blocks = []
        for block_name, stats in sorted(block_stats.items()):
            block_pct = round(stats['total_pct'] / stats['cell_count'], 1) if stats['cell_count'] else 0
            floors = []
            for floor_name, fs in sorted(stats['floors'].items()):
                floor_pct = round(fs['total_pct'] / fs['cell_count'], 1) if fs['cell_count'] else 0
                floors.append({
                    'floor': fs['floor'],
                    'cell_count': fs['cell_count'],
                    'pct_complete': floor_pct
                })
            blocks.append({
                'block': block_name,
                'cell_count': stats['cell_count'],
                'pct_complete': block_pct,
                'floors': floors
            })
        overall = round(total_weighted / total_cells, 1) if total_cells else 0
        return {'blocks': blocks, 'overall_pct': overall, 'total_cells': total_cells}
    except Exception as e:
        print(f'Error computing lender report progress: {e}')
        return {'blocks': [], 'overall_pct': 0, 'total_cells': 0}


def _lender_compute_financials(venture_id):
    """Compute funds collected and utilized for the report."""
    collected = 0.0
    utilized = 0.0
    if not supabase:
        return {'collected': 0, 'utilized': 0, 'escrow_balance': 0}
    try:
        inv_res = supabase.table('invoices').select('*').execute()
        for inv in inv_res.data or []:
            d = inv.get('data') or {}
            v_match = d.get('venture_id') == venture_id or inv.get('venture_id') == venture_id
            if not v_match:
                continue
            status = (d.get('status') or inv.get('status') or '').lower()
            amt = float(d.get('amount') or inv.get('amount') or 0)
            if status in ('paid', 'received', 'completed'):
                collected += amt
    except Exception as e:
        print(f'Error fetching invoices for lender report: {e}')
    try:
        exp_res = supabase.table('expenditures').select('*').eq('venture_id', venture_id).execute()
        for exp in exp_res.data or []:
            d = exp.get('data') or {}
            utilized += float(d.get('amount', 0))
    except Exception as e:
        print(f'Error fetching expenditures for lender report: {e}')
    return {
        'collected': round(collected, 2),
        'utilized': round(utilized, 2),
        'escrow_balance': round(collected - utilized, 2)
    }


def _lender_latest_photos(venture_id):
    """Return most recent dated photo per block/floor from cell_data remarkImages."""
    photos = []
    if not supabase:
        return photos
    try:
        res = supabase.table('cell_data').select('*').execute()
        seen = {}
        for row in res.data:
            d = row.get('data') or {}
            if d.get('venture_id') != venture_id:
                continue
            block = d.get('block', 'Unknown')
            floor = d.get('floor', 'Unknown')
            key = (block, floor)
            images = d.get('remarkImages') or []
            timeline = d.get('timeline') or []
            for img in images:
                # Try to find a capture date from timeline entries or updated_at
                capture_date = d.get('updated_at', '')[:10]
                for entry in timeline:
                    if entry.get('remarks') and img.get('name') in (entry.get('remarks') or ''):
                        capture_date = entry.get('date', capture_date)[:10]
                        break
                if key not in seen or capture_date > seen[key].get('date', ''):
                    seen[key] = {
                        'block': block,
                        'floor': floor,
                        'src': img.get('dataUrl', ''),
                        'date': capture_date
                    }
        photos = [seen[k] for k in sorted(seen.keys()) if seen[k].get('src')]
    except Exception as e:
        print(f'Error fetching lender report photos: {e}')
    return photos


def _format_inr(num):
    """Format a number in Indian Rupee crore/lakh notation."""
    num = float(num)
    if num >= 10000000:
        return f"\u20b9 {round(num / 10000000, 2)} Cr"
    if num >= 100000:
        return f"\u20b9 {round(num / 100000, 2)} L"
    return f"\u20b9 {round(num, 2)}"


@app.route('/api/reports/lender-report/<project_id>')
@requires_role_or_override('manager', 'admin')
def api_lender_report(project_id):
    """Generate a printable Lender Progress Report PDF."""
    if not HTML:
        return jsonify({'error': 'PDF engine not installed. Run: pip install weasyprint'}), 500

    report_date_str = request.args.get('date') or now_ist().strftime('%Y-%m-%d')
    include_financials = request.args.get('include_financials', 'true').lower() != 'false'

    # Venture / project details
    venture = {'id': project_id, 'name': project_id, 'address': '', 'rera_registration': ''}
    prepared_by = ''
    if supabase:
        try:
            vres = supabase.table('ventures').select('*').eq('id', project_id).execute()
            if vres.data:
                vdata = vres.data[0].get('data') or {}
                venture = {
                    'id': project_id,
                    'name': vdata.get('name') or vres.data[0].get('name') or project_id,
                    'address': vdata.get('address', ''),
                    'rera_registration': vdata.get('rera_registration', '')
                }
                # Try to fetch builder name from organization
                org_id = vdata.get('org_id') or vres.data[0].get('org_id')
                if org_id:
                    try:
                        ores = supabase.table('organizations').select('name').eq('id', org_id).single().execute()
                        if ores.data:
                            prepared_by = ores.data.get('name', '')
                    except Exception:
                        pass
        except Exception as e:
            print(f'Error fetching venture for lender report: {e}')

    progress = _lender_compute_progress(project_id)
    financials = _lender_compute_financials(project_id) if include_financials else None
    photos = _lender_latest_photos(project_id)

    ref_id = f"LPR-{project_id.upper()}-{report_date_str.replace('-', '')}"

    rendered = render_template(
        'lender_report.html',
        venture=venture,
        report_date=report_date_str,
        prepared_by=prepared_by or 'VGrand Infra Pvt. Ltd.',
        overall_pct=progress['overall_pct'],
        total_cells=progress['total_cells'],
        blocks=progress['blocks'],
        photos=photos,
        financials=financials,
        include_financials=include_financials,
        ref_id=ref_id
    )

    pdf = HTML(string=rendered).write_pdf()
    filename = f"Lender_Progress_Report_{venture['name'].replace(' ', '_')}_{report_date_str}.pdf"
    response = app.make_response(pdf)
    response.headers['Content-Type'] = 'application/pdf'
    response.headers['Content-Disposition'] = f'attachment; filename="{filename}"'
    return response


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
@requires_role_or_override('supervisor')
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
@requires_role_or_override('supervisor')
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
@requires_role_or_override('supervisor')
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
@requires_role_or_override('supervisor')
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
@requires_role_or_override('supervisor')
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
@requires_role_or_override('supervisor')
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


# ============================================================
# RWA MODULE: Foundation (Phase 1)
# ============================================================

def sync_completed_flats_to_flats_table(venture_id=None, block=None, floor=None):
    """Read cell_data for a given block/floor, check if all work items are green,
    and upsert/update the corresponding row in flats to construction_status='completed'.
    Does NOT touch any cell_data — reads only."""
    if not supabase:
        return {'error': 'Supabase not connected'}
    try:
        query = supabase.table('cell_data').select('*')
        if venture_id:
            query = query.filter('data->>venture_id', 'eq', venture_id)
        if block:
            query = query.filter('data->>block', 'eq', block)
        if floor:
            query = query.filter('data->>floor', 'eq', str(floor))
        res = query.execute()
        rows = res.data or []

        # Group cells by block|floor|flat_number
        flat_map = {}
        for row in rows:
            d = row.get('data') or {}
            b = d.get('block', '')
            f = d.get('floor', '')
            flat_num = d.get('flat', '')
            if not b or not f or not flat_num:
                continue
            key = (b, f, flat_num)
            if key not in flat_map:
                flat_map[key] = {'cells': [], 'all_green': True}
            color = d.get('color', '')
            flat_map[key]['cells'].append({'id': row['id'], 'color': color})
            if color != 'green':
                flat_map[key]['all_green'] = False

        updated = []
        for (b, f, flat_num), info in flat_map.items():
            if not info['cells']:
                continue
            status = 'completed' if info['all_green'] else 'pending'
            existing = supabase.table('flats').select('id, construction_status').eq(
                'block', b).eq('floor', f).eq('flat_number', flat_num).execute()
            if existing.data:
                flat_row = existing.data[0]
                if flat_row['construction_status'] != status:
                    supabase.table('flats').update({
                        'construction_status': status
                    }).eq('id', flat_row['id']).execute()
                    updated.append({'block': b, 'floor': f, 'flat': flat_num, 'status': status})
            else:
                supabase.table('flats').insert({
                    'block': b, 'floor': f, 'flat_number': flat_num,
                    'construction_status': status
                }).execute()
                updated.append({'block': b, 'floor': f, 'flat': flat_num, 'status': status, 'created': True})

        return {'synced': len(updated), 'flats': updated}
    except Exception as e:
        print(f'Error syncing completed flats: {e}')
        return {'error': str(e)}


@app.route('/api/rwa/sync-completed-flats', methods=['POST'])
@requires_role('admin', 'manager')
def api_rwa_sync_completed_flats():
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    body = request.get_json() or {}
    result = sync_completed_flats_to_flats_table(
        venture_id=body.get('venture_id'),
        block=body.get('block'),
        floor=body.get('floor')
    )
    if 'error' in result:
        return jsonify(result), 500
    return jsonify(result)


@app.route('/api/rwa/flats')
@requires_role('admin', 'manager')
def api_rwa_flats():
    if not supabase:
        return jsonify([]), 500
    try:
        res = supabase.table('flats').select('*').order('block', desc=False).order('floor', desc=False).order('flat_number', desc=False).execute()
        return jsonify(res.data or [])
    except Exception as e:
        print(f'Error fetching flats: {e}')
        return jsonify([]), 500


@app.route('/api/rwa/emergency-contacts')
@visitor_login_required
def api_rwa_emergency_contacts():
    if not supabase:
        return jsonify([]), 500
    try:
        res = supabase.table('emergency_contacts').select('*').eq('active', True).order('label', desc=False).execute()
        return jsonify(res.data or [])
    except Exception as e:
        print(f'Error fetching emergency contacts: {e}')
        return jsonify([]), 500


@app.route('/rwa-admin')
@login_required
def rwa_admin_page():
    return render_template('rwa_admin.html')


# ============================================================
# RWA MODULE: Standard Tier (Phase 2)
# ============================================================

def _get_rwa_session_user():
    """Return (user_dict, role_string) for the current session — works for
    resident, security, and admin/manager sessions."""
    resident = session.get('visitor_user')
    if resident:
        return resident, 'resident'
    security = session.get('security_user')
    if security:
        return security, 'security'
    user = session.get('user')
    if user:
        role = user.get('role', 'admin') if isinstance(user, dict) else 'admin'
        return user, role
    return None, None


# --- Deliveries ---

@app.route('/api/rwa/delivery', methods=['POST'])
@visitor_login_required
def api_rwa_delivery_create():
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    body = request.get_json() or {}
    if not body.get('resident_id'):
        return jsonify({'error': 'resident_id is required'}), 400
    try:
        user, role = _get_rwa_session_user()
        security_id = user.get('id') if role == 'security' else None
        import uuid as _uuid
        row = {
            'resident_id': body['resident_id'],
            'security_id': security_id,
            'courier_name': body.get('courier_name', ''),
            'delivery_person_name': body.get('delivery_person_name', ''),
            'vehicle_number': body.get('vehicle_number', ''),
            'qr_code': str(_uuid.uuid4()),
            'parcel_photo_url': body.get('parcel_photo_url', ''),
            'status': 'arrived',
        }
        res = supabase.table('deliveries').insert(row).execute()
        data = res.data[0] if res.data else None
        return jsonify({'success': True, 'id': data['id'] if data else None, 'qr_code': data.get('qr_code') if data else None})
    except Exception as e:
        print(f'Error creating delivery: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/rwa/delivery/<delivery_id>', methods=['PATCH'])
@visitor_login_required
def api_rwa_delivery_patch(delivery_id):
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    body = request.get_json() or {}
    allowed = {}
    if 'status' in body and body['status'] in ('arrived', 'inside', 'collected', 'returned', 'expired'):
        allowed['status'] = body['status']
        if body['status'] == 'collected':
            allowed['collected_at'] = now_ist().isoformat()
            allowed['exit_time'] = now_ist().isoformat()
            allowed['expires_at'] = None
        if body['status'] == 'returned':
            allowed['exit_time'] = now_ist().isoformat()
            allowed['expires_at'] = None
        if body['status'] == 'inside':
            allowed['entry_time'] = now_ist().isoformat()
            allowed['expires_at'] = (now_ist() + timedelta(minutes=20)).isoformat()
    if 'alerted' in body:
        allowed['alerted'] = bool(body['alerted'])
    if not allowed:
        return jsonify({'error': 'Nothing to update'}), 400
    try:
        supabase.table('deliveries').update(allowed).eq('id', delivery_id).execute()
        return jsonify({'success': True})
    except Exception as e:
        print(f'Error updating delivery: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/rwa/deliveries')
@visitor_login_required
def api_rwa_deliveries():
    if not supabase:
        return jsonify([]), 500
    try:
        user, role = _get_rwa_session_user()
        q = supabase.table('deliveries').select('*, residents(name, mobile, block, floor, flat)')
        if role == 'resident':
            q = q.eq('resident_id', user['id'])
        res = q.order('arrived_at', desc=True).execute()
        rows = []
        for r in res.data or []:
            rd = r.get('residents') or {}
            rows.append({
                'id': r['id'], 'resident_id': r['resident_id'],
                'resident_name': rd.get('name'), 'resident_mobile': rd.get('mobile'),
                'block': rd.get('block'), 'floor': rd.get('floor'), 'flat': rd.get('flat'),
                'courier_name': r.get('courier_name'), 'delivery_person_name': r.get('delivery_person_name'),
                'vehicle_number': r.get('vehicle_number'), 'qr_code': r.get('qr_code'),
                'status': r.get('status'), 'arrived_at': r.get('arrived_at'),
                'collected_at': r.get('collected_at'), 'entry_time': r.get('entry_time'),
                'exit_time': r.get('exit_time'), 'expires_at': r.get('expires_at'),
                'alerted': r.get('alerted', False)
            })
        return jsonify(rows)
    except Exception as e:
        print(f'Error fetching deliveries: {e}')
        return jsonify([]), 500


@app.route('/api/rwa/delivery/<delivery_id>/qr')
@visitor_login_required
def api_rwa_delivery_qr(delivery_id):
    """Generate a QR code image for a delivery entry pass.
    Scanning the QR at the gate starts the 20-minute collection timer."""
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    try:
        res = supabase.table('deliveries').select(
            '*, residents(name, mobile, block, floor, flat)'
        ).eq('id', delivery_id).execute()
        if not res.data:
            return jsonify({'error': 'Delivery not found'}), 404
        d = res.data[0]
        if d.get('status') in ('collected', 'returned'):
            return jsonify({'error': 'Delivery already completed'}), 400
        if not d.get('qr_code'):
            return jsonify({'error': 'No QR code assigned'}), 400

        import qrcode as _qrcode
        import io as _io
        import json as _json

        rd = d.get('residents') or {}
        qr_payload = _json.dumps({
            'type': 'rwa_delivery_pass',
            'id': d['id'],
            'qr_code': d.get('qr_code'),
            'resident_name': rd.get('name', ''),
            'flat': f"{rd.get('block','')}-{rd.get('floor','')}-{rd.get('flat','')}",
            'delivery_person_name': d.get('delivery_person_name', ''),
            'vehicle_number': d.get('vehicle_number', ''),
            'issued_at': now_ist().isoformat(),
        })

        qr = _qrcode.QRCode(version=1, error_correction=_qrcode.constants.ERROR_CORRECT_M, box_size=10, border=4)
        qr.add_data(qr_payload)
        qr.make(fit=True)
        img = qr.make_image(fill_color='black', back_color='white')
        buf = _io.BytesIO()
        img.save(buf, format='PNG')
        buf.seek(0)

        from flask import send_file as _send_file
        return _send_file(buf, mimetype='image/png')
    except Exception as e:
        print(f'Error generating delivery QR: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/rwa/delivery/scan', methods=['POST'])
@visitor_login_required
def api_rwa_delivery_scan():
    """Security scans a delivery QR pass at the gate.
    If status is 'arrived', mark 'inside' and start 20-minute timer.
    If status is 'inside', mark exit/collected."""
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    user, role = _get_rwa_session_user()
    if role not in ('security', 'admin', 'manager'):
        return jsonify({'error': 'Security only'}), 403
    body = request.get_json() or {}
    payload = body.get('payload')
    if not payload:
        return jsonify({'error': 'payload is required'}), 400

    import json as _json
    try:
        data = _json.loads(payload) if isinstance(payload, str) else payload
    except Exception:
        return jsonify({'error': 'Invalid QR payload'}), 400

    if data.get('type') != 'rwa_delivery_pass':
        return jsonify({'error': 'Not a delivery pass QR'}), 400

    delivery_id = data.get('id')
    qr_code = data.get('qr_code')
    if not delivery_id or not qr_code:
        return jsonify({'error': 'Missing delivery ID or QR code'}), 400

    try:
        res = supabase.table('deliveries').select(
            '*, residents(name, mobile, block, floor, flat)'
        ).eq('id', delivery_id).execute()
        if not res.data:
            return jsonify({'error': 'Delivery not found'}), 404
        d = res.data[0]
        if d.get('qr_code') != qr_code:
            return jsonify({'error': 'Invalid QR code'}), 400
        rd = d.get('residents') or {}

        if d.get('status') in ('collected', 'returned'):
            return jsonify({'error': 'Delivery already completed', 'status': d.get('status')}), 409

        now = now_ist().isoformat()
        if d.get('status') == 'inside':
            supabase.table('deliveries').update({
                'status': 'collected',
                'exit_time': now,
                'expires_at': None,
                'alerted': False
            }).eq('id', delivery_id).execute()
            return jsonify({
                'success': True,
                'action': 'exit',
                'status': 'collected',
                'delivery_person_name': d.get('delivery_person_name'),
                'resident_name': rd.get('name'),
                'flat': f"{rd.get('block','')}-{rd.get('floor','')}-{rd.get('flat','')}",
            })

        supabase.table('deliveries').update({
            'status': 'inside',
            'entry_time': now,
            'expires_at': (now_ist() + timedelta(minutes=20)).isoformat(),
            'security_id': user.get('id') if role == 'security' else None,
            'alerted': False
        }).eq('id', delivery_id).execute()

        return jsonify({
            'success': True,
            'action': 'entry',
            'status': 'inside',
            'delivery_person_name': d.get('delivery_person_name'),
            'vehicle_number': d.get('vehicle_number'),
            'resident_name': rd.get('name'),
            'resident_mobile': rd.get('mobile'),
            'flat': f"{rd.get('block','')}-{rd.get('floor','')}-{rd.get('flat','')}",
            'expires_at': (now_ist() + timedelta(minutes=20)).isoformat(),
        })
    except Exception as e:
        print(f'Error scanning delivery QR: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/rwa/delivery/alerts')
@visitor_login_required
def api_rwa_delivery_alerts():
    """Return active deliveries whose 20-minute timer has expired.
    Security dashboard polls this and can call the resident."""
    if not supabase:
        return jsonify([]), 500
    user, role = _get_rwa_session_user()
    if role not in ('security', 'admin', 'manager'):
        return jsonify([]), 403
    try:
        now = now_ist().isoformat()
        res = supabase.table('deliveries').select(
            '*, residents(name, mobile, block, floor, flat)'
        ).eq('status', 'inside').lt('expires_at', now).order('expires_at').execute()
        rows = []
        for r in res.data or []:
            rd = r.get('residents') or {}
            rows.append({
                'id': r['id'], 'resident_name': rd.get('name'), 'resident_mobile': rd.get('mobile'),
                'block': rd.get('block'), 'floor': rd.get('floor'), 'flat': rd.get('flat'),
                'delivery_person_name': r.get('delivery_person_name'), 'vehicle_number': r.get('vehicle_number'),
                'entry_time': r.get('entry_time'), 'expires_at': r.get('expires_at'),
                'alerted': r.get('alerted', False)
            })
        return jsonify(rows)
    except Exception as e:
        print(f'Error fetching delivery alerts: {e}')
        return jsonify([]), 500


@app.route('/api/rwa/delivery/<delivery_id>/exit', methods=['POST'])
@visitor_login_required
def api_rwa_delivery_exit(delivery_id):
    """Manually mark a delivery as exited/collected."""
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    user, role = _get_rwa_session_user()
    if role not in ('security', 'admin', 'manager', 'resident'):
        return jsonify({'error': 'Not allowed'}), 403
    try:
        supabase.table('deliveries').update({
            'status': 'collected',
            'exit_time': now_ist().isoformat(),
            'expires_at': None,
            'alerted': False
        }).eq('id', delivery_id).execute()
        return jsonify({'success': True})
    except Exception as e:
        print(f'Error marking delivery exit: {e}')
        return jsonify({'error': str(e)}), 500


# --- Daily Help ---

@app.route('/api/rwa/daily-help', methods=['GET', 'POST'])
@visitor_login_required
def api_rwa_daily_help():
    if not supabase:
        return jsonify([]), 500
    if request.method == 'GET':
        try:
            res = supabase.table('daily_help').select('*').eq('active', True).order('name').execute()
            return jsonify(res.data or [])
        except Exception as e:
            print(f'Error fetching daily help: {e}')
            return jsonify([]), 500
    else:
        body = request.get_json() or {}
        if not body.get('name'):
            return jsonify({'error': 'name is required'}), 400
        try:
            row = {
                'name': body['name'],
                'mobile': body.get('mobile', ''),
                'role_type': body.get('role_type', ''),
                'photo_url': body.get('photo_url', ''),
            }
            res = supabase.table('daily_help').insert(row).execute()
            return jsonify({'success': True, 'id': res.data[0]['id'] if res.data else None})
        except Exception as e:
            print(f'Error creating daily help: {e}')
            return jsonify({'error': str(e)}), 500


@app.route('/api/rwa/daily-help/<help_id>', methods=['PATCH', 'DELETE'])
@visitor_login_required
def api_rwa_daily_help_patch(help_id):
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    try:
        if request.method == 'DELETE':
            supabase.table('daily_help').update({'active': False}).eq('id', help_id).execute()
            return jsonify({'success': True})
        else:
            body = request.get_json() or {}
            allowed = {k: v for k, v in body.items() if k in ('name', 'mobile', 'role_type', 'photo_url', 'active')}
            if not allowed:
                return jsonify({'error': 'Nothing to update'}), 400
            supabase.table('daily_help').update(allowed).eq('id', help_id).execute()
            return jsonify({'success': True})
    except Exception as e:
        print(f'Error updating daily help: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/rwa/daily-help/<help_id>/attendance', methods=['POST', 'GET'])
@visitor_login_required
def api_rwa_daily_help_attendance(help_id):
    if not supabase:
        return jsonify([]), 500
    if request.method == 'GET':
        try:
            res = supabase.table('daily_help_attendance').select('*').eq(
                'daily_help_id', help_id).order('check_in', desc=True).limit(50).execute()
            return jsonify(res.data or [])
        except Exception as e:
            print(f'Error fetching attendance: {e}')
            return jsonify([]), 500
    else:
        body = request.get_json() or {}
        action = body.get('action', 'check_in')
        try:
            user, role = _get_rwa_session_user()
            security_id = user.get('id') if role == 'security' else None
            if action == 'check_in':
                row = {
                    'daily_help_id': help_id,
                    'check_in': now_ist().isoformat(),
                    'verified_by': security_id,
                }
                res = supabase.table('daily_help_attendance').insert(row).execute()
                return jsonify({'success': True, 'id': res.data[0]['id'] if res.data else None})
            elif action == 'check_out':
                att_id = body.get('attendance_id')
                if not att_id:
                    open_att = supabase.table('daily_help_attendance').select('id').eq(
                        'daily_help_id', help_id).is_('check_out', 'null').order('check_in', desc=True).limit(1).execute()
                    if not open_att.data:
                        return jsonify({'error': 'No open check-in found'}), 404
                    att_id = open_att.data[0]['id']
                supabase.table('daily_help_attendance').update({
                    'check_out': now_ist().isoformat()
                }).eq('id', att_id).execute()
                return jsonify({'success': True})
            return jsonify({'error': 'Invalid action'}), 400
        except Exception as e:
            print(f'Error recording attendance: {e}')
            return jsonify({'error': str(e)}), 500


# --- Resident Vehicles ---

@app.route('/api/rwa/vehicles', methods=['GET', 'POST'])
@visitor_login_required
def api_rwa_vehicles():
    if not supabase:
        return jsonify([]), 500
    user, role = _get_rwa_session_user()
    if request.method == 'GET':
        try:
            q = supabase.table('resident_vehicles').select('*, residents(name, block, floor, flat)')
            if role == 'resident':
                q = q.eq('resident_id', user['id'])
            res = q.order('created_at', desc=True).execute()
            rows = []
            for r in res.data or []:
                rd = r.get('residents') or {}
                rows.append({
                    'id': r['id'], 'resident_id': r['resident_id'],
                    'resident_name': rd.get('name'), 'block': rd.get('block'),
                    'floor': rd.get('floor'), 'flat': rd.get('flat'),
                    'vehicle_number': r['vehicle_number'], 'vehicle_type': r.get('vehicle_type')
                })
            return jsonify(rows)
        except Exception as e:
            print(f'Error fetching vehicles: {e}')
            return jsonify([]), 500
    else:
        if role != 'resident':
            return jsonify({'error': 'Only residents can add vehicles'}), 403
        body = request.get_json() or {}
        if not body.get('vehicle_number'):
            return jsonify({'error': 'vehicle_number is required'}), 400
        try:
            row = {
                'resident_id': user['id'],
                'vehicle_number': body['vehicle_number'].upper().strip(),
                'vehicle_type': body.get('vehicle_type', ''),
            }
            res = supabase.table('resident_vehicles').insert(row).execute()
            return jsonify({'success': True, 'id': res.data[0]['id'] if res.data else None})
        except Exception as e:
            if 'duplicate' in str(e).lower() or 'unique' in str(e).lower():
                return jsonify({'error': 'Vehicle number already registered'}), 409
            print(f'Error adding vehicle: {e}')
            return jsonify({'error': str(e)}), 500


@app.route('/api/rwa/vehicle-search')
@visitor_login_required
def api_rwa_vehicle_search():
    if not supabase:
        return jsonify([]), 500
    number = request.args.get('number', '').strip().upper()
    if not number:
        return jsonify([]), 400
    try:
        results = []
        # Search resident_vehicles
        rv_res = supabase.table('resident_vehicles').select(
            '*, residents(name, mobile, block, floor, flat)'
        ).ilike('vehicle_number', f'%{number}%').execute()
        for r in rv_res.data or []:
            rd = r.get('residents') or {}
            results.append({
                'source': 'resident', 'vehicle_number': r['vehicle_number'],
                'vehicle_type': r.get('vehicle_type'),
                'resident_name': rd.get('name'), 'mobile': rd.get('mobile'),
                'block': rd.get('block'), 'floor': rd.get('floor'), 'flat': rd.get('flat')
            })
        # Search visitor_requests
        vr_res = supabase.table('visitor_requests').select(
            '*, residents(name, mobile, block, floor, flat)'
        ).ilike('vehicle_number', f'%{number}%').order('created_at', desc=True).limit(20).execute()
        for r in vr_res.data or []:
            rd = r.get('residents') or {}
            results.append({
                'source': 'visitor', 'vehicle_number': r.get('vehicle_number', ''),
                'visitor_name': r.get('visitor_name'), 'visitor_mobile': r.get('visitor_mobile'),
                'status': r.get('status'), 'purpose': r.get('purpose'),
                'resident_name': rd.get('name'), 'mobile': rd.get('mobile'),
                'block': rd.get('block'), 'floor': rd.get('floor'), 'flat': rd.get('flat'),
                'entry_time': r.get('entry_time'), 'exit_time': r.get('exit_time')
            })
        return jsonify(results)
    except Exception as e:
        print(f'Error searching vehicles: {e}')
        return jsonify([]), 500


# --- Kids Checkout ---

@app.route('/api/rwa/kids-checkout', methods=['POST', 'GET'])
@visitor_login_required
def api_rwa_kids_checkout():
    if not supabase:
        return jsonify([]), 500
    user, role = _get_rwa_session_user()
    if request.method == 'GET':
        try:
            q = supabase.table('kids_checkout').select('*, residents(name, block, floor, flat)')
            if role == 'resident':
                q = q.eq('resident_id', user['id'])
            res = q.order('created_at', desc=True).limit(50).execute()
            rows = []
            for r in res.data or []:
                rd = r.get('residents') or {}
                rows.append({
                    'id': r['id'], 'resident_id': r['resident_id'],
                    'resident_name': rd.get('name'), 'block': rd.get('block'),
                    'floor': rd.get('floor'), 'flat': rd.get('flat'),
                    'child_name': r['child_name'], 'picked_up_by': r['picked_up_by'],
                    'otp_verified_at': r.get('otp_verified_at'),
                    'created_at': r.get('created_at')
                })
            return jsonify(rows)
        except Exception as e:
            print(f'Error fetching kids checkout: {e}')
            return jsonify([]), 500
    else:
        body = request.get_json() or {}
        if not body.get('resident_id') or not body.get('child_name') or not body.get('picked_up_by'):
            return jsonify({'error': 'resident_id, child_name, and picked_up_by are required'}), 400
        try:
            code = generate_otp()
            row = {
                'resident_id': body['resident_id'],
                'child_name': body['child_name'],
                'picked_up_by': body['picked_up_by'],
                'otp_code': code,
            }
            res = supabase.table('kids_checkout').insert(row).execute()
            kid_id = res.data[0]['id']
            # Send OTP to resident
            r_res = supabase.table('residents').select('mobile').eq('id', body['resident_id']).execute()
            mobile = r_res.data[0]['mobile'] if r_res.data else ''
            if mobile:
                send_otp(mobile, code)
            return jsonify({'success': True, 'id': kid_id, 'otp': code})
        except Exception as e:
            print(f'Error creating kids checkout: {e}')
            return jsonify({'error': str(e)}), 500


@app.route('/api/rwa/kids-checkout/<kid_id>/verify', methods=['POST'])
@visitor_login_required
def api_rwa_kids_checkout_verify(kid_id):
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    body = request.get_json() or {}
    code = body.get('otp', '').strip()
    if not code:
        return jsonify({'error': 'otp is required'}), 400
    try:
        res = supabase.table('kids_checkout').select('*').eq('id', kid_id).execute()
        if not res.data:
            return jsonify({'error': 'Record not found'}), 404
        row = res.data[0]
        if row.get('otp_verified_at'):
            return jsonify({'error': 'Already verified'}), 400
        if row.get('otp_code') != code:
            return jsonify({'error': 'Invalid OTP'}), 400
        user, role = _get_rwa_session_user()
        security_id = user.get('id') if role == 'security' else None
        supabase.table('kids_checkout').update({
            'otp_verified_at': now_ist().isoformat(),
            'security_id': security_id
        }).eq('id', kid_id).execute()
        return jsonify({'success': True})
    except Exception as e:
        print(f'Error verifying kids checkout: {e}')
        return jsonify({'error': str(e)}), 500


# --- Directory ---

@app.route('/api/rwa/directory')
@visitor_login_required
def api_rwa_directory():
    if not supabase:
        return jsonify([]), 500
    try:
        res = supabase.table('residents').select(
            'id, name, mobile, block, floor, flat, directory_opt_in'
        ).eq('active', True).order('block').order('floor').order('flat').execute()
        rows = []
        for r in res.data or []:
            row = {
                'id': r['id'], 'name': r['name'],
                'block': r['block'], 'floor': r['floor'], 'flat': r['flat'],
            }
            if r.get('directory_opt_in'):
                row['mobile'] = r['mobile']
            else:
                row['mobile'] = '****' + r['mobile'][-4:] if r.get('mobile') and len(r['mobile']) >= 4 else 'Hidden'
            rows.append(row)
        return jsonify(rows)
    except Exception as e:
        print(f'Error fetching directory: {e}')
        return jsonify([]), 500


@app.route('/api/rwa/directory/opt-in', methods=['POST'])
@visitor_login_required
def api_rwa_directory_opt_in():
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    user, role = _get_rwa_session_user()
    if role != 'resident':
        return jsonify({'error': 'Only residents can update opt-in'}), 403
    body = request.get_json() or {}
    try:
        supabase.table('residents').update({
            'directory_opt_in': body.get('opt_in', False)
        }).eq('id', user['id']).execute()
        return jsonify({'success': True})
    except Exception as e:
        print(f'Error updating directory opt-in: {e}')
        return jsonify({'error': str(e)}), 500


# --- Pre-approved visitor requests ---

@app.route('/api/rwa/pre-approve', methods=['POST'])
@visitor_login_required
def api_rwa_pre_approve():
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    user, role = _get_rwa_session_user()
    if role != 'resident':
        return jsonify({'error': 'Only residents can pre-approve'}), 403
    body = request.get_json() or {}
    if not body.get('visitor_name'):
        return jsonify({'error': 'visitor_name is required'}), 400
    try:
        row = {
            'resident_id': user['id'],
            'visitor_name': body['visitor_name'],
            'visitor_mobile': body.get('visitor_mobile', ''),
            'purpose': body.get('purpose', ''),
            'visitor_count': int(body.get('visitor_count', 1) or 1),
            'vehicle_number': body.get('vehicle_number', ''),
            'status': 'approved',
            'is_pre_approved': True,
            'otp_code': generate_otp(),
            'entry_time': now_ist().isoformat()
        }
        res = supabase.table('visitor_requests').insert(row).execute()
        visitor_id = res.data[0]['id'] if res.data else None
        return jsonify({'success': True, 'id': visitor_id})
    except Exception as e:
        print(f'Error pre-approving visitor: {e}')
        return jsonify({'error': str(e)}), 500


# --- QR: Visitor Pass Generation & Scanning ---

@app.route('/api/rwa/visitor-pass/<visitor_id>/qr')
@visitor_login_required
def api_rwa_visitor_pass_qr(visitor_id):
    """Generate a QR code image for a pre-approved visitor pass.
    The QR encodes a JSON payload with the visitor_request ID and a verification URL."""
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    try:
        res = supabase.table('visitor_requests').select(
            '*, residents(name, block, floor, flat)'
        ).eq('id', visitor_id).execute()
        if not res.data:
            return jsonify({'error': 'Visitor pass not found'}), 404
        vr = res.data[0]
        if vr.get('status') in ('rejected', 'completed'):
            return jsonify({'error': 'Pass is no longer valid'}), 400

        import qrcode as _qrcode
        import io as _io
        import json as _json

        qr_payload = _json.dumps({
            'type': 'rwa_visitor_pass',
            'id': vr['id'],
            'visitor_name': vr.get('visitor_name', ''),
            'resident_name': (vr.get('residents') or {}).get('name', ''),
            'flat': f"{(vr.get('residents') or {}).get('block','')}-{(vr.get('residents') or {}).get('floor','')}-{(vr.get('residents') or {}).get('flat','')}",
            'status': vr.get('status', ''),
            'issued_at': now_ist().isoformat(),
        })

        qr = _qrcode.QRCode(version=1, error_correction=_qrcode.constants.ERROR_CORRECT_M, box_size=10, border=4)
        qr.add_data(qr_payload)
        qr.make(fit=True)
        img = qr.make_image(fill_color='black', back_color='white')
        buf = _io.BytesIO()
        img.save(buf, format='PNG')
        buf.seek(0)

        from flask import send_file as _send_file
        return _send_file(buf, mimetype='image/png')
    except Exception as e:
        print(f'Error generating visitor QR: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/rwa/visitor-pass/scan', methods=['POST'])
@visitor_login_required
def api_rwa_visitor_pass_scan():
    """Security scans a visitor QR pass at the gate.
    Accepts the QR payload JSON, verifies the visitor_request exists and is pre-approved,
    and marks entry if status is 'approved' (not yet inside)."""
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    user, role = _get_rwa_session_user()
    if role not in ('security', 'admin', 'manager'):
        return jsonify({'error': 'Security only'}), 403
    body = request.get_json() or {}
    payload = body.get('payload')
    if not payload:
        return jsonify({'error': 'payload is required'}), 400

    import json as _json
    try:
        data = _json.loads(payload) if isinstance(payload, str) else payload
    except Exception:
        return jsonify({'error': 'Invalid QR payload'}), 400

    if data.get('type') != 'rwa_visitor_pass':
        return jsonify({'error': 'Not a visitor pass QR'}), 400

    visitor_id = data.get('id')
    if not visitor_id:
        return jsonify({'error': 'No pass ID in QR'}), 400

    try:
        res = supabase.table('visitor_requests').select(
            '*, residents(name, block, floor, flat)'
        ).eq('id', visitor_id).execute()
        if not res.data:
            return jsonify({'error': 'Pass not found'}), 404
        vr = res.data[0]
        rd = vr.get('residents') or {}

        if vr.get('status') in ('rejected', 'completed'):
            return jsonify({'error': 'Pass is no longer valid'}), 409

        if vr.get('status') == 'inside':
            return jsonify({'error': 'Visitor already inside', 'visitor_name': vr.get('visitor_name')}), 409

        if vr.get('status') == 'completed':
            return jsonify({'error': 'Pass already used / completed'}), 409

        # Mark entry
        supabase.table('visitor_requests').update({
            'status': 'inside',
            'entry_time': now_ist().isoformat(),
            'security_id': user.get('id') if role == 'security' else None,
        }).eq('id', visitor_id).execute()

        return jsonify({
            'success': True,
            'visitor_name': vr.get('visitor_name'),
            'visitor_mobile': vr.get('visitor_mobile'),
            'purpose': vr.get('purpose'),
            'vehicle_number': vr.get('vehicle_number'),
            'resident_name': rd.get('name'),
            'flat': f"{rd.get('block','')}-{rd.get('floor','')}-{rd.get('flat','')}",
            'visitor_count': vr.get('visitor_count', 1),
        })
    except Exception as e:
        print(f'Error scanning visitor pass: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/rwa/pre-approved-passes')
@visitor_login_required
def api_rwa_pre_approved_passes():
    """List pre-approved visitor passes for QR pass display (resident view)."""
    if not supabase:
        return jsonify([]), 500
    user, role = _get_rwa_session_user()
    try:
        q = supabase.table('visitor_requests').select(
            '*, residents(name, block, floor, flat)'
        ).eq('is_pre_approved', True)
        if role == 'resident':
            q = q.eq('resident_id', user['id'])
        res = q.order('created_at', desc=True).limit(20).execute()
        rows = []
        for r in res.data or []:
            rd = r.get('residents') or {}
            rows.append({
                'id': r['id'], 'visitor_name': r.get('visitor_name'),
                'visitor_mobile': r.get('visitor_mobile'), 'purpose': r.get('purpose'),
                'vehicle_number': r.get('vehicle_number'), 'status': r.get('status'),
                'resident_name': rd.get('name'),
                'flat': f"{rd.get('block','')}-{rd.get('floor','')}-{rd.get('flat','')}",
                'created_at': r.get('created_at'),
            })
        return jsonify(rows)
    except Exception as e:
        print(f'Error fetching pre-approved passes: {e}')
        return jsonify([]), 500


# ============================================================
# RWA MODULE: Prime Tier (Phase 3)
# ============================================================

# --- Complaints ---

@app.route('/api/rwa/complaints', methods=['GET', 'POST'])
@visitor_login_required
def api_rwa_complaints():
    if not supabase:
        return jsonify([]), 500
    user, role = _get_rwa_session_user()
    if request.method == 'GET':
        try:
            q = supabase.table('complaints').select('*, residents(name, block, floor, flat)')
            if role == 'resident':
                q = q.eq('resident_id', user['id'])
            res = q.order('created_at', desc=True).execute()
            rows = []
            for r in res.data or []:
                rd = r.get('residents') or {}
                rows.append({
                    'id': r['id'], 'resident_id': r['resident_id'],
                    'resident_name': rd.get('name'), 'block': rd.get('block'),
                    'floor': rd.get('floor'), 'flat': rd.get('flat'),
                    'category': r.get('category'), 'description': r.get('description'),
                    'photo_url': r.get('photo_url'), 'status': r.get('status'),
                    'assigned_to': r.get('assigned_to'), 'created_at': r.get('created_at'),
                    'updated_at': r.get('updated_at')
                })
            return jsonify(rows)
        except Exception as e:
            print(f'Error fetching complaints: {e}')
            return jsonify([]), 500
    else:
        body = request.get_json() or {}
        if not body.get('description'):
            return jsonify({'error': 'description is required'}), 400
        if role != 'resident':
            return jsonify({'error': 'Only residents can create complaints'}), 403
        try:
            row = {
                'resident_id': user['id'],
                'category': body.get('category', ''),
                'description': body['description'],
                'photo_url': body.get('photo_url', ''),
            }
            res = supabase.table('complaints').insert(row).execute()
            return jsonify({'success': True, 'id': res.data[0]['id'] if res.data else None})
        except Exception as e:
            print(f'Error creating complaint: {e}')
            return jsonify({'error': str(e)}), 500


@app.route('/api/rwa/complaints/<complaint_id>', methods=['PATCH'])
@visitor_login_required
def api_rwa_complaints_patch(complaint_id):
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    body = request.get_json() or {}
    allowed = {}
    if 'status' in body and body['status'] in ('open', 'in_progress', 'resolved', 'closed'):
        allowed['status'] = body['status']
    if 'assigned_to' in body:
        allowed['assigned_to'] = body['assigned_to']
    if not allowed:
        return jsonify({'error': 'Nothing to update'}), 400
    allowed['updated_at'] = now_ist().isoformat()
    try:
        supabase.table('complaints').update(allowed).eq('id', complaint_id).execute()
        return jsonify({'success': True})
    except Exception as e:
        print(f'Error updating complaint: {e}')
        return jsonify({'error': str(e)}), 500


# --- Amenities ---

@app.route('/api/rwa/amenities', methods=['GET', 'POST', 'DELETE'])
@visitor_login_required
def api_rwa_amenities():
    if not supabase:
        return jsonify([]), 500
    if request.method == 'GET':
        try:
            res = supabase.table('amenities').select('*').eq('active', True).order('name').execute()
            return jsonify(res.data or [])
        except Exception as e:
            print(f'Error fetching amenities: {e}')
            return jsonify([]), 500
    elif request.method == 'DELETE':
        user, role = _get_rwa_session_user()
        if role not in ('admin', 'manager'):
            return jsonify({'error': 'Admin only'}), 403
        amenity_id = request.args.get('id')
        if not amenity_id:
            return jsonify({'error': 'id required'}), 400
        try:
            supabase.table('amenities').update({'active': False}).eq('id', amenity_id).execute()
            return jsonify({'success': True})
        except Exception as e:
            return jsonify({'error': str(e)}), 500
    else:
        user, role = _get_rwa_session_user()
        if role not in ('admin', 'manager'):
            return jsonify({'error': 'Admin only'}), 403
        body = request.get_json() or {}
        if not body.get('name'):
            return jsonify({'error': 'name is required'}), 400
        try:
            res = supabase.table('amenities').insert({
                'name': body['name'], 'description': body.get('description', '')
            }).execute()
            return jsonify({'success': True, 'id': res.data[0]['id'] if res.data else None})
        except Exception as e:
            return jsonify({'error': str(e)}), 500


@app.route('/api/rwa/amenity-bookings', methods=['GET', 'POST'])
@visitor_login_required
def api_rwa_amenity_bookings():
    if not supabase:
        return jsonify([]), 500
    user, role = _get_rwa_session_user()
    if request.method == 'GET':
        try:
            q = supabase.table('amenity_bookings').select('*, amenities(name), residents(name)')
            if role == 'resident':
                q = q.eq('resident_id', user['id'])
            amenity_id = request.args.get('amenity_id')
            if amenity_id:
                q = q.eq('amenity_id', amenity_id)
            res = q.order('booking_date', desc=True).execute()
            rows = []
            for r in res.data or []:
                a = r.get('amenities') or {}
                rd = r.get('residents') or {}
                rows.append({
                    'id': r['id'], 'amenity_id': r['amenity_id'],
                    'amenity_name': a.get('name'), 'resident_name': rd.get('name'),
                    'booking_date': r.get('booking_date'), 'slot': r.get('slot'),
                    'status': r.get('status'), 'created_at': r.get('created_at')
                })
            return jsonify(rows)
        except Exception as e:
            print(f'Error fetching bookings: {e}')
            return jsonify([]), 500
    else:
        if role != 'resident':
            return jsonify({'error': 'Only residents can book'}), 403
        body = request.get_json() or {}
        if not body.get('amenity_id') or not body.get('booking_date') or not body.get('slot'):
            return jsonify({'error': 'amenity_id, booking_date, and slot are required'}), 400
        try:
            row = {
                'amenity_id': body['amenity_id'],
                'resident_id': user['id'],
                'booking_date': body['booking_date'],
                'slot': body['slot'],
            }
            res = supabase.table('amenity_bookings').insert(row).execute()
            return jsonify({'success': True, 'id': res.data[0]['id'] if res.data else None})
        except Exception as e:
            err = str(e).lower()
            if 'duplicate' in err or 'unique' in err or 'violates' in err:
                return jsonify({'error': 'Slot already booked for this date'}), 409
            print(f'Error booking amenity: {e}')
            return jsonify({'error': str(e)}), 500


# --- Notices ---

@app.route('/api/rwa/notices', methods=['GET', 'POST'])
@visitor_login_required
def api_rwa_notices():
    if not supabase:
        return jsonify([]), 500
    if request.method == 'GET':
        try:
            user, role = _get_rwa_session_user()
            res = supabase.table('notices').select('*').order('pinned', desc=True).order('created_at', desc=True).execute()
            rows = res.data or []
            # Filter by scope for residents
            if role == 'resident' and user:
                ub, uf = user.get('block', ''), user.get('floor', '')
                filtered = []
                for n in rows:
                    scope = n.get('target_scope', 'all')
                    if scope == 'all':
                        filtered.append(n)
                    elif scope == 'block' and n.get('target_value') == ub:
                        filtered.append(n)
                    elif scope == 'floor' and n.get('target_value') == uf:
                        filtered.append(n)
                rows = filtered
            return jsonify(rows)
        except Exception as e:
            print(f'Error fetching notices: {e}')
            return jsonify([]), 500
    else:
        user, role = _get_rwa_session_user()
        if role not in ('admin', 'manager', 'security'):
            return jsonify({'error': 'Admin/security only'}), 403
        body = request.get_json() or {}
        if not body.get('title') or not body.get('body'):
            return jsonify({'error': 'title and body are required'}), 400
        try:
            row = {
                'title': body['title'],
                'body': body['body'],
                'target_scope': body.get('target_scope', 'all'),
                'target_value': body.get('target_value', ''),
                'posted_by': user.get('name', '') or user.get('email', ''),
                'pinned': body.get('pinned', False),
            }
            res = supabase.table('notices').insert(row).execute()
            return jsonify({'success': True, 'id': res.data[0]['id'] if res.data else None})
        except Exception as e:
            print(f'Error creating notice: {e}')
            return jsonify({'error': str(e)}), 500


# --- Home Planner ---

@app.route('/api/rwa/home-planner', methods=['GET', 'POST', 'PATCH'])
@visitor_login_required
def api_rwa_home_planner():
    if not supabase:
        return jsonify([]), 500
    user, role = _get_rwa_session_user()
    if role != 'resident':
        return jsonify({'error': 'Resident only'}), 403
    if request.method == 'GET':
        try:
            res = supabase.table('home_planner_tasks').select('*').eq(
                'resident_id', user['id']).order('done').order('due_date').execute()
            return jsonify(res.data or [])
        except Exception as e:
            print(f'Error fetching planner: {e}')
            return jsonify([]), 500
    elif request.method == 'POST':
        body = request.get_json() or {}
        if not body.get('title'):
            return jsonify({'error': 'title is required'}), 400
        try:
            res = supabase.table('home_planner_tasks').insert({
                'resident_id': user['id'],
                'title': body['title'],
                'due_date': body.get('due_date'),
            }).execute()
            return jsonify({'success': True, 'id': res.data[0]['id'] if res.data else None})
        except Exception as e:
            return jsonify({'error': str(e)}), 500
    else:
        task_id = request.args.get('id')
        if not task_id:
            return jsonify({'error': 'id required'}), 400
        body = request.get_json() or {}
        allowed = {k: v for k, v in body.items() if k in ('title', 'due_date', 'done')}
        if not allowed:
            return jsonify({'error': 'Nothing to update'}), 400
        try:
            supabase.table('home_planner_tasks').update(allowed).eq('id', task_id).execute()
            return jsonify({'success': True})
        except Exception as e:
            return jsonify({'error': str(e)}), 500


# --- Parking ---

@app.route('/api/rwa/parking', methods=['GET', 'POST'])
@visitor_login_required
def api_rwa_parking():
    if not supabase:
        return jsonify([]), 500
    if request.method == 'GET':
        try:
            res = supabase.table('parking_slots').select('*, residents(name, mobile)').order('slot_number').execute()
            rows = []
            for r in res.data or []:
                rd = r.get('residents') or {}
                rows.append({
                    'id': r['id'], 'slot_number': r['slot_number'],
                    'owner_name': rd.get('name'), 'owner_mobile': rd.get('mobile'),
                    'status': r['status']
                })
            return jsonify(rows)
        except Exception as e:
            print(f'Error fetching parking: {e}')
            return jsonify([]), 500
    else:
        user, role = _get_rwa_session_user()
        if role not in ('admin', 'manager'):
            return jsonify({'error': 'Admin only'}), 403
        body = request.get_json() or {}
        if not body.get('slot_number'):
            return jsonify({'error': 'slot_number is required'}), 400
        try:
            row = {
                'slot_number': body['slot_number'],
                'status': body.get('status', 'owned'),
            }
            if body.get('owner_resident_id'):
                row['owner_resident_id'] = body['owner_resident_id']
            res = supabase.table('parking_slots').insert(row).execute()
            return jsonify({'success': True, 'id': res.data[0]['id'] if res.data else None})
        except Exception as e:
            return jsonify({'error': str(e)}), 500


@app.route('/api/rwa/parking/rent', methods=['POST'])
@visitor_login_required
def api_rwa_parking_rent():
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    user, role = _get_rwa_session_user()
    if role != 'resident':
        return jsonify({'error': 'Resident only'}), 403
    body = request.get_json() or {}
    if not body.get('slot_id') or not body.get('start_date'):
        return jsonify({'error': 'slot_id and start_date are required'}), 400
    try:
        res = supabase.table('parking_rentals').insert({
            'slot_id': body['slot_id'],
            'renter_resident_id': user['id'],
            'start_date': body['start_date'],
            'end_date': body.get('end_date'),
        }).execute()
        supabase.table('parking_slots').update({'status': 'rented'}).eq('id', body['slot_id']).execute()
        return jsonify({'success': True, 'id': res.data[0]['id'] if res.data else None})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# --- SOS ---

@app.route('/api/rwa/sos', methods=['POST'])
@visitor_login_required
def api_rwa_sos_create():
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    user, role = _get_rwa_session_user()
    if role != 'resident':
        return jsonify({'error': 'Resident only'}), 403
    try:
        res = supabase.table('sos_alerts').insert({
            'resident_id': user['id'],
            'triggered_at': now_ist().isoformat(),
        }).execute()
        return jsonify({'success': True, 'id': res.data[0]['id'] if res.data else None})
    except Exception as e:
        print(f'Error creating SOS: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/rwa/sos/active')
@visitor_login_required
def api_rwa_sos_active():
    if not supabase:
        return jsonify([]), 500
    try:
        res = supabase.table('sos_alerts').select('*, residents(name, mobile, block, floor, flat)').is_(
            'acknowledged_at', 'null').order('triggered_at', desc=True).execute()
        rows = []
        for r in res.data or []:
            rd = r.get('residents') or {}
            rows.append({
                'id': r['id'], 'resident_id': r['resident_id'],
                'resident_name': rd.get('name'), 'mobile': rd.get('mobile'),
                'block': rd.get('block'), 'floor': rd.get('floor'), 'flat': rd.get('flat'),
                'triggered_at': r.get('triggered_at'), 'notes': r.get('notes')
            })
        return jsonify(rows)
    except Exception as e:
        print(f'Error fetching active SOS: {e}')
        return jsonify([]), 500


@app.route('/api/rwa/sos/<sos_id>/acknowledge', methods=['PATCH'])
@visitor_login_required
def api_rwa_sos_acknowledge(sos_id):
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    user, role = _get_rwa_session_user()
    if role not in ('security', 'admin', 'manager'):
        return jsonify({'error': 'Security/admin only'}), 403
    body = request.get_json() or {}
    try:
        supabase.table('sos_alerts').update({
            'acknowledged_by': user.get('id'),
            'acknowledged_at': now_ist().isoformat(),
            'notes': body.get('notes', '')
        }).eq('id', sos_id).execute()
        return jsonify({'success': True})
    except Exception as e:
        print(f'Error acknowledging SOS: {e}')
        return jsonify({'error': str(e)}), 500


# --- e-Intercom (v1: call request ping) ---

@app.route('/api/rwa/intercom', methods=['POST', 'GET'])
@visitor_login_required
def api_rwa_intercom():
    if not supabase:
        return jsonify([]), 500
    user, role = _get_rwa_session_user()
    if request.method == 'GET':
        try:
            q = supabase.table('intercom_calls').select('*').order('created_at', desc=True).limit(20)
            if role == 'resident':
                q = q.eq('caller_id', user['id']).or_(f'target_type.eq.security,target_type.eq.gate')
            res = q.execute()
            return jsonify(res.data or [])
        except Exception as e:
            print(f'Error fetching intercom calls: {e}')
            return jsonify([]), 500
    else:
        body = request.get_json() or {}
        if not body.get('target_type'):
            return jsonify({'error': 'target_type is required'}), 400
        try:
            row = {
                'caller_id': user['id'],
                'caller_type': 'resident' if role == 'resident' else 'security',
                'target_type': body['target_type'],
                'target_id': body.get('target_id'),
                'status': 'ringing',
            }
            res = supabase.table('intercom_calls').insert(row).execute()
            return jsonify({'success': True, 'id': res.data[0]['id'] if res.data else None})
        except Exception as e:
            print(f'Error creating intercom call: {e}')
            return jsonify({'error': str(e)}), 500


@app.route('/api/rwa/intercom/<call_id>/answer', methods=['PATCH'])
@visitor_login_required
def api_rwa_intercom_answer(call_id):
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    try:
        supabase.table('intercom_calls').update({
            'status': 'answered',
            'answered_at': now_ist().isoformat()
        }).eq('id', call_id).execute()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============================================================
# RWA MODULE: Elite Tier (Phase 4)
# ============================================================

# --- Patrol ---

@app.route('/api/rwa/patrol/checkpoints', methods=['GET', 'POST'])
@visitor_login_required
def api_rwa_patrol_checkpoints():
    if not supabase:
        return jsonify([]), 500
    if request.method == 'GET':
        try:
            res = supabase.table('patrol_checkpoints').select('*').eq('active', True).order('name').execute()
            return jsonify(res.data or [])
        except Exception as e:
            print(f'Error fetching checkpoints: {e}')
            return jsonify([]), 500
    else:
        user, role = _get_rwa_session_user()
        if role not in ('admin', 'manager'):
            return jsonify({'error': 'Admin only'}), 403
        body = request.get_json() or {}
        if not body.get('name'):
            return jsonify({'error': 'name is required'}), 400
        try:
            res = supabase.table('patrol_checkpoints').insert({
                'name': body['name'],
                'qr_code': body.get('qr_code', ''),
            }).execute()
            return jsonify({'success': True, 'id': res.data[0]['id'] if res.data else None})
        except Exception as e:
            return jsonify({'error': str(e)}), 500


@app.route('/api/rwa/patrol/log', methods=['POST', 'GET'])
@visitor_login_required
def api_rwa_patrol_log():
    if not supabase:
        return jsonify([]), 500
    if request.method == 'GET':
        try:
            res = supabase.table('patrol_logs').select(
                '*, patrol_checkpoints(name), security_users(name)'
            ).order('scanned_at', desc=True).limit(100).execute()
            rows = []
            for r in res.data or []:
                cp = r.get('patrol_checkpoints') or {}
                sec = r.get('security_users') or {}
                rows.append({
                    'id': r['id'], 'checkpoint_id': r['checkpoint_id'],
                    'checkpoint_name': cp.get('name'), 'security_name': sec.get('name'),
                    'scanned_at': r.get('scanned_at'), 'notes': r.get('notes')
                })
            return jsonify(rows)
        except Exception as e:
            print(f'Error fetching patrol logs: {e}')
            return jsonify([]), 500
    else:
        user, role = _get_rwa_session_user()
        if role not in ('security', 'admin', 'manager'):
            return jsonify({'error': 'Security only'}), 403
        body = request.get_json() or {}
        if not body.get('checkpoint_id'):
            return jsonify({'error': 'checkpoint_id is required'}), 400
        try:
            res = supabase.table('patrol_logs').insert({
                'checkpoint_id': body['checkpoint_id'],
                'security_id': user.get('id'),
                'notes': body.get('notes', ''),
            }).execute()
            return jsonify({'success': True, 'id': res.data[0]['id'] if res.data else None})
        except Exception as e:
            print(f'Error logging patrol: {e}')
            return jsonify({'error': str(e)}), 500


@app.route('/api/rwa/patrol/checkpoints/<cp_id>/qr')
@visitor_login_required
def api_rwa_patrol_checkpoint_qr(cp_id):
    """Generate a QR code image for a patrol checkpoint.
    The QR encodes a JSON payload with the checkpoint ID and name.
    Print and laminate at the physical checkpoint location."""
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    try:
        res = supabase.table('patrol_checkpoints').select('*').eq('id', cp_id).execute()
        if not res.data:
            return jsonify({'error': 'Checkpoint not found'}), 404
        cp = res.data[0]

        import qrcode as _qrcode
        import io as _io
        import json as _json

        qr_payload = _json.dumps({
            'type': 'rwa_patrol_checkpoint',
            'id': cp['id'],
            'name': cp.get('name', ''),
            'qr_code': cp.get('qr_code', ''),
        })

        qr = _qrcode.QRCode(version=1, error_correction=_qrcode.constants.ERROR_CORRECT_M, box_size=10, border=4)
        qr.add_data(qr_payload)
        qr.make(fit=True)
        img = qr.make_image(fill_color='black', back_color='white')
        buf = _io.BytesIO()
        img.save(buf, format='PNG')
        buf.seek(0)

        from flask import send_file as _send_file
        return _send_file(buf, mimetype='image/png')
    except Exception as e:
        print(f'Error generating patrol QR: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/rwa/patrol/scan', methods=['POST'])
@visitor_login_required
def api_rwa_patrol_scan():
    """Security scans a patrol checkpoint QR code.
    Parses the QR payload, verifies the checkpoint exists, and logs the patrol scan."""
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    user, role = _get_rwa_session_user()
    if role not in ('security', 'admin', 'manager'):
        return jsonify({'error': 'Security only'}), 403
    body = request.get_json() or {}
    payload = body.get('payload')
    if not payload:
        return jsonify({'error': 'payload is required'}), 400

    import json as _json
    try:
        data = _json.loads(payload) if isinstance(payload, str) else payload
    except Exception:
        return jsonify({'error': 'Invalid QR payload'}), 400

    if data.get('type') != 'rwa_patrol_checkpoint':
        return jsonify({'error': 'Not a patrol checkpoint QR'}), 400

    checkpoint_id = data.get('id')
    if not checkpoint_id:
        return jsonify({'error': 'No checkpoint ID in QR'}), 400

    try:
        cp_res = supabase.table('patrol_checkpoints').select('*').eq('id', checkpoint_id).execute()
        if not cp_res.data:
            return jsonify({'error': 'Checkpoint not found'}), 404
        cp = cp_res.data[0]

        log_res = supabase.table('patrol_logs').insert({
            'checkpoint_id': checkpoint_id,
            'security_id': user.get('id'),
            'scanned_at': now_ist().isoformat(),
            'notes': body.get('notes', ''),
        }).execute()

        return jsonify({
            'success': True,
            'checkpoint_name': cp.get('name', ''),
            'scanned_at': now_ist().isoformat(),
            'log_id': log_res.data[0]['id'] if log_res.data else None,
        })
    except Exception as e:
        print(f'Error scanning patrol QR: {e}')
        return jsonify({'error': str(e)}), 500


# --- Maintenance Invoices ---

@app.route('/api/rwa/invoices', methods=['GET', 'POST'])
@visitor_login_required
def api_rwa_invoices():
    if not supabase:
        return jsonify([]), 500
    user, role = _get_rwa_session_user()
    if request.method == 'GET':
        try:
            q = supabase.table('rwa_invoices').select('*, flats(block, floor, flat_number), residents(name, mobile)')
            if role == 'resident':
                q = q.eq('resident_id', user['id'])
            res = q.order('created_at', desc=True).execute()
            rows = []
            for r in res.data or []:
                f = r.get('flats') or {}
                rd = r.get('residents') or {}
                rows.append({
                    'id': r['id'], 'invoice_number': r['invoice_number'],
                    'billing_month': r.get('billing_month'), 'amount': r.get('amount'),
                    'due_date': r.get('due_date'), 'status': r.get('status'),
                    'flat': f"{f.get('block','')}-{f.get('floor','')}-{f.get('flat_number','')}" if f else '-',
                    'resident_name': rd.get('name'), 'resident_mobile': rd.get('mobile'),
                    'created_at': r.get('created_at')
                })
            return jsonify(rows)
        except Exception as e:
            print(f'Error fetching RWA invoices: {e}')
            return jsonify([]), 500
    else:
        if role not in ('admin', 'manager'):
            return jsonify({'error': 'Admin only'}), 403
        body = request.get_json() or {}
        if not body.get('billing_month') or body.get('amount') is None:
            return jsonify({'error': 'billing_month and amount are required'}), 400
        try:
            import uuid as _uuid
            invoice_number = f'RWA-{body["billing_month"].replace("-", "")}-{_uuid.uuid4().hex[:6].upper()}'
            row = {
                'invoice_number': invoice_number,
                'billing_month': body['billing_month'],
                'amount': body['amount'],
                'due_date': body.get('due_date'),
                'status': 'unpaid',
            }
            if body.get('flat_id'):
                row['flat_id'] = body['flat_id']
            if body.get('resident_id'):
                row['resident_id'] = body['resident_id']
            res = supabase.table('rwa_invoices').insert(row).execute()
            return jsonify({'success': True, 'id': res.data[0]['id'] if res.data else None, 'invoice_number': invoice_number})
        except Exception as e:
            print(f'Error creating invoice: {e}')
            return jsonify({'error': str(e)}), 500


@app.route('/api/rwa/invoices/<invoice_id>', methods=['PATCH'])
@visitor_login_required
def api_rwa_invoices_patch(invoice_id):
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    user, role = _get_rwa_session_user()
    if role not in ('admin', 'manager'):
        return jsonify({'error': 'Admin only'}), 403
    body = request.get_json() or {}
    allowed = {k: v for k, v in body.items() if k in ('amount', 'due_date', 'status')}
    if not allowed:
        return jsonify({'error': 'Nothing to update'}), 400
    try:
        supabase.table('rwa_invoices').update(allowed).eq('id', invoice_id).execute()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# --- Payments ---

@app.route('/api/rwa/payments', methods=['GET', 'POST'])
@visitor_login_required
def api_rwa_payments():
    if not supabase:
        return jsonify([]), 500
    user, role = _get_rwa_session_user()
    if request.method == 'GET':
        try:
            q = supabase.table('rwa_payments').select('*, rwa_invoices(invoice_number, billing_month, resident_id)')
            if role == 'resident':
                q = q.filter('rwa_invoices.resident_id', 'eq', user['id'])
            res = q.order('created_at', desc=True).execute()
            rows = []
            for r in res.data or []:
                inv = r.get('rwa_invoices') or {}
                rows.append({
                    'id': r['id'], 'invoice_id': r['invoice_id'],
                    'invoice_number': inv.get('invoice_number'), 'billing_month': inv.get('billing_month'),
                    'amount': r.get('amount'), 'method': r.get('method'),
                    'status': r.get('status'), 'razorpay_payment_id': r.get('razorpay_payment_id'),
                    'created_at': r.get('created_at')
                })
            return jsonify(rows)
        except Exception as e:
            print(f'Error fetching payments: {e}')
            return jsonify([]), 500
    else:
        body = request.get_json() or {}
        if not body.get('invoice_id') or body.get('amount') is None:
            return jsonify({'error': 'invoice_id and amount are required'}), 400
        try:
            row = {
                'invoice_id': body['invoice_id'],
                'amount': body['amount'],
                'method': body.get('method', 'manual'),
                'status': body.get('status', 'success'),
            }
            if body.get('razorpay_order_id'):
                row['razorpay_order_id'] = body['razorpay_order_id']
            if body.get('razorpay_payment_id'):
                row['razorpay_payment_id'] = body['razorpay_payment_id']
            res = supabase.table('rwa_payments').insert(row).execute()
            if body.get('status', 'success') == 'success':
                supabase.table('rwa_invoices').update({'status': 'paid'}).eq('id', body['invoice_id']).execute()
            return jsonify({'success': True, 'id': res.data[0]['id'] if res.data else None})
        except Exception as e:
            print(f'Error recording payment: {e}')
            return jsonify({'error': str(e)}), 500


# --- Razorpay order creation (stub) ---

@app.route('/api/rwa/razorpay/create-order', methods=['POST'])
@visitor_login_required
def api_rwa_razorpay_create_order():
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    body = request.get_json() or {}
    if not body.get('invoice_id'):
        return jsonify({'error': 'invoice_id is required'}), 400
    try:
        inv_res = supabase.table('rwa_invoices').select('*').eq('id', body['invoice_id']).execute()
        if not inv_res.data:
            return jsonify({'error': 'Invoice not found'}), 404
        inv = inv_res.data[0]
        amount_paise = int(float(inv['amount']) * 100)
        # TODO: integrate actual Razorpay SDK when keys are available
        import uuid as _uuid
        order_id = f'order_{_uuid.uuid4().hex[:16]}'
        supabase.table('rwa_payments').insert({
            'invoice_id': body['invoice_id'],
            'amount': inv['amount'],
            'method': 'razorpay',
            'razorpay_order_id': order_id,
            'status': 'pending',
        }).execute()
        return jsonify({
            'order_id': order_id,
            'amount': amount_paise,
            'currency': 'INR',
            'invoice_number': inv['invoice_number'],
            'note': 'Razorpay integration pending — set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET env vars'
        })
    except Exception as e:
        print(f'Error creating Razorpay order: {e}')
        return jsonify({'error': str(e)}), 500


# --- Vendor Ledger ---

@app.route('/api/rwa/vendor-ledger', methods=['GET', 'POST'])
@visitor_login_required
def api_rwa_vendor_ledger():
    if not supabase:
        return jsonify([]), 500
    user, role = _get_rwa_session_user()
    if request.method == 'GET':
        try:
            res = supabase.table('rwa_vendor_ledger').select('*').order('created_at', desc=True).execute()
            return jsonify(res.data or [])
        except Exception as e:
            print(f'Error fetching vendor ledger: {e}')
            return jsonify([]), 500
    else:
        if role not in ('admin', 'manager'):
            return jsonify({'error': 'Admin only'}), 403
        body = request.get_json() or {}
        if not body.get('vendor_name') or body.get('invoice_amount') is None:
            return jsonify({'error': 'vendor_name and invoice_amount are required'}), 400
        try:
            paid = float(body.get('paid_amount', 0) or 0)
            total = float(body['invoice_amount'])
            status = 'paid' if paid >= total else ('partially_paid' if paid > 0 else 'unpaid')
            res = supabase.table('rwa_vendor_ledger').insert({
                'vendor_name': body['vendor_name'],
                'category': body.get('category', ''),
                'invoice_amount': total,
                'paid_amount': paid,
                'status': status,
                'notes': body.get('notes', ''),
            }).execute()
            return jsonify({'success': True, 'id': res.data[0]['id'] if res.data else None})
        except Exception as e:
            return jsonify({'error': str(e)}), 500


@app.route('/api/rwa/vendor-ledger/<entry_id>', methods=['PATCH'])
@visitor_login_required
def api_rwa_vendor_ledger_patch(entry_id):
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    user, role = _get_rwa_session_user()
    if role not in ('admin', 'manager'):
        return jsonify({'error': 'Admin only'}), 403
    body = request.get_json() or {}
    allowed = {k: v for k, v in body.items() if k in ('paid_amount', 'status', 'notes')}
    if not allowed:
        return jsonify({'error': 'Nothing to update'}), 400
    try:
        if 'paid_amount' in allowed:
            paid = float(allowed['paid_amount'])
            cur = supabase.table('rwa_vendor_ledger').select('invoice_amount').eq('id', entry_id).execute()
            if cur.data:
                total = float(cur.data[0]['invoice_amount'])
                allowed['status'] = 'paid' if paid >= total else ('partially_paid' if paid > 0 else 'unpaid')
        supabase.table('rwa_vendor_ledger').update(allowed).eq('id', entry_id).execute()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# --- Reports ---

@app.route('/api/rwa/reports/summary')
@requires_role('admin', 'manager')
def api_rwa_reports_summary():
    if not supabase:
        return jsonify({}), 500
    try:
        inv_res = supabase.table('rwa_invoices').select('amount, status').execute()
        invoices = inv_res.data or []
        total_billed = sum(float(i.get('amount', 0)) for i in invoices)
        total_paid = sum(float(i.get('amount', 0)) for i in invoices if i.get('status') == 'paid')
        total_unpaid = total_billed - total_paid

        pay_res = supabase.table('rwa_payments').select('amount, status').execute()
        payments = pay_res.data or []
        total_collected = sum(float(p.get('amount', 0)) for p in payments if p.get('status') == 'success')

        vl_res = supabase.table('rwa_vendor_ledger').select('invoice_amount, paid_amount, status').execute()
        vl = vl_res.data or []
        vendor_total = sum(float(v.get('invoice_amount', 0)) for v in vl)
        vendor_paid = sum(float(v.get('paid_amount', 0)) for v in vl)

        comp_res = supabase.table('complaints').select('status').execute()
        complaints = comp_res.data or []
        open_complaints = len([c for c in complaints if c.get('status') in ('open', 'in_progress')])

        patrol_res = supabase.table('patrol_logs').select('scanned_at').execute()
        patrol_logs = patrol_res.data or []
        cutoff = (now_ist() - timedelta(hours=24)).isoformat()
        recent_patrols = len([p for p in patrol_logs if (p.get('scanned_at') or '') > cutoff])

        return jsonify({
            'invoices': {
                'total_billed': total_billed,
                'total_paid': total_paid,
                'total_unpaid': total_unpaid,
                'count': len(invoices),
            },
            'payments': {
                'total_collected': total_collected,
                'count': len(payments),
            },
            'vendor_ledger': {
                'total_invoiced': vendor_total,
                'total_paid': vendor_paid,
                'outstanding': vendor_total - vendor_paid,
            },
            'complaints': {
                'open': open_complaints,
                'total': len(complaints),
            },
            'patrol': {
                'last_24h': recent_patrols,
                'total': len(patrol_logs),
            }
        })
    except Exception as e:
        print(f'Error generating report: {e}')
        return jsonify({}), 500


# ============================================================
# RERA Quarterly Progress Report (Form B) Module
# ============================================================

RERA_DEFAULT_THRESHOLDS = {
    'red': 0, 'yellow': 40, 'blue': 75, 'green': 100
}


def _rera_current_quarter():
    """Return (quarter_label, start_date, end_date, filing_deadline) for the current quarter."""
    now = now_ist()
    month = now.month
    year = now.year
    if month <= 3:
        q_label = f'{year}-Q1'
        q_start = date(year, 1, 1)
        q_end = date(year, 3, 31)
    elif month <= 6:
        q_label = f'{year}-Q2'
        q_start = date(year, 4, 1)
        q_end = date(year, 6, 30)
    elif month <= 9:
        q_label = f'{year}-Q3'
        q_start = date(year, 7, 1)
        q_end = date(year, 9, 30)
    else:
        q_label = f'{year}-Q4'
        q_start = date(year, 10, 1)
        q_end = date(year, 12, 31)
    filing_deadline = q_end + timedelta(days=15)
    return q_label, q_start, q_end, filing_deadline


def _rera_get_thresholds(venture_id):
    """Fetch color→pct thresholds, with per-venture overrides merging onto defaults."""
    thresholds = dict(RERA_DEFAULT_THRESHOLDS)
    if not supabase:
        return thresholds
    try:
        res = supabase.table('rera_color_thresholds').select('*').execute()
        for row in res.data or []:
            v_id = row.get('venture_id')
            if v_id is None:
                thresholds[row['color']] = float(row['pct_value'])
        # Venture-specific overrides
        for row in res.data or []:
            if row.get('venture_id') == venture_id and row.get('work_item') is None:
                thresholds[row['color']] = float(row['pct_value'])
    except Exception as e:
        print(f'Error fetching RERA thresholds: {e}')
    return thresholds


def _rera_compute_progress(venture_id, thresholds):
    """Compute % completion per block/floor from cell_data colors."""
    if not supabase:
        return {'blocks': [], 'overall_pct': 0}
    try:
        res = supabase.table('cell_data').select('*').execute()
        block_stats = {}
        total_weighted = 0
        total_cells = 0
        for row in res.data:
            d = row.get('data') or {}
            if d.get('venture_id') != venture_id:
                continue
            block = d.get('block', 'Unknown')
            floor = d.get('floor', 'Unknown')
            color = d.get('color', 'red')
            pct = thresholds.get(color, 0)
            key = block
            if key not in block_stats:
                block_stats[key] = {'block': block, 'floors': {}, 'total_pct': 0, 'cell_count': 0}
            floor_key = floor
            if floor_key not in block_stats[key]['floors']:
                block_stats[key]['floors'][floor_key] = {'floor': floor, 'total_pct': 0, 'cell_count': 0}
            block_stats[key]['floors'][floor_key]['total_pct'] += pct
            block_stats[key]['floors'][floor_key]['cell_count'] += 1
            block_stats[key]['total_pct'] += pct
            block_stats[key]['cell_count'] += 1
            total_weighted += pct
            total_cells += 1
        blocks = []
        for block_name, stats in sorted(block_stats.items()):
            block_pct = round(stats['total_pct'] / stats['cell_count'], 1) if stats['cell_count'] else 0
            floors = []
            for floor_name, fs in sorted(stats['floors'].items()):
                floor_pct = round(fs['total_pct'] / fs['cell_count'], 1) if fs['cell_count'] else 0
                floors.append({
                    'floor': fs['floor'],
                    'cell_count': fs['cell_count'],
                    'pct_complete': floor_pct
                })
            blocks.append({
                'block': block_name,
                'cell_count': stats['cell_count'],
                'pct_complete': block_pct,
                'floors': floors
            })
        overall = round(total_weighted / total_cells, 1) if total_cells else 0
        return {'blocks': blocks, 'overall_pct': overall}
    except Exception as e:
        print(f'Error computing RERA progress: {e}')
        return {'blocks': [], 'overall_pct': 0}


def _rera_compute_financials(venture_id):
    """Compute funds collected, utilized, and escrow balance."""
    collected = 0.0
    utilized = 0.0
    if not supabase:
        return {'collected': 0, 'utilized': 0, 'escrow_balance': 0}
    try:
        # Funds collected from invoices
        inv_res = supabase.table('invoices').select('*').execute()
        for inv in inv_res.data or []:
            d = inv.get('data') or {}
            v_match = d.get('venture_id') == venture_id or inv.get('venture_id') == venture_id
            if not v_match:
                continue
            status = (d.get('status') or inv.get('status') or '').lower()
            amt = float(d.get('amount') or inv.get('amount') or 0)
            if status in ('paid', 'received', 'completed'):
                collected += amt
    except Exception as e:
        print(f'Error fetching invoices for RERA: {e}')
    try:
        # Funds utilized from expenditures
        exp_res = supabase.table('expenditures').select('*').eq('venture_id', venture_id).execute()
        for exp in exp_res.data or []:
            d = exp.get('data') or {}
            utilized += float(d.get('amount', 0))
    except Exception as e:
        print(f'Error fetching expenditures for RERA: {e}')
    return {
        'collected': round(collected, 2),
        'utilized': round(utilized, 2),
        'escrow_balance': round(collected - utilized, 2)
    }


def _rera_compute_milestones(venture_id):
    """Extract milestone dates from cell_data timeline entries."""
    milestones = []
    if not supabase:
        return milestones
    try:
        res = supabase.table('cell_data').select('*').execute()
        seen = {}
        for row in res.data:
            d = row.get('data') or {}
            if d.get('venture_id') != venture_id:
                continue
            block = d.get('block', 'Unknown')
            work_item = d.get('work_item', '')
            timeline = d.get('timeline') or []
            for entry in timeline:
                if entry.get('color') == 'green':
                    key = f'{block}|{work_item}'
                    ev_date = entry.get('date', '')
                    if key not in seen or ev_date < seen[key]['actual_date']:
                        seen[key] = {
                            'block': block,
                            'work_item': work_item,
                            'actual_date': ev_date,
                            'changed_by': entry.get('changed_by', '')
                        }
        milestones = sorted(seen.values(), key=lambda m: (m['block'], m['work_item']))
    except Exception as e:
        print(f'Error computing RERA milestones: {e}')
    return milestones


def _rera_unit_status(venture_id):
    """Compute unit status: total/sold/available by category."""
    if not supabase:
        return {'total': 0, 'sold': 0, 'available': 0, 'has_data': False}
    try:
        res = supabase.table('cell_data').select('*').execute()
        flats = set()
        for row in res.data:
            d = row.get('data') or {}
            if d.get('venture_id') != venture_id:
                continue
            cell_id = row.get('id', '')
            parts = cell_id.split('_item_')
            if parts:
                flats.add(parts[0])
        total = len(flats)
        return {'total': total, 'sold': 0, 'available': total, 'has_data': total > 0}
    except Exception as e:
        print(f'Error computing RERA unit status: {e}')
        return {'total': 0, 'sold': 0, 'available': 0, 'has_data': False}


def _rera_compliance_checklist(venture_id, progress, financials, units, milestones, approvals):
    """Build Form B compliance checklist with status indicators."""
    checklist = []
    # Construction progress
    has_progress = progress['overall_pct'] > 0 or len(progress['blocks']) > 0
    checklist.append({
        'field': 'Construction Progress (% per tower/block)',
        'status': 'green' if has_progress and progress['overall_pct'] > 0 else ('yellow' if has_progress else 'red'),
        'source': 'cell_data',
        'detail': f"{len(progress['blocks'])} blocks, {progress['overall_pct']}% overall"
    })
    # Funds collected
    has_collected = financials['collected'] > 0
    checklist.append({
        'field': 'Funds Collected',
        'status': 'green' if has_collected else 'red',
        'source': 'invoices (status=paid)',
        'detail': f"₹{financials['collected']:,.0f}"
    })
    # Funds utilized
    has_utilized = financials['utilized'] > 0
    checklist.append({
        'field': 'Funds Utilized',
        'status': 'green' if has_utilized else 'red',
        'source': 'expenditures',
        'detail': f"₹{financials['utilized']:,.0f}"
    })
    # Escrow balance
    checklist.append({
        'field': 'Escrow Balance',
        'status': 'green' if has_collected or has_utilized else 'red',
        'source': 'derived (collected - utilized)',
        'detail': f"₹{financials['escrow_balance']:,.0f}"
    })
    # Unit status
    checklist.append({
        'field': 'Unit Status (total/sold/available)',
        'status': 'green' if units.get('has_data') else 'red',
        'source': 'cell_data (flat count)',
        'detail': f"{units.get('total', 0)} units" + ("" if units.get('has_data') else " — no sales data source")
    })
    # Milestones
    checklist.append({
        'field': 'Milestone Status (key dates)',
        'status': 'green' if len(milestones) > 0 else 'red',
        'source': 'cell_data.timeline[]',
        'detail': f"{len(milestones)} milestones recorded"
    })
    # Statutory approvals
    checklist.append({
        'field': 'Statutory Approvals / Renewals',
        'status': 'green' if len(approvals) > 0 else 'red',
        'source': 'rera_statutory_approvals',
        'detail': f"{len(approvals)} approvals on record"
    })
    return checklist


@app.route('/rera')
@login_required
def rera_page():
    return render_template('rera.html')


@app.route('/api/rera/readiness/<venture_id>')
@requires_role('manager', 'admin')
def api_rera_readiness(venture_id):
    """RERA Readiness Dashboard: computed %, financials, compliance checklist."""
    try:
        thresholds = _rera_get_thresholds(venture_id)
        progress = _rera_compute_progress(venture_id, thresholds)
        financials = _rera_compute_financials(venture_id)
        units = _rera_unit_status(venture_id)
        milestones = _rera_compute_milestones(venture_id)
        # Statutory approvals
        approvals = []
        if supabase:
            try:
                ap_res = supabase.table('rera_statutory_approvals').select('*').eq('venture_id', venture_id).execute()
                approvals = ap_res.data or []
            except Exception:
                pass
        checklist = _rera_compliance_checklist(venture_id, progress, financials, units, milestones, approvals)
        q_label, q_start, q_end, filing_deadline = _rera_current_quarter()
        now = now_ist().date()
        days_remaining = (filing_deadline - now).days
        # Check if a report already exists for this quarter
        existing_report = None
        if supabase:
            try:
                rpt_res = supabase.table('rera_quarterly_reports').select('*').eq('venture_id', venture_id).eq('quarter', q_label).execute()
                if rpt_res.data:
                    existing_report = rpt_res.data[0]
            except Exception:
                pass
        return jsonify({
            'venture_id': venture_id,
            'progress': progress,
            'financials': financials,
            'units': units,
            'milestones': milestones,
            'approvals': approvals,
            'checklist': checklist,
            'quarter': {
                'label': q_label,
                'start': str(q_start),
                'end': str(q_end),
                'filing_deadline': str(filing_deadline),
                'days_remaining': days_remaining
            },
            'existing_report': existing_report
        })
    except Exception as e:
        print(f'Error in RERA readiness: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/rera/draft/<venture_id>/<quarter>')
@requires_role('manager', 'admin')
def api_rera_draft(venture_id, quarter):
    """Generate a draft Form B report with all computed fields."""
    try:
        thresholds = _rera_get_thresholds(venture_id)
        progress = _rera_compute_progress(venture_id, thresholds)
        financials = _rera_compute_financials(venture_id)
        units = _rera_unit_status(venture_id)
        milestones = _rera_compute_milestones(venture_id)
        approvals = []
        if supabase:
            try:
                ap_res = supabase.table('rera_statutory_approvals').select('*').eq('venture_id', venture_id).execute()
                approvals = ap_res.data or []
            except Exception:
                pass
        # Delays
        delays = []
        if supabase:
            try:
                dl_res = supabase.table('rera_delay_log').select('*').eq('venture_id', venture_id).eq('quarter', quarter).execute()
                delays = dl_res.data or []
            except Exception:
                pass
        # Venture metadata
        venture_name = venture_id
        if supabase:
            try:
                v_res = supabase.table('ventures').select('*').eq('id', venture_id).execute()
                if v_res.data:
                    venture_name = (v_res.data[0].get('data') or {}).get('name') or v_res.data[0].get('name') or venture_id
            except Exception:
                pass
        # Parse quarter dates
        year, q_num = quarter.split('-Q')
        q_num = int(q_num)
        year = int(year)
        if q_num == 1:
            q_start, q_end = date(year, 1, 1), date(year, 3, 31)
        elif q_num == 2:
            q_start, q_end = date(year, 4, 1), date(year, 6, 30)
        elif q_num == 3:
            q_start, q_end = date(year, 7, 1), date(year, 9, 30)
        else:
            q_start, q_end = date(year, 10, 1), date(year, 12, 31)
        filing_deadline = q_end + timedelta(days=15)
        draft = {
            'venture_id': venture_id,
            'venture_name': venture_name,
            'quarter': quarter,
            'quarter_start': str(q_start),
            'quarter_end': str(q_end),
            'filing_deadline': str(filing_deadline),
            'generated_at': now_ist().isoformat(),
            'construction_progress': progress,
            'financial_updates': financials,
            'unit_status': units,
            'milestone_status': milestones,
            'compliance_status': [
                {
                    'approval_name': a.get('approval_name', ''),
                    'issuing_authority': a.get('issuing_authority', ''),
                    'issued_date': str(a.get('issued_date', '')) if a.get('issued_date') else '',
                    'expiry_date': str(a.get('expiry_date', '')) if a.get('expiry_date') else '',
                    'status': a.get('status', 'active'),
                    'remarks': a.get('remarks', '')
                }
                for a in approvals
            ],
            'delays_issues': [
                {
                    'block': d.get('block', ''),
                    'floor': d.get('floor', ''),
                    'work_item': d.get('work_item', ''),
                    'delay_days': d.get('delay_days', 0),
                    'reason': d.get('reason', '')
                }
                for d in delays
            ]
        }
        return jsonify(draft)
    except Exception as e:
        print(f'Error generating RERA draft: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/rera/report/submit', methods=['POST'])
@requires_role('manager', 'admin')
def api_rera_report_submit():
    """Submit & lock a quarterly report — creates an immutable snapshot."""
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    body = request.get_json() or {}
    venture_id = body.get('venture_id')
    quarter = body.get('quarter')
    report_data = body.get('report_data')
    if not venture_id or not quarter or not report_data:
        return jsonify({'error': 'venture_id, quarter, and report_data are required'}), 400
    try:
        # Parse quarter dates
        year, q_num = quarter.split('-Q')
        q_num = int(q_num)
        year = int(year)
        if q_num == 1:
            q_start, q_end = date(year, 1, 1), date(year, 3, 31)
        elif q_num == 2:
            q_start, q_end = date(year, 4, 1), date(year, 6, 30)
        elif q_num == 3:
            q_start, q_end = date(year, 7, 1), date(year, 9, 30)
        else:
            q_start, q_end = date(year, 10, 1), date(year, 12, 31)
        filing_deadline = q_end + timedelta(days=15)
        user = session.get('user')
        submitted_by = user.get('email') if isinstance(user, dict) else str(user)
        # Check if already exists
        existing = supabase.table('rera_quarterly_reports').select('*').eq('venture_id', venture_id).eq('quarter', quarter).execute()
        if existing.data:
            existing_row = existing.data[0]
            if existing_row.get('status') in ('locked', 'submitted'):
                return jsonify({'error': 'Report already submitted/locked for this quarter'}), 409
            # Update existing draft → locked
            res = supabase.table('rera_quarterly_reports').update({
                'status': 'locked',
                'report_data': report_data,
                'submitted_by': submitted_by,
                'submitted_at': now_ist().isoformat(),
                'filing_deadline': str(filing_deadline)
            }).eq('id', existing_row['id']).execute()
        else:
            res = supabase.table('rera_quarterly_reports').insert({
                'venture_id': venture_id,
                'quarter': quarter,
                'quarter_start': str(q_start),
                'quarter_end': str(q_end),
                'filing_deadline': str(filing_deadline),
                'status': 'locked',
                'report_data': report_data,
                'submitted_by': submitted_by,
                'submitted_at': now_ist().isoformat()
            }).execute()
        return jsonify({'success': True, 'id': res.data[0]['id'] if res.data else None})
    except Exception as e:
        print(f'Error submitting RERA report: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/rera/reports/<venture_id>')
@requires_role('manager', 'admin')
def api_rera_reports_list(venture_id):
    """List all filed/locked quarterly reports for a venture."""
    if not supabase:
        return jsonify([])
    try:
        res = supabase.table('rera_quarterly_reports').select('*').eq('venture_id', venture_id).order('created_at', desc=True).execute()
        return jsonify([{
            'id': r['id'],
            'venture_id': r['venture_id'],
            'quarter': r['quarter'],
            'quarter_start': str(r.get('quarter_start', '')),
            'quarter_end': str(r.get('quarter_end', '')),
            'filing_deadline': str(r.get('filing_deadline', '')),
            'status': r.get('status', 'draft'),
            'submitted_by': r.get('submitted_by', ''),
            'submitted_at': r.get('submitted_at', ''),
            'created_at': r.get('created_at', '')
        } for r in (res.data or [])])
    except Exception as e:
        print(f'Error listing RERA reports: {e}')
        return jsonify([])


@app.route('/api/rera/report/<report_id>')
@requires_role('manager', 'admin')
def api_rera_report_detail(report_id):
    """View a single locked report with full report_data."""
    if not supabase:
        return jsonify({'error': 'Supabase not connected'}), 500
    try:
        res = supabase.table('rera_quarterly_reports').select('*').eq('id', report_id).execute()
        if not res.data:
            return jsonify({'error': 'Report not found'}), 404
        r = res.data[0]
        return jsonify({
            'id': r['id'],
            'venture_id': r['venture_id'],
            'quarter': r['quarter'],
            'quarter_start': str(r.get('quarter_start', '')),
            'quarter_end': str(r.get('quarter_end', '')),
            'filing_deadline': str(r.get('filing_deadline', '')),
            'status': r.get('status', 'draft'),
            'report_data': r.get('report_data', {}),
            'submitted_by': r.get('submitted_by', ''),
            'submitted_at': r.get('submitted_at', ''),
            'created_at': r.get('created_at', '')
        })
    except Exception as e:
        print(f'Error fetching RERA report: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/rera/approvals', methods=['GET', 'POST'])
@requires_role('admin')
def api_rera_approvals():
    """CRUD for statutory approvals."""
    if not supabase:
        return jsonify([]) if request.method == 'GET' else jsonify({'success': True, 'note': 'read-only local mode'})
    if request.method == 'GET':
        venture_id = request.args.get('venture_id')
        try:
            q = supabase.table('rera_statutory_approvals').select('*')
            if venture_id:
                q = q.eq('venture_id', venture_id)
            res = q.order('created_at', desc=True).execute()
            return jsonify(res.data or [])
        except Exception as e:
            print(f'Error fetching RERA approvals: {e}')
            return jsonify([])
    else:
        body = request.get_json() or {}
        required = ['venture_id', 'approval_name']
        for field in required:
            if field not in body or body[field] in (None, ''):
                return jsonify({'error': f'{field} is required'}), 400
        try:
            entry = {
                'venture_id': body['venture_id'],
                'approval_name': body['approval_name'],
                'issuing_authority': body.get('issuing_authority', ''),
                'issued_date': body.get('issued_date', None),
                'expiry_date': body.get('expiry_date', None),
                'status': body.get('status', 'active'),
                'remarks': body.get('remarks', '')
            }
            res = supabase.table('rera_statutory_approvals').insert(entry).execute()
            return jsonify({'success': True, 'id': res.data[0]['id'] if res.data else None})
        except Exception as e:
            print(f'Error creating RERA approval: {e}')
            return jsonify({'error': str(e)}), 500


@app.route('/api/rera/approval/<approval_id>', methods=['PUT', 'DELETE'])
@requires_role('admin')
def api_rera_approval_modify(approval_id):
    """Update or delete a statutory approval."""
    if not supabase:
        return jsonify({'success': True, 'note': 'read-only local mode'})
    if request.method == 'DELETE':
        try:
            supabase.table('rera_statutory_approvals').delete().eq('id', approval_id).execute()
            return jsonify({'success': True})
        except Exception as e:
            return jsonify({'error': str(e)}), 500
    else:
        body = request.get_json() or {}
        allowed = {k: v for k, v in body.items() if k in (
            'approval_name', 'issuing_authority', 'issued_date', 'expiry_date', 'status', 'remarks'
        )}
        try:
            supabase.table('rera_statutory_approvals').update(allowed).eq('id', approval_id).execute()
            return jsonify({'success': True})
        except Exception as e:
            return jsonify({'error': str(e)}), 500


@app.route('/api/rera/thresholds', methods=['GET', 'POST'])
@requires_role('admin')
def api_rera_thresholds():
    """Get or set color→pct thresholds."""
    if not supabase:
        if request.method == 'GET':
            return jsonify([{'color': k, 'pct_value': v, 'venture_id': None, 'work_item': None}
                            for k, v in RERA_DEFAULT_THRESHOLDS.items()])
        return jsonify({'success': True, 'note': 'read-only local mode'})
    if request.method == 'GET':
        try:
            res = supabase.table('rera_color_thresholds').select('*').execute()
            return jsonify(res.data or [])
        except Exception as e:
            print(f'Error fetching RERA thresholds: {e}')
            return jsonify([])
    else:
        body = request.get_json() or {}
        if isinstance(body, list):
            results = []
            for item in body:
                try:
                    res = supabase.table('rera_color_thresholds').upsert({
                        'venture_id': item.get('venture_id'),
                        'work_item': item.get('work_item'),
                        'color': item['color'],
                        'pct_value': float(item['pct_value'])
                    }).execute()
                    results.append({'success': True})
                except Exception as e:
                    results.append({'error': str(e)})
            return jsonify({'results': results})
        else:
            try:
                res = supabase.table('rera_color_thresholds').upsert({
                    'venture_id': body.get('venture_id'),
                    'work_item': body.get('work_item'),
                    'color': body['color'],
                    'pct_value': float(body['pct_value'])
                }).execute()
                return jsonify({'success': True, 'id': res.data[0]['id'] if res.data else None})
            except Exception as e:
                return jsonify({'error': str(e)}), 500


@app.route('/api/rera/delays', methods=['GET', 'POST'])
@requires_role('manager', 'admin')
def api_rera_delays():
    """Get or create delay log entries."""
    if not supabase:
        return jsonify([]) if request.method == 'GET' else jsonify({'success': True, 'note': 'read-only local mode'})
    if request.method == 'GET':
        venture_id = request.args.get('venture_id')
        quarter = request.args.get('quarter')
        try:
            q = supabase.table('rera_delay_log').select('*')
            if venture_id:
                q = q.eq('venture_id', venture_id)
            if quarter:
                q = q.eq('quarter', quarter)
            res = q.order('created_at', desc=True).execute()
            return jsonify(res.data or [])
        except Exception as e:
            print(f'Error fetching RERA delays: {e}')
            return jsonify([])
    else:
        body = request.get_json() or {}
        required = ['venture_id', 'quarter']
        for field in required:
            if field not in body or body[field] in (None, ''):
                return jsonify({'error': f'{field} is required'}), 400
        try:
            entry = {
                'venture_id': body['venture_id'],
                'quarter': body['quarter'],
                'block': body.get('block', ''),
                'floor': body.get('floor', ''),
                'work_item': body.get('work_item', ''),
                'delay_days': int(body.get('delay_days', 0)),
                'reason': body.get('reason', '')
            }
            res = supabase.table('rera_delay_log').insert(entry).execute()
            return jsonify({'success': True, 'id': res.data[0]['id'] if res.data else None})
        except Exception as e:
            print(f'Error creating RERA delay log: {e}')
            return jsonify({'error': str(e)}), 500


@app.route('/api/rera/delay/<delay_id>', methods=['DELETE'])
@requires_role('manager', 'admin')
def api_rera_delay_delete(delay_id):
    """Delete a delay log entry."""
    if not supabase:
        return jsonify({'success': True, 'note': 'read-only local mode'})
    try:
        supabase.table('rera_delay_log').delete().eq('id', delay_id).execute()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    # Disable reloader: background image-generation threads must not be killed
    # when source files change during a design request.
    app.run(debug=True, host='0.0.0.0', port=5000, use_reloader=False)
