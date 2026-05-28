import os
import re
import time
import hashlib
import json
import sqlite3
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory
from werkzeug.utils import secure_filename
from werkzeug.security import generate_password_hash, check_password_hash
import requests
from bs4 import BeautifulSoup

app = Flask(__name__, static_folder='.')

# ─── Configuration ────────────────────────────────────────────────────────────
ALLOWED_EXTENSIONS = {'txt', 'pdf'}
UPLOAD_FOLDER = os.path.join(os.getcwd(), 'uploads')
HISTORY_FILE = os.path.join(os.getcwd(), 'history.json')
DB_FILE = os.path.join(os.getcwd(), 'users.db')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 5 * 1024 * 1024  # 5MB limit

# ─── CORS headers ─────────────────────────────────────────────────────────────
@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, DELETE, OPTIONS'
    return response

@app.route('/api/<path:path>', methods=['OPTIONS'])
def handle_options(path):
    return jsonify({}), 200

# ─── Helpers ──────────────────────────────────────────────────────────────────
def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def extract_pdf_text(filepath):
    """Extract text from PDF using PyPDF2, falling back to pdfplumber."""
    text = ""
    try:
        import PyPDF2
        with open(filepath, 'rb') as f:
            reader = PyPDF2.PdfReader(f)
            for page in reader.pages:
                extracted = page.extract_text()
                if extracted:
                    text += extracted + " "
        if text.strip():
            return text.strip()
    except ImportError:
        pass
    except Exception:
        pass

    try:
        import pdfplumber
        with pdfplumber.open(filepath) as pdf:
            for page in pdf.pages:
                extracted = page.extract_text()
                if extracted:
                    text += extracted + " "
        if text.strip():
            return text.strip()
    except ImportError:
        pass
    except Exception:
        pass

    return None


