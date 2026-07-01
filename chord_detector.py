import os
import subprocess
import numpy as np
import librosa
from scipy.ndimage import median_filter
from scipy.signal import resample_poly

NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

# ── Gabarits d'accords ────────────────────────────────────────────────

_TEMPLATES: dict[str, np.ndarray] = {}

def _build_templates() -> None:
    intervals = {
        '':     [0, 4, 7],
        'm':    [0, 3, 7],
        '7':    [0, 4, 7, 10],
        'm7':   [0, 3, 7, 10],
        'maj7': [0, 4, 7, 11],
        'sus2': [0, 2, 7],
        'sus4': [0, 5, 7],
        'dim':  [0, 3, 6],
        'aug':  [0, 4, 8],
        'add9': [0, 4, 7, 14],
    }
    for i, note in enumerate(NOTES):
        for quality, ivs in intervals.items():
            tpl = np.zeros(12, dtype=np.float32)
            for iv in ivs:
                tpl[(i + iv) % 12] = 1.0
            norm = np.linalg.norm(tpl)
            _TEMPLATES[f'{note}{quality}'] = tpl / norm

_build_templates()

# ── Couleurs et noms ──────────────────────────────────────────────────

CHORD_TYPE_NAMES: dict[str, str] = {
    'add9': 'Ajouté 9ème',
    'maj7': 'Majeur 7ème',
    'm7':   'Mineur 7ème',
    'sus2': 'Suspendu 2nde',
    'sus4': 'Suspendu 4te',
    'dim':  'Diminué',
    'aug':  'Augmenté',
    '7':    'Dominante 7ème',
    'm':    'Mineur',
    '':     'Majeur',
    'N':    '',
}

CHORD_COLORS: dict[str, str] = {
    'add9': '#4DB6AC',
    'maj7': '#80DEEA',
    'm7':   '#CE93D8',
    'sus2': '#FFD54F',
    'sus4': '#FFD54F',
    'dim':  '#FF8A65',
    'aug':  '#B39DDB',
    '7':    '#A5D6A7',
    'm':    '#EF9A9A',
    '':     '#4FC3F7',
    'N':    '#555555',
}


def chord_quality(chord: str) -> str:
    if chord == 'N':
        return 'N'
    for suffix in ('add9', 'maj7', 'm7', 'sus2', 'sus4', 'dim', 'aug', '7', 'm'):
        if chord.endswith(suffix):
            return suffix
    return ''


def chord_color(chord: str) -> str:
    return CHORD_COLORS.get(chord_quality(chord), '#4FC3F7')


def chord_type_name(chord: str) -> str:
    return CHORD_TYPE_NAMES.get(chord_quality(chord), '')


def format_time(seconds: float) -> str:
    s = int(seconds)
    return f'{s // 60}:{s % 60:02d}'


def transpose_chord(chord: str, semitones: int) -> str:
    """Transpose un accord de N demi-tons."""
    if chord == 'N' or semitones == 0:
        return chord
    for i, note in enumerate(NOTES):
        if chord.startswith(note) and (len(chord) == len(note) or chord[len(note)] not in '#'):
            new_root = NOTES[(i + semitones) % 12]
            return new_root + chord[len(note):]
    return chord


def chord_tones(chord: str) -> list[int]:
    """Retourne les indices de notes (0-11) composant l'accord."""
    if chord == 'N':
        return []
    for i, note in enumerate(NOTES):
        if chord.startswith(note) and (len(chord) == len(note) or chord[len(note)] not in '#'):
            quality = chord[len(note):]
            suffix_intervals = {
                '':     [0, 4, 7],
                'm':    [0, 3, 7],
                '7':    [0, 4, 7, 10],
                'm7':   [0, 3, 7, 10],
                'maj7': [0, 4, 7, 11],
                'sus2': [0, 2, 7],
                'sus4': [0, 5, 7],
                'dim':  [0, 3, 6],
                'aug':  [0, 4, 8],
                'add9': [0, 4, 7, 2],
            }
            ivs = suffix_intervals.get(quality, [0, 4, 7])
            return [(i + iv) % 12 for iv in ivs]
    return []


# ── Détection de tonalité (Krumhansl-Kessler) ─────────────────────────

