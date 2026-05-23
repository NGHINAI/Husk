import { describe, it, expect } from "vitest";
import { detectOpenedModal } from "../../src/snapshot/opened-modal.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const node = (i: string, r: string, n: string, c?: any[]): any => ({ i, r, n, s: [], c });

describe("detectOpenedModal", () => {
  it("returns null when no modal is present", () => {
    const snap = {
      root: node("r", "RootWebArea", "", [
        node("a", "button", "Click me"),
        node("b", "heading", "Hello"),
      ]),
    };
    expect(detectOpenedModal(snap)).toBeNull();
  });

  it("detects a dialog role node and returns title + buttons", () => {
    const snap = {
      root: node("r", "RootWebArea", "", [
        node("d1", "dialog", "Add a note to your invitation?", [
          node("h1", "heading", "Add a note to your invitation?"),
          node("b1", "button", "Send without a note"),
          node("b2", "button", "Add a note"),
          node("b3", "button", "Cancel"),
        ]),
      ]),
    };
    const m = detectOpenedModal(snap);
    expect(m).not.toBeNull();
    expect(m!.stable_id).toBe("d1");
    expect(m!.role).toBe("dialog");
    expect(m!.title).toBe("Add a note to your invitation?");
    expect(m!.buttons).toEqual([
      { stable_id: "b1", name: "Send without a note" },
      { stable_id: "b2", name: "Add a note" },
      { stable_id: "b3", name: "Cancel" },
    ]);
  });

  it("detects alertdialog same as dialog", () => {
    const snap = {
      root: node("r", "RootWebArea", "", [
        node("d", "alertdialog", "Delete this repo?", [
          node("b", "button", "Delete"),
          node("b2", "button", "Cancel"),
        ]),
      ]),
    };
    const m = detectOpenedModal(snap);
    expect(m).not.toBeNull();
    expect(m!.role).toBe("alertdialog");
    expect(m!.buttons.map(b => b.name)).toEqual(["Delete", "Cancel"]);
  });

  it("detects menu role too (dropdown menus often need explicit click)", () => {
    const snap = {
      root: node("r", "RootWebArea", "", [
        node("m", "menu", "User menu", [
          node("b1", "button", "Profile"),
          node("b2", "button", "Sign out"),
        ]),
      ]),
    };
    expect(detectOpenedModal(snap)?.role).toBe("menu");
  });

  it("falls back to heading child for title if dialog itself has no name", () => {
    const snap = {
      root: node("r", "RootWebArea", "", [
        node("d", "dialog", "", [
          node("h", "heading", "Confirm payment"),
          node("b", "button", "Pay"),
        ]),
      ]),
    };
    expect(detectOpenedModal(snap)?.title).toBe("Confirm payment");
  });

  it("title is null when dialog has neither name nor heading", () => {
    const snap = {
      root: node("r", "RootWebArea", "", [
        node("d", "dialog", "", [
          node("p", "text", "Are you sure?"),
          node("b", "button", "Yes"),
        ]),
      ]),
    };
    expect(detectOpenedModal(snap)?.title).toBeNull();
  });

  it("collects buttons from nested children (deep walk)", () => {
    const snap = {
      root: node("r", "RootWebArea", "", [
        node("d", "dialog", "Wrapper", [
          node("h", "heading", "Title"),
          node("section", "group", "", [
            node("section2", "group", "", [
              node("b", "button", "Deep button"),
            ]),
          ]),
        ]),
      ]),
    };
    expect(detectOpenedModal(snap)?.buttons).toEqual([
      { stable_id: "b", name: "Deep button" },
    ]);
  });

  it("returns the first modal in tree-walk order when multiple dialogs are open", () => {
    const snap = {
      root: node("r", "RootWebArea", "", [
        node("d1", "dialog", "First modal", [node("b1", "button", "A")]),
        node("d2", "dialog", "Second modal", [node("b2", "button", "B")]),
      ]),
    };
    expect(detectOpenedModal(snap)?.title).toBe("First modal");
  });

  it("ignores buttons OUTSIDE the modal (only collects modal's own children)", () => {
    const snap = {
      root: node("r", "RootWebArea", "", [
        node("outside", "button", "Outside button"),
        node("d", "dialog", "Modal", [
          node("inside", "button", "Inside button"),
        ]),
      ]),
    };
    const m = detectOpenedModal(snap);
    expect(m?.buttons).toEqual([{ stable_id: "inside", name: "Inside button" }]);
  });

  it("link role also counted as a button (LinkedIn uses anchor-styled buttons)", () => {
    const snap = {
      root: node("r", "RootWebArea", "", [
        node("d", "dialog", "Modal", [
          node("a", "link", "Confirm via link"),
          node("b", "button", "Real button"),
        ]),
      ]),
    };
    const m = detectOpenedModal(snap);
    expect(m?.buttons.length).toBe(2);
  });

  it("handles undefined snapshot.root gracefully", () => {
    expect(detectOpenedModal({})).toBeNull();
  });
});
