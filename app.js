import { els, pdfCtx, signCtx } from "./js/dom.js";
import {
  createAppState,
  getPagePlacements,
  getPageRedactions,
  clearCurrentPagePlacements,
  clearCurrentPageRedactions,
  totalPlacementCount,
  totalRedactionCount,
} from "./js/state.js";
import {
  setStatus,
  getTodayText,
  renderMarkers,
  renderRedactions,
  renderComposerPreview,
  placementPointFromEvent,
  canvasPointFromEvent,
  normalizedRectFromPoints,
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
import fitIconUrl from "./icons/fit-icon.svg";
import fitIconActiveUrl from "./icons/fit-icon-active.svg";
import layerIconUrl from "./icons/layer.svg";
import redoIconUrl from "./icons/redo.svg";
import redactIconUrl from "./icons/redact.svg";

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
let isFitViewEnabled = false;
let activeTool = "mark";
let suppressStageScrollSync = false;
let isExporting = false;

const TOOLBAR_ICON_URLS = {
  fitOff: fitIconUrl,
  fitOn: fitIconActiveUrl,
  composer: layerIconUrl,
  clear: redoIconUrl,
  redact: redactIconUrl,
};

const COMPOSER_DEFAULTS = {
  boxWidth: 260,
  boxHeight: 160,
  boxPadding: 6,
  dateFontSize: 12,
};

const USER_ASSET_CACHE_NAME = "quickmark-user-assets-v1";
const USER_ASSET_CACHE_KEYS = {
  stamp: "/__quickmark_user_asset__/stamp.png",
  sign: "/__quickmark_user_asset__/sign.png",
};

function dataUrlToResponse(dataUrl, fileName = "", source = "", width = "") {
  const [meta, data] = String(dataUrl || "").split(",", 2);
  if (!meta || !data) {
    return null;
  }

  const mimeMatch = meta.match(/data:(.*?);base64/i);
  const mimeType = mimeMatch?.[1] || "application/octet-stream";
  let binaryString = "";

  try {
    binaryString = atob(data);
  } catch {
    return null;
  }

  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i += 1) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return new Response(bytes, {
    headers: {
      "Content-Type": mimeType,
      "Cache-Control": "no-store",
      "X-QuickMark-Asset-Name": encodeURIComponent(fileName || ""),
      "X-QuickMark-Asset-Source": encodeURIComponent(source || ""),
      "X-QuickMark-Asset-Width": encodeURIComponent(String(width || "")),
    },
  });
}

async function saveCurrentAssetsToCache() {
  if (!("caches" in window)) {
    setUiStatus("Cache Storage is not available in this browser.");
    return;
  }

  const assets = [
    {
      key: USER_ASSET_CACHE_KEYS.stamp,
      dataUrl: state.stampDataUrl,
      fileName: state.stampFileName || "",
      source: "",
      width: state.stampWidth,
      label: "stamp",
    },
    {
      key: USER_ASSET_CACHE_KEYS.sign,
      dataUrl: state.signDataUrl,
      fileName: state.signFileName || "",
      source: state.signSource || "attachment",
      width: state.signWidth,
      label: "signature",
    },
  ];

  const cache = await caches.open(USER_ASSET_CACHE_NAME);
  const savedLabels = [];
  const removedLabels = [];

  for (const asset of assets) {
    if (!asset.dataUrl) {
      const removed = await cache.delete(asset.key);
      if (removed) {
        removedLabels.push(asset.label);
      }
      continue;
    }

    const response = dataUrlToResponse(
      asset.dataUrl,
      asset.fileName,
      asset.source,
      asset.width,
    );
    if (!response) {
      continue;
    }

    await cache.put(asset.key, response);
    savedLabels.push(asset.label);
  }

  if (!savedLabels.length && !removedLabels.length) {
    setUiStatus("No loaded assets to cache yet.");
    return;
  }

  const savedSummary = savedLabels.length
    ? `Saved ${savedLabels.join(" and ")} in local cache.`
    : "";
  const removedSummary = removedLabels.length
    ? `Removed cached ${removedLabels.join(" and ")}.`
    : "";
  const message = [savedSummary, removedSummary].filter(Boolean).join(" ");
  setUiStatus(message || "Cache updated.", true);
}

