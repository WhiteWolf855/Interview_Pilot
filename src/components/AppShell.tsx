"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { APP } from "@/lib/config";
import { THEME_KEY } from "@/lib/interview/storage";

type Choice = "system" | "light" | "dark";
const ORDER: Choice[] = ["system", "light", "dark"];
const LABEL: Record<Choice, string> = { system: "Theme: system", light: "Theme: light", dark: "Theme: dark" };

function applyTheme(choice: Choice) {
  if (choice === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", choice);
}

export function ThemeToggle() {
  const [choice, setChoice] = useState<Choice>("system");
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(THEME_KEY);
      if (stored === "light" || stored === "dark") setChoice(stored);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const next = () => {
    const value = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length]!;
    setChoice(value);
    applyTheme(value);
    try {
      if (value === "system") window.localStorage.removeItem(THEME_KEY);
      else window.localStorage.setItem(THEME_KEY, value);
    } catch {
      /* storage unavailable */
    }
  };
  return (
    <button type="button" className="btn quiet small" onClick={next} aria-label={`${LABEL[choice]}. Change theme`}>
      {LABEL[choice]}
    </button>
  );
}

export function AppShell({ children, wide = false, bare = false }: { children: ReactNode; wide?: boolean; bare?: boolean }) {
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <Link href="/" className="brand">
          {APP.name}
          <span>{APP.tagline}</span>
        </Link>
        <ThemeToggle />
      </header>
      {bare ? children : <main id="main" className={wide ? "wide" : undefined}>{children}</main>}
      <footer className="footer">
        <Link href="/privacy">Privacy and your data</Link>
        <span style={{ display: "inline-flex", alignItems: "center" }}>Practice tool. Scores are an AI&apos;s opinion, not a hiring decision.</span>
      </footer>
    </>
  );
}
