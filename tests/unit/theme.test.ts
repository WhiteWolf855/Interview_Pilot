import { describe, expect, it } from "vitest";
import { THEMES, contrastRatio, themeCss } from "@/lib/theme";

describe("theme colours", () => {
  it("computes WCAG contrast ratios", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
  });

  for (const name of ["light", "dark"] as const) {
    const t = THEMES[name];
    it(`${name} theme meets WCAG AA for text (4.5:1)`, () => {
      const pairs: [string, string, string][] = [
        ["text on page", t.text, t.bg],
        ["text on card", t.text, t.surface],
        ["text on sunken", t.text, t.sunken],
        ["muted on page", t.muted, t.bg],
        ["muted on card", t.muted, t.surface],
        ["muted on sunken", t.muted, t.sunken],
        ["muted on accent tint", t.muted, t.accentSoft],
        ["link on page", t.accent, t.bg],
        ["link on card", t.accent, t.surface],
        ["button label", t.onAccent, t.accent],
        ["text on accent tint", t.text, t.accentSoft],
        ["good on tint", t.good, t.goodSoft],
        ["good on card", t.good, t.surface],
        ["warn on tint", t.warn, t.warnSoft],
        ["warn on card", t.warn, t.surface],
        ["bad on tint", t.bad, t.badSoft],
        ["bad on card", t.bad, t.surface],
        ["text on bad tint", t.text, t.badSoft],
        ["text on warn tint", t.text, t.warnSoft],
        ["code text", t.codeText, t.codeBg],
        ["terminal command", "#9db0ff", t.codeBg],
      ];
      for (const [label, foreground, background] of pairs) {
        expect(contrastRatio(foreground, background), `${name}: ${label}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${name} theme: control borders and the accent are visible against their background (3:1)`, () => {
      expect(contrastRatio(t.accent, t.surface)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(t.accent, t.bg)).toBeGreaterThanOrEqual(3);
    });
  }

  it("generates both themes, with an explicit choice overriding the system setting", () => {
    const css = themeCss();
    expect(css).toContain(`--bg:${THEMES.light.bg}`);
    expect(css).toContain(`--on-accent:${THEMES.dark.onAccent}`);
    expect(css).toContain("prefers-color-scheme: dark");
    expect(css).toContain(':root[data-theme="dark"]');
    expect(css).toContain(':root:not([data-theme="light"])');
  });
});
