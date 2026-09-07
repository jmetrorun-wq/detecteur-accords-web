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

// Diagramme horizontal : un bout de manche vu de côté. Cordes
// horizontales (Mi grave EN HAUT, Mi aigu en bas), frettes verticales,
// sillet à gauche. frets = [Mi grave, La, Ré, Sol, Si, Mi aigu].
const GUITAR_VB_W = 264;
const GUITAR_VB_H = 132;

function drawGuitar(svgEl, labelEl, chord) {
  while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);
  if (labelEl) labelEl.textContent = '';
  svgEl.setAttribute('viewBox', `0 0 ${GUITAR_VB_W} ${GUITAR_VB_H}`);

  const mk = (tag, attrs) => {
    const el = document.createElementNS(GUITAR_SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };

  if (!chord || chord === 'N') {
    const t = mk('text', { x: GUITAR_VB_W / 2, y: GUITAR_VB_H / 2 + 5,
      'text-anchor': 'middle', fill: '#555', 'font-size': '18' });
    t.textContent = '—';
    svgEl.appendChild(t);
    return;
  }

  const shape = GUITAR_CHORDS[chord];
  if (!shape) {
    const t = mk('text', { x: GUITAR_VB_W / 2, y: GUITAR_VB_H / 2 + 4,
      'text-anchor': 'middle', fill: '#888', 'font-size': '12' });
    t.textContent = 'Diagramme non disponible';
    svgEl.appendChild(t);
    return;
  }

  const { frets, start, barre } = shape;
  const NF = 5, NS = 6;
  const PAD_L = 30, PAD_R = 14, PAD_T = 14, PAD_B = 14;
  const W = GUITAR_VB_W - PAD_L - PAD_R;   // longueur du bout de manche
  const H = GUITAR_VB_H - PAD_T - PAD_B;   // hauteur (6 cordes)
  const sh = H / (NS - 1);                 // inter-corde
  const fw = W / NF;                       // inter-frette

  const stringY = i => PAD_T + i * sh;     // i = 0 -> Mi grave en haut

  // Fond + bois du manche
  svgEl.appendChild(mk('rect', { x: 0, y: 0, width: GUITAR_VB_W, height: GUITAR_VB_H, fill: '#1A1A2E', rx: 8 }));
  svgEl.appendChild(mk('rect', { x: PAD_L, y: PAD_T - 3, width: W, height: H + 6, fill: '#2A2540', rx: 2 }));

  // Frettes verticales (sillet épais à gauche si on joue en bas du manche)
  for (let f = 0; f <= NF; f++) {
    const x = PAD_L + f * fw;
    const isNut = f === 0 && start <= 1;
    svgEl.appendChild(mk('line', { x1: x, y1: PAD_T - 2, x2: x, y2: PAD_T + H + 2,
      stroke: isNut ? '#D8D8E8' : '#4A4A6A', 'stroke-width': isNut ? 4 : 1.5 }));
  }
  if (start > 1) {
    const lbl = mk('text', { x: PAD_L + fw / 2, y: PAD_T - 4, 'text-anchor': 'middle', fill: '#AAAACC', 'font-size': '9' });
    lbl.textContent = String(start);
    svgEl.appendChild(lbl);
  }

  // Cordes horizontales (plus épaisses vers le grave = index 0)
  for (let s = 0; s < NS; s++) {
    const y = stringY(s);
    svgEl.appendChild(mk('line', { x1: PAD_L, y1: y, x2: PAD_L + W, y2: y,
      stroke: '#8A8AB0', 'stroke-width': 0.7 + (NS - 1 - s) * 0.35 }));
  }

  // Barré : rectangle vertical à la frette du barré
  if (barre > 0) {
    const bx = PAD_L + (barre - start + 0.5) * fw;
    svgEl.appendChild(mk('rect', { x: bx - 7, y: PAD_T - 4, width: 14, height: H + 8, rx: 7, fill: '#1A56DB', opacity: '0.85' }));
  }

  // O / X à gauche du sillet + doigts sur le manche
  for (let s = 0; s < NS; s++) {
    const fret = frets[s];
    const y = stringY(s);
    if (fret === -1) {
      const t = mk('text', { x: PAD_L - 15, y: y + 4, 'text-anchor': 'middle', fill: '#FF5555', 'font-size': '11' });
      t.textContent = '✕';
      svgEl.appendChild(t);
    } else if (fret === 0) {
      svgEl.appendChild(mk('circle', { cx: PAD_L - 15, cy: y, r: 4.5, fill: 'none', stroke: '#AAAACC', 'stroke-width': 1.5 }));
    } else {
      const relFret = fret - start + 1;
      const cx = PAD_L + (relFret - 0.5) * fw;
      const isBarreNote = barre > 0 && fret === barre;
      svgEl.appendChild(mk('circle', { cx, cy: y, r: 8, fill: isBarreNote ? '#4FC3F7' : '#EDEDF2' }));
    }
  }

  if (labelEl) labelEl.textContent = `Accord de ${chord}`;
}
