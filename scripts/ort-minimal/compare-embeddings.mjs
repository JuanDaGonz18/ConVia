// Compares SFace embeddings of the ORT-format model (native path) with the .onnx model
// under onnxruntime-web (web build) on 20 fixed pseudo-random 112×112 inputs.
//
//   mkdir /tmp/ortcmp && cd /tmp/ortcmp && npm i onnxruntime-node@1.24.3 onnxruntime-web@1.24.3
//   node scripts/ort-minimal/compare-embeddings.mjs /tmp/ortcmp
//
// Prints the lowest cosine similarity; anything below 0.9999 needs a look.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const deps = process.argv[2];
if (!deps) throw new Error('usage: compare-embeddings.mjs <dir with onnxruntime-node and onnxruntime-web>');
const root = path.resolve(import.meta.dirname, '../..');
const load = createRequire(path.join(path.resolve(deps), 'x.js'));

async function embeddings(pkg, modelPath) {
  const ort = load(pkg);
  ort.env.logLevel = 'error';
  if (pkg === 'onnxruntime-web') ort.env.wasm.numThreads = 1;
  const options = pkg === 'onnxruntime-web' ? { executionProviders: ['wasm'], logSeverityLevel: 3 } : { logSeverityLevel: 3 };
  const session = await ort.InferenceSession.create(new Uint8Array(readFileSync(modelPath)), options);
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const out = [];
  for (let i = 0; i < 20; i++) {
    const data = Float32Array.from({ length: 3 * 112 * 112 }, () => Math.floor(random() * 256));
    const result = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', data, [1, 3, 112, 112]) });
    const vector = [...result[session.outputNames[0]].data];
    const norm = Math.hypot(...vector);
    out.push(vector.map((x) => x / norm));
  }
  return out;
}

const native = await embeddings('onnxruntime-node', path.join(root, 'assets/models/sface_int8.ort'));
const web = await embeddings('onnxruntime-web', path.join(root, 'assets/models/sface_int8.onnx'));
const cosines = native.map((a, i) => a.reduce((sum, x, k) => sum + x * web[i][k], 0));
console.log(`samples ${cosines.length}, min cosine ${Math.min(...cosines).toFixed(7)}`);
