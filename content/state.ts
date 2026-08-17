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
}
