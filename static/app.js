'use strict';

// ── État global ────────────────────────────────────────────────────
const state = {
  chords:    [],       // [{time, end, chord, color, type}, ...]
  structure: [],       // [{label, start, end}, ...]
  title:     '',
  duration:  0,
  keyFr:     '',
  tempo:     0,
  fileId:    null,
  transpose: 0,
  activeIdx: -1,       // index de l'accord en cours (segment précis)
  beatCells: [],      // [{start, end, chord, color, showName, barStart}, ...] une par temps
  activeCellIdx: -1,
  instrument: 'piano', // 'piano' | 'guitar' — vue affichée (sélecteur + swipe)
};

// ── DOM ────────────────────────────────────────────────────────────
const screens = {
  upload:   document.getElementById('screen-upload'),
  record:   document.getElementById('screen-record'),
  loading:  document.getElementById('screen-loading'),
  results:  document.getElementById('screen-results'),
  history:  document.getElementById('screen-history'),
  tuner:    document.getElementById('screen-tuner'),
  metronome: document.getElementById('screen-metronome'),
};
const btnHistory      = document.getElementById('btn-history');
const btnHistoryBack  = document.getElementById('btn-history-back');
const btnTuner        = document.getElementById('btn-tuner');
const btnTunerBack    = document.getElementById('btn-tuner-back');
const tunerNote       = document.getElementById('tuner-note');
const tunerDetail     = document.getElementById('tuner-detail');
const tunerNeedle     = document.getElementById('tuner-needle');
const tunerStatus     = document.getElementById('tuner-status');
const tunerError      = document.getElementById('tuner-error');
const historyListEl   = document.getElementById('history-list');
const historyEmptyEl  = document.getElementById('history-empty');
const fileInput       = document.getElementById('file-input');
const dailymotionForm    = document.getElementById('dailymotion-form');
const dailymotionQuery   = document.getElementById('dailymotion-query');
const dailymotionResults = document.getElementById('dailymotion-results');
const loadingFilename = document.getElementById('loading-filename');
const loadingSub          = document.getElementById('loading-sub');
const loadingProgressFill = document.getElementById('loading-progress-fill');
const loadingProgressLabel = document.getElementById('loading-progress-label');
const btnRecord       = document.getElementById('btn-record');
const btnRecordStop   = document.getElementById('btn-record-stop');
const btnRecordCancel = document.getElementById('btn-record-cancel');
const recordTimerEl   = document.getElementById('record-timer');
const infoKey         = document.getElementById('info-key');
const infoTempo       = document.getElementById('info-tempo');
const currentChord    = document.getElementById('current-chord');
const currentType     = document.getElementById('current-type');
const pianoCanvas     = document.getElementById('piano-canvas');
const pianoWrap       = document.querySelector('.piano-wrap');
const guitarWrap      = document.getElementById('guitar-wrap');
const guitarSvg       = document.getElementById('guitar-svg');
const guitarLabel     = document.getElementById('guitar-label');
const instrumentPanes = document.getElementById('instrument-panes');
const tabPiano        = document.getElementById('tab-piano');
const tabGuitar       = document.getElementById('tab-guitar');
const btnPlay         = document.getElementById('btn-play');
const seekBar         = document.getElementById('seek-bar');
const timeCurrent     = document.getElementById('time-current');
const timeTotal       = document.getElementById('time-total');
const chordListEl     = document.getElementById('chord-list');
const btnBack         = document.getElementById('btn-back');
const btnTrDown       = document.getElementById('btn-tr-down');
const btnTrUp         = document.getElementById('btn-tr-up');
const trLabel         = document.getElementById('tr-label');
const btnExportPdf    = document.getElementById('btn-export-pdf');
const audioEl         = document.getElementById('audio-player');
const btnSeparate       = document.getElementById('btn-separate');
const separatePanel     = document.getElementById('separate-panel');
const separateProgWrap  = document.getElementById('separate-progress-wrap');
const separateProgFill  = document.getElementById('separate-progress-fill');
const separateProgLabel = document.getElementById('separate-progress-label');
const separateErrorEl   = document.getElementById('separate-error');
const separateStemsEl   = document.getElementById('separate-stems');
const btnReanalyzeOther = document.getElementById('btn-reanalyze-other');
const btnMetronome    = document.getElementById('btn-metronome');
const metronomePanel  = document.getElementById('metronome-panel');
const metroPlay       = document.getElementById('metro-play');
const metroBpm        = document.getElementById('metro-bpm');
const metroTempoVal    = document.getElementById('metro-tempo-val');
const metroTempoDown   = document.getElementById('metro-tempo-down');
const metroTempoUp     = document.getElementById('metro-tempo-up');
const metroDots       = document.getElementById('metro-dots');
const btnMetronomeHome = document.getElementById('btn-metronome-home');
const btnMetronomeBack = document.getElementById('btn-metronome-back');
const hmPlay          = document.getElementById('hm-play');
const hmBpm           = document.getElementById('hm-bpm');
const hmTempoVal      = document.getElementById('hm-tempo-val');
const hmTempoDown     = document.getElementById('hm-tempo-down');
const hmTempoUp       = document.getElementById('hm-tempo-up');
const hmDots          = document.getElementById('hm-dots');

// ── Utilitaires ────────────────────────────────────────────────────
function showScreen(name) {
  for (const [k, el] of Object.entries(screens)) {
    el.classList.toggle('active', k === name);
  }
}

