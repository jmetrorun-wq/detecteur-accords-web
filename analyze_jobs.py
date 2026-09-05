"""Job en tâche de fond pour /api/analyze : la détection d'accords peut
prendre plusieurs minutes (ensemble ISMIR + madmom sur CPU) — même pattern
que stem_separator.py pour la séparation de pistes (thread de fond + suivi
par polling), en plus léger : pas besoin d'isoler un sous-processus ici,
chord_detector est déjà importé au niveau module par app.py de toute façon.

Réutilise les callbacks de progression (5/10/45/50/55/95/100 %) déjà
présents dans chord_detector.detect_chords, jusqu'ici sans effet visible
côté client (l'ancien /api/analyze était un aller-retour HTTP unique,
bloquant jusqu'à la fin de l'analyse).
"""
import os
import threading
import uuid
from typing import Optional

import history_store
from chord_detector import chord_color, chord_type_name, detect_chords, detect_structure

_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()
_running = threading.Lock()  # une seule analyse à la fois (budget CPU/RAM partagé)


def _set_progress(job_id: str, pct: int) -> None:
    with _jobs_lock:
        if job_id in _jobs:
            _jobs[job_id]['progress'] = pct


def _build_payload(filepath: str, file_id: str, extra: Optional[dict], job_id: str) -> dict:
    """Reprend exactement la forme de réponse de l'ancien
    `app.py::_analyze_and_respond` (compat frontend inchangée)."""
    def cb(pct: int) -> None:
        _set_progress(job_id, pct)

    chords, duration, key_en, key_fr, tempo, beats_per_bar, bar_times = detect_chords(
        filepath, progress_callback=cb,
    )

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
    return payload


def start_job(filepath: str, file_id: str, extra: Optional[dict] = None) -> str:
    """Démarre l'analyse de `filepath` en tâche de fond, retourne un job_id.
    Lève RuntimeError si une analyse tourne déjà (un seul job à la fois,
    même principe que stem_separator.start_job : le pipeline d'accords
    (madmom + ensemble ISMIR) est CPU/RAM-intensif sur une seule instance
    Cloud Run — à revoir si le backend passe un jour à plusieurs instances)."""
    if not _running.acquire(blocking=False):
        raise RuntimeError('Une analyse est déjà en cours, réessaie dans quelques instants.')

    job_id = uuid.uuid4().hex
    with _jobs_lock:
        _jobs[job_id] = {'status': 'running', 'progress': 0, 'error': None, 'result': None}

    def run() -> None:
        try:
            payload = _build_payload(filepath, file_id, extra, job_id)
            # Ne met pas en historique la ré-analyse d'une piste séparée
            # (sep_*.mp3, dérivée d'une analyse déjà en historique) —
            # seul le fichier réellement importé par l'utilisateur compte.
            if not file_id.startswith('sep_'):
                history_store.save_entry(
                    uuid.uuid4().hex, filepath, os.path.splitext(file_id)[1], payload,
                )
            with _jobs_lock:
                _jobs[job_id]['status'] = 'done'
                _jobs[job_id]['progress'] = 100
                _jobs[job_id]['result'] = payload
        except Exception as exc:
            with _jobs_lock:
                _jobs[job_id]['status'] = 'error'
                _jobs[job_id]['error'] = f"Erreur d'analyse : {exc}"
        finally:
            _running.release()

    threading.Thread(target=run, daemon=True).start()
    return job_id


def get_status(job_id: str) -> Optional[dict]:
    with _jobs_lock:
        job = _jobs.get(job_id)
        return dict(job) if job else None
