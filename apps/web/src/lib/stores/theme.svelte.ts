import { browser } from "$app/environment";

export type Theme = "light" | "dark" | "system";

let current = $state<Theme>("system");

function applyTheme(theme: Theme) {
  if (!browser) return;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = theme === "dark" || (theme === "system" && prefersDark);
  document.documentElement.classList.toggle("dark", isDark);
}

if (browser) {
  const stored = localStorage.getItem("theme") as Theme | null;
  if (stored === "light" || stored === "dark" || stored === "system") {
    current = stored;
  }

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (current === "system") {
      applyTheme("system");
    }
  });
}

export function getTheme() {
  return {
    get value() {
      return current;
    },
  };
}

export function setTheme(theme: Theme) {
  current = theme;
  if (browser) {
    localStorage.setItem("theme", theme);
    applyTheme(theme);
  }
}

export function cycleTheme() {
  const order: Theme[] = ["light", "dark", "system"];
  const next = order[(order.indexOf(current) + 1) % order.length];
  setTheme(next);
}
