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
  let pageLayouts = [];
  const defaultScale = 1.2;
  const pageGap = 14;

  function getPdfLayerEl() {
    return overlay?.parentElement || null;
  }

  function getOrCreateRedactionDocLayer() {
    const layer = getPdfLayerEl();
    if (!layer) {
      return null;
    }

    let redactionLayer = layer.querySelector(".redaction-doc-layer");
    if (!redactionLayer) {
      redactionLayer = document.createElement("div");
      redactionLayer.className = "redaction-doc-layer";
      layer.appendChild(redactionLayer);
    }

    return redactionLayer;
  }

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
    const fitScale = widthScale;

    if (!Number.isFinite(fitScale) || fitScale <= 0) {
      return page.getViewport({ scale: defaultScale });
    }

    return page.getViewport({ scale: Math.max(0.1, fitScale) });
  }

  function syncPdfLayerSize(width, height) {
    const layer = getPdfLayerEl();
    if (!layer) {
      return;
    }

    layer.style.width = `${Math.max(1, Math.round(width))}px`;
    layer.style.height = `${Math.max(1, Math.round(height))}px`;

    const redactionLayer = getOrCreateRedactionDocLayer();
    if (redactionLayer) {
      redactionLayer.style.width = layer.style.width;
      redactionLayer.style.height = layer.style.height;
    }
  }

  function renderDocumentRedactions(activePage = state.currentPage, hideActivePage = true) {
    const redactionLayer = getOrCreateRedactionDocLayer();
    if (!redactionLayer) {
      return;
    }

    redactionLayer.innerHTML = "";

    if (!state.pdfDoc || pageLayouts.length === 0) {
      return;
    }

    for (let pageNumber = 1; pageNumber <= pageLayouts.length; pageNumber += 1) {
      if (hideActivePage && pageNumber === activePage) {
        continue;
      }

      const layout = pageLayouts[pageNumber - 1];
      const redactions = getPageRedactions(state, pageNumber);
      if (!layout || !redactions.length) {
        continue;
      }

      redactions.forEach((redaction) => {
        const box = document.createElement("div");
        box.className = "redaction-box redaction-static-box";
        box.style.left = `${layout.left + redaction.x * layout.width}px`;
        box.style.top = `${layout.top + redaction.y * layout.height}px`;
        box.style.width = `${redaction.w * layout.width}px`;
        box.style.height = `${redaction.h * layout.height}px`;
        redactionLayer.appendChild(box);
      });
    }
  }

  async function renderDocument() {
    if (!state.pdfDoc) {
      return;
    }

    if (isRendering) {
      renderPending = true;
      return;
    }

    isRendering = true;

    const totalPages = Number(state.pdfDoc.numPages) || 0;
    const pages = [];
    let maxWidth = 1;
    let totalHeight = 0;

    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
      const page = await state.pdfDoc.getPage(pageNumber);
      const viewport = getViewportForMode(page);
      const pageCanvas = document.createElement("canvas");
      const pageCtx = pageCanvas.getContext("2d");

      pageCanvas.width = Math.max(1, Math.round(viewport.width));
      pageCanvas.height = Math.max(1, Math.round(viewport.height));

      await page
        .render({
          canvasContext: pageCtx,
          viewport,
        })
        .promise;

      pages.push({
        canvas: pageCanvas,
        width: pageCanvas.width,
        height: pageCanvas.height,
      });

      maxWidth = Math.max(maxWidth, pageCanvas.width);
      totalHeight += pageCanvas.height;

      if (pageNumber < totalPages) {
        totalHeight += pageGap;
      }
    }

    pdfCanvas.width = Math.max(1, Math.round(maxWidth));
    pdfCanvas.height = Math.max(1, Math.round(totalHeight));
    syncPdfLayerSize(pdfCanvas.width, pdfCanvas.height);

    pdfCtx.clearRect(0, 0, pdfCanvas.width, pdfCanvas.height);
    pageLayouts = [];

    let cursorTop = 0;
    pages.forEach((item, index) => {
      const left = Math.floor((pdfCanvas.width - item.width) / 2);

      // Draw each page as a card with a soft edge so page breaks stay obvious.
      pdfCtx.save();
      pdfCtx.fillStyle = "#ffffff";
      pdfCtx.shadowColor = "rgba(16, 35, 51, 0.14)";
      pdfCtx.shadowBlur = 8;
      pdfCtx.shadowOffsetX = 0;
      pdfCtx.shadowOffsetY = 2;
      pdfCtx.fillRect(left, cursorTop, item.width, item.height);
      pdfCtx.restore();

      pdfCtx.drawImage(item.canvas, left, cursorTop);
      pdfCtx.strokeStyle = "#c4cfda";
      pdfCtx.lineWidth = 1;
      pdfCtx.strokeRect(
        left + 0.5,
        cursorTop + 0.5,
        Math.max(0, item.width - 1),
        Math.max(0, item.height - 1),
      );

      pageLayouts[index] = {
        top: cursorTop,
        left,
        width: item.width,
        height: item.height,
      };

      cursorTop += item.height + pageGap;
    });

    isRendering = false;
    if (renderPending) {
      renderPending = false;
      await renderDocument();
      return;
    }
  }

  function getVisiblePageFromScrollPosition() {
    if (!state.pdfDoc || pageLayouts.length === 0) {
      return 0;
    }

    const layer = getPdfLayerEl();
    if (!layer) {
      return state.currentPage || 1;
    }

    const stageRect = pdfStage.getBoundingClientRect();
    const layerRect = layer.getBoundingClientRect();
    const stageCenterY = stageRect.top + stageRect.height / 2;
    const centerInLayer = stageCenterY - layerRect.top;

    let bestPage = 1;
    let bestDistance = Number.POSITIVE_INFINITY;

    pageLayouts.forEach((layout, index) => {
      const pageCenter = layout.top + layout.height / 2;
      const distance = Math.abs(centerInLayer - pageCenter);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestPage = index + 1;
      }
    });

    return bestPage;
  }

  function syncOverlayToPage(pageNumber) {
    const layout = pageLayouts[pageNumber - 1];
    if (!layout) {
      overlay.style.width = "0px";
      overlay.style.height = "0px";
      return;
    }

    overlay.style.left = `${layout.left}px`;
    overlay.style.top = `${layout.top}px`;
    overlay.style.width = `${layout.width}px`;
    overlay.style.height = `${layout.height}px`;
  }

  function resolvePagePointFromClient(clientX, clientY) {
    if (!state.pdfDoc || pageLayouts.length === 0) {
      return null;
    }

    const layer = getPdfLayerEl();
    if (!layer) {
      return null;
    }

    const layerRect = layer.getBoundingClientRect();
    const xInLayer = clientX - layerRect.left;
    const yInLayer = clientY - layerRect.top;

    for (let i = 0; i < pageLayouts.length; i += 1) {
      const layout = pageLayouts[i];
      const minX = layout.left;
      const maxX = layout.left + layout.width;
      const minY = layout.top;
      const maxY = layout.top + layout.height;

      if (xInLayer < minX || xInLayer > maxX || yInLayer < minY || yInLayer > maxY) {
        continue;
      }

      return {
        pageNumber: i + 1,
        x: Math.min(1, Math.max(0, (xInLayer - layout.left) / layout.width)),
        y: Math.min(1, Math.max(0, (yInLayer - layout.top) / layout.height)),
      };
    }

    return null;
  }

  function renderA4Placeholder() {
    // ISO A4 ratio (210 x 297 mm) preserved regardless of viewport size.
    const a4Aspect = 210 / 297;
    let a4Width = 794;
    let a4Height = 1123;

    const stageSize = getStageContentSize();
    if (stageSize) {
      let fittedWidth = stageSize.width;
      let fittedHeight = fittedWidth / a4Aspect;

      if (fittedHeight > stageSize.height) {
        fittedHeight = stageSize.height;
        fittedWidth = fittedHeight * a4Aspect;
      }

      a4Width = Math.max(1, Math.round(fittedWidth));
      a4Height = Math.max(1, Math.round(fittedHeight));
    }

    pdfCanvas.width = a4Width;
    pdfCanvas.height = a4Height;

    pdfCtx.clearRect(0, 0, a4Width, a4Height);
    pdfCtx.fillStyle = "#ffffff";
    pdfCtx.fillRect(0, 0, a4Width, a4Height);

    // Subtle edge so blank pages are still distinguishable against the stage.
    pdfCtx.strokeStyle = "#d7dce1";
    pdfCtx.lineWidth = 1;
    pdfCtx.strokeRect(0.5, 0.5, a4Width - 1, a4Height - 1);

    pageLayouts = [{ top: 0, left: 0, width: a4Width, height: a4Height }];
    syncPdfLayerSize(a4Width, a4Height);
    syncOverlayToPage(1);
    renderDocumentRedactions(1, true);
    pageInfo.textContent = "Page 0 / 0";
    renderMarkers(overlay, [], getPlacementPreviewOptions());
    renderRedactions(overlay, [], getRedactionPreviewOptions?.());
  }

  async function renderPage(pageNumber) {
    if (!state.pdfDoc) {
      return;
    }

    const totalPages = Number(state.pdfDoc.numPages) || 0;
    const safePage = Math.min(Math.max(1, Number(pageNumber) || 1), totalPages);
    state.currentPage = safePage;

    syncOverlayToPage(safePage);
    pageInfo.textContent = `Page ${safePage} / ${state.pdfDoc.numPages}`;
    renderMarkers(
      overlay,
      getPagePlacements(state, safePage),
      getPlacementPreviewOptions(),
    );
    renderRedactions(
      overlay,
      getPageRedactions(state, safePage),
      getRedactionPreviewOptions?.(),
    );
    renderDocumentRedactions(safePage, true);
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
      await renderDocument();
      await scrollToPage(state.currentPage, "auto");
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
      await renderDocument();
      await renderPage(state.currentPage);
    }
  }

  async function scrollToPage(pageNumber, behavior = "smooth") {
    if (!state.pdfDoc || pageLayouts.length === 0) {
      return false;
    }

    const previousPage = state.currentPage;
    const totalPages = Number(state.pdfDoc.numPages) || 0;
    const safePage = Math.min(Math.max(1, Number(pageNumber) || 1), totalPages);
    const layout = pageLayouts[safePage - 1];
    const layer = getPdfLayerEl();
    if (!layout || !layer) {
      return false;
    }

    const targetTop = Math.max(0, layer.offsetTop + layout.top - 6);
    pdfStage.scrollTo({ top: targetTop, behavior });
    await renderPage(safePage);
    return safePage !== previousPage;
  }

  async function syncPageFromScroll() {
    if (!state.pdfDoc || pageLayouts.length === 0) {
      return false;
    }

    const pageFromScroll = getVisiblePageFromScrollPosition();
    if (!pageFromScroll || pageFromScroll === state.currentPage) {
      return false;
    }

    await renderPage(pageFromScroll);
    return true;
  }

  async function handleViewportChange() {
    if (fitToScreen && state.pdfDoc) {
      await renderDocument();
      await renderPage(state.currentPage);
      return;
    }

    if (!state.pdfDoc) {
      renderA4Placeholder();
    }
  }

  return {
    loadPdf,
    renderPage,
    renderA4Placeholder,
    setFitToScreen,
    handleViewportChange,
    scrollToPage,
    syncPageFromScroll,
    refreshDocumentRedactions: renderDocumentRedactions,
    resolvePagePointFromClient,
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
