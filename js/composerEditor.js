const LAYER_INFO = {
  stamp: "Stamp",
  date: "Date",
  sign: "E-sign",
};

const AXIS_RANGE = {
  min: -180,
  max: 180,
};

export function initComposerEditor({ container, state, onChange }) {
  let dragIndex = null;

  render();

  function render() {
    container.innerHTML = "";

    state.layerOrder.forEach((layerKey, index) => {
      const card = document.createElement("section");
      card.className = "component-card";
      card.draggable = true;
      card.dataset.index = String(index);
      card.setAttribute("aria-grabbed", "false");

      const row = document.createElement("div");
      row.className = "layer-row";

      const handle = document.createElement("span");
      handle.className = "layer-handle";
      handle.textContent = "::";
      handle.setAttribute("aria-hidden", "true");

      const name = document.createElement("span");
      name.className = "layer-name";
      name.textContent = `${index + 1}. ${LAYER_INFO[layerKey]}`;

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

      controls.appendChild(xControl);
      controls.appendChild(yControl);

      card.addEventListener("dragstart", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement) || !target.classList.contains("layer-handle")) {
          event.preventDefault();
          return;
        }

        dragIndex = index;
        card.classList.add("is-dragging");
        card.setAttribute("aria-grabbed", "true");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", String(index));
        }
      });

      card.addEventListener("dragend", () => {
        dragIndex = null;
        card.classList.remove("is-dragging");
        card.setAttribute("aria-grabbed", "false");
        container.querySelectorAll(".component-card").forEach((item) => {
          item.classList.remove("is-drop-target");
        });
      });

      card.addEventListener("dragover", (event) => {
        event.preventDefault();
        if (dragIndex !== null && dragIndex !== index) {
          card.classList.add("is-drop-target");
        }
      });

      card.addEventListener("dragleave", () => {
        card.classList.remove("is-drop-target");
      });

      card.addEventListener("drop", (event) => {
        event.preventDefault();
        card.classList.remove("is-drop-target");

        if (dragIndex === null || dragIndex === index) {
          return;
        }

        moveLayer(dragIndex, index);
        dragIndex = null;
      });

      card.appendChild(row);
      card.appendChild(controls);
      container.appendChild(card);
    });
  }

  function moveLayer(fromIndex, toIndex) {
    if (toIndex < 0 || toIndex >= state.layerOrder.length) {
      return;
    }

    const next = [...state.layerOrder];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    state.layerOrder = next;
    render();
    onChange();
  }

  return {
    rerender: render,
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
