# Controller UI component architecture

## Audit and approved scope — 2026-10-12

Next.js 16.4.0 App Router, React 19.3.0, TypeScript, Tailwind CSS 4.2.1, Lucide and shadcn-style primitives are the existing baseline. No new library or directory migration is needed. Generic components belong in `sdwan-controller/src/components/ui/`; application-specific components and labels belong in `components/fabric/`. `cn` combines classes using clsx and tailwind-merge. Preserve globals.css and its green/neutral tokens.

| Area | Finding and decision |
| --- | --- |
| Buttons | Existing Button is authoritative. Consolidate the password toggle using explicit unstyled and compact icon variants that preserve its existing appearance. Keep the specialized full-screen navigation backdrop. |
| Forms/selects | Keep native Select, labels and browser validation. Normalize device-name field structure. Input/Select heights of 44px and Button heights of 40/32/48px are deliberate contexts, not global inconsistencies. |
| Feedback | Consolidate repeated inline and bordered error/success presentations with live-region semantics. Keep their existing colors and spacing. Announce loading and clipboard results. |
| Status | Centralize controller connection labels within the fabric feature; retain plain text or Badge according to context. |
| Mobile navigation | Prevent hidden links receiving focus, contain focus while open, close with Escape and restore trigger focus; keep desktop navigation and shell appearance. |
| Tables/cards | Keep the inventory table and overview grid distinct. Add table header semantics. Existing Card composition remains authoritative. |
| Clipboard | Catch failed writes and announce feedback without logging tokens. |
| Other UI | No dialogs, custom dropdown menus, tabs, tooltips, popovers, skeletons or toast library exist; do not add unused abstractions. |

## Existing primitives

- Button: native button props and ref, `asChild` for links, variants default/outline/secondary/ghost, sizes default/sm/lg/icon. Preserve submit behavior; explicitly set type="button" for non-submit form controls.
- Input: native input props and ref, 44px height, focus ring, disabled state; use an associated label or accessible name.
- Select: native select props and ref, `containerClassName` for wrapper sizing; children are native options. The decorative chevron is hidden from assistive technology. Pagination retains its compact height.
- Card: compose CardHeader, CardTitle, CardDescription and CardContent; use existing contextual spacing.
- Badge: span props, existing pill geometry; contextual classes preserve current presentations.

## New reusable behavior

Feedback renders a paragraph and owns announcement semantics and repeated styles. Props: native paragraph attributes except role; `tone` error/success/loading (default loading), `presentation` inline/panel (default inline), children and className. Error uses role="alert"; success/loading use role="status". Class overrides preserve contextual margins or muted server-error presentation. Examples: `<Feedback tone="error">{error}</Feedback>` and `<Feedback tone="success" presentation="panel" className="mb-5">{notice}</Feedback>`. Use only for short feedback, not arbitrary layout.

Button adds `variant="unstyled"` for embedded controls and `size="icon-sm"` for an 18px icon footprint. These preserve the password toggle's existing geometry; use standard variants for ordinary actions.

`connectionStatusLabels` is a typed fabric-local mapping for all four NodeRecord connection states. Consumers choose Badge or plain text; it does not change status calculation or controller/network meaning.

## Validation and rollback

Risk is shared rendering and keyboard behavior. Use existing Node tests, Biome, TypeScript, isolated PostgreSQL integration tests and desktop/mobile Playwright. Test real keyboard focus and clipboard rejection. Compare protected screenshot regions and inspect content screenshots; the existing comparison excludes dashboard content. No network test is necessary for these presentation changes. Record actual results in the change log; unavailable checks are UNVERIFIED.

Rollback only this task's edits; preserve pre-existing working-tree changes and append-only logs. A pre-edit snapshot is retained locally under `/tmp/packetmotion-ui-audit/before` for this session. No data/schema rollback is required.

## Verified results — 2026-10-12

- Lint PASS (51 files), TypeScript PASS, Node suite PASS (21), isolated PostgreSQL integration PASS (9), desktop/mobile Playwright PASS (16), production build PASS and git diff --check PASS.
- Six added browser cases cover password keyboard/pressed state, closed navigation inertness, modal focus wrapping, Escape/focus restoration, navigation selection, responsive breakpoint transitions, native Select keyboard changes, labeled device creation, clipboard denial/recovery, announcements and page-width overflow.
- Existing browser coverage retains viewer/anonymous rejection, pagination, search, stale-response cancellation, errors/retry and scoped configuration persistence. One stale expectation was updated to assert the existing Configurations-to-Devices redirect.
- Actual protected pixel comparisons PASS with zero changed pixels in all four existing login/header regions. Rendered form/navigation/inventory/detail screenshots were inspected. Content has visual review, not a complete pixel regression comparison.
- Clipboard outcomes use controlled browser stubs; real OS clipboard permissions, screen-reader speech and browsers other than local Chromium are UNVERIFIED. Native option-popup appearance remains OS/browser controlled.

## Dashboard route structure — 2026-10-12

Dashboard screens use App Router paths: `/dashboard` (overview), `/dashboard/devices` (inventory), `/dashboard/devices/[id]` (device detail), `/dashboard/telemetry` and `/dashboard/settings`. Each route has a `page.tsx` under its matching folder and calls `dashboardPageData` to reuse authentication and inventory loading. `ControllerDashboard` remains the shared visual shell and renders content from an explicit view prop. Internal links and browser tests use these paths. Legacy `?view=` URLs are not redirected or retained; query parameters no longer select dashboard views.

## Extracted dashboard sections — 2026-10-12

`ControllerHealthCard` in `components/fabric/controller-health-card.tsx` owns the existing application liveness card. `ControllerSettings` in `components/fabric/controller-settings.tsx` owns the existing operator account/configuration cards and logout form; it accepts `email` and `roleLabel`. Keep their current visual classes and compose them from shared UI primitives. Do not use the health card as a database or device health signal.

## Diagnostic report copy action — 2026-10-12

`app/diagnosticlogs/copy-log-button.tsx` is feature-specific client behavior, not a generic clipboard primitive. It accepts `referenceId` for its accessible button name and a preformatted `report` string from the server page. It composes the existing outline `Button` and `Feedback` components, announces copy success/failure, and copies the incident context as plain text. Use it once for each diagnostic record; do not pass unredacted secrets or introduce external telemetry.
