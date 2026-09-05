# ChordSplit — app mobile (Expo / React Native)

Coquille iOS/Android autour de l'app web ChordSplit (`../` — Flask sur Cloud Run).
Distribution iOS **via EAS Build** (compilation cloud d'Expo), sur le modèle
d'`autoecole-tracker/mobile`. Aucun Xcode local n'est requis.

## État (scaffold initial — 2026-09-04)

- Expo SDK 54, `react-native-webview` chargeant `APP_URL` (voir `App.js`).
- `app.json` : `fr.chordsplit.app`, `owner: djazzy97418`, micro + `UIBackgroundModes: audio`
  + `ITSAppUsesNonExemptEncryption: false`, iPhone seul (`supportsTablet: false`).
- `eas.json` : profils `development` / `preview` (interne) / `production`, `appVersionSource: remote`.
- **Pas encore fait** (à lancer dans un vrai Terminal.app, cf. checklist) :
  - `npx eas login` (compte `djazzy97418`)
  - `npx eas init` → crée `@djazzy97418/chordsplit` et écrit `extra.eas.projectId` dans `app.json`
  - `npx eas device:create` → enregistre l'UDID de l'iPhone
  - `npx eas build --profile preview --platform ios` (1re fois interactif)
- Le natif reste à brancher (checklist Phase 4) : enregistrement micro `expo-audio`,
  import de fichier `expo-document-picker` + Share Extension, lecture arrière-plan,
  coquille (onglets / Réglages / À propos).

## Commandes

```bash
# Node 20 requis (le Node système est trop récent pour l'outillage Expo)
export PATH=/usr/local/opt/node@20/bin:"$PATH"

npm install
npm run start:lan          # Expo Go, même WiFi que le téléphone
npx eas build --profile preview --platform ios --non-interactive
```

## Rappels (hérités d'autoecole-tracker)

- Quota EAS Free = **15 builds iOS/mois par compte**, partagé avec autoecole-tracker.
  Itérer via Expo Go `--lan`, ne builder que quand l'app est quasi prête.
- `npx eas credentials` et `npx eas device:create` sont **interactifs uniquement**
  (Terminal.app, pas le préfixe `!` de Claude Code).
- Un robot user (`EXPO_TOKEN`) ne peut pas faire `expo start --tunnel` → `--lan`.

Checklist complète : voir l'artifact « ChordSplit → App Store » (voie EAS Build).
