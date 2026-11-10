#!/usr/bin/env bash
# Converts the SFace model to ORT format and regenerates the operator config used
# by the minimal ONNX Runtime build (see README.md). Needs Python 3.10–3.13.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

python3 -m venv "$WORK/venv"
"$WORK/venv/bin/python" -m pip install -q onnxruntime==1.24.3 onnx flatbuffers
mkdir "$WORK/in"
cp "$ROOT/assets/models/sface_int8.onnx" "$WORK/in/"
"$WORK/venv/bin/python" -m onnxruntime.tools.convert_onnx_models_to_ort "$WORK/in" \
  --output_dir "$WORK/out" --optimization_style Fixed --enable_type_reduction --target_platform arm

cp "$WORK/out/sface_int8.ort" "$ROOT/assets/models/sface_int8.ort"
{
  echo "# Generated from assets/models/sface_int8.onnx by scripts/ort-minimal/convert-model.sh"
  echo "# (ONNX Runtime 1.24.3, --optimization_style Fixed --enable_type_reduction --target_platform arm)"
  tail -n +3 "$WORK/out/required_operators_and_types.config"
} > "$ROOT/scripts/ort-minimal/required_operators_and_types.config"
echo "Done. The .ort bytes change on every run: update its SHA-256 where the app pins it."
