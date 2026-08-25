import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { AppShell, AppShellToggle, Header } from "@cloistr/ui/components";
import { AuthProvider } from "@cloistr/auth";
// SpaceNavLinks renders NavLink, which needs a router as soon as the rail is in
// flow (desktop). On mobile the drawer is closed, so this only bites above the
// breakpoint — exactly the case worth covering.
import { MemoryRouter } from "react-router-dom";
import { findNavAffordances, stubViewport } from "@cloistr/ui/testing";
import { SpaceNavLinks } from "./SpaceNavLinks";

/**
 * Operator: "space also has extra space above the header now as well."
 *
 * That blank strip was AppShell's default inline placement: with no
 * `toggleInHeader`, the shell renders its trigger as its own row ABOVE the
 * children, and space's header is a child. The fix is to portal the single
 * control into the shared Header's slot instead.
 *
 * This renders the REAL Header so the slot exists — a hand-rolled <header>
 * fixture has no [data-appshell-slot] and would pass for the wrong reason.
 * Signed-out is the correct state and needs no network.
 *
 * jsdom does not lay out, so this is structural only: it cannot measure the
 * strip's height, it asserts the placement that produced it.
 */

const MOBILE = 390;
const DESKTOP = 1440;

afterEach(cleanup);

function renderChrome() {
  return render(
    <AuthProvider>
      <MemoryRouter>
        <AppShell serviceId="space" nav={<SpaceNavLinks />} toggleInHeader>
          <AppShellToggle />
          <Header activeServiceId="space" />
          <main>content</main>
        </AppShell>
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe("space chrome at 390x844", () => {
  it("portals the toggle into the header slot, not a row above the content", () => {
    stubViewport(window, MOBILE);
    const { container } = renderChrome();
    const slot = container.querySelector("[data-appshell-slot]");
    expect(slot, "Header renders no [data-appshell-slot]").not.toBeNull();
    expect(
      slot!.querySelector('[data-testid="appshell-hamburger"]'),
      "the toggle did not land in the header slot — it is rendering inline above the content",
    ).not.toBeNull();
  });

  it("exposes EXACTLY ONE nav trigger and it is inside the header", () => {
    // Exact, not `<= 1`: space has nav, so a trigger MUST exist on mobile.
    // `<= 1` is also satisfied by zero, which is the silent-green shape.
    stubViewport(window, MOBILE);
    renderChrome();
    const r = findNavAffordances(document, window);
    expect(
      r.triggers,
      `expected one nav trigger, found ${r.triggers.length}`,
    ).toHaveLength(1);
    expect(r.triggers[0]?.insideHeader).toBe(true);
    expect(r.appOwned).toHaveLength(0);
  });
});

describe("space chrome at 1440x900", () => {
  it("keeps ONE trigger in the header — it collapses the rail, it does not hide it", () => {
    // Not zero. docs has commands but no nav, so it legitimately shows nothing
    // on desktop; space HAS nav, and the model is "collapse, never conceal":
    // the same control that opens the drawer on a phone collapses the rail to
    // icons on a wide screen. Asserting zero here would be copying docs'
    // expectation into an app with different chrome.
    stubViewport(window, DESKTOP);
    renderChrome();
    const r = findNavAffordances(document, window);
    expect(
      r.triggers,
      `expected one nav trigger, found ${r.triggers.length}`,
    ).toHaveLength(1);
    expect(r.triggers[0]?.insideHeader).toBe(true);
    expect(
      r.appOwned,
      "space must not grow a second, app-owned trigger",
    ).toHaveLength(0);
  });
});
