import { resolveToneRgb, resolveDatePdfFontName } from "./styleTokens.js";

let pdfLibPromise = null;
let pdfjsLibPromise = null;

async function getPdfLib() {
  if (!pdfLibPromise) {
    pdfLibPromise = import("https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm");
  }
  return pdfLibPromise;
}

async function getPdfJs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise =
      import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.min.mjs").then(
        (module) => {
          module.GlobalWorkerOptions.workerSrc =
            "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.worker.min.mjs";
          return module;
        },
      );
  }
  return pdfjsLibPromise;
}

export async function exportMarkedPdf({
  state,
  includeDate,
  includeSeparator,
  dateFormat,
  secureFlattenExport = true,
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

  const exportFileName = resolveExportFileName(state.pdfFileName);

  if (secureFlattenExport) {
    await exportFlattenedPdf({
      state,
      includeDate,
      includeSeparator,
      dateFormat,
      pdfCanvas,
      getTodayText,
      setStatus,
      composerOptions,
      exportFileName,
    });
    return;
  }

  const { PDFDocument, rgb, StandardFonts } = await getPdfLib();

  const outDoc = await PDFDocument.load(state.pdfBytes);
  const dateFontName = resolveDatePdfFontName(
    composerOptions?.dateFontKey,
    composerOptions?.dateFontWeight,
  );
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

  for (const [pageNumber, redactions] of state.redactionsByPage.entries()) {
    if (!Array.isArray(redactions) || redactions.length === 0) {
      continue;
    }

    const page = outDoc.getPage(pageNumber - 1);
    const { width, height } = page.getSize();

    redactions.forEach((item) => {
      const x = item.x * width;
      const yTop = item.y * height;
      const boxWidth = item.w * width;
      const boxHeight = item.h * height;
      const y = height - yTop - boxHeight;

      if (boxWidth <= 0 || boxHeight <= 0) {
        return;
      }

      drawStripedRedaction(page, {
        x,
        y,
        width: boxWidth,
        height: boxHeight,
      }, rgb);
    });
  }

  const outBytes = await outDoc.save();
  const blob = new Blob([outBytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = exportFileName;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus(`Export complete: ${exportFileName}`, true);
}

async function exportFlattenedPdf({
  state,
  includeDate,
  includeSeparator,
  dateFormat,
  pdfCanvas,
  getTodayText,
  setStatus,
  composerOptions,
  exportFileName,
}) {
  const { PDFDocument } = await getPdfLib();
  const sourceDoc = state.pdfDoc || (await openPdfDocumentFromBytes(state.pdfBytes));
  const outDoc = await PDFDocument.create();

  const stampImage = state.stampDataUrl ? await loadImage(state.stampDataUrl) : null;
  const signImage = state.signDataUrl ? await loadImage(state.signDataUrl) : null;

  const dateText = getTodayText(dateFormat.value, includeSeparator.checked);
  const sourceWidthRef = Math.max(1, Number(pdfCanvas?.width) || 1);
  const renderScale = 2;

  for (let pageNumber = 1; pageNumber <= sourceDoc.numPages; pageNumber += 1) {
    const page = await sourceDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: renderScale });
    const outputViewport = page.getViewport({ scale: 1 });

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Could not initialize flatten export canvas.");
    }

    await page.render({ canvasContext: ctx, viewport }).promise;

    drawMarksOnCanvas({
      ctx,
      canvas,
      marks: state.placementsByPage.get(pageNumber) || [],
      includeDate: includeDate.checked,
      dateText,
      stampImage,
      signImage,
      composerOptions,
      sourceWidthRef,
    });

    drawRedactionsOnCanvas({
      ctx,
      canvas,
      redactions: state.redactionsByPage.get(pageNumber) || [],
    });

    const pngBytes = await canvasToPngBytes(canvas);
    const pageImage = await outDoc.embedPng(pngBytes);
    const outPage = outDoc.addPage([outputViewport.width, outputViewport.height]);

    outPage.drawImage(pageImage, {
      x: 0,
      y: 0,
      width: outputViewport.width,
      height: outputViewport.height,
    });
  }

  const outBytes = await outDoc.save();
  const blob = new Blob([outBytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = exportFileName;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus(`Secure export complete: ${exportFileName}`, true);
}

function resolveExportFileName(sourceName) {
  if (typeof sourceName !== "string") {
    return "quickmark-output.pdf";
  }

  const trimmed = sourceName.trim();
  if (!trimmed) {
    return "quickmark-output.pdf";
  }

  const basename = trimmed.split(/[\\/]/).pop() || "quickmark-output.pdf";
  const safe = basename.replace(/[\u0000-\u001f\u007f]+/g, "").trim();

  if (!safe) {
    return "quickmark-output.pdf";
  }

  return /\.pdf$/i.test(safe) ? safe : `${safe}.pdf`;
}

function drawMarksOnCanvas({
  ctx,
  canvas,
  marks,
  includeDate,
  dateText,
  stampImage,
  signImage,
  composerOptions,
  sourceWidthRef,
}) {
  if (!Array.isArray(marks) || marks.length === 0) {
    return;
  }

  const boxWidthPreview = Number(composerOptions?.boxWidth ?? 260);
  const boxHeightPreview = Number(composerOptions?.boxHeight ?? 160);
  const previewPadding = Number(composerOptions?.boxPadding ?? 6);
  const layerOrder = composerOptions?.layerOrder || ["sign", "date", "stamp"];
  const layerTransforms = composerOptions?.layerTransforms || {};

  const scale = canvas.width / sourceWidthRef;
  const boxWidth = boxWidthPreview * scale;
  const boxHeight = boxHeightPreview * scale;
  const padding = previewPadding * scale;
  const contentWidth = Math.max(0, boxWidth - padding * 2);
  const contentHeight = Math.max(0, boxHeight - padding * 2);

  const stampWidth = Number(composerOptions?.stampWidth ?? 140) * scale;
  const signWidth = Number(composerOptions?.signWidth ?? 180) * scale;
  const stampAspect = Math.max(0.05, Number(composerOptions?.stampAspect) || 1);
  const signAspect = Math.max(0.05, Number(composerOptions?.signAspect) || 0.38);
  const dateFontSize = Math.max(9, Number(composerOptions?.dateFontSize ?? 12) * scale);
  const dateFontFamily = composerOptions?.dateFontFamily || '"Helvetica Neue", Helvetica, Arial, sans-serif';
  const dateFontWeight = String(composerOptions?.dateFontWeight || "500");
  const dateColor = composerOptions?.dateColor || "#0f2233";

  marks.forEach((mark) => {
    const boxX = mark.x * canvas.width;
    const boxY = mark.y * canvas.height;
    const centerX = boxX + padding + contentWidth / 2;
    const centerY = boxY + padding + contentHeight / 2;

    for (const layer of [...layerOrder].reverse()) {
      const offset = layerTransforms[layer] || { x: 0, y: 0 };
      const layerCenterX = centerX + (Number(offset.x) || 0) * scale;
      const layerCenterY = centerY + (Number(offset.y) || 0) * scale;

      if (layer === "stamp" && stampImage) {
        const width = stampWidth;
        const height = stampWidth * stampAspect;
        ctx.drawImage(
          stampImage,
          layerCenterX - width / 2,
          layerCenterY - height / 2,
          width,
          height,
        );
      }

      if (layer === "sign" && signImage) {
        const width = signWidth;
        const height = signWidth * signAspect;
        ctx.drawImage(
          signImage,
          layerCenterX - width / 2,
          layerCenterY - height / 2,
          width,
          height,
        );
      }

      if (layer === "date" && includeDate) {
        ctx.save();
        ctx.fillStyle = dateColor;
        ctx.textBaseline = "middle";
        ctx.font = `${dateFontWeight} ${dateFontSize}px ${dateFontFamily}`;
        const textY = layerCenterY;
        const textWidth = ctx.measureText(dateText).width;
        ctx.fillText(dateText, layerCenterX - textWidth / 2 + 2 * scale, textY);
        ctx.restore();
      }
    }
  });
}

function drawRedactionsOnCanvas({ ctx, canvas, redactions }) {
  if (!Array.isArray(redactions) || redactions.length === 0) {
    return;
  }

  redactions.forEach((item) => {
    const x = item.x * canvas.width;
    const y = item.y * canvas.height;
    const width = item.w * canvas.width;
    const height = item.h * canvas.height;

    if (width <= 0 || height <= 0) {
      return;
    }

    drawStripedRedactionOnCanvas(ctx, { x, y, width, height });
  });
}

function drawStripedRedactionOnCanvas(ctx, rect) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();

  ctx.fillStyle = "rgba(23, 27, 33, 0.98)";
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);

  ctx.strokeStyle = "rgba(97, 102, 109, 0.96)";
  ctx.lineWidth = 5.4;
  const step = 14;

  for (let offset = -rect.height; offset <= rect.width + rect.height; offset += step) {
    ctx.beginPath();
    ctx.moveTo(rect.x + offset, rect.y);
    ctx.lineTo(rect.x + offset + rect.height, rect.y + rect.height);
    ctx.stroke();
  }

  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(11, 20, 29, 0.95)";
  ctx.lineWidth = 1;
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);
  ctx.restore();
}

