import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Zap,
  ChevronDown,
  ChevronRight,
  Search,
  MapPin,
  Route,
  Layers,
  Building2,
  Trees,
  Flag,
  Car,
  Play,
  MousePointer2,
  Move,
  RotateCw,
  Maximize2,
  Grid3X3,
  Undo2,
  Redo2,
  Copy,
  Trash2,
  Download,
  Upload,
  Save,
  X,
  Plus,
  Minus,
  ArrowUpRight,
  Check,
  AlertTriangle,
  Loader2,
  Settings2,
  Eye,
  Navigation,
  Clock,
  Box,
  Focus,
  ArrowLeft,
  Camera,
  Square,
  PanelLeftClose,
  Keyboard,
  RefreshCw,
  CheckCircle2,
  Map,
  Info,
  Cloud,
  GitBranch,
  ParkingSquare,
  TrafficCone,
} from 'lucide-react';
import type { World, WorldObject, CompiledWorld, Point, Kind, Bounds } from './world/types';
import { fromOSM } from './world/osm';
import { resolveObjects, History, transformObject, setVertex, validateWorld } from './world/model';
import { CompilerJob } from './world/jobs';
import { ProviderClient, retainEdits } from './world/provider';
import { nearestNode, graph, route, loop } from './world/routing';
import { saveRevision, revisions, latest, type Revision } from './world/storage';
import { exportTrack, importTrack } from './sim/adapter';
import { Viewport, type ViewHandle } from './render/Viewport';
import { toGeo } from './world/geo';
import { CloudWorkspace, getAuthToken } from './CloudWorkspace';
import { VertexFields } from './VertexFields';
import { OvertureImport } from './OvertureImport';
import { ObjectDetails } from './ObjectDetails';
import { manualObject } from './world/authoring';
const icons: Record<Kind, any> = {
  road: Route,
  junction: GitBranch,
  lane: Minus,
  building: Building2,
  tree: Trees,
  sign: TrafficCone,
  signal: Flag,
  parking: ParkingSquare,
  checkpoint: Flag,
  zone: Square,
  marking: Minus,
  spawn: Navigation,
};
const sampleBounds: Bounds = [52.2023, 0.116, 52.2065, 0.123];
const pretty = (kind: string) =>
  ({
    road: 'Road network',
    junction: 'Junction surfaces',
    lane: 'Lanes',
    building: 'Buildings',
    tree: 'Street greenery',
    sign: 'Signs',
    signal: 'Signals',
    parking: 'Parking bays',
    checkpoint: 'Checkpoints',
    zone: 'Assessment zones',
    marking: 'Markings',
    spawn: 'Spawn',
  })[kind] || kind;
