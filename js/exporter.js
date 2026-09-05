import { resolveToneRgb, resolveDatePdfFontName } from "./styleTokens.js";

let pdfLibPromise = null;

async function getPdfLib() {
  if (!pdfLibPromise) {
    pdfLibPromise = import("https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm");
  }
  return pdfLibPromise;
}

export async function exportMarkedPdf({
  state,
  includeDate,
  includeSeparator,
  dateFormat,
  pdfCanvas,
  getTodayText,
  totalPlacementCount,
  setStatus,
  composerOptions,
}) {
  if (!state.pdfBytes) {
    setStatus("Upload a PDF before export.");
    return;
  }

  if (totalPlacementCount(state) === 0) {
    setStatus("Place at least one mark by clicking on PDF.");
    return;
  }

  const { PDFDocument, rgb, StandardFonts } = await getPdfLib();

  const outDoc = await PDFDocument.load(state.pdfBytes);
  const dateFontName = resolveDatePdfFontName(composerOptions?.dateFontKey);
  const selectedDateFont = StandardFonts[dateFontName] || StandardFonts.Helvetica;
  const font = await outDoc.embedFont(selectedDateFont);

  let stampImage = null;
  if (state.stampDataUrl) {
    const bytes = await fetch(state.stampDataUrl).then((r) => r.arrayBuffer());
    stampImage = await outDoc.embedPng(bytes);
  }

  let signImage = null;
  if (state.signDataUrl) {
    const bytes = await fetch(state.signDataUrl).then((r) => r.arrayBuffer());
    signImage = await outDoc.embedPng(bytes);
  }

  const stampWPreview = Number(composerOptions?.stampWidth ?? 140);
  const signWPreview = Number(composerOptions?.signWidth ?? 180);
  const previewLayerOrder = composerOptions?.layerOrder || ["sign", "date", "stamp"];
  const layerTransforms = composerOptions?.layerTransforms || {};
  const boxWidthPreview = Number(composerOptions?.boxWidth ?? 260);
  const boxHeightPreview = Number(composerOptions?.boxHeight ?? 160);
  const previewPadding = Number(composerOptions?.boxPadding ?? 6);
  const dateText = getTodayText(dateFormat.value, includeSeparator.checked);
  const dateFontSizePreview = Number(composerOptions?.dateFontSize ?? 12);
  const dateColor = resolveToneRgb(
    composerOptions?.dateTone || "black",
    composerOptions?.dateSaturation ?? 100,
  );
  const anchorOffsetPreview = 0;

  for (const [pageNumber, marks] of state.placementsByPage.entries()) {
    const page = outDoc.getPage(pageNumber - 1);
    const { width, height } = page.getSize();
    const scale = width / pdfCanvas.width;
    const boxWidth = boxWidthPreview * scale;
    const boxHeight = boxHeightPreview * scale;
    const padding = previewPadding * scale;
    const contentHeight = Math.max(0, boxHeight - padding * 2);
    const contentWidth = Math.max(0, boxWidth - padding * 2);

    const stampMetrics = stampImage
      ? {
          width: stampWPreview * scale,
          height: stampWPreview * scale * (stampImage.height / stampImage.width),
        }
      : null;

    const signMetrics = signImage
      ? {
          width: signWPreview * scale,
          height: signWPreview * scale * (signImage.height / signImage.width),
        }
      : null;

    const dateMetrics = includeDate.checked
      ? createDateMetrics({
          text: dateText,
          font,
          fontSize: Math.max(9, dateFontSizePreview * scale),
        })
      : null;

    for (const mark of marks) {
      const boxX = mark.x * width + anchorOffsetPreview * scale;
      const boxTop = mark.y * height + anchorOffsetPreview * scale;

      // Keep composer content bounded to the configured box area in export.
      // Stack semantics: first item in layerOrder is frontmost, so draw in reverse.
      for (const layer of [...previewLayerOrder].reverse()) {
        const offset = layerTransforms[layer] || { x: 0, y: 0 };
        const metrics =
          layer === "stamp"
            ? stampMetrics
            : layer === "sign"
              ? signMetrics
              : layer === "date"
                ? dateMetrics
                : null;

        if (!metrics) {
          continue;
        }

        const centerX = boxX + padding + contentWidth / 2;
        const centerY = boxTop + padding + contentHeight / 2;
        const layerX = centerX + offset.x * scale - metrics.width / 2;
        const layerTop = centerY + offset.y * scale - metrics.height / 2;

        if (layer === "stamp" && stampImage && stampMetrics) {
          if (layerX > boxX + boxWidth || layerTop > boxTop + boxHeight) {
            continue;
          }
          const layerBottom = height - (layerTop + stampMetrics.height);
          page.drawImage(stampImage, {
            x: layerX,
            y: layerBottom,
            width: stampMetrics.width,
            height: stampMetrics.height,
          });
        }

        if (layer === "sign" && signImage && signMetrics) {
          if (layerX > boxX + boxWidth || layerTop > boxTop + boxHeight) {
            continue;
          }
          const layerBottom = height - (layerTop + signMetrics.height);
          page.drawImage(signImage, {
            x: layerX,
            y: layerBottom,
            width: signMetrics.width,
            height: signMetrics.height,
          });
        }

        if (layer === "date" && dateMetrics) {
          if (layerX > boxX + boxWidth || layerTop > boxTop + boxHeight) {
            continue;
          }
          const baselineY = height - layerTop - dateMetrics.ascent;
          page.drawText(dateText, {
            x: layerX + 2 * scale,
            y: baselineY,
            size: dateMetrics.fontSize,
            font,
            color: rgb(dateColor.r, dateColor.g, dateColor.b),
          });
        }
      }
    }
  }

  const outBytes = await outDoc.save();
  const blob = new Blob([outBytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "quickmark-output.pdf";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus("Export complete: quickmark-output.pdf", true);
}

function createDateMetrics({ text, font, fontSize }) {
  const safeSize = Math.max(1, Number(fontSize) || 12);
  const width = font.widthOfTextAtSize(text, safeSize);
  const fullHeight = font.heightAtSize(safeSize);
  const ascent = font.heightAtSize(safeSize, { descender: false });

  return {
    width,
    height: fullHeight,
    ascent,
    fontSize: safeSize,
  };
}