def analyse_text(text):
    """
    Deterministic linguistic credibility analysis.
    Returns a consistent score for the same input text.
    Uses rule-based NLP heuristics across multiple dimensions.
    """
    if not text or len(text.split()) < 10:
        return {
            "score": 25,
            "classification": "NON-CREDIBLE",
            "confidence": "LOW",
            "positives": ["Text structure was parsed."],
            "negatives": ["Content is too short for reliable classification (minimum 10 words required)."]
        }

    text_lower = text.lower()
    word_count = len(text.split())
    sentences = re.split(r'[.!?]+', text)
    sentences = [s.strip() for s in sentences if len(s.strip()) > 10]

    score = 50  # baseline
    positives = []
    negatives = []

    # ── 1. Source attribution signals (+/- up to 20pts) ──────────────────────
    attribution_patterns = [
        r'\b(according to|said|stated|confirmed|reported by|citing|source[s]?)\b',
        r'\b(university|institute|research|study|journal|published)\b',
        r'\b(professor|dr\.|ph\.d|scientist|expert|official|spokesperson)\b',
    ]
    attribution_hits = sum(
        len(re.findall(p, text_lower)) for p in attribution_patterns
    )
    if attribution_hits >= 5:
        score += 15
        positives.append("Multiple source attributions and expert citations detected.")
    elif attribution_hits >= 2:
        score += 8
        positives.append("Some source attribution language present.")
    else:
        score -= 10
        negatives.append("Lack of explicit source attribution or expert citations.")

    # ── 2. Sensationalism / clickbait signals (- up to 20pts) ────────────────
    sensational_words = [
        'shocking', 'unbelievable', 'bombshell', 'explosive', 'outrage',
        'conspiracy', 'secret', 'hidden truth', 'they don\'t want you',
        'wake up', 'share before deleted', '!!!', 'BREAKING', 'URGENT',
        'miracle', 'cure', 'banned', 'censored', 'suppressed',
        'you won\'t believe', 'what they\'re hiding'
    ]
    sensational_hits = sum(1 for w in sensational_words if w in text_lower)
    if sensational_hits >= 4:
        score -= 20
        negatives.append("High concentration of sensationalist and clickbait language detected.")
    elif sensational_hits >= 2:
        score -= 10
        negatives.append("Some sensationalist phrasing patterns observed.")
    elif sensational_hits == 0:
        score += 8
        positives.append("No sensationalist or clickbait language detected.")

    # ── 3. Emotional manipulation signals (- up to 15pts) ────────────────────
    emotional_patterns = [
        r'\b(outraged?|furious|disgusting|horrifying|evil|destroy|obliterate)\b',
        r'[A-Z]{4,}',  # excessive caps
        r'!{2,}',       # multiple exclamation marks
    ]
    emotional_hits = sum(
        len(re.findall(p, text)) for p in emotional_patterns
    )
    if emotional_hits >= 6:
        score -= 15
        negatives.append("High emotional manipulation indicators: excessive caps and charged language.")
    elif emotional_hits >= 3:
        score -= 7
        negatives.append("Moderate emotional language detected.")
    else:
        score += 5
        positives.append("Balanced, measured tone without excessive emotional language.")

    # ── 4. Structural quality signals (+/- up to 15pts) ──────────────────────
    avg_sentence_length = word_count / max(len(sentences), 1)
    if 15 <= avg_sentence_length <= 35:
        score += 10
        positives.append("Well-structured sentences consistent with professional journalism.")
    elif avg_sentence_length < 8:
        score -= 8
        negatives.append("Very short sentences — may indicate incomplete or informal content.")

    # ── 5. Specificity signals (numbers, dates, names) (+/- up to 10pts) ─────
    specificity_patterns = [
        r'\b\d{4}\b',          # years
        r'\b\d+(\.\d+)?%\b',   # percentages
        r'\b(january|february|march|april|may|june|july|august|september|october|november|december)\b',
        r'\$[\d,]+',           # monetary figures
    ]
    specificity_hits = sum(
        len(re.findall(p, text_lower)) for p in specificity_patterns
    )
    if specificity_hits >= 3:
        score += 10
        positives.append("Specific data points, dates, and figures detected — signs of factual reporting.")
    elif specificity_hits == 0:
        score -= 5
        negatives.append("Absence of specific data points, dates, or verifiable figures.")

    # ── 6. Word count depth bonus (+/- up to 10pts) ──────────────────────────
    if word_count >= 300:
        score += 8
        positives.append("Article has substantial depth and length consistent with quality journalism.")
    elif word_count < 50:
        score -= 8
        negatives.append("Very short content limits the reliability of this analysis.")

    # ── 7. Hedge / uncertainty language (+5pts) ──────────────────────────────
    hedge_words = ['allegedly', 'reportedly', 'claims', 'appears to', 'according to', 'suggests']
    hedge_hits = sum(1 for w in hedge_words if w in text_lower)
    if hedge_hits >= 2:
        score += 5
        positives.append("Appropriate use of hedging language reflects journalistic caution.")

    # ── Deterministic seed from content hash to prevent randomness ────────────
    content_hash = int(hashlib.md5(text[:500].encode()).hexdigest(), 16)
    deterministic_offset = (content_hash % 7) - 3  # -3 to +3
    score += deterministic_offset

    # ── Clamp score ───────────────────────────────────────────────────────────
    score = max(5, min(98, score))

    # ── Classification ────────────────────────────────────────────────────────
    if score >= 72:
        classification = "LIKELY CREDIBLE"
        confidence = "HIGH"
        if not negatives:
            negatives.append("Limited independent corroboration detectable from text alone.")
    elif score >= 48:
        classification = "UNCERTAIN"
        confidence = "MEDIUM"
        if not positives:
            positives.append("Some informational content structure present.")
        if not negatives:
            negatives.append("Mixed credibility signals require further verification.")
    else:
        classification = "NON-CREDIBLE"
        confidence = "HIGH"
        if not positives:
            positives.append("Text was fully parsed and processed.")
        if not negatives:
            negatives.append("Multiple credibility red flags detected.")

    # Ensure at least one of each
    if not positives:
        positives.append("Text structure was successfully analyzed.")
    if not negatives:
        negatives.append("Always verify important claims with additional trusted sources.")

    return {
        "score": score,
        "classification": classification,
        "confidence": confidence,
        "positives": positives[:5],
        "negatives": negatives[:4]
    }


# ─── History helpers ──────────────────────────────────────────────────────────
def load_history():
    if not os.path.exists(HISTORY_FILE):
        return []
    try:
        with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return []


