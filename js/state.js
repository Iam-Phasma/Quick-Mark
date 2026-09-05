export function createAppState() {
  return {
    pdfBytes: null,
    pdfDoc: null,
    currentPage: 1,
    stampDataUrl: null,
    stampWidth: 140,
    stampAspect: 1,
    signDataUrl: null,
    signWidth: 180,
    signAspect: 0.375,
    signWidthScale: 1,
    penTone: "black",
    penSaturation: 100,
    dateFontSize: 12,
    dateFontFamily: "sans",
    dateFontWeight: "500",
    dateTone: "black",
    dateSaturation: 100,
    layerOrder: ["sign", "date", "stamp"],
    layerTransforms: {
      stamp: { x: 0, y: 0 },
      date: { x: 0, y: 0 },
      sign: { x: 0, y: 0 },
    },
    placementsByPage: new Map(),
  };
}

export function getPagePlacements(state, pageNumber) {
  if (!state.placementsByPage.has(pageNumber)) {
    state.placementsByPage.set(pageNumber, []);
  }
  return state.placementsByPage.get(pageNumber);
}

export function clearCurrentPagePlacements(state) {
  state.placementsByPage.set(state.currentPage, []);
}

export function totalPlacementCount(state) {
  return [...state.placementsByPage.values()].reduce((count, list) => count + list.length, 0);
}

export function resetPlacements(state) {
  state.placementsByPage = new Map();
}
