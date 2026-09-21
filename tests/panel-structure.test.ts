// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, expect, test, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { ensureHeaderBadge, ensureModalButton, openAssignPanel } from '../content/panel';
import type { DeviceRecord } from '../shared/types';

// The panel used to be built from HTML template strings. Firefox's add-on
// linter flags every innerHTML assignment, so the nodes are now created one
// by one. These tests pin the resulting DOM to the markup those templates
// produced: same elements, same attributes, same text, same order. The CSS
// and the rest of panel.ts select on exactly that structure.

const MAC = 'aa:bb:cc:dd:ee:01';
const REAL: DeviceRecord = { id: 'acme-lock', name: 'Acme Lock', vendor: 'Acme', model: 'AL-1', category: 'lock', keywords: [], icon: 'icons/acme-lock.png' };
const GENERIC: DeviceRecord = { id: 'bullet-ip-camera', name: 'Bullet IP Camera', type: 'generic', category: 'iot_hub', keywords: [], icon: 'icons/bullet-ip-camera.png' };

// The shadow roots are closed, so the only way in is to catch them as they
// are attached.
let roots: ShadowRoot[] = [];
let results: DeviceRecord[] = [];
let searchOk = true;

beforeEach(() => {
  // Mocks are restored here, not in an afterEach: a panel opened by one test
  // may still send its first search after that test has returned, and that
  // late call must land on the mock instead of the real fake browser, which
  // rejects when nothing listens.
  vi.restoreAllMocks();
  fakeBrowser.reset();
  document.body.innerHTML = '';
  roots = [];
  results = [REAL, GENERIC];
  searchOk = true;
  const attach = Element.prototype.attachShadow;
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init: ShadowRootInit) {
    const root = attach.call(this, init);
    roots.push(root);
    return root;
  });
  vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation(async (msg: unknown) => {
    if ((msg as { type: string }).type !== 'search') return { ok: true };
    return searchOk ? { ok: true, results } : { ok: false, error: 'offline' };
  });
});

// Tag, attributes and non-blank text of a subtree. Whitespace-only text
// nodes are skipped: the old templates were indented, the built nodes are
// not, and that whitespace never rendered (flex parents, block siblings).
type Shape = { tag: string; attrs: Record<string, string>; kids: (Shape | string)[] };
function shape(node: Element): Shape {
  const kids: (Shape | string)[] = [];
  for (const child of node.childNodes) {
    if (child.nodeType === 1) kids.push(shape(child as Element));
    else if (child.nodeType === 3 && child.textContent!.trim()) kids.push(child.textContent!.trim());
  }
  return {
    tag: node.tagName.toLowerCase(),
    attrs: Object.fromEntries([...node.attributes].map(a => [a.name, a.value])),
    kids,
  };
}

// Parses a snippet of the old template markup into the same Shape form.
function shapesOf(html: string): (Shape | string)[] {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  return shape(holder).kids;
}

function openPanel() {
  openAssignPanel(MAC);
  const root = roots[roots.length - 1]!;
  const dlg = root.querySelector('.dlg') as HTMLElement;
  return { root, dlg, body: dlg.querySelector('.body') as HTMLElement };
}

const ICON = (path: string) => `https://cdn.jsdelivr.net/gh/tvirelli/Ubicon-DB@main/${path}`;

test('assign panel skeleton matches the old template markup', () => {
  const { root, dlg } = openPanel();
  expect([...root.children].map(c => c.tagName.toLowerCase() + (c.className ? '.' + c.className : '')))
    .toEqual(['style', 'div.overlay', 'div.dlg']);
  expect(shape(dlg).attrs).toEqual({ class: 'dlg' });
  const [header, tabs, body] = shapesOf(`
    <header><span>Ubicon: assign icon</span><button data-x aria-label="Close">✕</button></header>
    <div class="tabs">
      <button data-tab="db" class="on">Community database</button>
      <button data-tab="custom">Custom icon</button>
    </div>
    <div class="body"></div>`);
  expect(shape(dlg.children[0]!)).toEqual(header);
  expect(shape(dlg.children[1]!)).toEqual(tabs);
  expect(shape(dlg.children[2]!).attrs).toEqual((body as Shape).attrs);
  expect(dlg.children.length).toBe(3);
});

test('assign panel gets the dark class when the UniFi page is dark', () => {
  document.body.innerHTML = '<div class="theme-dark__x"></div>';
  expect(openPanel().dlg.className).toBe('dlg dark');
});

test('database tab renders the old markup, first loading and then grouped results', async () => {
  const { body } = openPanel();
  expect(shape(body).kids).toEqual(shapesOf(`<input type="search" placeholder="Search devices…">
      <div class="remove" hidden>Remove Ubicon icon from this device</div>
      <div class="list"><div class="msg">Loading database…</div></div>`));

  await vi.waitFor(() => expect(body.querySelectorAll('.item').length).toBe(2));
  expect(shape(body.querySelector('.list')!).kids).toEqual(shapesOf(`
    <div class="grouphdr">Devices</div>
    <div class="item"><img loading="lazy" alt="" src="${ICON(REAL.icon)}"><div><div class="n">Acme Lock</div><div class="m">Acme · AL-1</div></div></div>
    <div class="grouphdr">Generic device types</div>
    <div class="item"><img loading="lazy" alt="" src="${ICON(GENERIC.icon)}"><div><div class="n">Bullet IP Camera</div><div class="m">Generic IoT Hub</div></div></div>`));
});

