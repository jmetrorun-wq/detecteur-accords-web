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
};

// ── DOM ────────────────────────────────────────────────────────────
const screens = {
  upload:   document.getElementById('screen-upload'),
  record:   document.getElementById('screen-record'),
  loading:  document.getElementById('screen-loading'),
  results:  document.getElementById('screen-results'),
};
const fileInput       = document.getElementById('file-input');
const youtubeForm     = document.getElementById('youtube-form');
const youtubeUrlInput = document.getElementById('youtube-url');
const loadingFilename = document.getElementById('loading-filename');
const btnRecord       = document.getElementById('btn-record');
const btnRecordStop   = document.getElementById('btn-record-stop');
const btnRecordCancel = document.getElementById('btn-record-cancel');
const recordTimerEl   = document.getElementById('record-timer');
const infoKey         = document.getElementById('info-key');
const infoTempo       = document.getElementById('info-tempo');
const currentChord    = document.getElementById('current-chord');
const currentType     = document.getElementById('current-type');
const pianoCanvas     = document.getElementById('piano-canvas');
const guitarSvg       = document.getElementById('guitar-svg');
const guitarLabel     = document.getElementById('guitar-label');
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

async function performAnalyze(fetchPromise) {
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
    applyResults(data);
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

youtubeForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const url = youtubeUrlInput.value.trim();
  if (!url) return;
  loadingFilename.textContent = url;
  showScreen('loading');
  performAnalyze(fetch('/api/analyze-youtube', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  }));
});

// ── Enregistrement micro façon Shazam ──────────────────────────────
// Capture un court extrait audio en direct (concert, radio, quelqu'un
// qui joue à côté) pour lancer la même analyse d'accords que sur un
// fichier uploadé, sans passer par un fichier ou un lien YouTube.
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
  showScreen('results');   // visible d'abord : renderBeatStrip mesure la géométrie des cases
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
// mesure subdivisée en state.beatsPerBar temps égaux. Chaque case porte
// l'accord en cours à son début ; on n'affiche son nom que quand il
// change (case vide = accord tenu). La 1re case d'une mesure porte une
// barre de mesure.
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
      const c = chordAt(start);
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
  // Géométrie mise en cache (cases toutes de même largeur) pour le
  // défilement continu, qui tourne à chaque frame.
  const first = chordListEl.firstElementChild;
  state.cellW = first ? first.offsetWidth : 62;
  state.stripPad = first ? first.offsetLeft : 0;
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

  // Piano
  drawPiano(pianoCanvas, chordName !== '—' ? chordName : null);

  // Guitare
  drawGuitar(guitarSvg, guitarLabel, chordName !== '—' ? chordName : null);
}

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
  // caché (offsetWidth = 0) — on remesure ici, où l'écran est visible.
  if (!state.cellW) {
    const f = chordListEl.firstElementChild;
    if (f && f.offsetWidth) { state.cellW = f.offsetWidth; state.stripPad = f.offsetLeft; }
  }
  if (!state.cellW) return;

  // Défilement continu : x du point de lecture = padding + (index de
  // case + fraction écoulée dans la case) × largeur de case.
  const cell = cells[idx];
  const span = Math.max(0.001, cell.end - cell.start);
  const frac = Math.max(0, Math.min(1, (time - cell.start) / span));
  const playX = state.stripPad + (idx + frac) * state.cellW;
  chordListEl.scrollLeft = playX - chordListEl.clientWidth / 2 + state.cellW / 2;
}

function updateAt(time) {
  updateChordAt(time);
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
  // La barre de progression suit le temps réel ; accord/piano/guitare/
  // mesures regardent un poil en avant (cf. SYNC_LEAD_S).
  updateAt(t + SYNC_LEAD_S);
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
  fileInput.value = '';
  youtubeUrlInput.value = '';
  showScreen('upload');
});

// ── Redimensionnement du canvas piano ─────────────────────────────
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (screens.results.classList.contains('active')) {
      state.cellW = 0;  // la largeur de case (et le padding 46vw) dépend de la largeur d'écran
      updateChordAt(audioEl.currentTime);
      updateBeatStripAt(audioEl.currentTime);
    }
  }, 150);
});

// ── Init ───────────────────────────────────────────────────────────
showScreen('upload');
