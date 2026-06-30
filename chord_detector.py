import numpy as np
import librosa
from scipy.ndimage import median_filter

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
    y, sr = librosa.load(filepath, sr=22050, mono=True)
    duration = float(len(y) / sr)
    cb(18)

    # Beat tracking
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, hop_length=hop_length)
    tempo_bpm = float(np.asarray(tempo).ravel()[0])
    cb(30)

    # Séparation harmonique / percussive :
    # margin élevé = séparation stricte → on ne garde que les sons tenus (accords)
    # et on écarte mélodie + percussions
    y_harmonic, _ = librosa.effects.hpss(y, margin=4.0)
    cb(48)

    # Chroma CQT uniquement sur la composante harmonique
    chroma = librosa.feature.chroma_cqt(
        y=y_harmonic, sr=sr, hop_length=hop_length, bins_per_octave=36, norm=2,
    )
    cb(62)

    # Synchronisation sur les temps (médiane sur chaque temps)
    chroma_sync = librosa.util.sync(chroma, beat_frames, aggregate=np.median)
    beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=hop_length)
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