async function loadImage(dataUrl) {
  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image for secure export."));
    img.src = dataUrl;
  });
}

async function canvasToPngBytes(canvas) {
  return await new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error("Could not encode export page."));
        return;
      }
      resolve(await blob.arrayBuffer());
    }, "image/png");
  });
}

async function openPdfDocumentFromBytes(bytes) {
  const pdfjsLib = await getPdfJs();
  const data = new Uint8Array(bytes.slice(0));

  try {
    return await pdfjsLib.getDocument({ data }).promise;
  } catch (firstError) {
    return await pdfjsLib
      .getDocument({
        data,
        disableWorker: true,
      })
      .promise.catch(() => {
        throw firstError;
      });
  }
}

function drawStripedRedaction(page, rect, rgb) {
  const dark = rgb(0.09, 0.11, 0.13);
  const stripe = rgb(0.38, 0.4, 0.43);

  page.drawRectangle({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    color: dark,
  });

  const step = 14;
  const lineWidth = 5.4;

  // Keep stripes fully inside bounds to avoid export artifacts.
  const inset = lineWidth;
  const xMin = rect.x + inset;
  const yMin = rect.y + inset;
  const xMax = rect.x + rect.width - inset;
  const yMax = rect.y + rect.height - inset;

  if (xMax <= xMin || yMax <= yMin) {
    return;
  }

  const drawClippedDiagonal = (startX, startY) => {
    const spanToRight = xMax - startX;
    const spanToTop = yMax - startY;
    const span = Math.min(spanToRight, spanToTop);

    if (span <= 0) {
      return;
    }

    page.drawLine({
      start: { x: startX, y: startY },
      end: { x: startX + span, y: startY + span },
      thickness: lineWidth,
      color: stripe,
      opacity: 0.96,
    });
  };

  // Lines with slope +1 to mimic the on-screen slanted hatch.
  for (let yStart = yMin; yStart <= yMax; yStart += step) {
    drawClippedDiagonal(xMin, yStart);
  }

  for (let xStart = xMin + step; xStart <= xMax; xStart += step) {
    drawClippedDiagonal(xStart, yMin);
  }

  // Seal rectangle edge for a crisp final contour after stripe draw.
  page.drawRectangle({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    borderColor: rgb(0.07, 0.09, 0.11),
    borderWidth: 1.1,
    color: undefined,
    opacity: 1,
  });
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
