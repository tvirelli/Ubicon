// Pure resolver core for the MAIN-world React props bridge. No browser
// extension APIs here: this file is exercised directly by unit tests under
// happy-dom, and is also imported (unmodified) by the MAIN-world content
// script entrypoint that actually has access to React's internal fiber
// props on the live UniFi page.
//
// React (in dev and prod builds alike) stashes the props object it last
// rendered a DOM node with on the node itself, under a property whose name
// starts with "__reactProps$" (the suffix is a per-render random id), and
// the fiber node itself under a sibling property starting with
// "__reactFiber$". The DOM-attached props are often a far more reliable way
// to recover a client's MAC than scraping ancestor attributes/text, but on
// some pages (e.g. flows) they carry only styling props, and the real
// client record lives many levels up the *fiber* tree (via fiber.return),
// either as a per-row component's own props or as one entry in a list
// component's array prop. Both shapes are handled below.

const MAC_EXACT_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;

function isValidMac(value: unknown): value is string {
  return typeof value === 'string' && MAC_EXACT_RE.test(value);
}

// A plain, non-array, non-React-element object: i.e. a plausible "record"
// value worth checking for a nested .mac field. React elements are tagged
// with a $$typeof symbol/string; we skip those so we never walk back into
// the render tree itself.
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !('$$typeof' in value);
}

