import dragula from "dragula";

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

export function initComposerEditor({ container, state, getLayerSize, setLayerSize, onChange }) {
  let drake = null;

  const clearDragVisualState = () => {
    container.querySelectorAll(".component-card").forEach((item) => {
      item.classList.remove("is-drop-target");
      item.classList.remove("is-dragging");
      item.setAttribute("aria-grabbed", "false");
    });
  };

  const syncOrderFromDom = () => {
    const cards = Array.from(container.querySelectorAll(".component-card"));
    const nextOrder = cards.map((card) => card.dataset.layerKey).filter(Boolean);

    if (nextOrder.length !== state.layerOrder.length) {
      syncCardMeta();
      return;
    }

    const isChanged = nextOrder.some((layerKey, index) => layerKey !== state.layerOrder[index]);
    if (!isChanged) {
      syncCardMeta();
      return;
    }

    state.layerOrder = [...nextOrder];
    syncCardMeta();
    onChange();
  };

  const initDragLayerSorting = () => {
    drake?.destroy();

    drake = dragula([container], {
      direction: "vertical",
      revertOnSpill: true,
      mirrorContainer: document.body,
      ignoreInputTextSelection: true,
      moves: (_el, _source, handle) => {
        return Boolean(handle?.classList?.contains("layer-handle"));
      },
    });

    drake.on("drag", (item) => {
      clearDragVisualState();
      item.classList.add("is-dragging");
      item.setAttribute("aria-grabbed", "true");
    });

    drake.on("over", (item, target, source) => {
      if (target !== container || source !== container) {
        return;
      }

      container.querySelectorAll(".component-card").forEach((card) => {
        card.classList.toggle("is-drop-target", card !== item);
      });
    });

    drake.on("drop", (item, target) => {
      if (target === container) {
        syncOrderFromDom();
      }

      clearDragVisualState();
    });

    drake.on("cancel", () => {
      clearDragVisualState();
      syncCardMeta();
    });

    drake.on("dragend", () => {
      clearDragVisualState();
    });
  };

  render();
  initDragLayerSorting();

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

      card.appendChild(row);
      card.appendChild(controls);
      container.appendChild(card);
    });
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


  return {
    rerender: render,
    destroy: () => {
      drake?.destroy();
      drake = null;
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
