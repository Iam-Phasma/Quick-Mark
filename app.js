import { els, pdfCtx, signCtx } from "./js/dom.js";
import {
  createAppState,
  getPagePlacements,
  clearCurrentPagePlacements,
  totalPlacementCount,
} from "./js/state.js";
import {
  setStatus,
  getTodayText,
  renderMarkers,
  renderComposerPreview,
  placementPointFromEvent,
  readPngAsDataUrl,
} from "./js/ui.js";
import { initSignaturePad } from "./js/signature.js";
import { createPdfViewer } from "./js/pdfViewer.js";
import { exportMarkedPdf } from "./js/exporter.js";
import { initComposerEditor } from "./js/composerEditor.js";

const state = createAppState();
let composerEditor = null;

const COMPOSER_DEFAULTS = {
  boxWidth: 260,
  boxHeight: 160,
  boxPadding: 6,
  dateFontSize: 12,
};

const setUiStatus = (message, ok = false) => setStatus(els.statusEl, message, ok);

function getPlacementPreviewOptions() {
  return {
    stampDataUrl: state.stampDataUrl,
    signDataUrl: state.signDataUrl,
    includeDate: els.includeDate.checked,
    dateText: getTodayText(els.dateFormat.value),
    stampWidth: Number(els.stampSize.value),
    signWidth: Number(els.signSize.value) * (state.signWidthScale || 1),
    stampAspect: state.stampAspect,
    signAspect: state.signAspect,
    dateFontSize: COMPOSER_DEFAULTS.dateFontSize,
    layerOrder: state.layerOrder,
    layerTransforms: state.layerTransforms,
    boxWidth: COMPOSER_DEFAULTS.boxWidth,
    boxHeight: COMPOSER_DEFAULTS.boxHeight,
    boxPadding: COMPOSER_DEFAULTS.boxPadding,
    onComposerTransformCommit: () => {
      composerEditor?.rerender();
      refreshPreviews();
    },
    onRemovePlacement: (index) => {
      getPagePlacements(state, state.currentPage).splice(index, 1);
      refreshPreviews();
      setUiStatus(`Removed mark from page ${state.currentPage}.`);
    },
  };
}

function getImageAspect(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (!img.naturalWidth || !img.naturalHeight) {
        resolve(1);
        return;
      }
      resolve(img.naturalHeight / img.naturalWidth);
    };
    img.onerror = () => resolve(1);
    img.src = dataUrl;
  });
}

function trimTransparentPng(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;

      if (!width || !height) {
        resolve({ dataUrl, aspect: 1, widthScale: 1 });
        return;
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve({ dataUrl, aspect: height / width, widthScale: 1 });
        return;
      }

      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, width, height);
      const pixels = imageData.data;

      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;

      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const alpha = pixels[(y * width + x) * 4 + 3];
          if (alpha > 0) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }

      if (maxX < minX || maxY < minY) {
        resolve({ dataUrl, aspect: height / width, widthScale: 1 });
        return;
      }

      const cropWidth = Math.max(1, maxX - minX + 1);
      const cropHeight = Math.max(1, maxY - minY + 1);
      const trimmedCanvas = document.createElement("canvas");
      trimmedCanvas.width = cropWidth;
      trimmedCanvas.height = cropHeight;
      const trimmedCtx = trimmedCanvas.getContext("2d");

      if (!trimmedCtx) {
        resolve({ dataUrl, aspect: height / width, widthScale: 1 });
        return;
      }

      trimmedCtx.drawImage(canvas, minX, minY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
      resolve({
        dataUrl: trimmedCanvas.toDataURL("image/png"),
        aspect: cropHeight / cropWidth,
        widthScale: cropWidth / width,
      });
    };

    img.onerror = () => {
      resolve({ dataUrl, aspect: 1, widthScale: 1 });
    };

    img.src = dataUrl;
  });
}

function refreshPreviews() {
  const options = getPlacementPreviewOptions();
  renderMarkers(els.overlay, getPagePlacements(state, state.currentPage), options);
  renderComposerPreview(els.composerPreview, options);
}

const viewer = createPdfViewer({
  state,
  pdfCanvas: els.pdfCanvas,
  pdfCtx,
  overlay: els.overlay,
  pageInfo: els.pageInfo,
  getPagePlacements,
  renderMarkers,
  setStatus: setUiStatus,
  onPdfNameLoaded: (name) => {
    els.pdfDropText.textContent = name;
  },
  getPlacementPreviewOptions,
});

