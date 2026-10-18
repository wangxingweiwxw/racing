// Standalone model export from exactly the same geometry used in the game.
import { writeFile, mkdir } from 'node:fs/promises';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { buildRoadster } from '../src/race/roadsterModel.ts';

// GLTFExporter uses the browser FileReader API to assemble its binary buffers.
globalThis.FileReader ??= class {
  async readAsArrayBuffer(blob) { this.result = await blob.arrayBuffer(); this.onloadend?.(); }
};
const { car } = buildRoadster(0xf4f4f4);
car.userData = { description: 'October 18 photo-refined geometry. Independent wing lift/incidence, folding links, detailed LED lights. See REFERENCE.md. Not factory CAD.' };
const binary = await new GLTFExporter().parseAsync(car, { binary: true, onlyVisible: true });
await mkdir(new URL('../public/models/roadster/', import.meta.url), { recursive: true });
await writeFile(new URL('../public/models/roadster/roadster.glb', import.meta.url), Buffer.from(binary));
console.log(`Exported Roadster: ${binary.byteLength} bytes`);
