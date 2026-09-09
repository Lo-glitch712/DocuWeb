/* Google Drive upload for DocuFrame.
   Uses Google Identity Services for OAuth and the Drive v3 multipart upload
   endpoint. The drive.file scope only grants access to files this app creates,
   so no broad Drive permission is requested. */
(function () {
  const GIS_SRC = 'https://accounts.google.com/gsi/client';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const CLIENT_ID_KEY = 'docuframe_drive_client_id';
  const FOLDER_ID_KEY = 'docuframe_drive_folder_id';
  const FOLDER_NAME = 'DocuFrame';

  let gisPromise = null;
  let tokenClient = null;
  let accessToken = null;
  let tokenExpiresAt = 0;

  function getClientId() {
    try {
      return localStorage.getItem(CLIENT_ID_KEY) || '';
    } catch (e) {
      return '';
    }
  }

  function setClientId(id) {
    try {
      const trimmed = (id || '').trim();
      if (trimmed) localStorage.setItem(CLIENT_ID_KEY, trimmed);
      else localStorage.removeItem(CLIENT_ID_KEY);
    } catch (e) { /* storage blocked */ }
    tokenClient = null;
    accessToken = null;
    tokenExpiresAt = 0;
  }

  function isConfigured() {
    return Boolean(getClientId());
  }

  function loadGis() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    if (gisPromise) return gisPromise;
    gisPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${GIS_SRC}"]`);
      if (existing) {
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error('Could not load Google sign-in')));
        return;
      }
      const s = document.createElement('script');
      s.src = GIS_SRC;
      s.async = true;
      s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Could not load Google sign-in. Check your connection.'));
      document.head.appendChild(s);
    });
    return gisPromise;
  }

  async function getToken({ interactive = true } = {}) {
    if (accessToken && Date.now() < tokenExpiresAt - 60000) return accessToken;
    const clientId = getClientId();
    if (!clientId) throw new Error('Add your Google OAuth Client ID first');
    await loadGis();
    return new Promise((resolve, reject) => {
      if (!tokenClient) {
        tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: SCOPE,
          callback: response => {
            if (response.error) {
              reject(new Error(response.error_description || 'Google sign-in was cancelled'));
              return;
            }
            accessToken = response.access_token;
            tokenExpiresAt = Date.now() + (Number(response.expires_in || 3600) * 1000);
            resolve(accessToken);
          },
          error_callback: err => {
            reject(new Error(err?.type === 'popup_closed'
              ? 'Google sign-in window was closed'
              : 'Google sign-in failed'));
          },
        });
      } else {
        tokenClient.callback = response => {
          if (response.error) {
            reject(new Error(response.error_description || 'Google sign-in was cancelled'));
            return;
          }
          accessToken = response.access_token;
          tokenExpiresAt = Date.now() + (Number(response.expires_in || 3600) * 1000);
          resolve(accessToken);
        };
      }
      tokenClient.requestAccessToken({ prompt: interactive ? '' : 'none' });
    });
  }

  async function driveFetch(url, options, token) {
    const res = await fetch(url, {
      ...options,
      headers: { ...(options?.headers || {}), Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 || res.status === 403) {
      accessToken = null;
      tokenExpiresAt = 0;
    }
    if (!res.ok) {
      let detail = '';
      try {
        const body = await res.json();
        detail = body?.error?.message || '';
      } catch (e) { /* non-JSON error */ }
      throw new Error(detail || `Drive request failed (${res.status})`);
    }
    return res.json();
  }

  async function ensureFolder(token) {
    let cached = null;
    try {
      cached = localStorage.getItem(FOLDER_ID_KEY);
    } catch (e) { /* storage blocked */ }
    if (cached) {
      try {
        const meta = await driveFetch(
          `https://www.googleapis.com/drive/v3/files/${cached}?fields=id,trashed`,
          { method: 'GET' },
          token,
        );
        if (meta.id && !meta.trashed) return meta.id;
      } catch (e) { /* recreate below */ }
    }
    const query = encodeURIComponent(
      `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    );
    const found = await driveFetch(
      `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)&pageSize=1`,
      { method: 'GET' },
      token,
    );
    let id = found.files?.[0]?.id;
    if (!id) {
      const created = await driveFetch(
        'https://www.googleapis.com/drive/v3/files?fields=id',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
        },
        token,
      );
      id = created.id;
    }
    try {
      if (id) localStorage.setItem(FOLDER_ID_KEY, id);
    } catch (e) { /* storage blocked */ }
    return id;
  }

  async function uploadOne({ blob, name, folderId, token }) {
    const boundary = `docuframe${Math.random().toString(36).slice(2)}`;
    const metadata = { name, mimeType: blob.type || 'image/jpeg' };
    if (folderId) metadata.parents = [folderId];
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify(metadata),
      `\r\n--${boundary}\r\nContent-Type: ${metadata.mimeType}\r\n\r\n`,
      blob,
      `\r\n--${boundary}--\r\n`,
    ]);
    return driveFetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
      {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      },
      token,
    );
  }

  /* files: [{ blob, name }] — resolves with uploaded Drive file metadata. */
  async function upload(files, onProgress) {
    if (!files?.length) throw new Error('Nothing to upload');
    const token = await getToken();
    const folderId = await ensureFolder(token);
    const uploaded = [];
    for (let i = 0; i < files.length; i++) {
      onProgress?.(i, files.length);
      uploaded.push(await uploadOne({ ...files[i], folderId, token }));
    }
    onProgress?.(files.length, files.length);
    return { uploaded, folderId };
  }

  function signOut() {
    if (accessToken && window.google?.accounts?.oauth2?.revoke) {
      try { window.google.accounts.oauth2.revoke(accessToken); } catch (e) { /* ignore */ }
    }
    accessToken = null;
    tokenExpiresAt = 0;
  }

  window.DocuDrive = {
    folderName: FOLDER_NAME,
    getClientId,
    setClientId,
    isConfigured,
    upload,
    signOut,
  };
})();
