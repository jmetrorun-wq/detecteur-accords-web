@echo off
REM Démarre le serveur Flask + ouvre le navigateur
echo Démarrage du Détecteur d'Accords Web...
cd /d "%~dp0"
start "" http://localhost:5001
python app.py
pause
