/**
 * Sidebar.tsx was removed in the AppShell migration (2026-08-24).
 *
 * AppShell from @cloistr/ui 0.30.0 now owns:
 *   - The single mobile hamburger (below APPSHELL_BREAKPOINT=768px)
 *   - The desktop sidebar (nav links in flow at 768px+)
 *
 * In-app navigation is now defined in SpaceNavLinks.tsx and passed to
 * AppShell via the `nav` prop. Mobile drawer state is managed by AppShell
 * internally — the app no longer owns `mobileNavOpen`.
 *
 * This file is kept so that git history remains intact. No component is
 * exported from here; any import of Sidebar should be removed.
 */
