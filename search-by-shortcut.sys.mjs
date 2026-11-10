// about:keyboard runs in a content process, where Sine can't inject scripts,
// so this background module registers an actor that runs inside the page.
try {
  ChromeUtils.registerWindowActor("SearchByShortcut", {
    child: {
      esModuleURI: "chrome://sine/content/zen-search-by-shortcut/SearchByShortcutChild.sys.mjs",
      events: { DOMContentLoaded: {} },
    },
    matches: ["about:keyboard*"],
  });
} catch (e) {
  if (e.name !== "NotSupportedError") throw e;
}
