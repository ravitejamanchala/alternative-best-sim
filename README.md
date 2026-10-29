# SlayDrive World

A local-first UK road-world editor and driving workspace. The Cambridge vertical slice is runnable without accounts, keys or live geographic requests. The live-provider and shared-persistence paths are implemented, but require a configured, separately deployed Worker and administrator account. See [delivery status](docs/STATUS.md) for exact coverage and limitations.

## Run

Use Node 24 (validated with 24.19.0) and npm 11. From this repository:

```sh
npm ci
npm run dev
```

Vite serves the editor on port 5173. Load the bundled Cambridge example, select a road or building, edit its properties or control points, then select **Test drive**. Save an immutable revision to this browser, or export a complete World JSON file. Revisions are local to the browser origin; exports are the portable backup.

This cloud task already has an isolated checkout. Use it directly; do not create a Git worktree unless explicitly requested. Cloud onboarding validates servers internally and does not provide a localhost preview link.

```sh
npm test                    # geometry, routes, adapters, security, real SQL migration/store
npm run build               # TypeScript and production frontend
npm run build:adapter       # opt-in learner renderer integration (Three.js is external)
npm run sample              # reproduce both Cambridge JSON exports from the pinned OSM extract
npm run bench               # CPU/memory benchmark -> test-results/benchmark.json
npm run api:check           # Worker bundle, no deployment
npm run test:browser        # requires running dev server + Chromium
npm run test:interaction    # map pins and native drag/drop; dev server
npm run test:physics        # original physics parity, collisions, worker cancellation; dev server
npm run smoke               # offline startup + actual acceleration; running dev server
npm run learner:preview     # read-only local learner integration; see docs/LEARNER-INTEGRATION.md
npm run test:learner         # existing learner UI, native assessment, complete JSON round trip
```

Browser checks default to `/usr/bin/chromium`; set `CHROMIUM_PATH` for another installation. `STUDIO_URL` selects another running editor for the UI suite. Screenshots and machine-readable results go into `test-results/`. Retained delivery evidence is in `docs/evidence/`.

## Controls

- Orbit with the pointer, zoom with the wheel, double-click a hierarchy item to focus.
- Select / move / rotate: V / G / R. F focuses the selection. Transform gizmos, 1 m grid snapping, and numeric fields edit the same world state.
- **Edit control points** exposes draggable handles and numeric X/Z fields. Editing a shared road node also edits every incident road. Footprint holes have their own vertices.
- Ctrl/Cmd Z, Shift Z: undo/redo. Ctrl/Cmd D: duplicate. Delete: remove. Ctrl/Cmd S: save revision. Undo uses a disclosed 64 MiB approximate memory budget; a notice appears when older undo steps are removed. Saved revisions are never trimmed.
- In free drive: W/A/S/D or arrows, hold S after stopping to reverse, R resets to spawn, C switches chase/driver camera, Escape returns to the editor. Touch pedals/steering and standard gamepad axes/triggers use the same input interface.
- Asset library: drag an object onto the world, or click an asset then click its position. Authored signals are static placements, not guessed traffic control. Practice routes use start/destination pins and optional waypoint stops.
- Roads, junction surfaces and lane guides are authorable assets. Road endpoints connect only when explicitly requested; **Connect nearby endpoints** snaps to existing nodes within 5 m. Lane divider paint is explicit, clipped to shared asphalt and withheld in junction conflict areas. Lane control points and junction outlines are independently editable. Junction surfaces extend the asphalt union; centreline widths define the underlying road surface.
- A connected road's inspector can place an explicitly authored stop/give-way line on an incoming approach before its estimated conflict area. Verify the source and setback manually. Zone purpose can cut a mapped/authored pavement gap. These controls never infer a legal priority from road class.
- Building use and roof controls select original terrace/semi-detached, retail/pub, apartment/office and industrial details. Contained shops receive an illustrative frontage on an estimated outer wall; the inspector retains the uncertainty. Source footprints/holes remain authoritative.

## Optional shared workspace

The stack is Hono on Cloudflare Workers, Clerk session verification, Neon Postgres and Drizzle. Every `/api/*` operation, including providers, requires a verified session **and** an enabled entry in `world_admins`. Signing in does not grant that entry.

