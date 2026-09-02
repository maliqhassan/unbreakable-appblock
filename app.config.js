/**
 * Expo app config.
 *
 * This is a .js config rather than app.json so the AdMob application id can
 * come from the environment. That id is baked into AndroidManifest.xml at
 * prebuild time, so it cannot be read at runtime from `process.env` the way the
 * banner unit id can — it has to be resolved here.
 *
 * The defaults are Google's public test ids. They are safe to commit, they are
 * documented at
 * https://developers.google.com/admob/android/test-ads, and a build that
 * forgets to set the real ones therefore shows test ads rather than risking a
 * policy strike for serving live ads from a development build.
 */

/** Google's published test application id. Not a secret, not ours. */
const ADMOB_TEST_APP_ID = 'ca-app-pub-3940256099942544~3347511713';

const androidAdmobAppId =
  process.env.EXPO_PUBLIC_ADMOB_ANDROID_APP_ID || ADMOB_TEST_APP_ID;

module.exports = () => ({
  expo: {
    name: 'Unbreakable Lock',
    slug: 'unbreakable-lock',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    scheme: 'unbreakablelock',
    // Dark-first: a focus app is most often opened at night, at the moment
    // someone is trying to put their phone down. Set to 'automatic' to follow
    // the system instead -- the light palette is kept in step in theme.ts.
    userInterfaceStyle: 'dark',
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.unbreakablelock.app',
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      package: 'com.unbreakablelock.app',
      adaptiveIcon: {
        backgroundColor: '#0D0F12',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
    },
    web: {
      favicon: './assets/favicon.png',
    },
    plugins: [
      'expo-dev-client',
      [
        // Without this Expo ships its own placeholder splash — a grid and
        // concentric circles — which is what every build before this one used.
        'expo-splash-screen',
        {
          image: './assets/splash-icon.png',
          // The mark sits small and centred; a splash is a held breath, not a
          // billboard.
          imageWidth: 180,
          resizeMode: 'contain',
          // Matches the adaptive icon's plate, so the launcher icon appears to
          // expand into the splash rather than cutting to a different colour.
          backgroundColor: '#0D0F12',
        },
      ],
      // Native Google account picker. Needs no google-services.json: the OAuth
      // web client id is passed at runtime from the environment.
      '@react-native-google-signin/google-signin',
      [
        'expo-build-properties',
        {
          android: {
            minSdkVersion: 26,
            compileSdkVersion: 36,
            targetSdkVersion: 36,
          },
          ios: {
            deploymentTarget: '16.4',
          },
        },
      ],
      [
        './plugins/withUnbreakableLock',
        {
          appGroup: 'group.com.unbreakablelock.app',
        },
      ],
      [
        'react-native-google-mobile-ads',
        {
          androidAppId: androidAdmobAppId,
          // No iOS id: this sprint is Android-only and a placeholder here would
          // be worse than an honest omission.
        },
      ],
    ],
  },
});
