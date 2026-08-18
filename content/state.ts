import { getAllAssignments, getCachedIcon, iconKey } from '../shared/storage';
import { paintImg, unpaintImg } from './paint';

const MAC_RE = /\b([0-9a-f]{2}:){5}[0-9a-f]{2}\b/i;
// Same shape, no leading boundary: the view-switcher aria-label embeds the MAC
// right after an underscore (e.g. "…divider__0c:37:96:32:bb:44}"), and "_" is a
// \w character so \b never matches there. The colon-pair shape is distinctive
// enough on its own; only the trailing boundary is needed.
const MAC_IN_TEXT_RE = /([0-9a-f]{2}:){5}[0-9a-f]{2}\b/i;
let lastClickedMac: string | null = null;
export const setLastClickedMac = (mac: string) => { lastClickedMac = mac.toLowerCase(); };

export async function loadOverlayMap(): Promise<Map<string, string>> {
  const assignments = await getAllAssignments();
  const map = new Map<string, string>();
  for (const [mac, ref] of Object.entries(assignments)) {
    const dataUri = await getCachedIcon(iconKey(ref));
    if (dataUri) map.set(mac.toLowerCase(), dataUri);
  }
  return map;
}

export function currentPanelMac(root: ParentNode): string | null {
  const panel = root.querySelector('.PROPERTY_PANEL_CLASSNAME');
  if (!panel) return null;
  const m = panel.textContent?.match(MAC_RE);
  return m ? m[0].toLowerCase() : lastClickedMac;
}

export function paintAll(map: Map<string, string>, root: ParentNode): void {
  for (const row of root.querySelectorAll<HTMLTableRowElement>('tr[data-row-id]')) {
    const mac = row.getAttribute('data-row-id')!.toLowerCase();
    const img = row.querySelector<HTMLImageElement>('td[data-column-id="clientName"] img');
    if (!img) continue;
    const dataUri = map.get(mac);
    if (dataUri) paintImg(img, dataUri);
    else if (img.dataset.ubicon) unpaintImg(img);
  }
  const panel = root.querySelector('.PROPERTY_PANEL_CLASSNAME');
  if (panel) {
    const mac = currentPanelMac(root);
    const dataUri = mac ? map.get(mac) : undefined;
    for (const img of panel.querySelectorAll<HTMLImageElement>('img')) {
      const isDeviceImg = img.src.includes('fingerprint') || img.src.includes('/clients/photos/') || img.dataset.ubicon;
      if (!isDeviceImg) continue;
      if (dataUri) paintImg(img, dataUri);
      else if (img.dataset.ubicon) unpaintImg(img);
    }
  }
  for (const tab of root.querySelectorAll('[class*="viewSwitcher__"] [class*="switcherTab__"]')) {
    const aria = tab.querySelector('[class*="switcherClose__"]')?.getAttribute('aria-label') ?? '';
    const m = aria.match(MAC_IN_TEXT_RE);
    const img = tab.querySelector('img');
    if (!m || !img) continue;
    const dataUri = map.get(m[0].toLowerCase());
    if (dataUri) paintImg(img, dataUri);
    else if (img.dataset.ubicon) unpaintImg(img);
  }
  sweepAllIcons(map, root);
}

// Collects every MAC found in a string; used with a fresh /g copy of the MAC
// shape so .match() returns all occurrences rather than the first.
const MAC_ALL_RE = /([0-9a-f]{2}:){5}[0-9a-f]{2}/gi;

function collectMacs(text: string): Set<string> {
  const found = new Set<string>();
  const matches = text.match(MAC_ALL_RE);
  if (matches) for (const m of matches) found.add(m.toLowerCase());
  return found;
}

// Walks up from an icon looking for the single MAC that identifies its
// client. Returns undefined when no unambiguous MAC is found (zero matches
// after exhausting the walk, or more than one distinct MAC at any level) —
// callers must treat undefined as "leave this candidate untouched".
function findAncestorMac(start: Element): string | undefined {
  let el: Element | null = start.parentElement;
  let levels = 0;
  while (el && el !== document.body && levels < 8) {
    const attrMacs = new Set<string>();
    for (const attr of Array.from(el.attributes)) {
      for (const m of collectMacs(attr.value)) attrMacs.add(m);
    }
    if (attrMacs.size === 1) return [...attrMacs][0];
    if (attrMacs.size > 1) return undefined;

    const text = el.textContent ?? '';
    if (text.length <= 400) {
      const textMacs = collectMacs(text);
      if (textMacs.size === 1) return [...textMacs][0];
      if (textMacs.size > 1) return undefined;
    }

    el = el.parentElement;
    levels++;
  }
  return undefined;
}

// Universal catch-all: many UniFi pages outside the three known surfaces
// above also render a client icon DOM-near its MAC. Sweep the whole tree for
// icon-shaped <img>s and paint/unpaint them by walking up to find their MAC.
export function sweepAllIcons(map: Map<string, string>, root: ParentNode): void {
  const candidates = new Set<HTMLImageElement>();
  for (const img of root.querySelectorAll<HTMLImageElement>('img[src*="fingerprint/"]')) candidates.add(img);
  for (const img of root.querySelectorAll<HTMLImageElement>('img[src*="/clients/photos/"]')) candidates.add(img);
  for (const img of root.querySelectorAll<HTMLImageElement>('img[data-ubicon]')) candidates.add(img);

  for (const img of candidates) {
    if (img.closest('#ubicon-header-badge, #ubicon-dialog, #ubicon-tip')) continue;
    if (img.getRootNode() instanceof ShadowRoot) continue;
    // Authoritative surfaces already handled above this pass — don't double-process.
    if (img.closest('tr[data-row-id]')) continue;
    if (img.closest('.PROPERTY_PANEL_CLASSNAME')) continue;
    if (img.closest('[class*="switcherTab__"]')) continue;

    const mac = findAncestorMac(img);
    if (!mac) continue; // not found, or ambiguous — leave untouched

    const dataUri = map.get(mac);
    if (dataUri) paintImg(img, dataUri);
    else if (img.dataset.ubicon) unpaintImg(img);
  }
}
