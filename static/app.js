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
  activeIdx: -1,       // index de l'accord en cours
};

// ── DOM ────────────────────────────────────────────────────────────
const screens = {
  upload:   document.getElementById('screen-upload'),
  loading:  document.getElementById('screen-loading'),
  results:  document.getElementById('screen-results'),
};
const fileInput       = document.getElementById('file-input');
const youtubeForm     = document.getElementById('youtube-form');
const youtubeUrlInput = document.getElementById('youtube-url');
const loadingFilename = document.getElementById('loading-filename');
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

function applyResults(data) {
  state.chords    = data.chords;
  state.structure = data.structure || [];
  state.title     = data.title || '';
  state.duration  = data.duration;
  state.keyFr     = data.key_fr;
  state.tempo     = data.tempo;
  state.fileId    = data.file_id;
  state.transpose = 0;
  state.activeIdx = -1;

  // Configurer l'audio
  audioEl.src = `/api/audio/${data.file_id}`;
  audioEl.preload = 'auto';
  seekBar.max = String(data.duration);
  seekBar.value = '0';
  timeCurrent.textContent = '0:00';
  timeTotal.textContent   = fmtTime(data.duration);
  btnPlay.textContent = '▶';

  renderHeader();
  renderChordList();
  showScreen('results');
  updateChordAt(0);
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

// Numéro de mesure (hypothèse 4/4, tempo constant — même calcul que
// bars_per_chord côté serveur).
function measureNumber(time) {
  if (!state.tempo) return 1;
  const barDur = 4 * 60 / state.tempo;
  return Math.floor(time / barDur) + 1;
}

function renderChordList() {
  chordListEl.innerHTML = '';
  const chords = currentChords();
  chords.forEach((c, idx) => {
    const chip = document.createElement('div');
    chip.className = 'chord-chip';
    chip.dataset.chord = c.chord;
    chip.dataset.idx   = idx;
    chip.innerHTML = `
      <span class="chip-measure">M${measureNumber(c.time)}</span>
      <span class="chip-name" style="color:${c.color}">${c.chord === 'N' ? '–' : c.chord}</span>
      <span class="chip-time">${fmtTime(c.time)}</span>
    `;
    chip.addEventListener('click', () => {
      audioEl.currentTime = c.time + 0.05;
      if (audioEl.paused) audioEl.play().catch(() => {});
    });
    chordListEl.appendChild(chip);
  });
}

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

  // Chip actif
  document.querySelectorAll('.chord-chip').forEach(el => {
    el.classList.toggle('active', Number(el.dataset.idx) === idx);
  });

  // Défilement auto : centre l'accord actif dans la barre horizontale
  if (idx >= 0) {
    const chip = chordListEl.querySelector(`[data-idx="${idx}"]`);
    if (chip) chip.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }
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
  updateChordAt(audioEl.currentTime);
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
  updateChordAt(t);
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
  updateChordAt(audioEl.currentTime);
}

// ── Transposition ──────────────────────────────────────────────────
btnTrDown.addEventListener('click', () => setTranspose(state.transpose - 1));
btnTrUp.addEventListener('click',   () => setTranspose(state.transpose + 1));

function setTranspose(n) {
  state.transpose = Math.max(-11, Math.min(11, n));
  renderHeader();
  renderChordList();
  updateChordAt(audioEl.currentTime);
  state.activeIdx = -2; // force refresh
  updateChordAt(audioEl.currentTime);
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
      updateChordAt(audioEl.currentTime);
    }
  }, 150);
});

// ── Init ───────────────────────────────────────────────────────────
showScreen('upload');
