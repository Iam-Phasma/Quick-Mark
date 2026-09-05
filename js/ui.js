export function setStatus(statusEl, message, ok = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("ok", ok);
}

const OVERLAY_BOX_OFFSET = 0;

export function getTodayText(formatType, includeSeparator = true) {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = String(now.getFullYear());
  const monthShort = new Intl.DateTimeFormat("en-US", {
    month: "short",
  }).format(now);
  const monthShortUpper = monthShort.toUpperCase();
  const sep = includeSeparator ? "-" : " ";

  if (formatType === "mmm-dd-yyyy") {
    return `${monthShort}${sep}${day}${sep}${year}`;
  }

  if (formatType === "mmm-dd-yyyy-upper") {
    return `${monthShortUpper}${sep}${day}${sep}${year}`;
  }

  if (formatType === "iso") {
    return includeSeparator
      ? now.toISOString().slice(0, 10)
      : `${year} ${month} ${day}`;
  }

  if (formatType === "mm-dd-yyyy") {
    return `${month}${sep}${day}${sep}${year}`;
  }

  if (formatType === "dd-mm-yyyy") {
    return `${day}${sep}${month}${sep}${year}`;
  }

  if (formatType === "dd-mmm-yyyy") {
    return `${day}${sep}${monthShort}${sep}${year}`;
  }

  if (formatType === "dd-mmm-yyyy-upper") {
    return `${day}${sep}${monthShortUpper}${sep}${year}`;
  }

  if (includeSeparator) {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "long",
      day: "2-digit",
    }).format(now);
  }

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "2-digit",
  })
    .format(now)
    .replace(/,/g, "");
}

export function renderMarkers(overlay, placements, previewOptions = {}) {
  overlay.innerHTML = "";
  const { onRemovePlacement } = previewOptions;

  placements.forEach((point, index) => {
    const boundedStart = clampPlacementToOverlay(
      point,
      overlay,
      previewOptions,
    );
    placements[index].x = boundedStart.x;
    placements[index].y = boundedStart.y;

    const preview = document.createElement("div");
    preview.className = "placement-preview";
    preview.style.left = `${boundedStart.x * 100}%`;
    preview.style.top = `${boundedStart.y * 100}%`;

    const anchor = document.createElement("div");
    anchor.className = "placement-anchor";
    preview.appendChild(anchor);

    const box = buildCompositionBox(previewOptions, "overlay");
    const hasVisualContent = box.childElementCount > 0;
    const contentBounds = hasVisualContent
      ? getContentBounds(previewOptions)
      : null;

    let hook = null;
    let remove = null;

    if (hasVisualContent) {
      preview.classList.add("has-content");
      preview.appendChild(box);

      remove = document.createElement("button");
      remove.type = "button";
      remove.className = "close-btn placement-remove-content";
      remove.setAttribute("aria-label", "Remove placed mark");
      remove.title = "Remove mark";
      if (contentBounds) {
        // Keep remove near the mark, but outside constrained mark bounds.
        remove.style.left = `${contentBounds.maxX + 12}px`;
        remove.style.top = `${contentBounds.minY - 12}px`;
      }
      preview.appendChild(remove);
    } else {
      hook = document.createElement("button");
      hook.type = "button";
      hook.className = "placement-hook";
      hook.setAttribute("aria-label", "Drag placed mark");
      hook.title = "Drag";
      hook.textContent = "+";
      preview.appendChild(hook);

      remove = document.createElement("button");
      remove.type = "button";
      remove.className = "close-btn";
      remove.setAttribute("aria-label", "Remove placed mark");
      remove.title = "Remove mark";
      preview.appendChild(remove);
    }

    // If no visual assets are configured, keep anchor visible for click feedback.
    overlay.appendChild(preview);

    if (hook) {
      hook.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
    }

    remove.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });

    remove.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onRemovePlacement?.(index);
    });

    const beginPlacementDrag = (event) => {
      event.preventDefault();
      event.stopPropagation();

      preview.classList.add("is-dragging");
      const overlayRect = overlay.getBoundingClientRect();
      const startClientX = event.clientX;
      const startClientY = event.clientY;
      const startPointX = placements[index].x;
      const startPointY = placements[index].y;

      const onMove = (moveEvent) => {
        const dx = (moveEvent.clientX - startClientX) / overlayRect.width;
        const dy = (moveEvent.clientY - startClientY) / overlayRect.height;
        const next = clampPlacementToOverlay(
          {
            x: startPointX + dx,
            y: startPointY + dy,
          },
          overlay,
          previewOptions,
        );

        placements[index].x = next.x;
        placements[index].y = next.y;
        preview.style.left = `${next.x * 100}%`;
        preview.style.top = `${next.y * 100}%`;
      };

      const onEnd = () => {
        preview.classList.remove("is-dragging");
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onEnd);
        window.removeEventListener("pointercancel", onEnd);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onEnd);
      window.addEventListener("pointercancel", onEnd);
    };

    if (hook) {
      hook.addEventListener("pointerdown", beginPlacementDrag);
    }

    if (hasVisualContent) {
      box.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      box.addEventListener("pointerdown", beginPlacementDrag);
    }
  });
}

