// Pure resolver core for the MAIN-world React props bridge. No browser
// extension APIs here — this file is exercised directly by unit tests under
// happy-dom, and is also imported (unmodified) by the MAIN-world content
// script entrypoint that actually has access to React's internal fiber
// props on the live UniFi page.
//
// React (in dev and prod builds alike) stashes the props object it last
// rendered a DOM node with on the node itself, under a property whose name
// starts with "__reactProps$" (the suffix is a per-render random id). When
// present, that object is often a far more reliable way to recover a
// client's MAC than scraping ancestor attributes/text — UniFi's own
// component tree already carries the client record, this just reads it.

const MAC_EXACT_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;

function isValidMac(value: unknown): value is string {
  return typeof value === 'string' && MAC_EXACT_RE.test(value);
}

// A plain, non-array, non-React-element object — i.e. a plausible "record"
// value worth checking for a nested .mac field. React elements are tagged
// with a $$typeof symbol/string; we skip those so we never walk back into
// the render tree itself.
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !('$$typeof' in value);
}

function extractMacFromProps(props: unknown): string | undefined {
  if (!isPlainRecord(props)) return undefined;

  const direct = [
    props.mac,
    (props.client as Record<string, unknown> | undefined)?.mac,
    (props.data as Record<string, unknown> | undefined)?.mac,
    (props.item as Record<string, unknown> | undefined)?.mac,
    (props.row as Record<string, unknown> | undefined)?.mac,
  ];
  for (const v of direct) if (isValidMac(v)) return v.toLowerCase();

  for (const v of Object.values(props)) {
    if (isPlainRecord(v) && isValidMac(v.mac)) return (v.mac as string).toLowerCase();
  }
  return undefined;
}

function reactPropsOf(el: Element): unknown {
  const propName = Object.getOwnPropertyNames(el).find(n => n.startsWith('__reactProps$'));
  return propName ? (el as unknown as Record<string, unknown>)[propName] : undefined;
}

// Walks up from an icon's parent looking for the nearest ancestor carrying
// a React props object with a recoverable MAC. First valid MAC wins.
function findReactMac(start: Element): string | undefined {
  let el: Element | null = start.parentElement;
  let levels = 0;
  while (el && el !== document.body && levels < 8) {
    const mac = extractMacFromProps(reactPropsOf(el));
    if (mac) return mac;
    el = el.parentElement;
    levels++;
  }
  return undefined;
}

// Icons that yielded nothing on a prior pass — never worth re-walking, since
// the DOM structure/props react produced for them didn't change shape.
const unresolvable = new WeakSet<Element>();

// Sweeps for icon-shaped <img>s, stamping each with the client MAC recovered
// from React's internal props (data-ubicon-mac). Returns the number of imgs
// newly stamped this call.
export function resolveIconMacs(root: ParentNode): number {
  const candidates = new Set<Element>();
  for (const img of root.querySelectorAll('img[src*="fingerprint/"]')) candidates.add(img);
  for (const img of root.querySelectorAll('img[src*="/clients/photos/"]')) candidates.add(img);
  for (const img of root.querySelectorAll('img[data-ubicon]')) candidates.add(img);

  let stamped = 0;
  for (const img of candidates) {
    if (img.hasAttribute('data-ubicon-mac')) continue;
    if (unresolvable.has(img)) continue;

    const mac = findReactMac(img);
    if (mac) {
      img.setAttribute('data-ubicon-mac', mac);
      stamped++;
    } else {
      unresolvable.add(img);
    }
  }
  return stamped;
}