async function hasAnyCachedUserAssets() {
  if (!("caches" in window)) {
    return false;
  }

  const cache = await caches.open(USER_ASSET_CACHE_NAME);
  const stampMatch = await cache.match(USER_ASSET_CACHE_KEYS.stamp);
  const signMatch = await cache.match(USER_ASSET_CACHE_KEYS.sign);
  return Boolean(stampMatch || signMatch);
}

async function clearCachedUserAssets() {
  if (!("caches" in window)) {
    setUiStatus("Cache Storage is not available in this browser.");
    return false;
  }

  const cache = await caches.open(USER_ASSET_CACHE_NAME);
  const removedStamp = await cache.delete(USER_ASSET_CACHE_KEYS.stamp);
  const removedSign = await cache.delete(USER_ASSET_CACHE_KEYS.sign);
  const removedAny = removedStamp || removedSign;

  if (removedAny) {
    setUiStatus("Cleared cached stamp/sign assets.", true);
  } else {
    setUiStatus("No cached assets to clear.");
  }

  return removedAny;
}

async function syncAssetsCacheIfEnabled() {
  if (!els.saveAssetsCacheSwitch?.checked) {
    return;
  }

  await saveCurrentAssetsToCache();
}

function responseToDataUrl(response) {
  return new Promise((resolve) => {
    response
      .blob()
      .then((blob) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve(typeof reader.result === "string" ? reader.result : null);
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      })
      .catch(() => resolve(null));
  });
}

async function restoreCachedAssetsToState() {
  if (!("caches" in window)) {
    return;
  }

  const cache = await caches.open(USER_ASSET_CACHE_NAME);
  const [stampResponse, signResponse] = await Promise.all([
    cache.match(USER_ASSET_CACHE_KEYS.stamp),
    cache.match(USER_ASSET_CACHE_KEYS.sign),
  ]);

  let restoredCount = 0;

  if (stampResponse) {
    const stampDataUrl = await responseToDataUrl(stampResponse);
    const stampNameRaw = stampResponse.headers.get("X-QuickMark-Asset-Name") || "";
    const stampName = stampNameRaw ? decodeURIComponent(stampNameRaw) : "";
    const stampWidthRaw = stampResponse.headers.get("X-QuickMark-Asset-Width") || "";
    const stampWidth = Number.parseFloat(stampWidthRaw);
    if (stampDataUrl) {
      state.stampDataUrl = stampDataUrl;
      state.stampAspect = await getImageAspect(stampDataUrl);
      state.stampFileName = stampName || null;
      if (Number.isFinite(stampWidth) && stampWidth > 0) {
        state.stampWidth = stampWidth;
      }
      if (els.stampDropText) {
        els.stampDropText.textContent = stampName || "Cached Stamp";
      }
      restoredCount += 1;
    }
  }

  if (signResponse) {
    const signDataUrl = await responseToDataUrl(signResponse);
    const signNameRaw = signResponse.headers.get("X-QuickMark-Asset-Name") || "";
    const signName = signNameRaw ? decodeURIComponent(signNameRaw) : "";
    const signSourceRaw = signResponse.headers.get("X-QuickMark-Asset-Source") || "";
    const signSource = signSourceRaw ? decodeURIComponent(signSourceRaw) : "";
    const signWidthRaw = signResponse.headers.get("X-QuickMark-Asset-Width") || "";
    const signWidth = Number.parseFloat(signWidthRaw);
    if (signDataUrl) {
      state.signDataUrl = signDataUrl;
      state.signAspect = await getImageAspect(signDataUrl);
      // Cached sign image is already final, so no crop compensation is needed.
      state.signWidthScale = 1;
      state.signFileName = signName || null;
      state.signSource = signSource === "drawing" ? "drawing" : "attachment";
      if (Number.isFinite(signWidth) && signWidth > 0) {
        state.signWidth = signWidth;
      }
      if (els.esignDropText) {
        els.esignDropText.textContent = signName || "Cached E-sign";
      }
      if (state.signSource === "drawing") {
        signaturePadApi?.loadFromDataUrl?.(signDataUrl);
        signInputSwitcherApi?.setMode("drawing");
      } else {
        signInputSwitcherApi?.setMode("attachment");
      }
      restoredCount += 1;
    }
  }

  syncAssetClearButtons();

  if (restoredCount > 0) {
    refreshPreviews();
    setUiStatus(`Restored ${restoredCount} cached asset${restoredCount > 1 ? "s" : ""}.`, true);
  }
}

