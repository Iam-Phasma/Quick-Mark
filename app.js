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
import {
  resolveToneCssColor,
  resolveDateFontCss,
} from "./js/styleTokens.js";

if ("serviceWorker" in navigator && window.location.protocol !== "file:") {
  window.addEventListener("load", () => {
    const baseUrl = import.meta.env?.BASE_URL || "./";
    const swUrl = `${baseUrl}sw.js`;
    navigator.serviceWorker.register(swUrl).catch(() => {
      // Ignore SW registration failures to keep app functional.
    });
  });
}

const state = createAppState();
let composerEditor = null;
let signaturePadApi = null;
let signInputSwitcherApi = null;

const COMPOSER_DEFAULTS = {
  boxWidth: 260,
  boxHeight: 160,
  boxPadding: 6,
  dateFontSize: 12,
};

const setUiStatus = (message, ok = false) =>
  setStatus(els.statusEl, message, ok);

function syncFitToggleUi(isFitEnabled) {
  els.fitViewToggle.setAttribute("aria-pressed", String(isFitEnabled));
  els.fitViewToggle.setAttribute(
    "title",
    isFitEnabled ? "Fit to screen: On" : "Fit to screen: Off",
  );
  els.fitViewToggle.classList.toggle("is-active", isFitEnabled);

  const fitIcon = els.fitViewToggle.querySelector("img");
  if (fitIcon) {
    fitIcon.src = isFitEnabled
      ? "./icons/fit-icon-active.svg"
      : "./icons/fit-icon.svg";
  }
}

function updateExportButton() {
  els.exportBtn.disabled = !state.pdfDoc || totalPlacementCount(state) === 0;
}

function updateDateFormatOptionSamples() {
  const options = Array.from(els.dateFormat.options || []);
  options.forEach((option) => {
    const formatKey = option.value;
    option.textContent = getTodayText(formatKey, els.includeSeparator.checked);
  });
}

function getPlacementPreviewOptions() {
  return {
    stampDataUrl: state.stampDataUrl,
    signDataUrl: state.signDataUrl,
    includeDate: els.includeDate.checked,
    dateText: getTodayText(els.dateFormat.value, els.includeSeparator.checked),
    stampWidth: state.stampWidth,
    signWidth: state.signWidth * (state.signWidthScale || 1),
    stampAspect: state.stampAspect,
    signAspect: state.signAspect,
    dateFontSize: state.dateFontSize ?? COMPOSER_DEFAULTS.dateFontSize,
    dateFontFamily: resolveDateFontCss(state.dateFontFamily),
    dateFontKey: state.dateFontFamily,
    dateFontWeight: state.dateFontWeight,
    dateColor: resolveToneCssColor(state.dateTone, state.dateSaturation),
    dateTone: state.dateTone,
    dateSaturation: state.dateSaturation,
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

function setToneButtonsState(container, activeTone) {
  if (!container) {
    return;
  }

  const buttons = Array.from(container.querySelectorAll("button[data-tone]"));
  buttons.forEach((button) => {
    const isActive = button.dataset.tone === activeTone;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function syncStyleControlsUi() {
  els.penSaturation.value = String(state.penSaturation);
  els.penSaturationValue.textContent = `${state.penSaturation}%`;
  els.dateSaturation.value = String(state.dateSaturation);
  els.dateSaturationValue.textContent = `${state.dateSaturation}%`;
  els.dateFontFamily.value = state.dateFontFamily;
  els.dateFontWeight.value = state.dateFontWeight;

  setToneButtonsState(els.penColorChoices, state.penTone);
  setToneButtonsState(els.dateColorChoices, state.dateTone);

  const penInk = resolveToneCssColor(state.penTone, state.penSaturation);
  const dateInk = resolveToneCssColor(state.dateTone, state.dateSaturation);

  els.signCanvas.style.setProperty("--pen-ink", penInk);
  els.penSaturation.style.accentColor = penInk;
  els.dateSaturation.style.accentColor = dateInk;
  els.dateFontFamily.style.fontFamily = resolveDateFontCss(state.dateFontFamily);

  signaturePadApi?.setPenColor(penInk);
}

function initSignInputSwitcher() {
  const switcher = els.signInputSwitch;
  if (!switcher) {
    return;
  }

  const buttons = Array.from(switcher.querySelectorAll("button[data-sign-mode]"));
  const attachmentPane = els.signAttachmentPane;
  const drawingPane = els.signDrawingPane;
  const penStyleGroup = els.signPenStyleGroup;

  const setMode = (mode) => {
    const safeMode = mode === "drawing" ? "drawing" : "attachment";
    const index = safeMode === "drawing" ? 1 : 0;

    buttons.forEach((button) => {
      const isActive = button.dataset.signMode === safeMode;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });

    if (attachmentPane) {
      attachmentPane.hidden = safeMode !== "attachment";
    }

    if (drawingPane) {
      drawingPane.hidden = safeMode !== "drawing";
    }

    if (penStyleGroup) {
      penStyleGroup.hidden = safeMode !== "drawing";
    }

    switcher.style.setProperty("--sign-mode-index", String(index));
  };

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      setMode(button.dataset.signMode || "attachment");
    });
  });

  setMode("attachment");

  return {
    setMode,
  };
}

function initAssetSwitcher() {
  const switcher = document.getElementById("assetSwitch");
  if (!switcher) {
    return;
  }

  const buttons = Array.from(switcher.querySelectorAll("button[data-asset-tab]"));
  const panels = Array.from(document.querySelectorAll("[data-asset-panel]"));

  if (!buttons.length || !panels.length) {
    return;
  }

  const activate = (tabKey) => {
    const activeIndex = buttons.findIndex(
      (button) => button.dataset.assetTab === tabKey,
    );

    if (activeIndex < 0) {
      return;
    }

    buttons.forEach((button, index) => {
      const isActive = index === activeIndex;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });

    panels.forEach((panel) => {
      const isActive = panel.dataset.assetPanel === tabKey;
      panel.classList.toggle("is-active", isActive);
      panel.hidden = !isActive;
    });

    switcher.style.setProperty("--asset-index", String(activeIndex));
  };

  const syncPanelHeight = () => {
    let maxHeight = 0;

    panels.forEach((panel) => {
      const wasHidden = panel.hidden;
      const hadActive = panel.classList.contains("is-active");

      panel.hidden = false;
      panel.classList.add("is-active");
      maxHeight = Math.max(maxHeight, Math.ceil(panel.scrollHeight));

      if (!hadActive) {
        panel.classList.remove("is-active");
      }
      panel.hidden = wasHidden;
    });

    const panelsWrap = switcher.nextElementSibling;
    if (panelsWrap && maxHeight > 0) {
      panelsWrap.style.setProperty("--asset-panel-max-height", `${maxHeight}px`);
    }
  };

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      activate(button.dataset.assetTab || "stamp");
    });
  });

  switcher.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }

    const currentIndex = buttons.findIndex((button) => button.classList.contains("is-active"));
    if (currentIndex < 0) {
      return;
    }

    const direction = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (currentIndex + direction + buttons.length) % buttons.length;
    const next = buttons[nextIndex];

    activate(next.dataset.assetTab || "stamp");
    next.focus();
    event.preventDefault();
  });

  activate("stamp");
  syncPanelHeight();
  window.addEventListener("resize", syncPanelHeight);
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

      trimmedCtx.drawImage(
        canvas,
        minX,
        minY,
        cropWidth,
        cropHeight,
        0,
        0,
        cropWidth,
        cropHeight,
      );
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
  renderMarkers(
    els.overlay,
    getPagePlacements(state, state.currentPage),
    options,
  );
  renderComposerPreview(els.composerPreview, options);
  syncComposerPreviewVisualHeight();
  updateExportButton();
}

