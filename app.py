"""Backend Flask pour le Détecteur d'Accords Web (version iPhone/PWA)."""

import os
import sys
from types import ModuleType

# Remplace numba par un stub no-op AVANT tout import de librosa.
# numba est incompatible Python 3.14 ('get_call_template' crash à l'import).
# Librosa détecte l'absence de numba et utilise le fallback numpy pur.
os.environ['NUMBA_DISABLE_JIT'] = '1'

class _NumbaStub(ModuleType):
    """Stub no-op pour numba (incompatible Python 3.14).
    Couvre les attributs scalaires et les décorateurs utilisés par librosa."""

    # Attributs string attendus par librosa (ex: numba.__version__.endswith(...))
    __version__  = '0.59.0'
    __file__     = ''
    __path__     = []
    __package__  = 'numba'

    # Faux types numba (float32, int32, etc.) utilisés dans les signatures
    class _FakeType:
        def __getitem__(self, _): return self
    float32 = _FakeType()
    float64 = _FakeType()
    int32   = _FakeType()
    int64   = _FakeType()
    complex64  = _FakeType()
    complex128 = _FakeType()
    boolean = _FakeType()

    def __getattr__(self, name):
        # Retourne un décorateur no-op pour @jit, @guvectorize, @vectorize…
        def noop(*args, **kwargs):
            if args and callable(args[0]) and not isinstance(args[0], (str, list, tuple)):
                return args[0]          # @numba.jit(fn) sans arguments
            return lambda fn: fn        # @numba.jit(...)(fn)
        return noop

_stub = _NumbaStub('numba')
for _mod in ('numba', 'numba.core', 'numba.np', 'numba.np.ufunc',
             'numba.types', 'numba.typed', 'numba.extending'):
    sys.modules[_mod] = _stub

import uuid
import tempfile
import threading
import time

from flask import Flask, request, jsonify, send_file, render_template
from chord_detector import detect_chords, chord_color, chord_type_name

app = Flask(__name__, static_folder='static', template_folder='templates')

# ── Stockage temporaire des fichiers uploadés ─────────────────────────
UPLOAD_DIR = os.path.join(tempfile.gettempdir(), 'chordweb')
os.makedirs(UPLOAD_DIR, exist_ok=True)

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

    try:
        chords, duration, key_en, key_fr, tempo = detect_chords(filepath)
    except Exception as exc:
        os.unlink(filepath)
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

    return jsonify({
        'file_id':  file_id + ext,
        'duration': round(duration, 2),
        'key_en':   key_en,
        'key_fr':   key_fr,
        'tempo':    round(float(tempo)),
        'chords':   chords_out,
    })


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
