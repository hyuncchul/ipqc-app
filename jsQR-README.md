# Vendored QR decoder

`jsQR-1.4.0.js` is the unmodified browser/UMD bundle from the official `jsqr` npm package, pinned to version **1.4.0**. It exposes `window.jsQR` when loaded with a script element and also supports CommonJS for tests.

- Upstream project and API: https://github.com/cozmo/jsQR
- Package source: https://registry.npmjs.org/jsqr/-/jsqr-1.4.0.tgz
- Source file inside package: `package/dist/jsQR.js`
- License: Apache-2.0; the upstream license is preserved in `jsQR-LICENSE.txt`.
- Package integrity: `sha512-dxLob7q65Xg2DvstYkRpkYtmKm2sPJ9oFhrhmudT1dZvNFFTlroai3AWSpLey/w5vMcLBXRgOJsbXpdN9HzU/A==`
- Bundle SHA-256: `bc40c8a15196236b2314db0856f72ca0b49980cd5413b8c852a7349f5fee0859`

The bundle is kept unchanged rather than re-minified so it can be verified against the published package. Scanning is performed locally in the browser; this decoder has no network dependency.