function hydrateToolbarIcons() {
  const setButtonIcon = (buttonEl, iconUrl) => {
    if (!buttonEl || !iconUrl) {
      return;
    }

    const icon = buttonEl.querySelector("img");
    if (icon) {
      icon.src = iconUrl;
    }
  };

  setButtonIcon(els.fitViewToggle, TOOLBAR_ICON_URLS.fitOff);
  setButtonIcon(els.openComposerBtn, TOOLBAR_ICON_URLS.composer);
  setButtonIcon(els.clearPlacementsBtn, TOOLBAR_ICON_URLS.clear);
  setButtonIcon(els.redactionToggleBtn, TOOLBAR_ICON_URLS.redact);
}

const setUiStatus = (message, ok = false) =>
  setStatus(els.statusEl, message, ok);

function setViewportLoader(isLoading, text = "") {
  if (!els.viewportLoader) {
    return;
  }

  if (els.viewportLoaderText && text) {
    els.viewportLoaderText.textContent = text;
  }

  els.viewportLoader.hidden = !isLoading;
  els.pdfStage?.classList.toggle("is-busy", isLoading);
  els.pdfStage?.setAttribute("aria-busy", String(Boolean(isLoading)));
}

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
      ? TOOLBAR_ICON_URLS.fitOn
      : TOOLBAR_ICON_URLS.fitOff;
  }
}

function updateExportButton() {
  const hasPdf = Boolean(state.pdfDoc);
  els.exportBtn.disabled = !hasPdf || isExporting;
  els.fitViewToggle.disabled = !hasPdf;
  els.clearPlacementsBtn.disabled = !hasPdf;
  els.redactionToggleBtn.disabled = !hasPdf;
  syncClearPdfButton();
  syncPageNavButtons();

  if (!hasPdf) {
    if (isFitViewEnabled) {
      isFitViewEnabled = false;
      syncFitToggleUi(false);
    }

    if (activeTool === "redact") {
      activeTool = "mark";
      syncRedactionToggleUi(false);
    }
  }
}

function setExportLoading(isLoading) {
  isExporting = Boolean(isLoading);
  els.exportBtn?.classList.toggle("is-loading", isExporting);
  els.exportBtn?.setAttribute("aria-busy", String(isExporting));
  if (els.exportBtnLabel) {
    els.exportBtnLabel.textContent = isExporting ? "Exporting" : "Export";
  }
  updateExportButton();
}

function syncClearPdfButton() {
  if (!els.clearPdfBtn) {
    return;
  }

  const hasPdfInputFile = Boolean(els.pdfInput?.files?.length);
  els.clearPdfBtn.hidden = !state.pdfDoc && !hasPdfInputFile;
}

function syncAssetClearButtons() {
  if (els.clearStampBtn) {
    const hasStampFile = Boolean(els.stampInput?.files?.length);
    els.clearStampBtn.hidden = !hasStampFile && !state.stampDataUrl;
  }

  if (els.clearEsignBtn) {
    const hasEsignFile = Boolean(els.esignInput?.files?.length);
    els.clearEsignBtn.hidden = !hasEsignFile && !state.signDataUrl;
  }
}

function syncPageNavButtons() {
  const hasPdf = Boolean(state.pdfDoc);
  const totalPages = hasPdf ? Number(state.pdfDoc.numPages) || 0 : 0;
  const currentPage = Number(state.currentPage) || 0;

  els.prevPageBtn.disabled = !hasPdf || currentPage <= 1;
  els.nextPageBtn.disabled = !hasPdf || currentPage >= totalPages;
}

async function goToPage(targetPage) {
  if (!state.pdfDoc) {
    return false;
  }

  const totalPages = Number(state.pdfDoc.numPages) || 0;
  const safePage = Math.min(Math.max(1, Number(targetPage) || 1), totalPages);
  if (safePage === state.currentPage) {
    return false;
  }

  suppressStageScrollSync = true;
  try {
    await viewer.scrollToPage(safePage, "auto");
    syncPageNavButtons();
    return safePage === state.currentPage;
  } finally {
    window.requestAnimationFrame(() => {
      suppressStageScrollSync = false;
    });
  }
}

