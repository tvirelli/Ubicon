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

test('no react props anywhere leaves the icon unstamped, and stays unstamped on a second pass', () => {
  document.body.innerHTML = `<div><span>no props here</span><img src="${IMG_SRC}"></div>`;

  const n1 = resolveIconMacs(document);
  expect(n1).toBe(0);
  expect(document.querySelector('img')!.hasAttribute('data-ubicon-mac')).toBe(false);

  const n2 = resolveIconMacs(document);
  expect(n2).toBe(0);
  expect(document.querySelector('img')!.hasAttribute('data-ubicon-mac')).toBe(false);
});

test('the nearest ancestor with a valid mac wins over a farther one with a different mac', () => {
  document.body.innerHTML = `
    <div id="outer"><div id="inner"><img src="${IMG_SRC}"></div></div>`;
  (document.getElementById('outer') as any)['__reactProps$outer1'] = { mac: 'aa:aa:aa:aa:aa:aa' };
  (document.getElementById('inner') as any)['__reactProps$inner1'] = { mac: 'D4:3D:39:80:FC:80' };

  resolveIconMacs(document);

  expect(document.querySelector('img')!.getAttribute('data-ubicon-mac')).toBe(MAC);
});

test('an already-stamped icon is skipped and not recounted', () => {
  document.body.innerHTML = `<div><img src="${IMG_SRC}" data-ubicon-mac="${MAC}"></div>`;
  const div = document.querySelector('div')!;
  (div as any)['__reactProps$again1'] = { mac: 'bb:bb:bb:bb:bb:bb' };

  const n = resolveIconMacs(document);

  expect(n).toBe(0);
  expect(document.querySelector('img')!.getAttribute('data-ubicon-mac')).toBe(MAC);
});