function fmtTime(s) {
  const sec = Math.floor(s);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

// Anticipation d'affichage pendant la lecture : audio.currentTime est
// systématiquement en retard sur la sortie audio réelle (buffer de sortie,
// surtout sur iOS Safari) — un décalage à peu près constant qui touche
// aussi bien le gros accord que la barre de mesures. On regarde donc
// SYNC_LEAD_S en avant lors du rafraîchissement à chaque frame. À ajuster
// si les accords passent en avance (baisser) ou toujours en retard (monter).
const SYNC_LEAD_S = 0.25;

// ── Transposition JS (identique à chord_detector.py) ──────────────
const NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

function transposeChord(chord, semitones) {
  if (!chord || chord === 'N' || semitones === 0) return chord;
  for (let i = 0; i < NOTES.length; i++) {
    const note = NOTES[i];
    if (!chord.startsWith(note)) continue;
    const rest = chord.slice(note.length);
    if (rest.length > 0 && rest[0] === '#' && note.length === 1) continue;
    const newRoot = NOTES[(i + semitones + 12) % 12];
    return newRoot + rest;
  }
  return chord;
}

function transposeKey(keyFr, semitones) {
  if (semitones === 0) return keyFr;
  // Simple décalage sur le suffixe « majeur »/« mineur »
  const parts = keyFr.split(' ');
  if (parts.length < 2) return keyFr;
  const mode = parts.slice(1).join(' ');
  // cherche la note française dans NOTES
  const noteMap = {
    'Do':'C','Ré':'D','Mi':'E','Fa':'F','Sol':'G','La':'A','Si':'B',
    'Ré♭':'C#','Mi♭':'D#','Fa♯':'F#','La♭':'G#','Si♭':'A#',
  };
  const invMap = Object.fromEntries(Object.entries(noteMap).map(([fr,en]) => [en, fr]));
  const nc = noteMap[parts[0]];
  if (!nc) return keyFr;
  const idx = NOTES.indexOf(nc);
  const newNote = NOTES[(idx + semitones + 12) % 12];
  const newFr = invMap[newNote] ?? newNote;
  return `${newFr} ${mode}`;
}

// ── Upload & analyse ───────────────────────────────────────────────
fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;
  loadingFilename.textContent = file.name;
  showScreen('loading');
  uploadAndAnalyze(file);
});

// L'analyse (chroma + détection de mesures/temps + ensemble d'accords à
// grand vocabulaire) prend de 1 à 4 minutes — /api/analyze démarre donc
// un job en tâche de fond et renvoie {job_id}, suivi par polling sur
// /api/analyze/status/<job_id> (même pattern que la séparation de
// pistes). Étapes/pourcentages calés sur les callbacks de progression de
// chord_detector.detect_chords (5/10/45/50/55/95/100 %).
const ANALYZE_POLL_MS = 1200;
const ANALYZE_PHASES = [
  { max: 10, label: 'Préparation du fichier…' },
  { max: 45, label: 'Détection du tempo et des mesures…' },
  { max: 55, label: 'Analyse de la tonalité…' },
  { max: 95, label: 'Reconnaissance des accords (vocabulaire enrichi)…' },
  { max: 100, label: 'Finalisation…' },
];

function analyzePhaseLabel(pct) {
  const phase = ANALYZE_PHASES.find(p => pct <= p.max);
  return (phase || ANALYZE_PHASES[ANALYZE_PHASES.length - 1]).label;
}

function setAnalyzeProgress(pct) {
  const clamped = Math.max(0, Math.min(100, pct));
  loadingProgressFill.style.width = `${clamped}%`;
  loadingProgressLabel.textContent = `${clamped} %`;
  loadingSub.textContent = analyzePhaseLabel(clamped);
}

function pollAnalyzeJob(jobId) {
  return new Promise((resolve, reject) => {
    const tick = async () => {
      let res, data;
      try {
        res = await fetch(`/api/analyze/status/${jobId}`);
        data = await res.json();
      } catch {
        reject(new Error('Connexion perdue pendant l’analyse.'));
        return;
      }
      if (!res.ok) {
        reject(new Error(data.error ?? `Erreur ${res.status}`));
        return;
      }
      setAnalyzeProgress(data.progress ?? 0);
      if (data.status === 'done') {
        resolve(data);
      } else if (data.status === 'error') {
        reject(new Error(data.error ?? 'Analyse échouée.'));
      } else {
        setTimeout(tick, ANALYZE_POLL_MS);
      }
    };
    tick();
  });
}

// Pont natif : dans l'app mobile (Expo, coquille react-native-webview,
// cf. mobile/App.js), l'enregistrement micro est capturé et uploadé
// nativement (expo-audio, meilleure qualité qu'un MediaRecorder web, et
// valeur native attendue pour la revue App Store) — mais l'affichage du
// résultat reste entièrement celui du web. Le natif appelle juste ceci
// avec le job_id renvoyé par /api/analyze pour réutiliser tel quel le
// suivi de progression et l'affichage des résultats déjà en place.
window.chordSplitNative = {
  showAnalyzeJob(jobId) {
    loadingFilename.textContent = 'Enregistrement micro';
    showScreen('loading');
    setAnalyzeProgress(0);
    pollAnalyzeJob(jobId).then(applyResults).catch((err) => {
      alert(`Erreur : ${err.message}`);
      showScreen('upload');
    });
  },
};