test('database tab omits the group headings when there are no generic results', async () => {
  results = [REAL];
  const { body } = openPanel();
  await vi.waitFor(() => expect(body.querySelectorAll('.item').length).toBe(1));
  expect(body.querySelectorAll('.grouphdr').length).toBe(0);
});

test('database tab shows the old no-match and unavailable messages', async () => {
  results = [];
  const first = openPanel();
  await vi.waitFor(() => expect(first.body.querySelector('.list')!.textContent).toContain('No matches'));
  expect(shape(first.body.querySelector('.list')!).kids).toEqual(shapesOf(
    '<div class="msg">No matches. Add it to the community database, see the Ubicon popup for a link.</div>'));

  searchOk = false;
  const second = openPanel();
  await vi.waitFor(() => expect(second.body.querySelector('.list')!.textContent).toContain('unavailable'));
  expect(shape(second.body.querySelector('.list')!).kids).toEqual(shapesOf(
    '<div class="msg">Database unavailable, check your connection and try Refresh in the Ubicon popup.</div>'));
});

test('a new search replaces the previous results, it does not append to them', async () => {
  const { body } = openPanel();
  await vi.waitFor(() => expect(body.querySelectorAll('.item').length).toBe(2));
  results = [GENERIC];
  const input = body.querySelector('input')!;
  input.value = 'camera';
  input.dispatchEvent(new Event('input'));
  await vi.waitFor(() => expect(body.querySelectorAll('.item').length).toBe(1));
  expect([...body.querySelectorAll('.grouphdr')].map(h => h.textContent)).toEqual(['Generic device types']);
});

test('custom tab renders the old markup and moves the on class', () => {
  const { dlg, body } = openPanel();
  (dlg.querySelector('[data-tab="custom"]') as HTMLButtonElement).click();
  expect(shape(body).kids).toEqual(shapesOf(`<div class="custom">
      <input type="file" accept="image/*">
      <img class="preview" hidden alt="Preview">
      <input type="text" placeholder="Label (e.g. Garage sensor)" maxlength="40">
      <button class="save" disabled>Save custom icon</button>
      <div class="msg">Stays on this computer only, never uploaded anywhere. Use Export in the Ubicon popup to move it to another machine.</div>
    </div>`));
  expect(dlg.querySelector('[data-tab="custom"]')!.className).toBe('on');
  expect(dlg.querySelector('[data-tab="db"]')!.className).toBe('');
  expect((body.querySelector('.save') as HTMLButtonElement).disabled).toBe(true);
  expect((body.querySelector('.preview') as HTMLImageElement).hidden).toBe(true);
});

// Written out by hand instead of parsed from markup: what matters here is
// that every node is a real SVG element (createElementNS), which a parser
// gives for free and createElement silently does not.
const markShape = (size: string): Shape => ({
  tag: 'svg',
  attrs: { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 128 128', width: size, height: size },
  kids: [
    { tag: 'path', attrs: { d: 'M23 30 V86 A19 19 0 0 0 42 105 H86 A19 19 0 0 0 105 86 V52', fill: 'none', stroke: '#5B3FD1', 'stroke-width': '14', 'stroke-linecap': 'round' }, kids: [] },
    { tag: 'rect', attrs: { x: '98', y: '23', width: '14', height: '14', rx: '4', fill: '#5B3FD1' }, kids: [] },
    { tag: 'rect', attrs: { x: '44', y: '44', width: '40', height: '40', rx: '10', fill: '#5B3FD1' }, kids: [] },
  ],
});

function expectMark(root: ShadowRoot, size: string) {
  expect([...root.children].map(c => c.tagName.toLowerCase())).toEqual(['style', 'svg']);
  const svg = root.querySelector('svg')!;
  expect(shape(svg)).toEqual(markShape(size));
  for (const node of [svg, ...svg.children]) expect(node.namespaceURI).toBe('http://www.w3.org/2000/svg');
}

test('modal button draws the 18px Ubicon mark as real SVG nodes', () => {
  document.body.innerHTML = `
    <div role="dialog" class="modal__x">
      <header class="header__x"><div class="title__x">Change Icon</div></header>
      <img src="https://static.ui.com/fingerprint/0/1_129x129.png">
    </div>`;
  ensureModalButton(document);
  expectMark(roots[0]!, '18');
});

test('header badge draws the 16px Ubicon mark as real SVG nodes', () => {
  document.body.innerHTML = '<header><div><svg class="Logo-module_logo__x" width="50px"></svg></div></header>';
  ensureHeaderBadge(document);
  expectMark(roots[0]!, '16');
});

test('panel.ts assigns no HTML strings, so the Firefox add-on linter has nothing to flag', () => {
  const source = readFileSync(resolve(process.cwd(), 'content/panel.ts'), 'utf8');
  // Assignments and calls only: comments may still name these APIs.
  expect(source).not.toMatch(/\.(innerHTML|outerHTML)\s*\+?=(?!=)|\.insertAdjacentHTML\s*\(/);
});
