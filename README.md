# VGrand Infra Tracking

A web-based construction progress tracking system for VGrand projects.

## Features

- **Block & Floor Navigation**: Track progress across A Block and B Block, 5 floors each, 6 flats per floor.
- **Color Status System**: Red (Yet to start), Yellow (In progress), Blue (Patch work), Green (Completed).
- **Timeline Tracking**: Every status change is logged with color, label, date, and user email.
- **Remarks**: Auto-appended remarks on status changes + manual editable remarks per cell.
- **Work Items Management**: Admin can add, rename, reorder, or remove work items via settings.
- **Demo Login**: Pre-configured demo credentials (no Firebase Auth required).

## Tech Stack

- **Backend**: Python Flask
- **Database**: Supabase (Postgres)
- **Authentication**: Flask Session-based (demo login)
- **Frontend**: HTML, CSS, Vanilla JavaScript

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

> For local development the app can run in read-only fallback mode when Supabase is not configured, but create/update/delete operations will be no-ops.

### 2. Database Setup

Run the migrations in the Supabase SQL Editor in order (`migrations/001_fix_upsert_and_dedupe.sql` first). These add unique constraints and enable RLS on the core tables.

> For production, replace the permissive "Allow all" policies with real RLS policies tied to the Flask authorization layer.

### 3. Run Locally

```bash
# Install dependencies
pip install -r requirements.txt

# Run the Flask server
python app.py
```

Open Chrome and navigate to `http://localhost:5000`

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

Ventures, invoices, purchase orders, vendors, and settings are stored similarly as rows with a JSONB `data` payload.

## File Structure

```
/project
  app.py                 ← Flask server
  requirements.txt       ← Python dependencies
  /static
    /js
      app.js             ← All frontend logic
    /css
      style.css          ← App styles
  /templates
    index.html           ← Main SPA shell
    login.html           ← Login page
  README.md
```

## Future Features

- PDF/Excel export of tracker per block/floor
- Admin dashboard to manage users
- Daily progress report via email
- Photo upload per flat
- Push notifications when status changes
- Role-based access control

## License

Internal use for VGrand Infra.
