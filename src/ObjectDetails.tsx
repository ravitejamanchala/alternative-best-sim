import { useState } from 'react';
import type { World, WorldObject } from './world/types';
import { approachMarking, connectEndpoints, laneFromRoad } from './world/authoring';

export function ObjectDetails({
  world,
  object: o,
  onChange,
  onEdit,
  onCreate,
}: {
  world: World;
  object: WorldObject;
  onChange: (key: keyof WorldObject, value: any) => void;
  onEdit: (change: (w: World) => void) => void;
  onCreate: (o: WorldObject) => void;
}) {
  const [error, setError] = useState(''),
    [end, setEnd] = useState<'start' | 'end'>('end'),
    [type, setType] = useState<'stop' | 'give-way'>('give-way');
  const act = (fn: () => void) => {
    try {
      fn();
      setError('');
    } catch (e: any) {
      setError(e.message);
    }
  };
  const tag = (key: string, value: string) =>
    onChange('source', { ...o.source, tags: { ...o.source.tags, [key]: value } });
  return (
    <>
      {o.kind === 'road' && (
        <>
          <label className="field">
            Lane count
            <input
              aria-label="Lane count"
              type="number"
              min="1"
              max="12"
              key={o.id + ':lanes:' + o.lanes}
              defaultValue={o.lanes || 2}
              onBlur={(e) => onChange('lanes', +e.target.value)}
            />
          </label>
          <label className="field">
            Lane divider paint
            <select
              aria-label="Lane divider paint"
              value={o.source.tags.lane_markings || 'unknown'}
              onChange={(e) => tag('lane_markings', e.target.value)}
            >
              <option value="unknown">Unverified · no generated paint</option>
              <option value="yes">Authored / confirmed dashed lines</option>
              <option value="no">No lane divider</option>
            </select>
          </label>
          <button
            className="outline-button"
            onClick={() => act(() => onCreate(laneFromRoad(world, o)))}
          >
            Add left lane guide
          </button>
          <button
            className="outline-button"
            onClick={() =>
              act(() =>
                onEdit((w) => {
                  connectEndpoints(w, o);
                }),
              )
            }
          >
            Connect nearby endpoints
          </button>
          <small className="muted">
            Connect snaps endpoints to existing road nodes within 5 m. Crossings stay separate until
            explicitly connected.
          </small>
          <label className="field">
            Incoming approach
            <select
              aria-label="Incoming approach"
              value={end}
              onChange={(e) => setEnd(e.target.value as typeof end)}
            >
              <option value="start">Source start</option>
              <option value="end">Source end</option>
            </select>
          </label>
          <label className="field">
            Authored approach marking
            <select
              aria-label="Approach marking type"
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
            >
              <option value="give-way">Give-way line</option>
              <option value="stop">Stop line</option>
            </select>
          </label>
          <button
            className="outline-button"
            onClick={() => act(() => onCreate(approachMarking(world, o, end, type)))}
          >
            Place approach marking
          </button>
          <small className="muted">
            Only place controls supported by verified source information. Position uses an estimated
            setback before the connected junction; inspect and adjust it.
          </small>
        </>
      )}
      {['lane', 'marking', 'parking'].includes(o.kind) && (
        <label className="field">
          Width <span>m</span>
          <input
            aria-label="Object width"
            type="number"
            min=".1"
            max="100"
            step=".1"
            key={o.id + ':width:' + o.width}
            defaultValue={o.width || 3}
            onBlur={(e) => onChange('width', +e.target.value)}
          />
        </label>
      )}
      {o.kind === 'parking' && (
        <label className="field">
          Length <span>m</span>
          <input
            aria-label="Object length"
            type="number"
            min="1"
            max="30"
            step=".1"
            key={o.id + ':length:' + o.length}
            defaultValue={o.length || 5}
            onBlur={(e) => onChange('length', +e.target.value)}
          />
        </label>
      )}
      {['lane', 'marking'].includes(o.kind) && (
        <label className="field">
          Marking style
          <select
            aria-label="Marking style"
            value={o.markingType || 'dashed'}
            onChange={(e) => onChange('markingType', e.target.value)}
          >
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
            {o.kind === 'marking' && (
              <>
                <option value="stop">Stop line</option>
                <option value="give-way">Double give-way line</option>
              </>
            )}
          </select>
        </label>
      )}
      {o.kind === 'lane' && (
        <p className="muted">
          Authored lane boundaries follow these control points. Paint is clipped to the shared
          carriageway surface.
        </p>
      )}
      {o.kind === 'junction' && (
        <p className="muted">
          This authored junction surface joins the road and pavement unions. Edit its boundary to
          enlarge the paved area; road centreline surfaces remain authoritative. No priority is
          inferred.
        </p>
      )}
      {o.kind === 'zone' && (
        <label className="field">
          Zone purpose
          <select
            aria-label="Zone purpose"
            value={o.source.tags.purpose || 'assessment'}
            onChange={(e) => tag('purpose', e.target.value)}
          >
            <option value="assessment">Assessment metadata (inactive in free drive)</option>
            <option value="pavement-gap">Mapped / authored pavement gap</option>
          </select>
        </label>
      )}
      {o.kind === 'building' && (
        <>
          <label className="field">
            Building use
            <select
              aria-label="Building use"
              value={o.source.tags.building || 'yes'}
              onChange={(e) => tag('building', e.target.value)}
            >
              {[
                ['yes', 'Unspecified'],
                ['terrace', 'Terrace'],
                ['semidetached_house', 'Semi-detached'],
                ['house', 'House'],
                ['retail', 'Shop / pub'],
                ['apartments', 'Apartments'],
                ['office', 'Office'],
                ['industrial', 'Industrial'],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Roof form
            <select
              aria-label="Roof form"
              value={o.roof || 'flat'}
              onChange={(e) => onChange('roof', e.target.value)}
            >
              {['flat', 'gabled', 'hipped', 'pyramidal'].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <small className="muted">
            Facade details are illustrative and fit within the footprint. Exact shop frontage is
            estimated.
          </small>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