function clearLoadedPdf() {
  state.pdfDoc = null;
  state.pdfBytes = null;
  state.pdfFileName = null;
  state.currentPage = 1;
  state.placementsByPage = new Map();
  state.redactionsByPage = new Map();

  els.pdfInput.value = "";
  els.pdfDropText.textContent = "Select Files";

  viewer.renderA4Placeholder();
  refreshPreviews();
  updateExportButton();
  setUiStatus("PDF removed.");
}

function clearLoadedStamp() {
  state.stampDataUrl = null;
  state.stampFileName = null;
  state.stampAspect = 1;
  els.stampInput.value = "";
  if (els.stampDropText) {
    els.stampDropText.textContent = "Select Stamp";
  }
  syncAssetClearButtons();
  syncAssetsCacheIfEnabled();
  refreshPreviews();
  setUiStatus("Stamp removed.");
}

function clearLoadedEsign() {
  state.signDataUrl = null;
  state.signFileName = null;
  state.signSource = null;
  state.signAspect = 0.375;
  state.signWidthScale = 1;
  els.esignInput.value = "";
  if (els.esignDropText) {
    els.esignDropText.textContent = "Select E-sign";
  }
  syncAssetClearButtons();
  syncAssetsCacheIfEnabled();
  refreshPreviews();
  setUiStatus("E-sign attachment removed.");
}

