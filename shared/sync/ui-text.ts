// Words, links and small pure helpers for the GitHub sync screens (Options
// page and popup). Kept apart from the pages so the wording and the two setup
// links can be tested without a DOM, and so both pages say the same thing.
import { browser } from 'wxt/browser';
import type { ConnectStep, SetupFailure, SyncStatus } from './engine';

// ---- links ----

// Every value in these two links is fixed. Nothing is read from the user to
// build them, and the template repo name can never change (every installed
// copy points at it).
export const NEW_REPO_URL =
  'https://github.com/new?name=ubicon-sync&description=Private+sync+data+for+the+Ubicon+browser+extension&visibility=private&owner=%40me&template_owner=tvirelli&template_name=ubicon-sync-template';

// GitHub has no link parameter for "Repository access", and because this link
// prefills a repository permission the form lands on "All repositories". The
// wizard's warning box and the engine's reach check exist to correct that.
export const NEW_TOKEN_URL =
  'https://github.com/settings/personal-access-tokens/new?name=Ubicon+sync&description=Lets+the+Ubicon+browser+extension+sync+icon+assignments+to+the+ubicon-sync+repo&expires_in=none&contents=write';

export const TOKENS_URL = 'https://github.com/settings/personal-access-tokens';
export const SIGNUP_URL = 'https://github.com/signup';
// The full reference for the feature, on the website.
export const GUIDE_URL = 'https://www.tonyvirelli.com/ubicon/github-sync.html';
export const ISSUES_URL = 'https://github.com/tvirelli/Ubicon/issues';
// Used only when a failure leaves us without the owner's name. "user:@me" is
// GitHub's own search shorthand for the signed-in account.
export const FIND_REPO_URL = 'https://github.com/search?q=user%3A%40me+ubicon-sync&type=repositories';

export const repoUrl = (repo: string) => `https://github.com/${repo}`;
export const repoSettingsUrl = (repo: string) => `https://github.com/${repo}/settings`;

export const DEFAULT_REPO_NAME = 'ubicon-sync';
const repoName = (repo?: string) => repo?.split('/')[1] || DEFAULT_REPO_NAME;

// ---- fixed sentences ----

export const PERMISSION_DENIED_TEXT =
  'Ubicon needs permission to talk to api.github.com. Click Connect and choose Allow.';
export const CLASSIC_TOKEN_TEXT =
  'This is the older kind of GitHub token. It cannot be limited to one folder, so Ubicon does not use it. Step 2 creates the right kind, which starts with github_pat_.';
export const NOT_A_SETUP_CODE_TEXT =
  'That does not look like a setup code. A setup code starts with ubicon1. Copy it again from the browser where you set up sync.';
export const PASTED_TOKEN_NOT_CODE_TEXT =
  'That looks like a GitHub token, not a setup code. Use Create a new token instead, below, and paste it in step 3.';
export const BAD_REPO_TEXT = 'Type the repository as owner/name, for example yourname/ubicon-sync.';
export const VIEW_ONLY_TEXT = 'This browser is connected with a view-only token.';
export const SECRET_TEXT = 'This code contains your token, so treat it like a password.';

export const SETUP_CODE_FILENAME = 'ubicon-setup-code.txt';

// The text file behind the Download button on the setup code card. Written
// for someone who finds the file months later, as with the backup codes a
// site hands out when two-factor is turned on.
export function setupCodeFileText(code: string, repo: string): string {
  return [
    'Ubicon setup code',
    '',
    'Connects a browser to the GitHub sync repository ' + repo + '.',
    '',
    code,
    '',
    'To use it: install Ubicon, open its options page, click "I have a setup',
    'code", paste the line above and click Connect.',
    '',
    'Keep this file private. The code contains your GitHub access token: anyone',
    'who has it can read and change the icons in that repository. If it leaks,',
    'delete the token at https://github.com/settings/personal-access-tokens and',
    'set up sync again with a new one.',
    '',
  ].join('\n');
}

