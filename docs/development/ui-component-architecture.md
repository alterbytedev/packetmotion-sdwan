# Controller UI component architecture

## Interface draft editor — 2026-10-22

`components/fabric/underlay-interfaces.tsx` connects each reported interface row to the existing Modal and `network-draft-editor.tsx`. The editor receives the existing `NodeRecord`/`OperatorRole`, selected reported interface and physical/VLAN mode; the selected parent is read-only, unrelated candidates are preserved, and viewers read only. It composes existing Input/Select/Button/Feedback primitives and native fieldsets, preserving shell/theme and responsive columns. One mounted editor owns its draft state, loads on demand, uses cancellable reads and explicit save/reload, and shows stale baselines, current CIDRs, capability-gated apply and immutable commit history with typed Edit and retry. Active commit polling is bounded and never replaces unsaved editor rows. It creates no generic UI primitive or active network state. The existing LAN profile remains authoritative for current publication; drafts are candidates only. See [delivery boundaries](../operations/interface-management.md).

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
| Other UI | A reusable Modal primitive is available for focused workflows; do not add custom dropdown menus, tabs, tooltips, popovers, skeletons or a toast library without a concrete need. |

## Existing primitives

- Button: native button props and ref, `asChild` for links, variants default/outline/secondary/ghost, sizes default/sm/lg/icon. Preserve submit behavior; explicitly set type="button" for non-submit form controls.
- Input: native input props and ref, 44px height, focus ring, disabled state; use an associated label or accessible name.
- Select: native select props and ref, `containerClassName` for wrapper sizing; children are native options. The decorative chevron is hidden from assistive technology. Pagination retains its compact height.
- Card: compose CardHeader, CardTitle, CardDescription and CardContent; use existing contextual spacing.
- Badge: span props, existing pill geometry; contextual classes preserve current presentations.
- Textarea: native textarea props/ref, resizable multi-line field with matching Input focus and disabled styles.
- Checkbox: native checkbox props/ref with the shared primary checked state and focus ring; pair with a visible label.
- Separator: semantic horizontal rule with horizontal or vertical orientation for grouping content.
- FormField: labeled field wrapper with optional hint/error text and generated control ID; pass `htmlFor` when children do not render a single control using that ID.

## New reusable behavior

Feedback renders a paragraph and owns announcement semantics and repeated styles. Props: native paragraph attributes except role; `tone` error/success/loading (default loading), `presentation` inline/panel (default inline), children and className. Error uses role="alert"; success/loading use role="status". Class overrides preserve contextual margins or muted server-error presentation. Examples: `<Feedback tone="error">{error}</Feedback>` and `<Feedback tone="success" presentation="panel" className="mb-5">{notice}</Feedback>`. Use only for short feedback, not arbitrary layout.

Button adds `variant="unstyled"` for embedded controls and `size="icon-sm"` for an 18px icon footprint. These preserve the password toggle's existing geometry; use standard variants for ordinary actions.

`connectionStatusLabels` is a typed fabric-local mapping for all six NodeRecord connection states (`pending`, `enrolling`, `syncing`, `management-connected`, `offline`, `revoked`). Consumers choose Badge or plain text; it does not change status calculation or controller/network meaning.

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

## Device network configuration preview — 2026-10-14

`components/fabric/network-configuration-preview.tsx` is a device-detail-only mockup for intended operating mode, hub preference, WAN/LAN addressing, business traffic classes, basic default-deny firewall rules, DNS/NAT, and management access. It composes the existing Card, Badge, Button, Input, and Select primitives; no shared primitive or UI dependency was added. Admins can edit illustrative local fields and request a local preview; viewer controls are read-only. The `Preview only` status and explanatory copy make clear that values are neither persisted nor sent to a device. Do not present these examples as applied configuration or verified network health. Remove this feature component and its `DeviceDetails` composition to roll it back; no schema or data rollback is needed.

## Reusable modal — 2026-10-14

