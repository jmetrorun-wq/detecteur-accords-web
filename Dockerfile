FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential gcc g++ ffmpeg libsndfile1 curl ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

COPY . .

RUN pip install --no-cache-dir -r requirements.txt

# Séparation de pistes (demucs) : uniquement installé ici (Cloud Run),
# jamais dans requirements.txt (Render, 512 Mo — torch seul coûte déjà
# ~150 Mo rien qu'à l'import, cf. stem_separator.py). Roue CPU explicite
# pour éviter de télécharger les variantes CUDA (inutiles ici, beaucoup
# plus lourdes).
#
# Piège découvert en testant : NE PAS downgrader numpy<2 pour torch (une
# tentation vu que torch 2.2.2 l'exige) — madmom (déjà installé juste
# au-dessus, cf. son commit pinné) utilise `np.long`, réintroduit
# uniquement à partir de numpy 2.0 avec une autre signification ; sous
# numpy 1.26 ça casse toute la détection d'accords avec `module 'numpy'
# has no attribute 'long'`. À la place : torch/torchaudio récents (pas
# 2.2.2) qui supportent numpy>=2, + `torchcodec` (nouveau backend
# d'encodage audio de torchaudio, requis depuis torchaudio ~2.4 sinon
# demucs échoue à l'écriture des fichiers séparés avec
# `ModuleNotFoundError: No module named 'torchcodec'`).
RUN pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir torchcodec --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir demucs

# Pré-télécharge les poids du modèle htdemucs (~80 Mo) pendant le build,
# pour ne pas payer ce téléchargement au premier vrai cold start.
RUN python -c "from demucs.pretrained import get_model; get_model('htdemucs')"

# Détection d'accords à grand vocabulaire (modèle ISMIR 2019 vendoré dans
# chordnet_ismir/, cf. largevocab_chords.py). Gardé par
# ENABLE_LARGEVOCAB_CHORDS, jamais dans requirements.txt/Render (torch).
# Poids inclus dans le repo (chordnet_ismir/cache_data/*.sdict, ~27 Mo),
# rien à pré-télécharger. Deps manquantes (torch déjà installé ci-dessus) :
#  - pretty_midi + h5py : importées par le mini-framework `mir` du modèle
#  - pydub : importée par son data_file.py
#  - numba + llvmlite : le sous-processus chord_recognition.py utilise
#    librosa.hybrid_cqt, qui s'appuie sur des noyaux numba (@guvectorize/
#    @stencil) que le stub `/app/numba` du projet casse. largevocab_chords.py
#    lance ce sous-processus SANS PYTHONPATH ni NUMBA_DISABLE_JIT pour qu'il
#    prenne le vrai numba installé ici (roues manylinux, pas de build LLVM).
#    Le process principal (madmom) garde le stub, il ne voit jamais celui-ci.
RUN pip install --no-cache-dir pretty_midi h5py pydub numba llvmlite

RUN curl -sL -o bgutil-pot \
    https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs/releases/download/v0.8.1/bgutil-pot-linux-x86_64 \
    && chmod +x bgutil-pot

ENV NUMBA_DISABLE_JIT=1
ENV PYTHONPATH=/app

EXPOSE 8080

# --timeout 600 (aligné sur le --timeout=600 de Cloud Run) : l'analyse
# synchrone /api/analyze peut cumuler, sur un morceau long, chroma +
# detect_meter + detect_beats (madmom, ~1 min) + l'ensemble de 5 modèles
# d'accords ISMIR sur CPU (~1-2 min). Le sous-processus modèle a son
# propre timeout (240 s) avec repli sur les gabarits.
CMD ["bash", "-c", "./bgutil-pot server --host 127.0.0.1 --port 4416 & exec gunicorn app:app --bind 0.0.0.0:${PORT:-8080} --workers 1 --timeout 600"]
