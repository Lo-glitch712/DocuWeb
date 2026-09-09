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
- Gallery select, delete, and edit
- Batch export with a choice of local ZIP download or Google Drive upload
- Local persistence via IndexedDB (same browser/device)

## Google Drive

Press **Batch export** and pick **Save to Google Drive**. It works out of the box: a web OAuth
client ID is preset in `public/drive.js`. Web
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

## Deploy to Vercel

`vercel.json` already sets the build command (`npm run build`), output directory (`dist`), and the
`camera=(self)` permissions policy the capture flow needs. Vercel also detects Vite automatically.

Either import the repository in the [Vercel dashboard](https://vercel.com/new) and accept the
detected settings, or deploy from a local checkout:

```bash
npm i -g vercel
vercel          # first run links the project and creates a preview
vercel --prod   # promote to production
```

After the first deploy, add the deployment origin (for example `https://your-app.vercel.app`) to
**Authorized JavaScript origins** on the Google OAuth client, or Drive sign-in will be blocked.
Vercel preview deployments get a new URL per deploy, so use the stable production domain for Drive.

## Notes

- Camera access needs HTTPS or localhost and permission.
- Clearing site data removes saved photos and templates.
- Production build: `npm run build` then `npm run preview`.
