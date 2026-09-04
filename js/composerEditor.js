const LAYER_INFO = {
  stamp: "Stamp",
  date: "Date",
  sign: "E-sign",
};

const AXIS_RANGE = {
  min: -180,
  max: 180,
};

const SIZE_CONFIG = {
  stamp: { label: "Size", min: 60, max: 300 },
  sign: { label: "Size", min: 80, max: 360 },
  date: { label: "Size", min: 9, max: 22 },
};

const DRAG_SWAP_ZONE_RATIO = 0.34;

export function initComposerEditor({ container, state, getLayerSize, setLayerSize, onChange }) {
  let dragIndex = null;
  let disposeDragGhost = null;

  const endDragSession = () => {
    dragIndex = null;
    disposeDragGhost?.();
    disposeDragGhost = null;
    container.querySelectorAll(".component-card").forEach((item) => {
      item.classList.remove("is-drop-target");
      item.classList.remove("is-dragging");
      item.classList.remove("is-drag-source");
      item.setAttribute("aria-grabbed", "false");
    });
  };

  // Fallback cleanup in case a drag is canceled outside card events.
  document.addEventListener(
    "dragend",
    () => {
      if (dragIndex !== null) {
        endDragSession();
      }
    },
    true
  );

  document.addEventListener(
    "drop",
    () => {
      if (dragIndex !== null) {
        endDragSession();
      }
    },
    true
  );

  window.addEventListener("blur", () => {
    if (dragIndex !== null) {
      endDragSession();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && dragIndex !== null) {
      endDragSession();
    }
  });

  render();

  function render() {
    container.innerHTML = "";

    state.layerOrder.forEach((layerKey, index) => {
      const card = document.createElement("section");
      card.className = "component-card";
      card.draggable = false;
      card.dataset.index = String(index);
      card.dataset.layerKey = layerKey;
      card.setAttribute("aria-grabbed", "false");

      const row = document.createElement("div");
      row.className = "layer-row";

      const handle = document.createElement("span");
      handle.className = "layer-handle";
      handle.textContent = "::";
      handle.setAttribute("aria-hidden", "true");
      handle.draggable = true;

      const name = document.createElement("span");
      name.className = "layer-name";
      name.textContent = LAYER_INFO[layerKey];

      row.appendChild(handle);
      row.appendChild(name);

      const controls = document.createElement("div");
      controls.className = "layer-controls";

      const xControl = createAxisControl(
        "Left / Right",
        state.layerTransforms[layerKey].x,
        (value) => {
          state.layerTransforms[layerKey].x = value;
          onChange();
        }
      );

      const yControl = createAxisControl(
        "Up / Down",
        state.layerTransforms[layerKey].y,
        (value) => {
          state.layerTransforms[layerKey].y = value;
          onChange();
        }
      );

      const sizeControl = createSizeControl(
        SIZE_CONFIG[layerKey],
        Number(getLayerSize(layerKey) ?? 0),
        (value) => {
          setLayerSize(layerKey, value);
          onChange();
        }
      );

      controls.appendChild(xControl);
      controls.appendChild(yControl);
      controls.appendChild(sizeControl);

      handle.addEventListener("dragstart", (event) => {
        disposeDragGhost?.();
        dragIndex = index;
        card.classList.add("is-dragging");
        card.classList.add("is-drag-source");
        card.setAttribute("aria-grabbed", "true");

        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", String(index));

          const { element, dispose } = createDragGhostFromCard(card);
          disposeDragGhost = dispose;
          event.dataTransfer.setDragImage(element, 24, 20);
        }
      });

      handle.addEventListener("dragend", () => {
        endDragSession();
      });

      card.addEventListener("dragover", (event) => {
        event.preventDefault();
        const overIndex = Number(card.dataset.index);

        if (
          dragIndex !== null
          && Number.isFinite(overIndex)
          && dragIndex !== overIndex
          && shouldSwapOnDragOver({
            event,
            card,
            fromIndex: dragIndex,
            toIndex: overIndex,
          })
        ) {
          moveLayerLive(dragIndex, overIndex);
          dragIndex = overIndex;
        }
      });

      card.addEventListener("dragleave", () => {
        card.classList.remove("is-drop-target");
      });

      card.addEventListener("drop", (event) => {
        event.preventDefault();
        endDragSession();
      });

      card.appendChild(row);
      card.appendChild(controls);
      container.appendChild(card);
    });
  }

  function moveLayerLive(fromIndex, toIndex) {
    if (toIndex < 0 || toIndex >= state.layerOrder.length) {
      return;
    }

    const cards = Array.from(container.querySelectorAll(".component-card"));
    const movingCard = cards[fromIndex];
    const targetCard = cards[toIndex];

    if (!movingCard || !targetCard || movingCard === targetCard) {
      return;
    }

    const previousTops = new Map(cards.map((item) => [item, item.getBoundingClientRect().top]));

    const next = [...state.layerOrder];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    state.layerOrder = next;

    if (fromIndex < toIndex) {
      container.insertBefore(movingCard, targetCard.nextSibling);
    } else {
      container.insertBefore(movingCard, targetCard);
    }

    syncCardMeta();
    animateCardSwitch(previousTops);
    onChange();
  }

  function syncCardMeta() {
    const cards = Array.from(container.querySelectorAll(".component-card"));
    cards.forEach((card, index) => {
      const layerKey = state.layerOrder[index];
      card.dataset.index = String(index);
      card.dataset.layerKey = layerKey;
      const name = card.querySelector(".layer-name");
      if (name) {
        name.textContent = LAYER_INFO[layerKey];
      }
    });
  }

  function animateCardSwitch(previousTops) {
    const cards = Array.from(container.querySelectorAll(".component-card"));

    cards.forEach((card) => {
      const previousTop = previousTops.get(card);
      if (typeof previousTop !== "number") {
        return;
      }

      const nextTop = card.getBoundingClientRect().top;
      const deltaY = previousTop - nextTop;
      if (!deltaY) {
        return;
      }

      card.style.transition = "none";
      card.style.transform = `translateY(${deltaY}px)`;

      requestAnimationFrame(() => {
        card.style.transition = "transform 160ms ease";
        card.style.transform = "";
      });

      const clearTransition = () => {
        card.style.transition = "";
      };

      card.addEventListener("transitionend", clearTransition, { once: true });
    });
  }

  return {
    rerender: render,
  };
}

