"""Détection d'accords à grand vocabulaire via le modèle ISMIR 2019
« Large-Vocabulary Chord Transcription via Chord Structure Decomposition »
(Music X Lab, NYU Shanghai — https://github.com/music-x-lab/
ISMIR2019-Large-Vocabulary-Chord-Recognition, licence MIT).

Le code du modèle est vendoré tel quel dans `chordnet_ismir/` (avec
quelques patchs de compat numpy 2 / torch >= 2.6 / librosa 0.10, cf.
`chordnet_ismir/PATCHES.md`). On l'exécute en **sous-processus**
(`chord_recognition.py`), sur le même principe que `stem_separator.py`
pour demucs : torch (~150 Mo rien qu'à l'import) ne doit jamais être
importé dans le worker gunicorn, et la RAM du modèle doit être libérée
dès la fin du job.

N'est utile et activé que sur le déploiement Cloud Run (torch installé
seulement dans le Dockerfile, jamais dans requirements.txt / Render),
via la variable d'environnement `ENABLE_LARGEVOCAB_CHORDS` — même
principe qu'`ENABLE_METER_DETECTION` / `ENABLE_STEM_SEPARATION`.

Le modèle produit un vocabulaire riche (9/11/13, renversements, hdim7…) ;
le frontend de ChordSplit (diagrammes guitare, piano) ne sait afficher
que maj/min/7/m7/maj7/sus2/sus4/dim/aug/add9. `translate_label` réduit
donc chaque étiquette à ce vocabulaire (les extensions retombent sur
l'accord de septième le plus proche, la basse d'un renversement est
ignorée). C'est une perte assumée : le gain reste net face au décodage
par gabarits sur chroma CNN, incapable de distinguer maj7 de maj.
"""
import json
import os
import subprocess
import sys
import tempfile

MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'chordnet_ismir')

# Le modèle émet ses fondamentales via NUM_TO_ABS_SCALE (complex_chord.py),
# qui utilise des bémols pour Ré#/Sol#/La# — le frontend n'accepte que des dièses.
_ROOT_MAP = {'Eb': 'D#', 'Ab': 'G#', 'Bb': 'A#'}

# Qualités du dictionnaire « submission » (celui utilisé par
# chord_recognition.py) → vocabulaire ChordSplit. Clé = partie après
# « <root>: » et avant un éventuel « /<basse> », parenthèses retirées.
_QUALITY_MAP = {
    'maj': '', 'min': 'm', '7': '7', 'min7': 'm7', 'maj7': 'maj7',
    'sus2': 'sus2', 'sus4': 'sus4',
    'dim': 'dim', 'dim7': 'dim', 'hdim7': 'dim',
    'aug': 'aug',
    '9': '7', 'maj9': 'maj7', 'min9': 'm7', '11': '7', '13': '7',
}

MIN_CHORD_DUR = 0.6  # s ; segments plus courts fusionnés au précédent (cf. chord_detector)

# Le retard perçu des accords sur l'audio est traité de deux façons :
#  - transitions calées sur les temps (paramètre `beats` de detect ci-dessous),
#    qui supprime le « le HMM attend d'avoir assez d'évidence » ;
#  - une anticipation globale côté frontend (SYNC_LEAD_S dans static/app.js),
#    qui compense le retard constant de audio.currentTime sur la sortie
#    audio réelle (surtout iOS) et touche AUSSI la barre de mesures.
# Plus de décalage temporel appliqué ici.


def translate_label(lab: str) -> str:
    """`'Eb:min7'` → `'D#m7'`, `'C:maj/5'` → `'C'`, `'N'`/`'X'` → `'N'`."""
    lab = lab.strip()
    if ':' not in lab:
        return 'N'  # 'N', 'X'
    root, rest = lab.split(':', 1)
    root = _ROOT_MAP.get(root, root)
    quality = rest.split('/', 1)[0]  # ignore la basse d'un renversement
    if '(' in quality:
        quality = quality[:quality.index('(')]  # sus4(b7) → sus4
    mapped = _QUALITY_MAP.get(quality)
    if mapped is None:
        # Repli sur la triade sous-jacente si le préfixe est reconnaissable.
        if quality.startswith('min'):
            mapped = 'm'
        elif quality.startswith('maj') or quality[:1].isdigit():
            mapped = ''
        else:
            return 'N'
    return root + mapped


