const PACKAGE = "chrome://zen-search-by-shortcut/content";

export class SearchByShortcutChild extends JSWindowActorChild {
  #editing = null;

  handleEvent() {
    // buildTable() announces it's done with CustomKeysUpdate; extension rows go
    // in after the page's own categories.
    this.contentWindow.addEventListener(
      "CustomKeysUpdate",
      () => this.addExtensions(),
      { once: true },
    );
    if (this.document.getElementById("search")) return this.mountSearch();
    const observer = new this.contentWindow.MutationObserver(() => {
      if (!this.document.getElementById("search")) return;
      observer.disconnect();
      this.mountSearch();
    });
    observer.observe(this.document, { childList: true, subtree: true });
  }

  get #page() {
    return this.contentWindow.wrappedJSObject;
  }

  mountSearch() {
    const doc = this.document;
    const link = doc.createElement("link");
    link.rel = "stylesheet";
    link.href = `${PACKAGE}/about-keyboard.css`;
    doc.head.append(link);

    const input = doc.createElement("moz-input-search");
    input.id = "shortcutSearch";
    input.setAttribute("placeholder", "Search by keyboard shortcut");
    input.setAttribute(
      "aria-label",
      "Search by keyboard shortcut, press a key combination",
    );
    input.setAttribute("inputlayout", "block");
    input.setAttribute("description", "↩ to search · Esc to clear");
    doc.getElementById("search").after(input);
    input.wrappedJSObject.updateComplete.then(() =>
      input.shadowRoot
        .getElementById("input")
        .style.setProperty(
          "--input-background-icon",
          `url(${PACKAGE}/keyboard.svg)`,
        ),
    );

    // Same parent-side capture the Edit button uses, so reserved keys like
    // Cmd+W are reported instead of acting on the browser.
    const capture = (on) =>
      this.#page.RPMSendAsyncMessage("CustomKeys:CaptureKey", on);
    input.addEventListener("focusin", () => capture(true));
    input.addEventListener("focusout", () => capture(false));

    // Type a combo, Enter searches for it; Esc or Backspace clears. Bare Esc
    // is given up as a searchable shortcut so it can clear.
    let pending = "";
    const show = (text) => (input.wrappedJSObject.value = text);
    const bare = (data) => !data.modifiers;
    this.#page.RPMAddMessageListener(
      "CustomKeys:CapturedKey",
      Cu.exportFunction(({ data }) => {
        if (!input.matches(":focus-within")) return;
        if (data.isModifier) return show(data.modifierString);
        if (
          data.keycode === "VK_BACK_SPACE" ||
          (data.keycode === "VK_ESCAPE" && bare(data))
        ) {
          pending = "";
          show("");
          return this.filter("");
        }
        if (data.keycode === "VK_RETURN" && bare(data)) {
          return this.filter(pending);
        }
        if (data.isValid) {
          pending = data.shortcut;
          show(pending);
        }
      }, this.contentWindow),
    );
  }

  // Mirrors about:keyboard's own onSearchInput, matching the shortcut instead of the label.
  filter(shortcut) {
    const doc = this.document;
    const byName = doc.getElementById("search");
    if (shortcut && byName.wrappedJSObject.value) {
      byName.wrappedJSObject.value = "";
      byName.dispatchEvent(new this.contentWindow.Event("input"));
    }
    for (const row of doc.querySelectorAll("#table .key")) {
      const match =
        !shortcut ||
        row.querySelector(".currentShortcut").wrappedJSObject.value ===
          shortcut;
      row.hidden = !match;
      row.classList.toggle("hidden", !match);
    }
    let i = 0;
    for (const card of doc.querySelectorAll("#table .category")) {
      const has = !!card.querySelector(".key:not([hidden])");
      card.hidden = !has;
      card.classList.toggle("hidden", !has);
      card.wrappedJSObject.expanded = shortcut ? has : i === 0;
      i++;
    }
  }

  async addExtensions() {
    const rows = await this.sendQuery("SBS:List");
    if (!rows.length) return;
    const doc = this.document;
    const card = doc.createElement("moz-card");
    card.className = "category";
    Object.assign(card.wrappedJSObject, {
      type: "accordion",
      heading: "Extensions",
      headingLevel: 2,
    });
    const group = doc.createElement("moz-box-group");
    card.append(group);
    for (const data of rows) group.append(this.buildRow(data));
    doc.getElementById("table").append(card);
  }

  // Same markup as buildTable() in about:keyboard. The "internal" class makes
  // the page refuse to steal an extension's key ("Key cannot be used") instead
  // of clearing it through CustomKeys, which doesn't know these rows.
  // about-keyboard.css brings back the buttons "internal" hides.
  buildRow(data) {
    const doc = this.document;
    const el = (tag, className) => {
      const e = doc.createElement(tag);
      if (className) e.className = className;
      return e;
    };
    const button = (className, l10nId, icon) => {
      const b = el("moz-button", className);
      b.setAttribute("data-l10n-id", l10nId);
      b.setAttribute("type", "icon ghost");
      b.setAttribute("iconsrc", `chrome://global/skin/icons/${icon}`);
      return b;
    };

    const row = el("moz-box-item", "key internal ext-key");
    row.setAttribute("role", "group");
    row.dataset.id = `ext:${data.extId}:${data.name}`;
    row.dataset.extId = data.extId;
    row.dataset.command = data.name;
    row.dataset.label = data.label;

    const content = el("div", "key-content");
    const labelContainer = el("div", "key-label-container");
    const label = el("span", "key-label");
    label.textContent = data.label;
    labelContainer.append(label);

    const actions = el("div", "key-actions");
    const current = el("moz-input-text", "currentShortcut");
    current.setAttribute("readonly", "");
    current.setAttribute("aria-label", `Shortcut for ${data.label}`);
    const newKey = el("moz-input-text", "newKey ext-new-key");
    newKey.setAttribute("data-l10n-id", "customkeys-key-new");
    newKey.setAttribute("inputlayout", "inline-end");
    actions.append(
      current,
      button("change", "customkeys-key-edit", "edit-outline.svg"),
      newKey,
      button("clear", "customkeys-key-clear", "close.svg"),
      button("reset", "customkeys-key-reset", "arrow-counterclockwise-16.svg"),
    );
    content.append(labelContainer, actions);
    row.append(content);

    // Handle the buttons here so the page's own handler on #table never sees
    // them; it would send these ids to CustomKeys.
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      const action = e.target.classList;
      if (action.contains("change")) this.startEditing(row);
      else if (action.contains("clear")) this.save(row, "SBS:Update", "");
      else if (action.contains("reset")) this.save(row, "SBS:Reset");
    });
    newKey.addEventListener("focusout", () => this.stopEditing());

    this.updateRow(row, data);
    return row;
  }

  updateRow(row, data) {
    const current = row.querySelector(".currentShortcut");
    current.wrappedJSObject.value = data.shortcut;
    if (data.shortcut) current.removeAttribute("data-l10n-id");
    else current.setAttribute("data-l10n-id", "customkeys-shortcut-unassigned");
    row.classList.toggle("customized", data.isCustomized);
    row.classList.toggle("assigned", !!data.shortcut);
  }

  startEditing(row) {
    this.#editing = row;
    row.classList.add("editing");
    this.sendAsyncMessage("SBS:Capture", true);
    const newKey = row.querySelector(".newKey");
    newKey.wrappedJSObject.value = "";
    newKey.focus();
  }

  stopEditing() {
    const row = this.#editing;
    if (!row) return;
    this.#editing = null;
    this.sendAsyncMessage("SBS:Capture", false);
    row.classList.remove("editing");
    row.querySelector(".newKey").wrappedJSObject.value = "";
  }

  async save(row, message, shortcut) {
    const result = await this.sendQuery(message, {
      extId: row.dataset.extId,
      name: row.dataset.command,
      shortcut,
    });
    if (result.error) return this.showError(row, result.error);
    this.updateRow(row, result);
    if (this.#editing === row) {
      this.stopEditing();
      row.querySelector(".change").focus();
    }
  }

  showError(row, message) {
    if (this.#editing !== row) this.startEditing(row);
    row.querySelector(".newKey").wrappedJSObject.value = message;
  }

  receiveMessage({ name, data }) {
    const row = this.#editing;
    if (name !== "SBS:Captured" || !row) return;
    const newKey = row.querySelector(".newKey").wrappedJSObject;
    if (data.cancel) return row.querySelector(".change").focus();
    if (data.partial !== undefined) return (newKey.value = data.partial);
    if (data.error) return (newKey.value = data.error);
    this.save(row, "SBS:Update", data.shortcut);
  }
}
