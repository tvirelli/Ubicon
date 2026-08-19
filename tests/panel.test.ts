// @vitest-environment happy-dom
import { beforeEach, expect, test } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { ensureModalButton, ensureHeaderBadge } from '../content/panel';

beforeEach(() => fakeBrowser.reset());

function changeIconModalDom() {
  document.body.innerHTML = `
    <div role="dialog" class="modal__x">
      <header class="header__x"><div class="title__x">Change Icon</div></header>
      <img src="https://static.ui.com/fingerprint/0/1_129x129.png">
    </div>`;
}

function headerDom() {
  document.body.innerHTML = `
    <header>
      <a data-testid="applink-site-network"><svg class="Logo-module_logo__x" width="28px"></svg></a>
      <div><svg class="Logo-module_logo__x" width="50px"></svg></div>
    </header>`;
}

test('ensureModalButton injects the trigger into the title div without throwing', () => {
  changeIconModalDom();
  expect(() => ensureModalButton(document)).not.toThrow();
  const title = document.querySelector('.title__x')!;
  const btn = title.querySelector('#ubicon-modal-btn');
  expect(btn).not.toBeNull();
  expect(document.querySelector('#ubicon-modal-btn')).toBe(btn);
});

test('ensureModalButton is idempotent: calling twice does not duplicate', () => {
  changeIconModalDom();
  ensureModalButton(document);
  ensureModalButton(document);
  const title = document.querySelector('.title__x')!;
  expect(title.querySelectorAll('#ubicon-modal-btn').length).toBe(1);
});

test('ensureHeaderBadge injects the badge right after the 50px center logo, not the 28px nav one', () => {
  headerDom();
  expect(() => ensureHeaderBadge(document)).not.toThrow();
  const badge = document.getElementById('ubicon-header-badge');
  expect(badge).not.toBeNull();
  const bigLogo = document.querySelector('svg[width="50px"]')!;
  const smallLogo = document.querySelector('svg[width="28px"]')!;
  expect(bigLogo.nextElementSibling).toBe(badge);
  expect(smallLogo.nextElementSibling).not.toBe(badge);
});

test('ensureHeaderBadge is idempotent: calling twice does not duplicate', () => {
  headerDom();
  ensureHeaderBadge(document);
  ensureHeaderBadge(document);
  expect(document.querySelectorAll('#ubicon-header-badge').length).toBe(1);
});