function shouldSwapOnDragOver({ event, card, fromIndex, toIndex }) {
  const rect = card.getBoundingClientRect();
  if (rect.height <= 0) {
    return true;
  }

  const pointerRatioY = (event.clientY - rect.top) / rect.height;
  if (!Number.isFinite(pointerRatioY)) {
    return false;
  }

  if (toIndex > fromIndex) {
    return pointerRatioY >= 1 - DRAG_SWAP_ZONE_RATIO;
  }

  return pointerRatioY <= DRAG_SWAP_ZONE_RATIO;
}

function createDragGhostFromCard(card) {
  const ghost = card.cloneNode(true);
  const rect = card.getBoundingClientRect();

  ghost.classList.add("component-card-drag-ghost");
  ghost.style.position = "fixed";
  ghost.style.left = "-9999px";
  ghost.style.top = "-9999px";
  ghost.style.width = `${Math.max(220, Math.round(rect.width))}px`;
  ghost.style.pointerEvents = "none";
  ghost.style.opacity = "0.96";
  ghost.style.transform = "rotate(-1deg)";
  ghost.style.boxShadow = "0 14px 28px rgba(16, 35, 51, 0.26)";
  ghost.style.borderColor = "#477ca8";
  ghost.style.background = "#f7fbff";
  ghost.style.zIndex = "9999";

  document.body.appendChild(ghost);

  return {
    element: ghost,
    dispose: () => {
      if (ghost.parentNode) {
        ghost.parentNode.removeChild(ghost);
      }
    },
  };
}

function createAxisControl(label, initialValue, onChange) {
  const wrapper = document.createElement("div");
  wrapper.className = "axis-control";

  const title = document.createElement("span");
  title.className = "axis-title";
  title.textContent = label;

  const value = document.createElement("span");
  value.className = "axis-value";
  value.textContent = String(initialValue);

  const number = document.createElement("input");
  number.type = "number";
  number.className = "axis-number";
  number.min = String(AXIS_RANGE.min);
  number.max = String(AXIS_RANGE.max);
  number.step = "1";
  number.value = String(initialValue);

  const range = document.createElement("input");
  range.type = "range";
  range.min = String(AXIS_RANGE.min);
  range.max = String(AXIS_RANGE.max);
  range.step = "1";
  range.value = String(initialValue);

  const applyValue = (rawValue) => {
    const parsed = Number(rawValue);
    const clamped = Math.max(AXIS_RANGE.min, Math.min(AXIS_RANGE.max, Number.isFinite(parsed) ? parsed : 0));
    value.textContent = String(clamped);
    range.value = String(clamped);
    number.value = String(clamped);
    onChange(clamped);
  };

  range.addEventListener("input", () => {
    applyValue(range.value);
  });

  number.addEventListener("input", () => {
    applyValue(number.value);
  });

  number.addEventListener("blur", () => {
    applyValue(number.value);
  });

  wrapper.appendChild(title);
  wrapper.appendChild(number);
  wrapper.appendChild(range);
  wrapper.appendChild(value);

  return wrapper;
}

function createSizeControl(config, initialValue, onChange) {
  const wrapper = document.createElement("div");
  wrapper.className = "axis-control axis-control-size";

  const title = document.createElement("span");
  title.className = "axis-title";
  title.textContent = config.label;

  const number = document.createElement("input");
  number.type = "number";
  number.className = "axis-number";
  number.min = String(config.min);
  number.max = String(config.max);
  number.step = "1";
  number.value = String(initialValue);

  const range = document.createElement("input");
  range.type = "range";
  range.min = String(config.min);
  range.max = String(config.max);
  range.step = "1";
  range.value = String(initialValue);

  const applyValue = (rawValue) => {
    const parsed = Number(rawValue);
    const clamped = Math.max(config.min, Math.min(config.max, Number.isFinite(parsed) ? parsed : initialValue));
    number.value = String(clamped);
    range.value = String(clamped);
    onChange(clamped);
  };

  range.addEventListener("input", () => {
    applyValue(range.value);
  });

  number.addEventListener("input", () => {
    applyValue(number.value);
  });

  number.addEventListener("blur", () => {
    applyValue(number.value);
  });

  wrapper.appendChild(title);
  wrapper.appendChild(number);
  wrapper.appendChild(range);

  return wrapper;
}
