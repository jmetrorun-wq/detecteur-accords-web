/**
 * Diagramme guitare — rendu SVG inline.
 * Format GUITAR_CHORDS : { frets:[E,A,D,G,B,e], start:int, barre:int }
 * frets : -1 = corde étouffée, 0 = corde à vide
 */

const GUITAR_CHORDS = {
  'C':    { frets:[-1,3,2,0,1,0], start:0, barre:0 },
  'Cm':   { frets:[-1,3,5,5,4,3], start:3, barre:3 },
  'C7':   { frets:[-1,3,2,3,1,0], start:0, barre:0 },
  'Cm7':  { frets:[-1,3,5,3,4,3], start:3, barre:3 },
  'Cmaj7':{ frets:[-1,3,2,0,0,0], start:0, barre:0 },
  'Csus2':{ frets:[-1,3,0,0,1,3], start:0, barre:0 },
  'Csus4':{ frets:[-1,3,3,0,1,1], start:0, barre:0 },
  'Cdim': { frets:[-1,-1,1,2,1,2], start:0, barre:0 },
  'Caug': { frets:[-1,3,2,1,1,0], start:0, barre:0 },
  'Cadd9':{ frets:[-1,3,2,0,3,0], start:0, barre:0 },

  'C#':    { frets:[-1,4,3,1,2,1], start:1, barre:1 },
  'C#m':   { frets:[-1,4,6,6,5,4], start:4, barre:4 },
  'C#7':   { frets:[-1,4,3,4,2,4], start:2, barre:4 },
  'C#m7':  { frets:[4,4,4,6,5,4], start:4, barre:4 },
  'C#maj7':{ frets:[-1,4,3,1,1,1], start:1, barre:1 },

  'D':    { frets:[-1,-1,0,2,3,2], start:0, barre:0 },
  'Dm':   { frets:[-1,-1,0,2,3,1], start:0, barre:0 },
  'D7':   { frets:[-1,-1,0,2,1,2], start:0, barre:0 },
  'Dm7':  { frets:[-1,-1,0,2,1,1], start:0, barre:0 },
  'Dmaj7':{ frets:[-1,-1,0,2,2,2], start:0, barre:0 },
  'Dsus2':{ frets:[-1,-1,0,2,3,0], start:0, barre:0 },
  'Dsus4':{ frets:[-1,-1,0,2,3,3], start:0, barre:0 },
  'Ddim': { frets:[-1,-1,0,1,0,1], start:0, barre:0 },
  'Daug': { frets:[-1,-1,0,3,3,2], start:0, barre:0 },
  'Dadd9':{ frets:[-1,-1,0,2,3,0], start:0, barre:0 },

  'D#':    { frets:[-1,6,5,3,4,3], start:3, barre:3 },
  'D#m':   { frets:[6,6,8,8,7,6], start:6, barre:6 },

  'E':    { frets:[0,2,2,1,0,0], start:0, barre:0 },
  'Em':   { frets:[0,2,2,0,0,0], start:0, barre:0 },
  'E7':   { frets:[0,2,0,1,0,0], start:0, barre:0 },
  'Em7':  { frets:[0,2,2,0,3,0], start:0, barre:0 },
  'Emaj7':{ frets:[0,2,1,1,0,0], start:0, barre:0 },
  'Esus2':{ frets:[0,2,4,4,0,0], start:0, barre:0 },
  'Esus4':{ frets:[0,2,2,2,0,0], start:0, barre:0 },
  'Edim': { frets:[0,1,2,3,2,-1], start:0, barre:0 },
  'Eaug': { frets:[0,3,2,1,1,0], start:0, barre:0 },

  'F':    { frets:[1,3,3,2,1,1], start:1, barre:1 },
  'Fm':   { frets:[1,3,3,1,1,1], start:1, barre:1 },
  'F7':   { frets:[1,3,1,2,1,1], start:1, barre:1 },
  'Fm7':  { frets:[1,3,1,1,1,1], start:1, barre:1 },
  'Fmaj7':{ frets:[-1,-1,3,2,1,0], start:0, barre:0 },

  'F#':    { frets:[2,4,4,3,2,2], start:2, barre:2 },
  'F#m':   { frets:[2,4,4,2,2,2], start:2, barre:2 },
  'F#7':   { frets:[2,4,2,3,2,2], start:2, barre:2 },
  'F#m7':  { frets:[2,4,2,2,2,2], start:2, barre:2 },

  'G':    { frets:[3,2,0,0,0,3], start:0, barre:0 },
  'Gm':   { frets:[3,5,5,3,3,3], start:3, barre:3 },
  'G7':   { frets:[3,2,0,0,0,1], start:0, barre:0 },
  'Gm7':  { frets:[3,5,3,3,3,3], start:3, barre:3 },
  'Gmaj7':{ frets:[3,2,0,0,0,2], start:0, barre:0 },
  'Gsus2':{ frets:[3,0,0,2,3,3], start:0, barre:0 },
  'Gsus4':{ frets:[3,3,0,0,1,3], start:0, barre:0 },
  'Gdim': { frets:[-1,-1,5,6,5,6], start:5, barre:0 },
  'Gaug': { frets:[3,2,1,0,0,-1], start:0, barre:0 },
  'Gadd9':{ frets:[3,2,0,2,0,3], start:0, barre:0 },

  'G#':    { frets:[4,6,6,5,4,4], start:4, barre:4 },
  'G#m':   { frets:[4,6,6,4,4,4], start:4, barre:4 },

  'A':    { frets:[-1,0,2,2,2,0], start:0, barre:0 },
  'Am':   { frets:[-1,0,2,2,1,0], start:0, barre:0 },
  'A7':   { frets:[-1,0,2,0,2,0], start:0, barre:0 },
  'Am7':  { frets:[-1,0,2,0,1,0], start:0, barre:0 },
  'Amaj7':{ frets:[-1,0,2,1,2,0], start:0, barre:0 },
  'Asus2':{ frets:[-1,0,2,2,0,0], start:0, barre:0 },
  'Asus4':{ frets:[-1,0,2,2,3,0], start:0, barre:0 },
  'Adim': { frets:[-1,0,1,2,1,2], start:0, barre:0 },
  'Aaug': { frets:[-1,0,3,2,2,1], start:0, barre:0 },
  'Aadd9':{ frets:[-1,0,2,4,2,0], start:0, barre:0 },

  'A#':    { frets:[-1,1,3,3,3,1], start:1, barre:1 },
  'A#m':   { frets:[-1,1,3,3,2,1], start:1, barre:1 },
  'A#7':   { frets:[-1,1,3,1,3,1], start:1, barre:1 },
  'A#m7':  { frets:[-1,1,3,1,2,1], start:1, barre:1 },
  'A#maj7':{ frets:[-1,1,3,2,3,1], start:1, barre:1 },

  'B':    { frets:[-1,2,4,4,4,2], start:2, barre:2 },
  'Bm':   { frets:[-1,2,4,4,3,2], start:2, barre:2 },
  'B7':   { frets:[-1,2,1,2,0,2], start:0, barre:0 },
  'Bm7':  { frets:[-1,2,4,2,3,2], start:2, barre:2 },
  'Bmaj7':{ frets:[-1,2,4,3,4,2], start:2, barre:2 },
};

