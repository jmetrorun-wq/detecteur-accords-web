/**
 * Métronome autonome — clic audio (Web Audio) au tempo voulu, accent sur
 * le 1er temps de la mesure. Indépendant du lecteur audio : c'est un
 * outil d'entraînement, il ne se cale pas sur le morceau en lecture.
 *
 * Ordonnancement à lookahead (le pattern classique Web Audio) : un
 * setTimeout lâche à ~25 ms réveille le planificateur, qui programme les
 * clics jusqu'à SCHEDULE_AHEAD secondes en avance sur l'horloge audio —
 * le timing des clics reste échantillon-précis même si le timer JS dérive.
 */
function createMetronome({ onBeat } = {}) {
  const LOOKAHEAD_MS = 25;
  const SCHEDULE_AHEAD = 0.12;

  let ac = null;
  let tempo = 120;          // BPM
  let beatsPerBar = 4;
  let running = false;
  let nextNoteTime = 0;     // horloge AudioContext du prochain clic
  let beat = 0;             // 0 = temps fort
  let timerId = null;

  function scheduleClick(time, accent) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.frequency.value = accent ? 1600 : 1000;
    gain.gain.setValueAtTime(accent ? 0.5 : 0.3, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    osc.connect(gain).connect(ac.destination);
    osc.start(time);
    osc.stop(time + 0.06);
  }

  function scheduler() {
    while (nextNoteTime < ac.currentTime + SCHEDULE_AHEAD) {
      const accent = beat === 0;
      scheduleClick(nextNoteTime, accent);
      if (onBeat) {
        const b = beat;
        const delayMs = Math.max(0, (nextNoteTime - ac.currentTime) * 1000);
        setTimeout(() => { if (running) onBeat(b, b === 0); }, delayMs);
      }
      nextNoteTime += 60 / tempo;
      beat = (beat + 1) % beatsPerBar;
    }
    timerId = setTimeout(scheduler, LOOKAHEAD_MS);
  }

  return {
    start() {
      if (running) return;
      if (!ac) {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return;
        ac = new Ctor();
      }
      if (ac.state === 'suspended') ac.resume();
      running = true;
      beat = 0;
      nextNoteTime = ac.currentTime + 0.05;
      scheduler();
    },
    stop() {
      running = false;
      if (timerId) { clearTimeout(timerId); timerId = null; }
    },
    toggle() { this.running ? this.stop() : this.start(); },
    setTempo(bpm) {
      const n = Math.round(Number(bpm) || 0);
      tempo = Math.max(30, Math.min(300, n || 120));
      return tempo;
    },
    setBeatsPerBar(n) {
      beatsPerBar = Math.max(1, Math.min(12, Math.round(Number(n) || 4)));
      return beatsPerBar;
    },
    get running() { return running; },
    get tempo() { return tempo; },
    get beatsPerBar() { return beatsPerBar; },
  };
}
