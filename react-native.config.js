module.exports = {
  dependencies: {
    'onnxruntime-react-native': {
      platforms: {
        android: {
          // Relative to the package root. The package also ships a legacy unimodule.json,
          // so this explicit config is what keeps it linked as a React Native package.
          sourceDir: 'android',
          packageImportPath: 'import ai.onnxruntime.reactnative.OnnxruntimePackage;',
          packageInstance: 'new OnnxruntimePackage()',
        },
      },
    },
  },
};