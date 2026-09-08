/* Banc d'essai hors navigateur pour ../static/tuner.js  (node tests/tuner_test.js)
 *
 * Fabrique des sons de type corde de guitare pincée (fondamentale +
 * harmoniques décroissantes, inharmonicité réaliste) et vérifie, via les
 * crochets `_detectPitch` / `_preprocess` exposés par createTuner() :
 *   - la bonne corde est reconnue ;
 *   - l'écart en cents est correct (accordé ET désaccordé de ±30 c) ;
 *   - aucune erreur d'octave, y compris fondamentale très faible, ronflement
 *     grave, bruit blanc, extinction rapide, niveau faible (micro téléphone) ;
 *   - le silence ne déclenche rien.
 *
 * INHARM (variable d'env) : coefficient d'inharmonicité B. 0 = harmoniques
 * parfaites (référence), 8e-5 ≈ guitare réelle.
 */
const { createTuner } = require('../static/tuner.js');

const SR = 44100;
const N = 4096;
const INHARM = Number(process.env.INHARM ?? 8e-5);
const t = createTuner({});

const STRINGS = [
  { fr: 'Mi2', hz: 82.41 },
  { fr: 'La2', hz: 110.00 },
  { fr: 'Ré3', hz: 146.83 },
  { fr: 'Sol3', hz: 196.00 },
  { fr: 'Si3', hz: 246.94 },
  { fr: 'Mi4', hz: 329.63 },
];

function nearestString(hz) {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < STRINGS.length; i++) {
    const d = Math.abs(1200 * Math.log2(hz / STRINGS[i].hz));
    if (d < bd) { bd = d; bi = i; }
  }
  return bi;
}

// Corde pincée : harmoniques 1..nHarm à ~1/k, inharmonicité, enveloppe qui
// décroît, + ronflement grave et/ou bruit blanc optionnels. Normalisé à
// l'amplitude crête `amp`.
function pluck(f0, { amp = 0.3, rumble = 0, noise = 0, nHarm = 8, phase = 0, decay = 1.0 } = {}) {
  const x = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const tt = i / SR;
    let v = 0;
    for (let k = 1; k <= nHarm; k++) {
      const fk = f0 * k * Math.sqrt(1 + INHARM * k * k);
      v += (1 / k) * Math.sin(2 * Math.PI * fk * tt + phase * k);
    }
    v *= Math.exp(-tt * decay);
    if (rumble) v += rumble * Math.sin(2 * Math.PI * 45 * tt);
    if (noise) v += noise * (Math.random() * 2 - 1);
    x[i] = v;
  }
  let peak = 0;
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(x[i]));
  const g = peak > 0 ? amp / peak : 1;
  for (let i = 0; i < N; i++) x[i] *= g;
  return x;
}

let pass = 0, total = 0;

function run(label, x, expectIdx, expectHz, expectCents = 0) {
  const f = t._detectPitch(t._preprocess(x, SR), SR / 2);
  if (f <= 0) { console.log(`✗ ${label.padEnd(34)} → rien détecté`); return false; }
  const idx = nearestString(f);
  const cents = 1200 * Math.log2(f / expectHz);
  const okStr = idx === expectIdx;
  const okCents = Math.abs(cents - expectCents) < 8;
  const mark = okStr && okCents ? '✓' : '✗';
  console.log(
    `${mark} ${label.padEnd(34)} → ${f.toFixed(2)} Hz  corde ${STRINGS[idx].fr}` +
    `${okStr ? '' : ` (attendu ${STRINGS[expectIdx].fr})`}  ${cents >= 0 ? '+' : ''}${cents.toFixed(1)} c`
  );
  return okStr && okCents;
}
function check(...a) { total++; if (run(...a)) pass++; }

console.log(`INHARM = ${INHARM}\n`);

console.log('— cordes justes, niveau normal —');
STRINGS.forEach((s, i) => check(`${s.fr} juste`, pluck(s.hz), i, s.hz));

console.log('\n— cordes désaccordées (±30 cents) —');
STRINGS.forEach((s, i) => {
  check(`${s.fr} -30c`, pluck(s.hz * Math.pow(2, -30 / 1200)), i, s.hz, -30);
  check(`${s.fr} +30c`, pluck(s.hz * Math.pow(2, 30 / 1200)), i, s.hz, 30);
});

console.log('\n— niveau faible (micro téléphone, amp .02) —');
STRINGS.forEach((s, i) => check(`${s.fr} faible`, pluck(s.hz, { amp: 0.02 }), i, s.hz));

console.log('\n— avec ronflement grave 45 Hz —');
STRINGS.forEach((s, i) => check(`${s.fr} + rumble`, pluck(s.hz, { rumble: 0.5 }), i, s.hz));

console.log('\n— avec bruit blanc —');
STRINGS.forEach((s, i) => check(`${s.fr} + bruit`, pluck(s.hz, { noise: 0.05 }), i, s.hz));

console.log('\n— décroissance rapide (corde étouffée) —');
STRINGS.forEach((s, i) => check(`${s.fr} decay 3`, pluck(s.hz, { decay: 3 }), i, s.hz));

console.log('\n— piège d\'octave : fondamentale très faible —');
STRINGS.forEach((s, i) => {
  const full = pluck(s.hz);
  const noFund = pluck(s.hz, { phase: 0.9 });
  const x = new Float32Array(N);
  for (let j = 0; j < N; j++) x[j] = 0.15 * full[j] + 0.85 * noFund[j];
  check(`${s.fr} fond. faible`, x, i, s.hz);
});

console.log('\n— silence / bruit de fond : doit ne RIEN détecter —');
{
  const q = new Float32Array(N);
  for (let i = 0; i < N; i++) q[i] = 0.002 * (Math.random() * 2 - 1);
  total++;
  const f = t._detectPitch(t._preprocess(q, SR), SR / 2);
  if (f <= 0) { console.log('✓ bruit seul                         → rien (attendu)'); pass++; }
  else console.log(`✗ bruit seul                         → ${f.toFixed(2)} Hz (devrait être rien)`);
}

console.log(`\n${pass}/${total} tests OK`);
process.exit(pass === total ? 0 : 1);