async function performAnalyze(fetchPromise) {
  setAnalyzeProgress(0);
  try {
    const res = await fetchPromise;
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        throw new Error(`Le serveur est temporairement indisponible (${res.status}).\nVeuillez réessayer dans quelques instants.`);
      }
      const clean = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                        .replace(/<[^>]+>/g, '')
                        .replace(/\s+/g, ' ')
                        .trim()
                        .slice(0, 200);
      throw new Error(`Erreur serveur (${res.status}) :\n${clean}`);
    }
    if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`);
    if (!data.job_id) throw new Error('Réponse inattendue du serveur.');
    const result = await pollAnalyzeJob(data.job_id);
    applyResults(result);
  } catch (err) {
    alert(`Erreur : ${err.message}`);
    showScreen('upload');
  }
}

function uploadAndAnalyze(file) {
  const fd = new FormData();
  fd.append('audio', file);
  return performAnalyze(fetch('/api/analyze', { method: 'POST', body: fd }));
}

// ── Recherche Dailymotion (remplace le lien YouTube, abandonné :
// blocage anti-bot systématique par IP côté serveur, jamais rencontré
// sur Dailymotion — cf. dailymotion_source.py) ─────────────────────
dailymotionForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = dailymotionQuery.value.trim();
  if (!query) return;

  dailymotionResults.classList.remove('hidden');
  dailymotionResults.innerHTML = '<p class="dm-empty">Recherche…</p>';
  let results = [];
  try {
    const res = await fetch(`/api/dailymotion/search?q=${encodeURIComponent(query)}`);
    results = await res.json();
  } catch {
    results = [];
  }

  dailymotionResults.innerHTML = '';
  if (!results.length) {
    dailymotionResults.innerHTML = '<p class="dm-empty">Aucun résultat.</p>';
    return;
  }
  for (const item of results) {
    const row = document.createElement('div');
    row.className = 'dm-result';
    const meta = [item.channel, item.duration ? fmtTime(item.duration) : null]
      .filter(Boolean).join(' · ');
    row.innerHTML = `
      <img class="dm-thumb" src="${item.thumbnail || ''}" alt="" loading="lazy">
      <div class="dm-info">
        <div class="dm-title"></div>
        <div class="dm-meta"></div>
      </div>
    `;
    row.querySelector('.dm-title').textContent = item.title || '';
    row.querySelector('.dm-meta').textContent = meta;
    row.addEventListener('click', () => analyzeDailymotion(item));
    dailymotionResults.appendChild(row);
  }
});

function analyzeDailymotion(item) {
  loadingFilename.textContent = item.title || '';
  showScreen('loading');
  performAnalyze(fetch('/api/dailymotion/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ video_id: item.id, title: item.title, duration: item.duration }),
  }));
}

// ── Enregistrement micro façon Shazam ──────────────────────────────
// Capture un court extrait audio en direct (concert, radio, quelqu'un
// qui joue à côté) pour lancer la même analyse d'accords que sur un
// fichier uploadé, sans passer par un fichier ou une recherche Dailymotion.
const MAX_RECORD_S = 60; // arrêt auto : un extrait suffit à identifier les accords

// Ordre de préférence des formats : webm/opus (Chrome/Firefox) d'abord,
// mp4/aac (seul format supporté par MediaRecorder sur Safari/iOS) en
// repli — filtré par isTypeSupported, donc chaque navigateur retombe
// naturellement sur le premier format qu'il sait produire.
const RECORD_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

function pickRecordMime() {
  if (!window.MediaRecorder) return null;
  return RECORD_MIME_CANDIDATES.find(m => MediaRecorder.isTypeSupported(m)) || null;
}

const recordSupported = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
if (!recordSupported) {
  btnRecord.classList.add('hidden');
}

let mediaRecorder    = null;
let recordStream     = null;
let recordChunks     = [];
let recordStartMs    = 0;
let recordTimerId    = null;
let recordCancelled  = false;

btnRecord.addEventListener('click', startRecording);
btnRecordStop.addEventListener('click', () => { recordCancelled = false; stopRecording(); });
btnRecordCancel.addEventListener('click', () => { recordCancelled = true; stopRecording(); showScreen('upload'); });

async function startRecording() {
  const mimeType = pickRecordMime();
  try {
    recordStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    alert(`Impossible d'accéder au microphone : ${err.message}`);
    return;
  }
  recordChunks = [];
  recordCancelled = false;
  mediaRecorder = new MediaRecorder(recordStream, mimeType ? { mimeType } : undefined);
  mediaRecorder.addEventListener('dataavailable', (e) => {
    if (e.data.size > 0) recordChunks.push(e.data);
  });
  mediaRecorder.addEventListener('stop', onRecordStop);
  mediaRecorder.start();

  recordStartMs = Date.now();
  updateRecordTimer();
  recordTimerId = setInterval(updateRecordTimer, 250);
  showScreen('record');
}

function updateRecordTimer() {
  const elapsed = (Date.now() - recordStartMs) / 1000;
  recordTimerEl.textContent = fmtTime(elapsed);
  if (elapsed >= MAX_RECORD_S) stopRecording();
}

function stopRecording() {
  if (recordTimerId !== null) {
    clearInterval(recordTimerId);
    recordTimerId = null;
  }
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  if (recordStream) {
    recordStream.getTracks().forEach(t => t.stop());
    recordStream = null;
  }
}

function onRecordStop() {
  const chunks = recordChunks;
  recordChunks = [];
  if (recordCancelled || !chunks.length) return;

  const mimeType = mediaRecorder.mimeType || 'audio/webm';
  const ext = mimeType.includes('mp4') ? '.mp4'
    : mimeType.includes('ogg') ? '.ogg'
    : '.webm';
  const blob = new Blob(chunks, { type: mimeType });
  const file = new File([blob], `enregistrement${ext}`, { type: mimeType });

  loadingFilename.textContent = 'Enregistrement micro';
  showScreen('loading');
  uploadAndAnalyze(file);
}

