export class SearchByShortcutChild extends JSWindowActorChild {
  handleEvent() {
    if (this.document.getElementById("search")) return this.mount();
    const observer = new this.contentWindow.MutationObserver(() => {
      if (!this.document.getElementById("search")) return;
      observer.disconnect();
      this.mount();
    });
    observer.observe(this.document, { childList: true, subtree: true });
  }

  mount() {
    const doc = this.document;
    const page = this.contentWindow.wrappedJSObject;
    const input = doc.createElement("moz-input-search");
    input.id = "shortcutSearch";
    input.setAttribute("placeholder", "Search by keyboard shortcut");
    input.setAttribute("aria-label", "Search by keyboard shortcut, press a key combination");
    input.setAttribute("inputlayout", "block");
    doc.getElementById("search").after(input);
    input.wrappedJSObject.updateComplete.then(() =>
      input.shadowRoot
        .getElementById("input")
        .style.setProperty("--input-background-icon", "url(chrome://zen-search-by-shortcut/content/keyboard.svg)")
    );

    // Same parent-side capture the Edit button uses, so reserved keys like
    // Cmd+W are reported instead of acting on the browser.
    const capture = on => page.RPMSendAsyncMessage("CustomKeys:CaptureKey", on);
    input.addEventListener("focusin", () => capture(true));
    input.addEventListener("focusout", () => capture(false));

    const show = text => (input.wrappedJSObject.value = text);
    page.RPMAddMessageListener(
      "CustomKeys:CapturedKey",
      Cu.exportFunction(({ data }) => {
        if (!input.matches(":focus-within")) return;
        if (data.isModifier) return show(data.modifierString);
        if (data.keycode === "VK_BACK_SPACE") {
          show("");
          return this.filter("");
        }
        if (data.isValid) {
          show(data.shortcut);
          this.filter(data.shortcut);
        }
      }, this.contentWindow)
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
      const match = !shortcut || row.querySelector(".currentShortcut").wrappedJSObject.value === shortcut;
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
}
