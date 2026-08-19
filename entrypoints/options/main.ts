import { addConsoleOrigin, listConsoleOrigins, removeConsoleOrigin } from '../../shared/consoles';

const $ = (id: string) => document.getElementById(id)!;

async function renderList() {
  const ul = $('origins');
  ul.innerHTML = '';
  for (const origin of await listConsoleOrigins()) {
    const li = document.createElement('li');
    li.textContent = origin + ' ';
    const rm = document.createElement('button');
    rm.textContent = 'Remove';
    rm.addEventListener('click', async () => {
      await removeConsoleOrigin(origin);
      renderList();
    });
    li.append(rm);
    ul.append(li);
  }
}

$('add').addEventListener('submit', async e => {
  e.preventDefault();
  const msg = $('msg');
  const urlInput = $('url') as HTMLInputElement;
  try {
    const url = new URL(urlInput.value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Use an http(s) URL');
    const result = await addConsoleOrigin(url.origin);
    if (result === 'denied') { msg.textContent = 'Permission was not granted.'; return; }
    if (result === 'already') { msg.textContent = `${url.origin} is already added.`; return; }
    // 'invalid' can't happen here (the protocol/parse check above already
    // guards it), but addConsoleOrigin's return type still includes it.
    msg.textContent = `Added ${url.origin}. Reload your UniFi tab.`;
    urlInput.value = '';
    renderList();
  } catch (err) {
    msg.textContent = err instanceof Error ? err.message : String(err);
  }
});

renderList();
