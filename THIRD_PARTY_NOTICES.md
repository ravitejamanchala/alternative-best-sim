# Third-party and source notices

- **OpenStreetMap contributors**: `public/samples/cambridge.osm.json` is ODbL data retrieved by the existing admin project on 2026-10-21. The timestamp is retained. Attribution: https://www.openstreetmap.org/copyright . The generated Cambridge world and track JSON are derivatives of that data, not an original surveyed map. Building heights and widths can be inferred as documented in each source object. The snapshot has no relations.
- **Original SlayDrive modules**: `src/vendor/slaydrive/*.js` are byte-identical copies of the six files identified in `provenance.json`, reused at the repository owner's request. No application-source licence grant was found; all upstream rights are retained. No claim of MIT licensing for those files is made. Vehicle geometry in `car.js` is procedural; no supplied GLB/OBJ/texture assets were copied.
- **Clipper 6.4.2**, Angus Johnson; JavaScript translation by Timo, with Tom Wu's JSBN portions. Boost Software License 1.0 and the JSBN notices remain in the dependency package and accompanying licence text.
- **polygon-clipping 0.15.7**, MIT. **Three.js 0.128.0**, MIT. **React**, MIT. **Hono**, MIT. **Drizzle ORM**, Apache-2.0. **Clerk SDKs**, MIT. **Neon serverless**, MIT. **Zod**, MIT. **Lucide**, ISC. Their installed package licence texts and build notices govern distribution.
- **DM Sans / Manrope** are self-hosted via Fontsource under SIL Open Font License 1.1. The frontend makes no Google Fonts request.
- No Roadarium proprietary code, cookies, tokens, model files, images or audio are included. Its HAR was reference material only.
- No Overture or Mapillary media is bundled. Overture imports require release/source attribution and a licence supplied with the user's data; Mapillary remains an optional server-side API integration.

This repository is private application work. No new blanket licence for the assembled application is asserted. See `public/licenses/` for the dependency notices copied from the installed packages for distribution.
