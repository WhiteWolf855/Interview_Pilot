/** Colour tokens for both themes. The contrast test reads this same object. */
export const THEMES = {
  light: {
    bg: "#f6f6f3",
    surface: "#ffffff",
    sunken: "#eeeeea",
    text: "#1a1c21",
    muted: "#555b69",
    border: "#c9cdd6",
    accent: "#2b46c8",
    onAccent: "#ffffff",
    accentSoft: "#e6eafc",
    good: "#17693f",
    goodSoft: "#e2f3ea",
    warn: "#8a4f00",
    warnSoft: "#fbefd9",
    bad: "#a8231c",
    badSoft: "#fbe6e4",
    codeBg: "#16181d",
    codeText: "#e8eaf0",
  },
  dark: {
    bg: "#0f1115",
    surface: "#181b21",
    sunken: "#12141a",
    text: "#eceef2",
    muted: "#a6adbb",
    border: "#3a404c",
    accent: "#9db0ff",
    onAccent: "#0b1030",
    accentSoft: "#1f2647",
    good: "#6ad7a1",
    goodSoft: "#12301f",
    warn: "#f2bd6a",
    warnSoft: "#33260d",
    bad: "#ff9389",
    badSoft: "#3a1512",
    codeBg: "#0a0c10",
    codeText: "#e8eaf0",
  },
} as const;

export type ThemeName = keyof typeof THEMES;

const cssName = (key: string) => `--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

function block(theme: ThemeName): string {
  return Object.entries(THEMES[theme])
    .map(([key, value]) => `${cssName(key)}:${value};`)
    .join("");
}

/** CSS custom properties: system preference by default, overridden by an explicit choice. */
export function themeCss(): string {
  return [
    `:root{${block("light")}color-scheme:light;}`,
    `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${block("dark")}color-scheme:dark;}}`,
    `:root[data-theme="dark"]{${block("dark")}color-scheme:dark;}`,
  ].join("");
}

/** WCAG relative luminance contrast ratio between two hex colours. */
export function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}
