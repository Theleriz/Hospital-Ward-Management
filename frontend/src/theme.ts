// Light / dark theme. Without a choice the app follows the system setting;
// a choice made with the toggle is remembered in this browser.

import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

const THEME_KEY = "medbase:theme";

function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** HeroUI components switch to dark by the "dark" class on <html>; keep it in step
 * with the theme the rest of the app shows (the system setting or the toggle). */
function syncHeroUiTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

/** Called once before the first render, so the page never flashes the wrong theme. */
export function applyStoredTheme(): void {
  const theme = storedTheme();
  if (theme) document.documentElement.dataset.theme = theme;
  syncHeroUiTheme(theme ?? systemTheme());
  // Before sign-in nothing else listens to the system setting
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (!storedTheme()) syncHeroUiTheme(systemTheme());
  });
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => storedTheme() ?? systemTheme());

  // Follow the system setting until the user picks a theme
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const onChange = () => !storedTheme() && setTheme(systemTheme());
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Private mode: the choice lasts until reload
    }
    setTheme(next);
  }

  useEffect(() => syncHeroUiTheme(theme), [theme]);

  return [theme, toggle];
}