function syncComposerPreviewVisualHeight() {
  const baseHeight = COMPOSER_DEFAULTS.boxHeight + 2;
  const editorRect = els.layerEditor?.getBoundingClientRect();
  const editorHeight = Math.ceil(editorRect?.height || 0);

  if (editorHeight > 0) {
    els.composerPreview.style.minHeight = `${Math.max(baseHeight, editorHeight)}px`;
    return;
  }

  els.composerPreview.style.minHeight = `${baseHeight}px`;
}

const viewer = createPdfViewer({
  state,
  pdfStage: els.pdfStage,
  pdfCanvas: els.pdfCanvas,
  pdfCtx,
  overlay: els.overlay,
  pageInfo: els.pageInfo,
  getPagePlacements,
  renderMarkers,
  setStatus: setUiStatus,
  onPdfNameLoaded: (name) => {
    els.pdfDropText.textContent = name;
    updateExportButton();
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
  signInputSwitcherApi = initSignInputSwitcher();
  let isFitViewEnabled = false;

  els.pdfInput.addEventListener("change", (event) => {
    viewer.loadPdf(event.target.files?.[0]);
  });

  els.fitViewToggle.addEventListener("click", async () => {
    isFitViewEnabled = !isFitViewEnabled;
    syncFitToggleUi(isFitViewEnabled);
    await viewer.setFitToScreen(isFitViewEnabled);
  });

  els.stampInput.addEventListener("change", async (event) => {
    try {
      state.stampDataUrl = await readPngAsDataUrl(
        event.target.files?.[0],
        "Stamp",
      );
      state.stampAspect = await getImageAspect(state.stampDataUrl);
      refreshPreviews();
      setUiStatus("Stamp PNG loaded.", true);
    } catch (error) {
      setUiStatus(error.message);
    }
  });

  els.esignInput.addEventListener("change", async (event) => {
    try {
      const rawSignDataUrl = await readPngAsDataUrl(
        event.target.files?.[0],
        "E-sign",
      );
      const trimmedSign = await trimTransparentPng(rawSignDataUrl);
      state.signDataUrl = trimmedSign.dataUrl;
      state.signAspect = trimmedSign.aspect;
      state.signWidthScale = trimmedSign.widthScale;
      signInputSwitcherApi?.setMode("attachment");
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
    if (placements.length >= 1) {
      setUiStatus(`Only 1 stamp mark is allowed on page ${state.currentPage}.`);
      return;
    }

    const point = placementPointFromEvent(
      event,
      els.overlay,
      getPlacementPreviewOptions(),
    );
    placements.push(point);
    refreshPreviews();
    setUiStatus(`Placed mark on page ${state.currentPage}.`, true);
  });

  els.clearPlacementsBtn.addEventListener("click", () => {
    clearCurrentPagePlacements(state);
    refreshPreviews();
    setUiStatus(`Cleared placements on page ${state.currentPage}.`);
  });

  [els.includeDate, els.includeSeparator, els.dateFormat].forEach((control) => {
    control.addEventListener("input", () => {
      updateDateFormatOptionSamples();
      refreshPreviews();
    });
    control.addEventListener("change", () => {
      updateDateFormatOptionSamples();
      refreshPreviews();
    });
  });

  els.dateFontFamily.addEventListener("change", () => {
    state.dateFontFamily = els.dateFontFamily.value;
    syncStyleControlsUi();
    refreshPreviews();
  });

  els.dateFontWeight.addEventListener("change", () => {
    state.dateFontWeight = els.dateFontWeight.value;
    syncStyleControlsUi();
    refreshPreviews();
  });

  els.penSaturation.addEventListener("input", () => {
    state.penSaturation = Number(els.penSaturation.value) || 100;
    syncStyleControlsUi();
  });

  els.penSaturation.addEventListener("change", () => {
    state.penSaturation = Number(els.penSaturation.value) || 100;
    syncStyleControlsUi();
  });

  els.dateSaturation.addEventListener("input", () => {
    state.dateSaturation = Number(els.dateSaturation.value) || 100;
    syncStyleControlsUi();
    refreshPreviews();
  });

  els.dateSaturation.addEventListener("change", () => {
    state.dateSaturation = Number(els.dateSaturation.value) || 100;
    syncStyleControlsUi();
    refreshPreviews();
  });

  els.penColorChoices.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-tone]");
    if (!button) {
      return;
    }

    state.penTone = button.dataset.tone || "black";
    syncStyleControlsUi();
  });

  els.dateColorChoices.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-tone]");
    if (!button) {
      return;
    }

    state.dateTone = button.dataset.tone || "black";
    syncStyleControlsUi();
    refreshPreviews();
  });

  els.openComposerBtn.addEventListener("click", () => {
    els.composerModal.classList.remove("hidden");
    requestAnimationFrame(() => {
      syncComposerPreviewVisualHeight();
    });
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

  window.addEventListener("resize", () => {
    syncComposerPreviewVisualHeight();
    viewer.handleViewportChange();
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
        includeSeparator: els.includeSeparator,
        dateFormat: els.dateFormat,
        pdfCanvas: els.pdfCanvas,
        getTodayText,
        totalPlacementCount,
        setStatus: setUiStatus,
        composerOptions: getPlacementPreviewOptions(),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown export error";
      setUiStatus(`Could not export PDF. ${message}`);
    }
  });
}