// Reads whatever mac-shaped value it can off a props object: used both for
// the DOM-attached __reactProps$ object and a fiber's memoizedProps, since
// both can carry the same per-row shapes. Deliberately unguarded internally,
// since UniFi's props can carry arbitrary getters, and a throwing one anywhere
// in here (direct paths or the shallow scan) is the caller's problem to
// contain, not this function's. See findReactMac/findFiberMac, which wrap
// each call so one bad ancestor/fiber is skipped rather than aborting the
// whole walk.
function extractMacFromProps(props: unknown): string | undefined {
  if (!isPlainRecord(props)) return undefined;

  const direct = [
    props.mac,
    props.client_mac,
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

// The fiber node React attached to this DOM element, if any. Distinct from
// reactPropsOf: the fiber is the actual tree node (carries .return, .child,
// .memoizedProps, etc.), not just its rendered props.
function reactFiberOf(el: Element): FiberNode | undefined {
  const propName = Object.getOwnPropertyNames(el).find(n => n.startsWith('__reactFiber$'));
  return propName ? ((el as unknown as Record<string, unknown>)[propName] as FiberNode) : undefined;
}

type FiberNode = { return?: FiberNode | null; memoizedProps?: unknown };

// Walks up from an icon's parent looking for the nearest ancestor carrying
// a React props object with a recoverable MAC. First valid MAC wins.
//
// Each ancestor's extraction is wrapped individually: UniFi's props objects
// can carry arbitrary getters, and a throwing one at one level must not
// stop the walk from reaching a perfectly good ancestor farther up; it
// just means this particular level contributed nothing.
function findReactMac(start: Element): string | undefined {
  let el: Element | null = start.parentElement;
  let levels = 0;
  while (el && el !== document.body && levels < 8) {
    try {
      const mac = extractMacFromProps(reactPropsOf(el));
      if (mac) return mac;
    } catch {
      // Throwing getter on this ancestor's props: treat as "nothing here"
      // and keep walking; don't let it take down the whole resolution.
    }
    el = el.parentElement;
    levels++;
  }
  return undefined;
}

// Fallback for pages where the DOM-attached __reactProps$ only ever carries
// styling props (nothing recoverable), but a component higher up the
// *fiber* tree, not necessarily attached to any DOM node in between,
// still renders that row with the client record as its own props. Walks up
// to 12 fiber.return hops from the icon's own fiber. Wrapped as a whole:
// fiber shapes are internal React implementation detail we have no control
// over, and a malformed/unexpected one must never abort resolution.
function findFiberMac(img: Element): string | undefined {
  try {
    let fiber: FiberNode | undefined = reactFiberOf(img);
    for (let steps = 0; steps < 12 && fiber; steps++) {
      fiber = fiber.return ?? undefined;
      if (!fiber) break;
      const mac = extractMacFromProps(fiber.memoizedProps);
      if (mac) return mac;
    }
  } catch {
    // Malformed/unexpected fiber shape: never worth aborting resolution over.
  }
  return undefined;
}

// Tracks, per icon <img>, the src it had the last time it was processed.
// Replaces separate "already stamped" / "already tried and failed" caches:
// a virtualized list can and does reuse the same <img> node for a different
// client by swapping its src, and neither of those older caches would ever
// revisit a node once it had a verdict. Keying revalidation off src instead
// means a genuine client swap (src changes to a different remote URL) is
// always re-walked, while our own painting (rewriting src to a data: URI)
// is never mistaken for a client swap.
const lastProcessedSrc = new WeakMap<Element, string>();

function needsProcessing(img: Element, src: string): boolean {
  const stored = lastProcessedSrc.get(img);
  if (stored === undefined) return true;
  return src !== stored && !src.startsWith('data:');
}

// Icon-shaped <img>s: the same candidate shape used by both resolveIconMacs
// (stamping) and harvestNameMacPairs (name/mac collection), so the two
// never drift apart on what counts as a client icon.
function collectCandidateImgs(root: ParentNode): Set<HTMLImageElement> {
  const candidates = new Set<HTMLImageElement>();
  for (const img of root.querySelectorAll<HTMLImageElement>('img[src*="fingerprint/"]')) candidates.add(img);
  for (const img of root.querySelectorAll<HTMLImageElement>('img[src*="/clients/photos/"]')) candidates.add(img);
  for (const img of root.querySelectorAll<HTMLImageElement>('img[data-ubicon]')) candidates.add(img);
  return candidates;
}

// Sweeps for icon-shaped <img>s, stamping each with the client MAC recovered
// from React's internal props (data-ubicon-mac). Tries the DOM-attached
// __reactProps$ ancestor walk first, falling back to the fiber-tree walk
// for pages where the DOM props carry nothing useful. Returns the number of
// imgs stamped this call (a fresh mac written, whether or not it matches
// what was there before: simplicity over precision, since a stamp write is
// rare and cheap for callers to react to).
export function resolveIconMacs(root: ParentNode): number {
  const candidates = collectCandidateImgs(root);

  let stamped = 0;
  for (const img of candidates) {
    // One malformed candidate (e.g. some unexpected DOM/props shape we
    // haven't anticipated) must never abort the rest of the pass.
    try {
      const src = img.src;
      if (!needsProcessing(img, src)) continue;

      img.removeAttribute('data-ubicon-mac');
      const mac = findReactMac(img) ?? findFiberMac(img);
      if (mac) {
        img.setAttribute('data-ubicon-mac', mac);
        stamped++;
      }
      lastProcessedSrc.set(img, src);
    } catch {
      // Skip this candidate; keep processing the rest of the pass.
    }
  }
  return stamped;
}

// A mac/name pair candidate: an object carrying a full-MAC field
// (.mac or .client_mac) and a non-empty display-name field
// (.name / .client_name / .hostname / .display_name).
function macFieldOf(record: Record<string, unknown>): string | undefined {
  const raw = record.mac ?? record.client_mac;
  return isValidMac(raw) ? raw.toLowerCase() : undefined;
}

function nameFieldOf(record: Record<string, unknown>): string | undefined {
  const raw = record.name ?? record.client_name ?? record.hostname ?? record.display_name;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed || undefined;
}

function collectPairFrom(candidate: unknown, pairs: Map<string, string>): void {
  if (!isPlainRecord(candidate)) return;
  const mac = macFieldOf(candidate);
  const name = nameFieldOf(candidate);
  if (mac && name) pairs.set(mac, name);
}

// Examines one fiber's memoizedProps for recoverable [mac, name] pairs:
// every own-enumerable array value (capped at 500 items, since anything bigger
// is almost certainly not a small client list) is scanned item by item,
// and the props object itself plus each of its direct object-typed values
// are checked the same way, covering single-record components too.
function harvestFromProps(props: unknown, pairs: Map<string, string>): void {
  if (!isPlainRecord(props)) return;

  collectPairFrom(props, pairs);

  for (const v of Object.values(props)) {
    if (Array.isArray(v)) {
      if (v.length <= 500) for (const item of v) collectPairFrom(item, pairs);
    } else {
      collectPairFrom(v, pairs);
    }
  }
}

// Harvests [mac, name] pairs from the fiber tree above every icon-shaped
// <img> on the page: the counterpart to resolveIconMacs's stamping, for
// pages (e.g. flows) whose row components never carry per-row props at all,
// only a single array prop on a list component many fiber levels up. Those
// pairs feed content/state.ts's name-based sweep fallback: even where we
// can't recover a MAC to stamp an icon directly, we may still be able to
// recognize the client's *name* elsewhere near the icon and key off that.
//
// The visited set is local to this single call (not module-level) so
// candidates sharing an ancestor fiber, which is the common case, since
// they're siblings in the same list, don't re-harvest it repeatedly, while
// never leaking state between calls.
export function harvestNameMacPairs(root: ParentNode): Array<[string, string]> {
  const candidates = collectCandidateImgs(root);
  const visited = new Set<FiberNode>();
  const pairs = new Map<string, string>();

  for (const img of candidates) {
    try {
      let fiber: FiberNode | undefined = reactFiberOf(img);
      for (let steps = 0; steps < 30 && fiber; steps++) {
        fiber = fiber.return ?? undefined;
        if (!fiber) break;
        if (visited.has(fiber)) continue;
        visited.add(fiber);
        try {
          harvestFromProps(fiber.memoizedProps, pairs);
        } catch {
          // Malformed props at this fiber level: skip it, keep climbing.
        }
      }
    } catch {
      // One candidate's broken fiber chain can't abort the whole harvest.
    }
  }

  return [...pairs.entries()];
}
