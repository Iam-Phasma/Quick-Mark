export function initSignaturePad({
  signCanvas,
  signCtx,
  clearSignBtn,
  setStatus,
  getPenColor,
  onUseDrawing,
}) {
  const drawState = {
    active: false,
    latched: false,
    hadStroke: false,
    pointerType: "",
    pointerId: null,
    lastX: 0,
    lastY: 0,
  };

  clearSignatureCanvas(signCtx, signCanvas);
  signCtx.lineWidth = 2;
  signCtx.lineCap = "round";
  const resolvePenColor = () => getPenColor?.() || "#101820";
  const applyPenColor = () => {
    const color = resolvePenColor();
    signCtx.strokeStyle = color;
    signCtx.fillStyle = color;
  };

  applyPenColor();

  const start = (event, pointerType = "") => {
    drawState.active = true;
    drawState.hadStroke = true;
    drawState.pointerType = pointerType || drawState.pointerType || "";
    const p = pointToSignCanvas(event, signCanvas);
    drawState.lastX = p.x;
    drawState.lastY = p.y;

    // Draw a dot on tap/click so single-point signatures still appear.
    applyPenColor();
    signCtx.beginPath();
    signCtx.arc(p.x, p.y, 1, 0, Math.PI * 2);
    signCtx.fill();
  };

  const move = (event) => {
    if (!drawState.active) {
      return;
    }

    const p = pointToSignCanvas(event, signCanvas);
    applyPenColor();
    signCtx.beginPath();
    signCtx.moveTo(drawState.lastX, drawState.lastY);
    signCtx.lineTo(p.x, p.y);
    signCtx.stroke();

    drawState.lastX = p.x;
    drawState.lastY = p.y;
  };

  const end = () => {
    if (drawState.active && drawState.hadStroke) {
      onUseDrawing(signCanvas.toDataURL("image/png"));
    }
    drawState.active = false;
    drawState.latched = false;
    drawState.pointerType = "";
    drawState.pointerId = null;
  };

  if (typeof window !== "undefined" && "PointerEvent" in window) {
    signCanvas.addEventListener("pointerdown", (event) => {
      event.preventDefault();

      // Click-to-latch mode for mouse/trackpad: first click starts drawing,
      // second click commits and exits drawing mode.
      if (event.pointerType === "mouse") {
        if (event.button !== 0) {
          return;
        }

        if (drawState.latched) {
          if (drawState.pointerId !== null) {
            signCanvas.releasePointerCapture(drawState.pointerId);
          }
          end();
          return;
        }

        drawState.latched = true;
        drawState.pointerId = event.pointerId;
        signCanvas.setPointerCapture(event.pointerId);
        start(event, event.pointerType);
        return;
      }

      drawState.pointerId = event.pointerId;
      signCanvas.setPointerCapture(event.pointerId);
      start(event, event.pointerType);
    });

    signCanvas.addEventListener("pointermove", (event) => {
      event.preventDefault();

      if (!drawState.active) {
        return;
      }

      if (drawState.latched && drawState.pointerType === "mouse") {
        move(event);
        return;
      }

      if (event.pointerType === "mouse" && (event.buttons & 1) !== 1) {
        return;
      }

      move(event);
    });

    signCanvas.addEventListener("pointerup", (event) => {
      // In latched mouse mode, keep drawing active after mouseup so soft glide
      // can continue without holding the click.
      if (drawState.latched && drawState.pointerType === "mouse") {
        return;
      }

      if (drawState.pointerId !== null) {
        signCanvas.releasePointerCapture(event.pointerId);
      }
      end();
    });

    signCanvas.addEventListener("pointercancel", (event) => {
      if (drawState.pointerId !== null) {
        signCanvas.releasePointerCapture(event.pointerId);
      }
      end();
    });
  } else {
    signCanvas.addEventListener("mousedown", (event) => {
      event.preventDefault();
      start(event, "mouse");
    });
    signCanvas.addEventListener("mousemove", (event) => {
      event.preventDefault();
      move(event);
    });
    window.addEventListener("mouseup", end);

    signCanvas.addEventListener(
      "touchstart",
      (event) => {
        event.preventDefault();
        start(event, "touch");
      },
      { passive: false },
    );
    signCanvas.addEventListener(
      "touchmove",
      (event) => {
        event.preventDefault();
        move(event);
      },
      { passive: false },
    );
    signCanvas.addEventListener("touchend", end);
    signCanvas.addEventListener("touchcancel", end);
  }

  clearSignBtn.addEventListener("click", () => {
    clearSignatureCanvas(signCtx, signCanvas);
    drawState.hadStroke = false;
    setStatus("Signature drawing cleared.");
  });

  return {
    setPenColor: () => {
      applyPenColor();
    },
    loadFromDataUrl: (dataUrl) => {
      if (!dataUrl) {
        return;
      }

      const img = new Image();
      img.onload = () => {
        clearSignatureCanvas(signCtx, signCanvas);

        const canvasWidth = signCanvas.width;
        const canvasHeight = signCanvas.height;
        const imageWidth = img.naturalWidth || img.width || 1;
        const imageHeight = img.naturalHeight || img.height || 1;
        const scale = Math.min(canvasWidth / imageWidth, canvasHeight / imageHeight);

        const drawWidth = Math.max(1, Math.round(imageWidth * scale));
        const drawHeight = Math.max(1, Math.round(imageHeight * scale));
        const dx = Math.round((canvasWidth - drawWidth) / 2);
        const dy = Math.round((canvasHeight - drawHeight) / 2);

        signCtx.drawImage(img, dx, dy, drawWidth, drawHeight);
        drawState.hadStroke = true;
      };
      img.src = dataUrl;
    },
  };
}

function clearSignatureCanvas(signCtx, signCanvas) {
  signCtx.clearRect(0, 0, signCanvas.width, signCanvas.height);
}

function pointToSignCanvas(event, signCanvas) {
  const source =
    event.touches && event.touches.length > 0
      ? event.touches[0]
      : event.changedTouches && event.changedTouches.length > 0
        ? event.changedTouches[0]
        : event;

  const rect = signCanvas.getBoundingClientRect();
  const scaleX = signCanvas.width / rect.width;
  const scaleY = signCanvas.height / rect.height;
  return {
    x: (source.clientX - rect.left) * scaleX,
    y: (source.clientY - rect.top) * scaleY,
  };
}
