// The GitHub sync section of the Options page: the pitch, the setup wizard,
// the setup-code screen and the controls of a connected browser. All markup
// lives in index.html; this file only shows, hides and fills it. Connecting
// itself runs in the background worker (shared/sync/engine.ts). The page
// asks for the browser permission, sends one message and watches progress.
import { browser } from 'wxt/browser';
import type { UbiconMsg, UbiconReply } from '../../shared/messages';
import type { ConnectResult, ConnectStep, SetupFailure, SyncStatus } from '../../shared/sync/engine';
import type { SyncHint } from '../../shared/sync/hint';
import { requestGitHubAccess } from '../../shared/sync/permission';
import { REPO_RE, decodeSetupCode, looksLikeToken } from '../../shared/sync/setup-code';
import {
  BAD_REPO_TEXT, CLASSIC_TOKEN_TEXT, NEW_REPO_URL, NEW_TOKEN_URL, NOT_A_SETUP_CODE_TEXT,
  PASTED_TOKEN_NOT_CODE_TEXT, PERMISSION_DENIED_TEXT, SECRET_TEXT, SIGNUP_URL, TOKENS_URL,
  checklistLabels, clearWizardStep, disconnectedText, expiryWarning, fixCardFor, hintText,
  iconsSyncedText, loadWizardStep, repoSettingsUrl, repoUrl, runningLine,
  saveWizardStep, statusText, WIZARD_STEP_KEY,
  type FixCard, type FixContext, type WizardStep,
} from '../../shared/sync/ui-text';

const send = (msg: UbiconMsg) => browser.runtime.sendMessage(msg) as Promise<UbiconReply>;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const all = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const LINKS: Record<string, string> = {
  'new-repo': NEW_REPO_URL,
  'new-token': NEW_TOKEN_URL,
  'signup': SIGNUP_URL,
};

// ---- the live checklist ----

type LineState = 'waiting' | 'running' | 'done' | 'failed';
// Read out by screen readers; sighted users get the mark's shape.
const STATE_WORDS: Record<LineState, string> = { waiting: 'waiting', running: 'checking', done: 'done', failed: 'needs a fix' };

interface Checklist {
  start(labels: string[]): void;
  progress(step: ConnectStep): void;
  finish(): void;
  // Marks the given line failed, or the one that was running when `line` is null.
  fail(line: number | null): void;
  hide(): void;
}

function createChecklist(ol: HTMLElement): Checklist {
  let running = 0;
  const lines = () => [...ol.children] as HTMLElement[];
  const set = (li: HTMLElement | undefined, state: LineState) => {
    if (!li) return;
    li.dataset.state = state;
    li.querySelector('.state')!.textContent = `, ${STATE_WORDS[state]}`;
  };
  const upTo = (n: number) => lines().forEach((li, i) => set(li, i < n ? 'done' : i === n ? 'running' : 'waiting'));
  return {
    start(labels) {
      ol.replaceChildren(...labels.map(label => {
        const li = el('li');
        const mark = el('span', 'mark');
        mark.setAttribute('aria-hidden', 'true');
        li.append(mark, el('span', 'label', label), el('span', 'vh state'));
        return li;
      }));
      ol.hidden = false;
      running = 0;
      upTo(0);
    },
    progress(step) {
      // Storage events can arrive late or out of order; a checklist that
      // un-ticks a line would only confuse, so it never moves backwards.
      const n = runningLine(step);
      if (n < running) return;
      running = n;
      upTo(n);
    },
    finish() { upTo(lines().length); },
    fail(line) {
      const at = Math.min(line ?? running, lines().length - 1);
      lines().forEach((li, i) => set(li, i < at ? 'done' : i === at ? 'failed' : 'waiting'));
    },
    hide() { ol.hidden = true; ol.replaceChildren(); },
  };
}

// ---- fix cards ----