function applyResults(data) {
  state.chords      = data.chords;
  state.structure   = data.structure || [];
  state.title       = data.title || '';
  state.duration    = data.duration;
  state.keyFr       = data.key_fr;
  state.tempo       = data.tempo;
  state.barTimes    = data.bar_times || [];
  state.beatsPerBar = data.beats_per_bar || 4;
  state.fileId      = data.file_id;
  state.transpose   = 0;
  state.activeIdx   = -1;

  // Configurer l'audio
  audioEl.src = `/api/audio/${data.file_id}`;
  audioEl.preload = 'auto';
  seekBar.max = String(data.duration);
  seekBar.value = '0';
  timeCurrent.textContent = '0:00';
  timeTotal.textContent   = fmtTime(data.duration);
  btnPlay.textContent = '▶';

  renderHeader();
  resetSeparatePanel();
  resetMetronome();
  showScreen('results');   // visible d'abord : renderBeatStrip mesure la géométrie des cases
  setInstrument(state.instrument, false);  // applique la vue mémorisée + dimensionne le canvas
  renderBeatStrip();
  updateAt(0);
}

function resetSeparatePanel() {
  clearTimeout(separatePollId);
  separateJobId = null;
  separatePanel.classList.add('hidden');
  separateProgWrap.classList.add('hidden');
  separateErrorEl.classList.add('hidden');
  separateStemsEl.classList.add('hidden');
  setSeparateProgress(0);
}

// ── Affichage ──────────────────────────────────────────────────────
function renderHeader() {
  const disp = transposeKey(state.keyFr, state.transpose);
  infoKey.textContent   = `🎵 ${disp}`;
  infoTempo.textContent = `♩ ${state.tempo} BPM`;
  trLabel.textContent   = state.transpose >= 0 ? `+${state.transpose}` : `${state.transpose}`;
}

function currentChords() {
  return state.chords.map(c => ({
    ...c,
    chord: transposeChord(c.chord, state.transpose),
  }));
}

// Découpe le morceau en cases d'UN temps chacune (façon Chordify), sur
// la grille de mesures détectée côté serveur (state.barTimes), chaque
// mesure subdivisée en state.beatsPerBar temps égaux. On n'affiche le
// nom d'accord que quand il change (case vide = accord tenu). La 1re
// case d'une mesure porte une barre de mesure.
//
// L'accord d'une case est échantillonné à son MILIEU, pas à son début :
// un changement d'accord est ainsi rattaché à la case la plus proche
// (arrondi) et non systématiquement à la case suivante — la grille de
// mesures uniforme (state.barTimes, extrapolée) et la grille de temps
// réelle sur laquelle les accords sont calés peuvent légèrement
// diverger, ce qui décalait le nom d'une case entière.
function computeBeatCells() {
  const chords = currentChords();
  const barTimes = state.barTimes;
  if (!chords.length || !barTimes.length) return [];

  const chordAt = (t) => {
    for (let i = 0; i < chords.length; i++) {
      if (t >= chords[i].time && t < chords[i].end) return chords[i];
    }
    return t < chords[0].time ? chords[0] : chords[chords.length - 1];
  };

  const cells = [];
  let prevChord = null;
  for (let b = 0; b < barTimes.length; b++) {
    const barStart = barTimes[b];
    const barEnd = b + 1 < barTimes.length ? barTimes[b + 1] : state.duration;
    const beatDur = Math.max(0.001, (barEnd - barStart) / state.beatsPerBar);
    for (let k = 0; k < state.beatsPerBar; k++) {
      const start = barStart + k * beatDur;
      if (start >= state.duration) break;
      const end = Math.min(start + beatDur, state.duration);
      const c = chordAt(start + beatDur / 2);
      cells.push({
        start, end,
        chord: c.chord,
        color: c.color,
        showName: c.chord !== prevChord,
        barStart: k === 0,
      });
      prevChord = c.chord;
    }
  }
  return cells;
}

function renderBeatStrip() {
  chordListEl.innerHTML = '';
  state.beatCells = computeBeatCells();
  state.activeCellIdx = -1;
  const frag = document.createDocumentFragment();
  state.beatCells.forEach((cell, idx) => {
    const el = document.createElement('div');
    el.className = 'beat-cell' + (cell.barStart ? ' bar-start' : '');
    el.dataset.idx = idx;
    if (cell.showName && cell.chord !== 'N') {
      const span = document.createElement('span');
      span.className = 'beat-cell-name';
      span.style.color = cell.color;
      span.textContent = cell.chord;
      el.appendChild(span);
    }
    el.addEventListener('click', () => {
      audioEl.currentTime = cell.start + 0.03;
      if (audioEl.paused) audioEl.play().catch(() => {});
    });
    frag.appendChild(el);
  });
  chordListEl.appendChild(frag);
  measureStripGeometry();
}

// Géométrie mise en cache (cases toutes de même largeur, box-sizing
// border-box) pour le défilement continu qui tourne à chaque frame.
// stripPad = padding-gauche résolu (46vw) : offset AVANT la 1re case,
// dans le repère de défilement de .chord-list. Ne PAS utiliser
// firstCell.offsetLeft (repère de l'offsetParent, pas de .chord-list →
// décalage d'environ une case).
function measureStripGeometry() {
  const first = chordListEl.firstElementChild;
  state.cellW = first ? first.getBoundingClientRect().width : 0;
  state.stripPad = parseFloat(getComputedStyle(chordListEl).paddingLeft) || 0;
}

