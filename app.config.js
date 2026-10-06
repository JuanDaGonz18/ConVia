const fs = require('node:fs');
const path = require('node:path');

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

  return {
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
      description: 'Carpooling verificado para la comunidad universitaria de Chía y la Sabana.',
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
  };
}

module.exports = createExpoConfig;
