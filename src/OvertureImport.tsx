import { useState, useRef } from 'react';
import { Upload } from 'lucide-react';
import type { World } from './world/types';
import { importOverture } from './world/overture';
import { validateWorld } from './world/model';
export function OvertureImport({
  world,
  onImport,
}: {
  world: World;
  onImport: (w: World) => void;
}) {
  const [attribution, setAttribution] = useState(''),
    [error, setError] = useState('');
  const file = useRef<HTMLInputElement>(null);
  return (
    <>
      <h2>Fill building coverage gaps.</h2>
      <p>
        Import a bounded, licensed Overture building GeoJSON extract. Original IDs and footprint
        holes are retained. Buildings overlapping existing footprints are excluded.
      </p>
      <label className="field">
        Source release, attribution and licence
        <input
          value={attribution}
          onChange={(e) => setAttribution(e.target.value)}
          placeholder="Source release and licence from your download"
        />
      </label>
      <button
        className="primary"
        disabled={!attribution.trim()}
        onClick={() => file.current?.click()}
      >
        <Upload size={16} />
        Choose GeoJSON extract
      </button>
      <input
        hidden
        type="file"
        accept=".geojson,.json"
        ref={file}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try {
            if (f.size > 20 * 1024 * 1024) throw Error('Extract exceeds 20 MiB.');
            const next = importOverture(world, JSON.parse(await f.text()), attribution);
            validateWorld(next);
            onImport(next);
          } catch (e: any) {
            setError(e.message);
          }
        }}
      />
      {error && <p role="alert">{error}</p>}
    </>
  );
}
