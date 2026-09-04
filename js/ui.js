export function setStatus(statusEl, message, ok = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("ok", ok);
}

const OVERLAY_BOX_OFFSET = 0;

export function getTodayText(formatType) {
  const now = new Date();
  if (formatType === "iso") {
    return now.toISOString().slice(0, 10);
  }
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "long",
    day: "2-digit",
  }).format(now);
}

export function renderMarkers(overlay, placements, previewOptions = {}) {
  overlay.innerHTML = "";
  const { onRemovePlacement } = previewOptions;

  placements.forEach((point, index) => {
    const boundedStart = clampPlacementToOverlay(point, overlay, previewOptions);
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
    const contentBounds = hasVisualContent ? getContentBounds(previewOptions) : null;

    let hook = null;
    let remove = null;

    if (hasVisualContent) {
      preview.classList.add("has-content");
      preview.appendChild(box);

      remove = document.createElement("button");
      remove.type = "button";
      remove.className = "placement-remove placement-remove-content";
      remove.setAttribute("aria-label", "Remove placed mark");
      remove.title = "Remove mark";
      remove.textContent = "x";
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
      remove.className = "placement-remove";
      remove.setAttribute("aria-label", "Remove placed mark");
      remove.title = "Remove mark";
      remove.textContent = "x";
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
          previewOptions
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

  const clampedX = minAnchorX <= maxAnchorX
    ? clamp(currentX, minAnchorX, maxAnchorX)
    : rect.width / 2 - (contentBounds.minX + contentBounds.maxX) / 2;

  const clampedY = minAnchorY <= maxAnchorY
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
    placeholder.textContent = "Upload stamp/e-sign or enable date to preview composition.";
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