// Met à jour le gros accord / piano / guitare (segments réels, précis —
// indépendant des mesures pour ne pas réintroduire de décalage).
function updateChordAt(time) {
  const chords = currentChords();
  let idx = -1;
  for (let i = 0; i < chords.length; i++) {
    if (time >= chords[i].time && time < chords[i].end) { idx = i; break; }
  }
  if (idx === state.activeIdx) return;
  state.activeIdx = idx;

  const c = idx >= 0 ? chords[idx] : null;
  const chordName = c ? c.chord : '—';
  const chordColor = c ? c.color : '#888';
  const chordTypeTxt = c ? (c.type || '') : '';

  currentChord.textContent  = chordName;
  currentChord.style.color  = chordColor;
  currentType.textContent   = chordTypeTxt;

  // Seul l'instrument affiché est redessiné (l'autre est masqué et sera
  // rafraîchi au moment de la bascule, cf. redrawInstrument).
  drawInstrument(chordName !== '—' ? chordName : null);
}

// ── Bascule piano / guitare (sélecteur + swipe, choix mémorisé) ────
function drawInstrument(chordName) {
  if (state.instrument === 'guitar') {
    drawGuitar(guitarSvg, guitarLabel, chordName);
  } else {
    drawPiano(pianoCanvas, chordName);
  }
}

// Redessine l'instrument visible pour l'accord courant (après une
// bascule / un resize : le canvas piano mesuré caché aurait une largeur
// nulle, il faut le redessiner une fois visible).
function redrawInstrument() {
  const chords = currentChords();
  const c = state.activeIdx >= 0 && state.activeIdx < chords.length ? chords[state.activeIdx] : null;
  drawInstrument(c ? c.chord : null);
}

function loadInstrumentPref() {
  try {
    return localStorage.getItem('chordsplit.instrument') === 'guitar' ? 'guitar' : 'piano';
  } catch { return 'piano'; }
}

function setInstrument(inst, remember = true) {
  state.instrument = inst === 'guitar' ? 'guitar' : 'piano';
  const isPiano = state.instrument === 'piano';
  tabPiano.classList.toggle('active', isPiano);
  tabGuitar.classList.toggle('active', !isPiano);
  tabPiano.setAttribute('aria-selected', String(isPiano));
  tabGuitar.setAttribute('aria-selected', String(!isPiano));
  pianoWrap.classList.toggle('hidden', !isPiano);
  guitarWrap.classList.toggle('hidden', isPiano);
  if (remember) {
    try { localStorage.setItem('chordsplit.instrument', state.instrument); } catch {}
  }
  redrawInstrument();
}

tabPiano.addEventListener('click',  () => setInstrument('piano'));
tabGuitar.addEventListener('click', () => setInstrument('guitar'));

// Swipe horizontal sur la zone instrument pour basculer. On décide au
// touchend (pas de preventDefault) : un geste franchement horizontal et
// au-delà du seuil bascule, sinon on laisse filer le scroll vertical.
let instTouchX = 0, instTouchY = 0, instTouchActive = false;
instrumentPanes.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 1) { instTouchActive = false; return; }
  instTouchX = e.touches[0].clientX;
  instTouchY = e.touches[0].clientY;
  instTouchActive = true;
}, { passive: true });
instrumentPanes.addEventListener('touchend', (e) => {
  if (!instTouchActive) return;
  instTouchActive = false;
  const t = e.changedTouches[0];
  const dx = t.clientX - instTouchX;
  const dy = t.clientY - instTouchY;
  if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.8) return;
  setInstrument(dx < 0 ? 'guitar' : 'piano');
}, { passive: true });

// ── Métronome autonome ────────────────────────────────────────────
// Clic au tempo voulu, accent sur le 1er temps de la mesure. Sans lien
// avec le lecteur : outil d'entraînement. Deux instances, même moteur
// (static/metronome.js) : le panneau de l'écran résultats (pré-réglé
// sur le tempo détecté) et l'écran plein dédié accessible de l'accueil.
function makeMetronomeUI({ playBtn, bpmEl, dotsEl, downBtn, upBtn, valBtn, indicator, resetTempo }) {
  const metro = createMetronome({ onBeat });

  function renderDots(n) {
    dotsEl.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const d = document.createElement('span');
      d.className = 'metro-dot' + (i === 0 ? ' accent' : '');
      dotsEl.appendChild(d);
    }
  }
  function onBeat(b) {
    const dots = dotsEl.children;
    for (let i = 0; i < dots.length; i++) dots[i].classList.toggle('on', i === b);
  }
  function setPlaying(on) {
    playBtn.textContent = on ? '⏸' : '▶';
    if (indicator) indicator.classList.toggle('running', on);
    if (!on) onBeat(-1);
  }
  function setTempo(bpm) { bpmEl.textContent = String(metro.setTempo(bpm)); }
  function reset(tempo, beatsPerBar) {
    metro.stop();
    setPlaying(false);
    metro.setBeatsPerBar(beatsPerBar);
    renderDots(beatsPerBar);
    setTempo(tempo);
  }

  playBtn.addEventListener('click', () => { metro.toggle(); setPlaying(metro.running); });
  downBtn.addEventListener('click', () => setTempo(metro.tempo - 1));
  upBtn.addEventListener('click',   () => setTempo(metro.tempo + 1));
  if (valBtn && resetTempo) valBtn.addEventListener('click', () => setTempo(resetTempo()));

  return { metro, reset, setPlaying };
}