def _parse_lab(lab_path: str, duration: float) -> list[dict]:
    """Lit le .lab (`start\\tend\\tlabel`), traduit, fusionne les segments
    consécutifs identiques puis absorbe ceux plus courts que
    MIN_CHORD_DUR dans le précédent. Retourne `[{'time','end','chord'}]`."""
    raw: list[tuple[float, float, str]] = []
    with open(lab_path) as f:
        for line in f:
            parts = line.strip().split('\t')
            if len(parts) != 3:
                continue
            start, end, label = float(parts[0]), float(parts[1]), parts[2]
            raw.append((start, end, translate_label(label)))
    if not raw:
        return []

    merged: list[dict] = []
    for start, end, chord in raw:
        if merged and merged[-1]['chord'] == chord:
            merged[-1]['end'] = end
        else:
            merged.append({'time': start, 'end': end, 'chord': chord})
    merged[-1]['end'] = max(merged[-1]['end'], duration)

    cleaned: list[dict] = []
    for seg in merged:
        if seg['end'] - seg['time'] < MIN_CHORD_DUR and cleaned:
            cleaned[-1]['end'] = seg['end']
        else:
            cleaned.append(seg)
    # Un premier segment trop court n'a pas pu être absorbé en arrière : on
    # l'absorbe en avant (le modèle émet quasi toujours un 'N' sous la
    # frame juste à t=0).
    while len(cleaned) >= 2 and cleaned[0]['end'] - cleaned[0]['time'] < MIN_CHORD_DUR:
        cleaned[1]['time'] = cleaned[0]['time']
        cleaned.pop(0)
    return cleaned


def detect(audio_path: str, duration: float, timeout: int = 240,
           beats: list[float] | None = None) -> list[dict]:
    """Lance le modèle sur `audio_path` en sous-processus et renvoie les
    segments d'accords `[{'time','end','chord'}]` dans le vocabulaire
    ChordSplit. Lève une exception (à charge de l'appelant de retomber
    sur le décodage par gabarits) en cas d'échec ou de sortie vide.

    `beats` : temps (secondes) du morceau (cf. chord_detector.detect_beats).
    Si fourni, les transitions d'accord du décodage HMM sont calées sur
    ces temps (supprime le retard « le HMM attend d'avoir assez
    d'évidence » sur de la vraie musique).

    timeout borné à 240 s (< le --timeout 600 de gunicorn/Cloud Run, qui
    doit aussi absorber chroma + detect_meter + detect_beats en amont)
    pour laisser le repli par gabarits + la structure + la réponse tenir
    dans le budget requête même sur un morceau long où le modèle traîne."""
    lab_path = audio_path + '.largevocab.lab'
    beats_path = None
    if beats:
        fd, beats_path = tempfile.mkstemp(suffix='.beats.json', dir=os.path.dirname(audio_path))
        with os.fdopen(fd, 'w') as f:
            json.dump([float(t) for t in beats], f)
    # Le sous-processus doit voir le VRAI numba (llvmlite JIT), pas le stub
    # `/app/numba` du projet : librosa >= 0.10 s'appuie sur des noyaux
    # numba (@guvectorize/@stencil) dans tout le chemin CQT, que le stub
    # casse. On retire donc PYTHONPATH (qui met /app — donc le stub — en
    # tête de sys.path ; chord_recognition.py n'a besoin que de son propre
    # dossier, fourni par cwd) et NUMBA_DISABLE_JIT. Le process principal
    # (gunicorn/madmom) garde stub + NUMBA_DISABLE_JIT, inchangé.
    env = {k: v for k, v in os.environ.items()
           if k not in ('PYTHONPATH', 'NUMBA_DISABLE_JIT')}
    cmd = [sys.executable, 'chord_recognition.py', audio_path, lab_path]
    if beats_path:
        cmd += ['submission', beats_path]
    try:
        proc = subprocess.run(
            cmd, cwd=MODEL_DIR, env=env,
            capture_output=True, text=True, timeout=timeout,
        )
        if proc.returncode != 0:
            raise RuntimeError(
                f'chord_recognition.py a échoué (code {proc.returncode}) : '
                f'{proc.stderr[-500:]}'
            )
        if not os.path.exists(lab_path):
            raise RuntimeError('aucun fichier .lab produit')
        return _parse_lab(lab_path, duration)
    finally:
        for p in (lab_path, beats_path):
            if p:
                try:
                    os.unlink(p)
                except OSError:
                    pass