`components/ui/modal.tsx` exports `Modal` and `ModalFooter`. `Modal` requires controlled `open`, `onOpenChange`, and an accessible `title`; optional `description`, children, `size` (`sm`, `md`, `lg`, `xl`), backdrop/Escape behavior, close button visibility, and className customize each use. It renders an accessible modal dialog, traps Tab focus, focuses the first available control, locks body scrolling, and restores focus on close. Use for short focused workflows and compose existing form and button primitives inside. Keep long multi-step flows on a page. `ModalFooter` aligns actions responsively. The existing mobile navigation dialog remains specialized and unchanged. Roll back by removing this file and its documentation entry; feature consumers include the device network preview workflows documented below.

## Additional common primitives — 2026-10-14

`Textarea` supports native multiline input attributes, `Checkbox` wraps a native checkbox input, `Separator` renders a semantic `<hr>` with horizontal/vertical orientation, and `FormField` provides a label plus optional hint and error copy. These are generic UI building blocks only; consumers own form state, validation, and submission. Use `FormField` with a single labeled control and pass the same `htmlFor` value to the control's `id` when the control does not inherit an ID. No current feature was migrated as part of this addition.

## Device network preview modal workflows — 2026-10-14

`components/fabric/network-configuration-preview.tsx` uses `Modal` for adding illustrative firewall rules, business policies and interfaces, and editing routing or essential settings. The detail view now shows compact summary rows and tables with section-level actions. Admin changes live in component state only and reset on reload; viewers have read-only content. Keep the preview-only warning visible, and do not connect these actions to desired revision publishing or describe them as applied until validated persistence, policy compilation and safe agent apply exist. The browser spec covers modal access and no-persistence behavior; current isolated test runner intermittently failed operator sign-in before reaching this test, so that coverage remains unverified after the latest focus fix.

## White-label branding settings — 2026-10-14

`components/fabric/branding-settings.tsx` is a superadmin-only feature component inside Controller Settings. It uploads/removes a raster logo, shows light/dark contrast previews, and explains the recommended 600 × 180 px size, accepted PNG/JPEG/WebP formats, 2 MiB limit, transparent image support, and contain-without-cropping behavior. `components/brand-logo.tsx` is the small shared display wrapper used on login and dashboard navigation; it keeps a default mark when no logo is configured. Branding writes are authorized server-side and the public read route exposes only this logo asset. No generic UI primitive or dependency was added.

## Saved WireGuard connections — 2026-10-15

`tunnel-settings.tsx` is a superadmin Settings card for the pool and optimistic version. `wireguard-connections.tsx` is a device-scoped card accepting `node` and `role`; Hub forms configure endpoint/base UDP port, Edge checkboxes select up to eight Hubs. Both reuse Card, Input, Button, Checkbox and Feedback. The device card separates saved allocations from timestamped/revision-scoped apply and handshake observations; periodic observation refresh preserves in-progress selections. No new shared primitive is introduced. The illustrative network preview no longer offers a competing fake hub selector; other preview fields remain local-only. See [operations](../operations/wireguard-tunnels.md).

## Saved LAN profiles and protected networks

`LanSettings` accepts `node` and `role`, and owns a device-scoped saved LAN profile form. It reuses Card, Input, Button and Feedback; viewers/revoked devices are read-only. `RoutingSettings` is a superadmin Settings card using Textarea for protected management/underlay CIDRs. Both use optimistic versions and server validation. The illustrative network preview no longer edits LAN interfaces or advertised prefixes; its remaining fields remain local examples. See [routed LAN delivery](../operations/routed-lan.md) for activation limits.

## Device detail tabs and lifecycle actions

`DeviceDetails` keeps device identity, controller status, heartbeat, enrollment, and lifecycle actions above four keyboard-operable tabs: Overview (software/uptime and management troubleshooting), Network (reported host interfaces and the saved LAN profile), SD-WAN (WireGuard drafts/deployment/apply/handshake), and Advanced (agent configuration and a collapsed local network preview). Advanced also groups configuration sources, command history, and agent upgrade in native disclosure sections for superadmins only; existing server/API authorization remains authoritative. Tips explain each category and distinguish receipt, apply, handshake, and routed reachability. The Network tab lists all reported interfaces, potentially loopback/tunnels, and does not infer WAN roles or Internet health from interface Up/Down. WAN addressing remains appliance-managed.

