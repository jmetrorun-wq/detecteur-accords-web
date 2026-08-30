# Code vendoré — ISMIR 2019 Large-Vocabulary Chord Recognition

Source : https://github.com/music-x-lab/ISMIR2019-Large-Vocabulary-Chord-Recognition
(Music X Lab, NYU Shanghai). Licence **MIT** (cf. `LICENSE`).

Copié tel quel puis exécuté en sous-processus par `../largevocab_chords.py`
(`chord_recognition.py <audio> <out.lab>`, `cwd` = ce dossier). Les poids
pré-entraînés sont inclus : `cache_data/joint_chord_net_ismir_naive_v1.0_reweight(0.0,10.0)_s{0..4}.best.sdict`
(ensemble de 5, ~27 Mo).

## Modifications appliquées (compat 2026)

Le code date de 2019 (torch ≥ 1.4, numpy 1.x, librosa 0.7). Patchs minimaux
pour tourner sous l'environnement cible (Python 3.12, numpy ≥ 2, torch ≥ 2.6,
librosa ≥ 0.10) :

| Fichier | Changement |
|---|---|
| `extractors/xhmm_ismir.py` | `np.int` → `int` (retiré de numpy 1.24). `np.int8` conservé. |
| `extractors/cqt.py` | `librosa.core.hybrid_cqt` → `librosa.hybrid_cqt` ; `tuning=None` → `tuning=0.0` (sinon `hybrid_cqt` appelle `estimate_tuning`→`piptrack`, chemin cassé par le stub numba ; `0.0` = A440 supposé, correct en pratique). |
| `mir/nn/train.py` | `torch.load(..., weights_only=False)` (torch ≥ 2.6 met `True` par défaut ; les `.sdict` contiennent l'état de l'optimiseur). |

### numba : le vrai, pas le stub

`librosa.hybrid_cqt` (utilisé par `CQTV2`) s'appuie sur des noyaux numba
(`@guvectorize`/`@stencil`) dans tout le chemin CQT. Le projet ChordSplit
a un stub `numba/` local (chargé via `PYTHONPATH=/app`) + `NUMBA_DISABLE_JIT=1`
pour empêcher madmom/librosa du process principal de tirer le vrai numba
(historiquement des timeouts de build LLVM). Ce stub casse les noyaux CQT.

`../largevocab_chords.py` lance donc `chord_recognition.py` **sans**
`PYTHONPATH` ni `NUMBA_DISABLE_JIT` dans l'environnement du sous-processus,
pour qu'il prenne le vrai `numba`/`llvmlite` (installés par le Dockerfile,
roues manylinux — aucun build LLVM). Le process principal est inchangé.

Exclus de la copie : `data/complex_chord_structure.xlsx` (doc), `.git`.
Non utilisés à l'inférence mais conservés : `datasets.py`, `storage_creation.py`,
`chordnet_ismir_naive_eval.py`, `results*.py`, `test_for_all.py` (chemin
d'entraînement/évaluation ; ne pas s'attendre à ce qu'ils tournent tels quels).
