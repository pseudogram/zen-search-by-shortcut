const { AppConstants } = ChromeUtils.importESModule(
  "resource://gre/modules/AppConstants.sys.mjs",
);
const { ShortcutUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/ShortcutUtils.sys.mjs",
);
const { ExtensionShortcutKeyMap } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionShortcuts.sys.mjs",
);
const { ExtensionSettingsStore } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionSettingsStore.sys.mjs",
);

// Key capture and validation are ported from about:addons' shortcut editor
// (toolkit/mozapps/extensions/components/addon-shortcuts.mjs), whose helpers
// aren't exported.
const functionKeys = Array.from({ length: 19 }, (_, i) => `F${i + 1}`);
const validKeys = new Set([
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Insert",
  "Delete",
  ..."0123456789",
  ...functionKeys,
  "MediaNextTrack",
  "MediaPlayPause",
  "MediaPrevTrack",
  "MediaStop",
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  "Up",
  "Down",
  "Left",
  "Right",
  "Comma",
  "Period",
  "Space",
]);
const remapKeys = { ",": "Comma", ".": "Period", " ": "Space" };
const trimPrefix = (s) => s.replace(/^(?:Digit|Numpad|Arrow)/, "");
const keyOptions = [
  (e) => String.fromCharCode(e.which),
  (e) => e.code.toUpperCase(),
  (e) => trimPrefix(e.code),
  (e) => trimPrefix(e.key),
  (e) => remapKeys[e.key] ?? e.key,
];
const keyForEvent = (e) =>
  keyOptions.map((f) => f(e)).find((k) => validKeys.has(k)) ?? "";

function shortcutForEvent(e) {
  const modifiers =
    AppConstants.platform == "macosx"
      ? {
          MacCtrl: e.ctrlKey,
          Alt: e.altKey,
          Command: e.metaKey,
          Shift: e.shiftKey,
        }
      : { Ctrl: e.ctrlKey, Alt: e.altKey, Shift: e.shiftKey };
  return Object.keys(modifiers)
    .filter((m) => modifiers[m])
    .concat(keyForEvent(e))
    .join("+");
}

const errors = {
  [ShortcutUtils.MODIFIER_REQUIRED]:
    AppConstants.platform == "macosx"
      ? "Include Ctrl, Alt, or ⌘"
      : "Include Ctrl or Alt",
  [ShortcutUtils.INVALID_COMBINATION]: "Invalid combination",
  [ShortcutUtils.INVALID_KEY]: "Type a letter",
};
const systemError = "Can’t override a browser shortcut";

const builtInNames = {
  _execute_action: "Activate toolbar button",
  _execute_browser_action: "Activate toolbar button",
  _execute_page_action: "Activate page action",
  _execute_sidebar_action: "Toggle the sidebar",
};

export class SearchByShortcutParent extends JSWindowActorParent {
  get #window() {
    return this.browsingContext.topChromeWindow;
  }

  #shortcuts(extId) {
    return WebExtensionPolicy.getByID(extId)?.extension?.shortcuts;
  }

  // The row data about:keyboard needs; the shortcut is prettified the same way
  // CustomKeys does it, so search by shortcut matches extension rows too.
  #row(policy, command) {
    const { shortcuts } = policy.extension;
    return {
      extId: policy.id,
      name: command.name,
      label: `${policy.name}: ${command.description || builtInNames[command.name] || command.name}`,
      shortcut: command.shortcut
        ? ShortcutUtils.prettifyShortcut(
            shortcuts.buildKeyFromShortcut(
              this.#window.document,
              command.name,
              command.shortcut,
            ),
          )
        : "",
      isCustomized: !!ExtensionSettingsStore.getSetting(
        "commands",
        command.name,
        policy.id,
      )?.value,
    };
  }

  async #rowFor(extId, name) {
    await ExtensionSettingsStore.initialize();
    const policy = WebExtensionPolicy.getByID(extId);
    const command = (await policy.extension.shortcuts.allCommands()).find(
      (c) => c.name === name,
    );
    return this.#row(policy, command);
  }

  async #list() {
    await ExtensionSettingsStore.initialize();
    const rows = [];
    for (const policy of WebExtensionPolicy.getActiveExtensions()) {
      if (!policy.extension?.shortcuts) continue;
      for (const command of await policy.extension.shortcuts.allCommands()) {
        rows.push(this.#row(policy, command));
      }
    }
    return rows.sort((a, b) => a.label.localeCompare(b.label));
  }

  async #update({ extId, name, shortcut }) {
    const shortcuts = this.#shortcuts(extId);
    if (!shortcuts) return { error: "Extension isn’t running" };
    if (shortcut) {
      const policy = WebExtensionPolicy.getByID(extId);
      const current = (await shortcuts.allCommands()).find(
        (c) => c.name === name,
      )?.shortcut;
      const inUse = new ExtensionShortcutKeyMap();
      await inUse.buildForAddonIds(
        WebExtensionPolicy.getActiveExtensions().map((p) => p.id),
      );
      inUse.removeShortcut(current, policy.name, name);
      if (inUse.has(shortcut)) {
        return {
          error: `Already in use by ${inUse.getFirstAddonName(shortcut)}`,
        };
      }
    }
    await shortcuts.updateCommand({ name, shortcut });
    return this.#rowFor(extId, name);
  }

  async #reset({ extId, name }) {
    const shortcuts = this.#shortcuts(extId);
    if (!shortcuts) return { error: "Extension isn’t running" };
    await shortcuts.resetCommand(name);
    return this.#rowFor(extId, name);
  }

  #capture(on) {
    const browser = this.browsingContext.embedderElement;
    if (on) browser.addEventListener("keydown", this);
    else browser.removeEventListener("keydown", this);
  }

  didDestroy() {
    this.browsingContext.embedderElement?.removeEventListener("keydown", this);
  }

  receiveMessage({ name, data }) {
    switch (name) {
      case "SBS:List":
        return this.#list();
      case "SBS:Update":
        return this.#update(data);
      case "SBS:Reset":
        return this.#reset(data);
      case "SBS:Capture":
        return this.#capture(data);
    }
    return null;
  }

  handleEvent(e) {
    if (e.type != "keydown") return;
    e.preventDefault();
    e.stopPropagation();
    const send = (data) => this.sendAsyncMessage("SBS:Captured", data);
    const noModifiers = !e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey;
    if (noModifiers && e.key == "Escape") return send({ cancel: true });
    if (noModifiers && (e.key == "Delete" || e.key == "Backspace"))
      return send({ shortcut: "" });
    if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) {
      const modifiers = shortcutForEvent(e).split("+").filter(Boolean);
      return send({
        partial: ShortcutUtils.getModifierString(
          ShortcutUtils.getModifiersAttribute(modifiers),
        ),
      });
    }
    if (ShortcutUtils.getSystemActionForEvent(e))
      return send({ error: systemError });
    const shortcut = shortcutForEvent(e);
    const validation = ShortcutUtils.validate(shortcut);
    if (validation != ShortcutUtils.IS_VALID)
      return send({ error: errors[validation] ?? "Invalid combination" });
    if (ShortcutUtils.isSystem(this.#window, shortcut))
      return send({ error: systemError });
    send({ shortcut });
  }
}
