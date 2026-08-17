import { browser } from 'wxt/browser';

const $ = (id: string) => document.getElementById(id)!;

async function getOrigins(): Promise<string[]> {
  return ((await browser.storage.local.get('origins')).origins as string[]) ?? [];
}

async function renderList() {
  const ul = $('origins');
  ul.innerHTML = '';
  for (const origin of await getOrigins()) {
    const li = document.createElement('li');
    li.textContent = origin + ' ';
    const rm = document.createElement('button');
    rm.textContent = 'Remove';
    rm.addEventListener('click', async () => {
      const id = 'ubicon-' + new URL(origin).hostname;
      await browser.scripting.unregisterContentScripts({ ids: [id] }).catch(() => {});
      await browser.storage.local.set({ origins: (await getOrigins()).filter(o => o !== origin) });
      renderList();
    });
    li.append(rm);
    ul.append(li);
  }
}

$('add').addEventListener('submit', async e => {
  e.preventDefault();
  const msg = $('msg');
  try {
    const url = new URL(($('url') as HTMLInputElement).value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Use an http(s) URL');
    const origin = url.origin;
    const pattern = origin + '/*';
    const granted = await browser.permissions.request({ origins: [pattern] });
    if (!granted) { msg.textContent = 'Permission was not granted.'; return; }
    await browser.scripting.registerContentScripts([{
      id: 'ubicon-' + url.hostname,
      matches: [pattern],
      js: ['content-scripts/content.js'],
      runAt: 'document_idle',
      persistAcrossSessions: true,
    }]).catch(async err => {
      if (String(err).includes('Duplicate')) return; // already registered — fine
      throw err;
    });
    const origins = await getOrigins();
    if (!origins.includes(origin)) await browser.storage.local.set({ origins: [...origins, origin] });
    msg.textContent = `Added ${origin}. Reload your UniFi tab.`;
    ($('url') as HTMLInputElement).value = '';
    renderList();
  } catch (err) {
    msg.textContent = err instanceof Error ? err.message : String(err);
  }
});

renderList();
