import type { DbIndex, DeviceRecord } from './types';
import { getIndexCache, setIndexCache } from './storage';

export const RAW_BASE = 'https://cdn.jsdelivr.net/gh/tvirelli/Ubicon-DB@main/';
export const INDEX_URL = RAW_BASE + 'index.json';
const FRESH_MS = 12 * 60 * 60 * 1000;

export const iconUrlFor = (r: DeviceRecord) => RAW_BASE + r.icon;

export function searchDevices(devices: DeviceRecord[], query: string): DeviceRecord[] {
  const q = query.trim().toLowerCase();
  const hit = (d: DeviceRecord) =>
    !q || [d.name, d.vendor, d.model, ...(d.keywords ?? [])].some(s => s.toLowerCase().includes(q));
  return devices.filter(hit).sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchIndex(force = false): Promise<DbIndex> {
  const cached = await getIndexCache();
  if (!force && cached && Date.now() - cached.fetchedAt < FRESH_MS) return cached.index;
  try {
    const url = force ? `${INDEX_URL}?t=${Date.now()}` : INDEX_URL;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const index = (await res.json()) as DbIndex;
    if (index.schema !== 1 || !Array.isArray(index.devices)) throw new Error('bad index shape');
    await setIndexCache(index);
    return index;
  } catch (e) {
    if (cached) return cached.index;
    throw e;
  }
}
