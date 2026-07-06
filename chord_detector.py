import os
import subprocess

import numpy as np
import librosa
from madmom.audio.chroma import DeepChromaProcessor

NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

# ── Gabarits d'accords ────────────────────────────────────────────────
# madmom ne fournit qu'un extracteur de chroma (CNN) et un décodeur
# majeur/mineur (CRF) ; pour un vocabulaire enrichi, on garde le chroma
# CNN (nettement moins bruité que chroma_stft) mais on décode nous-mêmes
# par corrélation gabarits, mesure par mesure.

_CHORD_INTERVALS: dict[str, list[int]] = {
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

_TEMPLATES: dict[str, np.ndarray] = {}


def _build_templates() -> None:
    for i, note in enumerate(NOTES):
        for quality, ivs in _CHORD_INTERVALS.items():
            tpl = np.zeros(12, dtype=np.float32)
            for iv in ivs:
                tpl[(i + iv) % 12] = 1.0
            tpl /= np.linalg.norm(tpl)
            _TEMPLATES[f'{note}{quality}'] = tpl


_build_templates()

MIN_CONFIDENCE = 0.78  # cosine similarity ; en dessous → 'N' (pas d'accord)
# Calibré empiriquement sur 120 accords synthétiques (harmoniques réalistes,
# tous les couples racine/qualité) + 5 échantillons de bruit blanc : de 0.30
# à 0.90 le taux de bonne détection reste identique (73/120, les erreurs
# restantes sont des ambiguïtés de classes de hauteur inhérentes — aug
# symétrique par tierces majeures, dim sous-ensemble d'un 7 d'une autre
# fondamentale, sus2/sus4 partageant les mêmes notes — qu'aucun seuil ne
# résout). 0.78 est le seuil le plus bas qui élimine les faux positifs sur
# du bruit pur (5/5 → 0/5) sans coût sur les vrais accords ; au-delà de
# ~0.90 de vrais accords commencent à être ratés (passage à 'N').


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


def transpose_chord(chord: str, semitones: int) -> str:
    """Transpose un accord de N demi-tons."""
    if chord == 'N' or semitones == 0:
        return chord
    for i, note in enumerate(NOTES):
        if chord.startswith(note) and (len(chord) == len(note) or chord[len(note)] not in '#'):
            new_root = NOTES[(i + semitones) % 12]
            return new_root + chord[len(note):]
    return chord


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

    # Erreur d'octave : l'autocorrélation d'un signal périodique montre
    # aussi des pics à 2x, 3x... la vraie période, qui peuvent dépasser
    # le pic fondamental (fréquent en pratique — testé sur des rythmes
    # synthétiques 55-160 BPM connus, l'erreur x2 était systématique).
    # Si la moitié du lag trouvé a une corrélation presque aussi forte,
    # on préfère ce tempo double (plus proche du tempo perceptif réel
    # dans la quasi-totalité des cas testés). Une seule correction (pas
    # de boucle) : au-delà, le signal devient trop ambigu pour trancher
    # de façon fiable (testé : sur-corrige au-delà d'environ 170 BPM).
    half = best_lag // 2
    if half >= min_lag and corr[half] > 0.4 * corr[best_lag]:
        best_lag = half

    return 60.0 * fps / best_lag


def _match_frame(frame: np.ndarray) -> tuple[str, float]:
    """Accord le plus proche (corrélation cosinus) du vecteur chroma
    (12-dim) donné, ou 'N' si rien ne dépasse MIN_CONFIDENCE."""
    norm = float(np.linalg.norm(frame))
    if norm == 0.0:
        return 'N', 0.0
    frame = frame / norm
    best_name, best_score = 'N', MIN_CONFIDENCE
    for name, tpl in _TEMPLATES.items():
        score = float(np.dot(frame, tpl))
        if score > best_score:
            best_name, best_score = name, score
    return best_name, best_score


MIN_CHORD_DUR = 0.6  # secondes ; segments plus courts fusionnés au voisin


def _chroma_to_chord_segments(chroma: np.ndarray, duration: float) -> list[dict]:
    """Décode un accord par frame de chroma (grille temporelle réelle,
    indépendante du tempo estimé — un tempo mal estimé ferait dériver
    progressivement les accords par rapport à l'audio si on calait la
    grille dessus), puis fusionne les frames consécutives identiques et
    les segments trop courts (bruit d'une seule frame) au segment
    précédent. Retourne {'time', 'end', 'chord'}."""
    n_frames = chroma.shape[0]
    if n_frames == 0 or duration <= 0:
        return []
    fps = n_frames / duration

    segments: list[dict] = []
    for i in range(n_frames):
        name, _ = _match_frame(chroma[i].astype(np.float32))
        t = i / fps
        if segments and segments[-1]['chord'] == name:
            continue
        segments.append({'time': t, 'end': 0.0, 'chord': name})
    for i in range(len(segments) - 1):
        segments[i]['end'] = segments[i + 1]['time']
    if segments:
        segments[-1]['end'] = duration

    cleaned: list[dict] = []
    for seg in segments:
        if seg['end'] - seg['time'] < MIN_CHORD_DUR and cleaned:
            cleaned[-1]['end'] = seg['end']
        else:
            cleaned.append(seg)
    return cleaned


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
    Détecte les accords (vocabulaire enrichi : maj/min/7/maj7/m7/sus2/
    sus4/dim/aug/add9) par corrélation gabarits sur le chroma « profond »
    pré-entraîné de madmom (CNN, beaucoup moins bruité qu'un chroma STFT
    classique), frame par frame sur la grille temporelle réelle (pas de
    dépendance au tempo estimé, pour rester synchronisé avec l'audio).
    La tonalité utilise ce même chroma.

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

        chords = _chroma_to_chord_segments(chroma, duration)
        cb(95)
    finally:
        if converted:
            try:
                os.unlink(load_path)
            except OSError:
                pass

    cb(100)
    return chords, duration, key_en, key_fr, tempo_bpm


# ── Structure du morceau (heuristique) ────────────────────────────────
#
# On n'a pas d'analyse audio dédiée à la structure (auto-similarité
# spectrale/timbrale) : on repère plutôt les motifs d'accords qui se
# répètent (le refrain rejoue en général la même grille que ses autres
# occurrences), mesure par mesure. C'est une heuristique : elle se
# trompe notamment quand couplet et refrain partagent les mêmes
# accords, ce qui arrive souvent — sans les paroles, rien ne permet de
# les distinguer dans ce cas.

PATTERN_BARS = 4  # taille (en mesures) des blocs comparés pour détecter une répétition


def _make_chunk_bounds(n_bars: int, offset: int) -> list[tuple[int, int]]:
    """Bornes (en mesures) de blocs de PATTERN_BARS mesures, avec un
    éventuel bloc initial plus court de `offset` mesures — permet
    d'aligner la grille sur le vrai début des phrases musicales quand
    l'intro ne fait pas un nombre entier de PATTERN_BARS mesures."""
    bounds: list[tuple[int, int]] = []
    if offset > 0:
        bounds.append((0, offset))
    b = offset
    while b < n_bars:
        bounds.append((b, min(b + PATTERN_BARS, n_bars)))
        b += PATTERN_BARS
    return bounds


def _chunk_motifs(tokens: list[str], bounds: list[tuple[int, int]]) -> list[int]:
    """Associe à chaque bloc (défini par `bounds`) un identifiant de
    motif : deux blocs pleins (PATTERN_BARS mesures) ont le même
    identifiant s'ils jouent exactement la même grille d'accords. Les
    blocs partiels (le reste avant/après le dernier alignement possible
    de la grille) reçoivent chacun un identifiant unique : plus courts,
    ils matcheraient trop facilement par coïncidence, alors qu'ils sont
    surtout des restes d'intro/outro plutôt que de vraies répétitions."""
    sig_to_id: dict[tuple, int] = {}
    motif_id: list[int] = []
    for s, e in bounds:
        if e - s != PATTERN_BARS:
            motif_id.append(-(len(motif_id) + 1))  # id négatif unique, jamais partagé
            continue
        sig = tuple(tokens[s:e])
        if sig not in sig_to_id:
            sig_to_id[sig] = len(sig_to_id)
        motif_id.append(sig_to_id[sig])
    return motif_id


def _repetition_score(motif_id: list[int]) -> int:
    """Nombre de blocs faisant partie d'une répétition (motif partagé
    par au moins 2 blocs) — sert à choisir le meilleur alignement de
    grille (cf. _make_chunk_bounds)."""
    counts: dict[int, int] = {}
    for m in motif_id:
        counts[m] = counts.get(m, 0) + 1
    return sum(c for c in counts.values() if c >= 2)


def _label_motifs(motif_id: list[int]) -> list[str]:
    """Nomme chaque bloc (Intro/Couplet/Refrain/Pont/Outro) à partir des
    identifiants de motifs."""
    n = len(motif_id)

    # Regroupe en segments consécutifs (une même occurrence du motif)
    segments: list[tuple[int, int, int]] = []
    start = 0
    for b in range(1, n + 1):
        if b == n or motif_id[b] != motif_id[start]:
            segments.append((start, b, motif_id[start]))
            start = b

    occurrences: dict[int, int] = {}
    for _, _, m in segments:
        occurrences[m] = occurrences.get(m, 0) + 1

    repeated = [m for m, c in occurrences.items() if c >= 2]
    chorus_motif = max(repeated, key=lambda m: occurrences[m]) if repeated else None

    # Les motifs uniques (une seule occurrence) au milieu du morceau
    # sont des candidats "Pont" ; s'il y en a plusieurs, on les numérote.
    middle_unique = [
        idx for idx, (_, _, m) in enumerate(segments)
        if occurrences[m] == 1 and 0 < idx < len(segments) - 1
    ]

    verse_labels: dict[int, str] = {}
    verse_counter = 0
    pont_counter = 0
    labels = [''] * n

    for idx, (s, e, m) in enumerate(segments):
        if m == chorus_motif:
            label = 'Refrain'
        elif occurrences[m] >= 2:
            if m not in verse_labels:
                verse_counter += 1
                verse_labels[m] = f'Couplet {verse_counter}'
            label = verse_labels[m]
        elif idx == 0:
            label = 'Intro'
        elif idx == len(segments) - 1:
            label = 'Outro'
        else:
            if len(middle_unique) > 1:
                pont_counter += 1
                label = f'Pont {pont_counter}'
            else:
                label = 'Pont'
        for b in range(s, e):
            labels[b] = label

    return labels


def bars_per_chord(tempo_bpm: float) -> float:
    """Durée d'une mesure (secondes), hypothèse 4/4."""
    return 4 * 60.0 / tempo_bpm


def chords_to_bar_tokens(chords: list[dict], tempo_bpm: float, duration: float) -> list[str]:
    """Rééchantillonne la liste d'accords détectés sur une grille de
    mesures régulière (un accord par mesure, hypothèse 4/4) : sert à la
    fois à la détection de structure et à l'export en grille."""
    if not chords or duration <= 0 or tempo_bpm <= 0:
        return []
    bar_dur = bars_per_chord(tempo_bpm)
    n_bars = max(1, round(duration / bar_dur))
    tokens: list[str] = []
    ci = 0
    for b in range(n_bars):
        t_mid = (b + 0.5) * bar_dur
        while ci + 1 < len(chords) and chords[ci]['end'] <= t_mid:
            ci += 1
        tokens.append(chords[ci]['chord'])
    return tokens


def detect_structure(
    chords: list[dict],
    tempo_bpm: float,
    duration: float,
) -> list[dict]:
    """
    Découpe le morceau en sections nommées (Intro/Couplet/Refrain/Pont/
    Outro) à partir des répétitions de la grille d'accords, mesure par
    mesure (hypothèse 4/4). Retourne une liste de
    {'label', 'start', 'end'} — vide si le morceau est trop court pour
    qu'une répétition ait un sens.
    """
    tokens = chords_to_bar_tokens(chords, tempo_bpm, duration)
    n_bars = len(tokens)
    if n_bars < PATTERN_BARS * 2:
        return [{'label': 'Chanson', 'start': 0.0, 'end': duration}] if tokens else []

    bar_dur = bars_per_chord(tempo_bpm)

    # Essaie plusieurs décalages de grille (l'intro n'a pas forcément un
    # nombre entier de PATTERN_BARS mesures) et garde celui qui capture
    # le plus de répétitions.
    best_bounds, best_motif_id, best_score = None, None, -1
    for offset in range(PATTERN_BARS):
        bounds = _make_chunk_bounds(n_bars, offset)
        motif_id = _chunk_motifs(tokens, bounds)
        score = _repetition_score(motif_id)
        if score > best_score:
            best_bounds, best_motif_id, best_score = bounds, motif_id, score

    labels = _label_motifs(best_motif_id)

    sections: list[dict] = []
    for (b0, b1), label in zip(best_bounds, labels):
        t0 = b0 * bar_dur
        t1 = min(b1 * bar_dur, duration)
        if sections and sections[-1]['label'] == label:
            sections[-1]['end'] = t1
        else:
            sections.append({'label': label, 'start': t0, 'end': t1})
    return sections
