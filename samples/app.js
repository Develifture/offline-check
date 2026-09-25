// Shared note-app logic. Each sample's index.html sets window.MODE and window.USE_SW.
//   healthy   : notes in localStorage, online event returns to normal
//   memory    : notes only in memory (lost on reload)
//   reconnect : notes persist, but the app breaks when the network returns
const app = document.getElementById('app');
const list = document.getElementById('notes');
const status = document.getElementById('status');
const input = document.getElementById('new-note');
let notes = window.MODE === 'memory' ? [] : JSON.parse(localStorage.getItem('notes') || '[]');
let broken = false;

function render() {
  list.textContent = '';
  if (broken) return; // reconnect failure: list vanishes
  for (const n of notes) {
    const li = document.createElement('li');
    li.textContent = n;
    list.append(li);
  }
}
document.getElementById('add-note').onclick = () => {
  notes.push(input.value);
  input.value = '';
  if (window.MODE !== 'memory') localStorage.setItem('notes', JSON.stringify(notes));
  render();
};
window.addEventListener('offline', () => { status.textContent = 'offline'; });
window.addEventListener('online', () => {
  if (window.MODE === 'reconnect') { broken = true; status.textContent = 'sync-error'; } else status.textContent = 'online';
  render();
});
status.textContent = navigator.onLine ? 'online' : 'offline';
render();

// data-ready = the app declares itself usable (and, with a service worker, cached).
if (window.USE_SW && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(() => { app.dataset.ready = '1'; });
} else {
  app.dataset.ready = '1';
}
