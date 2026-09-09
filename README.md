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
- Live camera capture with multi-shot bursts (1–10), session previews, and per-shot removal
- Transparent overlay template on live preview and exports
- Photo settings drawer: framing, exposure, and export labels
- Gallery select, delete, edit, and batch ZIP download
- Save composed JPGs to Google Drive
- Local persistence via IndexedDB (same browser/device)

## Google Drive setup

Drive upload uses your own OAuth client, so no secret is stored in the repo:

1. Open [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials).
2. Enable the **Google Drive API** for the project.
3. Create an **OAuth client ID** of type **Web application**.
4. Add your app origin (for local dev, `http://127.0.0.1:43127`) to **Authorized JavaScript origins**.
5. In DocuFrame, click **Save to Drive** and paste the Client ID. It is stored in `localStorage` on that device only.

Uploads land in a `DocuFrame` folder. The app requests only the `drive.file` scope, which limits access to files DocuFrame itself creates.

## Notes

- Camera access needs HTTPS or localhost and permission.
- Clearing site data removes saved photos and templates.
- Production build: `npm run build` then `npm run preview`.