function setupDropzone() {
  ["dragenter", "dragover"].forEach((name) => {
    els.pdfDrop.addEventListener(name, (event) => {
      event.preventDefault();
      els.pdfDrop.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach((name) => {
    els.pdfDrop.addEventListener(name, (event) => {
      event.preventDefault();
      els.pdfDrop.classList.remove("dragover");
    });
  });

  els.pdfDrop.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files?.[0];
    viewer.loadPdf(file);
  });
}

function bindEvents() {
  els.pdfInput.addEventListener("change", (event) => {
    viewer.loadPdf(event.target.files?.[0]);
  });

  els.stampInput.addEventListener("change", async (event) => {
    try {
      state.stampDataUrl = await readPngAsDataUrl(event.target.files?.[0], "Stamp");
      state.stampAspect = await getImageAspect(state.stampDataUrl);
      refreshPreviews();
      setUiStatus("Stamp PNG loaded.", true);
    } catch (error) {
      setUiStatus(error.message);
    }
  });

  els.esignInput.addEventListener("change", async (event) => {
    try {
      const rawSignDataUrl = await readPngAsDataUrl(event.target.files?.[0], "E-sign");
      const trimmedSign = await trimTransparentPng(rawSignDataUrl);
      state.signDataUrl = trimmedSign.dataUrl;
      state.signAspect = trimmedSign.aspect;
      state.signWidthScale = trimmedSign.widthScale;
      refreshPreviews();
      setUiStatus("E-sign PNG loaded and trimmed.", true);
    } catch (error) {
      setUiStatus(error.message);
    }
  });

  els.overlay.addEventListener("click", (event) => {
    if (!state.pdfDoc) {
      setUiStatus("Upload a PDF first.");
      return;
    }

    const placements = getPagePlacements(state, state.currentPage);
    if (placements.length >= 2) {
      setUiStatus(`Maximum of 2 marks allowed on page ${state.currentPage}.`);
      return;
    }

    const point = placementPointFromEvent(event, els.overlay, getPlacementPreviewOptions());
    placements.push(point);
    refreshPreviews();
    setUiStatus(`Placed mark on page ${state.currentPage}.`, true);
  });

  els.clearPlacementsBtn.addEventListener("click", () => {
    clearCurrentPagePlacements(state);
    refreshPreviews();
    setUiStatus(`Cleared placements on page ${state.currentPage}.`);
  });

  [
    els.includeDate,
    els.dateFormat,
    els.stampSize,
    els.signSize,
  ].forEach((control) => {
    control.addEventListener("input", refreshPreviews);
    control.addEventListener("change", refreshPreviews);
  });

  els.openComposerBtn.addEventListener("click", () => {
    els.composerModal.classList.remove("hidden");
  });

  els.closeComposerBtn.addEventListener("click", () => {
    els.composerModal.classList.add("hidden");
  });

  els.composerModal.addEventListener("click", (event) => {
    if (event.target === els.composerModal) {
      els.composerModal.classList.add("hidden");
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      els.composerModal.classList.add("hidden");
    }
  });

  els.prevPageBtn.addEventListener("click", async () => {
    if (!state.pdfDoc || state.currentPage <= 1) {
      return;
    }

    state.currentPage -= 1;
    await viewer.renderPage(state.currentPage);
  });

  els.nextPageBtn.addEventListener("click", async () => {
    if (!state.pdfDoc || state.currentPage >= state.pdfDoc.numPages) {
      return;
    }

    state.currentPage += 1;
    await viewer.renderPage(state.currentPage);
  });

  els.exportBtn.addEventListener("click", async () => {
    try {
      await exportMarkedPdf({
        state,
        includeDate: els.includeDate,
        dateFormat: els.dateFormat,
        stampSize: els.stampSize,
        signSize: els.signSize,
        pdfCanvas: els.pdfCanvas,
        getTodayText,
        totalPlacementCount,
        setStatus: setUiStatus,
        composerOptions: getPlacementPreviewOptions(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown export error";
      setUiStatus(`Could not export PDF. ${message}`);
    }
  });
}

setupDropzone();
composerEditor = initComposerEditor({
  container: els.layerEditor,
  state,
  onChange: refreshPreviews,
});
initSignaturePad({
  signCanvas: els.signCanvas,
  signCtx,
  clearSignBtn: els.clearSignBtn,
  useSignDrawingBtn: els.useSignDrawingBtn,
  setStatus: setUiStatus,
  onUseDrawing: (drawingDataUrl) => {
    trimTransparentPng(drawingDataUrl).then((trimmedSign) => {
      state.signDataUrl = trimmedSign.dataUrl;
      state.signAspect = trimmedSign.aspect;
      state.signWidthScale = trimmedSign.widthScale;
      refreshPreviews();
    });
  },
});
bindEvents();
viewer.renderA4Placeholder();
refreshPreviews();
