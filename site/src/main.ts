// The page paints with its own styles and fonts first; the player stack (Video.js and the HLS engine) loads as a
// separate chunk right after, so text and the poster appear without waiting for it.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/jetbrains-mono/500.css';
import './site.css';

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