const GUITAR_SVG_NS = 'http://www.w3.org/2000/svg';

function drawGuitar(svgEl, labelEl, chord) {
  // Vide le SVG
  while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);
  if (labelEl) labelEl.textContent = '';

  if (!chord || chord === 'N') {
    const t = document.createElementNS(GUITAR_SVG_NS, 'text');
    t.setAttribute('x', '60'); t.setAttribute('y', '80');
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('fill', '#555');
    t.setAttribute('font-size', '14');
    t.textContent = '—';
    svgEl.appendChild(t);
    return;
  }

  const shape = GUITAR_CHORDS[chord];
  if (!shape) {
    if (labelEl) labelEl.textContent = 'Diagramme\nnon disponible';
    return;
  }

  const { frets, start, barre } = shape;
  const NUM_FRETS = 5;
  const NUM_STRINGS = 6;

  // Dimensions internes (viewBox 0 0 120 160)
  const PAD_L = 22, PAD_T = 20, PAD_R = 8, PAD_B = 12;
  const W = 120 - PAD_L - PAD_R;
  const H = 160 - PAD_T - PAD_B;
  const sw = W / (NUM_STRINGS - 1);   // inter-corde
  const fh = H / NUM_FRETS;           // inter-frette

  function mk(tag, attrs) {
    const el = document.createElementNS(GUITAR_SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }

  // Fond
  svgEl.appendChild(mk('rect', { x:0, y:0, width:120, height:160, fill:'#1A1A2E', rx:6 }));

  // Sillet (nut) ou numéro de frette
  if (start <= 1) {
    svgEl.appendChild(mk('rect', { x: PAD_L, y: PAD_T - 4, width: W, height: 4, fill:'#AAAACC', rx:1 }));
  } else {
    const lbl = mk('text', { x: PAD_L - 4, y: PAD_T + fh * 0.6, 'text-anchor':'end', fill:'#AAAACC', 'font-size':'9' });
    lbl.textContent = `${start}`;
    svgEl.appendChild(lbl);
  }

  // Frettes
  for (let f = 0; f <= NUM_FRETS; f++) {
    const y = PAD_T + f * fh;
    svgEl.appendChild(mk('line', { x1: PAD_L, y1: y, x2: PAD_L + W, y2: y, stroke:'#333355', 'stroke-width':1 }));
  }

  // Cordes
  for (let s = 0; s < NUM_STRINGS; s++) {
    const x = PAD_L + s * sw;
    svgEl.appendChild(mk('line', { x1: x, y1: PAD_T, x2: x, y2: PAD_T + H, stroke:'#444466', 'stroke-width':1 }));
  }

  // Barré
  if (barre > 0) {
    const by = PAD_T + (barre - start + 0.5) * fh;
    svgEl.appendChild(mk('rect', {
      x: PAD_L - 2, y: by - 7, width: W + 4, height: 14,
      rx: 7, fill: '#1A56DB', opacity: '0.85'
    }));
  }

  // Symboles O/X et points
  for (let s = 0; s < NUM_STRINGS; s++) {
    const fret = frets[s];
    const x = PAD_L + s * sw;

    if (fret === -1) {
      // X : corde étouffée
      const t = mk('text', { x, y: PAD_T - 6, 'text-anchor':'middle', fill:'#FF5555', 'font-size':'9' });
      t.textContent = '✕';
      svgEl.appendChild(t);
    } else if (fret === 0) {
      // O : corde à vide
      svgEl.appendChild(mk('circle', { cx: x, cy: PAD_T - 7, r: 4, fill:'none', stroke:'#AAAACC', 'stroke-width':1.5 }));
    } else {
      // Doigt
      const relFret = fret - start + 1;
      const cy = PAD_T + (relFret - 0.5) * fh;
      const isBarreNote = barre > 0 && fret === barre;
      svgEl.appendChild(mk('circle', { cx: x, cy, r: 7, fill: isBarreNote ? '#4FC3F7' : '#AAAACC' }));
    }
  }

  if (labelEl) {
    const root = chord.replace(/[^A-G#]/g, '');
    labelEl.textContent = `Accord de\n${chord}`;
  }
}