function download(name: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
    url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function App() {
  const [world, setWorld] = useState<World | null>(null),
    [compiled, setCompiled] = useState<CompiledWorld | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [tab, setTab] = useState('world'),
    [search, setSearch] = useState(''),
    [objectSearch, setObjectSearch] = useState(''),
    [expanded, setExpanded] = useState<string[]>(['road']);
  const [mode, setMode] = useState<'select' | 'translate' | 'rotate' | 'scale' | 'vertices'>(
      'select',
    ),
    [snap, setSnap] = useState(true),
    [driving, setDriving] = useState(false),
    [camera, setCamera] = useState<'chase' | 'first'>('chase'),
    [traffic, setTraffic] = useState(false),
    [pedestrians, setPedestrians] = useState(false),
    [diagnostic, setDiagnostic] = useState(false);
  const [status, setStatus] = useState('Loading Cambridge…'),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(''),
    [toast, setToast] = useState(''),
    [saved, setSaved] = useState(false),
    [stats, setStats] = useState<any>({ fps: 0, drawCalls: 0, triangles: 0, mph: 0 }),
    [modal, setModal] = useState<string | null>(null),
    [historyList, setHistoryList] = useState<Revision[]>([]);
  const [pinMode, setPinMode] = useState<string | null>(null),
    [pins, setPins] = useState<string[]>([]),
    [routeMode, setRouteMode] = useState<'route' | 'clockwise' | 'anticlockwise'>('route'),
    [bounds, setBounds] = useState<Bounds>(sampleBounds),
    [results, setResults] = useState<any[]>([]),
    [searchBusy, setSearchBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [retry, setRetry] = useState<(() => void) | null>(null);
  const job = useRef(new CompilerJob()),
    provider = useRef(new ProviderClient(undefined, getAuthToken)),
    history = useRef<History<World> | null>(null),
    view = useRef<ViewHandle>(null),
    file = useRef<HTMLInputElement>(null),
    generation = useRef<AbortController | null>(null),
    revisionToken = useRef(0),
    worldRef = useRef(world);
  worldRef.current = world;
  const announce = (s: string) => {
    setToast(s);
    setTimeout(() => setToast(''), 4000);
  };
  const accept = useCallback(async (w: World, commit = true) => {
    setBusy(true);
    setStatus('Compiling continuous surfaces…');
    setProgress(55);
    const token = ++revisionToken.current;
    try {
      validateWorld(w);
      const c = await job.current.run(w);
      if (token !== revisionToken.current) return;
      if (commit) {
        if (history.current) history.current.commit(w);
        else history.current = new History(w);
      }
      setWorld(w);
      setCompiled(c);
      setSaved(false);
      setStatus('World ready');
      setProgress(100);
      setError('');
      if (history.current?.trimmed) {
        setToast(
          'Undo memory budget reached; oldest undo steps removed. Saved revisions are retained.',
        );
        history.current.trimmed = false;
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setError(e.message);
        setStatus('Generation failed');
      }
    } finally {
      if (token === revisionToken.current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    let active = true;
    Promise.all([
      fetch('/samples/cambridge.osm.json').then((r) => r.json()),
      latest().catch(() => null),
    ])
      .then(([data, draft]) => {
        if (active) accept(draft || fromOSM(data));
      })
      .catch((e) => {
        setError(e.message);
        setBusy(false);
      });
    return () => {
      active = false;
      job.current.cancel();
    };
  }, [accept]);
  const edit = useCallback(
    (change: (w: World) => void) => {
      const w = worldRef.current;
      if (!w) return;
      const next = structuredClone(w);
      change(next);
      accept(next);
    },
    [accept],
  );
  const undo = useCallback(() => {
    if (history.current?.past.length) accept(history.current.undo(), false);
  }, [accept]);
  const redo = useCallback(() => {
    if (history.current?.future.length) accept(history.current.redo(), false);
  }, [accept]);
  const remove = () => {
    if (selected)
      edit((w) => {
        w.overrides[selected] = { ...w.overrides[selected], deleted: true };
      });
    setSelected(null);
  };
  const duplicate = () => {
    const o = compiled?.objects.find((o) => o.id === selected);
    if (!o) return;
    const copy = structuredClone(o);
    copy.id = 'manual/' + crypto.randomUUID();
    copy.name += ' copy';
    copy.x += 5;
    copy.z += 5;
    copy.source = { ...copy.source, provider: 'manual', confidence: 'manual', id: copy.id };
    if (copy.nodeIds) copy.nodeIds = copy.nodeIds.map((_, i) => copy.id + '/' + i);
    edit((w) => w.additions.push(copy));
    setSelected(copy.id);
  };
  const save = async () => {
    if (!world) return;
    try {
      await saveRevision(world);
      setSaved(true);
      announce('Immutable revision saved on this device');
    } catch (e: any) {
      setError('Save failed: ' + e.message);
    }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches('input,select,textarea')) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        save();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault();
        duplicate();
      } else if (e.key === 'Delete' && !driving) remove();
      else if (e.key === 'Escape') {
        setDriving(false);
        setPinMode(null);
        setModal(null);
      } else if (!driving && e.key === 'v') setMode('select');
      else if (!driving && e.key === 'g') setMode('translate');
      else if (!driving && e.key === 'r') setMode('rotate');
      else if (!driving && e.key === 'f') view.current?.focus(selected || undefined);
      else if (driving && e.key === 'r') view.current?.reset();
      else if (driving && e.key === 'c') setCamera(camera === 'chase' ? 'first' : 'chase');
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  const object = compiled?.objects.find((o) => o.id === selected);
  const filtered = (compiled?.objects || []).filter((o) =>
    o.name.toLowerCase().includes(objectSearch.toLowerCase()),
  );
  const setProperty = (key: string, value: any) => {
    if (object) edit((w) => transformObject(w, object.id, { [key]: value }));
  };
  async function generate(sample = false) {
    generation.current?.abort();
    const controller = new AbortController();
    generation.current = controller;
    setBusy(true);
    setProgress(15);
    setStatus(sample ? 'Reading Cambridge snapshot…' : 'Requesting bounded OSM data…');
    setError('');
    setRetry(() => () => generate(sample));
    try {
      const data = sample
        ? await fetch('/samples/cambridge.osm.json', { signal: controller.signal }).then((r) =>
            r.json(),
          )
        : await provider.current.osm(bounds, controller.signal);
      if (controller.signal.aborted) return;
      setProgress(40);
      const b = sample ? sampleBounds : bounds;
      let next = fromOSM(data, b, sample ? 'Cambridge · City centre' : search || 'New UK world');
      if (world && world.geo.origin.every((v, i) => v === next.geo.origin[i]))
        next = retainEdits(world, next);
      else if (world && !saved) await saveRevision(world);
      setSelected(null);
      setPins([]);
      setDriving(false);
      await accept(next);
    } catch (e: any) {
      if (generation.current === controller) {
        if (e.name !== 'AbortError') {
          setError(e.message);
          setStatus('Source unavailable · current world retained');
        }
        setBusy(false);
      }
    }
  }
  async function searchPlaces() {
    setSearchBusy(true);
    setError('');
    const matches = (compiled?.objects || [])
      .filter((o) => o.name.toLowerCase().includes(search.toLowerCase()))
      .slice(0, 8)
      .map((o) => ({ name: o.name, label: 'In this world', id: o.id }));
    if (/cambridge/i.test(search) || !search)
      matches.unshift({
        name: 'Cambridge city centre',
        label: 'Offline example · OpenStreetMap',
        id: 'sample',
      });
    if (matches.length) {
      setResults(matches);
      setSearchBusy(false);
      return;
    }
    try {
      const r = await provider.current.search(search);
      setResults(
        r.map((p: any) => ({
          name: p.display_name,
          label: 'OpenStreetMap · UK',
          lat: Number(p.lat),
          lon: Number(p.lon),
        })),
      );
      if (!r.length) announce('No matching UK places found');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSearchBusy(false);
    }
  }
  const place = (kind: Kind, p: Point) => {
    if (kind === 'spawn') {
      edit((w) => {
        w.spawn = { x: p[0], z: p[1], heading: 0 };
      });
      return;
    }
    const o = manualObject(kind, p);
    edit((w) => w.additions.push(o));
    setSelected(o.id);
    setMode('translate');
  };
  const onPin = (p: Point) => {
    if (pinMode?.startsWith('place:')) {
      place(pinMode.slice(6) as Kind, p);
      setPinMode(null);
      return;
    }
    if (!world) return;
    const id = nearestNode(world, p);
    if (!id) {
      setError('No connected roads in this world');
      return;
    }
    setPins((prev) =>
      pinMode === 'start'
        ? [id, ...prev.slice(1)]
        : pinMode === 'destination'
          ? [prev[0] || id, ...prev.slice(1, -1), id]
          : [...prev, id],
    );
    setPinMode(null);
  };
  const buildRoute = () => {
    if (!world) return;
    try {
      const r =
        routeMode === 'route'
          ? route(world, pins)
          : loop(world, pins[0], routeMode === 'clockwise');
      edit((w) => (w.route = r));
      announce('Connected practice route created');
    } catch (e: any) {
      setError(e.message);
    }
  };
  const exportFile = (legacy = false) => {
    if (!world) return;
    try {
      download(
        legacy ? 'cambridge.slaydrive.json' : 'cambridge.world.json',
        legacy ? exportTrack(world) : world,
      );
      announce(legacy ? 'Track exported with full World extension' : 'Complete world exported');
    } catch (e: any) {
      setError(e.message);
    }
  };
  const chooseFile = async (f: File) => {
    try {
      if (f.size > 20 * 1024 * 1024)
        throw Error('Import exceeds 20 MiB. Nothing has been replaced.');
      const next = importTrack(await f.text());
      if (world && !saved) await saveRevision(world);
      setSelected(null);
      await accept(next);
      announce('World imported; previous work kept in revisions');
    } catch (e: any) {
      setError(e.message);
    }
  };
  return (
    <div className={'app ' + (driving ? 'is-driving' : '')} data-busy={busy}>
      <header className="topbar">
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <span className="brand-mark">
            <Zap size={23} fill="currentColor" />
          </span>
          <span>
            SlayDrive <b>World</b>
          </span>
          <span className="beta">STUDIO</span>
        </a>
        <div className="project-title">
          <span className="project-dot" />
          {world?.title || 'Cambridge · City centre'}
          <ChevronDown size={13} />
        </div>
        <div className="top-actions">
          <span className="local-indicator">
            <span />
            {saved ? 'Saved locally' : 'Local workspace'}
          </span>
          <button
            className="icon-button"
            title="Revision history"
            onClick={async () => {
              setHistoryList(await revisions());
              setModal('revisions');
            }}
          >
            <Clock size={17} />
          </button>
          <button className="export-button" onClick={() => setModal('export')}>
            <Upload size={15} /> Export <ChevronDown size={12} />
          </button>
          <button className="icon-button" title="Cloud workspace" onClick={() => setModal('cloud')}>
            <Cloud size={17} />
          </button>
          <button className="avatar" onClick={() => setModal('about')} title="Workspace details">
            SD
          </button>
        </div>
      </header>
      <div className="workspace-bar">
        <div className="workspace-tabs">
          {[
            ['world', 'World editor', Map],
            ['routes', 'Practice routes', Route],
            ['library', 'Asset library', Box],
          ].map(([id, label, Icon]: any) => (
            <button
              className={tab === id ? 'active' : ''}
              key={id}
              onClick={() => {
                setTab(id);
                setDriving(false);
              }}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>
        <div className="workspace-actions">
          <button className="subtle" onClick={() => setModal('help')}>
            <Keyboard size={15} />
            <span>Shortcuts</span>
          </button>
          <span className="divider" />
          <button className="subtle" disabled={!world || busy} onClick={save}>
            <Save size={15} />
            {saved ? 'Saved' : 'Save revision'}
          </button>
          <button
            className={'drive-button ' + (driving ? 'stop' : '')}
            disabled={!compiled || busy}
            onClick={() => {
              setDriving(!driving);
              setPinMode(null);
            }}
          >
            {driving ? (
              <Square size={14} fill="currentColor" />
            ) : (
              <Play size={14} fill="currentColor" />
            )}
            {driving ? 'Stop driving' : 'Test drive'}
          </button>
        </div>
      </div>
      <main className="studio">
        {!driving && (
          <aside className="left-panel">
            <div className="panel-heading">
              <span>
                {tab === 'routes'
                  ? 'Plan a practice route'
                  : tab === 'library'
                    ? 'Make it your own'
                    : 'Your world'}
              </span>
              <button
                className="icon-button"
                title="World information"
                onClick={() => setModal('about')}
              >
                <Info size={15} />
              </button>
            </div>
            <div className="location-section">
              <label className="eyebrow">LOCATION</label>
              <form
                className="search-input"
                onSubmit={(e) => {
                  e.preventDefault();
                  searchPlaces();
                }}
              >
                <Search size={16} />
                <input
                  aria-label="Search UK location"
                  placeholder="Place, address or test centre"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <button aria-label="Search" type="submit">
                  {searchBusy ? <Loader2 className="spin" size={14} /> : <ArrowUpRight size={16} />}
                </button>
              </form>
              {results.length > 0 && (
                <div className="search-results">
                  {results.map((r, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        if (r.id === 'sample') generate(true);
                        else if (r.id) {
                          setSelected(r.id);
                          view.current?.focus(r.id);
                        } else {
                          setBounds([r.lat - 0.004, r.lon - 0.006, r.lat + 0.004, r.lon + 0.006]);
                          setSearch(r.name.split(',').slice(0, 2).join(','));
                          announce('Area selected; generate to load roads');
                        }
                        setResults([]);
                      }}
                    >
                      <MapPin size={15} />
                      <span>
                        <b>{r.name}</b>
                        <small>{r.label}</small>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <button
                className="location-card"
                onClick={() => {
                  view.current?.focus();
                  setModal('area');
                }}
              >
                <div className="mini-map">
                  <i />
                  <i />
                  <i />
                  <MapPin size={19} fill="#8fbc58" />
                </div>
                <span>
                  <b>{world?.title.split(' · ')[0] || 'Cambridge'}</b>
                  <small>
                    {world?.geo.origin[0].toFixed(4) || '52.2044'}° N ·{' '}
                    {world?.geo.origin[1].toFixed(4) || '0.1195'}° E
                  </small>
                  <em>
                    <span />
                    Offline snapshot available
                  </em>
                </span>
                <ChevronRight size={14} />
              </button>
              <div className="area-row">
                <span>
                  <Square size={12} /> Bounded area
                </span>
                <button onClick={() => setModal('area')}>
                  Edit bounds <ArrowUpRight size={11} />
                </button>
              </div>
              <button className="generate-button" disabled={busy} onClick={() => generate(false)}>
                <Zap size={15} />
                Generate world <span>↵</span>
              </button>
              <button className="sample-link" disabled={busy} onClick={() => generate(true)}>
                <RefreshCw size={11} /> Use Cambridge offline example
              </button>
            </div>
            {tab === 'routes' ? (
              <div className="route-panel">
                <label className="eyebrow">ROUTE BUILDER</label>
                <p>Connected practice routes. Not official DVSA test routes.</p>
                <div className="segmented">
                  {[
                    ['route', 'A → B'],
                    ['clockwise', '↻ Loop'],
                    ['anticlockwise', '↺ Loop'],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      className={routeMode === id ? 'selected' : ''}
                      onClick={() => setRouteMode(id as any)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button className="pin-row" onClick={() => setPinMode('start')}>
                  <span className="pin-dot" /> {pins[0] ? 'Start pin set' : 'Choose start on map'}
                  <MapPin size={14} />
                </button>
                {routeMode === 'route' && (
                  <>
                    <button className="pin-row" onClick={() => setPinMode('destination')}>
                      <span className="pin-dot end" />
                      {pins.length > 1 ? 'Destination set' : 'Choose destination'}
                      <Flag size={14} />
                    </button>
                    <button className="text-button" onClick={() => setPinMode('stop')}>
                      <Plus size={13} /> Add waypoint at end
                    </button>
                  </>
                )}
                {pins.map((p, i) => (
                  <div className="waypoint" key={i}>
                    <span>{i + 1}</span>Node {p}
                    <button
                      aria-label={'Remove waypoint ' + (i + 1)}
                      onClick={() => setPins(pins.filter((_, j) => j !== i))}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
                <button className="primary" disabled={busy || !pins.length} onClick={buildRoute}>
                  Build practice route <Route size={15} />
                </button>
                {world?.route && (
                  <p>
                    {world.route.points.length} connected nodes · {world.route.mode}
                  </p>
                )}
                <small className="muted">
                  One-way roads and supported node-based turn restrictions are checked. Missing
                  source restrictions remain uncertain.
                </small>
              </div>
            ) : tab === 'library' ? (
              <div className="library-panel">
                <label className="eyebrow">PLACE IN YOUR WORLD</label>
                <p>Drag an asset into the viewport, or click to place.</p>
                <div className="asset-grid">
                  {(
                    [
                      'road',
                      'junction',
                      'lane',
                      'building',
                      'tree',
                      'sign',
                      'signal',
                      'parking',
                      'checkpoint',
                      'zone',
                      'marking',
                      'spawn',
                    ] as Kind[]
                  ).map((kind) => {
                    const Icon = icons[kind];
                    return (
                      <button
                        key={kind}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData('slaydrive/object', kind)}
                        onClick={() => setPinMode('place:' + kind)}
                      >
                        <Icon size={27} strokeWidth={1.3} />
                        <span>{pretty(kind)}</span>
                      </button>
                    );
                  })}
                </div>
                <button className="outline-button" onClick={() => setModal('overture')}>
                  <Upload size={14} />
                  Import Overture buildings
                </button>
                <p className="muted">
                  Authored objects are labelled as manual. Signals are inert placements until timing
                  is explicitly authored.
                </p>
              </div>
            ) : (
              <>
                <div className="hierarchy-heading">
                  <span>
                    <Layers size={14} /> SCENE COLLECTION
                  </span>
                  <span>{compiled?.objects.length || 0}</span>
                </div>
                <div className="object-search">
                  <Search size={13} />
                  <input
                    aria-label="Search objects"
                    placeholder="Find an object…"
                    value={objectSearch}
                    onChange={(e) => setObjectSearch(e.target.value)}
                  />
                  <kbd>⌕</kbd>
                </div>
                <div className="hierarchy">
                  {(
                    [
                      'road',
                      'junction',
                      'lane',
                      'building',
                      'tree',
                      'sign',
                      'signal',
                      'parking',
                      'checkpoint',
                      'zone',
                      'marking',
                    ] as Kind[]
                  ).map((kind) => {
                    const list = filtered.filter((o) => o.kind === kind);
                    if (!list.length) return null;
                    const Icon = icons[kind],
                      open = expanded.includes(kind) || !!objectSearch;
                    return (
                      <div className="tree-group" key={kind}>
                        <button
                          className="tree-group-title"
                          onClick={() =>
                            setExpanded(
                              open ? expanded.filter((x) => x !== kind) : [...expanded, kind],
                            )
                          }
                        >
                          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          <Icon size={15} />
                          <span>{pretty(kind)}</span>
                          <small>{list.length}</small>
                        </button>
                        {open &&
                          list.map((o) => (
                            <button
                              key={o.id}
                              aria-label={o.name}
                              className={'object-row ' + (selected === o.id ? 'selected' : '')}
                              onClick={() => {
                                setSelected(o.id);
                                setMode('select');
                              }}
                              onDoubleClick={() => view.current?.focus(o.id)}
                            >
                              <span
                                className={
                                  'object-dot ' + (o.source.provider === 'manual' ? 'manual' : '')
                                }
                              />
                              <span>{o.name}</span>
                              {world?.overrides[o.id] && (
                                <span className="edited-dot" title="Authored override" />
                              )}
                            </button>
                          ))}
                      </div>
                    );
                  })}
                </div>
                <div className="collection-footer">
                  <span>
                    <span className="green-dot" /> All layers visible
                  </span>
                  <button
                    className="icon-button"
                    onClick={() => setTab('library')}
                    title="Add object"
                  >
                    <Plus size={17} />
                  </button>
                </div>
              </>
            )}
            <div className="source-footer">
              <span className="source-icon">
                <Map size={16} />
              </span>
              <div>
                <b>Built on real places</b>
                <small>© OpenStreetMap contributors · ODbL</small>
              </div>
              <button
                className="icon-button"
                onClick={() => setModal('sources')}
                title="Source attribution"
              >
                <ArrowUpRight size={14} />
              </button>
            </div>
          </aside>
        )}
        <section className="canvas-section">
          {world && compiled && (
            <Viewport
              ref={view}
              world={world}
              compiled={compiled}
              selected={selected}
              mode={mode}
              snap={snap}
              driving={driving}
              camera={camera}
              traffic={traffic}
              pedestrians={pedestrians}
              diagnostics={diagnostic}
              pinMode={pinMode}
              onSelect={setSelected}
              onTransform={(id, patch) => edit((w) => transformObject(w, id, patch))}
              onVertex={(id, index, p, ri) => {
                const o = compiled.objects.find((o) => o.id === id);
                if (o) edit((w) => setVertex(w, o, index, p, ri));
              }}
              onPlace={place}
              onPin={onPin}
              onStats={setStats}
              onError={setError}
            />
          )}
          {!driving && (
            <>
              <div className="viewport-label">
                <span className="green-dot" />
                <b>Perspective</b>
                <span>·</span>
                <span>Daylight</span>
                <ChevronDown size={12} />
              </div>
              <div className="viewport-tools">
                {[
                  [MousePointer2, 'select', 'Select (V)'],
                  [Move, 'translate', 'Move (G)'],
                  [RotateCw, 'rotate', 'Rotate (R)'],
                  [Maximize2, 'scale', 'Scale'],
                  [Box, 'vertices', 'Edit control points'],
                ].map(([Icon, id, title]: any) => (
                  <button
                    key={id}
                    title={title}
                    aria-label={title}
                    className={mode === id ? 'active' : ''}
                    onClick={() => setMode(id)}
                  >
                    <Icon size={18} />
                  </button>
                ))}
                <span />
                <button
                  title="Grid snapping"
                  aria-label="Grid snapping"
                  className={snap ? 'active' : ''}
                  onClick={() => setSnap(!snap)}
                >
                  <Grid3X3 size={17} />
                </button>
                <span />
                <button
                  title="Undo (Ctrl Z)"
                  aria-label="Undo"
                  disabled={!history.current?.past.length || busy}
                  onClick={undo}
                >
                  <Undo2 size={17} />
                </button>
                <button
                  title="Redo (Ctrl Shift Z)"
                  aria-label="Redo"
                  disabled={!history.current?.future.length || busy}
                  onClick={redo}
                >
                  <Redo2 size={17} />
                </button>
              </div>
              <div className="world-badge">
                <div>
                  <span className="eyebrow">CAMBRIDGE COLLECTION</span>
                  <h1>{world?.title.split(' · ').at(-1) || 'City centre'}</h1>
                  <p>A real place. Your next practice drive.</p>
                </div>
                <span className="badge-corner">
                  <ArrowUpRight size={18} />
                </span>
              </div>
            </>
          )}
          <div className="view-controls">
            <button title="Top view" aria-label="Top view" onClick={() => view.current?.view(true)}>
              <Map size={17} />
            </button>
            <button title="Perspective view" onClick={() => view.current?.view(false)}>
              <Box size={17} />
            </button>
            <span />
            <button title="Zoom in" onClick={() => view.current?.zoom(0.8)}>
              <Plus size={18} />
            </button>
            <button title="Zoom out" onClick={() => view.current?.zoom(1.25)}>
              <Minus size={18} />
            </button>
            <button title="Fit world" aria-label="Fit world" onClick={() => view.current?.focus()}>
              <Focus size={17} />
            </button>
          </div>
          <div className="compass">
            <span>N</span>
            <Navigation size={20} fill="currentColor" />
            <small>W　 E</small>
          </div>
          {!driving && (
            <div className="viewport-bottom">
              <span>
                <MousePointer2 size={12} /> Drag to orbit <i /> Scroll to zoom <i /> Double-click
                object to focus
              </span>
              <button
                onClick={() => setDiagnostic(!diagnostic)}
                className={diagnostic ? 'active' : ''}
              >
                <span className="green-dot" />
                Geometry diagnostics <b>{compiled?.diagnostics.length || 0}</b>
              </button>
            </div>
          )}
          {pinMode && (
            <div className="pin-instruction">
              <MapPin size={17} />
              Click the world to place {pinMode.replace('place:', '')}
              <button onClick={() => setPinMode(null)}>
                <X size={15} />
              </button>
            </div>
          )}
          {driving && (
            <>
              <div className="drive-top">
                <button onClick={() => setDriving(false)}>
                  <ArrowLeft size={16} /> Back to editor
                </button>
                <span>
                  <span className="green-dot" /> FREE DRIVE · NO ASSESSMENT
                </span>
              </div>
              <div className="drive-settings">
                <button className={traffic ? 'active' : ''} onClick={() => setTraffic(!traffic)}>
                  <Car size={16} />
                  Ambient traffic
                </button>
                <button
                  className={pedestrians ? 'active' : ''}
                  onClick={() => setPedestrians(!pedestrians)}
                >
                  <Navigation size={16} />
                  Pedestrians
                </button>
                <button onClick={() => setCamera(camera === 'chase' ? 'first' : 'chase')}>
                  <Camera size={16} />
                  {camera === 'chase' ? 'Chase camera' : 'Driver camera'}
                </button>
                <button onClick={() => view.current?.reset()}>
                  <RotateCw size={16} />
                  Reset to spawn
                </button>
              </div>
              <div className="speedometer">
                <span>FREE DRIVE</span>
                <b data-testid="speed">{stats.mph}</b>
                <small>MPH</small>
                <div>
                  <span className="green-dot" />
                  SlayDrive physics
                </div>
              </div>
              <div className="drive-controls">
                <span>
                  <kbd>W</kbd>
                  <kbd>A</kbd>
                  <kbd>S</kbd>
                  <kbd>D</kbd> drive
                </span>
                <span>
                  <kbd>R</kbd> reset
                </span>
                <span>
                  <kbd>C</kbd> camera
                </span>
                <span>Hold brake to reverse</span>
              </div>
              <div className="touch-controls">
                {[
                  ['steer', 1, '←'],
                  ['steer', -1, '→'],
                  ['brake', 1, 'Brake'],
                  ['throttle', 1, 'Drive'],
                ].map(([key, v, label]) => (
                  <button
                    key={label as string}
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId);
                      view.current?.touch(key as any, v as number);
                    }}
                    onPointerUp={() => view.current?.touch(key as any, 0)}
                    onPointerCancel={() => view.current?.touch(key as any, 0)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
          {busy && (
            <div className="progress-card" role="status">
              <div>
                <Loader2 size={17} className="spin" />
                <b>{status}</b>
                <button
                  title="Cancel generation"
                  onClick={() => {
                    generation.current?.abort();
                    job.current.cancel();
                    revisionToken.current++;
                    setBusy(false);
                    setStatus('Cancelled · previous world retained');
                  }}
                >
                  <X size={16} />
                </button>
              </div>
              <div className="progress-track">
                <span style={{ width: progress + '%' }} />
              </div>
              <small>Source topology → surfaces → building geometry</small>
            </div>
          )}
        </section>
        {!driving && (
          <aside className="right-panel">
            <div className="panel-heading">
              <span>Inspector</span>
              <Settings2 size={15} />
            </div>
            {object ? (
              <>
                <div className="selected-summary">
                  <span className="selected-icon">
                    {(() => {
                      const Icon = icons[object.kind];
                      return <Icon size={23} />;
                    })()}
                  </span>
                  <div>
                    <span className="eyebrow">{object.kind.toUpperCase()}</span>
                    <h2>{object.name}</h2>
                  </div>
                </div>
                <div className="inspector-scroll">
                  <section className="inspector-section">
                    <div className="section-title">
                      OBJECT{' '}
                      <div>
                        <button title="Duplicate" aria-label="Duplicate" onClick={duplicate}>
                          <Copy size={13} />
                        </button>
                        <button title="Delete" aria-label="Delete" onClick={remove}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                    <label className="field">
                      Name
                      <input
                        aria-label="Object name"
                        key={object.id + object.name}
                        defaultValue={object.name}
                        onBlur={(e) => {
                          if (e.target.value !== object.name) setProperty('name', e.target.value);
                        }}
                      />
                    </label>
                    <div className="source-chip">
                      <span className="green-dot" />
                      {object.source.provider === 'manual'
                        ? 'Authored object'
                        : object.source.provider === 'overture'
                          ? 'Overture source'
                          : object.source.provider === 'legacy'
                            ? 'SlayDrive source'
                            : 'OpenStreetMap source'}
                      <span>{world?.overrides[object.id] ? 'Edited' : 'Linked'}</span>
                    </div>
                    <small className="source-id">{object.source.id}</small>
                  </section>
                  <section className="inspector-section">
                    <div className="section-title">
                      TRANSFORM <Grid3X3 size={13} />
                    </div>
                    <label className="field">
                      Position <span>m</span>
                    </label>
                    <div className="xyz">
                      {(['x', 'y', 'z'] as const).map((key) => (
                        <label key={key}>
                          <b>{key.toUpperCase()}</b>
                          <input
                            aria-label={'Position ' + key.toUpperCase()}
                            type="number"
                            step={snap ? 1 : 0.1}
                            key={object.id + key + object[key]}
                            defaultValue={object[key].toFixed(2)}
                            onBlur={(e) => {
                              const n = Number(e.target.value);
                              if (Number.isFinite(n) && n !== object[key]) setProperty(key, n);
                            }}
                          />
                        </label>
                      ))}
                    </div>
                    <div className="two-fields">
                      <label className="field">
                        Rotation <span>°</span>
                        <input
                          aria-label="Rotation"
                          type="number"
                          key={object.id + object.rotation}
                          defaultValue={object.rotation.toFixed(1)}
                          onBlur={(e) => setProperty('rotation', Number(e.target.value))}
                        />
                      </label>
                      <label className="field">
                        Scale
                        <input
                          aria-label="Scale"
                          type="number"
                          min="0.1"
                          step="0.1"
                          key={object.id + object.scale}
                          defaultValue={object.scale}
                          onBlur={(e) => {
                            if (+e.target.value > 0) setProperty('scale', +e.target.value);
                          }}
                        />
                      </label>
                    </div>
                  </section>
                  <section className="inspector-section">
                    <div className="section-title">
                      {object.kind === 'road' ? 'ROAD PROPERTIES' : 'APPEARANCE'}
                    </div>
                    {object.kind === 'road' ? (
                      <>
                        <label className="field">
                          Carriageway width <span>m</span>
                          <input
                            aria-label="Carriageway width"
                            type="number"
                            step="0.1"
                            min="1"
                            max="50"
                            key={object.id + object.width}
                            defaultValue={object.width}
                            onBlur={(e) => setProperty('width', Number(e.target.value))}
                          />
                        </label>
                        <label className="field">
                          Direction
                          <select
                            aria-label="Road direction"
                            value={object.oneway || 0}
                            onChange={(e) => setProperty('oneway', +e.target.value)}
                          >
                            <option value="0">Two-way</option>
                            <option value="1">One-way along source</option>
                            <option value="-1">One-way reverse</option>
                          </select>
                        </label>
                        <label className="field">
                          Pavement
                          <select
                            value={object.sidewalk || 'unknown'}
                            onChange={(e) => setProperty('sidewalk', e.target.value)}
                          >
                            <option value="unknown">Estimated envelope</option>
                            <option value="both">Both sides</option>
                            <option value="left">Left only</option>
                            <option value="right">Right only</option>
                            <option value="no">None</option>
                          </select>
                        </label>
                      </>
                    ) : (
                      <>
                        <label className="field">
                          Height <span>m</span>
                          <input
                            aria-label="Height"
                            type="number"
                            min=".1"
                            max="500"
                            key={object.id + object.height}
                            defaultValue={object.height || 1}
                            onBlur={(e) => setProperty('height', +e.target.value)}
                          />
                        </label>
                        {object.kind === 'building' && (
                          <label className="field">
                            Facade finish
                            <div className="swatches">
                              {['#ae7762', '#c4ad8a', '#e3d8c2', '#b5afa2', '#8a7061'].map((c) => (
                                <button
                                  style={{ background: c }}
                                  aria-label={'Facade ' + c}
                                  className={object.color === c ? 'selected' : ''}
                                  onClick={() => setProperty('color', c)}
                                  key={c}
                                />
                              ))}
                            </div>
                          </label>
                        )}
                      </>
                    )}
                    {world && (
                      <ObjectDetails
                        world={world}
                        object={object}
                        onChange={setProperty}
                        onEdit={edit}
                        onCreate={(o) => {
                          edit((w) => w.additions.push(o));
                          setSelected(o.id);
                        }}
                      />
                    )}
                    {(object.points || object.rings) && (
                      <button className="outline-button" onClick={() => setMode('vertices')}>
                        <Box size={14} />
                        Edit {object.points ? 'control points' : 'footprint outline'}
                      </button>
                    )}
                  </section>
                  {mode === 'vertices' && world && (
                    <VertexFields
                      world={world}
                      object={object}
                      onChange={(i, p, r) => edit((w) => setVertex(w, object, i, p, r))}
                    />
                  )}
                  <section className="inspector-section">
                    <div className="section-title">SOURCE CONFIDENCE</div>
                    <div className="confidence-note">
                      <Info size={15} />
                      <p>
                        {object.source.inferred.length
                          ? object.source.inferred.join('. ')
                          : 'Mapped source geometry. Visual details are illustrative.'}
                      </p>
                    </div>
                    {object.shops?.map((s) => (
                      <div className="shop-label" key={s}>
                        {s}
                        <small>Contained shop · facade estimated</small>
                      </div>
                    ))}
                  </section>
                </div>
              </>
            ) : (
              <>
                <div className="world-overview">
                  <div className="overview-icon">
                    <Layers size={25} strokeWidth={1.4} />
                  </div>
                  <span className="eyebrow">WORLD OVERVIEW</span>
                  <h2>
                    A little Cambridge.
                    <br />A lot of possibilities.
                  </h2>
                  <p>Select anything in the world to inspect its geometry, source and details.</p>
                </div>
                <div className="world-metrics">
                  <div>
                    <Route size={16} />
                    <span>Road segments</span>
                    <b>{compiled?.objects.filter((o) => o.kind === 'road').length || '—'}</b>
                  </div>
                  <div>
                    <Building2 size={16} />
                    <span>Building footprints</span>
                    <b>{compiled?.objects.filter((o) => o.kind === 'building').length || '—'}</b>
                  </div>
                  <div>
                    <Trees size={16} />
                    <span>Mapped trees</span>
                    <b>{compiled?.objects.filter((o) => o.kind === 'tree').length || '—'}</b>
                  </div>
                  <div>
                    <Square size={16} />
                    <span>Road surface</span>
                    <b>{compiled ? Math.round(compiled.roadArea).toLocaleString() : '—'} m²</b>
                  </div>
                </div>
                <div className="getting-started">
                  <span className="eyebrow">FROM MAP TO MILE</span>
                  {[
                    [
                      '01',
                      'Explore the neighbourhood',
                      'Orbit, zoom and find your starting point.',
                    ],
                    ['02', 'Make a few adjustments', 'Select objects to shape your world.'],
                    ['03', 'Take it for a drive', 'Test your changes behind the wheel.'],
                  ].map(([n, t, d]) => (
                    <div key={n}>
                      <span>{n}</span>
                      <p>
                        <b>{t}</b>
                        <small>{d}</small>
                      </p>
                    </div>
                  ))}
                </div>
                <button className="help-card" onClick={() => setModal('sources')}>
                  <Info size={16} />
                  <span>
                    <b>Real data, clear provenance</b>
                    <small>See what’s mapped and what’s estimated.</small>
                  </span>
                  <ArrowUpRight size={14} />
                </button>
              </>
            )}
            <div className="diagnostic-footer">
              <button
                onClick={() => {
                  setDiagnostic(!diagnostic);
                  setModal('diagnostics');
                }}
              >
                <AlertTriangle size={15} />
                <span>Source & geometry review</span>
                <b>{compiled?.diagnostics.length || 0}</b>
                <ChevronRight size={13} />
              </button>
            </div>
          </aside>
        )}
      </main>
      <footer className="statusbar">
        <span>
          <span className={busy ? 'amber-dot' : 'green-dot'} />
          {status}
        </span>
        <div>
          <span>
            {compiled ? compiled.elapsedMs.toFixed(0) + ' ms generation' : 'Preparing world'}
          </span>
          <i />
          <button onClick={() => setModal('performance')}>
            {stats.fps} FPS <span className="signal-bars">▂▄▆</span>
          </button>
          <i />
          <span>{world ? 'WGS84 → metres' : 'WGS84'}</span>
          <i />
          <span>
            v0.1 <GitBranch size={11} />
          </span>
        </div>
      </footer>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {toast}
        </div>
      )}
      {error && (
        <div className="error-toast" role="alert">
          <AlertTriangle size={19} />
          <span>{error}</span>
          {retry && <button onClick={() => retry()}>Retry</button>}
          <button aria-label="Dismiss error" onClick={() => setError('')}>
            <X size={16} />
          </button>
        </div>
      )}
      <input
        ref={file}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          if (e.target.files?.[0]) chooseFile(e.target.files[0]);
          e.target.value = '';
        }}
      />
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div
            className={'modal ' + (modal === 'diagnostics' ? 'wide' : '')}
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              aria-label="Close dialog"
              onClick={() => setModal(null)}
            >
              <X size={19} />
            </button>
            <span className="eyebrow">SLAYDRIVE WORLD</span>
            {modal === 'overture' && world ? (
              <OvertureImport
                world={world}
                onImport={(w) => {
                  accept(w);
                  setModal(null);
                }}
              />
            ) : modal === 'cloud' && world ? (
              <CloudWorkspace world={world} onLoad={(w) => accept(w)} />
            ) : modal === 'export' ? (
              <>
                <h2>Keep your world moving.</h2>
                <p>Every export preserves georeferencing, source metadata and authored edits.</p>
                <button className="export-option" onClick={() => exportFile()}>
                  <Download size={23} />
                  <span>
                    <b>World JSON</b>
                    <small>Complete editable world · lossless round trip</small>
                  </span>
                  <ArrowUpRight size={17} />
                </button>
                <button className="export-option" onClick={() => exportFile(true)}>
                  <Car size={23} />
                  <span>
                    <b>SlayDrive track JSON</b>
                    <small>Native road network + full World adapter extension</small>
                  </span>
                  <ArrowUpRight size={17} />
                </button>
                <p className="notice">
                  The existing learner road loader accepts the native network. Full custom scenery
                  needs the World adapter; production has not been changed.
                </p>
                <button className="outline-button" onClick={() => file.current?.click()}>
                  <Upload size={15} /> Import a saved world or track
                </button>
              </>
            ) : modal === 'area' ? (
              <>
                <h2>A world, within reach.</h2>
                <p>Select a UK area up to 2 × 2 km. Smaller areas generate and drive faster.</p>
                <div className="bounds-fields">
                  {['South latitude', 'West longitude', 'North latitude', 'East longitude'].map(
                    (label, i) => (
                      <label className="field" key={label}>
                        {label}
                        <input
                          type="number"
                          step=".001"
                          value={bounds[i]}
                          onChange={(e) =>
                            setBounds(
                              bounds.map((v, j) => (j === i ? +e.target.value : v)) as Bounds,
                            )
                          }
                        />
                      </label>
                    ),
                  )}
                </div>
                <button
                  className="primary"
                  onClick={() => {
                    setModal(null);
                    generate(false);
                  }}
                >
                  Generate this area <Zap size={15} />
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    setBounds(sampleBounds);
                    setModal(null);
                    generate(true);
                  }}
                >
                  Load offline Cambridge instead
                </button>
              </>
            ) : modal === 'revisions' ? (
              <>
                <h2>Every version, kept.</h2>
                <p>
                  Revisions are immutable and local to this browser. Export for backup or transfer.
                </p>
                {historyList.length ? (
                  historyList.map((r) => (
                    <button
                      className="revision"
                      key={r.id}
                      onClick={() => {
                        accept(structuredClone(r.world));
                        setModal(null);
                        announce('Revision restored as editable draft');
                      }}
                    >
                      <Clock size={18} />
                      <span>
                        <b>{r.world.title}</b>
                        <small>
                          {new Date(r.at).toLocaleString()} · {r.author}
                        </small>
                      </span>
                      <ArrowUpRight size={16} />
                    </button>
                  ))
                ) : (
                  <p>No saved revisions yet. Use Save revision to keep your first version.</p>
                )}
              </>
            ) : modal === 'diagnostics' ? (
              <>
                <h2>Inspect before you drive.</h2>
                <p>
                  Geometry errors block simulator export. Source warnings describe missing or
                  estimated data.
                </p>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={diagnostic}
                    onChange={(e) => setDiagnostic(e.target.checked)}
                  />{' '}
                  Show diagnostic overlays in the viewport
                </label>
                <div className="diagnostic-list">
                  {compiled?.diagnostics.length ? (
                    compiled.diagnostics.map((d, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          if (d.objectId) {
                            setSelected(d.objectId);
                            view.current?.focus(d.objectId);
                            setModal(null);
                          }
                        }}
                      >
                        <AlertTriangle size={15} className={d.severity} />
                        <span>
                          <b>{d.code}</b>
                          <small>{d.message}</small>
                        </span>
                        <em>{d.severity}</em>
                      </button>
                    ))
                  ) : (
                    <p>No geometry issues detected.</p>
                  )}
                </div>
              </>
            ) : modal === 'performance' ? (
              <>
                <h2>Measured, in this viewport.</h2>
                <div className="performance-grid">
                  {[
                    ['Frame time', stats.frameMs + ' ms'],
                    ['95th percentile', stats.p95 + ' ms'],
                    ['Draw calls', stats.drawCalls],
                    ['Triangles', stats.triangles?.toLocaleString()],
                    ['Geometries', stats.geometries],
                    ['Pixel ratio', stats.pixelRatio],
                    ['Generation', compiled?.elapsedMs.toFixed(1) + ' ms'],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <small>{k}</small>
                      <b>{v}</b>
                    </div>
                  ))}
                </div>
                <p>
                  {stats.renderer}. These are current-device measurements, not an FPS guarantee.
                  Scenes use a 2 × 2 km maximum area and a 1.5× pixel-ratio cap.
                </p>
              </>
            ) : modal === 'help' ? (
              <>
                <h2>A few useful shortcuts.</h2>
                <div className="shortcut-list">
                  {[
                    ['V', 'Select'],
                    ['G', 'Move'],
                    ['R', 'Rotate / reset during driving'],
                    ['F', 'Focus selection'],
                    ['Ctrl Z', 'Undo'],
                    ['Ctrl Shift Z', 'Redo'],
                    ['Ctrl D', 'Duplicate'],
                    ['Delete', 'Delete selection'],
                    ['Ctrl S', 'Save revision'],
                    ['W A S D', 'Drive; hold S to reverse'],
                    ['C', 'Change driving camera'],
                    ['Esc', 'Return to editor'],
                  ].map(([key, label]) => (
                    <div key={key}>
                      <span>{label}</span>
                      <kbd>{key}</kbd>
                    </div>
                  ))}
                </div>
              </>
            ) : modal === 'sources' ? (
              <>
                <h2>Know your world.</h2>
                <p>{world?.attribution.join('\n')}</p>
                <p>
                  <b>Snapshot:</b> {world?.sourceDate}
                </p>
                <p>
                  WGS84 input uses a reversible local equirectangular projection. World coordinates
                  are metres: X east, Y up, Z south. Elevation is a flat local zero, not a surveyed
                  datum.
                </p>
                <p>
                  Road widths and pavement envelopes may be estimated. Tagged footprints and heights
                  are retained; unknown heights and all decorative details are illustrative. The
                  Cambridge extract lacks relation data, so courtyard and turn-restriction coverage
                  is incomplete.
                </p>
                <p>No Roadarium runtime code, credentials or assets are included.</p>
              </>
            ) : (
              <>
                <h2>Your road-world studio.</h2>
                <p>Build a place. Shape the details. Take the wheel.</p>
                <p>
                  This workspace saves locally and runs offline with the Cambridge example. Free
                  drive uses the original SlayDrive vehicle physics and does not load an assessment
                  engine.
                </p>
                <p>
                  Live geographic providers and shared administrator persistence require a
                  configured Worker. No cloud publication or learner deployment has been performed.
                </p>
                <button className="outline-button" onClick={() => file.current?.click()}>
                  <Upload size={15} /> Import another track
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
