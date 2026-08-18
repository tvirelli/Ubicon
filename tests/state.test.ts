// @vitest-environment happy-dom
import { beforeEach, expect, test } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { setAssignment, cacheIcon } from '../shared/storage';
import {
  loadOverlayMap, paintAll, currentPanelMac, setLastClickedMac,
  __setNamesForTests, __getNamesForTests, mergeNames,
} from '../content/state';

const MAC = 'd4:3d:39:80:fc:80';
const DATA = 'data:image/png;base64,LOCK';
const NAME = "Nick's Laptop";

function uniFiDom() {
  document.body.innerHTML = `
    <table><tbody>
      <tr data-row-id="${MAC}" data-testid="side-panel-trigger">
        <td data-column-id="status"></td>
        <td data-column-id="clientName"><img src="/app-assets/x/standard@2x.png" srcset="/x 1x"><span>${NAME}</span></td>
      </tr>
      <tr data-row-id="aa:aa:aa:aa:aa:aa">
        <td data-column-id="clientName"><img src="https://static.ui.com/fingerprint/0/1_51x51.png"></td>
      </tr>
    </tbody></table>
    <div class="PROPERTY_PANEL_CLASSNAME">
      <img src="https://static.ui.com/fingerprint/0/1_101x101.png">
      <span>${MAC}</span>
      <img src="https://static.ui.com/fingerprint/0/1_129x129.png">
    </div>
    <div class="viewSwitcher__J27IpbEw">
      <div class="switcherTab__J27IpbEw">
        <div class="switcherImage__J27IpbEw"><img src="https://static.ui.com/fingerprint/0/1_51x51.png"></div>
        <button class="switcherClose__J27IpbEw" aria-label="Close tab client__view-id-divider__${MAC}}"></button>
      </div>
    </div>`;
}

beforeEach(() => {
  fakeBrowser.reset();
  __setNamesForTests(new Map());
});

test('loadOverlayMap joins assignments with cached icons only', async () => {
  await setAssignment(MAC, { kind: 'db', deviceId: 'lockly-smart-lock' });
  await setAssignment('bb:bb:bb:bb:bb:bb', { kind: 'db', deviceId: 'uncached' });
  await cacheIcon('db:lockly-smart-lock', DATA);
  const map = await loadOverlayMap();
  expect(map.get(MAC)).toBe(DATA);
  expect(map.has('bb:bb:bb:bb:bb:bb')).toBe(false);
});

test('paintAll paints assigned row and panel images, leaves others alone', () => {
  uniFiDom();
  paintAll(new Map([[MAC, DATA]]), document);
  const imgs = [...document.querySelectorAll('img')] as HTMLImageElement[];
  expect(imgs[0].src).toBe(DATA);                 // assigned row
  expect(imgs[1].src).toContain('static.ui.com'); // other row untouched
  expect(imgs[2].src).toBe(DATA);                 // panel header icon
  expect(imgs[3].src).toBe(DATA);                 // panel overview image
});

test('paintAll unpaints when assignment removed', () => {
  uniFiDom();
  paintAll(new Map([[MAC, DATA]]), document);
  paintAll(new Map(), document);
  const img = document.querySelector(`tr[data-row-id="${MAC}"] img`) as HTMLImageElement;
  expect(img.src).toContain('standard@2x.png');
});

test('paintAll paints and unpaints the view switcher tab image', () => {
  uniFiDom();
  const tabImg = document.querySelector('[class*="switcherTab__"] img') as HTMLImageElement;
  paintAll(new Map([[MAC, DATA]]), document);
  expect(tabImg.src).toBe(DATA);
  paintAll(new Map(), document);
  expect(tabImg.src).toContain('static.ui.com');
});

test('currentPanelMac reads MAC from panel text, falls back to last click', () => {
  uniFiDom();
  expect(currentPanelMac(document)).toBe(MAC);
  document.querySelector('.PROPERTY_PANEL_CLASSNAME span')!.textContent = 'no mac here';
  setLastClickedMac('cc:cc:cc:cc:cc:cc');
  expect(currentPanelMac(document)).toBe('cc:cc:cc:cc:cc:cc');
});

