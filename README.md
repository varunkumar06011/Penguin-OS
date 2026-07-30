# Penguin OS — Construction Software & Society Management Platform

**Penguin OS** is an all-in-one construction software and building project management platform designed for real estate developers, contractors, and residential societies. It tracks apartment construction progress end-to-end and extends into post-handover operations with a built-in RWA / society management module, visitor management, security patrol, and financial billing.

If you are looking for free, open-source, self-hosted construction software, a residential building progress tracker, or a lightweight real estate project management tool, this project is a ready-to-run starting point.

## What this construction software covers

- **Construction progress tracking** — block, floor, and flat-level status grids.
- **Real estate project management** — timelines, work items, remarks, and roles.
- **RWA / society management** — residents, flats, amenities, complaints, notices, parking, invoices, vendor ledger, and payments.
- **Visitor & security management** — visitor requests, pre-approval, kids checkout with OTP, daily help, and security patrol checkpoints.
- **Billing & finance** — monthly invoices, payment records, Razorpay integration stub, and vendor ledger.

## Key features

### Construction & project tracking
- **Block & Floor Navigation**: Track progress across A Block and B Block, 5 floors each, 6 flats per floor.
- **Color-coded Status System**: Red (Yet to start), Yellow (In progress), Blue (Patch work), Green (Completed).
- **Timeline Tracking**: Every status change is logged with color, label, date, and user email.
- **Remarks**: Auto-appended remarks on status changes plus manual editable remarks per cell.
- **Work Items Management**: Admin can add, rename, reorder, or remove work items via settings.
- **Role-based Access**: Admin, Manager, Accountant, Security, and Resident roles via Flask session auth.
- **Demo Login**: Pre-configured demo credentials without needing Firebase Auth.

### RWA / Society Management (Elite-tier module)
- **Flats & Residents**: Sync completed flats, manage resident directory with opt-in privacy.
- **Emergency Contacts**: Maintain important contacts for the society.
- **Visitor Management**: Visitor requests, pre-approval, and overstay alerts.
- **Deliveries**: Log and track inbound deliveries.
- **Daily Help**: Manage maids, drivers, cooks, and other staff; record attendance.
- **Resident Vehicles**: Register vehicles and search by number.
- **Kids Checkout**: Secure OTP-based checkout for children.
- **Complaints**: Resident complaint filing and tracking.
- **Amenities & Bookings**: Book society amenities with time slots.
- **Notices**: Society-level notice board scoped by role.
- **Home Planner**: Task list for move-in or renovation work.
- **Parking**: Parking slots and rental tracking.
- **SOS Alerts**: One-click SOS for residents with active alert status.
- **Intercom Calls**: Log internal calls.
- **Security Patrol**: Patrol checkpoints and guard logs.
- **Invoices & Payments**: Generate monthly RWA invoices, record payments, and keep vendor ledger.
- **Reports**: Summary dashboards for admins and accountants.
- **Automated Invoice Generation**: `generate_invoices.py` script for bulk monthly invoice creation, powered by APScheduler.

## Tech Stack

- **Backend**: Python Flask
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Flask Session-based authentication with role decorators
- **Frontend**: HTML5, CSS3, Vanilla JavaScript (single-page app shell)
- **Task Scheduling**: APScheduler for automated invoice generation
- **QR Codes**: Python `qrcode` library for visitor/daily-help identification
- **Image Handling**: Pillow
- **Deployment**: Gunicorn-ready

## Setup

### 1. Supabase Configuration
> For local development the app can run in a read-only fallback mode when Supabase is not configured, but create/update/delete operations will be no-ops.

### 2. Database Setup

Run the migrations in the Supabase SQL Editor in **strict filename order**:

```
000_baseline_schema.sql
001_fix_upsert_and_dedupe.sql
002_foundation.sql
002b_inventory.sql
003_material_tracking.sql
003b_payroll.sql
004_expenditures.sql
004b_seed_role_users.sql
005_visitor_management.sql
006_interior_design_and_marketplace.sql
007_remove_milestones.sql
008_rwa_foundation.sql → 015_inventory_ready.sql
```

> **Warning:** Migration files with `b` suffixes (002b, 003b, 004b) run **after** their `a` counterpart but **before** the next number. Running them out of order will result in a broken schema.

> For production, replace the permissive "Allow all" RLS policies with real policies tied to the Flask authorization layer. The current "Allow all" policies provide zero database-level access control — all protection is in the Flask layer.