export const hintText = (by: string) =>
  `You have GitHub sync turned on in ${by}. Connect this browser to share the same icons.`;

export const iconsSyncedText = (n: number) =>
  n === 0 ? 'Sync is on. No icons yet' : n === 1 ? '1 icon is now synced' : `${n} icons are now synced`;

export const disconnectedText = (mode: 'browser' | 'local') =>
  mode === 'browser'
    ? 'Your icons are back in normal browser storage.'
    : 'You have more assignments than browser sync can hold. They stay in this browser.';

// ---- time ----

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const formatDate = (at: number) => new Date(at).toLocaleDateString();

// "just now", "5 minutes ago", "3 hours ago", then a plain date. A time in
// the future (a clock that was corrected) reads as "just now".
export function relativeTime(at: number, now: number = Date.now()): string {
  const ago = now - at;
  if (ago < MINUTE) return 'just now';
  if (ago < HOUR) {
    const m = Math.floor(ago / MINUTE);
    return m === 1 ? '1 minute ago' : `${m} minutes ago`;
  }
  if (ago < DAY) {
    const h = Math.floor(ago / HOUR);
    return h === 1 ? '1 hour ago' : `${h} hours ago`;
  }
  return `on ${formatDate(at)}`;
}

const EXPIRY_WARNING_DAYS = 14;

// Tokens made through the wizard link never expire, so this only speaks up
// for users who chose a date on GitHub's form.
export function expiryWarning(tokenExpiresAt: number | undefined, now: number = Date.now()): string | null {
  if (!tokenExpiresAt) return null;
  if (tokenExpiresAt <= now) return `Your GitHub token expired on ${formatDate(tokenExpiresAt)}.`;
  if (tokenExpiresAt - now > EXPIRY_WARNING_DAYS * DAY) return null;
  return `Your GitHub token expires on ${formatDate(tokenExpiresAt)}.`;
}

// ---- status line ----

export type Tone = 'ok' | 'warn' | 'error';
export interface StatusText { text: string; tone: Tone; }

const ERROR_TEXT: Record<NonNullable<SyncStatus['lastError']>, string> = {
  'auth': 'GitHub rejected the token. Click Replace token.',
  'not-found': 'The token works but cannot see the sync repo. Edit the token on GitHub and select that repo.',
  'rate-limit': 'GitHub asked Ubicon to slow down. It will try again by itself.',
  'network': 'Could not reach GitHub. Ubicon will try again by itself.',
  'conflict': 'Another browser saved at the same moment. Ubicon will try again by itself.',
  'bad-remote': 'The ubicon.json file in your repo is not readable, so nothing was changed.',
  'other': 'The last sync did not finish. Ubicon will try again by itself.',
};

const SHORT_ERROR_TEXT: Record<NonNullable<SyncStatus['lastError']>, string> = {
  'auth': 'Token rejected',
  'not-found': 'Repo not found',
  'rate-limit': 'GitHub is busy, will retry',
  'network': 'Offline, will retry',
  'conflict': 'Sync conflict, will retry',
  'bad-remote': 'Repo file not readable',
  'other': 'Sync problem, will retry',
};

// The full sentence for the Options page.
export function statusText(s: SyncStatus, now: number = Date.now()): StatusText {
  if (s.paused === 'reach') return { text: 'Paused. Your icons are safe in this browser, but nothing syncs until the token is fixed.', tone: 'error' };
  if (s.lastError) return { text: ERROR_TEXT[s.lastError], tone: s.lastError === 'auth' || s.lastError === 'not-found' || s.lastError === 'bad-remote' ? 'error' : 'warn' };
  if (!s.lastSyncAt) return { text: 'Connected. The first sync has not finished yet.', tone: 'ok' };
  const waiting = s.pending && !s.readOnly ? ' Changes are waiting to upload.' : '';
  return { text: `Synced ${relativeTime(s.lastSyncAt, now)}.${waiting}`, tone: 'ok' };
}