test('sweep paints an icon on an unknown surface via ancestor attribute MAC', () => {
  document.body.innerHTML = `
    <div class="somePage"><div aria-label="Client ${MAC}">
      <img src="https://static.ui.com/fingerprint/0/9_51x51.png">
    </div></div>`;
  paintAll(new Map([[MAC, DATA]]), document);
  const img = document.querySelector('img') as HTMLImageElement;
  expect(img.src).toBe(DATA);
});

test('sweep abandons a candidate whose ancestor carries two distinct MACs', () => {
  document.body.innerHTML = `
    <div class="ambiguous" data-primary="${MAC}" data-secondary="aa:aa:aa:aa:aa:aa">
      <img src="https://static.ui.com/fingerprint/0/9_51x51.png">
    </div>`;
  paintAll(new Map([[MAC, DATA]]), document);
  const img = document.querySelector('img') as HTMLImageElement;
  expect(img.src).not.toBe(DATA);
  expect(img.dataset.ubicon).toBeUndefined();
});

test('sweep falls back to short sibling text content for the MAC', () => {
  document.body.innerHTML = `
    <div><span>${MAC}</span><img src="https://static.ui.com/fingerprint/0/9_51x51.png"></div>`;
  paintAll(new Map([[MAC, DATA]]), document);
  const img = document.querySelector('img') as HTMLImageElement;
  expect(img.src).toBe(DATA);
});

test('sweep unpaints a previously swept icon when the assignment is removed', () => {
  document.body.innerHTML = `
    <div class="somePage"><div aria-label="Client ${MAC}">
      <img src="https://static.ui.com/fingerprint/0/9_51x51.png">
    </div></div>`;
  const originalSrc = (document.querySelector('img') as HTMLImageElement).src;
  paintAll(new Map([[MAC, DATA]]), document);
  const img = document.querySelector('img') as HTMLImageElement;
  expect(img.src).toBe(DATA);
  paintAll(new Map(), document);
  expect(img.src).toBe(originalSrc);
});

test('paintAll captures client display names off table rows', () => {
  uniFiDom();
  paintAll(new Map(), document);
  expect(__getNamesForTests().get(MAC)).toBe(NAME);
});

test('sweep falls back to a display-name match when no MAC is nearby', () => {
  document.body.innerHTML = `
    <div><span>${NAME}</span><img src="https://static.ui.com/fingerprint/0/2665_51x51.png"></div>`;
  __setNamesForTests(new Map([[MAC, NAME]]));
  paintAll(new Map([[MAC, DATA]]), document);
  const img = document.querySelector('img') as HTMLImageElement;
  expect(img.src).toBe(DATA);
});

test('sweep name fallback abandons a name shared by two macs', () => {
  document.body.innerHTML = `
    <div><span>${NAME}</span><img src="https://static.ui.com/fingerprint/0/2665_51x51.png"></div>`;
  __setNamesForTests(new Map([[MAC, NAME], ['aa:aa:aa:aa:aa:aa', NAME]]));
  paintAll(new Map([[MAC, DATA]]), document);
  const img = document.querySelector('img') as HTMLImageElement;
  expect(img.src).not.toBe(DATA);
  expect(img.dataset.ubicon).toBeUndefined();
});

test('sweep uses a bridge-stamped data-ubicon-mac as the top-priority key', () => {
  // No MAC and no known name anywhere in the ancestor chain — only the
  // React-props bridge's stamp identifies the client.
  document.body.innerHTML = `
    <div class="somePage"><div class="widget">
      <img src="https://static.ui.com/fingerprint/0/2665_51x51.png" data-ubicon-mac="${MAC}">
    </div></div>`;
  paintAll(new Map([[MAC, DATA]]), document);
  const img = document.querySelector('img') as HTMLImageElement;
  expect(img.src).toBe(DATA);
});

test('mergeNames reports a change for a new pair and no change on an identical re-merge', () => {
  const changed1 = mergeNames([[MAC, NAME]]);
  expect(changed1).toBe(true);
  expect(__getNamesForTests().get(MAC)).toBe(NAME);

  const changed2 = mergeNames([[MAC, NAME]]);
  expect(changed2).toBe(false);
  expect(__getNamesForTests().get(MAC)).toBe(NAME);
});
