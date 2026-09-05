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
    hadStroke: false,
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

  const start = (event) => {
    drawState.active = true;
    drawState.hadStroke = true;
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
  };

  signCanvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    signCanvas.setPointerCapture(event.pointerId);
    start(event);
  });
  signCanvas.addEventListener("pointermove", (event) => {
    event.preventDefault();
    move(event);
  });
  signCanvas.addEventListener("pointerup", (event) => {
    end();
    signCanvas.releasePointerCapture(event.pointerId);
  });
  signCanvas.addEventListener("pointercancel", end);

  signCanvas.addEventListener("mousedown", (event) => {
    event.preventDefault();
    start(event);
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
      start(event);
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

  clearSignBtn.addEventListener("click", () => {
    clearSignatureCanvas(signCtx, signCanvas);
    drawState.hadStroke = false;
    setStatus("Signature drawing cleared.");
  });

  return {
    setPenColor: () => {
      applyPenColor();
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