### 3. Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SECRET_KEY` | **Yes (production)** | Flask session signing key. App refuses to start without it unless `DEV_MODE=1`. |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Yes | Supabase service-role key (server-side only, never exposed to browser) |
| `SUPABASE_ANON_KEY` | No | Used as fallback if service key not set |
| `POLLINATIONS_API_TOKEN` | No | For AI interior design feature |
| `DEV_MODE` | No | Set to `1` for local development (enables debug mode, insecure secret key, non-secure cookies) |
| `FLASK_ENV` | No | Set to `development` for local dev |

### 4. PDF Generation (WeasyPrint)

WeasyPrint requires native system libraries that are **not** installed by `pip install`:

- **Linux:** `libpango-1.0-0 libpangoft2-1.0-0 libcairo2 libgdk-pixbuf2.0-0`
- **macOS:** `brew install pango cairo`
- **Docker:** Add `RUN apt-get install -y libpango-1.0-0 libpangoft2-1.0-0 libcairo2 libgdk-pixbuf2.0-0` to your Dockerfile

If WeasyPrint fails to import, the app falls back to `xhtml2pdf` (pure Python, no native deps). If neither is available, PDF generation returns an error.

### 5. Run Locally

```bash
# Install dependencies
pip install -r requirements.txt

# Set environment variables
export DEV_MODE=1  # Enables debug mode + dev secret key
export SUPABASE_URL=your_url
export SUPABASE_SERVICE_KEY=your_key

# Run the Flask server
python app.py
```

Open your browser and navigate to `http://localhost:5000`

### 6. Production Deployment

```bash
# NEVER run with debug=True in production
# Set SECRET_KEY (required) and run with gunicorn:
export SECRET_KEY=$(python -c "import secrets; print(secrets.token_hex(32))")
gunicorn -w 4 -b 0.0.0.0:5000 app:app
```

**Security checklist before going live:**
- [ ] `SECRET_KEY` set to a strong random value (not in repo)
- [ ] `DEV_MODE` is NOT set (debug off, secure cookies on)
- [ ] RLS policies replaced with real role-based policies
- [ ] HTTPS enabled (required for `Secure` cookies)
- [ ] Reverse proxy sets `X-Forwarded-For` for rate limiting
- [ ] Razorpay integration is a **stub** — billing is NOT functional until implemented

## Data Structure

Each cell in the tracker grid is stored as a row in the `cell_data` Supabase table:

```
cell_data.id = {block}_floor{floor}_{flatNumber}_{workIndex}
Example: A_floor1_101_3
```

The `data` JSONB column holds:
- `color`: string (red | yellow | blue | green | null)
- `remarks`: string
- `timeline`: array of `{ color, status_label, date, changed_by }`
- `updated_at`: timestamp
- `updated_by`: string (user email)

RWA-specific data (flats, residents, deliveries, vehicles, complaints, amenities, bookings, notices, invoices, payments, patrol logs, etc.) is stored in dedicated relational tables created in migrations `008` through `011`. Ventures, invoices, purchase orders, vendors, and settings are stored as rows with JSONB `data` payloads.

## File Structure

```
/project
  app.py                    ← Flask server (all backend routes + SPA routes)
  requirements.txt          ← Python dependencies
  generate_invoices.py      ← Bulk monthly invoice generator script
  payroll_verify.py         ← Payroll verification helper
  migrations/               ← SQL migrations (000-015, with 002b/003b/004b sub-sequences)
  live_data/                ← Exported data / snapshots
  static/
    js/
      app.js                ← Main construction tracker frontend logic
      rwa.js                ← RWA / society management frontend logic
    css/
      style.css             ← App styles
  templates/
    index.html              ← Main SPA shell + admin nav
    login.html              ← Login page
    visitor_portal.html     ← Resident / security / visitor portal
    rwa_admin.html          ← RWA admin panel
  README.md
```

## Future Roadmap

- PDF/Excel export of tracker per block/floor
- Admin dashboard to manage users and assign roles
- Daily progress report via email
- Photo upload per flat with cloud storage
- Push notifications when status changes
- Enhanced RLS policies for production security
- Multi-project / multi-site support for larger construction ERP use

## License

Internal use for Penguin OS.

---

**Keywords**: construction software, construction project management software, building progress tracker, real estate construction software, residential construction management, apartment construction tracking, RWA software, society management software, visitor management system, construction ERP India, open source construction software, self-hosted construction software, flat management system, building management software, contractor progress tracking, property development software.
