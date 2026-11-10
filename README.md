# Search by Shortcut

A [Sine](https://github.com/CosmoCreeper/Sine) mod for Zen. It adds a
**Search by keyboard shortcut** box under the name search on `about:keyboard`. Focus it
and press keys: the list filters as you type. What you press is a minimum: ⌘ shows every shortcut using ⌘, and ⌘X also finds ⇧⌘X. Esc or
Backspace clears it.

Needs **Allow external JS** (`sine.allow-unsafe-js`) in Sine's settings, since
the mod isn't in the Sine store.

It also adds an **Extensions** section listing every extension shortcut (the
ones from about:addons → Manage Extension Shortcuts). Both searches find them,
and Edit, Clear and Reset work as they do in about:addons, with the same checks.
