const TONE_CONFIG = {
  black: { hue: 210, lightness: 14, isNeutral: true },
  red: { hue: 6, lightness: 42 },
  orange: { hue: 28, lightness: 48 },
  yellow: { hue: 50, lightness: 45 },
  green: { hue: 145, lightness: 36 },
  blue: { hue: 216, lightness: 42 },
  indigo: { hue: 256, lightness: 44 },
  violet: { hue: 286, lightness: 46 },
};

const FONT_CONFIG = {
  sans: {
    css: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    pdf: "Helvetica",
  },
  serif: {
    css: '"Times New Roman", Times, serif',
    pdf: "TimesRoman",
  },
  mono: {
    css: '"Courier New", Courier, monospace',
    pdf: "Courier",
  },
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getToneConfig(toneKey) {
  return TONE_CONFIG[toneKey] || TONE_CONFIG.black;
}

export function resolveToneCssColor(toneKey = "black", saturationPercent = 100) {
  const tone = getToneConfig(toneKey);

  if (tone.isNeutral) {
    return `hsl(${tone.hue} 10% ${tone.lightness}%)`;
  }

  const safeSat = clamp(Number(saturationPercent) || 100, 0, 100);
  const sat = Math.round(22 + safeSat * 0.68);
  return `hsl(${tone.hue} ${sat}% ${tone.lightness}%)`;
}

export function resolveToneRgb(toneKey = "black", saturationPercent = 100) {
  const tone = getToneConfig(toneKey);

  if (tone.isNeutral) {
    return hslToRgbNormalized(tone.hue, 10, tone.lightness);
  }

  const safeSat = clamp(Number(saturationPercent) || 100, 0, 100);
  const sat = 22 + safeSat * 0.68;
  return hslToRgbNormalized(tone.hue, sat, tone.lightness);
}

export function resolveDateFontCss(fontKey = "sans") {
  return (FONT_CONFIG[fontKey] || FONT_CONFIG.sans).css;
}

export function resolveDatePdfFontName(fontKey = "sans") {
  return (FONT_CONFIG[fontKey] || FONT_CONFIG.sans).pdf;
}

function hslToRgbNormalized(hueDeg, satPercent, lightPercent) {
  const h = ((Number(hueDeg) || 0) % 360 + 360) % 360;
  const s = clamp((Number(satPercent) || 0) / 100, 0, 1);
  const l = clamp((Number(lightPercent) || 0) / 100, 0, 1);

  if (s === 0) {
    return { r: l, g: l, b: l };
  }

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hPrime = h / 60;
  const x = c * (1 - Math.abs((hPrime % 2) - 1));

  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (hPrime >= 0 && hPrime < 1) {
    r1 = c;
    g1 = x;
  } else if (hPrime >= 1 && hPrime < 2) {
    r1 = x;
    g1 = c;
  } else if (hPrime >= 2 && hPrime < 3) {
    g1 = c;
    b1 = x;
  } else if (hPrime >= 3 && hPrime < 4) {
    g1 = x;
    b1 = c;
  } else if (hPrime >= 4 && hPrime < 5) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }

  const m = l - c / 2;
  return {
    r: clamp(r1 + m, 0, 1),
    g: clamp(g1 + m, 0, 1),
    b: clamp(b1 + m, 0, 1),
  };
}
