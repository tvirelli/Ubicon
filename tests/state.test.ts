// @vitest-environment happy-dom
import { beforeEach, expect, test } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { setAssignment, cacheIcon } from '../shared/storage';
import { loadOverlayMap, paintAll, currentPanelMac, setLastClickedMac } from '../content/state';

const MAC = 'd4:3d:39:80:fc:80';
const DATA = 'data:image/png;base64,LOCK';

function uniFiDom() {
  document.body.innerHTML = `
    <table><tbody>
      <tr data-row-id="${MAC}" data-testid="side-panel-trigger">
        <td data-column-id="status"></td>
        <td data-column-id="clientName"><img src="/app-assets/x/standard@2x.png" srcset="/x 1x"></td>
      </tr>
      <tr data-row-id="aa:aa:aa:aa:aa:aa">
        <td data-column-id="clientName"><img src="https://static.ui.com/fingerprint/0/1_51x51.png"></td>
      </tr>
    </tbody></table>
    <div class="PROPERTY_PANEL_CLASSNAME">
      <img src="https://static.ui.com/fingerprint/0/1_101x101.png">
      <span>${MAC}</span>
      <img src="https://static.ui.com/fingerprint/0/1_129x129.png">
    </div>`;
}

beforeEach(() => fakeBrowser.reset());

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

test('currentPanelMac reads MAC from panel text, falls back to last click', () => {
  uniFiDom();
  expect(currentPanelMac(document)).toBe(MAC);
  document.querySelector('.PROPERTY_PANEL_CLASSNAME span')!.textContent = 'no mac here';
  setLastClickedMac('cc:cc:cc:cc:cc:cc');
  expect(currentPanelMac(document)).toBe('cc:cc:cc:cc:cc:cc');
});
