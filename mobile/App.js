import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { WebView } from 'react-native-webview';

// App web ChordSplit (Flask sur Cloud Run). L'app iOS/Android n'est pour
// l'instant qu'une coquille autour de cette WebView ; le natif (micro
// expo-audio, import de fichier, lecture en arrière-plan, onglets) viendra
// ensuite — cf. la checklist Phase 4.
const APP_URL = 'https://detecteur-accords-web-xh56p7tdsa-ew.a.run.app';

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

export default function App() {
  const webRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);

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
            // expo-audio n'est pas branché — checklist Phase 4).
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
});