export function renderRedactions(overlay, redactions = [], options = {}) {
  const {
    editable = false,
    onRemoveRedaction,
    onRedactionUpdated,
  } = options;

  redactions.forEach((item, index) => {
    const box = document.createElement("div");
    box.className = "redaction-box";

    if (editable) {
      box.classList.add("is-editable");
      box.title = "Drag to move";

      const resizeHandle = document.createElement("button");
      resizeHandle.type = "button";
      resizeHandle.className = "redaction-resize-handle";
      resizeHandle.setAttribute("aria-label", "Resize redaction");
      resizeHandle.title = "Resize";

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "redaction-remove-btn";
      removeBtn.setAttribute("aria-label", "Remove redaction");
      removeBtn.title = "Remove redaction";
      removeBtn.textContent = "x";

      removeBtn.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });

      removeBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onRemoveRedaction?.(index);
      });

      enableRedactionMove({
        overlay,
        box,
        redaction: item,
        onUpdate: onRedactionUpdated,
        index,
      });

      enableRedactionResize({
        overlay,
        box,
        handle: resizeHandle,
        redaction: item,
        onUpdate: onRedactionUpdated,
        index,
      });

      box.appendChild(resizeHandle);
      box.appendChild(removeBtn);
    }

    applyRedactionStyle(box, item);
    overlay.appendChild(box);
  });
}

function applyRedactionStyle(box, redaction) {
  box.style.left = `${redaction.x * 100}%`;
  box.style.top = `${redaction.y * 100}%`;
  box.style.width = `${redaction.w * 100}%`;
  box.style.height = `${redaction.h * 100}%`;
}

function enableRedactionMove({ overlay, box, redaction, onUpdate, index }) {
  box.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".redaction-resize-handle, .redaction-remove-btn")) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startY = event.clientY;
    const rect = overlay.getBoundingClientRect();
    const start = { ...redaction };

    box.setPointerCapture(event.pointerId);

    const onMove = (moveEvent) => {
      const dx = (moveEvent.clientX - startX) / rect.width;
      const dy = (moveEvent.clientY - startY) / rect.height;
      const next = clampRedactionRect({
        x: start.x + dx,
        y: start.y + dy,
        w: start.w,
        h: start.h,
      });

      redaction.x = next.x;
      redaction.y = next.y;
      applyRedactionStyle(box, redaction);
      onUpdate?.(index, { ...next }, false);
    };

    const onEnd = () => {
      box.removeEventListener("pointermove", onMove);
      box.removeEventListener("pointerup", onEnd);
      box.removeEventListener("pointercancel", onEnd);
      onUpdate?.(index, { ...redaction }, true);
    };

    box.addEventListener("pointermove", onMove);
    box.addEventListener("pointerup", onEnd);
    box.addEventListener("pointercancel", onEnd);
  });
}

