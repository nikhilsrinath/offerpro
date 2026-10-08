/** The `?q=` a page was opened with: the app-wide search links to a list page
    with its search box already filled in, so the record is the one on screen. */
export function initialQuery() {
  try { return new URLSearchParams(window.location.search).get('q') || ''; } catch { return ''; }
}
