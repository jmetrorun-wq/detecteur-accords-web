"""Backend Flask pour ChordSplit (version iPhone/PWA)."""

import io
import os
import re
import subprocess
import uuid
import tempfile
import threading
import time
from typing import Optional

import yt_dlp
from flask import Flask, request, jsonify, send_file, render_template, make_response
from chord_detector import detect_chords, detect_structure, chord_color, chord_type_name
from pdf_export import build_chord_chart_pdf

app = Flask(__name__, static_folder='static', template_folder='templates')


# Versionnage des assets : ?v=<version> sur les <script>/<link> du
# template, recalculé au démarrage à partir de la date de modif des
# fichiers statiques. iOS Safari (surtout en PWA « écran d'accueil »)
# garde app.js/style.css en cache très longtemps malgré Cache-Control:
# no-cache — sans ce paramètre, un déploiement ne se voit pas côté client.
_STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static')


def _asset_version() -> str:
    try:
        return str(int(max(
            os.path.getmtime(os.path.join(_STATIC_DIR, f))
            for f in ('app.js', 'style.css', 'piano.js', 'guitar.js')
        )))
    except OSError:
        return '0'


ASSET_VERSION = _asset_version()


@app.context_processor
def _inject_asset_version():
    return {'asset_version': ASSET_VERSION}

# ── Stockage temporaire des fichiers uploadés ─────────────────────────
UPLOAD_DIR = os.path.join(tempfile.gettempdir(), 'chordweb')
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Limite de durée pour les liens YouTube : au-delà, le pic mémoire de
# l'analyse (STFT + chroma) dépasse la RAM du plan gratuit Render (512 Mo).
MAX_YOUTUBE_DURATION_S = 360

# Limite de durée pour la séparation de pistes (demucs) : la RAM du
# sous-processus croît avec la durée du morceau (~3,3 Go mesurés sur 5min38,
# cf. stem_separator.py) — on borne pour rester dans la marge du plan
# Cloud Run même avec le reste du pipeline actif à côté.
MAX_SEPARATION_DURATION_S = 480

# Séparation de pistes : uniquement disponible sur le déploiement Cloud Run
# (torch/torchaudio/demucs installés seulement dans le Dockerfile, jamais
# dans requirements.txt/Render — cf. stem_separator.py). Gardé par cette
# variable d'environnement, sur le même principe qu'ENABLE_METER_DETECTION.
STEM_SEPARATION_ENABLED = bool(os.environ.get('ENABLE_STEM_SEPARATION'))


def _probe_duration(filepath: str) -> float:
    """Durée d'un fichier audio via ffprobe (gère tous les formats,
    contrairement à soundfile qui ne lit pas l'AAC/M4A)."""
    try:
        out = subprocess.run(
            ['ffprobe', '-v', 'quiet', '-show_entries', 'format=duration',
             '-of', 'csv=p=0', filepath],
            capture_output=True, text=True, timeout=10,
        )
        return float(out.stdout.strip())
    except (ValueError, subprocess.SubprocessError):
        return 0.0

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
    # Jamais mis en cache : le HTML porte le ?v= des assets, il doit
    # toujours être rechargé pour qu'un déploiement se voie (iOS Safari /
    # PWA cachent sinon la page indéfiniment).
    resp = make_response(render_template('index.html'))
    resp.headers['Cache-Control'] = 'no-store, must-revalidate'
    return resp


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
    # Ré-analyse d'une piste déjà séparée (cf. /api/separate) : évite de
    # re-télécharger/ré-uploader un fichier déjà présent côté serveur.
    # Restreint aux fichiers `sep_*.wav` qu'on a nous-mêmes produits.
    existing_id = request.form.get('existing_file_id') \
        or (request.get_json(silent=True) or {}).get('existing_file_id')
    if existing_id:
        safe_id = os.path.basename(existing_id)
        filepath = os.path.join(UPLOAD_DIR, safe_id)
        if not safe_id.startswith('sep_') or not os.path.exists(filepath):
            return jsonify({'error': 'Fichier introuvable.'}), 400
        return _analyze_and_respond(filepath, safe_id)

    if 'audio' not in request.files:
        return jsonify({'error': 'Aucun fichier audio reçu.'}), 400

    f = request.files['audio']
    if not f.filename:
        return jsonify({'error': 'Nom de fichier vide.'}), 400

    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in ('.mp3', '.wav', '.flac', '.ogg', '.oga', '.opus', '.m4a',
                   '.aac', '.aiff', '.aif', '.wma', '.webm', '.mp4'):
        return jsonify({'error': f'Format non supporté : {ext}'}), 400

    file_id = str(uuid.uuid4())
    filepath = os.path.join(UPLOAD_DIR, file_id + ext)
    f.save(filepath)

    # Le conteneur webm/mp4 produit par MediaRecorder (enregistrement micro
    # côté navigateur) n'a pas de Cues/Duration finalisés : detect_chords()
    # sait le lire (cf. _to_wav_if_needed dans chord_detector.py), mais
    # Chrome refuse de le relire tel quel via une balise <audio src=...>
    # servie en HTTP (reste bloqué à HAVE_NOTHING, testé et confirmé). On le
    # convertit donc en wav dès l'upload, une bonne fois, pour l'analyse et
    # pour la lecture qui sera servie ensuite par /api/audio.
    if ext in ('.webm', '.mp4'):
        wav_path = os.path.join(UPLOAD_DIR, file_id + '.wav')
        result = subprocess.run(
            ['ffmpeg', '-y', '-i', filepath, '-ar', '22050', '-ac', '1', wav_path],
            capture_output=True, timeout=120,
        )
        os.unlink(filepath)
        if result.returncode != 0:
            return jsonify({'error': "Conversion de l'enregistrement échouée."}), 500
        filepath = wav_path
        file_id += '.wav'
    elif ext in ('.wma', '.aiff', '.aif', '.opus', '.oga'):
        # Formats acceptés à l'analyse mais pas lus de façon fiable par
        # tous les <audio> (surtout .wma, jamais lu en navigateur) — on
        # transcode en mp3 dès l'upload pour que la lecture marche partout.
        mp3_path = os.path.join(UPLOAD_DIR, file_id + '.mp3')
        result = subprocess.run(
            ['ffmpeg', '-y', '-i', filepath, '-ac', '1',
             '-codec:a', 'libmp3lame', '-b:a', '192k', mp3_path],
            capture_output=True, timeout=180,
        )
        os.unlink(filepath)
        if result.returncode != 0:
            return jsonify({'error': "Conversion du fichier audio échouée."}), 500
        filepath = mp3_path
        file_id += '.mp3'
    else:
        file_id += ext

    return _analyze_and_respond(filepath, file_id)


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


