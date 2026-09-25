// The Assignments tab: every assigned device in one searchable list. Rows
// go on the page first with the Ubicon mark as a stand-in, and each icon
// replaces it as soon as it is read from storage, so a long list appears at
// once instead of after the last storage read.
import { browser } from 'wxt/browser';
import { getAllAssignments, getCachedIcon, getIndexCache, iconKey } from '../../shared/storage';
import type { AssignmentRef } from '../../shared/types';
import type { UbiconMsg, UbiconReply } from '../../shared/messages';
import { VIEW_ONLY_TEXT } from '../../shared/sync/ui-text';

const send = (msg: UbiconMsg) => browser.runtime.sendMessage(msg) as Promise<UbiconReply>;
const $ = (id: string) => document.getElementById(id)!;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export const countText = (n: number) =>
  n === 0 ? 'No devices assigned' : n === 1 ? '1 device assigned' : `${n} devices assigned`;

interface Row { mac: string; ref: AssignmentRef; name: string; haystack: string; node: HTMLElement }

// A view-only GitHub connection cannot save changes, so remove is locked.
let readOnly = false;
let rows: Row[] = [];
let renderRun = 0;

async function fetchReadOnly() {
  const reply = await send({ type: 'sync-status' });
  readOnly = reply.ok === true && reply.status?.connected === true && reply.status.readOnly === true;
}

function applyFilter() {
  const q = ($('assign-search') as HTMLInputElement).value.trim().toLowerCase();
  let shown = 0;
  for (const r of rows) {
    const hit = !q || r.haystack.includes(q);
    r.node.hidden = !hit;
    if (hit) shown++;
  }
  $('assign-none').hidden = shown > 0 || rows.length === 0;
}

function buildRow(mac: string, ref: AssignmentRef, name: string): HTMLElement {
  const row = el('div', 'row');
  const img = el('img');
  img.alt = '';
  img.src = '/icon/32.png';
  const text = el('div');
  text.append(el('div', 'name', name), el('div', 'mac', mac));
  const badge = el('span', 'badge', ref.kind === 'db' ? 'community' : 'custom · icon missing here');
  const removeBtn = el('button', 'btn small', '✕');
  removeBtn.type = 'button';
  removeBtn.title = readOnly ? VIEW_ONLY_TEXT : 'Remove';
  removeBtn.disabled = readOnly;
  row.append(img, text, badge, removeBtn);
  let confirmTimer: ReturnType<typeof setTimeout> | undefined;
  removeBtn.addEventListener('click', async () => {
    if (!removeBtn.classList.contains('confirm')) {
      // First click arms a confirm state; custom icons cannot be
      // re-downloaded once gone.
      removeBtn.textContent = 'Remove?';
      removeBtn.classList.add('confirm');
      removeBtn.title = 'Click again to remove';
      confirmTimer = setTimeout(() => {
        removeBtn.textContent = '✕';
        removeBtn.classList.remove('confirm');
        removeBtn.title = 'Remove';
      }, 4000);
      return;
    }
    clearTimeout(confirmTimer);
    // Through the background worker: every change to assignments goes
    // through its single write queue.
    await send({ type: 'unassign', mac });
    void renderList();
  });
  return row;
}

async function renderList() {
  const run = ++renderRun;
  const [assignments, cache] = await Promise.all([getAllAssignments(), getIndexCache()]);
  if (run !== renderRun) return;
  const dbNames = new Map<string, string>();
  for (const d of cache?.index.devices ?? []) dbNames.set(d.id, d.name);

  rows = Object.entries(assignments).map(([mac, ref]) => {
    const name = ref.kind === 'db' ? (dbNames.get(ref.deviceId) ?? ref.deviceId) : ref.label;
    const haystack = [name, mac, ref.kind === 'db' ? ref.deviceId : ref.label].join('\n').toLowerCase();
    return { mac, ref, name, haystack, node: buildRow(mac, ref, name) };
  });
  rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.mac.localeCompare(b.mac));

  $('assign-count').textContent = countText(rows.length);
  $('assign-empty').hidden = rows.length > 0;
  $('assign-list').replaceChildren(...rows.map(r => r.node));
  applyFilter();

  // Icons stream in after the rows are visible.
  await Promise.all(rows.map(async r => {
    const dataUri = await getCachedIcon(iconKey(r.ref));
    if (run !== renderRun || !dataUri) return;
    r.node.querySelector('img')!.src = dataUri;
    if (r.ref.kind === 'custom') r.node.querySelector('.badge')!.textContent = 'custom';
  }));
}

export async function initAssignmentsUi(): Promise<void> {
  $('assign-search').addEventListener('input', applyFilter);
  await fetchReadOnly();
  await renderList();

  // A background sync or another window can change assignments and cached
  // icons while the page is open; redraw once the burst settles. Assignments
  // live in storage.sync in browser mode and under 'assignments' in
  // storage.local otherwise; icons cache as 'icon:*'.
  let redrawTimer: ReturnType<typeof setTimeout> | undefined;
  browser.storage.onChanged.addListener((changes, area) => {
    const relevant = area === 'sync'
      ? Object.keys(changes).some(k => k !== 'sync:hint')
      : Object.keys(changes).some(k => k === 'assignments' || k === 'tombstones' || k.startsWith('icon:') || k.startsWith('sync:'));
    if (!relevant) return;
    clearTimeout(redrawTimer);
    redrawTimer = setTimeout(async () => { await fetchReadOnly(); void renderList(); }, 200);
  });
}
