import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.worker.min.mjs";

export function createPdfViewer({
  state,
  pdfCanvas,
  pdfCtx,
  overlay,
  pageInfo,
  getPagePlacements,
  renderMarkers,
  setStatus,
  onPdfNameLoaded,
  getPlacementPreviewOptions,
}) {
  let isRendering = false;
  let renderPending = false;

  function renderA4Placeholder() {
    // A4 at ~96 DPI keeps a realistic paper aspect for empty-state placement preview.
    const a4Width = 794;
    const a4Height = 1123;

    pdfCanvas.width = a4Width;
    pdfCanvas.height = a4Height;

    pdfCtx.clearRect(0, 0, a4Width, a4Height);
    pdfCtx.fillStyle = "#ffffff";
    pdfCtx.fillRect(0, 0, a4Width, a4Height);

    // Subtle edge so blank pages are still distinguishable against the stage.
    pdfCtx.strokeStyle = "#d7dce1";
    pdfCtx.lineWidth = 1;
    pdfCtx.strokeRect(0.5, 0.5, a4Width - 1, a4Height - 1);

    pageInfo.textContent = "Page 0 / 0";
    renderMarkers(overlay, [], getPlacementPreviewOptions());
  }

  async function renderPage(pageNumber) {
    if (!state.pdfDoc) {
      return;
    }

    if (isRendering) {
      renderPending = true;
      return;
    }

    isRendering = true;
    const page = await state.pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.2 });

    pdfCanvas.width = viewport.width;
    pdfCanvas.height = viewport.height;

    await page.render({ canvasContext: pdfCtx, viewport }).promise;

    pageInfo.textContent = `Page ${state.currentPage} / ${state.pdfDoc.numPages}`;
    renderMarkers(
      overlay,
      getPagePlacements(state, state.currentPage),
      getPlacementPreviewOptions()
    );

    isRendering = false;
    if (renderPending) {
      renderPending = false;
      await renderPage(state.currentPage);
    }
  }

  async function loadPdf(file) {
    if (!isPdfFile(file)) {
      setStatus("Please upload a valid PDF file.");
      if (!state.pdfDoc) {
        renderA4Placeholder();
      }
      return;
    }

    state.pdfBytes = await file.arrayBuffer();

    try {
      state.pdfDoc = await openPdfDocument(state.pdfBytes);
      state.currentPage = 1;
      state.placementsByPage = new Map();
      onPdfNameLoaded(file.name);
      setStatus("PDF loaded. Click on page to place mark.", true);
      await renderPage(state.currentPage);
    } catch (error) {
      state.pdfDoc = null;
      state.pdfBytes = null;
      const message =
        error && typeof error.message === "string"
          ? error.message
          : "Unknown PDF parsing error";
      setStatus(`Could not open PDF. ${message}`);
      renderA4Placeholder();
    }
  }

  async function openPdfDocument(bytes) {
    // PDF.js transfers its input buffer to a worker. Keep the original bytes intact for PDF-Lib export.
    const data = new Uint8Array(bytes.slice(0));
    try {
      return await pdfjsLib.getDocument({ data }).promise;
    } catch (firstError) {
      // Fallback path for environments where module workers are blocked.
      return await pdfjsLib
        .getDocument({
          data,
          disableWorker: true,
        })
        .promise
        .catch(() => {
          throw firstError;
        });
    }
  }

  return {
    loadPdf,
    renderPage,
    renderA4Placeholder,
  };
}

function isPdfFile(file) {
  if (!file) {
    return false;
  }

  const type = (file.type || "").toLowerCase();
  const name = (file.name || "").toLowerCase();
  return type === "application/pdf" || name.endsWith(".pdf");
}
