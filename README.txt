DocuFrame Responsive Studio v5

Updated:
- Imported and camera photos are automatically saved to IndexedDB on the same device/browser.
- Photos are restored after refresh/reopen and sorted newest → previous.
- Editing changes are saved to local storage as well.
- Deleting photos removes them from local storage.
- Mobile portrait/landscape responsive UI with bottom navigation.
- Camera fullscreen/immersive layout, native still capture when supported, autofocus requests, tap-to-focus, resolution + orientation controls.
- Gallery supports card selection, Select All, Delete Selected, Edit Selected, and batch ZIP export.
- No automatic saved date/time watermark.

Important:
- Photos are stored locally on the device/browser via IndexedDB. They are NOT uploaded to GitHub Pages.
- Data survives normal refreshes and browser restarts for the same site, but can be removed if the user clears site data, resets the browser/device, or the browser evicts storage under storage pressure.
- For camera access, use HTTPS (such as GitHub Pages) or localhost and allow camera permission.
- Browser/device camera APIs determine the maximum native still resolution and exact autofocus behavior.
