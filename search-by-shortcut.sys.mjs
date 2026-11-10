// about:keyboard runs in a content process, where Sine can't inject scripts,
// so this background module registers an actor that runs inside the page.
// The parent half reads and edits extension shortcuts, which only exist there.
const base = "chrome://sine/content/zen-search-by-shortcut";
try {
  ChromeUtils.registerWindowActor("SearchByShortcut", {
    parent: { esModuleURI: `${base}/SearchByShortcutParent.sys.mjs` },
    child: {
      esModuleURI: `${base}/SearchByShortcutChild.sys.mjs`,
      events: { DOMContentLoaded: {} },
    },
    matches: ["about:keyboard*"],
  });
} catch (e) {
  if (e.name !== "NotSupportedError") throw e;
}
