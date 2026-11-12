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
for (const group of document.querySelectorAll('.mv-grid, .states, .facts, .tokens, .steps')) {
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