_MAJOR_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09,
                            2.52, 5.19, 2.39, 3.66, 2.29, 2.88], dtype=np.float32)
_MINOR_PROFILE = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53,
                            2.54, 4.75, 3.98, 2.69, 3.34, 3.17], dtype=np.float32)

def _normalize(v: np.ndarray) -> np.ndarray:
    std = v.std()
    return (v - v.mean()) / (std if std > 0 else 1.0)

_MAJOR_NORM = _normalize(_MAJOR_PROFILE)
_MINOR_NORM = _normalize(_MINOR_PROFILE)

KEY_NAMES_FR = {
    'C major':  'Do majeur',    'C minor':  'Do mineur',
    'C# major': 'Ré♭ majeur',  'C# minor': 'Ré♭ mineur',
    'D major':  'Ré majeur',    'D minor':  'Ré mineur',
    'D# major': 'Mi♭ majeur',  'D# minor': 'Mi♭ mineur',
    'E major':  'Mi majeur',    'E minor':  'Mi mineur',
    'F major':  'Fa majeur',    'F minor':  'Fa mineur',
    'F# major': 'Fa♯ majeur',  'F# minor': 'Fa♯ mineur',
    'G major':  'Sol majeur',   'G minor':  'Sol mineur',
    'G# major': 'La♭ majeur',  'G# minor': 'La♭ mineur',
    'A major':  'La majeur',    'A minor':  'La mineur',
    'A# major': 'Si♭ majeur',  'A# minor': 'Si♭ mineur',
    'B major':  'Si majeur',    'B minor':  'Si mineur',
}


def detect_key(chroma: np.ndarray) -> tuple[str, str]:
    """Retourne (clé anglaise, clé française). Ex: ('G major', 'Sol majeur')."""
    chroma_mean = chroma.mean(axis=1)
    chroma_norm = _normalize(chroma_mean.astype(np.float32))

    best_key = 'C major'
    best_score = -np.inf

    for i, note in enumerate(NOTES):
        maj_score = float(np.dot(chroma_norm, np.roll(_MAJOR_NORM, i)))
        min_score = float(np.dot(chroma_norm, np.roll(_MINOR_NORM, i)))
        if maj_score > best_score:
            best_score = maj_score
            best_key = f'{note} major'
        if min_score > best_score:
            best_score = min_score
            best_key = f'{note} minor'

    return best_key, KEY_NAMES_FR.get(best_key, best_key)


# ── Détection d'accords ───────────────────────────────────────────────

MIN_CONFIDENCE = 0.38


def _match_frame(frame: np.ndarray) -> tuple[str, float]:
    best_name = 'N'
    best_score = MIN_CONFIDENCE
    for name, tpl in _TEMPLATES.items():
        score = float(np.dot(frame, tpl))
        if score > best_score:
            best_score = score
            best_name = name
    return best_name, best_score


def _merge_consecutive(items: list[tuple]) -> list[dict]:
    """Fusionne les accords consécutifs identiques."""
    merged: list[dict] = []
    for t, chord, score in items:
        if not merged or merged[-1]['chord'] != chord:
            merged.append({'time': t, 'chord': chord, 'score': score, 'end': 0.0})
        else:
            merged[-1]['score'] = max(merged[-1]['score'], score)
    return merged