// Panneau sur l'écran résultats (pré-réglé sur le tempo/mesure détectés)
const resultsMetro = makeMetronomeUI({
  playBtn: metroPlay, bpmEl: metroBpm, dotsEl: metroDots,
  downBtn: metroTempoDown, upBtn: metroTempoUp, valBtn: metroTempoVal,
  indicator: btnMetronome, resetTempo: () => state.tempo || 120,
});
function resetMetronome() {
  metronomePanel.classList.add('hidden');
  resultsMetro.reset(state.tempo || 120, state.beatsPerBar || 4);
}
btnMetronome.addEventListener('click', () => metronomePanel.classList.toggle('hidden'));

// Écran plein dédié, accessible de l'accueil (tempo par défaut 120)
const homeMetro = makeMetronomeUI({
  playBtn: hmPlay, bpmEl: hmBpm, dotsEl: hmDots,
  downBtn: hmTempoDown, upBtn: hmTempoUp, valBtn: hmTempoVal,
  resetTempo: () => 120,
});
btnMetronomeHome.addEventListener('click', () => {
  homeMetro.reset(120, 4);
  showScreen('metronome');
});
btnMetronomeBack.addEventListener('click', () => {
  homeMetro.metro.stop();
  homeMetro.setPlaying(false);
  showScreen('upload');
});

// ── Accordeur guitare (tête de guitare + tons de référence + micro) ─
const tuner = createTuner({ onUpdate: onTunerUpdate, onError: onTunerError });
const tunerHeadstock = document.getElementById('tuner-headstock');

// Colonnes de mécaniques d'une tête 3+3, les deux Mi (grave et aigu) en
// bas de leur colonne : gauche haut→bas = Ré La Mi(grave) ; droite
// haut→bas = Sol Si Mi(aigu).
const PEG_COLS = [[2, 1, 0], [3, 4, 5]];

function buildHeadstock() {
  const strings = tuner.strings;
  tunerHeadstock.innerHTML = '';
  PEG_COLS.forEach((col, ci) => {
    const colEl = document.createElement('div');
    colEl.className = 'peg-col peg-col-' + (ci === 0 ? 'left' : 'right');
    col.forEach((idx) => {
      const s = strings[idx];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'peg';
      btn.dataset.idx = idx;
      btn.innerHTML = `<span>${s.fr}</span><small>${s.octave}</small>`;
      btn.addEventListener('click', () => {
        tuner.playString(idx);
        markActivePeg(idx);
      });
      colEl.appendChild(btn);
    });
    if (ci === 0) {
      const neck = document.createElement('div');
      neck.className = 'headstock-neck';
      tunerHeadstock.appendChild(colEl);
      tunerHeadstock.appendChild(neck);
    } else {
      tunerHeadstock.appendChild(colEl);
    }
  });
}

function markActivePeg(idx) {
  tunerHeadstock.querySelectorAll('.peg').forEach((p) => {
    p.classList.toggle('active', Number(p.dataset.idx) === idx);
  });
}

function onTunerUpdate(d) {
  if (!d) return;
  markActivePeg(d.stringIdx);
  const cls = d.hasPitch ? (d.inTune ? 'in-tune' : 'off') : '';
  tunerNote.innerHTML = `${d.noteFr}<sub style="font-size:0.4em;color:var(--text-dim)">${d.octave}</sub>`;
  tunerNote.className = 'tuner-note ' + cls;
  tunerDetail.textContent = d.hasPitch
    ? `cible ${d.targetHz.toFixed(1)} Hz · ${d.frequency.toFixed(1)} Hz`
    : `cible ${d.targetHz.toFixed(1)} Hz`;
  tunerNeedle.className = 'tuner-needle' + (d.hasPitch ? ' on' : '') + (d.hasPitch && d.inTune ? ' in-tune' : '');
  if (d.hasPitch) tunerNeedle.style.left = `${50 + d.cents}%`;
  tunerStatus.classList.toggle('in-tune', d.hasPitch && d.inTune);
  tunerStatus.textContent = !d.hasPitch ? `Joue la corde ${d.noteFr}`
    : d.inTune ? 'Juste ✓'
    : d.cents < 0 ? `Trop bas  ▼ ${Math.abs(d.cents)} cents`
    : `Trop haut  ▲ ${d.cents} cents`;
}

function onTunerError(err) {
  tunerError.classList.remove('hidden');
  tunerError.textContent = (err && err.name === 'NotAllowedError')
    ? "Micro refusé — les sons de référence fonctionnent quand même. Autorise le micro pour l'aiguille."
    : `Micro indisponible : ${err ? err.message : 'erreur inconnue'} — sons de référence toujours actifs.`;
}

async function openTuner() {
  tunerError.classList.add('hidden');
  buildHeadstock();
  tunerNote.textContent = '–';
  tunerNote.className = 'tuner-note';
  tunerNeedle.className = 'tuner-needle';
  tunerDetail.textContent = 'Touche une mécanique';
  tunerStatus.textContent = 'Touche une mécanique pour entendre la corde';
  tunerStatus.classList.remove('in-tune');
  showScreen('tuner');
  await tuner.start();
}

function closeTuner() {
  tuner.stop();
  showScreen('upload');
}

btnTuner.addEventListener('click', openTuner);
btnTunerBack.addEventListener('click', closeTuner);

