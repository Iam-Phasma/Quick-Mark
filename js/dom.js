export const els = {
  pdfInput: document.getElementById("pdfInput"),
  pdfDrop: document.getElementById("pdfDrop"),
  pdfDropText: document.getElementById("pdfDropText"),
  stampInput: document.getElementById("stampInput"),
  esignInput: document.getElementById("esignInput"),
  includeDate: document.getElementById("includeDate"),
  dateFormat: document.getElementById("dateFormat"),
  openComposerBtn: document.getElementById("openComposerBtn"),
  composerModal: document.getElementById("composerModal"),
  closeComposerBtn: document.getElementById("closeComposerBtn"),
  composerPreview: document.getElementById("composerPreview"),
  layerEditor: document.getElementById("layerEditor"),
  clearPlacementsBtn: document.getElementById("clearPlacementsBtn"),
  exportBtn: document.getElementById("exportBtn"),
  statusEl: document.getElementById("status"),
  prevPageBtn: document.getElementById("prevPageBtn"),
  nextPageBtn: document.getElementById("nextPageBtn"),
  pageInfo: document.getElementById("pageInfo"),
  pdfCanvas: document.getElementById("pdfCanvas"),
  overlay: document.getElementById("overlay"),
  signCanvas: document.getElementById("signCanvas"),
  clearSignBtn: document.getElementById("clearSignBtn"),
  useSignDrawingBtn: document.getElementById("useSignDrawingBtn"),
};

export const pdfCtx = els.pdfCanvas.getContext("2d");
export const signCtx = els.signCanvas.getContext("2d");
