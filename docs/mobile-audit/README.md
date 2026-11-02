# Mobile layout audit status

The required Playwright matrix has **not** run. This environment has no project Playwright package/browser, npm registry DNS resolution failed, and local browser control is disabled. No `before.json`, `after.json`, or screenshots are fabricated.

Source checks completed on 2 November 2026:

- `index.html` includes `width=device-width, initial-scale=1, viewport-fit=cover`.
- `.app-shell` no longer has a desktop `min-width: 1024px` rule.
- The phone layout uses a bottom tab bar, full-height filter sheet, card results, internal page/table scrolling, and safe-area padding.

Run the full route and overlay matrix at 320×640, 360×740, 390×844, 412×915, and 768×1024 when Playwright and its browser are available. Record all offenders to `before.json`, then save screenshots and an empty offender list to `after.json` only after the assertions pass.
