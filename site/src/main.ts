// The page paints with its own styles and fonts first; the player stack (Video.js and the HLS engine) loads as a
// separate chunk right after, so text and the poster appear without waiting for it.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/jetbrains-mono/500.css';
import './site.css';
import { startTerrain } from './terrain';

startTerrain();

const load = () => import('./app').then(({ start }) => start());

if (document.readyState === 'complete') requestAnimationFrame(() => void load());
else window.addEventListener('load', () => requestAnimationFrame(() => void load()), { once: true });

// Install section: copy buttons.
for (const button of document.querySelectorAll<HTMLButtonElement>('.copy')) {
  button.addEventListener('click', async () => {
    const code = button.parentElement?.querySelector('code')?.textContent ?? '';
    try {
      await navigator.clipboard.writeText(code);
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Select and copy';
    }
    window.setTimeout(() => (button.textContent = 'Copy'), 1600);
  });
}

// Sections reveal as they scroll into view; cards inside get a stagger index.
for (const group of document.querySelectorAll('.features, .facts, .steps')) {
  [...group.children].forEach((el, i) => (el as HTMLElement).style.setProperty('--i', String(i)));
}
const reveal = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-in');
      reveal.unobserve(entry.target);
    }
  },
  { rootMargin: '0px 0px -12% 0px', threshold: 0.08 },
);
for (const block of document.querySelectorAll('.block')) reveal.observe(block);
// Jumping to a section by link or hash reveals it at once.
const showTarget = () => document.querySelector(location.hash || '#none')?.closest('.block')?.classList.add('is-in');
window.addEventListener('hashchange', showTarget);
showTarget();

// The console spans the viewport; it needs the scrollbar's width to stop short of it.
const setScrollbar = () =>
  document.documentElement.style.setProperty('--sbw', `${window.innerWidth - document.documentElement.clientWidth}px`);
setScrollbar();
window.addEventListener('resize', setScrollbar);

// Range inputs show their filled part, like the player's line.
for (const range of document.querySelectorAll<HTMLInputElement>('.customizer input[type="range"]')) {
  const paint = () => {
    const min = Number(range.min || 0);
    const max = Number(range.max || 100);
    range.style.setProperty('--p', `${((Number(range.value) - min) / (max - min)) * 100}%`);
  };
  range.addEventListener('input', paint);
  paint();
}

// The console widens to the screen once you are on it, and returns to the content width as you scroll away.
// Hysteresis keeps it from flickering at the edges.
const consoleEl = document.querySelector<HTMLElement>('.console');
if (consoleEl) {
  let queued = false;
  const update = () => {
    queued = false;
    const r = consoleEl.getBoundingClientRect();
    const open = consoleEl.hasAttribute('data-open');
    const vh = window.innerHeight;
    const shouldOpen = open ? r.top < vh * 0.32 && r.bottom > vh * 0.45 : r.top < vh * 0.2 && r.bottom > vh * 0.6;
    if (shouldOpen !== open) consoleEl.toggleAttribute('data-open', shouldOpen);
  };
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  };
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue);
  update();
}