function renderFixCard(
  host: HTMLElement,
  card: FixCard,
  opts: { goto: (step: WizardStep) => void; retryLabel: string; onRetry: () => void },
): void {
  const box = el('div', 'fix');
  box.setAttribute('role', 'group');
  const title = el('h3', undefined, card.title);
  title.id = `${host.id}-title`;
  box.setAttribute('aria-labelledby', title.id);
  box.append(title, el('p', undefined, card.body));

  if (card.steps.length) {
    const ol = el('ol', 'clicks');
    for (const step of card.steps) ol.append(el('li', undefined, step));
    box.append(ol);
  }
  if (card.figure === 'access') {
    // The drawing for this fix is static markup in index.html; a copy of it
    // goes into the card.
    const tpl = document.getElementById('fig-fix-access') as HTMLTemplateElement | null;
    if (tpl) box.append(tpl.content.cloneNode(true));
  }
  if (card.note) box.append(el('p', undefined, card.note));

  const actions = el('div', 'actions');
  for (const action of card.actions) {
    if ('href' in action) {
      const a = el('a', 'btn small', action.label);
      a.href = action.href;
      a.target = '_blank';
      a.rel = 'noopener';
      actions.append(a);
    } else {
      const b = el('button', 'btn small', action.label);
      b.type = 'button';
      b.addEventListener('click', () => opts.goto(action.step));
      actions.append(b);
    }
  }
  const retry = el('button', 'btn small', opts.retryLabel);
  retry.type = 'button';
  retry.dataset.retry = '';
  retry.addEventListener('click', opts.onRetry);
  actions.append(retry);
  box.append(actions);
  host.replaceChildren(box);
}

// ---- the setup code card ----

const MASK = '•'.repeat(24);

// `code` lives in this closure and reaches the DOM only while revealed.
function buildSetupCodeCard(code: string, opts: { revealed: boolean }): HTMLElement {
  let revealed = opts.revealed;
  const card = el('div', 'code-card');
  card.append(
    el('h3', undefined, 'Set up your other browsers'),
    el('p', undefined, 'On each other browser, open Ubicon\'s options, click "I have a setup code" and paste this code.'),
  );
  const box = el('div', 'code-box');
  box.dataset.role = 'setup-code';
  const show = el('button', 'btn small');
  show.type = 'button';
  show.dataset.role = 'show-code';
  const copy = el('button', 'btn small', 'Copy');
  copy.type = 'button';
  copy.dataset.role = 'copy-code';
  const copied = el('span', 'copied');
  copied.setAttribute('role', 'status');

  const paint = () => {
    box.textContent = revealed ? code : MASK;
    box.setAttribute('aria-label', revealed ? 'Setup code' : 'Setup code, hidden');
    show.textContent = revealed ? 'Hide' : 'Show';
    show.setAttribute('aria-pressed', String(revealed));
  };
  show.addEventListener('click', () => { revealed = !revealed; paint(); });
  copy.addEventListener('click', () => {
    navigator.clipboard.writeText(code).then(
      () => { copied.textContent = 'Copied'; },
      () => {
        // Clipboard access can be refused; showing the code lets the user
        // copy it by hand.
        revealed = true;
        paint();
        copied.textContent = 'Could not copy. Select the code and copy it by hand.';
      },
    );
  });
  paint();

  const actions = el('div', 'actions');
  actions.append(show, copy, copied);
  card.append(box, actions, el('p', 'quiet', SECRET_TEXT));
  return card;
}

// ---- the page ----

type Screen = WizardStep | 'success';
type PageState = 'off' | 'on' | 'gone';