// Barre défilante : surligne la case du temps en cours et fait glisser
// la bande pour garder la lecture centrée. Le défilement est piloté
// image par image (position interpolée dans la case) plutôt que par
// scrollInto+scroll-behavior:smooth — ce dernier est silencieusement
// inopérant dans certains contextes (WebView, onglet en arrière-plan).
function updateBeatStripAt(time) {
  const cells = state.beatCells;
  if (!cells.length) return;

  let idx = cells.length - 1;
  for (let i = 0; i < cells.length; i++) {
    if (time < cells[i].end) { idx = i; break; }
  }
  if (idx < 0) idx = 0;

  if (idx !== state.activeCellIdx) {
    const prev = chordListEl.querySelector('.beat-cell.active');
    if (prev) prev.classList.remove('active');
    const cur = chordListEl.querySelector(`.beat-cell[data-idx="${idx}"]`);
    if (cur) cur.classList.add('active');
    state.activeCellIdx = idx;
  }

  // Géométrie : peut être nulle si mesurée pendant que l'écran était
  // caché (getBoundingClientRect = 0) — on remesure ici, écran visible.
  if (!state.cellW) measureStripGeometry();
  if (!state.cellW) return;

  // Défilement continu : x du point de lecture dans la bande =
  // padding-gauche + (index de case + fraction écoulée) × largeur de
  // case ; on le place exactement au centre du cadre (comme le gros
  // accord, qui lui est bien calé).
  const cell = cells[idx];
  const span = Math.max(0.001, cell.end - cell.start);
  const frac = Math.max(0, Math.min(1, (time - cell.start) / span));
  const playX = state.stripPad + (idx + frac) * state.cellW;
  chordListEl.scrollLeft = playX - chordListEl.clientWidth / 2;
}

function updateAt(time) {
  // Le gros accord regarde SYNC_LEAD_S en avant (compense le retard de
  // audio.currentTime sur la sortie réelle ; imperceptible sur des
  // segments de plusieurs secondes). La barre défilante, elle, suit le
  // temps BRUT : ses cases font ~une demi-seconde, une anticipation de
  // 0,25 s décalerait le surlignage d'environ une case.
  updateChordAt(time + SYNC_LEAD_S);
  updateBeatStripAt(time);
}

// ── Lecteur audio ──────────────────────────────────────────────────
btnPlay.addEventListener('click', () => {
  if (audioEl.paused) {
    audioEl.play().catch(() => {});
  } else {
    audioEl.pause();
  }
});

audioEl.addEventListener('play',  () => { btnPlay.textContent = '⏸'; startSyncLoop(); });
audioEl.addEventListener('pause', () => { btnPlay.textContent = '▶'; stopSyncLoop(); });
audioEl.addEventListener('ended', () => { btnPlay.textContent = '▶'; stopSyncLoop(); });

// Seek manuel
let isSeeking = false;
seekBar.addEventListener('touchstart', () => { isSeeking = true; }, { passive: true });
seekBar.addEventListener('mousedown',  () => { isSeeking = true; });
seekBar.addEventListener('input', () => {
  timeCurrent.textContent = fmtTime(Number(seekBar.value));
});
seekBar.addEventListener('change', () => {
  audioEl.currentTime = Number(seekBar.value);
  isSeeking = false;
  updateAt(audioEl.currentTime);
});

// Mise à jour en cours de lecture : `timeupdate` ne se déclenche que
// ~4x/seconde dans la plupart des navigateurs, ce qui rendait l'accord
// affiché visiblement en retard sur l'audio. On resynchronise à chaque
// frame (~60x/seconde) pendant la lecture via requestAnimationFrame.
let syncLoopId = null;

function syncLoop() {
  const t = audioEl.currentTime;
  if (!isSeeking) {
    seekBar.value = String(t);
    timeCurrent.textContent = fmtTime(t);
  }
  // updateAt applique lui-même l'anticipation (SYNC_LEAD_S) au seul gros
  // accord ; on lui passe le temps brut.
  updateAt(t);
  syncLoopId = requestAnimationFrame(syncLoop);
}

function startSyncLoop() {
  if (syncLoopId === null) syncLoopId = requestAnimationFrame(syncLoop);
}

function stopSyncLoop() {
  if (syncLoopId !== null) {
    cancelAnimationFrame(syncLoopId);
    syncLoopId = null;
  }
  updateAt(audioEl.currentTime);
}

// ── Transposition ──────────────────────────────────────────────────
btnTrDown.addEventListener('click', () => setTranspose(state.transpose - 1));
btnTrUp.addEventListener('click',   () => setTranspose(state.transpose + 1));

function setTranspose(n) {
  state.transpose = Math.max(-11, Math.min(11, n));
  renderHeader();
  renderBeatStrip();
  state.activeIdx = -2; // force refresh
  updateAt(audioEl.currentTime);
}

