# HAPZO dashboard reference analysis

## Scope and evidence

This is a first-pass analysis of the supplied HAPZO Decaste dashboard screenshot (desktop view, approximately 1920 × 870 px). It records only what is visible in that image. Measurements and color descriptions are visual estimates, not extracted design tokens. No internal-page, mobile, interaction, or accessibility references have been supplied yet.

## Visual language

- **Overall feel:** calm, warm, spacious, and operational. A textile image in the lower sidebar and the HAPZO leaf mark connect the interface to apparel manufacturing.
- **Typography:** contemporary sans serif with rounded forms. Page titles are large and bold; navigation and KPI values are also strong. Labels and supporting copy are smaller, muted, and lightly weighted. The exact font cannot be identified from this screenshot alone.
- **Primary colors:** deep forest/teal green for the active navigation and brand emphasis; warm ivory/cream for the shell; dark blue-gray for primary text.
- **Surfaces:** white or near-white cards on a warm neutral canvas, fine beige-gray borders, and restrained soft shadows.
- **Radius:** generous rounding on major cards and controls (roughly 14–20 px); smaller controls and chart actions use moderately rounded corners.
- **Icons:** simple outline icons, mostly green or category-colored. Icon strokes are consistent and subordinate to labels.
- **Density:** desktop-first and low-to-medium density. Sections have generous gaps and internal padding; cards prioritize scanability over compactness.

### Approximate screenshot palette

| Role | Visual estimate | Use visible in screenshot |
| --- | --- | --- |
| Warm shell | pale ivory / sand | Sidebar and page canvas |
| Brand green | deep teal-green | Active Dashboard item, logo, accents |
| Primary text | dark blue-gray | Titles, labels, KPI values |
| Secondary text | muted warm gray | Descriptions, chart annotations |
| Positive tint | pale mint | Total Employees card |
| Informational tint | pale blue | Present Today card |
| Payroll tint | pale blush | Monthly Payroll card |
| Compliance tint | pale yellow | Certification Documents card |
| Dividers | light beige-gray | Card borders and header separation |

These are semantic color roles; exact hex values should be sampled from source assets or more references before implementation.

## Layout and hierarchy

1. **Left navigation rail:** approximately one-sixth of the viewport width. It has a tall brand block at the top, a collapse control, a vertical navigation list, a filled green selected state, and a textile background image near the bottom.
2. **Top header:** spans the content area and is separated from the page by a fine divider. A wide global search field sits left. Notification, quick-action/status icons, language or locale controls, and the user profile sit on the right.
3. **Main page header:** starts with a small uppercase workspace eyebrow, followed by the Dashboard title and one-line description. Company selector, company count/link, and refresh controls align to the right on desktop.
4. **KPI row:** four equal-width cards show a colored icon disc, a label, a prominent value, a small contextual line, and a diagonal link affordance. Each card has a different pastel semantic tint.
5. **Analytics row:** two large white cards form a two-column grid. Employee Strength pairs a donut chart with a labeled legend and values. Attendance Overview uses a wide weekly chart with a legend and a clear empty-state sentence.
6. **Lower content:** Recent Employees and Certification Documents continue as another two-column row of cards, with compact “View all” actions.
7. **Footer:** a compact centered product/developer attribution is visible along the bottom edge.

## Reusable components identified

- Brand block with logo, workspace/sub-brand, and collapse button
- Sidebar navigation item with icon, hover, and selected states
- Global search field
- Header utility actions, notification indicator, locale selector, and user menu
- Workspace eyebrow + page title + explanatory copy
- Company filter/select control and company-count shortcut
- KPI/stat card with icon, value, trend/context copy, and navigation affordance
- Card/panel header with title, subtitle, and “View all” action
- Donut chart with category legend and totals
- Time-series chart with legend and explicit empty state
- User/avatar profile control
- Persistent product footer

## Interaction patterns evidenced

- Sidebar navigation has a clear filled active state.
- The sidebar can be collapsed.
- Global search is available from all dashboard context (global availability inferred from placement; confirm on other pages).
- The company selector filters dashboard context; the company-count control likely navigates to company records.
- KPI tiles, chart-card “View all” actions, and diagonal arrows signal navigation to detail pages.
- Refresh control suggests the dashboard data can be reloaded.
- Notification and profile controls are present, but their menus and behaviors are not visible.

## Responsive behavior

Only a wide desktop screenshot is available. The desktop composition uses a persistent left rail, horizontal header, four-column KPI row, and two-column analytics grid. Breakpoints, mobile navigation, card stacking, chart behavior, and sticky/fixed positioning cannot be established from this evidence and should be confirmed with narrow-screen references before implementation.

## Design-system implementation guidance

- Keep the warm ivory shell and forest-green interaction color as the visual anchors.
- Use white cards with thin warm borders and soft elevation; reserve pastel fills for semantic summary cards.
- Preserve the hierarchy of small uppercase workspace label → bold page heading → quiet supporting copy.
- Make data-card actions visible but secondary to the main metric.
- Use consistent outline iconography and chart colors; pair color with labels so meaning is not color-only.
- Treat the textile background as a brand treatment for the navigation area, not a general page background.
- Confirm contrast, keyboard focus, and responsive behavior against the source application before adopting exact tokens.

## Evidence still needed

- Internal page screenshots showing tables, forms, filters, modals, and detail views
- Narrow/mobile screenshots or an interactive walkthrough for responsive behavior
- Source font and exact color values, if available
- Confirmation of the header icons, locale controls, sidebar collapse, search, refresh, and navigation behavior
- Any design references for empty, loading, validation, error, disabled, and permission-restricted states

## Phase status

**Dashboard reference: analyzed at a first-pass level.** This is not a complete product design-system specification: the prompt calls for analysis of every supplied dashboard and internal-page image, but only one dashboard screenshot is currently available in this conversation. Full ERP implementation remains gated on completing the reference set and reviewing the ERP requirements source.
