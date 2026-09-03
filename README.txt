DOCUFRAME — RESOLUTION + EXPORT FIX

This build fixes the blank export problem by rendering the selected photo and overlay
directly into a fresh output canvas before creating the JPG blob.

Resolution choices:
- 940 × 788
- 1280 × 1073
- 1920 × 1609
- Original photo resolution
- Custom width × height

The preview remains 940 × 788, while export uses the selected output size.

For camera permissions, serve the folder with:
python -m http.server 8000
Then open http://localhost:8000


WATERMARK UPDATE:
The automatic Saved Date/Time watermark has been completely removed. Project and Custom text remain optional.
