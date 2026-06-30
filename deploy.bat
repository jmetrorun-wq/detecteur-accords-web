@echo off
REM Déploiement vers le serveur Linux 10.10.1.127
REM Prérequis : SSH configuré + Python + pip sur le serveur

SET SERVER=10.10.1.127
SET USER=casud
SET REMOTE_DIR=/opt/chordweb

echo ============================================
echo   Déploiement vers %USER%@%SERVER%
echo ============================================

REM Copie des fichiers (sauf venv et __pycache__)
scp -r app.py requirements.txt run.sh templates static %USER%@%SERVER%:%REMOTE_DIR%/

REM Installation des dépendances sur le serveur
ssh %USER%@%SERVER% "cd %REMOTE_DIR% && pip install -r requirements.txt --quiet"

REM (Re)démarrage du service
ssh %USER%@%SERVER% "pkill -f 'python.*app.py' || true; cd %REMOTE_DIR% && nohup python app.py > /tmp/chordweb.log 2>&1 &"

echo.
echo Déployé ! Accès : http://%SERVER%:5001
pause