setupDropzone();
syncFitToggleUi(false);
updateDateFormatOptionSamples();
composerEditor = initComposerEditor({
  container: els.layerEditor,
  state,
  getLayerSize: (layer) => {
    if (layer === "stamp") {
      return state.stampWidth;
    }
    if (layer === "sign") {
      return state.signWidth;
    }
    return state.dateFontSize;
  },
  setLayerSize: (layer, value) => {
    if (layer === "stamp") {
      state.stampWidth = value;
      return;
    }
    if (layer === "sign") {
      state.signWidth = value;
      return;
    }
    state.dateFontSize = value;
  },
  onChange: refreshPreviews,
});
signaturePadApi = initSignaturePad({
  signCanvas: els.signCanvas,
  signCtx,
  clearSignBtn: els.clearSignBtn,
  setStatus: setUiStatus,
  getPenColor: () => resolveToneCssColor(state.penTone, state.penSaturation),
  onUseDrawing: (drawingDataUrl) => {
    trimTransparentPng(drawingDataUrl).then((trimmedSign) => {
      state.signDataUrl = trimmedSign.dataUrl;
      state.signAspect = trimmedSign.aspect;
      state.signWidthScale = trimmedSign.widthScale;
      signInputSwitcherApi?.setMode("drawing");
      refreshPreviews();
    });
  },
});
bindEvents();
viewer.renderA4Placeholder();
initAssetSwitcher();
syncStyleControlsUi();
refreshPreviews();