// A few words for the popup row.
export function shortStatusText(s: SyncStatus, now: number = Date.now()): StatusText {
  if (s.paused === 'reach') return { text: 'Paused: token reaches too much', tone: 'error' };
  if (s.lastError) return { text: SHORT_ERROR_TEXT[s.lastError], tone: 'warn' };
  if (!s.lastSyncAt) return { text: 'Connected', tone: 'ok' };
  return { text: `Synced ${relativeTime(s.lastSyncAt, now)}`, tone: 'ok' };
}

// ---- wizard steps ----

// The three numbered steps plus the two screens around them. "code" is the
// setup-code screen other browsers use. The success screen is never saved:
// by then the wizard is over.
export const WIZARD_STEPS = ['intro', 'repo', 'token', 'connect', 'code'] as const;
export type WizardStep = typeof WIZARD_STEPS[number];
export const WIZARD_STEP_KEY = 'sync:wizardStep';

export const isWizardStep = (v: unknown): v is WizardStep =>
  typeof v === 'string' && (WIZARD_STEPS as readonly string[]).includes(v);

// Only the step name is ever stored. The token stays in its input field, so
// a user who wanders off on GitHub comes back to the right screen and nothing
// secret has touched storage.
export async function loadWizardStep(): Promise<WizardStep | null> {
  const v = (await browser.storage.local.get(WIZARD_STEP_KEY))[WIZARD_STEP_KEY];
  return isWizardStep(v) ? v : null;
}
export const saveWizardStep = (step: WizardStep) => browser.storage.local.set({ [WIZARD_STEP_KEY]: step });
export const clearWizardStep = () => browser.storage.local.remove(WIZARD_STEP_KEY);

// ---- the live checklist ----

export const checklistLabels = (readOnly: boolean, repo?: string): [string, string, string, string] => [
  'Token accepted',
  `Found your ${repoName(repo)} folder`,
  'Token only reaches that folder',
  readOnly ? 'Icons downloaded' : 'Icons uploaded',
];

// The engine publishes the check it is working on. Everything before it has
// passed; "done" means all four have.
export function runningLine(step: ConnectStep): number {
  return step === 'token' ? 0 : step === 'repo' ? 1 : step === 'reach' ? 2 : step === 'sync' ? 3 : 4;
}

// ---- fix cards ----

export type FixAction =
  | { label: string; href: string }
  | { label: string; step: WizardStep };

export interface FixCard {
  // Which checklist line this failure belongs to. Null: whichever line was
  // running, since a dropped connection can happen anywhere.
  line: 0 | 1 | 2 | 3 | null;
  title: string;
  body: string;
  steps: string[];
  note?: string;
  actions: FixAction[];
  // Reveal the owner/name field (the repo may have a different name).
  askRepo?: boolean;
  // Show the "Repository access" picture next to the numbered fix.
  figure?: 'access';
}

// Where the card is shown changes which way out makes sense: "Back to step
// 2" means nothing on the Replace token form of a connected browser.
export type FixContext = 'wizard' | 'code' | 'replace' | 'paused';

const editTokenSteps = (name: string) => [
  'On GitHub, open the token named Ubicon sync and click Edit.',
  'Set Repository access to Only select repositories.',
  `Click Select repositories and pick ${name}.`,
  'Click Update.',
];

