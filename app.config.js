const fs = require('node:fs');
const path = require('node:path');
const { AndroidConfig, withAndroidManifest, withAppBuildGradle } = require('expo/config-plugins');

// Only 64-bit ARM phones. Libraries compiled from source (React Native, Expo
// modules) follow `buildArchs` in app.json (expo-build-properties); prebuilt native
// libraries (ONNX Runtime, MapLibre, ML Kit…) are filtered here when packaging the APK.
const ANDROID_ABI_FILTERS = ['arm64-v8a'];

function withPhoneArchitectures(config) {
  return withAppBuildGradle(config, (mod) => {
    const filters = ANDROID_ABI_FILTERS.map((abi) => `"${abi}"`).join(', ');
    if (!mod.modResults.contents.includes('abiFilters')) {
      mod.modResults.contents = mod.modResults.contents.replace(
        /defaultConfig\s*\{/,
        (match) => `${match}\n        ndk { abiFilters ${filters} }`,
      );
    }
    return mod;
  });
}

// QR scanning (expo-camera) uses ML Kit's barcode API. expo-camera depends on the
// bundled artifact, which ships the model + libbarhopper inside the APK (~6 MB).
// The Google Play services artifact exposes the same `com.google.mlkit` API and
// downloads the model through Play services, so swap it in at dependency resolution.
const UNBUNDLED_BARCODE = 'com.google.android.gms:play-services-mlkit-barcode-scanning:18.3.1';

function withUnbundledBarcodeModel(config) {
  config = withAppBuildGradle(config, (mod) => {
    if (!mod.modResults.contents.includes(UNBUNDLED_BARCODE)) {
      mod.modResults.contents += `
configurations.all {
    resolutionStrategy.dependencySubstitution {
        substitute(module("com.google.mlkit:barcode-scanning")).using(module("${UNBUNDLED_BARCODE}"))
    }
}
`;
    }
    return mod;
  });
  // Ask Play services to download the model at install time instead of on the first scan.
  return withAndroidManifest(config, (mod) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, 'com.google.mlkit.vision.DEPENDENCIES', 'barcode');
    return mod;
  });
}

function readLocalMapsKey() {
  try {
    const localProperties = fs.readFileSync(
      path.join(__dirname, 'android', 'local.properties'),
      'utf8',
    );
    return localProperties
      .split(/\r?\n/)
      .find((line) => line.startsWith('MAPS_API_KEY='))
      ?.slice('MAPS_API_KEY='.length)
      .trim();
  } catch {
    return undefined;
  }
}

function createExpoConfig({ config }) {
  const googleServicesFile =
    process.env.GOOGLE_SERVICES_JSON ||
    (fs.existsSync(path.join(__dirname, 'google-services.json'))
      ? './google-services.json'
      : undefined);

  // Web build for iPhone users (served from GitHub Pages under a sub-path).
  const webBaseUrl = process.env.EXPO_PUBLIC_WEB_BASE_URL || '';

  return withUnbundledBarcodeModel(withPhoneArchitectures({
    ...config,
    experiments: {
      ...config.experiments,
      ...(webBaseUrl ? { baseUrl: webBaseUrl } : {}),
    },
    web: {
      ...config.web,
      output: 'single',
      name: 'ConVía',
      shortName: 'ConVía',
      lang: 'es',
      themeColor: '#006FFD',
      backgroundColor: '#FFFFFF',
      description: 'Carpooling verificado para tu comunidad universitaria.',
    },
    android: {
      ...config.android,
      ...(googleServicesFile ? { googleServicesFile } : {}),
      config: {
        ...config.android?.config,
        googleMaps: {
          apiKey:
            process.env.GOOGLE_MAPS_API_KEY ||
            readLocalMapsKey() ||
            'YOUR_GOOGLE_MAPS_API_KEY',
        },
      },
    },
  }));
}

module.exports = createExpoConfig;
