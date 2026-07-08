"""Séparation de pistes (voix/batterie/basse/autre) via demucs.

N'existe et n'est utile que sur le déploiement Cloud Run (garde
`ENABLE_STEM_SEPARATION`, cf. app.py) : torch/torchaudio/demucs (~2-3 Go de
RAM au traitement, cf. Dockerfile) sont beaucoup trop lourds pour le
budget Render (512 Mo), au point où même leur simple *import* (~150 Mo
pour torch seul) serait déjà problématique — donc ce module n'importe
jamais torch/demucs au niveau module, seulement à l'intérieur de
`_run_demucs`, et le traitement tourne dans un sous-processus séparé
(`python -m demucs`) pour que cette RAM soit entièrement libérée dès la
fin du job plutôt que de rester attachée au worker gunicorn.
"""
import os
import re
import shutil
import subprocess
import sys
import threading
import uuid
from typing import Callable, Optional

STEMS = ('vocals', 'drums', 'bass', 'other')

_PROGRESS_RE = re.compile(r'(\d+)%\|')

_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()
_running = threading.Lock()  # un seul job de séparation à la fois (budget RAM)


def start_job(filepath: str, output_dir: str) -> str:
    """Démarre la séparation de `filepath` en tâche de fond, retourne un
    job_id. Lève RuntimeError si un job tourne déjà (verrou non bloquant
    — deux séparations en parallèle dépasseraient la RAM disponible)."""
    if not _running.acquire(blocking=False):
        raise RuntimeError(
            'Une séparation est déjà en cours, réessaie dans quelques instants.'
        )

    job_id = uuid.uuid4().hex
    with _jobs_lock:
        _jobs[job_id] = {'status': 'running', 'progress': 0, 'error': None}

    def run() -> None:
        try:
            _run_demucs(filepath, output_dir, job_id,
                        on_progress=lambda p: _set_progress(job_id, p))
            with _jobs_lock:
                _jobs[job_id]['status'] = 'done'
                _jobs[job_id]['progress'] = 100
        except Exception as exc:
            with _jobs_lock:
                _jobs[job_id]['status'] = 'error'
                _jobs[job_id]['error'] = str(exc)
        finally:
            _running.release()

    threading.Thread(target=run, daemon=True).start()
    return job_id


def get_status(job_id: str) -> Optional[dict]:
    with _jobs_lock:
        job = _jobs.get(job_id)
        return dict(job) if job else None


def _set_progress(job_id: str, progress: int) -> None:
    with _jobs_lock:
        if job_id in _jobs:
            _jobs[job_id]['progress'] = progress


def _read_progress(stream, on_progress: Callable[[int], None]) -> None:
    """demucs affiche sa progression via tqdm, qui écrit des mises à jour
    séparées par '\\r' (pas '\\n') tant que la barre n'est pas terminée —
    on ne peut donc pas se contenter d'itérer ligne par ligne sur le flux
    (on ne recevrait tout que d'un coup, en fin de traitement). On lit à
    la place par petits blocs et on découpe manuellement sur \\r et \\n."""
    buf = ''
    while True:
        chunk = stream.read(256)
        if not chunk:
            break
        buf += chunk
        while True:
            idx_r = buf.find('\r')
            idx_n = buf.find('\n')
            candidates = [i for i in (idx_r, idx_n) if i != -1]
            if not candidates:
                break
            idx = min(candidates)
            segment, buf = buf[:idx], buf[idx + 1:]
            m = _PROGRESS_RE.search(segment)
            if m:
                on_progress(min(99, int(m.group(1))))
    m = _PROGRESS_RE.search(buf)
    if m:
        on_progress(min(99, int(m.group(1))))


def _run_demucs(
    filepath: str,
    output_dir: str,
    job_id: str,
    on_progress: Callable[[int], None],
) -> dict[str, str]:
    """Lance `python -m demucs` (modèle htdemucs, 4 pistes) en
    sous-processus, suit sa progression, puis déplace les pistes
    résultantes en fichiers plats `sep_<job_id>_<stem>.wav` dans
    `output_dir` (pour que le nettoyage automatique existant, qui ne
    liste que des fichiers à plat, les prenne en charge sans
    modification). Retourne {stem: filename}."""
    track_name = os.path.splitext(os.path.basename(filepath))[0]
    demucs_out = os.path.join(output_dir, f'_demucs_{job_id}')

    proc = subprocess.Popen(
        [sys.executable, '-m', 'demucs', '-n', 'htdemucs', '-o', demucs_out, filepath],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    assert proc.stdout is not None
    _read_progress(proc.stdout, on_progress)
    returncode = proc.wait()
    if returncode != 0:
        raise RuntimeError(f'demucs a échoué (code {returncode}).')

    # Converties en mp3 (pas servies telles quelles en wav) : un wav stéréo
    # 44.1kHz d'un morceau de quelques minutes pèse ~50-90 Mo, au-delà de
    # la limite de réponse HTTP de Cloud Run (32 Mio) — une requête de
    # téléchargement sans Range (ou le premier chargement d'un lecteur
    # <audio>) échouait en 500. Le mp3 (~5-10 Mo pour un morceau entier)
    # reste confortablement sous cette limite même sans Range.
    src_dir = os.path.join(demucs_out, 'htdemucs', track_name)
    stems: dict[str, str] = {}
    for stem in STEMS:
        src = os.path.join(src_dir, f'{stem}.wav')
        dst_name = f'sep_{job_id}_{stem}.mp3'
        dst = os.path.join(output_dir, dst_name)
        result = subprocess.run(
            ['ffmpeg', '-y', '-i', src, '-codec:a', 'libmp3lame', '-b:a', '192k', dst],
            capture_output=True, timeout=120,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f'Conversion mp3 échouée pour {stem} : '
                f'{result.stderr.decode(errors="replace")[-300:]}'
            )
        stems[stem] = dst_name

    shutil.rmtree(demucs_out, ignore_errors=True)
    return stems
