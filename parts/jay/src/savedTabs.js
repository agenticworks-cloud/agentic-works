'use strict';
// The ticket and page tabs open in this workspace, kept in workspaceState, so that tabs jay's host closed can be opened
// again: Roost closes them when it switches jay off, and closes those VS Code restores while jay is off. After a reload
// VS Code brings a tab back itself, through the serializer, but only as each is shown; `paneled` says VS Code still has
// the tab. One closed by a switch-off has none, and is opened again as soon as jay starts; the others are opened after
// a short wait, unless VS Code shows a tab for them by then.

const RESTORE_GRACE_MS = 4000;

/**
 * @param o.state      a Memento (context.workspaceState); without one nothing is kept
 * @param o.key        its key
 * @param o.viewType   the tabs' webview type, to recognise a restored tab that has no page yet
 * @param o.tabGroups  vscode.window.tabGroups, if there is one
 * @param o.graceMs    the wait for VS Code to restore its tabs
 */
function createSavedTabs(o) {
  const state = o.state;
  let entries = (state && Array.isArray(state.get(o.key)) && state.get(o.key)) || [];   // [{ id, data, title, paneled }]
  let closing = false, timer = null;
  const save = () => { if (state) state.update(o.key, entries.length ? entries : undefined); };
  const find = (id) => entries.find((e) => e.id === id);

  /** Tabs of this type in the editor groups that have no page yet: the ones VS Code will restore when shown. */
  function waitingTitles(openTitles) {
    const all = [];
    for (const g of (o.tabGroups && o.tabGroups.all) || []) {
      for (const t of g.tabs || []) if (t.input && typeof t.input.viewType === 'string' && t.input.viewType.endsWith(o.viewType)) all.push(t.label);
    }
    const open = openTitles.slice();
    return all.filter((label) => { const i = open.indexOf(label); if (i < 0) return true; open.splice(i, 1); return false; });
  }

  return {
    entries: () => entries.map((e) => Object.assign({}, e)),
    /** A tab has a page: kept, with what reopens it and the title it shows. */
    opened(id, data, title) {
      const e = find(id);
      if (e) Object.assign(e, { data, title, paneled: true }); else entries.push({ id, data, title, paneled: true });
      save();
    },
    retitled(id, title) { const e = find(id); if (e && e.title !== title) { e.title = title; save(); } },
    /** The user closed the tab (not the window, nor a switch-off): it is forgotten. */
    closed(id) {
      if (closing || !find(id)) return;
      entries = entries.filter((e) => e.id !== id);
      save();
    },
    /** Switched off with the window open: every tab closes (closeTabs), and is kept as having no tab to come back. */
    switchOff(closeTabs) {
      clearTimeout(timer);
      for (const e of entries) e.paneled = false;
      save();
      closing = true;
      closeTabs();
    },
    /** The window is closing: the tabs go with it, and are kept. */
    windowClosing() { clearTimeout(timer); closing = true; },
    /**
     * Called at activate. An entry with no tab to come back is opened at once; the others after the wait, unless their
     * page came back or a tab for them is still waiting to be shown.
     * @param r.isOpen(id), r.open(entry), r.openTitles()   the titles of the tabs that have a page
     */
    restore(r) {
      for (const e of entries.slice()) if (!e.paneled && !r.isOpen(e.id)) r.open(e);
      if (!entries.some((e) => e.paneled && !r.isOpen(e.id))) return;
      timer = setTimeout(() => {
        timer = null;
        if (closing) return;
        const waiting = waitingTitles(r.openTitles());
        for (const e of entries.slice()) {
          if (r.isOpen(e.id)) continue;
          const i = waiting.indexOf(e.title);
          if (i >= 0) waiting.splice(i, 1); else r.open(e);
        }
      }, o.graceMs > 0 ? o.graceMs : RESTORE_GRACE_MS);
      if (timer.unref) timer.unref();
    },
  };
}

module.exports = { createSavedTabs, RESTORE_GRACE_MS };
