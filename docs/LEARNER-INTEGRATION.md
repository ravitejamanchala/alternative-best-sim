# Local learner development integration

The adapter is tested inside the actual learner UI at commit `912e5e667c3ad991484c54d92cf056767a7f97d2`. The reference checkout stays unchanged. `scripts/learner-preview.ts` serves it from a loopback-only development server and inserts `integrations/learner-hook.js` into the existing boot scope in memory. It serves the matching local Three.js dependency and the World adapter bundle. It replaces account configuration with an empty local configuration and removes remote font links; no production account, database or deployment is used.

From the World repository:

```sh
npm run build:adapter
LEARNER_ROOT=/workspace/reference-simulator npm run learner:preview
```

In a second session, run `npm run test:learner`. The overlay uses port 5175; `LEARNER_PORT` selects another port and `LEARNER_URL` selects it for the browser test. `CHROMIUM_PATH` selects Chromium. The reference repository must already exist; no automatic clone or mutation occurs. For another machine, check out the inspected learner commit into a separate reference directory and set `LEARNER_ROOT` to that path.

The **Import World track** file input accepts a complete World or SlayDrive-World JSON export. It validates the world and learner route before replacing the current scene, passes the decoded network to the original `createTraffic` and `createTest`, and uses the World compiler/renderer through `loadWorldTrack` and `createLearnerView`. **Export World** re-exports the complete World envelope, including exact geometry, authored overrides and original metadata. The existing native-area path is retained.

The automated browser check imports Cambridge plus authored metadata through that actual file input, asserts native edge counts, invokes the original examiner's fault API and verifies that a serious fault still causes a failed assessment, downloads the export, reloads the browser, reimports and re-exports, and compares the full JSON. It records overhead/driver screenshots and page errors. This complements the unchanged learner's assessment/drivetrain tests. World editor free drive remains a separate entry point that never creates the examiner.

This overlay is an integration preview. It does not publish an official lesson, add learner-profile results or deploy the learner. Imported Worlds do not yet translate every authored signal, assessment zone or marking into native assessment rules; their complete metadata is retained for explicit integration. The native traffic/assessment road-boundary model still uses the learner's centreline geometry; exact World building collisions are provided by World free drive. Static signals have no invented phases. Existing learner course flows continue through their original source.

Before any reviewed learner release, replace the temporary boot-scope hook with a normal source integration on a learner development branch, exercise the real course/profile UI and decide which authored assessment metadata should become native rules. The original main branch, deployment workflows and DNS are not changed by this preview.