function enableRedactionResize({ overlay, box, handle, redaction, onUpdate, index }) {
  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startY = event.clientY;
    const rect = overlay.getBoundingClientRect();
    const start = { ...redaction };

    handle.setPointerCapture(event.pointerId);

    const onMove = (moveEvent) => {
      const dx = (moveEvent.clientX - startX) / rect.width;
      const dy = (moveEvent.clientY - startY) / rect.height;

      const next = clampRedactionRect({
        x: start.x,
        y: start.y,
        w: start.w + dx,
        h: start.h + dy,
      });

      redaction.x = next.x;
      redaction.y = next.y;
      redaction.w = next.w;
      redaction.h = next.h;
      applyRedactionStyle(box, redaction);
      onUpdate?.(index, { ...next }, false);
    };

    const onEnd = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onEnd);
      handle.removeEventListener("pointercancel", onEnd);
      onUpdate?.(index, { ...redaction }, true);
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onEnd);
    handle.addEventListener("pointercancel", onEnd);
  });
}

function clampRedactionRect(rect) {
  const minSize = 0.006;
  const safeW = Math.max(minSize, Math.min(1, rect.w));
  const safeH = Math.max(minSize, Math.min(1, rect.h));
  const safeX = Math.max(0, Math.min(1 - safeW, rect.x));
  const safeY = Math.max(0, Math.min(1 - safeH, rect.y));

  return {
    x: safeX,
    y: safeY,
    w: safeW,
    h: safeH,
  };
}

export function normalizedRectFromPoints(startPoint, endPoint) {
  const x1 = Math.max(0, Math.min(1, startPoint.x));
  const y1 = Math.max(0, Math.min(1, startPoint.y));
  const x2 = Math.max(0, Math.min(1, endPoint.x));
  const y2 = Math.max(0, Math.min(1, endPoint.y));

  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1),
  };
}

function clampPlacementToOverlay(point, overlay, previewOptions = {}) {
  const rect = overlay.getBoundingClientRect();

  if (rect.width <= 0 || rect.height <= 0) {
    return {
      x: Math.max(0, Math.min(1, point.x)),
      y: Math.max(0, Math.min(1, point.y)),
    };
  }

  const contentBounds = getContentBounds(previewOptions);
  if (!contentBounds) {
    return {
      x: Math.max(0, Math.min(1, point.x)),
      y: Math.max(0, Math.min(1, point.y)),
    };
  }

  const minAnchorX = -contentBounds.minX;
  const maxAnchorX = rect.width - contentBounds.maxX;
  const minAnchorY = -contentBounds.minY;
  const maxAnchorY = rect.height - contentBounds.maxY;

  const currentX = point.x * rect.width;
  const currentY = point.y * rect.height;

  const clampedX =
    minAnchorX <= maxAnchorX
      ? clamp(currentX, minAnchorX, maxAnchorX)
      : rect.width / 2 - (contentBounds.minX + contentBounds.maxX) / 2;

  const clampedY =
    minAnchorY <= maxAnchorY
      ? clamp(currentY, minAnchorY, maxAnchorY)
      : rect.height / 2 - (contentBounds.minY + contentBounds.maxY) / 2;

  return {
    x: clampedX / rect.width,
    y: clampedY / rect.height,
  };
}

