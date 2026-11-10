# Minimal ONNX Runtime for Android

The Android app runs the SFace face model with a custom ONNX Runtime 1.24.3 build
that only contains the operators and types this model uses (arm64-v8a only). The
full runtime from Maven is ~26 MB in the APK; this one is a fraction of that.

The minimal runtime only reads models in ORT format, so the native app uses
`assets/models/sface_int8.ort`, downloaded on first use (not bundled). The web build keeps `assets/models/sface_int8.onnx`
(onnxruntime-web). Both give the same embeddings (cosine 1.0000000 on 20 fixed inputs).

## Files

- `required_operators_and_types.config`: operators/types kept in the build, generated
  together with the `.ort` model.
- `build_settings.json`: `build.py` flags for the AAR (`--minimal_build`, reduced types,
  no NNAPI/XNNPACK, no ML ops).
- `compare-embeddings.mjs`: compares the `.ort` model with the web build's `.onnx` model.
- `convert-model.sh`: regenerates the `.ort` model and the config from the `.onnx` model.
- `.github/workflows/ort-minimal.yml`: builds the AAR with ONNX Runtime's Docker-based
  custom build (`tools/android_custom_build`) and uploads it as a run artifact.
- `vendor/onnxruntime/onnxruntime-android-1.24.3-sface.aar`: the AAR the app uses,
  wired in through `onnxruntimeCustomAar` in `package.json` (see the
  onnxruntime-react-native patch in `patches/`).

## Changing the model or the ORT version

1. Run `scripts/ort-minimal/convert-model.sh`.
2. Push: the workflow runs on changes under `scripts/ort-minimal/`. Download the
   `onnxruntime-android-1.24.3-sface` artifact and replace the AAR in `vendor/onnxruntime/`.
3. Commit the new `.ort` file, publish it as an asset of a new `models-vN` GitHub release
   (not marked latest, so the APK link keeps working) and update `MODEL.url` and
   `MODEL.sha256` in `src/services/faceRecognition.ts`. The app downloads it on first use
   and checks the SHA-256; the file is not bundled in the APK.
4. Check the embeddings against the web build before shipping:
   `node scripts/ort-minimal/compare-embeddings.mjs <deps dir>` (see the script header).
