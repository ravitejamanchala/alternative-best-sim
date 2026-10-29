# GitHub Pages deployment

The user requested GitHub Pages on 29 October 2026. The target is the separate `ravitejamanchala/slaydrive-world` repository, publishing source from `development/world`. Existing learner/admin deployments and DNS remain unchanged.

The configured project path is `/slaydrive-world/`. `.github/workflows/pages.yml` builds on pushes to `development/world` or a manual workflow dispatch, runs the automated tests and a real Chromium check under that path, uploads only `dist`, and deploys through the official Pages artifact workflow. Deployment uses the `github-pages` environment and reports GitHub's actual URL. The browser check verifies static assets/worker, Cambridge regeneration, actual driving and complete JSON export.

Local validation:

```sh
npm run build:pages
npm run preview:pages
# From another terminal:
npm run test:pages
```

`build:pages` sets Vite's base path; sample fetches use `import.meta.env.BASE_URL`. The usual `npm run build` remains a root-path build. No Clerk or Worker secrets belong in Pages artifacts. The initial static release supports the offline Cambridge editor, driving, local revisions and import/export. Live geographic providers and shared cloud persistence require the separately configured Worker described in README.md.

Remote publication remains blocked in the current cloud runtime: native Git discovery reports Repository not found, and the GitHub API returns `Forbidden`. The saved environment draft requests unrestricted access, while the running instance still enforces its prior restricted policy. Review/save the environment configuration and publish it to apply the desired policy; then retry remote discovery before creating anything.

Once access works, inspect whether the target repository exists and preserve any existing refs. Create the new repository if absent, connect its HTTPS origin, and push `development/world` without force. Enable the repository's Pages build type **GitHub Actions** (`build_type: workflow` through the Pages API), then watch `pages.yml` to completion. If the first run preceded Pages enablement, rerun that failed workflow. For a new repository, its initial branch can remain `development/world`; no learner main-branch push is needed. Do not change an existing repository's visibility or Pages configuration without inspecting it first.

Only report the site as live after the deployment succeeds and the returned URL serves the application, worker, fonts and sample JSON. Saving configuration, committing the workflow and passing the local path check do not establish a remote deployment.
