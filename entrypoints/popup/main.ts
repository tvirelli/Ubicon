import { browser } from 'wxt/browser';
import { exportAll, getAllAssignments, getCachedIcon, getIndexCache, iconKey, importAll, removeAssignment } from '../../shared/storage';
import type { UbiconMsg, UbiconReply } from '../../shared/messages';

const send = (msg: UbiconMsg) => browser.runtime.sendMessage(msg) as Promise<UbiconReply>;
const $ = (id: string) => document.getElementById(id)!;

async function renderStatus() {
  const cache = await getIndexCache();
  $('db-status').textContent = cache
    ? `${cache.index.count} devices · updated ${new Date(cache.fetchedAt).toLocaleDateString()}`
    : 'database not loaded yet';
}

async function renderList() {
  const list = $('list');
  const assignments = await getAllAssignments();
  const macs = Object.keys(assignments).sort();
  if (!macs.length) return; // keep the empty-state paragraph
  list.innerHTML = '';
  for (const mac of macs) {
    const ref = assignments[mac];
    const dataUri = await getCachedIcon(iconKey(ref));
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<img alt=""><div><div class="name"></div><div class="mac"></div></div>
      <span class="badge"></span><button title="Remove">✕</button>`;
    (row.querySelector('img') as HTMLImageElement).src = dataUri ?? '/icon/32.png';
    row.querySelector('.name')!.textContent = ref.kind === 'db' ? ref.deviceId : ref.label;
    row.querySelector('.mac')!.textContent = mac;
    row.querySelector('.badge')!.textContent = ref.kind === 'db' ? 'community' : dataUri ? 'custom' : 'custom · icon missing here';
    row.querySelector('button')!.addEventListener('click', async () => { await removeAssignment(mac); renderList(); });
    if (ref.kind === 'custom') {
      // Community bridge (spec §5): pre-filled suggestion issue on Ubicon-DB
      const suggest = document.createElement('a');
      suggest.textContent = '↗';
      suggest.title = 'Suggest this device to the community database';
      suggest.target = '_blank';
      suggest.href = 'https://github.com/tvirelli/Ubicon-DB/issues/new?title=' +
        encodeURIComponent(`Device suggestion: ${ref.label}`) +
        '&body=' + encodeURIComponent(
          `**Device:** ${ref.label}\n**Vendor:**\n**Model:**\n**Category:**\n\nAttach the icon image (128×128 PNG, transparent) to this issue.`);
      row.append(suggest);
    }
    list.append(row);
  }
}

$('refresh').addEventListener('click', async () => {
  $('db-status').textContent = 'refreshing…';
  await send({ type: 'refresh-index' });
  renderStatus();
});

$('export').addEventListener('click', async () => {
  const file = await exportAll();
  const blob = new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ubicon-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$('import').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async e => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  try {
    const counts = await importAll(JSON.parse(await f.text()));
    $('db-status').textContent = `imported ${counts.assignments} assignments, ${counts.customIcons} custom icons`;
    renderList();
  } catch (err) {
    $('db-status').textContent = err instanceof Error ? err.message : 'import failed';
  }
});

renderStatus();
renderList();
