"""Backend Flask pour le Détecteur d'Accords Web (version iPhone/PWA)."""

import os
import re
import uuid
import tempfile
import threading
import time
from typing import Optional

import yt_dlp
from flask import Flask, request, jsonify, send_file, render_template
from chord_detector import detect_chords, chord_color, chord_type_name

app = Flask(__name__, static_folder='static', template_folder='templates')

# ── Stockage temporaire des fichiers uploadés ─────────────────────────
UPLOAD_DIR = os.path.join(tempfile.gettempdir(), 'chordweb')
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Limite de durée pour les liens YouTube : au-delà, le pic mémoire de
# l'analyse (STFT + chroma) dépasse la RAM du plan gratuit Render (512 Mo).
MAX_YOUTUBE_DURATION_S = 360

YOUTUBE_URL_RE = re.compile(
    r'^https?://(www\.|m\.)?(youtube\.com/(watch\?|shorts/)|youtu\.be/)',
    re.IGNORECASE,
)

# Nettoyage automatique : supprime les fichiers > 1 heure
def _cleanup_old_files():
    while True:
        time.sleep(3600)
        now = time.time()
        for fname in os.listdir(UPLOAD_DIR):
            fpath = os.path.join(UPLOAD_DIR, fname)
            try:
                if os.path.getmtime(fpath) < now - 3600:
                    os.unlink(fpath)
            except OSError:
                pass

threading.Thread(target=_cleanup_old_files, daemon=True).start()


# ── Routes ────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')


def _analyze_and_respond(filepath: str, file_id: str, extra: Optional[dict] = None):
    """Lance detect_chords() sur filepath et construit la réponse JSON."""
    try:
        chords, duration, key_en, key_fr, tempo = detect_chords(filepath)
    except Exception as exc:
        try:
            os.unlink(filepath)
        except OSError:
            pass
        return jsonify({'error': f'Erreur d\'analyse : {exc}'}), 500

    chords_out = [
        {
            'time':   round(c['time'], 3),
            'end':    round(c['end'], 3),
            'chord':  c['chord'],
            'score':  round(c['score'], 3),
            'color':  chord_color(c['chord']),
            'type':   chord_type_name(c['chord']),
        }
        for c in chords
    ]

    payload = {
        'file_id':  file_id,
        'duration': round(duration, 2),
        'key_en':   key_en,
        'key_fr':   key_fr,
        'tempo':    round(float(tempo)),
        'chords':   chords_out,
    }
    if extra:
        payload.update(extra)
    return jsonify(payload)


@app.route('/api/analyze', methods=['POST'])
def analyze():
    if 'audio' not in request.files:
        return jsonify({'error': 'Aucun fichier audio reçu.'}), 400

    f = request.files['audio']
    if not f.filename:
        return jsonify({'error': 'Nom de fichier vide.'}), 400

    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in ('.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac'):
        return jsonify({'error': f'Format non supporté : {ext}'}), 400

    file_id = str(uuid.uuid4())
    filepath = os.path.join(UPLOAD_DIR, file_id + ext)
    f.save(filepath)

    return _analyze_and_respond(filepath, file_id + ext)


@app.route('/api/analyze-youtube', methods=['POST'])
def analyze_youtube():
    data = request.get_json(silent=True) or {}
    url = (data.get('url') or '').strip()
    if not url:
        return jsonify({'error': 'Lien manquant.'}), 400
    if not YOUTUBE_URL_RE.match(url):
        return jsonify({'error': 'Lien YouTube invalide.'}), 400

    try:
        with yt_dlp.YoutubeDL({'quiet': True, 'no_warnings': True, 'noplaylist': True}) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as exc:
        return jsonify({'error': f'Vidéo introuvable : {exc}'}), 400

    video_duration = info.get('duration') or 0
    if video_duration > MAX_YOUTUBE_DURATION_S:
        return jsonify({
            'error': (
                f'Vidéo trop longue ({video_duration // 60:.0f} min) : '
                f'{MAX_YOUTUBE_DURATION_S // 60} min max.'
            )
        }), 400

    file_id = str(uuid.uuid4())
    ydl_opts = {
        # 'bestaudio' est désormais bloqué par YouTube sans PO Token ; le
        # format progressif classique ('best', généralement mp4 360p muxé)
        # reste accessible sans token et suffit pour l'extraction audio.
        'format': 'best',
        'outtmpl': os.path.join(UPLOAD_DIR, file_id + '.%(ext)s'),
        'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'wav'}],
        'noplaylist': True,
        'quiet': True,
        'no_warnings': True,
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
    except Exception as exc:
        return jsonify({'error': f'Téléchargement échoué : {exc}'}), 500

    file_id_ext = file_id + '.wav'
    return _analyze_and_respond(
        os.path.join(UPLOAD_DIR, file_id_ext),
        file_id_ext,
        {'title': info.get('title', '')},
    )


@app.route('/api/audio/<path:file_id>')
def serve_audio(file_id):
    """Sert le fichier audio avec support Range (obligatoire pour iOS)."""
    filepath = os.path.join(UPLOAD_DIR, file_id)
    if not os.path.exists(filepath):
        return 'Fichier introuvable', 404
    return send_file(filepath, conditional=True)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    app.run(host='0.0.0.0', port=port, debug=False)
