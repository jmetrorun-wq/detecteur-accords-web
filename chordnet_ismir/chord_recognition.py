from chordnet_ismir_naive import ChordNet,chord_limit,ChordNetCNN
from mir.nn.train import NetworkInterface
from extractors.cqt import CQTV2,SimpleChordToID
from mir import io,DataEntry
from extractors.xhmm_ismir import XHMMDecoder
import numpy as np
from io_new.chordlab_io import ChordLabIO
from settings import DEFAULT_SR,DEFAULT_HOP_LENGTH
import json
import sys

MODEL_NAMES = ['joint_chord_net_ismir_naive_v1.0_reweight(0.0,10.0)_s%d.best' % i for i in range(5)]


def chord_recognition(audio_path, lab_path, chord_dict_name='submission', beats_path=None):
    # [ChordSplit] Si un fichier de temps est fourni (JSON : liste de
    # secondes), on cale les transitions d'accord dessus (use_beats) : le
    # décodage Viterbi ne peut alors changer d'accord que sur un temps,
    # au lieu de le faire à n'importe quelle frame moyennant une pénalité
    # — ce qui retardait les changements de ~0,3-0,6 s sur de la vraie
    # musique. Pénalité de transition abaissée (15 au lieu de 30) puisque
    # les instants de changement sont désormais contraints.
    use_beats = beats_path is not None
    hmm = XHMMDecoder(template_file='data/%s_chord_list.txt' % chord_dict_name,
                      diff_trans_penalty=15.0 if use_beats else 30.0)
    entry = DataEntry()
    entry.prop.set('sr', DEFAULT_SR)
    entry.prop.set('hop_length', DEFAULT_HOP_LENGTH)
    entry.append_file(audio_path, io.MusicIO, 'music')
    entry.append_extractor(CQTV2, 'cqt')
    if use_beats:
        with open(beats_path) as f:
            beat_times = json.load(f)
        # __get_beat_arr lit token[0]=temps, token[1]=position (ignorée
        # quand use_downbeats=False) → on met 1 partout.
        entry.append_data([[float(t), 1] for t in beat_times], io.UnknownIO, 'beat')
    probs = []
    for model_name in MODEL_NAMES:
        net = NetworkInterface(ChordNet(None), model_name, load_checkpoint=False)
        print('Inference: %s on %s' % (model_name, audio_path))
        probs.append(net.inference(entry.cqt))
    probs = [np.mean([p[i] for p in probs], axis=0) for i in range(len(probs[0]))]
    chordlab = hmm.decode_to_chordlab(entry, probs, False, use_beats=use_beats, use_downbeats=False)
    entry.append_data(chordlab, ChordLabIO, 'chord')
    entry.save('chord', lab_path)


if __name__ == '__main__':
    args = sys.argv[1:]
    if len(args) == 2:
        chord_recognition(args[0], args[1])
    elif len(args) == 3:
        chord_recognition(args[0], args[1], args[2])
    elif len(args) == 4:
        # audio, lab, chord_dict, beats_json
        chord_recognition(args[0], args[1], args[2], beats_path=args[3])
    else:
        print('Usage: chord_recognition.py audio_file output_file [chord_dict=submission] [beats_json]')
        print('\tChord dict can be one of the following: full, ismir2017, submission, extended')
        print('\tbeats_json: JSON list of beat times in seconds; enables beat-synced chord transitions')
        exit(0)
