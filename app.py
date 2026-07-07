"""Backend Flask pour le Détecteur d'Accords Web (version iPhone/PWA)."""

import io
import os
import re
import uuid
import tempfile
import threading
import time
from typing import Optional

import yt_dlp
from flask import Flask, request, jsonify, send_file, render_template
from chord_detector import detect_chords, detect_structure, chord_color, chord_type_name
from pdf_export import build_chord_chart_pdf

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
        chords, duration, key_en, key_fr, tempo, beats_per_bar, bar_times = detect_chords(filepath)
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
            'color':  chord_color(c['chord']),
            'type':   chord_type_name(c['chord']),
        }
        for c in chords
    ]

    structure = detect_structure(chords, bar_times, duration)
    structure_out = [
        {
            'label': s['label'],
            'start': round(s['start'], 3),
            'end':   round(s['end'], 3),
        }
        for s in structure
    ]

    payload = {
        'file_id':       file_id,
        'duration':      round(duration, 2),
        'key_en':        key_en,
        'key_fr':        key_fr,
        'tempo':         round(float(tempo)),
        'beats_per_bar': beats_per_bar,
        'bar_times':     [round(t, 3) for t in bar_times],
        'chords':        chords_out,
        'structure':     structure_out,
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
        with yt_dlp.YoutubeDL({
            'quiet': True,
            'no_warnings': True,
            'noplaylist': True,
            'extractor_args': {'youtube': {'player_client': ['android']}},
        }) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as exc:
        if 'Sign in to confirm' in str(exc):
            return jsonify({
                'error': (
                    "YouTube bloque temporairement l'analyse de liens "
                    "depuis ce serveur. Réessaie plus tard, ou utilise "
                    "l'upload de fichier audio à la place."
                )
            }), 400
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
        # Le client 'web' par défaut force le streaming SABR et exige un PO
        # Token même sur ce format ; le client 'android' ne l'exige pas.
        'format': 'best',
        'outtmpl': os.path.join(UPLOAD_DIR, file_id + '.%(ext)s'),
        'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'wav'}],
        'noplaylist': True,
        'quiet': True,
        'no_warnings': True,
        'extractor_args': {'youtube': {'player_client': ['android']}},
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
    except Exception as exc:
        if 'Sign in to confirm' in str(exc):
            return jsonify({
                'error': (
                    "YouTube bloque temporairement l'analyse de liens "
                    "depuis ce serveur. Réessaie plus tard, ou utilise "
                    "l'upload de fichier audio à la place."
                )
            }), 400
        return jsonify({'error': f'Téléchargement échoué : {exc}'}), 500

    file_id_ext = file_id + '.wav'
    return _analyze_and_respond(
        os.path.join(UPLOAD_DIR, file_id_ext),
        file_id_ext,
        {'title': info.get('title', '')},
    )


@app.route('/api/export-pdf', methods=['POST'])
def export_pdf():
    data = request.get_json(silent=True) or {}
    chords = data.get('chords') or []
    if not chords:
        return jsonify({'error': 'Aucun accord à exporter.'}), 400

    tempo = int(data.get('tempo') or 120)
    duration = float(data.get('duration') or 0)
    structure = data.get('structure') or []
    bar_times = data.get('bar_times') or []

    try:
        pdf_bytes = build_chord_chart_pdf(
            title=data.get('title') or '',
            key_fr=data.get('key_fr') or '',
            tempo=tempo,
            chords=chords,
            structure=structure,
            duration=duration,
            bar_times=bar_times,
        )
    except Exception as exc:
        return jsonify({'error': f"Erreur lors de la génération du PDF : {exc}"}), 500

    return send_file(
        io.BytesIO(pdf_bytes),
        mimetype='application/pdf',
        as_attachment=True,
        download_name='grille-accords.pdf',
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
