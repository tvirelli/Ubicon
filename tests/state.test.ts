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
  expect(imgs[0]!.src).toBe(DATA);                 // assigned row
  expect(imgs[1]!.src).toContain('static.ui.com'); // other row untouched
  expect(imgs[2]!.src).toBe(DATA);                 // panel header icon
  expect(imgs[3]!.src).toBe(DATA);                 // panel overview image
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

test('setLastClickedMac ignores a non-MAC value (e.g. a flows row id) rather than clobbering the last real click', () => {
  uniFiDom();
  document.querySelector('.PROPERTY_PANEL_CLASSNAME span')!.textContent = 'no mac here';
  setLastClickedMac('cc:cc:cc:cc:cc:cc');
  setLastClickedMac('6a849daaddff1f090b235e05'); // flow row id, not a MAC, must be ignored
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
  // No MAC and no known name anywhere in the ancestor chain; only the
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

// UniFi reuses tr[data-row-id] for the flows table too, but there the
// attribute holds a flow id, not a MAC.
const FLOW_ROW_ID = '6a849daaddff1f090b235e05';

function flowsRowDom() {
  document.body.innerHTML = `
    <table><tbody>
      <tr data-row-id="${FLOW_ROW_ID}" class="FLOWS_TABLE_ROW_CLASSNAME">
        <td data-column-id="clientName"><div><span>${NAME}</span><img src="https://static.ui.com/fingerprint/0/9_51x51.png"></div></td>
      </tr>
    </tbody></table>`;
}

test('a flows row (non-MAC row id) is painted via the sweep name fallback', () => {
  flowsRowDom();
  __setNamesForTests(new Map([[MAC, NAME]]));
  paintAll(new Map([[MAC, DATA]]), document);
  const img = document.querySelector('img') as HTMLImageElement;
  expect(img.src).toBe(DATA);
});

test('a flows row with an unrecognized display name stays untouched', () => {
  flowsRowDom();
  // No knownNames entry for NAME; the sweep's name fallback has nothing to
  // match, and there's no MAC anywhere for the ordinary ancestor walk either.
  paintAll(new Map([[MAC, DATA]]), document);
  const img = document.querySelector('img') as HTMLImageElement;
  expect(img.src).not.toBe(DATA);
  expect(img.dataset.ubicon).toBeUndefined();
});

test('a flows row does not get its flow id captured as a client name', () => {
  flowsRowDom();
  paintAll(new Map(), document);
  expect(__getNamesForTests().has(FLOW_ROW_ID)).toBe(false);
});

test('a MAC-valued client row is still painted by the row handler and correctly skipped by the sweep', () => {
  const OTHER_MAC = 'ff:ff:ff:ff:ff:ff';
  const OTHER_DATA = 'data:image/png;base64,OTHER';
  document.body.innerHTML = `
    <table><tbody>
      <tr data-row-id="${MAC}">
        <td data-column-id="clientName"><img src="https://static.ui.com/fingerprint/0/1_51x51.png"><span>${NAME}</span></td>
      </tr>
    </tbody></table>`;
  // If the sweep wrongly processed this row's img (the skip rule failing to
  // recognize a MAC-valued row), the name fallback would key it to
  // OTHER_MAC instead of the row's own MAC, proving the skip still holds.
  __setNamesForTests(new Map([[OTHER_MAC, NAME]]));
  const map = new Map([[MAC, DATA], [OTHER_MAC, OTHER_DATA]]);

  paintAll(map, document);

  const img = document.querySelector('img') as HTMLImageElement;
  expect(img.src).toBe(DATA);
});

test('a panel without a MAC in its text lets each image key off its own client name', () => {
  const MAC_A = 'aa:aa:aa:aa:aa:aa';
  const MAC_B = 'bb:bb:bb:bb:bb:bb';
  const NAME_A = 'Client A';
  const NAME_B = 'Client B';
  const DATA_A = 'data:image/png;base64,AAA';
  const DATA_B = 'data:image/png;base64,BBB';
  document.body.innerHTML = `
    <div class="PROPERTY_PANEL_CLASSNAME">
      <div><span>${NAME_A}</span><img src="https://static.ui.com/fingerprint/0/1_51x51.png"></div>
      <div><span>${NAME_B}</span><img src="https://static.ui.com/fingerprint/0/2_51x51.png"></div>
    </div>`;
  __setNamesForTests(new Map([[MAC_A, NAME_A], [MAC_B, NAME_B]]));

  paintAll(new Map([[MAC_A, DATA_A], [MAC_B, DATA_B]]), document);

  const imgs = [...document.querySelectorAll('img')] as HTMLImageElement[];
  expect(imgs[0]!.src).toBe(DATA_A);
  expect(imgs[1]!.src).toBe(DATA_B);
});

test('a panel with a MAC in its text still bulk-paints every device image inside it', () => {
  uniFiDom();
  paintAll(new Map([[MAC, DATA]]), document);
  const panelImgs = [...document.querySelectorAll('.PROPERTY_PANEL_CLASSNAME img')] as HTMLImageElement[];
  expect(panelImgs[0]!.src).toBe(DATA);
  expect(panelImgs[1]!.src).toBe(DATA);
});
