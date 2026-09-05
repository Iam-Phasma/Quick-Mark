# Quick Mark

Quick Mark is a fast, desktop-first PDF marking app for clean, repeatable document annotations without clutter.

Open: https://iam-phasma.github.io/Quick-Mark/

## Why Quick Mark

- Speed-first workflow from upload to export.
- Professional, consistent stamp composition with date and e-sign layering.
- Precise visual control with live positioning, sizing, and component ordering.
- Client-side secure redaction export that works on static hosting (GitHub Pages).
- Built for practical, high-volume document handling.

## Core Features

- Drag-and-drop PDF intake.
- Stamp PNG upload.
- E-sign support via upload or in-browser drawing.
- Flexible date formats with optional separators.
- Composer Editor for layer ordering, offsets, and sizing.
- Redaction mode with draw, move, resize, and remove controls.
- Textured redaction rendering retained in export.
- Secure flatten export enabled by default (in-browser, no server required).
- Export keeps the original uploaded PDF filename.

## Redaction and Export Modes

- Export is secure-flatten by default.
- In secure flatten export, every page is rasterized in-browser and all marks/redactions are burned into pixels before rebuilding the final PDF.
- This is designed for static deployments where no backend redaction service is available.

## Usage

1. Upload a PDF.
2. Add stamp, e-sign, and/or date layers as needed.
3. Toggle redaction mode from the toolbar to draw and adjust redaction boxes.
4. Click Export.

## Local Development

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
npm run preview
```

## Known Limitations

- Secure flatten export can increase output PDF size because pages are rasterized.
- Flattened pages reduce text search/select quality in the exported PDF.
- Very large or graphics-heavy PDFs may export slower on lower-end devices.
- Current workflow is optimized for PDF input and PNG stamp/sign assets.

