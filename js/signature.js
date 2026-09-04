export function initSignaturePad({ signCanvas, signCtx, clearSignBtn, useSignDrawingBtn, setStatus, onUseDrawing }) {
  const drawState = {
    active: false,
    hadStroke: false,
    lastX: 0,
    lastY: 0,
  };

  clearSignatureCanvas(signCtx, signCanvas);
  signCtx.lineWidth = 2;
  signCtx.lineCap = "round";
  signCtx.strokeStyle = "#101820";

  const start = (event) => {
    drawState.active = true;
    drawState.hadStroke = true;
    const p = pointToSignCanvas(event, signCanvas);
    drawState.lastX = p.x;
    drawState.lastY = p.y;

    // Draw a dot on tap/click so single-point signatures still appear.
    signCtx.beginPath();
    signCtx.arc(p.x, p.y, 1, 0, Math.PI * 2);
    signCtx.fillStyle = "#101820";
    signCtx.fill();
  };

  const move = (event) => {
    if (!drawState.active) {
      return;
    }

    const p = pointToSignCanvas(event, signCanvas);
    signCtx.beginPath();
    signCtx.moveTo(drawState.lastX, drawState.lastY);
    signCtx.lineTo(p.x, p.y);
    signCtx.stroke();

    drawState.lastX = p.x;
    drawState.lastY = p.y;
  };

  const end = () => {
    drawState.active = false;
  };

  signCanvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    start(event);
  });
  signCanvas.addEventListener("pointermove", (event) => {
    event.preventDefault();
    move(event);
  });
  signCanvas.addEventListener("pointerup", end);
  signCanvas.addEventListener("pointercancel", end);
  signCanvas.addEventListener("pointerleave", end);

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
    { passive: false }
  );
  signCanvas.addEventListener(
    "touchmove",
    (event) => {
      event.preventDefault();
      move(event);
    },
    { passive: false }
  );
  signCanvas.addEventListener("touchend", end);
  signCanvas.addEventListener("touchcancel", end);

  clearSignBtn.addEventListener("click", () => {
    clearSignatureCanvas(signCtx, signCanvas);
    drawState.hadStroke = false;
    setStatus("Signature drawing cleared.");
  });

  useSignDrawingBtn.addEventListener("click", () => {
    if (!drawState.hadStroke) {
      setStatus("Draw a signature first or upload PNG.");
      return;
    }

    onUseDrawing(signCanvas.toDataURL("image/png"));
    setStatus("Using drawn signature.", true);
  });
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
