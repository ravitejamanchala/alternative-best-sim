import type { World, WorldObject, Point } from './world/types';
import { coordinates, roadPoints } from './world/model';
export function VertexFields({
  world,
  object,
  onChange,
}: {
  world: World;
  object: WorldObject;
  onChange: (index: number, p: Point, ring: number) => void;
}) {
  const rings =
    object.kind === 'road'
      ? [roadPoints(world, object)]
      : object.points
        ? [coordinates(object)]
        : (object.rings || []).map((r) => coordinates(object, r));
  return (
    <section className="inspector-section">
      <div className="section-title">CONTROL POINTS · METRES</div>
      <p className="muted">
        Drag a point in the viewport or enter coordinates. Shared road nodes stay connected.
      </p>
      <div className="vertex-fields">
        {rings.map((ring, ri) =>
          ring.slice(0, object.points ? undefined : -1).map((p, i) => (
            <div key={ri + ':' + i}>
              <span>
                {ri ? `Hole ${ri} · ` : ''}
                {i + 1}
              </span>
              {([0, 1] as const).map((axis) => (
                <label key={axis}>
                  {axis === 0 ? 'X' : 'Z'}
                  <input
                    type="number"
                    aria-label={`Vertex ${ri}:${i} ${axis === 0 ? 'X' : 'Z'}`}
                    key={object.id + ':' + ri + ':' + i + ':' + axis + ':' + p[axis]}
                    step="0.1"
                    defaultValue={p[axis].toFixed(2)}
                    onBlur={(e) => {
                      const n = +e.target.value;
                      if (Number.isFinite(n) && Math.abs(n - p[axis]) > 0.005) {
                        const next: [number, number] = [...p];
                        next[axis] = n;
                        onChange(i, next, ri);
                      }
                    }}
                  />
                </label>
              ))}
            </div>
          )),
        )}
      </div>
    </section>
  );
}
