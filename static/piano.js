/**
 * Piano — une octave (Do à Do), monochrome façon Chordify : le clavier
 * reste neutre (touches blanches claires, noires sombres), les notes de
 * l'accord sont marquées d'une pastille sur la touche (pastille foncée
 * sur une blanche, claire sur une noire). La fondamentale a une pastille
 * un peu plus grosse — pas de couleur, pour ne pas prêter à confusion.
 */

const PIANO_NOTES     = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const PIANO_WHITE_SET = new Set([0, 2, 4, 5, 7, 9, 11]);

// Une octave Do..Do (MIDI 60..72) : les deux bords tombent sur une
// touche blanche, jamais de touche noire à moitié hors cadre.
const PIANO_ONE_OCT = (() => {
  const whites = [];  // { nc, i }             (i = colonne blanche 0..7)
  const blacks = [];  // { nc, afterWhite }    (noire posée après la blanche #afterWhite)
  let wi = 0;
  for (let midi = 60; midi <= 72; midi++) {
    const nc = midi % 12;
    if (PIANO_WHITE_SET.has(nc)) { whites.push({ nc, i: wi }); wi++; }
    else { blacks.push({ nc, afterWhite: wi - 1 }); }
  }
  return { whites, blacks, numWhite: wi };
})();

// Intervalles par qualité d'accord (même mapping que chord_detector.py)
const PIANO_INTERVALS = {
  '':     [0, 4, 7],
  'm':    [0, 3, 7],
  '7':    [0, 4, 7, 10],
  'm7':   [0, 3, 7, 10],
  'maj7': [0, 4, 7, 11],
  'sus2': [0, 2, 7],
  'sus4': [0, 5, 7],
  'dim':  [0, 3, 6],
  'aug':  [0, 4, 8],
  'add9': [0, 4, 7, 2],
};

function pianoChordTones(chord) {
  if (!chord || chord === 'N') return null;
  for (let i = 0; i < PIANO_NOTES.length; i++) {
    const note = PIANO_NOTES[i];
    if (!chord.startsWith(note)) continue;
    const rest = chord.slice(note.length);
    if (rest.length > 0 && rest[0] === '#' && note.length === 1) continue;
    const ivs = PIANO_INTERVALS[rest] ?? [0, 4, 7];
    return { rootNc: i, intervals: ivs };
  }
  return null;
}

function _roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawPiano(canvas, chord) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
    canvas.width = W * dpr;
    canvas.height = H * dpr;
  }

  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const tones = pianoChordTones(chord);
  const rootNc = tones ? tones.rootNc : -1;
  const activeNcs = new Set();
  if (tones) {
    activeNcs.add(rootNc);
    for (const iv of tones.intervals) activeNcs.add((rootNc + iv) % 12);
  }

  const { whites, blacks, numWhite } = PIANO_ONE_OCT;
  const pad = 3;
  const kw = (W - pad * 2) / numWhite;   // largeur touche blanche
  const kh = H - pad * 2;                 // hauteur clavier
  const bkw = kw * 0.62;                  // largeur touche noire
  const bkh = kh * 0.62;                  // hauteur touche noire

  const WHITE = '#E9E9EF';
  const BLACK = '#17171F';
  const SEP = '#B9B9C6';
  const DOT_ON_WHITE = '#26262E';
  const DOT_ON_BLACK = '#EDEDF2';

  // ── Touches blanches + séparateurs ───────────────────────────
  for (const w of whites) {
    const x = pad + w.i * kw;
    ctx.fillStyle = WHITE;
    _roundRect(ctx, x + 0.5, pad, kw - 1, kh, 4);
    ctx.fill();
  }
  ctx.strokeStyle = SEP;
  ctx.lineWidth = 1;
  for (let i = 1; i < numWhite; i++) {
    const x = pad + i * kw;
    ctx.beginPath();
    ctx.moveTo(x, pad + 2);
    ctx.lineTo(x, pad + kh - 2);
    ctx.stroke();
  }

  // ── Touches noires (par-dessus) ──────────────────────────────
  for (const b of blacks) {
    const xc = pad + (b.afterWhite + 1) * kw;
    ctx.fillStyle = BLACK;
    _roundRect(ctx, xc - bkw / 2, pad, bkw, bkh, 3);
    ctx.fill();
  }

  // ── Pastilles sur les notes de l'accord ──────────────────────
  if (tones) {
    const drawDot = (x, y, color, isRoot) => {
      const r = isRoot ? Math.max(4.5, kw * 0.24) : Math.max(3.5, kw * 0.18);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    };
    for (const w of whites) {
      if (!activeNcs.has(w.nc)) continue;
      drawDot(pad + w.i * kw + kw / 2, pad + kh - kw * 0.5,
              DOT_ON_WHITE, w.nc === rootNc);
    }
    for (const b of blacks) {
      if (!activeNcs.has(b.nc)) continue;
      const xc = pad + (b.afterWhite + 1) * kw;
      drawDot(xc, pad + bkh - bkw * 0.55, DOT_ON_BLACK, b.nc === rootNc);
    }
  }

  ctx.restore();
}
