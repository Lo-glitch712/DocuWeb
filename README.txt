DocuFrame Responsive Studio v3

Updated:
- Mobile-first responsive UI for portrait and landscape.
- Mobile quick-action navigation keeps Import, Gallery, Camera, Template and Info visible.
- Camera uses the native still-photo pipeline when Native/Highest is selected (ImageCapture.takePhoto when supported), reducing blur versus saving a video frame.
- Continuous autofocus is requested when the browser/device exposes focusMode.
- Tap-to-focus remains available where the browser exposes focus controls.
- Camera resolution + orientation selectors retained.
- Native mode preserves the camera still capture dimensions; selected output modes render at the selected resolution.
- Gallery is mobile responsive and scroll-safe.

Best camera support: use HTTPS (e.g. GitHub Pages) or localhost and allow camera permission.
Note: autofocus/focus-point controls are limited by the browser/device camera APIs.
