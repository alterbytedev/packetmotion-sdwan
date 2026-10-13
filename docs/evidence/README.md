# Verification evidence

Browser baselines are captured by `npm run test:baseline` from sdwan-controller using an isolated temporary PostgreSQL database, generated test credentials, desktop 1440x1000 and mobile 390x844 viewports. Runtime traces stay in ignored test-results/. Screenshots contain test identity only, never credentials.

Reviewed M0 originals live under browser/baseline/. Subsequent captures live under browser/. Compare preserved login and dashboard shell; intentional inventory content changes are assessed separately. Screenshot capture alone is not a pixel comparison or release approval.

Network evidence is not available at M0/M1. Rama will supply the local VM lab later.

M1 actual inventory screenshots: browser/inventory-desktop.png and browser/inventory-mobile.png. The current requested inventory uses a horizontally scrollable table on mobile, with server pagination/search and no page-level overflow. `npm run test:visual` compares four protected login/header regions pixel-for-pixel using pinned pngjs; comparison metadata is in browser/protected-region-comparison.json. It excludes the development overlay and intentional inventory changes and requires the same local OS/browser/fonts. No network or cross-platform rendering outcome is inferred.

Device-flow refinement: the operator adds Edge/Hub directly. The overview introduction was intentionally reworded for terminology consistency, so the protected visual check compares navigation header chrome (72px), not editable page introduction copy. Original M0 images remain intact.

Devices consolidation evidence: browser/device-detail-desktop.png and device-detail-mobile.png show scoped configuration and telemetry within the existing dashboard. Browser tests cover 31 devices across multiple pages, server search, page-size changes, stale-response cancellation, API failure/retry, admin publishing and viewer API denial. These are functional checks, not a production-scale benchmark. Dashboard browser coverage now uses folder routes for inventory and scoped device details.

UI consistency audit: `browser/device-form-{desktop,mobile}.png`, `browser/navigation-open-{desktop,mobile}.png` and `browser/ui-consistency-{desktop,mobile}.png` capture existing styling with normalized forms, keyboard navigation and success feedback. The desktop navigation test deliberately resizes to mobile before capture. New evidence contains no enrollment token. Desktop/mobile form, navigation, inventory and device-detail renders were reviewed; the four protected regions have zero changed pixels. Content review is not a full pixel comparison. Local Chromium keyboard/ARIA checks and stubbed clipboard outcomes do not prove screen-reader speech, OS clipboard permissions or cross-browser rendering. See [component architecture](../development/ui-component-architecture.md) and the change log for exact results.