function getContentBounds(previewOptions = {}) {
  const {
    stampDataUrl = null,
    signDataUrl = null,
    includeDate = false,
    dateText = "",
    stampWidth = 140,
    signWidth = 180,
    dateFontSize = 12,
    layerOrder = ["sign", "date", "stamp"],
    layerTransforms = {},
    boxWidth = 260,
    boxHeight = 160,
    boxPadding = 6,
    stampAspect = 1,
    signAspect = 0.38,
  } = previewOptions;

  const contentWidth = Math.max(0, boxWidth - boxPadding * 2);
  const contentHeight = Math.max(0, boxHeight - boxPadding * 2);
  const centerBaseX = OVERLAY_BOX_OFFSET + boxPadding + contentWidth / 2;
  const centerBaseY = OVERLAY_BOX_OFFSET + boxPadding + contentHeight / 2;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const layer of layerOrder) {
    const offset = layerTransforms[layer] || { x: 0, y: 0 };
    const centerX = centerBaseX + (Number(offset.x) || 0);
    const centerY = centerBaseY + (Number(offset.y) || 0);

    let width = 0;
    let height = 0;

    if (layer === "stamp" && stampDataUrl) {
      width = stampWidth;
      height = stampWidth * Math.max(0.05, Number(stampAspect) || 1);
    } else if (layer === "sign" && signDataUrl) {
      width = signWidth;
      height = signWidth * Math.max(0.05, Number(signAspect) || 0.38);
    } else if (layer === "date" && includeDate) {
      width = estimateDateWidth(dateText, dateFontSize);
      height = dateFontSize + 6;
    } else {
      continue;
    }

    minX = Math.min(minX, centerX - width / 2);
    maxX = Math.max(maxX, centerX + width / 2);
    minY = Math.min(minY, centerY - height / 2);
    maxY = Math.max(maxY, centerY + height / 2);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

export function renderComposerPreview(container, previewOptions = {}) {
  container.innerHTML = "";
  const boxWidth = Number(previewOptions.boxWidth ?? 260);
  const boxHeight = Number(previewOptions.boxHeight ?? 160);
  container.style.width = `${boxWidth + 2}px`;
  container.style.height = "";
  container.style.minHeight = `${boxHeight + 2}px`;

  const preview = document.createElement("div");
  preview.className = "placement-preview";

  const anchor = document.createElement("div");
  anchor.className = "placement-anchor";
  preview.appendChild(anchor);

  const box = buildCompositionBox(previewOptions, "composer");
  if (box.childElementCount > 0) {
    preview.appendChild(box);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "composer-placeholder";
    placeholder.textContent =
      "Upload stamp/e-sign or enable date to preview composition.";
    preview.appendChild(placeholder);
  }

  container.appendChild(preview);
}

function buildCompositionBox(previewOptions = {}, mode = "overlay") {
  const {
    stampDataUrl = null,
    signDataUrl = null,
    includeDate = false,
    dateText = "",
    stampWidth = 140,
    signWidth = 180,
    dateFontSize = 12,
    dateFontFamily,
    dateFontWeight,
    dateColor,
    layerOrder = ["sign", "date", "stamp"],
    layerTransforms = {},
    boxWidth = 260,
    boxHeight = 160,
    boxPadding = 6,
    onComposerTransformCommit,
  } = previewOptions;
  const isComposerMode = mode === "composer";

  const box = document.createElement("div");
  box.className = "placement-compose-box";
  box.style.width = `${boxWidth}px`;
  box.style.height = `${boxHeight}px`;
  box.style.padding = `${boxPadding}px`;
  box.style.setProperty("--composer-padding", `${boxPadding}px`);

  // Stack semantics: first item in layerOrder is frontmost, so draw in reverse.
  for (const layer of [...layerOrder].reverse()) {
    const offset = layerTransforms[layer] || { x: 0, y: 0 };
    const layerEl = createLayerElement({
      layer,
      isComposerMode,
      stampDataUrl,
      signDataUrl,
      includeDate,
      dateText,
      stampWidth,
      signWidth,
      dateFontSize,
      dateFontFamily,
      dateFontWeight,
      dateColor,
    });

    if (!layerEl) {
      continue;
    }

    layerEl.style.left = `calc(50% + ${offset.x}px)`;
    layerEl.style.top = `calc(50% + ${offset.y}px)`;

    if (isComposerMode) {
      enableComposerLayerDrag({
        layerEl,
        offset,
        onCommit: onComposerTransformCommit,
      });
    }

    box.appendChild(layerEl);
  }

  return box;
}

function createLayerElement({
  layer,
  isComposerMode,
  stampDataUrl,
  signDataUrl,
  includeDate,
  dateText,
  stampWidth,
  signWidth,
  dateFontSize,
  dateFontFamily,
  dateFontWeight,
  dateColor,
}) {
  if (layer === "stamp") {
    if (stampDataUrl) {
      const stampImg = document.createElement("img");
      stampImg.className = "placement-layer placement-stamp";
      stampImg.src = stampDataUrl;
      stampImg.alt = "Stamp preview";
      stampImg.style.width = `${stampWidth}px`;
      return stampImg;
    }

    if (isComposerMode) {
      return createGhostLayer("Stamp (upload PNG)");
    }
    return null;
  }

  if (layer === "date") {
    if (includeDate) {
      const date = document.createElement("div");
      date.className = "placement-layer placement-date";
      date.textContent = dateText;
      date.style.fontSize = `${dateFontSize}px`;
      if (dateFontFamily) {
        date.style.fontFamily = dateFontFamily;
      }
      if (dateFontWeight) {
        date.style.fontWeight = String(dateFontWeight);
      }
      if (dateColor) {
        date.style.color = dateColor;
      }
      return date;
    }

    if (isComposerMode) {
      return createGhostLayer("Date (disabled)");
    }
    return null;
  }

  if (layer === "sign") {
    if (signDataUrl) {
      const signImg = document.createElement("img");
      signImg.className = "placement-layer placement-sign";
      signImg.src = signDataUrl;
      signImg.alt = "E-sign preview";
      signImg.style.width = `${signWidth}px`;
      return signImg;
    }

    if (isComposerMode) {
      return createGhostLayer("E-sign (upload/draw)");
    }
  }

  return null;
}

function createGhostLayer(text) {
  const ghost = document.createElement("div");
  ghost.className = "placement-layer placement-ghost";
  ghost.textContent = text;
  return ghost;
}

function enableComposerLayerDrag({ layerEl, offset, onCommit }) {
  layerEl.classList.add("composer-draggable-layer");
  layerEl.title = "Drag to position";

  layerEl.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startY = event.clientY;
    const baseX = Number(offset.x) || 0;
    const baseY = Number(offset.y) || 0;

    layerEl.classList.add("is-dragging-layer");

    const onMove = (moveEvent) => {
      const dx = Math.round(moveEvent.clientX - startX);
      const dy = Math.round(moveEvent.clientY - startY);
      offset.x = clamp(baseX + dx, -180, 180);
      offset.y = clamp(baseY + dy, -180, 180);
      layerEl.style.left = `calc(50% + ${offset.x}px)`;
      layerEl.style.top = `calc(50% + ${offset.y}px)`;
    };

    const onEnd = () => {
      layerEl.classList.remove("is-dragging-layer");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      onCommit?.();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function estimateDateWidth(text, fontSizePx) {
  return text.length * (fontSizePx * 0.58) + 8;
}

export function canvasPointFromEvent(event, element) {
  return canvasPointFromClient(event.clientX, event.clientY, element);
}

export function placementPointFromEvent(event, overlay, previewOptions = {}) {
  const clickPoint = canvasPointFromEvent(event, overlay);
  const rect = overlay.getBoundingClientRect();

  if (rect.width <= 0 || rect.height <= 0) {
    return clickPoint;
  }

  const contentBounds = getContentBounds(previewOptions);
  if (!contentBounds) {
    return clampPlacementToOverlay(clickPoint, overlay, previewOptions);
  }

  // Convert click point into anchor point so the visible content is centered at the cursor.
  const clickX = clickPoint.x * rect.width;
  const clickY = clickPoint.y * rect.height;
  const contentCenterX = (contentBounds.minX + contentBounds.maxX) / 2;
  const contentCenterY = (contentBounds.minY + contentBounds.maxY) / 2;

  const anchorPoint = {
    x: (clickX - contentCenterX) / rect.width,
    y: (clickY - contentCenterY) / rect.height,
  };

  return clampPlacementToOverlay(anchorPoint, overlay, previewOptions);
}

function canvasPointFromClient(clientX, clientY, element) {
  const rect = element.getBoundingClientRect();
  const px = (clientX - rect.left) / rect.width;
  const py = (clientY - rect.top) / rect.height;
  return {
    x: Math.max(0, Math.min(1, px)),
    y: Math.max(0, Math.min(1, py)),
  };
}

export function readPngAsDataUrl(file, label) {
  return new Promise((resolve, reject) => {
    if (!isPngFile(file)) {
      reject(new Error(`${label} must be a PNG file.`));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Failed to read ${label}.`));
    reader.readAsDataURL(file);
  });
}

function isPngFile(file) {
  if (!file) {
    return false;
  }

  const type = (file.type || "").toLowerCase();
  const name = (file.name || "").toLowerCase();

  if (name.endsWith(".png")) {
    return true;
  }

  return type === "image/png" || type === "image/x-png";
}
