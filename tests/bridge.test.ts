// @vitest-environment happy-dom
import { beforeEach, expect, test } from 'vitest';
import { resolveIconMacs } from '../content/bridge-core';

const MAC = 'd4:3d:39:80:fc:80';
const IMG_SRC = 'https://static.ui.com/fingerprint/0/9_51x51.png';

beforeEach(() => { document.body.innerHTML = ''; });

test('stamps the mac from props.client.mac on the nearest react-props ancestor', () => {
  document.body.innerHTML = `<div><img src="${IMG_SRC}"></div>`;
  const div = document.querySelector('div')!;
  (div as any)['__reactProps$abc123'] = { client: { mac: 'D4:3D:39:80:FC:80' } };

  const n = resolveIconMacs(document);

  const img = document.querySelector('img') as HTMLImageElement;
  expect(img.getAttribute('data-ubicon-mac')).toBe(MAC);
  expect(n).toBe(1);
});

test('stamps the mac from a direct props.mac', () => {
  document.body.innerHTML = `<div><img src="${IMG_SRC}"></div>`;
  const div = document.querySelector('div')!;
  (div as any)['__reactProps$xyz789'] = { mac: 'D4:3D:39:80:FC:80' };

  const n = resolveIconMacs(document);

  const img = document.querySelector('img') as HTMLImageElement;
  expect(img.getAttribute('data-ubicon-mac')).toBe(MAC);
  expect(n).toBe(1);
});

test('falls back to a shallow scan of nested record values for .mac', () => {
  document.body.innerHTML = `<div><img src="${IMG_SRC}"></div>`;
  const div = document.querySelector('div')!;
  // Not one of the direct paths (mac/client/data/item/row) — only found via
  // the shallow pass over the props object's own values.
  (div as any)['__reactProps$shallow1'] = { device: { mac: 'D4:3D:39:80:FC:80' } };

  const n = resolveIconMacs(document);

  const img = document.querySelector('img') as HTMLImageElement;
  expect(img.getAttribute('data-ubicon-mac')).toBe(MAC);
  expect(n).toBe(1);
});

test('a src-unchanged icon is not reprocessed even if props appear later', () => {
  document.body.innerHTML = `<div><span>no props here</span><img src="${IMG_SRC}"></div>`;
  const div = document.querySelector('div')!;

  const n1 = resolveIconMacs(document);
  expect(n1).toBe(0);
  expect(document.querySelector('img')!.hasAttribute('data-ubicon-mac')).toBe(false);

  // Props show up on the ancestor afterwards, but the img's src never
  // changed — the cache is keyed on src, so this pass must not re-walk it.
  (div as any)['__reactProps$late1'] = { mac: 'D4:3D:39:80:FC:80' };

  const n2 = resolveIconMacs(document);
  expect(n2).toBe(0);
  expect(document.querySelector('img')!.hasAttribute('data-ubicon-mac')).toBe(false);
});

test('a reused img node is revalidated when its src changes to a different client', () => {
  const OTHER_SRC = 'https://static.ui.com/fingerprint/0/42_51x51.png';
  const MAC_B = 'bb:bb:bb:bb:bb:bb';
  document.body.innerHTML = `<div><img src="${IMG_SRC}"></div>`;
  const div = document.querySelector('div')!;
  (div as any)['__reactProps$reuse1'] = { mac: 'D4:3D:39:80:FC:80' };

  const n1 = resolveIconMacs(document);
  expect(n1).toBe(1);
  const img = document.querySelector('img') as HTMLImageElement;
  expect(img.getAttribute('data-ubicon-mac')).toBe(MAC);

  // Virtualized-list style reuse: same <img> node, different client — src
  // changes to a different remote URL and the ancestor's props swap too.
  img.src = OTHER_SRC;
  (div as any)['__reactProps$reuse1'] = { mac: MAC_B.toUpperCase() };

  const n2 = resolveIconMacs(document);
  expect(n2).toBe(1);
  expect(img.getAttribute('data-ubicon-mac')).toBe(MAC_B);
});

test('a throwing getter on one ancestor does not stop the walk from reaching a farther valid one', () => {
  document.body.innerHTML = `
    <div id="outer"><div id="inner"><img src="${IMG_SRC}"></div></div>`;
  const inner = document.getElementById('inner')!;
  const outer = document.getElementById('outer')!;
  Object.defineProperty(inner, '__reactProps$throws1', {
    configurable: true,
    get() { return { get mac(): string { throw new Error('boom'); } }; },
  });
  (outer as any)['__reactProps$outer2'] = { client: { mac: 'D4:3D:39:80:FC:80' } };

  expect(() => resolveIconMacs(document)).not.toThrow();

  expect(document.querySelector('img')!.getAttribute('data-ubicon-mac')).toBe(MAC);
});

test('resolves a valid props.client.mac exactly two DOM ancestor levels above the img', () => {
  document.body.innerHTML = `
    <div id="grandparent"><div id="parent"><img src="${IMG_SRC}"></div></div>`;
  (document.getElementById('grandparent') as any)['__reactProps$two1'] = { client: { mac: 'D4:3D:39:80:FC:80' } };

  const n = resolveIconMacs(document);

  expect(n).toBe(1);
  expect(document.querySelector('img')!.getAttribute('data-ubicon-mac')).toBe(MAC);
});

test('the nearest ancestor with a valid mac wins over a farther one with a different mac', () => {
  document.body.innerHTML = `
    <div id="outer"><div id="inner"><img src="${IMG_SRC}"></div></div>`;
  (document.getElementById('outer') as any)['__reactProps$outer1'] = { mac: 'aa:aa:aa:aa:aa:aa' };
  (document.getElementById('inner') as any)['__reactProps$inner1'] = { mac: 'D4:3D:39:80:FC:80' };

  resolveIconMacs(document);

  expect(document.querySelector('img')!.getAttribute('data-ubicon-mac')).toBe(MAC);
});

test('a successfully-stamped icon is not recounted or reprocessed on a later pass with the same src', () => {
  document.body.innerHTML = `<div><img src="${IMG_SRC}"></div>`;
  const div = document.querySelector('div')!;
  (div as any)['__reactProps$stable1'] = { mac: 'D4:3D:39:80:FC:80' };

  const n1 = resolveIconMacs(document);
  expect(n1).toBe(1);
  const img = document.querySelector('img') as HTMLImageElement;
  expect(img.getAttribute('data-ubicon-mac')).toBe(MAC);

  // Ancestor's props swap to a different mac, but the img's src never
  // changed — the cache should hold, so the original stamp survives
  // unrecounted rather than being overwritten.
  (div as any)['__reactProps$stable1'] = { mac: 'bb:bb:bb:bb:bb:bb' };

  const n2 = resolveIconMacs(document);
  expect(n2).toBe(0);
  expect(img.getAttribute('data-ubicon-mac')).toBe(MAC);
});
