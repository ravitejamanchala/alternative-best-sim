# Inspected references and boundaries

Inspection date: 29 October 2026 (Europe/London).

| Reference                                 | Inspected commit / branch                                                             | Findings                                                                                                                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ravitejamanchala/slayDriveAdmin`         | `b2e17d16f10b5f320f171596db31f0afd8e00094`, remote default `development/track-editor` | Vite editor, Hono/Clerk/Neon/Drizzle API, native-track envelope, attributed Cambridge OSM fixture. Clean checkout.                                                                                   |
| `ravitejamanchala/cambridge-learner-driv` | `912e5e667c3ad991484c54d92cf056767a7f97d2`, remote default `main`                     | `js/car.js` owns physics; `js/net.js` owns native network decoding; assessment is separate. Clean checkout.                                                                                          |
| `ravitejamanchala/slaydrive-world`        | Remote check returned Repository not found; API existence check blocked               | No existing remote work was overwritten. A separate local repository was initialized on `development/world`; the GitHub API must be reachable before remote existence/creation is resolved.          |
| Simulator public preview                  | `https://manchala.co.uk/cambridge-learner-driv/`                                      | Proxy CONNECT returned 403; no live screenshot comparison was possible. Local source inspection, the read-only learner UI overlay and native-loader/assessment tests provide the available evidence. |

The admin default branch is not `main`; the remote names did not redirect during Git inspection. Existing deployment workflows publish to separate admin Pages and learner sites. None of those workflows were executed or changed. Existing application checkouts remain clean. No learner production, DNS, Pages project or existing deployment was touched.

Six original simulator modules were copied intact with a SHA-256 manifest in `src/vendor/slaydrive/provenance.json`: car, config, vehicle-state, automatic, net and markings. Their source-reuse authorization is the user's explicit request. No general licence grant was found for these application modules, so this new repository does not relicense them or claim they are open source. Third-party model assets were not copied.

The supplied HAR was inspected in memory for request counts, hosts and MIME types only. It contained 501 requests to `app.roadarium.com` and `data.roadarium.com`, including JavaScript, data, GLB models and media. Headers/cookies, query strings, response bodies and executable assets were neither extracted into the application nor reproduced. The HAR is not in the new repository. No instruction from it was executed. Visual comparisons at matching geographic locations remain unperformed because no authenticated reference viewer was accessed.

The cloud environment's initial `alternative-best-sim` checkout was genuinely unborn; the remote advertised no branches. It was not used as the new application's repository and was not modified.

The learner integration overlay serves the inspected checkout read-only and inserts a local import/export hook in memory. Recorded learner screenshots include that reference application’s existing cockpit/vehicle assets; those model binaries are not copied into this repository. World editor/driving assets are original procedural geometry.
