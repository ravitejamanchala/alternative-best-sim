import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import { compile } from '../src/world/compiler';
import { fromOSM } from '../src/world/osm';
const w = fromOSM(JSON.parse(readFileSync('public/samples/cambridge.osm.json', 'utf8'))),
  samples: number[] = [];
let c;
for (let i = 0; i < 12; i++) {
  c = compile(w);
  samples.push(c.elapsedMs);
}
const sorted = samples.slice(2).sort((a, b) => a - b);
const report = {
  timestamp: new Date().toISOString(),
  device: {
    platform: os.platform(),
    arch: os.arch(),
    cpu: os.cpus()[0].model,
    logicalCpus: os.cpus().length,
    totalRAMGiB: +(os.totalmem() / 2 ** 30).toFixed(1),
    node: process.version,
    rendering: 'See browser-results.json; headless SwiftShader software renderer',
  },
  sample: { bounds: w.bounds, objects: c!.objects.length, roadAreaM2: c!.roadArea },
  generation: {
    coldMs: samples[0],
    warmMedianMs: sorted[Math.floor(sorted.length / 2)],
    warmP95Ms: sorted.at(-1),
    samplesMs: samples,
  },
  memory: process.memoryUsage(),
};
mkdirSync('test-results', { recursive: true });
writeFileSync('test-results/benchmark.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