export function fixCardFor(
  reason: SetupFailure,
  opts: { others?: number; repo?: string; context?: FixContext } = {},
): FixCard {
  const context = opts.context ?? 'wizard';
  const name = repoName(opts.repo);
  const inWizard = context === 'wizard' || context === 'code';
  const newToken: FixAction = inWizard
    ? { label: 'Back to step 2', step: 'token' }
    : { label: 'Create a new token on GitHub', href: NEW_TOKEN_URL };
  const again = context === 'replace' ? 'click Replace token again' : context === 'paused' ? 'click Check again' : 'click Connect again';

  switch (reason) {
    case 'token-too-broad': {
      const n = opts.others;
      const reach = !n ? 'your other repositories' : n === 1 ? '1 other repository' : `${n} other repositories`;
      return {
        line: 2,
        title: 'This token can reach too much',
        body: `This token can reach ${reach}. Ubicon only needs ${name}.`,
        steps: editTokenSteps(name),
        note: `The same token keeps working after the edit, so you do not start over. Come back here and ${again}.`,
        actions: [{ label: 'Open your tokens on GitHub', href: TOKENS_URL }],
        figure: 'access',
      };
    }
    case 'token-rejected':
      return {
        line: 0,
        title: 'GitHub did not accept this token',
        body: 'It may be mistyped, expired or deleted.',
        steps: [
          'If the GitHub page that shows the token is still open, copy it again and paste it here.',
          inWizard ? 'Otherwise go back to step 2 and create a new token.' : 'Otherwise create a new token and paste that one.',
        ],
        actions: [newToken],
      };
    case 'repo-not-found':
      return {
        line: 1,
        title: `The token works, but it cannot see ${name}`,
        body: 'One of these three things will fix it.',
        steps: context === 'wizard'
          ? [
            `If you have not created ${name} yet, go back to step 1.`,
            `If you created it but did not pick it on the token: on GitHub, open the token, click Edit, choose Only select repositories, pick ${name} and click Update. The same token keeps working.`,
            'If you gave it a different name, type it below as owner/name.',
          ]
          : [
            `On GitHub, open the token, click Edit, choose Only select repositories, pick ${name} and click Update. The same token keeps working.`,
            `If ${name} was renamed or deleted, disconnect and set up sync again.`,
          ],
        actions: [
          ...(context === 'wizard' ? [{ label: 'Back to step 1', step: 'repo' } as FixAction] : []),
          { label: 'Open your tokens on GitHub', href: TOKENS_URL },
        ],
        askRepo: context === 'wizard',
      };
    case 'view-only-empty-repo':
      return {
        line: 3,
        title: 'This is a view-only token, and the folder is still empty',
        body: 'The first browser has to upload your icons, and a view-only token cannot do that. The first browser needs a Read and write token.',
        steps: [
          inWizard ? 'Go back to step 2 and create a token. The link sets Contents to Read and write for you.' : 'Create a new token. The link sets Contents to Read and write for you.',
          `Paste that token here and ${again}.`,
        ],
        actions: [newToken],
      };
    case 'network':
      return {
        line: null,
        title: 'Could not reach GitHub',
        body: 'Check your internet connection and try again. Nothing was changed.',
        steps: [],
        actions: [],
      };
    case 'rate-limit':
      return {
        line: null,
        title: 'GitHub asked Ubicon to slow down',
        body: 'Try again in a few minutes. Nothing was changed.',
        steps: [],
        actions: [],
      };
    case 'bad-remote':
      return {
        line: 3,
        title: 'The ubicon.json file in the repo is not readable',
        body: 'Ubicon never overwrites a file it cannot read, so nothing was changed.',
        steps: [
          'Open the repo on GitHub and look at ubicon.json.',
          'If it was edited by hand, undo that edit from the file history. If the file is not from Ubicon, delete it.',
        ],
        actions: [opts.repo
          ? { label: 'Open the repo on GitHub', href: repoUrl(opts.repo) }
          : { label: 'Find the repo on GitHub', href: FIND_REPO_URL }],
      };
    default:
      return {
        line: null,
        title: 'Something went wrong',
        body: 'Nothing was changed. Try again. If it keeps happening, tell us what you did just before.',
        steps: [],
        actions: [{ label: 'Report a problem', href: ISSUES_URL }],
      };
  }
}
