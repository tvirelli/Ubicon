// The popup's share of GitHub sync: a one-line status row, the heads-up for
// users whose other browser already syncs, and the view-only notice. Setup
// itself lives on the Options page, because a popup closes the moment focus
// moves to the GitHub tab.
import { browser } from 'wxt/browser';
import type { UbiconMsg, UbiconReply } from '../../shared/messages';
import type { SyncStatus } from '../../shared/sync/engine';
import { WIZARD_STEP_KEY, expiryWarning, hintText, shortStatusText } from '../../shared/sync/ui-text';

const send = (msg: UbiconMsg) => browser.runtime.sendMessage(msg) as Promise<UbiconReply>;
const $ = (id: string) => document.getElementById(id)!;

// `onStatus` lets the rest of the popup lock its editing controls on a
// view-only connection.
export async function initPopupSync(onStatus: (status: SyncStatus) => void): Promise<void> {
  function paint(reply: UbiconReply) {
    if (!reply.ok || !reply.status) return;
    const s = reply.status;
    const text = $('sync-text');
    const line = s.connected ? shortStatusText(s) : { text: '', tone: 'ok' as const };
    text.textContent = line.text;
    text.dataset.tone = line.tone;
    $('sync-setup').hidden = s.connected;
    $('sync-now').hidden = !s.connected;
    // The Options page holds everything else (setup code, Replace token,
    // Disconnect) and nothing but this link leads there once connected.
    $('sync-manage').hidden = !s.connected;
    $('view-only').hidden = !(s.connected && s.readOnly);

    const expiry = s.connected ? expiryWarning(s.tokenExpiresAt) : null;
    $('sync-expiry').hidden = !expiry;
    $('sync-expiry').textContent = expiry ? `${expiry} Replace token` : '';

    // Only an answer that carries `hint` says anything about the notice;
    // the reply to sync-now does not.
    if ('hint' in reply) {
      $('hint').hidden = !reply.hint;
      $('hint-text').textContent = reply.hint ? hintText(reply.hint.by) : '';
    }
    onStatus(s);
  }

  const openOptions = (e: Event) => {
    e.preventDefault();
    void browser.runtime.openOptionsPage();
  };
  $('sync-setup').addEventListener('click', openOptions);
  $('sync-expiry').addEventListener('click', openOptions);
  $('sync-manage').addEventListener('click', () => { void browser.runtime.openOptionsPage(); });

  $('sync-now').addEventListener('click', async () => {
    const button = $('sync-now') as HTMLButtonElement;
    button.disabled = true;
    $('sync-text').textContent = 'Syncing...';
    try {
      paint(await send({ type: 'sync-now' }));
    } catch {
      $('sync-text').textContent = 'Sync did not run';
    } finally {
      button.disabled = false;
    }
  });

  $('hint-enter').addEventListener('click', async () => {
    // The Options page opens on whatever step is saved here. Only the step
    // name is written; the setup code is pasted over there.
    await browser.storage.local.set({ [WIZARD_STEP_KEY]: 'code' });
    await browser.runtime.openOptionsPage();
  });
  $('hint-dismiss').addEventListener('click', async () => {
    $('hint').hidden = true;
    await send({ type: 'sync-dismiss-hint' });
  });

  browser.storage.onChanged.addListener((changes, area) => {
    // The heads-up marker arriving while the popup is open.
    if (area === 'sync' && 'sync:hint' in changes) send({ type: 'sync-status' }).then(paint).catch(() => {});
  });

  try {
    paint(await send({ type: 'sync-status' }));
  } catch {
    // The worker is restarting. The popup still works; the row just stays
    // on its "Set up GitHub sync" default until the popup is opened again.
  }
}
