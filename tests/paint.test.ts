// @vitest-environment happy-dom
import { expect, test } from 'vitest';
import { paintImg, unpaintImg } from '../content/paint';

const DATA = 'data:image/png;base64,XX';

test('paint sets src, clears srcset, marks element', () => {
  const img = document.createElement('img');
  img.src = 'https://static.ui.com/fingerprint/0/5588_51x51.png';
  img.srcset = '/a.png 1x,/a@2x.png 2x';
  paintImg(img, DATA);
  expect(img.src).toBe(DATA);
  expect(img.srcset).toBe('');
  expect(img.dataset.ubicon).toBe('1');
});

test('paint is idempotent and unpaint restores the original', () => {
  const img = document.createElement('img');
  img.src = 'https://example.test/orig.png';
  img.srcset = 'x 1x';
  paintImg(img, DATA);
  paintImg(img, DATA); // second call must not clobber saved originals
  unpaintImg(img);
  expect(img.src).toBe('https://example.test/orig.png');
  expect(img.srcset).toBe('x 1x');
  expect(img.dataset.ubicon).toBeUndefined();
});

test('repaint after framework rewrites src re-asserts data uri', () => {
  const img = document.createElement('img');
  img.src = 'https://example.test/orig.png';
  paintImg(img, DATA);
  img.src = 'https://example.test/react-rewrote.png'; // simulated re-render
  paintImg(img, DATA);
  expect(img.src).toBe(DATA);
  unpaintImg(img);
  expect(img.src).toBe('https://example.test/orig.png'); // original from FIRST paint
});