// ── Export PDF ─────────────────────────────────────────────────────
btnExportPdf.addEventListener('click', async () => {
  btnExportPdf.disabled = true;
  try {
    const res = await fetch('/api/export-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title:     state.title,
        key_fr:    transposeKey(state.keyFr, state.transpose),
        tempo:     state.tempo,
        duration:  state.duration,
        chords:    currentChords(),
        structure: state.structure,
        bar_times: state.barTimes,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? `Erreur ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'grille-accords.pdf';
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(`Erreur export PDF : ${err.message}`);
  } finally {
    btnExportPdf.disabled = false;
  }
});

// ── Séparation de pistes ───────────────────────────────────────────
const STEM_LABELS = { vocals: 'Voix', drums: 'Batterie', bass: 'Basse', other: 'Autre' };
let separatePollId = null;
let separateJobId = null;

btnSeparate.addEventListener('click', () => {
  if (!state.fileId) return;
  separatePanel.classList.remove('hidden');
  separateErrorEl.classList.add('hidden');
  separateStemsEl.classList.add('hidden');
  separateProgWrap.classList.remove('hidden');
  setSeparateProgress(0);
  startSeparation(state.fileId);
});

async function startSeparation(fileId) {
  try {
    const res = await fetch('/api/separate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`);
    separateJobId = data.job_id;
    pollSeparateStatus();
  } catch (err) {
    showSeparateError(err.message);
  }
}

function pollSeparateStatus() {
  clearTimeout(separatePollId);
  separatePollId = setTimeout(async () => {
    try {
      const res = await fetch(`/api/separate/status/${separateJobId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`);

      if (data.status === 'error') {
        showSeparateError(data.error ?? 'Erreur inconnue.');
        return;
      }
      setSeparateProgress(data.progress ?? 0);
      if (data.status === 'done') {
        showSeparateStems(separateJobId);
        return;
      }
      pollSeparateStatus();
    } catch (err) {
      showSeparateError(err.message);
    }
  }, 1500);
}

function setSeparateProgress(pct) {
  separateProgFill.style.width = `${pct}%`;
  separateProgLabel.textContent = `${pct}%`;
}

function showSeparateError(message) {
  clearTimeout(separatePollId);
  separateProgWrap.classList.add('hidden');
  separateErrorEl.textContent = message;
  separateErrorEl.classList.remove('hidden');
}

function showSeparateStems(jobId) {
  separateProgWrap.classList.add('hidden');
  separateStemsEl.classList.remove('hidden');
  separateStemsEl.querySelectorAll('.separate-stem').forEach((el) => {
    const stem = el.dataset.stem;
    const url = `/api/separate/download/${jobId}/${stem}`;
    const audio = el.querySelector('.stem-audio');
    const link = el.querySelector('.stem-download');
    audio.src = url;
    link.href = url;
    link.download = `${STEM_LABELS[stem] ?? stem}.mp3`;
  });
}

btnReanalyzeOther.addEventListener('click', async () => {
  if (!separateJobId) return;
  btnReanalyzeOther.disabled = true;
  loadingFilename.textContent = 'Piste sans batterie/voix';
  showScreen('loading');
  try {
    await performAnalyze(fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ existing_file_id: `sep_${separateJobId}_other.mp3` }),
    }));
  } finally {
    btnReanalyzeOther.disabled = false;
  }
});

// ── Retour ─────────────────────────────────────────────────────────
btnBack.addEventListener('click', () => {
  audioEl.pause();
  audioEl.src = '';
  resetMetronome();
  fileInput.value = '';
  dailymotionQuery.value = '';
  dailymotionResults.classList.add('hidden');
  dailymotionResults.innerHTML = '';
  showScreen('upload');
});

// ── Redimensionnement du canvas piano ─────────────────────────────
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (screens.results.classList.contains('active')) {
      state.cellW = 0;  // la largeur de case (et le padding 46vw) dépend de la largeur d'écran
      redrawInstrument();  // le canvas piano dépend de sa largeur affichée
      updateChordAt(audioEl.currentTime);
      updateBeatStripAt(audioEl.currentTime);
    }
  }, 150);
});

// ── Historique ─────────────────────────────────────────────────────
// Chaque analyse réussie est mise en cache côté serveur (audio + résultat
// complet, cf. history_store.py sur GCS) — rejouer une entrée ne relance
// jamais detect_chords(), juste un téléchargement de l'audio en cache.
btnHistory.addEventListener('click', () => {
  showScreen('history');
  renderHistory();
});
btnHistoryBack.addEventListener('click', () => showScreen('upload'));

async function renderHistory() {
  historyListEl.innerHTML = '';
  let entries = [];
  try {
    const res = await fetch('/api/history');
    entries = await res.json();
  } catch {
    entries = [];
  }
  historyEmptyEl.classList.toggle('hidden', entries.length > 0);

  for (const entry of entries) {
    const item = document.createElement('div');
    item.className = 'history-item';

    const date = new Date(entry.created_at * 1000).toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    const meta = [
      entry.key_fr,
      entry.tempo ? `${entry.tempo} BPM` : null,
      entry.duration ? fmtTime(entry.duration) : null,
      date,
    ].filter(Boolean).join(' · ');

    const info = document.createElement('div');
    info.className = 'history-info';
    const titleEl = document.createElement('div');
    titleEl.className = 'history-title';
    titleEl.textContent = entry.title || 'Sans titre';
    const metaEl = document.createElement('div');
    metaEl.className = 'history-meta';
    metaEl.textContent = meta;
    info.append(titleEl, metaEl);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'history-delete';
    delBtn.title = 'Supprimer';
    delBtn.textContent = '🗑';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteHistoryEntry(entry.id, item);
    });

    item.append(info, delBtn);
    item.addEventListener('click', () => loadFromHistory(entry.id));
    historyListEl.appendChild(item);
  }
}

async function loadFromHistory(id) {
  showScreen('loading');
  loadingFilename.textContent = '';
  setAnalyzeProgress(0);
  loadingSub.textContent = 'Chargement depuis l’historique…';
  try {
    const res = await fetch(`/api/history/${id}/load`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`);
    applyResults(data);
  } catch (err) {
    alert(`Erreur : ${err.message}`);
    showScreen('history');
  }
}

async function deleteHistoryEntry(id, itemEl) {
  itemEl.style.opacity = '0.5';
  try {
    const res = await fetch(`/api/history/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error();
    itemEl.remove();
    historyEmptyEl.classList.toggle('hidden', historyListEl.children.length > 0);
  } catch {
    itemEl.style.opacity = '1';
    alert('Suppression échouée.');
  }
}

// ── Init ───────────────────────────────────────────────────────────
state.instrument = loadInstrumentPref();
showScreen('upload');
