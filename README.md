# VGrand Infra Tracking — Construction Software & Society Management Platform

**VGrand Infra Tracking** is an all-in-one construction software and building project management platform designed for real estate developers, contractors, and residential societies. It tracks apartment construction progress end-to-end and extends into post-handover operations with a built-in RWA / society management module, visitor management, security patrol, and financial billing.

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

## Demo Login

- **Username**: `Vgrand@123`
- **Password**: `Vgrand1234`

## Setup

### 1. Supabase Configuration

Create a Supabase project and add the connection details to a `.env` file in the repo root:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-role-key
SECRET_KEY=your-flask-secret-key
```

> For local development the app can run in a read-only fallback mode when Supabase is not configured, but create/update/delete operations will be no-ops.

### 2. Database Setup

Run the migrations in the Supabase SQL Editor in order, starting with `migrations/001_fix_upsert_and_dedupe.sql` and continuing through `migrations/011_rwa_elite.sql`. These add unique constraints, enable RLS, and create the full construction + RWA schema.

> For production, replace the permissive "Allow all" RLS policies with real policies tied to the Flask authorization layer.

### 3. Run Locally

```bash
# Install dependencies
pip install -r requirements.txt

# Run the Flask server
python app.py
```

Open your browser and navigate to `http://localhost:5000`

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
  migrations/               ← SQL migrations (001-011)
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

Internal use for VGrand Infra.

---

**Keywords**: construction software, construction project management software, building progress tracker, real estate construction software, residential construction management, apartment construction tracking, RWA software, society management software, visitor management system, construction ERP India, open source construction software, self-hosted construction software, flat management system, building management software, contractor progress tracking, property development software.
