"""Historique persistant des morceaux déjà analysés, sur Google Cloud
Storage (même pattern que KaraTune/history_cache.py).

Le disque local du conteneur Cloud Run est éphémère (perdu au
redémarrage/redéploiement, et de toute façon purgé après 1h par
_cleanup_old_files dans app.py) — inutilisable comme historique réel.
Ce module garde le fichier audio + le résultat d'analyse complet
(chords/structure/bar_times/...) pour pouvoir rejouer une analyse déjà
faite sans jamais relancer detect_chords().

Toute défaillance ici (bucket inaccessible, permissions manquantes,
réseau...) est avalée et journalisée plutôt que de faire planter
l'analyse ou l'upload — cet historique est un gain de confort, pas une
dépendance dure de l'app.
"""
import json
import logging
import os
import threading
import time
from typing import Optional

from google.cloud import storage

logger = logging.getLogger(__name__)

BUCKET_NAME = os.environ.get('HISTORY_BUCKET', 'chordsplit-history-451325228498')
INDEX_BLOB = 'history.json'

_client: Optional[storage.Client] = None
_client_lock = threading.Lock()
_index_lock = threading.Lock()


def _client_singleton() -> storage.Client:
    global _client
    if _client is None:
        with _client_lock:
            if _client is None:
                _client = storage.Client()
    return _client


def _bucket():
    return _client_singleton().bucket(BUCKET_NAME)


def _prefix(history_id: str) -> str:
    return f'analyses/{history_id}/'


def _load_index() -> list[dict]:
    blob = _bucket().blob(INDEX_BLOB)
    if not blob.exists():
        return []
    return json.loads(blob.download_as_text())


def _save_index(entries: list[dict]) -> None:
    _bucket().blob(INDEX_BLOB).upload_from_string(
        json.dumps(entries), content_type='application/json')


def save_entry(history_id: str, filepath: str, ext: str, result: dict) -> None:
    """Envoie le fichier audio + le résultat d'analyse complet vers le
    bucket, et ajoute une entrée en tête d'historique. Appelé juste
    après qu'une analyse a réussi (cf. analyze_jobs.py) ; n'importe
    quel échec est journalisé mais ne remonte jamais à l'appelant."""
    try:
        bucket = _bucket()
        prefix = _prefix(history_id)
        bucket.blob(prefix + 'audio' + ext).upload_from_filename(filepath)
        bucket.blob(prefix + 'result.json').upload_from_string(
            json.dumps(result), content_type='application/json')
        with _index_lock:
            entries = [e for e in _load_index() if e['id'] != history_id]
            entries.insert(0, {
                'id':         history_id,
                'title':      result.get('title') or '',
                'key_fr':     result.get('key_fr'),
                'tempo':      result.get('tempo'),
                'duration':   result.get('duration'),
                'ext':        ext,
                'created_at': time.time(),
            })
            _save_index(entries)
    except Exception:
        logger.exception("Mise en historique échouée pour %s (non bloquant)", history_id)


def list_entries() -> list[dict]:
    try:
        return _load_index()
    except Exception:
        logger.exception("Lecture de l'historique échouée")
        return []


def load_result(history_id: str) -> Optional[dict]:
    try:
        blob = _bucket().blob(_prefix(history_id) + 'result.json')
        if not blob.exists():
            return None
        return json.loads(blob.download_as_text())
    except Exception:
        logger.exception("Chargement du résultat échoué pour %s", history_id)
        return None


def download_audio(history_id: str, ext: str, dest_path: str) -> bool:
    """Télécharge l'audio en cache vers `dest_path` (un chemin dans
    UPLOAD_DIR, pour être servi ensuite par la route /api/audio
    existante — support Range/iOS déjà géré là-bas)."""
    try:
        blob = _bucket().blob(_prefix(history_id) + 'audio' + ext)
        if not blob.exists():
            return False
        blob.download_to_filename(dest_path)
        return True
    except Exception:
        logger.exception("Téléchargement audio échoué pour %s", history_id)
        return False


def delete_entry(history_id: str) -> None:
    try:
        for b in _bucket().list_blobs(prefix=_prefix(history_id)):
            b.delete()
        with _index_lock:
            entries = [e for e in _load_index() if e['id'] != history_id]
            _save_index(entries)
    except Exception:
        logger.exception("Suppression échouée pour %s", history_id)
        raise