def _estimate_tempo(y: np.ndarray, sr: int, hop_length: int) -> tuple[float, np.ndarray]:
    """Estimation du tempo par autocorrélation sur l'enveloppe d'onset (pur numpy)."""
    # Énergie par frame
    n_frames = len(y) // hop_length
    energy = np.array([
        np.sum(y[i * hop_length:(i + 1) * hop_length] ** 2)
        for i in range(n_frames)
    ], dtype=np.float32)
    onset_env = np.maximum(0.0, np.diff(energy, prepend=energy[0]))

    fps = sr / hop_length
    min_lag = max(1, int(60 * fps / 200))  # 200 BPM max
    max_lag = min(int(60 * fps / 50), len(onset_env) - 1)  # 50 BPM min

    if min_lag >= max_lag:
        tempo_bpm = 120.0
        period = int(fps * 60 / tempo_bpm)
    else:
        corr = np.correlate(onset_env, onset_env, mode='full')
        corr = corr[len(corr) // 2:]
        best_lag = min_lag + int(np.argmax(corr[min_lag:max_lag + 1]))
        tempo_bpm = 60.0 * fps / best_lag
        period = best_lag

    beat_frames = np.arange(period // 2, n_frames, period, dtype=int)
    return float(tempo_bpm), beat_frames


def _to_wav_if_needed(filepath: str) -> tuple[str, bool]:
    """Convertit m4a/aac en wav via ffmpeg si nécessaire. Retourne (chemin, converti)."""
    ext = os.path.splitext(filepath)[1].lower()
    if ext not in ('.m4a', '.aac'):
        return filepath, False
    wav_path = filepath + '_tmp.wav'
    result = subprocess.run(
        ['ffmpeg', '-y', '-i', filepath,
         '-ar', '22050', '-ac', '1', '-f', 'wav', wav_path],
        capture_output=True, timeout=120,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f'Conversion ffmpeg échouée : {result.stderr.decode(errors="replace")[-300:]}'
        )
    return wav_path, True


def detect_chords(
    filepath: str,
    hop_length: int = 512,
    progress_callback=None,
) -> tuple[list[dict], float, str, str, float]:
    """
    Détecte les accords avec synchronisation sur les temps du morceau.

    Retourne : (chords, duration, key_en, key_fr, tempo_bpm)
    """
    def cb(v: int) -> None:
        if progress_callback:
            progress_callback(v)

    cb(5)
    load_path, converted = _to_wav_if_needed(filepath)
    try:
        y, sr = librosa.load(load_path, sr=22050, mono=True)
    finally:
        if converted:
            try:
                os.unlink(load_path)
            except OSError:
                pass
    duration = float(len(y) / sr)
    cb(18)

    # Tempo via autocorrélation (évite librosa.beat.beat_track qui utilise guvectorize)
    tempo_bpm, beat_frames = _estimate_tempo(y, sr, hop_length)
    cb(30)

    # HPSS via filtre médian sur le spectrogramme (évite librosa.effects.hpss + guvectorize)
    S = librosa.stft(y, hop_length=hop_length)
    S_mag = np.abs(S)
    H_mag = median_filter(S_mag, size=(1, 31))
    y_harmonic = librosa.istft(H_mag * np.exp(1j * np.angle(S)), hop_length=hop_length)
    cb(48)

    # Chroma STFT (évite chroma_cqt qui utilise CQT avec resampling numba)
    chroma = librosa.feature.chroma_stft(
        y=y_harmonic, sr=sr, hop_length=hop_length, norm=2,
    )
    cb(62)

    # Synchronisation sur les temps (médiane sur chaque temps)
    n_frames = chroma.shape[1]
    beat_frames = beat_frames[beat_frames < n_frames]
    chroma_sync = librosa.util.sync(chroma, beat_frames, aggregate=np.median)
    beat_times = beat_frames * hop_length / sr
    cb(70)

    # Détection de tonalité
    key_en, key_fr = detect_key(chroma)
    cb(75)

    # Correspondance gabarits beat par beat
    raw: list[tuple[float, str, float]] = []
    for t, frame in zip(beat_times, chroma_sync.T):
        chord, score = _match_frame(frame.astype(np.float32))
        raw.append((float(t), chord, score))

    cb(88)

    # Fusion des accords consécutifs identiques
    merged = _merge_consecutive(raw)
    for i in range(len(merged) - 1):
        merged[i]['end'] = merged[i + 1]['time']
    if merged:
        merged[-1]['end'] = duration

    # Supprimer les segments trop courts (< 0.2 s) en les fusionnant au voisin
    MIN_DUR = 0.20
    cleaned: list[dict] = []
    for seg in merged:
        seg_dur = seg['end'] - seg['time']
        if seg_dur < MIN_DUR and cleaned:
            cleaned[-1]['end'] = seg['end']
            cleaned[-1]['score'] = max(cleaned[-1]['score'], seg['score'])
        else:
            cleaned.append(seg)

    cb(100)
    return cleaned, duration, key_en, key_fr, tempo_bpm
