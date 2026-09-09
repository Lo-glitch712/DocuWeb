# DocuFrame

Field documentation photo studio. Import or capture photos, apply a transparent overlay template, adjust framing, and export JPG or batch ZIP files. Photos stay on the device in IndexedDB.

## Run locally

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:43127](http://127.0.0.1:43127).

## Features

- Import PNG, JPG, WebP, HEIC/HEIF (browser support varies)
- Live camera capture with shutter flash, multi-shot bursts (1–10), and in-camera photo previews
- Transparent overlay template on live preview and exports
- Zoom, pan, rotate, brightness, and contrast per photo
- Project/caption overlays on export
- Gallery select, delete, edit, and batch ZIP download
- Local persistence via IndexedDB (same browser/device)

## Notes

- Camera access needs HTTPS or localhost and permission.
- Clearing site data removes saved photos and templates.
- Production build: `npm run build` then `npm run preview`.
