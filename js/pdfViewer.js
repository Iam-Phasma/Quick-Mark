let pdfjsLibPromise = null;

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

export function createPdfViewer({
  state,
  pdfStage,
  pdfCanvas,
  pdfCtx,
  overlay,
  pageInfo,
  getPagePlacements,
  getPageRedactions,
  renderMarkers,
  renderRedactions,
  setStatus,
  onPdfNameLoaded,
  getPlacementPreviewOptions,
  getRedactionPreviewOptions,
}) {
  let isRendering = false;
  let renderPending = false;
  let fitToScreen = false;
  const defaultScale = 1.2;

  function getStageContentSize() {
    if (!pdfStage) {
      return null;
    }

    const styles = window.getComputedStyle(pdfStage);
    const paddingX =
      (parseFloat(styles.paddingLeft) || 0) +
      (parseFloat(styles.paddingRight) || 0);
    const paddingY =
      (parseFloat(styles.paddingTop) || 0) +
      (parseFloat(styles.paddingBottom) || 0);
    const width = Math.max(1, pdfStage.clientWidth - paddingX);
    const height = Math.max(1, pdfStage.clientHeight - paddingY);
    return { width, height };
  }

  function getViewportForMode(page) {
    if (!fitToScreen) {
      return page.getViewport({ scale: defaultScale });
    }

    const stageSize = getStageContentSize();
    if (!stageSize) {
      return page.getViewport({ scale: defaultScale });
    }

    const baseViewport = page.getViewport({ scale: 1 });
    const widthScale = stageSize.width / baseViewport.width;
    const heightScale = stageSize.height / baseViewport.height;
    const fitScale = Math.min(widthScale, heightScale);

    if (!Number.isFinite(fitScale) || fitScale <= 0) {
      return page.getViewport({ scale: defaultScale });
    }

    return page.getViewport({ scale: Math.max(0.1, fitScale) });
  }

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
    renderRedactions(overlay, [], getRedactionPreviewOptions?.());
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
    const viewport = getViewportForMode(page);

    pdfCanvas.width = viewport.width;
    pdfCanvas.height = viewport.height;

    await page.render({ canvasContext: pdfCtx, viewport }).promise;

    pageInfo.textContent = `Page ${state.currentPage} / ${state.pdfDoc.numPages}`;
    renderMarkers(
      overlay,
      getPagePlacements(state, state.currentPage),
      getPlacementPreviewOptions(),
    );
    renderRedactions(
      overlay,
      getPageRedactions(state, state.currentPage),
      getRedactionPreviewOptions?.(),
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
      state.pdfFileName = file.name || "document.pdf";
      state.currentPage = 1;
      state.placementsByPage = new Map();
      state.redactionsByPage = new Map();
      onPdfNameLoaded(file.name);
      setStatus("PDF loaded. Click on page to place mark.", true);
      await renderPage(state.currentPage);
    } catch (error) {
      state.pdfDoc = null;
      state.pdfBytes = null;
      state.pdfFileName = null;
      const message =
        error && typeof error.message === "string"
          ? error.message
          : "Unknown PDF parsing error";
      setStatus(`Could not open PDF. ${message}`);
      renderA4Placeholder();
    }
  }

  async function openPdfDocument(bytes) {
    const pdfjsLib = await getPdfJs();

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
        .promise.catch(() => {
          throw firstError;
        });
    }
  }

  async function setFitToScreen(enabled) {
    fitToScreen = Boolean(enabled);
    if (state.pdfDoc) {
      await renderPage(state.currentPage);
    }
  }

  async function handleViewportChange() {
    if (fitToScreen && state.pdfDoc) {
      await renderPage(state.currentPage);
    }
  }

  return {
    loadPdf,
    renderPage,
    renderA4Placeholder,
    setFitToScreen,
    handleViewportChange,
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
