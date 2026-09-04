const { PDFDocument, rgb, StandardFonts } = window.PDFLib;

export async function exportMarkedPdf({
  state,
  includeDate,
  dateFormat,
  stampSize,
  signSize,
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

  const outDoc = await PDFDocument.load(state.pdfBytes);
  const font = await outDoc.embedFont(StandardFonts.Helvetica);

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

  const stampWPreview = Number(stampSize.value);
  const signWPreview = Number(signSize.value);
  const previewLayerOrder = composerOptions?.layerOrder || ["stamp", "date", "sign"];
  const layerTransforms = composerOptions?.layerTransforms || {};
  const boxWidthPreview = Number(composerOptions?.boxWidth ?? 260);
  const boxHeightPreview = Number(composerOptions?.boxHeight ?? 160);
  const previewPadding = Number(composerOptions?.boxPadding ?? 6);
  const dateText = getTodayText(dateFormat.value);
  const dateFontSizePreview = Number(composerOptions?.dateFontSize ?? 12);
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
      ? {
          width: estimateDateWidth(dateText, dateFontSizePreview) * scale,
          height: (dateFontSizePreview + 6) * scale,
          fontSize: Math.max(9, dateFontSizePreview * scale),
        }
      : null;

    for (const mark of marks) {
      const boxX = mark.x * width + anchorOffsetPreview * scale;
      const boxTop = mark.y * height + anchorOffsetPreview * scale;

      // Keep composer content bounded to the configured box area in export.
      for (const layer of previewLayerOrder) {
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
          const layerBottom = height - (layerTop + dateMetrics.height);
          page.drawText(dateText, {
            x: layerX + 2 * scale,
            y: layerBottom + 2 * scale,
            size: dateMetrics.fontSize,
            font,
            color: rgb(0.05, 0.1, 0.15),
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
  a.download = "quick-mark-output.pdf";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus("Export complete: quick-mark-output.pdf", true);
}

function estimateDateWidth(text, fontSizePx) {
  return text.length * (fontSizePx * 0.58) + 8;
}
