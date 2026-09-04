# Quick-Mark

Simple client-side PDF stamping tool for government-use workflows.

## What It Does

- Upload or drag-and-drop a PDF.
- Upload a stamp PNG.
- Upload an e-sign PNG or draw an e-sign directly in the browser.
- Auto-include current date.
- Click on the PDF page to place your mark.
- Export a new marked PDF locally.

No backend required. All processing runs in the browser.

## Run

1. Open this folder in VS Code.
2. Open [index.html](index.html) in a browser.
3. Use the left panel to upload stamp/e-sign/date options.
4. Click on the PDF preview to place marks.
5. Click Export Marked PDF.

## Notes

- This tool uses CDN versions of PDF.js and PDF-Lib.
- Both libraries are lazy-loaded at runtime: PDF.js loads on first PDF open, and PDF-Lib loads on export.
- A service worker caches app files and CDN modules for faster repeat loads.
- Service worker caching works when served via `http://localhost` or HTTPS (not `file://`).
- Output file name: quick-mark-output.pdf.