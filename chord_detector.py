import os
import subprocess

import numpy as np
import librosa
from madmom.audio.chroma import DeepChromaProcessor
from madmom.features.chords import DeepChromaChordRecognitionProcessor

NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

# ── Couleurs et noms ──────────────────────────────────────────────────
# Le moteur de détection (madmom) ne reconnaît que les accords
# majeur/mineur ; ces tables ne couvrent donc que '' (majeur), 'm'
# (mineur) et 'N' (pas d'accord).

CHORD_TYPE_NAMES: dict[str, str] = {
    'm': 'Mineur',
    '':  'Majeur',
    'N': '',
}

CHORD_COLORS: dict[str, str] = {
    'm': '#EF9A9A',
    '':  '#4FC3F7',
    'N': '#555555',
}


def chord_quality(chord: str) -> str:
    if chord == 'N':
        return 'N'
    return 'm' if chord.endswith('m') else ''


def chord_color(chord: str) -> str:
    return CHORD_COLORS.get(chord_quality(chord), '#4FC3F7')


def chord_type_name(chord: str) -> str:
    return CHORD_TYPE_NAMES.get(chord_quality(chord), '')


def transpose_chord(chord: str, semitones: int) -> str:
    """Transpose un accord de N demi-tons."""
    if chord == 'N' or semitones == 0:
        return chord
    for i, note in enumerate(NOTES):
        if chord.startswith(note) and (len(chord) == len(note) or chord[len(note)] not in '#'):
            new_root = NOTES[(i + semitones) % 12]
            return new_root + chord[len(note):]
    return chord


def _madmom_label_to_chord(label: str) -> str:
    """Convertit un label madmom ('C:maj', 'A:min', 'N') vers notre
    format ('C', 'Am', 'N')."""
    if label == 'N':
        return 'N'
    root, _, quality = label.partition(':')
    return root if quality == 'maj' else root + 'm'


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
    """Retourne (clé anglaise, clé française). Ex: ('G major', 'Sol majeur').

    chroma : tableau (12, n_frames).
    """
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


# ── Détection de tempo (autocorrélation, sans dépendance numba) ───────

def _estimate_tempo(y: np.ndarray, sr: int, hop_length: int) -> float:
    """Estimation du tempo par autocorrélation sur l'enveloppe d'onset (pur numpy)."""
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
        return 120.0

    corr = np.correlate(onset_env, onset_env, mode='full')
    corr = corr[len(corr) // 2:]
    best_lag = min_lag + int(np.argmax(corr[min_lag:max_lag + 1]))
    return 60.0 * fps / best_lag


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
    Détecte les accords (majeur/mineur) via le modèle pré-entraîné madmom
    (extracteur de chroma par CNN + décodage CRF), et la tonalité à
    partir du même chroma.

    Retourne : (chords, duration, key_en, key_fr, tempo_bpm)
    """
    def cb(v: int) -> None:
        if progress_callback:
            progress_callback(v)

    cb(5)
    load_path, converted = _to_wav_if_needed(filepath)
    try:
        y, sr = librosa.load(load_path, sr=22050, mono=True)
        duration = float(len(y) / sr)
        cb(15)

        # Tempo via autocorrélation (évite librosa.beat.beat_track qui utilise guvectorize)
        tempo_bpm = _estimate_tempo(y, sr, hop_length)
        cb(30)

        # Chroma « profond » (CNN pré-entraîné madmom), utilisé à la fois
        # pour la détection d'accords et la détection de tonalité.
        chroma = DeepChromaProcessor()(load_path)  # (n_frames, 12)
        cb(60)

        key_en, key_fr = detect_key(chroma.T)
        cb(70)

        segments = DeepChromaChordRecognitionProcessor()(chroma)
        cb(95)
    finally:
        if converted:
            try:
                os.unlink(load_path)
            except OSError:
                pass

    chords = [
        {
            'time':  float(start),
            'end':   float(end),
            'chord': _madmom_label_to_chord(label),
        }
        for start, end, label in segments
    ]

    cb(100)
    return chords, duration, key_en, key_fr, tempo_bpm
