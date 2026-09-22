// Astro's `astro:page-load` event keeps firing on every client-side navigation for the
// lifetime of the document, even for scripts belonging to pages the user has since left.
// Delegating to `document.body` therefore leaks handlers across pages (e.g. a "create"
// handler bound while browsing one page can catch a form submit on a completely different
// page later). Binding directly to a page-local element instead scopes the handler to that
// page's own DOM, which Astro tears down when navigating away. `bindOnce` additionally
// guards against attaching the same handler twice to the same element.
export function bindOnce(el, marker, event, handler) {
    if (!el || el.dataset[marker]) return;
    el.dataset[marker] = "true";
    el.addEventListener(event, handler);
}
