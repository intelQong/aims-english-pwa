# AIMS English PWA

This repository contains a production-ready static PWA in `aims-final/` and a simple local build workflow.

## Build

```bash
npm run build
```

This copies the PWA into `dist/`.

## Validate PWA output

```bash
npm run check:pwa
```

This verifies required files exist and confirms that `index.html` includes a manifest link and service worker registration.

## Preview locally

```bash
npm run preview
```

Then open `http://localhost:4173`.
