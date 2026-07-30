import { render } from 'preact';
import { App } from './App.js';

const appElement = document.getElementById('app');
if (appElement) {
  render(<App />, appElement);
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
    // The app remains fully usable when service workers are unavailable.
  });
}
