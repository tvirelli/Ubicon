// The toolbar icon's "available here" state on Chrome and Edge: the
// browser's rule engine swaps the icon on tabs that look like a UniFi
// console (shared/console-rules.ts), and a console where Ubicon already
// runs switches its tab back to the normal icon.
import { browser } from 'wxt/browser';
import { consoleRuleConditions } from './console-rules';

export const NORMAL_TITLE = 'Ubicon';
export const NORMAL_ICON = { 16: '/icon/16.png', 32: '/icon/32.png' };

type IconSet = Record<number, ImageData>;

// The normal icon with an amber dot, drawn in the service worker: the rule
// engine takes pixel data, not a file path.
export async function drawAvailableIcons(): Promise<IconSet> {
  const out: IconSet = {};
  for (const size of [16, 32] as const) {
    const res = await fetch(browser.runtime.getURL(size === 16 ? '/icon/16.png' : '/icon/32.png'));
    const bitmap = await createImageBitmap(await res.blob());
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0, size, size);
    const r = size * 0.22;
    ctx.beginPath();
    ctx.arc(size - r - 1, size - r - 1, r, 0, Math.PI * 2);
    ctx.fillStyle = '#C77A00';
    ctx.fill();
    ctx.lineWidth = Math.max(1, size / 16);
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    out[size] = ctx.getImageData(0, 0, size, size);
  }
  return out;
}

// Replaces any earlier rules with the current ones. Returns false where the
// engine does not exist (Firefox), which is not an error.
export async function installConsoleRules(icons: () => Promise<IconSet> = drawAvailableIcons): Promise<boolean> {
  const dc = (browser as unknown as { declarativeContent?: any }).declarativeContent;
  if (!dc?.onPageChanged) return false;
  const imageData = await icons();
  const rule = {
    conditions: consoleRuleConditions().map(c => new dc.PageStateMatcher(c)),
    actions: [new dc.SetIcon({ imageData })],
  };
  await new Promise<void>(resolve => dc.onPageChanged.removeRules(undefined, () => resolve()));
  await new Promise<void>(resolve => dc.onPageChanged.addRules([rule], () => resolve()));
  return true;
}

// Called for a tab whose content script is running: Ubicon is on there, so
// the tab shows the normal icon whatever the rules decided.
export async function markConsoleActive(tabId: number): Promise<void> {
  try {
    await browser.action.setIcon({ tabId, path: NORMAL_ICON });
    await browser.action.setTitle({ tabId, title: NORMAL_TITLE });
  } catch { /* the tab may be gone; nothing to do */ }
}
