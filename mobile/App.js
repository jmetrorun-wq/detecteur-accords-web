import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { WebView } from 'react-native-webview';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { getDocumentAsync } from 'expo-document-picker';
import { useShareIntent } from 'expo-share-intent';

// App web ChordSplit (Flask sur Cloud Run). L'app iOS/Android n'est pour
// l'instant qu'une coquille autour de cette WebView ; la lecture en
// arrière-plan et la coquille (onglets/Réglages) viendront ensuite —
// cf. la checklist Phase 4.
const APP_URL = 'https://detecteur-accords-web-xh56p7tdsa-ew.a.run.app';

// Même limite que l'enregistrement web (static/app.js::MAX_RECORD_S) : un
// court extrait suffit à identifier les accords.
const MAX_RECORD_S = 60;

// Un lien qui reste sur notre service Cloud Run charge dans la WebView ;
// tout le reste (mailto:, autres sites) part dans le navigateur système.
function isInternal(url) {
  return (
    url.startsWith(APP_URL) ||
    url.includes('detecteur-accords-web') ||
    url.startsWith('about:') ||
    url.startsWith('blob:') ||
    url.startsWith('data:')
  );
}

function fmtTimer(ms) {
  const s = Math.floor((ms || 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function App() {
  const webRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [uploading, setUploading] = useState(false); // upload de l'enregistrement en cours

  // Enregistrement micro natif (façon Shazam) : capture via expo-audio
  // (meilleure qualité qu'un MediaRecorder web, et fonction native
  // attendue par la revue App Store — Guideline 4.2, un simple WebView
  // seul est refusé). L'upload se fait directement en natif vers
  // /api/analyze ; seul le job_id est ensuite transmis à la WebView
  // (window.chordSplitNative.showAnalyzeJob, cf. static/app.js) pour
  // réutiliser tel quel le suivi de progression et l'affichage déjà en
  // place côté web.
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder);

  // Import de fichier — deux voies natives, toutes deux réutilisent le
  // même upload direct vers /api/analyze puis le pont
  // window.chordSplitNative.showAnalyzeJob (cf. finishRecording ci-dessous) :
  //  1. sélecteur de fichiers natif (bouton 📂, expo-document-picker) ;
  //  2. Share Extension iOS/Android (« Ouvrir dans ChordSplit » depuis
  //     Fichiers, Dictaphone, une autre app — expo-share-intent). Répond à
  //     la Guideline 4.2 (valeur native) au même titre que le micro.
  //     Nécessite un build EAS (dev client/preview/production) : le
  //     module natif de la Share Extension n'existe pas dans Expo Go.
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();

  const uploadAndShowResult = useCallback(async (uri, name, mimeType) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('audio', { uri, name, type: mimeType || 'application/octet-stream' });
      const res = await fetch(`${APP_URL}/api/analyze`, { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
      webRef.current?.injectJavaScript(
        `window.chordSplitNative && window.chordSplitNative.showAnalyzeJob(${JSON.stringify(data.job_id)}); true;`
      );
    } catch (err) {
      Alert.alert('Analyse impossible', err.message);
    } finally {
      setUploading(false);
    }
  }, []);

  const pickAndAnalyzeFile = useCallback(async () => {
    let result;
    try {
      result = await getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
    } catch (err) {
      Alert.alert('Erreur', err.message);
      return;
    }
    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (!asset) return;
    uploadAndShowResult(asset.uri, asset.name, asset.mimeType);
  }, [uploadAndShowResult]);

  // Réception d'un fichier partagé depuis une autre app (Share Extension).
  useEffect(() => {
    if (!hasShareIntent) return;
    const file = shareIntent?.files?.[0];
    if (file) {
      uploadAndShowResult(file.path, file.fileName, file.mimeType);
    }
    resetShareIntent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasShareIntent]);

  const reload = useCallback(() => {
    setErrored(false);
    setLoading(true);
    webRef.current?.reload();
  }, []);

  const onShouldStartLoadWithRequest = useCallback((req) => {
    const url = req.url || '';
    if (url.startsWith('http') && !isInternal(url)) {
      Linking.openURL(url).catch(() => {});
      return false;
    }
    return true;
  }, []);

  const finishRecording = useCallback(async (shouldAnalyze) => {
    if (!recorderState.isRecording) return;
    let uri;
    try {
      await audioRecorder.stop();
      uri = audioRecorder.uri;
    } catch (err) {
      Alert.alert('Erreur micro', err.message);
      return;
    }
    if (!shouldAnalyze) return;
    if (!uri) {
      Alert.alert('Analyse impossible', 'Enregistrement introuvable.');
      return;
    }
    uploadAndShowResult(uri, 'recording.m4a', 'audio/m4a');
  }, [audioRecorder, recorderState.isRecording, uploadAndShowResult]);

  const stopAndAnalyze = useCallback(() => finishRecording(true), [finishRecording]);
  const cancelRecording = useCallback(() => finishRecording(false), [finishRecording]);

  const startRecording = useCallback(async () => {
    try {
      const status = await requestRecordingPermissionsAsync();
      if (!status.granted) {
        Alert.alert(
          'Micro indisponible',
          "ChordSplit a besoin du micro pour identifier les accords d'un morceau capté en direct.",
        );
        return;
      }
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
    } catch (err) {
      Alert.alert('Erreur micro', err.message);
    }
  }, [audioRecorder]);

  // Arrêt automatique à MAX_RECORD_S, comme l'enregistrement web.
  useEffect(() => {
    if (recorderState.isRecording && recorderState.durationMillis / 1000 >= MAX_RECORD_S) {
      stopAndAnalyze();
    }
  }, [recorderState.isRecording, recorderState.durationMillis, stopAndAnalyze]);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="auto" />
      {errored ? (
        <View style={styles.center}>
          <Text style={styles.title}>Pas de connexion</Text>
          <Text style={styles.body}>
            Impossible de joindre ChordSplit. Vérifie ta connexion internet, puis réessaie.
          </Text>
          <Pressable style={styles.btn} onPress={reload} accessibilityRole="button">
            <Text style={styles.btnText}>Réessayer</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.fill}>
          <WebView
            ref={webRef}
            source={{ uri: APP_URL }}
            originWhitelist={['*']}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => setLoading(false)}
            onError={() => {
              setErrored(true);
              setLoading(false);
            }}
            onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
            // Audio : lecture inline, sans geste requis (barre d'accords synchro).
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            // Micro dans la WebView (secours tant que l'enregistrement natif
            // ci-dessus n'est pas testé en profondeur sur tous les cas).
            mediaCapturePermissionGrantType="grant"
            // Tirer vers le bas pour recharger (iOS).
            pullToRefreshEnabled
            allowsBackForwardNavigationGestures
            setSupportMultipleWindows={false}
          />
          {loading && (
            <View style={styles.loader} pointerEvents="none">
              <ActivityIndicator size="large" color="#1A56DB" />
            </View>
          )}

          {!recorderState.isRecording && !uploading && (
            <>
              <Pressable
                style={styles.recordFab}
                onPress={startRecording}
                accessibilityRole="button"
                accessibilityLabel="Enregistrer un morceau au micro"
              >
                <Text style={styles.recordFabIcon}>🎙️</Text>
              </Pressable>
              <Pressable
                style={[styles.recordFab, styles.importFab]}
                onPress={pickAndAnalyzeFile}
                accessibilityRole="button"
                accessibilityLabel="Importer un fichier audio"
              >
                <Text style={styles.recordFabIcon}>📂</Text>
              </Pressable>
            </>
          )}

          {(recorderState.isRecording || uploading) && (
            <View style={styles.recordOverlay}>
              <View style={styles.recordCard}>
                {uploading ? (
                  <>
                    <ActivityIndicator size="large" color="#1A56DB" />
                    <Text style={styles.recordTitle}>Envoi en cours…</Text>
                  </>
                ) : (
                  <>
                    <View style={styles.recordDot} />
                    <Text style={styles.recordTitle}>Enregistrement en cours…</Text>
                    <Text style={styles.recordTimer}>{fmtTimer(recorderState.durationMillis)}</Text>
                    <View style={styles.recordActions}>
                      <Pressable
                        style={[styles.recordBtn, styles.recordBtnGhost]}
                        onPress={cancelRecording}
                        accessibilityRole="button"
                      >
                        <Text style={styles.recordBtnGhostText}>Annuler</Text>
                      </Pressable>
                      <Pressable style={styles.recordBtn} onPress={stopAndAnalyze} accessibilityRole="button">
                        <Text style={styles.recordBtnText}>Arrêter</Text>
                      </Pressable>
                    </View>
                  </>
                )}
              </View>
            </View>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#ffffff' },
  fill: { flex: 1, backgroundColor: '#ffffff' },
  loader: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
    backgroundColor: '#ffffff',
  },
  title: { fontSize: 20, fontWeight: '700', color: '#161B24' },
  body: { fontSize: 15, color: '#454E5D', textAlign: 'center', lineHeight: 22 },
  btn: {
    marginTop: 8,
    backgroundColor: '#1A56DB',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
  },
  btnText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },

  recordFab: {
    position: 'absolute',
    right: 20,
    bottom: 28,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#1A56DB',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  recordFabIcon: { fontSize: 26 },
  importFab: { bottom: 96 },
  recordOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10,12,16,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  recordCard: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 10,
  },
  recordDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#E23A3A',
    marginBottom: 4,
  },
  recordTitle: { fontSize: 16, fontWeight: '600', color: '#161B24' },
  recordTimer: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1A56DB',
    fontVariant: ['tabular-nums'],
    marginVertical: 6,
  },
  recordActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  recordBtn: {
    backgroundColor: '#1A56DB',
    paddingVertical: 10,
    paddingHorizontal: 22,
    borderRadius: 10,
  },
  recordBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  recordBtnGhost: { backgroundColor: '#EEF1F6' },
  recordBtnGhostText: { color: '#454E5D', fontWeight: '600', fontSize: 15 },
});