`useAgentTelemetry(node)` in `agent-telemetry.tsx` owns a single cancellable telemetry read and explicit refresh shared by the two `AgentTelemetry` presentations. `AgentTelemetry` accepts `node`, that shared `telemetry` result, and optional `view` (`overview` by default, or `underlay`). Tab switching retains mounted feature state and does not create another telemetry request. Existing Card/Button/Feedback primitives and theme tokens are reused; no shared Tabs/disclosure primitive or dependency is added. Tabs retain ArrowLeft/ArrowRight wrapping, Home/End, selected/tab-panel associations, visible focus, and mobile wrapping.

Admins can rename the current device or archive it from the persistent header; viewers retain read-only access. Archive confirmation states that credentials are revoked and peer plans withdrawn while audit history and WireGuard reservations remain. A disconnected appliance may retain local tunnel state until local cleanup. Migration 0011 adds the archive marker and `node.renamed` / `device.archived` audit actions.

## Device connection check

`DeviceConnectionStatus` is a device-detail feature component taking `nodeId`. It reuses Button/Feedback and the existing date/time-zone conventions inside the Overview card. It fetches authenticated lifecycle observations on mount and manual refresh with cancellation for obsolete device reads; it does not poll or open a log stream. The section shows current enrollment/heartbeat/receipt evidence, bounded lifecycle summaries, and local Debian troubleshooting commands. It does not expose runtime-error records or claim a live appliance probe. Enrollment instructions include the expected device ID and explain reuse of a Debian identity. No generic component, visual-token change or new UI library was added.

## Reusable sizing and inventory tables — 2026-10-20

The existing green/neutral theme and native form controls remain authoritative. Extend shared primitives with props, `children`, `className`, native attributes and refs where exposed. Keep domain labels, data fetching, permissions and state in feature components. No new UI dependency is needed.

### Sizing

| Primitive | Prop | Choices and visual height |
| --- | --- | --- |
| Button | `size` | `xs` 28px, `sm` 32px, `md` 36px, `default` 40px, `lg` 48px |
| Input / Select | `controlSize` | `sm` 32px, `md` 36px, `default` 44px; native HTML `size` retains its original meaning |
| IconButton | `size` | `xs` 28px, `sm` 32px (default), `md` 36px, `default` 40px |
| Badge | `size` | `sm` has compact vertical padding; `default` retains the existing padding |
| Textarea | `density` | `compact` minimum 64px; `default` minimum 96px; native `rows` and resizing remain available |

Choose 32px controls for table toolbars/pagination and 36px for compact settings forms. Preserve roomy login/enrollment controls. Compact interactive targets must remain at least 24px with spacing; mobile workflows may use larger controls. Match neighboring controls explicitly rather than changing defaults globally. The old Button `icon-sm` remains an 18px compatibility option for existing embedded controls; new standalone icon actions should use IconButton with a readable `aria-label`.

Button adds `variant="destructive"` for archive/delete actions and `loading` for native buttons. Loading disables activation, sets `aria-busy`, preserves the child label for assistive technology, and overlays a decorative spinner while retaining the original content footprint. Keep the same children while loading when width stability matters. `loading` is not supported with `asChild`; linked navigation retains its own semantics. IconButton forwards native button props/ref, requires `aria-label`, and defaults to `type="button"` and `variant="ghost"`.

Badge `tone` accepts `default`, `neutral`, `success`, `warning`, and `danger`. Tone is visual only: features own the meaning and must include text. Existing default appearance remains unchanged.

### Table composition

`Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, and `TableCell` preserve native HTML table semantics and accept native attributes, `children`, and `className`. `TableHead` defaults to `scope="col"`; override for row headers. `Table density="compact"` uses 10px vertical cell padding, while `comfortable` (default) uses 16px. Cell padding inherits through a CSS custom property so individual cells can override it with `className`. Use `TableToolbar` for a shared responsive search/action strip. Rows support hover, focus-within, and visual `data-selected`; a feature providing selection must also implement the appropriate accessible selection state and behavior.

```tsx
<Table density="compact" aria-label="Registered devices">
  <TableHeader>
    <TableRow><TableHead>Device</TableHead><TableHead>Management status</TableHead></TableRow>
  </TableHeader>
  <TableBody>
    <TableRow>
      <TableCell><DeviceIdentity device={device} /></TableCell>
      <TableCell><Badge size="sm" tone="neutral">Pending enrollment</Badge></TableCell>
    </TableRow>
  </TableBody>
</Table>
```

`DeviceIdentity` above represents a feature-owned cell, not an additional shared component. Use ordinary cell composition or a feature wrapper for custom content. Inventory provides its own labeled, keyboard-focusable horizontal scroll region; avoid making an entire row clickable when it contains independent actions. Existing management labels do not imply tunnel or forwarding health.

`Pagination` is controlled: pass `page`, `pageSize`, `total`, `loading`, a unique `pageSizeId`, optional plural `itemLabel`, and `onPageChange` / `onPageSizeChange`. It offers the existing 10/25/50/100 sizes, computes the page count, disables unavailable navigation, and supplies a labeled navigation region. The feature resets its page on search or page-size changes and retains ownership of requests, cancellation and errors.

`EmptyState` accepts `title`, optional `description`, decorative `icon`, `action`, and native div attributes/`className`. Use it inside a spanning TableCell or directly in a feature panel. Keep permission checks on its action in the feature.

Inventory is the first consumer: compact rows, a readable neutral header, green device links, small status badges, and a connected toolbar/footer. Settings and device configuration opt into 36px controls, agent release selection uses 32px, and Modal/health controls use IconButton. No sorting, bulk action, new API, or competing data-table state is introduced.

Loading/error/empty inventory states retain semantic headers but hide the visual header and release the data-table minimum width, so their messages fit narrow viewports without horizontal scrolling. Settings declares an explicit single-column track below `xl`, preventing the operator table's intrinsic width from expanding the whole mobile page; its own overflow container remains authoritative.

## Select control appearance — 2026-10-22

The shared `Select` retains native `<select>` behavior, ref forwarding, labels, validation, and the `controlSize`/`containerClassName` API. Its closed control uses a rounded neutral surface, subtle hover border/background, visible accent focus ring, and a contained chevron affordance. The opened option menu remains browser/OS-native; do not imply that its popup styling is consistent across platforms.

## WireGuard draft/deploy presentation

`WireguardConnections` keeps unsaved form edits separate from a persisted draft and published topology. Save draft is enabled for local edits; Deploy changes requires a saved draft, no unsaved edits, and the reviewed draft version. Neither is shown to viewers. Polling updates timestamped deployment observations without overwriting edits or adopting another operator's draft version for mutations. Reload explicitly discards local edits. `WireguardDeploymentStatus` is feature-specific and reuses Card/Button/Feedback conventions, with separate receipt/apply/handshake states, actionable local activation details shown only for a current disabled observation (agent 0.3.6 local command), and a copyable controller-observed report. It does not run commands or collect raw appliance logs. See the [workflow and migration boundary](../operations/wireguard-tunnels.md#draft-and-explicit-deployment-workflow).

## Interface safe commit increment — 2026-10-22

Agent 0.4.0 adds current interface CIDRs and dedicated static LAN/VLAN safe apply through a locally authorized independent guard. Controller migrations 0022/0023 add candidates and immutable commit history; Underlay row actions offer Save and apply and Edit and retry. WAN/DHCP/gateway/advertisements remain blocked by this adapter, and forwarding stays isolated. Earlier metadata-only descriptions above describe the previous increment. See [interface operations](../operations/interface-management.md) for ownership, activation, recovery and evidence limits.
