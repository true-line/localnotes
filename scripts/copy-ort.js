// Copies the ONNX Runtime Web wasm binaries from the installed
// onnxruntime-web package into public/ort/ so the neural embeddings
// pipeline works offline without committing ~66 MB of binaries to git.
// Runs automatically via the predev/prebuild npm hooks.
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dest = join(root, 'public', 'ort');
const src = join(root, 'node_modules', 'onnxruntime-web', 'dist');

if (!existsSync(join(src, 'ort-wasm-simd-threaded.jsep.wasm'))) {
  console.warn(
    '[copy-ort] onnxruntime-web dist not found; skipping. ' +
      'Semantic embeddings will fall back to the local estimator.'
  );
  process.exit(0);
}

mkdirSync(dest, { recursive: true });
let copied = 0;
for (const name of readdirSync(src)) {
  if (/^ort-wasm-simd-threaded.*\.(wasm|mjs)$/.test(name)) {
    cpSync(join(src, name), join(dest, name));
    copied++;
  }
}
console.log(`[copy-ort] copied ${copied} ONNX Runtime files to public/ort/`);
