# Theme Rename Exceptions — token-burn (TB)

Scope: `refactor: rename CSS tokens to semantic roles (theme-arch step 1)`

## Theme inheritance architecture gap

TB has its own `--tb-*` design token system with a dark default and `[data-theme="light"]` override. The light-mode block now references `--color-*` semantic tokens (e.g. `--tb-bg: var(--color-bg-page)`), which is correct for the rename goal.

**Gap**: TB's `[data-theme="light"]` is set independently of the site's `[data-theme]` system. There is no automatic propagation from brettcoryell.com's theme toggle to TB's light mode. This architectural alignment is deferred.

## Missing primitives

The primitive block in `src/index.css` omits `--primitive-cloud` (used in site/ai-resume as `#f5f7fa`) since TB does not use that shade. Add if needed.

## Notes

`src/index.css` updated: `--primitive-*` block replaces old `--site-*` block; `[data-theme="light"]` block updated from `var(--site-*)` to `var(--color-*)`. `src/styles/themes/default.css` created with the site semantic layer.
