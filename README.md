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

## Google Drive

**Save to Drive** works out of the box: a web OAuth client ID is preset in `public/drive.js`. Web
client IDs are public by design — the browser must send one to Google, and Google only accepts it
from origins listed on the client. No client secret is used or stored.

Uploads land in a `DocuFrame` folder. The app requests only the `drive.file` scope, so it can only
touch files DocuFrame itself creates.

Whenever the app is served from a new origin, add that origin to **Authorized JavaScript origins**
on the OAuth client (for local dev, `http://127.0.0.1:43127`). Otherwise Google blocks sign-in.

### Using your own Google project instead

1. Open [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials).
2. Enable the **Google Drive API** for the project.
3. Create an **OAuth client ID** of type **Web application**.
4. Add your app origin to **Authorized JavaScript origins**.
5. In DocuFrame, open **Save to Drive**, paste the Client ID, and save. It is kept in `localStorage`
   on that device and overrides the preset. **Use preset** reverts it.

## Notes

- Camera access needs HTTPS or localhost and permission.
- Clearing site data removes saved photos and templates.
- Production build: `npm run build` then `npm run preview`.
