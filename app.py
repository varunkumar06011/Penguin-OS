from flask import Flask, render_template, request, jsonify, session, redirect, url_for
import os
from functools import wraps

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'vgrand-secret-key-2025')

DEMO_USERNAME = 'Vgrand@123'
DEMO_PASSWORD = 'Vgrand1234'

DEFAULT_WORK_ITEMS = [
    "Brick work", "Plastering", "Electrical pipe", "Pop bolster",
    "Bathroom plumbing", "Baby sink lines", "Tiles", "Pop primer",
    "Window fitting", "Window grills", "Door frames", "Door shutters",
    "Grills", "Main door", "Flooring", "Wall care", "Primer", "Putty",
    "Paint", "Dado tiles", "Final coat"
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


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
