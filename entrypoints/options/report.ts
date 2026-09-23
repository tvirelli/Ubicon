import { initLayoutNotice, initProblemReport } from '../../shared/layout-notice';

// The layout-change notice at the top of the page, and the permanent
// "Report a problem" links at the bottom.
export async function initReportUi(): Promise<void> {
  initProblemReport({ issue: 'report-issue', mail: 'report-mail' });
  await initLayoutNotice({ aside: 'layout-warning', issue: 'layout-issue', mail: 'layout-mail', dismiss: 'layout-dismiss' });
}
