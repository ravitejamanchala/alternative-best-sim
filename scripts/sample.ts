import { readFileSync, writeFileSync } from 'node:fs';
import { fromOSM } from '../src/world/osm';
import { exportTrack } from '../src/sim/adapter';
import { compile } from '../src/world/compiler';
const w = fromOSM(JSON.parse(readFileSync('public/samples/cambridge.osm.json', 'utf8')));
w.id = 'cambridge-centre-2026-10-21';
writeFileSync('public/samples/cambridge.world.json', JSON.stringify(w, null, 2) + '\n');
writeFileSync(
  'public/samples/cambridge.slaydrive.json',
  JSON.stringify(exportTrack(w), null, 2) + '\n',
);
const c = compile(w);
console.log(
  JSON.stringify(
    {
      objects: c.objects.length,
      roads: c.objects.filter((o) => o.kind === 'road').length,
      buildings: c.objects.filter((o) => o.kind === 'building').length,
      asphaltM2: c.roadArea,
      diagnostics: c.diagnostics.map((d) => ({ code: d.code, severity: d.severity })),
      generationMs: c.elapsedMs,
    },
    null,
    2,
  ),
);