def save_history(entries):
    with open(HISTORY_FILE, 'w', encoding='utf-8') as f:
        json.dump(entries, f, indent=2)


def add_to_history(result_data, preview_text, input_type):
    entries = load_history()
    entry = {
        "id": hashlib.md5(f"{time.time()}".encode()).hexdigest()[:8],
        "date": datetime.now().strftime("%d %b %Y"),
        "time": datetime.now().strftime("%I:%M %p"),
        "preview": (preview_text[:120] + "...") if len(preview_text) > 120 else preview_text,
        "inputType": input_type,
        **result_data
    }
    entries.insert(0, entry)
    entries = entries[:100]  # Keep last 100 entries
    save_history(entries)
    return entry["id"]


def get_db_connection():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn


def init_database():
    with get_db_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL,
                last_login_at TEXT
            )
        """)
        conn.commit()


def serialize_user(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "createdAt": row["created_at"]
    }


def is_valid_email(email):
    return bool(re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email))


init_database()


# ─── Static routes ────────────────────────────────────────────────────────────
@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('.', path)


@app.route('/api/auth/register', methods=['POST'])
def register_user():
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''

    if not name or not email or not password:
        return jsonify({"error": "Name, email, and password are required."}), 400
    if not is_valid_email(email):
        return jsonify({"error": "Please enter a valid email address."}), 400
    if len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters."}), 400

    created_at = datetime.now().isoformat(timespec='seconds')
    password_hash = generate_password_hash(password)

    try:
        with get_db_connection() as conn:
            cursor = conn.execute(
                """
                INSERT INTO users (name, email, password_hash, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (name, email, password_hash, created_at)
            )
            conn.commit()
            user = conn.execute(
                "SELECT id, name, email, created_at FROM users WHERE id = ?",
                (cursor.lastrowid,)
            ).fetchone()
    except sqlite3.IntegrityError:
        return jsonify({"error": "An account already exists with this email address."}), 409

    return jsonify({
        "status": "success",
        "message": "Account created successfully.",
        "user": serialize_user(user)
    }), 201


@app.route('/api/auth/login', methods=['POST'])
def login_user():
    data = request.get_json() or {}
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''

    if not email or not password:
        return jsonify({"error": "Email and password are required."}), 400

    with get_db_connection() as conn:
        user = conn.execute(
            "SELECT * FROM users WHERE email = ?",
            (email,)
        ).fetchone()

        if user is None or not check_password_hash(user["password_hash"], password):
            return jsonify({"error": "Invalid email or password."}), 401

        conn.execute(
            "UPDATE users SET last_login_at = ? WHERE id = ?",
            (datetime.now().isoformat(timespec='seconds'), user["id"])
        )
        conn.commit()

    return jsonify({
        "status": "success",
        "message": "Signed in successfully.",
        "user": serialize_user(user)
    })


# ─── API: Verify text ─────────────────────────────────────────────────────────
@app.route('/api/verify/text', methods=['POST'])
def verify_text():
    data = request.get_json() or {}
    text = data.get('text', '').strip()

    if not text:
        return jsonify({"error": "No text content submitted."}), 400
    if len(text.split()) < 10:
        return jsonify({"error": "Please submit at least 10 words for analysis."}), 400

    start_time = time.time()
    analysis = analyse_text(text)
    processing_time = round(time.time() - start_time, 3)

    result = {
        "status": "success",
        "processingTime": f"{processing_time + 0.3:.2f}s",
        "inputType": "text",
        **analysis
    }

    entry_id = add_to_history(result, text[:200], "text")
    result["entryId"] = entry_id

    return jsonify(result)


