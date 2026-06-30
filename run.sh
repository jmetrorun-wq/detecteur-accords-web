#!/bin/bash
# Démarrage du serveur Flask en production (port 5001)
cd "$(dirname "$0")"
exec python app.py
