"""Recherche et téléchargement d'audio depuis Dailymotion.

Alternative à YouTube (cf. app.py::analyze_youtube, abandonné côté
utilisateur le 2026-07-06 : blocage anti-bot systématique et permanent
par IP sur les téléchargements serveur, confirmé sur Render ET Cloud
Run). Même constat que sur KaraTune (projet séparé, même infra,
dailymotion_source.py) : aucun blocage anti-bot systématique par IP
constaté sur Dailymotion, seulement des échecs ponctuels/intermittents
sur le flux HLS (HTTP 403), absorbés par une simple relance.

API de recherche publique (https://api.dailymotion.com/videos), pas de
clé requise.
"""
import time

import requests
import yt_dlp
from yt_dlp.networking.impersonate import ImpersonateTarget

SEARCH_URL = 'https://api.dailymotion.com/videos'

_DOWNLOAD_ATTEMPTS = 3
_RETRY_DELAY_S = 3


def search(query: str, limit: int = 15) -> list[dict]:
    """Retourne une liste vide en cas d'erreur réseau plutôt que de
    faire planter la requête (cf. même choix sur KaraTune)."""
    try:
        resp = requests.get(
            SEARCH_URL,
            params={
                'search': query,
                'fields': 'id,title,duration,thumbnail_url,owner.screenname',
                'limit': limit,
            },
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
    except (requests.RequestException, ValueError):
        return []

    return [
        {
            'id':        item['id'],
            'title':     item['title'],
            'duration':  item.get('duration'),
            'thumbnail': item.get('thumbnail_url'),
            'channel':   item.get('owner.screenname'),
        }
        for item in data.get('list', [])
    ]


def download_audio(video_id: str, output_path_noext: str) -> str:
    """Télécharge l'audio de la vidéo Dailymotion `video_id` en mp3 vers
    `output_path_noext + '.mp3'`, retourne ce chemin. Dailymotion renvoie
    parfois une 403 intermittente sur son flux HLS (constaté sur
    KaraTune : même vidéo, échoue puis repasse quelques minutes après) —
    pas un blocage systématique par vidéo comme YouTube, une relance
    suffit à absorber ça.

    `impersonate` (curl_cffi, cf. requirements.txt) est indispensable :
    sans lui, la récupération du m3u8 échoue systématiquement en HTTP 403
    (testé en local, pas seulement sur Cloud Run — contrairement à ce que
    l'expérience KaraTune laissait supposer, la protection semble s'être
    généralisée depuis).

    mp3 (pas wav) : un wav brut de plusieurs minutes dépasse la limite de
    réponse HTTP de Cloud Run (~32 Mio, cf. /api/audio) — provoque des
    500 intermittents (« Response size was too large ») qui cassent la
    lecture côté navigateur, constaté en prod sur un premier essai réel."""
    ydl_opts = {
        'format': 'best',
        'outtmpl': output_path_noext + '.%(ext)s',
        'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '192'}],
        'noplaylist': True,
        'quiet': True,
        'no_warnings': True,
        'impersonate': ImpersonateTarget.from_str('chrome'),
    }
    last_error: Exception = RuntimeError('inconnue')
    for attempt in range(1, _DOWNLOAD_ATTEMPTS + 1):
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([f'https://www.dailymotion.com/video/{video_id}'])
            return output_path_noext + '.mp3'
        except Exception as exc:
            last_error = exc
            if attempt < _DOWNLOAD_ATTEMPTS:
                time.sleep(_RETRY_DELAY_S)

    raise RuntimeError(f'Téléchargement échoué après {_DOWNLOAD_ATTEMPTS} tentatives : {last_error}')