function syncRedactionToggleUi(isEnabled) {
  els.redactionToggleBtn.classList.toggle("is-active", isEnabled);
  els.redactionToggleBtn.setAttribute("aria-pressed", String(isEnabled));
  els.redactionToggleBtn.setAttribute(
    "title",
    isEnabled ? "Redaction tool: On" : "Redaction tool: Off",
  );
  els.overlay.classList.toggle("is-redaction-mode", isEnabled);
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

function getRedactionPreviewOptions() {
  return {
    editable: activeTool === "redact",
    onRemoveRedaction: (index) => {
      const redactions = getPageRedactions(state, state.currentPage);
      redactions.splice(index, 1);
      refreshPreviews();
      setUiStatus(`Removed redaction from page ${state.currentPage}.`);
    },
    onRedactionUpdated: (index, nextRect, committed = false) => {
      const redactions = getPageRedactions(state, state.currentPage);
      if (!redactions[index]) {
        return;
      }

      redactions[index] = {
        x: nextRect.x,
        y: nextRect.y,
        w: nextRect.w,
        h: nextRect.h,
      };

      if (committed) {
        updateExportButton();
      }
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
  const redactions = getPageRedactions(state, state.currentPage);
  const redactionOptions = getRedactionPreviewOptions();
  renderMarkers(
    els.overlay,
    getPagePlacements(state, state.currentPage),
    options,
  );
  renderRedactions(els.overlay, redactions, redactionOptions);
  viewer?.refreshDocumentRedactions?.(state.currentPage, true);
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
  getPageRedactions,
  renderMarkers,
  renderRedactions,
  setStatus: setUiStatus,
  onPdfNameLoaded: (name) => {
    els.pdfDropText.textContent = name;
    updateExportButton();
  },
  getPlacementPreviewOptions,
  getRedactionPreviewOptions,
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

  els.pdfDrop.addEventListener("drop", async (event) => {
    const file = event.dataTransfer?.files?.[0];
    setViewportLoader(true, "Loading PDF...");
    try {
      await viewer.loadPdf(file);
      updateExportButton();
    } finally {
      setViewportLoader(false);
    }
  });

}

function bindEvents() {
  signInputSwitcherApi = initSignInputSwitcher();
  let stageScrollRafId = null;

  const closeSettingsMenu = () => {
    if (!els.settingsMenu || !els.settingsBtn) {
      return;
    }

    els.settingsMenu.hidden = true;
    els.settingsBtn.setAttribute("aria-expanded", "false");
  };

  const openSettingsMenu = () => {
    if (!els.settingsMenu || !els.settingsBtn) {
      return;
    }

    els.settingsMenu.hidden = false;
    els.settingsBtn.setAttribute("aria-expanded", "true");
  };

  const toggleSettingsMenu = () => {
    if (!els.settingsMenu || !els.settingsBtn) {
      return;
    }

    if (els.settingsMenu.hidden) {
      openSettingsMenu();
      return;
    }

    closeSettingsMenu();
  };

  els.settingsBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleSettingsMenu();
  });

  els.settingsMenu?.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  els.saveAssetsCacheSwitch?.addEventListener("change", async () => {
    if (!els.saveAssetsCacheSwitch) {
      return;
    }

    if (els.saveAssetsCacheSwitch.checked) {
      await saveCurrentAssetsToCache();
      return;
    }

    await clearCachedUserAssets();
    els.saveAssetsCacheSwitch.checked = false;
  });

  window.addEventListener("click", () => {
    closeSettingsMenu();
  });

  els.pdfInput.addEventListener("change", async (event) => {
    setViewportLoader(true, "Loading PDF...");
    try {
      await viewer.loadPdf(event.target.files?.[0]);
      updateExportButton();
    } finally {
      setViewportLoader(false);
    }
  });

  els.fitViewToggle.addEventListener("click", async () => {
    isFitViewEnabled = !isFitViewEnabled;
    syncFitToggleUi(isFitViewEnabled);
    await viewer.setFitToScreen(isFitViewEnabled);
  });

  els.redactionToggleBtn.addEventListener("click", async () => {
    activeTool = activeTool === "redact" ? "mark" : "redact";
    const isRedactionOn = activeTool === "redact";
    syncRedactionToggleUi(isRedactionOn);

    if (!isRedactionOn) {
      redactDrag?.draftEl?.remove();
      redactDrag = null;
      refreshPreviews();
      return;
    }

    refreshPreviews();
  });

  els.stampInput.addEventListener("change", async (event) => {
    try {
      const selectedName = event.target.files?.[0]?.name || null;
      state.stampDataUrl = await readPngAsDataUrl(
        event.target.files?.[0],
        "Stamp",
      );
      state.stampFileName = selectedName;
      if (els.stampDropText) {
        els.stampDropText.textContent = selectedName || "Select Stamp";
      }
      state.stampAspect = await getImageAspect(state.stampDataUrl);
      await syncAssetsCacheIfEnabled();
      refreshPreviews();
      setUiStatus("Stamp PNG loaded.", true);
    } catch (error) {
      setUiStatus(error.message);
      state.stampFileName = null;
      if (!event.target.files?.[0] && els.stampDropText) {
        els.stampDropText.textContent = "Select Stamp";
      }
    } finally {
      syncAssetClearButtons();
    }
  });

  els.esignInput.addEventListener("change", async (event) => {
    try {
      const selectedName = event.target.files?.[0]?.name || null;
      const rawSignDataUrl = await readPngAsDataUrl(
        event.target.files?.[0],
        "E-sign",
      );
      state.signFileName = selectedName;
      state.signSource = "attachment";
      if (els.esignDropText) {
        els.esignDropText.textContent = selectedName || "Select E-sign";
      }
      const trimmedSign = await trimTransparentPng(rawSignDataUrl);
      state.signDataUrl = trimmedSign.dataUrl;
      state.signAspect = trimmedSign.aspect;
      state.signWidthScale = trimmedSign.widthScale;
      await syncAssetsCacheIfEnabled();
      signInputSwitcherApi?.setMode("attachment");
      refreshPreviews();
      setUiStatus("E-sign PNG loaded and trimmed.", true);
    } catch (error) {
      setUiStatus(error.message);
      state.signFileName = null;
      state.signSource = null;
      if (!event.target.files?.[0] && els.esignDropText) {
        els.esignDropText.textContent = "Select E-sign";
      }
    } finally {
      syncAssetClearButtons();
    }
  });

  els.clearStampBtn?.addEventListener("click", () => {
    if (!state.stampDataUrl) {
      return;
    }
    clearLoadedStamp();
  });

  els.clearEsignBtn?.addEventListener("click", () => {
    if (!state.signDataUrl && !els.esignInput?.files?.length) {
      return;
    }
    clearLoadedEsign();
  });

  let redactDrag = null;

  els.pdfStage.addEventListener("pointerdown", async (event) => {
    if (activeTool !== "redact") {
      return;
    }

    if (!state.pdfDoc) {
      setUiStatus("Upload a PDF first.");
      return;
    }

    const pagePoint = viewer.resolvePagePointFromClient(
      event.clientX,
      event.clientY,
    );
    if (!pagePoint) {
      return;
    }

    event.preventDefault();

    if (pagePoint.pageNumber !== state.currentPage) {
      suppressStageScrollSync = true;
      await viewer.renderPage(pagePoint.pageNumber);
      syncPageNavButtons();
      window.requestAnimationFrame(() => {
        suppressStageScrollSync = false;
      });
    }

    redactDrag = {
      pageNumber: pagePoint.pageNumber,
      start: { x: pagePoint.x, y: pagePoint.y },
      draftEl: null,
    };

    const draft = document.createElement("div");
    draft.className = "redaction-draft";
    els.overlay.appendChild(draft);
    redactDrag.draftEl = draft;

    const onMove = (moveEvent) => {
      if (activeTool !== "redact" || !redactDrag?.draftEl) {
        return;
      }

      const end = canvasPointFromEvent(moveEvent, els.overlay);
      const rect = normalizedRectFromPoints(redactDrag.start, end);
      redactDrag.draftEl.style.left = `${rect.x * 100}%`;
      redactDrag.draftEl.style.top = `${rect.y * 100}%`;
      redactDrag.draftEl.style.width = `${rect.w * 100}%`;
      redactDrag.draftEl.style.height = `${rect.h * 100}%`;
    };

    const onEnd = (endEvent) => {
      if (!redactDrag) {
        return;
      }

      const end = canvasPointFromEvent(endEvent, els.overlay);
      const rect = normalizedRectFromPoints(redactDrag.start, end);
      const targetPage = redactDrag.pageNumber;

      redactDrag.draftEl?.remove();
      redactDrag = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);

      if (rect.w < 0.006 || rect.h < 0.006) {
        return;
      }

      const redactions = getPageRedactions(state, targetPage);
      redactions.push(rect);
      refreshPreviews();
      setUiStatus(`Redaction added on page ${targetPage}.`, true);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  });

  els.overlay.addEventListener("click", (event) => {
    if (activeTool === "redact") {
      return;
    }

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
    clearCurrentPageRedactions(state);
    refreshPreviews();
    setUiStatus(`Cleared marks and redactions on page ${state.currentPage}.`);
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

  els.clearPdfBtn?.addEventListener("click", () => {
    if (!state.pdfDoc) {
      return;
    }
    clearLoadedPdf();
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
      closeSettingsMenu();
      els.composerModal.classList.add("hidden");
    }
  });

  window.addEventListener("resize", () => {
    syncComposerPreviewVisualHeight();
    viewer.handleViewportChange();
  });

  els.pdfStage.addEventListener("scroll", () => {
    if (!state.pdfDoc || stageScrollRafId || suppressStageScrollSync) {
      return;
    }

    stageScrollRafId = window.requestAnimationFrame(async () => {
      stageScrollRafId = null;
      const didChangePage = await viewer.syncPageFromScroll();
      if (didChangePage) {
        syncPageNavButtons();
      }
    });
  });

  els.prevPageBtn.addEventListener("click", async () => {
    await goToPage(state.currentPage - 1);
  });

  els.nextPageBtn.addEventListener("click", async () => {
    await goToPage(state.currentPage + 1);
  });

  els.exportBtn.addEventListener("click", async () => {
    if (isExporting) {
      return;
    }

    setExportLoading(true);
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
    } finally {
      setExportLoading(false);
    }
  });
}

void hasAnyCachedUserAssets().then((hasCached) => {
  const switchEl = els.saveAssetsCacheSwitch;
  if (!switchEl) {
    return;
  }

  switchEl.checked = true;

  if (!hasCached) {
    return;
  }
});

setupDropzone();
hydrateToolbarIcons();
syncFitToggleUi(false);
syncRedactionToggleUi(false);
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
      state.signFileName = "Signature Drawing";
      state.signSource = "drawing";
      state.signAspect = trimmedSign.aspect;
      state.signWidthScale = trimmedSign.widthScale;
      syncAssetsCacheIfEnabled();
      signInputSwitcherApi?.setMode("drawing");
      refreshPreviews();
    });
  },
});
bindEvents();
void restoreCachedAssetsToState();
viewer.renderA4Placeholder();
initAssetSwitcher();
syncStyleControlsUi();
syncAssetClearButtons();
refreshPreviews();
