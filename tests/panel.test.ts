// @vitest-environment happy-dom
import { beforeEach, expect, test } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { ensureModalButton } from '../content/panel';

beforeEach(() => fakeBrowser.reset());

function changeIconModalDom() {
  document.body.innerHTML = `
    <div role="dialog" class="modal__x">
      <header class="header__x"><div class="title__x">Change Icon</div></header>
      <img src="https://static.ui.com/fingerprint/0/1_129x129.png">
    </div>`;
}

test('ensureModalButton injects the trigger into the title div without throwing', () => {
  changeIconModalDom();
  expect(() => ensureModalButton(document)).not.toThrow();
  const title = document.querySelector('.title__x')!;
  const btn = title.querySelector('#ubicon-modal-btn');
  expect(btn).not.toBeNull();
  expect(document.querySelector('#ubicon-modal-btn')).toBe(btn);
});

test('ensureModalButton is idempotent — calling twice does not duplicate', () => {
  changeIconModalDom();
  ensureModalButton(document);
  ensureModalButton(document);
  const title = document.querySelector('.title__x')!;
  expect(title.querySelectorAll('#ubicon-modal-btn').length).toBe(1);
});
