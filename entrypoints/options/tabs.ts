// Two tabs on the settings page: Assignments and Settings. Settings is the
// default so every link that opened the page before still lands on the
// sync and controller sections; #assignments (the popup's Manage
// Assignments button) opens the other one. The choice is kept in the hash
// so a reload stays on the same tab.
const TABS = ['assignments', 'settings'] as const;
type Tab = typeof TABS[number];

const $ = (id: string) => document.getElementById(id)!;

function select(tab: Tab) {
  for (const t of TABS) {
    const on = t === tab;
    const button = $(`tab-${t}`);
    button.setAttribute('aria-selected', on ? 'true' : 'false');
    button.tabIndex = on ? 0 : -1;
    $(`panel-${t}`).hidden = !on;
  }
}

const fromHash = (): Tab => (location.hash === '#assignments' ? 'assignments' : 'settings');

export function initTabs(): void {
  for (const t of TABS) {
    $(`tab-${t}`).addEventListener('click', () => {
      location.hash = `#${t}`;
      select(t);
    });
  }
  // Left and right arrows move between tabs, as a tablist is expected to.
  $('tab-assignments').parentElement!.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const current = TABS.findIndex(t => $(`tab-${t}`).getAttribute('aria-selected') === 'true');
    const next = TABS[(current + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]!;
    location.hash = `#${next}`;
    select(next);
    $(`tab-${next}`).focus();
  });
  window.addEventListener('hashchange', () => select(fromHash()));
  select(fromHash());
}
