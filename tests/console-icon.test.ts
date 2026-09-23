import { beforeEach, expect, test, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { installConsoleRules, markConsoleActive } from '../shared/console-icon';

let setIcon: ReturnType<typeof vi.fn>;
let setTitle: ReturnType<typeof vi.fn>;
let removeRules: ReturnType<typeof vi.fn>;
let addRules: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fakeBrowser.reset();
  setIcon = vi.fn().mockResolvedValue(undefined);
  setTitle = vi.fn().mockResolvedValue(undefined);
  (fakeBrowser as any).action = { setIcon, setTitle, setBadgeText: vi.fn().mockResolvedValue(undefined) };
  removeRules = vi.fn((_ids: unknown, cb?: () => void) => cb?.());
  addRules = vi.fn((_rules: unknown, cb?: () => void) => cb?.());
});

test('without the rule engine (Firefox) installing rules is a quiet no-op', async () => {
  delete (fakeBrowser as any).declarativeContent;
  await expect(installConsoleRules(async () => ({}) as never)).resolves.toBe(false);
});

test('with the rule engine, the old rules are replaced by one rule per condition that sets the available icon', async () => {
  const rules: any[] = [];
  (fakeBrowser as any).declarativeContent = {
    onPageChanged: { removeRules, addRules: vi.fn((r: any[], cb?: () => void) => { rules.push(...r); cb?.(); }) },
    PageStateMatcher: class { constructor(public c: unknown) {} },
    SetIcon: class { constructor(public c: unknown) {} },
  };
  const icons = { 16: {} as ImageData, 32: {} as ImageData };
  await expect(installConsoleRules(async () => icons)).resolves.toBe(true);
  expect(removeRules).toHaveBeenCalledTimes(1);
  expect(rules).toHaveLength(1);
  expect(rules[0].conditions).toHaveLength(2);
  expect(rules[0].actions).toHaveLength(1);
  expect(rules[0].actions[0].c).toEqual({ imageData: icons });
});

test('a console where Ubicon already runs gets the normal icon and title back on its tab', async () => {
  await markConsoleActive(7);
  expect(setIcon).toHaveBeenCalledWith({ tabId: 7, path: { 16: '/icon/16.png', 32: '/icon/32.png' } });
  expect(setTitle).toHaveBeenCalledWith({ tabId: 7, title: 'Ubicon' });
});
