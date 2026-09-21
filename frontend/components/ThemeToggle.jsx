'use client';

import { Moon, Sun } from 'lucide-react';

/* The pre-paint half of theming lives inline in the root layout; this only
 * flips and persists the choice. Reading the pinned value at click time
 * rather than holding it in state keeps the button correct when another
 * tab has already changed it. */
function current() {
  let pinned = null;
  try { pinned = localStorage.getItem('vhr.theme'); } catch (e) { /* private mode */ }
  if (pinned) return pinned;
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export default function ThemeToggle() {
  function toggle() {
    const next = current() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('vhr.theme', next); } catch (e) { /* private mode */ }
  }

  return (
    <button className="iconbtn themetoggle" onClick={toggle} aria-label="Switch theme">
      <span className="i-moon"><Moon size={19} aria-hidden="true" /></span>
      <span className="i-sun"><Sun size={19} aria-hidden="true" /></span>
    </button>
  );
}