export async function initSyncUi(): Promise<void> {
  // The cast keeps TypeScript from narrowing this to null for good: it is
  // assigned inside closures, which the narrowing does not follow.
  let status = null as SyncStatus | null;
  let screen: Screen | null = null; // null: the normal Options page is showing
  let pageState: PageState = 'off';
  let connecting = false;
  // Screens visited, so Back returns to where the user came from (the
  // setup-code screen can lead into step 2, for one).
  const trail: Screen[] = [];

  for (const a of all('a[data-href]')) (a as HTMLAnchorElement).href = LINKS[a.dataset.href!] ?? '#';
  ($('replace-new-token') as HTMLAnchorElement).href = NEW_TOKEN_URL;
  ($('gone-tokens') as HTMLAnchorElement).href = TOKENS_URL;

  // ---- moving between screens ----

  function paintProgress(s: Screen) {
    const order: Screen[] = ['repo', 'token', 'connect'];
    const at = s === 'success' ? order.length : order.indexOf(s);
    $('steps').parentElement!.hidden = s === 'code';
    $('eta').hidden = s !== 'intro';
    all('#steps li').forEach((li, i) => {
      const state = at > i ? 'done' : at === i ? 'current' : 'upcoming';
      li.dataset.state = state;
      if (state === 'current') li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
      li.querySelector('.step-state')!.textContent = state === 'done' ? ', done' : '';
    });
  }

  function show(next: Screen | null, opts: { remember?: boolean } = {}) {
    if (next && screen && screen !== next && opts.remember !== false) trail.push(screen);
    if (!next) trail.length = 0;
    screen = next;
    $('page').hidden = next !== null;
    $('wizard').hidden = next === null;
    for (const s of all('.screen')) s.hidden = s.dataset.screen !== next;
    if (!next) return;
    paintProgress(next);
    // Focus moves to the new heading so keyboard and screen-reader users land
    // at the top of the step, not on a button that no longer exists.
    document.querySelector<HTMLElement>(`.screen[data-screen="${next}"] h2`)?.focus();
    window.scrollTo?.(0, 0);
  }

  function goto(step: WizardStep) {
    show(step);
    void saveWizardStep(step);
  }

  function leaveWizard() {
    show(null);
    void clearWizardStep();
    void refresh();
  }

  function back() {
    const prev = trail.pop();
    if (!prev || prev === 'success') { leaveWizard(); return; }
    show(prev, { remember: false });
    void saveWizardStep(prev);
  }

  for (const b of all('[data-goto]')) b.addEventListener('click', () => goto(b.dataset.goto as WizardStep));
  for (const b of all('[data-back]')) b.addEventListener('click', back);

  // "Open GitHub" is a plain link, so the browser opens the new tab itself
  // and this tab stays where it is. Once clicked, the big button becomes
  // "I did this, next": nobody has to wonder whether to click it again.
  for (const open of all('[data-open]')) {
    open.addEventListener('click', () => {
      const step = open.dataset.open!;
      // After this click has been handled, so swapping the button cannot get
      // in the way of the link opening.
      setTimeout(() => {
        open.hidden = true;
        for (const n of all(`[data-done="${step}"], [data-again="${step}"]`)) n.hidden = false;
        for (const n of all(`[data-skip="${step}"]`)) n.hidden = true;
        document.querySelector<HTMLElement>(`[data-done="${step}"]`)?.focus();
      }, 0);
    });
  }

  // Show and Hide for the secret fields.
  for (const b of all('[data-reveal]')) {
    b.addEventListener('click', () => {
      const input = $<HTMLInputElement>(b.dataset.reveal!);
      const reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      b.textContent = reveal ? 'Hide' : 'Show';
      b.setAttribute('aria-pressed', String(reveal));
    });
  }

  // ---- connecting (wizard step 3, setup code, Replace token) ----

  interface ConnectForm {
    button: HTMLButtonElement;
    note: HTMLElement;
    fix: HTMLElement;
    checks: Checklist;
    context: FixContext;
    retryLabel: string;
    // Reads and checks the fields. Runs inside the click, before the browser
    // permission prompt, so it must not await anything. Null: nothing to
    // send, and a message has been shown.
    read: () => { msg: UbiconMsg; readOnly: boolean; repo?: string } | null;
    done: (reply: Extract<UbiconReply, { ok: true }>) => void;
  }

  function submit(form: ConnectForm) {
    if (connecting) return;
    form.note.textContent = '';
    const input = form.read();
    if (!input) return;
    // FIRST, before any await: Firefox forgets that this is a click handler
    // the moment it awaits, and permissions.request then rejects. See
    // shared/sync/permission.ts. Everything above this line is synchronous.
    let access: Promise<boolean>;
    try {
      access = requestGitHubAccess();
    } catch {
      access = Promise.resolve(false);
    }
    void run(form, input, access);
  }

  async function run(form: ConnectForm, input: NonNullable<ReturnType<ConnectForm['read']>>, access: Promise<boolean>) {
    connecting = true;
    form.button.disabled = true;
    form.fix.replaceChildren();
    const onProgress = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      const step = changes['sync:progress']?.newValue;
      if (area === 'local' && typeof step === 'string') form.checks.progress(step as ConnectStep);
    };
    try {
      if (!(await access.catch(() => false))) {
        form.checks.hide();
        form.note.textContent = PERMISSION_DENIED_TEXT;
        return;
      }
      form.checks.start(checklistLabels(input.readOnly, input.repo));
      browser.storage.onChanged.addListener(onProgress);
      let reply: UbiconReply;
      try {
        reply = await send(input.msg);
      } catch {
        // The message itself failed (worker restarting, for one). The token
        // is never part of what gets shown.
        reply = { ok: false, error: 'other', reason: 'other' };
      }
      if (reply.ok) {
        form.checks.finish();
        form.done(reply);
        return;
      }
      // 'view-only' is the worker's answer to an icon change on a view-only
      // browser; it cannot come back from a connect, so it counts as "other".
      const reason: SetupFailure = !reply.reason || reply.reason === 'view-only' ? 'other' : reply.reason;
      const card = fixCardFor(reason, { others: reply.others, repo: input.repo ?? status?.repo, context: form.context });
      form.checks.fail(card.line);
      if (card.askRepo) $('repo-field').hidden = false;
      renderFixCard(form.fix, card, { goto, retryLabel: form.retryLabel, onRetry: () => submit(form) });
    } finally {
      browser.storage.onChanged.removeListener(onProgress);
      form.button.disabled = false;
      connecting = false;
    }
  }

  // Tokens and setup codes have no spaces, so stray ones from a sloppy
  // copy are dropped without comment.
  function trimOnInput(input: HTMLInputElement, after?: () => void) {
    input.addEventListener('input', () => {
      const trimmed = input.value.trim();
      if (trimmed !== input.value) input.value = trimmed;
      after?.();
    });
  }

  // Step 3.
  const token = $<HTMLInputElement>('token');
  const repo = $<HTMLInputElement>('repo');
  const paintClassic = () => {
    const classic = looksLikeToken(token.value) === 'classic';
    $('classic').hidden = !classic;
    $('classic-text').textContent = classic ? CLASSIC_TOKEN_TEXT : '';
    return classic;
  };
  trimOnInput(token, () => { $('token-note').textContent = ''; paintClassic(); });

  const connectForm: ConnectForm = {
    button: $<HTMLButtonElement>('connect'),
    note: $('token-note'),
    fix: $('connect-fix'),
    checks: createChecklist($('connect-checks')),
    context: 'wizard',
    retryLabel: 'Connect again',
    read() {
      const value = token.value.trim();
      if (!value) { this.note.textContent = 'Paste your token first.'; token.focus(); return null; }
      if (paintClassic()) return null;
      const typedRepo = $('repo-field').hidden ? '' : repo.value.trim();
      if (typedRepo && !REPO_RE.test(typedRepo)) { this.note.textContent = BAD_REPO_TEXT; repo.focus(); return null; }
      return {
        msg: { type: 'sync-connect', token: value, ...(typedRepo ? { repo: typedRepo } : {}) },
        readOnly: false,
        repo: typedRepo || undefined,
      };
    },
    done: reply => succeed(reply.connected),
  };

  // The setup-code screen.
  const code = $<HTMLInputElement>('code');
  trimOnInput(code, () => { $('code-note').textContent = ''; });
  const codeForm: ConnectForm = {
    button: $<HTMLButtonElement>('code-connect'),
    note: $('code-note'),
    fix: $('code-fix'),
    checks: createChecklist($('code-checks')),
    context: 'code',
    retryLabel: 'Connect again',
    read() {
      const decoded = decodeSetupCode(code.value);
      if (!decoded) {
        this.note.textContent = !code.value.trim() ? 'Paste your setup code first.'
          : looksLikeToken(code.value) === 'unknown' ? NOT_A_SETUP_CODE_TEXT : PASTED_TOKEN_NOT_CODE_TEXT;
        code.focus();
        return null;
      }
      return {
        msg: { type: 'sync-connect', token: decoded.token, repo: decoded.repo, readOnly: decoded.readOnly },
        readOnly: decoded.readOnly,
        repo: decoded.repo,
      };
    },
    done: reply => succeed(reply.connected),
  };

  // Replace token, on a connected browser.
  const newToken = $<HTMLInputElement>('new-token');
  trimOnInput(newToken, () => { $('replace-note').textContent = ''; });
  const replaceForm: ConnectForm = {
    button: $<HTMLButtonElement>('replace-go'),
    note: $('replace-note'),
    fix: $('replace-fix'),
    checks: createChecklist($('replace-checks')),
    context: 'replace',
    retryLabel: 'Try again',
    read() {
      const value = newToken.value.trim();
      if (!value) { this.note.textContent = 'Paste the new token first.'; newToken.focus(); return null; }
      if (looksLikeToken(value) === 'classic') { this.note.textContent = CLASSIC_TOKEN_TEXT; return null; }
      return { msg: { type: 'sync-replace-token', token: value }, readOnly: status?.readOnly === true, repo: status?.repo };
    },
    done: reply => {
      newToken.value = '';
      closePanels();
      if (reply.status) paintStatus(reply.status);
    },
  };

  for (const [form, input] of [[connectForm, token], [codeForm, code], [replaceForm, newToken]] as const) {
    form.button.addEventListener('click', () => submit(form));
    // Enter in the field is the same user gesture as the click.
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(form); });
  }
  repo.addEventListener('keydown', e => { if (e.key === 'Enter') submit(connectForm); });

  // ---- success ----

  function succeed(connected: ConnectResult | undefined) {
    // Connected: the secrets have done their job, so they leave the page.
    token.value = '';
    code.value = '';
    repo.value = '';
    $('repo-field').hidden = true;
    for (const form of [connectForm, codeForm]) { form.checks.hide(); form.fix.replaceChildren(); }
    void clearWizardStep();

    const result = connected ?? { repo: '', assignments: 0, readOnly: false };
    $('success-h').textContent = iconsSyncedText(result.assignments);
    const link = $<HTMLAnchorElement>('success-repo');
    link.textContent = result.repo;
    link.href = repoUrl(result.repo);
    $('success-view-only').hidden = !result.readOnly;
    // A view-only browser does not hand out setup codes.
    $('success-others').hidden = result.readOnly;
    $('success-code').replaceChildren();
    show('success');
    if (!result.readOnly) {
      // Fetched now, not on the Copy click: writing to the clipboard has to
      // happen inside the click itself, with nothing awaited in between.
      void send({ type: 'sync-setup-code' }).then(reply => {
        if (reply.ok && reply.setupCode && screen === 'success') {
          $('success-code').replaceChildren(buildSetupCodeCard(reply.setupCode, { revealed: false }));
        }
      }, () => {});
    }
  }
  $('success-done').addEventListener('click', leaveWizard);

  // ---- the normal page ----

  function paintHint(hint: SyncHint | null | undefined) {
    $('hint').hidden = !hint;
    $('hint-text').textContent = hint ? hintText(hint.by) : '';
    $('code-repo-line').hidden = !hint;
    $('code-repo-line').textContent = hint ? `This connects to the private folder ${hint.repo}.` : '';
  }

  function closePanels() {
    for (const [button, panel] of [['show-code', 'code-panel'], ['replace-open', 'replace-panel'], ['disconnect-open', 'disconnect-panel']] as const) {
      $(panel).hidden = true;
      $(button).setAttribute('aria-expanded', 'false');
    }
    // The code leaves the DOM when its panel closes.
    $('code-panel').replaceChildren();
    $('show-code').textContent = 'Show setup code';
    replaceForm.checks.hide();
    replaceForm.fix.replaceChildren();
    $('replace-note').textContent = '';
    $('disconnect-note').textContent = '';
  }

  function openPanel(button: string, panel: string) {
    closePanels();
    $(panel).hidden = false;
    $(button).setAttribute('aria-expanded', 'true');
  }

  function paintStatus(s: SyncStatus) {
    status = s;
    if (pageState === 'gone' && !s.connected) return; // keep the "where your data went" message up
    const was = pageState;
    pageState = s.connected ? 'on' : 'off';
    $('sync-off').hidden = pageState !== 'off';
    $('sync-on').hidden = pageState !== 'on';
    $('sync-gone').hidden = true;
    if (pageState !== 'on') return;
    if (was !== 'on') closePanels();

    const line = statusText(s);
    $('sync-status').textContent = line.text;
    $('sync-status-box').dataset.tone = line.tone;
    const link = $<HTMLAnchorElement>('sync-repo');
    link.textContent = s.repo ?? '';
    link.href = repoUrl(s.repo ?? '');
    $('view-only-badge').hidden = !s.readOnly;
    $('view-only-note').hidden = !s.readOnly;
    $('show-code').hidden = s.readOnly;
    const expiry = expiryWarning(s.tokenExpiresAt);
    $('expiry').hidden = !expiry;
    $('expiry').textContent = expiry ? `${expiry} Create a new one on GitHub and click Replace token.` : '';

    if (s.paused === 'reach') {
      // Fixing the token on GitHub lifts the pause at the next sync; "Check
      // again" just makes that sync happen now.
      renderFixCard($('paused-fix'), fixCardFor('token-too-broad', { others: s.othersInReach, repo: s.repo, context: 'paused' }), {
        goto, retryLabel: 'Check again', onRetry: () => void syncNow(),
      });
    } else {
      $('paused-fix').replaceChildren();
    }
  }

  async function refresh() {
    let reply: UbiconReply;
    try {
      reply = await send({ type: 'sync-status' });
    } catch {
      return; // the worker is restarting; the next storage change asks again
    }
    if (!reply.ok || !reply.status) return;
    paintStatus(reply.status);
    paintHint(reply.hint);
  }

  async function syncNow() {
    const button = $<HTMLButtonElement>('sync-now');
    button.disabled = true;
    button.textContent = 'Syncing...';
    try {
      const reply = await send({ type: 'sync-now' });
      if (reply.ok && reply.status) paintStatus(reply.status);
    } catch {
      // Nothing to add: the status line already reports the last error.
    } finally {
      button.disabled = false;
      button.textContent = 'Sync now';
    }
  }

  $('setup-start').addEventListener('click', () => goto('intro'));
  $('setup-code').addEventListener('click', () => goto('code'));
  $('hint-enter').addEventListener('click', () => goto('code'));
  $('hint-dismiss').addEventListener('click', async () => {
    $('hint').hidden = true;
    await send({ type: 'sync-dismiss-hint' });
  });
  $('sync-now').addEventListener('click', () => void syncNow());

  $('show-code').addEventListener('click', async () => {
    if (!$('code-panel').hidden) { closePanels(); return; }
    const reply = await send({ type: 'sync-setup-code' });
    if (!reply.ok || !reply.setupCode) return;
    openPanel('show-code', 'code-panel');
    // This button is the Show button, so the code opens revealed.
    $('code-panel').replaceChildren(buildSetupCodeCard(reply.setupCode, { revealed: true }));
    $('show-code').textContent = 'Hide setup code';
  });

  $('replace-open').addEventListener('click', () => {
    if (!$('replace-panel').hidden) { closePanels(); return; }
    openPanel('replace-open', 'replace-panel');
    newToken.focus();
  });
  $('replace-cancel').addEventListener('click', () => { newToken.value = ''; closePanels(); });

  $('disconnect-open').addEventListener('click', () => {
    if (!$('disconnect-panel').hidden) { closePanels(); return; }
    $<HTMLInputElement>('remove-hint').checked = false;
    openPanel('disconnect-open', 'disconnect-panel');
  });
  $('disconnect-cancel').addEventListener('click', closePanels);
  $('disconnect-go').addEventListener('click', async () => {
    const button = $<HTMLButtonElement>('disconnect-go');
    const repoWas = status?.repo;
    button.disabled = true;
    try {
      const reply = await send({ type: 'sync-disconnect', removeHint: $<HTMLInputElement>('remove-hint').checked });
      if (!reply.ok) { $('disconnect-note').textContent = 'Could not disconnect. Try again.'; return; }
      closePanels();
      pageState = 'gone';
      $('sync-on').hidden = true;
      $('sync-off').hidden = true;
      $('sync-gone').hidden = false;
      $('gone-text').textContent = disconnectedText(reply.mode ?? 'browser');
      const settings = $<HTMLAnchorElement>('gone-repo');
      settings.href = repoWas ? repoSettingsUrl(repoWas) : 'https://github.com';
    } catch {
      $('disconnect-note').textContent = 'Could not disconnect. Try again.';
    } finally {
      button.disabled = false;
    }
  });
  $('gone-done').addEventListener('click', () => { pageState = 'off'; void refresh(); });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if ('sync:state' in changes || 'sync:mode' in changes || 'sync:dirty' in changes) void refresh();
    // The popup's "Enter setup code" button writes the step and opens this
    // page. If the page was already open, this is how it finds out.
    // Only "code" is honored: it is the one step anything outside this page
    // writes, and reacting to the others would mean chasing our own saves.
    const step = changes[WIZARD_STEP_KEY]?.newValue;
    if (step === 'code' && screen !== 'code' && screen !== 'success' && !connecting) show('code');
  });
  // Keeps "Synced 4 minutes ago" honest while the tab sits open.
  setInterval(() => { if (status?.connected && screen === null && pageState === 'on') paintStatus(status); }, 60_000);

  await refresh();
  const saved = await loadWizardStep();
  if (saved && !status?.connected) show(saved);
  else if (saved) void clearWizardStep(); // connected since: the wizard has nothing left to do
}