# Le mimetypes.guess_type() par défaut de Python mappe .webm sur
# "video/webm" (registre système, pas de piste vidéo dans nos
# enregistrements) — certains navigateurs refusent de lire ça dans une
# balise <audio>. Table explicite pour forcer un type audio/* correct.
_AUDIO_MIMETYPES = {
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac',
    '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
    '.webm': 'audio/webm', '.mp4': 'audio/mp4',
}


@app.route('/api/audio/<path:file_id>')
def serve_audio(file_id):
    """Sert le fichier audio avec support Range (obligatoire pour iOS)."""
    filepath = os.path.join(UPLOAD_DIR, file_id)
    if not os.path.exists(filepath):
        return 'Fichier introuvable', 404
    ext = os.path.splitext(file_id)[1].lower()
    mimetype = _AUDIO_MIMETYPES.get(ext)
    return send_file(filepath, conditional=True, mimetype=mimetype)


@app.route('/api/separate', methods=['POST'])
def separate():
    if not STEM_SEPARATION_ENABLED:
        return jsonify({'error': 'Séparation de pistes indisponible sur ce déploiement.'}), 501

    data = request.get_json(silent=True) or {}
    file_id = (data.get('file_id') or '').strip()
    filepath = os.path.join(UPLOAD_DIR, file_id)
    if not file_id or not os.path.exists(filepath):
        return jsonify({'error': 'Fichier introuvable (relance une analyse).'}), 400

    duration = _probe_duration(filepath)
    if duration > MAX_SEPARATION_DURATION_S:
        return jsonify({
            'error': (
                f'Morceau trop long ({duration // 60:.0f} min) : '
                f'{MAX_SEPARATION_DURATION_S // 60} min max pour la séparation.'
            )
        }), 400

    from stem_separator import start_job
    try:
        job_id = start_job(filepath, UPLOAD_DIR)
    except RuntimeError as exc:
        return jsonify({'error': str(exc)}), 409

    return jsonify({'job_id': job_id})


@app.route('/api/separate/status/<job_id>')
def separate_status(job_id):
    if not STEM_SEPARATION_ENABLED:
        return jsonify({'error': 'Séparation de pistes indisponible sur ce déploiement.'}), 501

    from stem_separator import get_status, STEMS
    job = get_status(job_id)
    if not job:
        return jsonify({'error': 'Job introuvable.'}), 404

    out = {'status': job['status'], 'progress': job['progress']}
    if job['status'] == 'error':
        out['error'] = job['error']
    if job['status'] == 'done':
        out['stems'] = list(STEMS)
    return jsonify(out)


@app.route('/api/separate/download/<job_id>/<stem>')
def separate_download(job_id, stem):
    if not STEM_SEPARATION_ENABLED:
        return 'Séparation de pistes indisponible sur ce déploiement.', 501

    from stem_separator import STEMS
    if stem not in STEMS:
        return 'Piste invalide', 404
    filepath = os.path.join(UPLOAD_DIR, f'sep_{job_id}_{stem}.mp3')
    if not os.path.exists(filepath):
        return 'Fichier introuvable', 404
    return send_file(filepath, conditional=True)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    app.run(host='0.0.0.0', port=port, debug=False)