1. Create an isolated Neon database. Apply `migrations/0001_worlds.sql` using a database owner. Grant the runtime database role only SELECT on `world_admins`, SELECT/INSERT/UPDATE on `worlds`, and SELECT/INSERT on revisions/publications. Add approved Clerk user IDs to `world_admins` as an operator; there is no public endpoint to grant administrator access.
2. Copy `server/worker.env.example` to `.dev.vars` for local Worker development; provide values securely. For a deployed Worker use `wrangler secret put CLERK_SECRET_KEY` and `wrangler secret put DATABASE_URL`. Do not commit `.dev.vars` or put these values in frontend variables.
3. Configure `FRONTEND_URL` to the exact editor origin and the `RATE_LIMITER` binding. Configure `OVERPASS_URL`, and a suitable `NOMINATIM_URL` plus contact identifier for submitted search. A dedicated Nominatim-compatible service is recommended for multi-instance production use: the in-isolate 1.1 s throttle is not a global public-provider quota guarantee.
4. Set `VITE_CLERK_PUBLISHABLE_KEY` and optional `VITE_API_URL` from `.env.example`. The Clerk SDK is only mounted when its public key is configured. Use **Cloud workspace**, sign in, and explicitly verify administrator access before listing/saving cloud worlds.
5. `npm run api:dev` starts the Worker on port 8787. Vite forwards `/api` there. Without credentials `/health` works and protected requests deliberately return 503. No development auth bypass is available.

Cloud saves use expected-head comparisons. Concurrent edits return 409 instead of overwriting another revision. Publication is a separate append-only record referencing one immutable revision; it does not deploy a learner site. Live Clerk/Neon end-to-end validation needs actual credentials and has not been claimed from mocked authentication tests.

## Data and compatibility

See [architecture](docs/ARCHITECTURE.md), [source inspection](docs/REFERENCE-AUDIT.md), [preview deployment plan](docs/PREVIEW.md) and [third-party notices](THIRD_PARTY_NOTICES.md).

The requested GitHub Pages release is configured in `.github/workflows/pages.yml`. See [GitHub Pages deployment](docs/GITHUB-PAGES.md) for the repository-path build, validation and current publication blocker. `npm run build:pages` creates the static Pages artifact; live cloud features need a separate Worker.

`public/samples/cambridge.osm.json` is the attributed OSM extract from the inspected admin repository. `npm run sample` deterministically writes `cambridge.world.json` and `cambridge.slaydrive.json`. The latter includes the exact native SlayDrive network plus the full World extension and compiled surfaces. Native `buildNet` compatibility and complete extension round trips are tested. The [local learner integration](docs/LEARNER-INTEGRATION.md) serves the existing UI through a read-only development overlay and adds World import/export with the shared renderer. Production does not automatically consume World scenes and remains unchanged.

The compiler uses planar source topology and millimetre-quantized polygon offsets/unions. Geographic input is WGS84, world units are metres, X east / Y up / Z south. Elevation datum is explicitly **flat local zero, not surveyed**. Bridges, tunnels and nonzero road layers are withheld until a consistent elevation model exists. Widths and unknown building heights are estimates, labelled separately from source tags and manual overrides. The compiler never invents junction controls, crossings, yellow boxes or legal priorities.

Imports above 20 MiB and more than 20,000 source or authored objects are rejected explicitly. Complete imported/source geometry has an explicit 4 × 4 km envelope limit, including source ways extending beyond query edges. Live requests are limited to a 2 × 2 km area and 16 MiB provider response; no collection is silently truncated. Unsupported conditional/via-way turn restrictions block practice routing rather than permitting an unrestricted fallback. The Cambridge fixture contains no relations: complete restriction/courtyard coverage is not established.

Licensed bounded Overture Polygon/MultiPolygon GeoJSON can fill building gaps through the asset library. Attribution is required, source IDs/part IDs/holes/full properties are preserved, and overlapping existing footprints are excluded. Repeat imports preserve edited/deleted objects. No Overture data is bundled. Mapillary is an optional authenticated Worker reference endpoint; a full embedded imagery viewer is not implemented. Terrain/elevation-aware driving remains disabled.
