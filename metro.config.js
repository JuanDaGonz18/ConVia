const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('onnx');

// Web build (the version iPhone users open in Safari): swap native-only
// libraries for browser implementations. Android/iOS builds are unaffected.
const WEB_ALIASES = {
  'react-native-maps': path.resolve(__dirname, 'src/web/react-native-maps.tsx'),
  'expo-secure-store': path.resolve(__dirname, 'src/web/expo-secure-store.ts'),
};

const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && WEB_ALIASES[moduleName]) {
    return { type: 'sourceFile', filePath: WEB_ALIASES[moduleName] };
  }
  return (defaultResolve ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