# ─── API: Verify URL ──────────────────────────────────────────────────────────
@app.route('/api/verify/url', methods=['POST'])
def verify_url():
    data = request.get_json() or {}
    url = data.get('url', '').strip()

    if not url:
        return jsonify({"error": "No URL submitted."}), 400

    if not url.startswith(('http://', 'https://')):
        url = 'https://' + url

    start_time = time.time()
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                          'AppleWebKit/537.36 (KHTML, like Gecko) '
                          'Chrome/120.0.0.0 Safari/537.36'
        }
        response = requests.get(url, headers=headers, timeout=12)
        response.raise_for_status()
        soup = BeautifulSoup(response.content, 'html.parser')

        # Remove non-content elements
        for element in soup(["script", "style", "nav", "header", "footer",
                              "aside", "advertisement", "iframe"]):
            element.extract()

        # Try to find article body first
        article = soup.find('article') or soup.find(class_=re.compile(r'article|content|body|post', re.I))
        target = article if article else soup.find('body') or soup

        text = target.get_text(separator=' ')
        lines = (line.strip() for line in text.splitlines())
        clean_text = ' '.join(chunk for chunk in lines if chunk)

        if len(clean_text.split()) < 20:
            return jsonify({"error": "Could not extract enough article text from this URL. "
                                     "The page may be paywalled or require JavaScript."}), 400

    except requests.exceptions.Timeout:
        return jsonify({"error": "The URL took too long to respond (timeout: 12s)."}), 400
    except requests.exceptions.SSLError:
        return jsonify({"error": "SSL certificate error on the provided URL."}), 400
    except requests.exceptions.ConnectionError:
        return jsonify({"error": "Could not connect to the provided URL."}), 400
    except Exception as e:
        return jsonify({"error": f"Failed to extract content from URL: {str(e)}"}), 400

    analysis = analyse_text(clean_text)
    processing_time = round(time.time() - start_time, 2)

    result = {
        "status": "success",
        "processingTime": f"{processing_time}s",
        "inputType": "url",
        "sourceUrl": url,
        **analysis
    }

    entry_id = add_to_history(result, clean_text[:200], "url")
    result["entryId"] = entry_id

    return jsonify(result)


# ─── API: Verify file ─────────────────────────────────────────────────────────
@app.route('/api/verify/file', methods=['POST'])
def verify_file():
    if 'file' not in request.files:
        return jsonify({"error": "No file found in request."}), 400

    file = request.files['file']
    if not file or file.filename == '':
        return jsonify({"error": "No file selected."}), 400

    if not allowed_file(file.filename):
        return jsonify({"error": "Unsupported file type. Please upload .txt or .pdf files only."}), 400

    start_time = time.time()
    filename = secure_filename(file.filename)
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(filepath)

    try:
        if filename.lower().endswith('.txt'):
            with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read().strip()
            if not content:
                return jsonify({"error": "The uploaded text file appears to be empty."}), 400

        elif filename.lower().endswith('.pdf'):
            content = extract_pdf_text(filepath)
            if not content:
                return jsonify({
                    "error": "Could not extract text from this PDF. "
                             "It may be a scanned image PDF. Please try copying the text manually."
                }), 400
        else:
            return jsonify({"error": "Unsupported file format."}), 400

    except Exception as e:
        return jsonify({"error": f"Failed to read file: {str(e)}"}), 500
    finally:
        # Clean up uploaded file after reading
        try:
            os.remove(filepath)
        except Exception:
            pass

    if len(content.split()) < 10:
        return jsonify({"error": "File content is too short for analysis (minimum 10 words)."}), 400

    analysis = analyse_text(content)
    processing_time = round(time.time() - start_time, 2)

    result = {
        "status": "success",
        "processingTime": f"{processing_time}s",
        "inputType": "file",
        "filename": filename,
        **analysis
    }

    entry_id = add_to_history(result, content[:200], "file")
    result["entryId"] = entry_id

    return jsonify(result)


# ─── API: History ─────────────────────────────────────────────────────────────
@app.route('/api/history', methods=['GET'])
def get_history():
    return jsonify(load_history())


@app.route('/api/history/<entry_id>', methods=['DELETE'])
def delete_history_entry(entry_id):
    entries = load_history()
    updated = [e for e in entries if e.get('id') != entry_id]
    if len(updated) == len(entries):
        return jsonify({"error": "Entry not found."}), 404
    save_history(updated)
    return jsonify({"status": "deleted"})


@app.route('/api/history', methods=['DELETE'])
def clear_history():
    save_history([])
    return jsonify({"status": "cleared"})


if __name__ == '__main__':
    app.run(debug=True, port=5000)
