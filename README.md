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
- **Database**: Firebase Firestore
- **Authentication**: Flask Session-based (demo login)
- **Frontend**: HTML, CSS, Vanilla JavaScript

## Demo Login

- **Username**: `Vgrand@123`
- **Password**: `Vgrand1234`

## Setup

### 1. Firebase Configuration

Create a Firebase project and enable Firestore. Then update `static/js/app.js` with your Firebase config:

```javascript
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};
```

### 2. Firestore Rules

Set your Firestore security rules to allow read/write (for demo/internal use):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

> For production, restrict these rules to authenticated users only.

### 3. Run Locally

```bash
# Install dependencies
pip install -r requirements.txt

# Run the Flask server
python app.py
```

Open Chrome and navigate to `http://localhost:5000`

## Data Structure

Each cell in the tracker grid is a Firestore document:

```
/projects/vgrand-infra/cells/{cellId}

cellId format: {block}_floor{floor}_{flatNumber}_{workIndex}
Example: A_floor1_101_3
```

Fields:
- `color`: string (red | yellow | blue | green | null)
- `remarks`: string
- `timeline`: array of `{ color, status_label, date, changed_by }`
- `updated_at`: timestamp
- `updated_by`: string (user email)

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
