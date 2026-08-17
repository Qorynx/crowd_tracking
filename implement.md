# Gemini Agent Prompt — Implement Final Stitch Redesign with shadcn/ui

You are a senior frontend engineer and design implementation specialist.

Your task is to implement the **final Stitch redesign** into the existing `Qorynx/crowd_tracking` frontend.

This is a **visual redesign implementation**, not a rewrite of the product.

A key requirement is to **reuse shadcn/ui primitives and components where they are appropriate instead of rebuilding generic UI components from scratch**.

---

# Inputs

You have:

1. The existing `Qorynx/crowd_tracking` repository.
2. The final Stitch export ZIP containing the final reference screens and design files.
3. The final refinement prompt / design guidance included with the Stitch export.

Inspect the repository and all relevant Stitch reference files before modifying code.

---

# Source-of-Truth Priority

When sources disagree, use this priority:

```text
1. Existing working application behavior
2. Existing backend/API contracts and real data
3. Existing session / camera / WebRTC / WebSocket lifecycle
4. Stitch screen.png visual references
5. Stitch DESIGN.md / design guidance
6. Final refinement prompt
7. Stitch code.html
```

`code.html` is only a design/reference artifact.

**Do not copy Stitch HTML blindly.**

Stitch may contain:

- placeholder values
- fake metrics
- unsupported product features
- duplicated application shell
- design-only states
- components that do not match the real frontend architecture

The production React app must continue using real application data and behavior.

---

# Existing Frontend Stack

The current frontend uses:

```text
React 19
TypeScript
Vite
Tailwind CSS v4
Lucide React
Recharts
clsx
tailwind-merge
```

Preserve this stack.

You MAY add and use:

```text
shadcn/ui
```

for reusable generic interface primitives.

Do NOT migrate the application to:

```text
Bootstrap
MUI
Ant Design
Chakra UI
Mantine
```

Do not replace the current architecture with another frontend framework.

---

# shadcn/ui Requirement

The current project may not have shadcn/ui initialized yet.

Before creating generic components manually:

1. Inspect whether shadcn/ui is already configured.
2. If it is not configured, initialize it correctly for:
   - React
   - Vite
   - TypeScript
   - Tailwind CSS v4
3. Preserve the project's existing styling architecture.
4. Do not reset or overwrite the existing global stylesheet or design tokens unnecessarily.
5. Add only the components actually needed.

Do NOT install a large collection of unused shadcn components.

---

# Prefer shadcn/ui for Generic UI

Before writing a generic component from scratch, check whether an appropriate shadcn/ui component exists.

Prefer shadcn/ui for components such as:

```text
Button
Dropdown Menu
Popover
Tooltip
Tabs
Switch
Checkbox
Select
Dialog
Alert Dialog
Sheet
Drawer
Badge
Separator
Scroll Area
Table
Skeleton
Progress
Input
Label
Card when appropriate
```

Examples:

```text
Overlay menu
→ DropdownMenu / Popover

Mobile navigation drawer
→ Sheet

Confirmation before stopping/deleting session
→ AlertDialog

Room Setup tabs
→ Tabs

Language selector
→ DropdownMenu or Select

System status tooltip
→ Tooltip

Loading placeholders
→ Skeleton

Form controls
→ Input / Label / Select / Switch
```

Do not manually rebuild accessible focus management, keyboard navigation, dropdown positioning, modal behavior, or ARIA behavior if shadcn/ui already provides it.

---

# Do NOT Turn the Product into a Default shadcn Dashboard

Using shadcn/ui does NOT mean using the default shadcn visual style everywhere.

The Stitch design remains the visual reference.

Customize shadcn components through:

```text
className
variants
CSS variables
design tokens
Tailwind utilities
```

The final product must still look like **Crowd Analytics**, not a generic shadcn starter dashboard.

Do not simply assemble:

```text
Card
Card
Card
Card
Card
```

for every metric.

Avoid the typical generic AI-generated shadcn dashboard look.

Use shadcn primarily for **behavioral primitives**, accessibility, and common controls.

---

# Custom Components That Should Remain Custom

Do NOT try to replace domain-specific Crowd Analytics UI with generic shadcn components.

These should remain custom product components:

```text
LiveCameraPanel
VideoOverlayCanvas
BoundingBoxRenderer
RoomFlow
PeopleHeroMetric
SeatMap
SeatLegend when product-specific
CalibrationCanvas
SpatialHeatmap
ZoneDistribution
RoomLayoutEditor
LiveMetricPanel
RoomStatus
```

shadcn may be used inside these components for controls, menus, buttons, tabs, dialogs, etc., but should not replace their domain-specific visualization.

Example:

```text
LiveCameraPanel
├── custom <video>
├── custom <canvas>
└── shadcn DropdownMenu for overlay settings
```

not:

```text
LiveCameraPanel
→ generic shadcn Card with static screenshot
```

---

# Main Goal

Rebuild the existing frontend visual layer so it closely matches the final Stitch screens while preserving the real Crowd Analytics product.

The result must feel like:

```text
professional indoor monitoring software
smart-building operations software
classroom / office monitoring
calm
credible
specific
production-ready
```

It must NOT feel like:

```text
AI demo
cyberpunk HUD
generic shadcn dashboard
generic admin dashboard
gaming interface
computer-vision research demo
```

---

# Critical Rule: Preserve Application Behavior

Do NOT rewrite or break existing working logic for:

- camera permission and acquisition
- local `<video>` rendering
- canvas overlay rendering
- WebRTC live transport
- WebSocket metadata
- HTTP fallback
- live session creation/deletion/reset
- warm-up lifecycle
- active session ownership
- analytics mapping
- telemetry mapping
- room layout configuration
- camera calibration
- video analysis
- Vietnamese / English language support

Visual refactoring is allowed.

Behavioral refactoring should be minimal and only performed when needed to support cleaner presentation structure.

---

# Critical Rule: Never Use Stitch Placeholder Data

Do NOT hardcode values from Stitch such as:

```text
26 people
81%
0.41 /m²
24 / 32
31 / 5
94 people
48 / 32 / 14 zone counts
uptime values
health scores
trend percentages
dwell times
```

Every displayed value must come from the existing real frontend/backend data model.

If real data is unavailable, display:

```text
—
No data yet
Not configured
Calibration required
Unavailable
```

Do not fabricate values to make the interface look complete.

---

# First Step — Audit Before Coding

Before modifying code:

1. Inspect the existing frontend architecture.
2. Identify:
   - `App.tsx`
   - layout components
   - page components
   - analytics types
   - API contracts
   - analytics mapper
   - telemetry mapper
   - session lifecycle
   - LivePage transport logic
3. Inspect every final Stitch `screen.png`.
4. Read the Stitch design guidance.
5. Inspect whether shadcn/ui already exists.
6. Determine which generic components should use shadcn/ui.
7. Determine which domain-specific components should remain custom.
8. Review corresponding Stitch `code.html` only to understand layout intent.

Then provide a short implementation plan.

Do not begin with a full rewrite.

---

# Recommended Component Strategy

Aim for a structure similar to:

```text
components/
├── ui/                         # shadcn/ui generated components
│   ├── button.tsx
│   ├── dropdown-menu.tsx
│   ├── popover.tsx
│   ├── tabs.tsx
│   ├── tooltip.tsx
│   ├── sheet.tsx
│   ├── dialog.tsx
│   ├── badge.tsx
│   └── ...
│
├── layout/
│   ├── AppShell.tsx
│   ├── Header.tsx
│   ├── Sidebar.tsx
│   └── MobileNav.tsx
│
├── dashboard/
│   ├── PeopleHeroMetric.tsx
│   ├── RoomFlow.tsx
│   ├── MetricRow.tsx
│   └── RoomStatus.tsx
│
├── live/
│   ├── LiveCameraPanel.tsx
│   ├── LiveMetricPanel.tsx
│   ├── OverlayMenu.tsx
│   └── MonitoringStatus.tsx
│
├── room/
│   ├── SeatMap.tsx
│   ├── SeatLegend.tsx
│   └── CalibrationCanvas.tsx
│
└── analytics/
    ├── SpatialHeatmap.tsx
    └── ZoneDistribution.tsx
```

This is a direction, not a mandatory exact folder structure.

Do not over-abstract.

---

# Pass 1 — shadcn/ui Setup + Shared Design System

If shadcn/ui is not configured:

- initialize it safely
- use the existing Vite/Tailwind setup
- preserve Tailwind v4 compatibility
- preserve existing TypeScript aliases if possible
- add only the primitives needed by the redesign

Create/refine reusable design tokens for:

```text
background
surfaces
borders
text
accent
success
warning
danger
radius
spacing
typography
```

Make shadcn components consume the same design system.

Do not let shadcn introduce a visually separate theme.

---

# Pass 2 — App Shell

Create one consistent application shell:

```text
AppShell
├── Header
├── Sidebar
├── Main Content
└── Mobile Navigation
```

Do not reproduce separate shells from individual Stitch pages.

Use shadcn where useful:

```text
Mobile menu
→ Sheet

Language selector
→ DropdownMenu

Small status info
→ Tooltip

Separators
→ Separator
```

Remove inconsistent labels such as:

```text
ADMIN CONSOLE
New Analysis
```

Use unified product language:

```text
Crowd Analytics
Indoor Monitoring
Start Monitoring
```

where appropriate.

---

# Pass 3 — Overview

Use the final Overview Stitch screen as the primary visual reference.

The visual hierarchy must be:

```text
People = hero metric

then:
Moving / Stationary

then:
Occupancy
Density
Seats

then:
Room Flow
```

People count should be more visually important than Occupancy percentage.

Bind all values to existing analytics.

Do not restore AI Coverage as a primary Overview metric.

Do not create decorative/fake trend charts.

Do not force every metric into a shadcn Card.

Use whitespace and typography.

shadcn may be used for:

```text
Badge
Tooltip
Separator
```

where useful.

---

# Pass 4 — Live Monitor

Use the final Live Monitor Stitch screen as the primary reference.

This is the most behavior-sensitive page.

## Preserve

```text
local browser video
+
transparent overlay canvas
```

Camera remains approximately 70–75% of desktop content width.

Do NOT replace the local video with a server-rendered annotated video.

Do NOT rewrite transport logic merely to fit the design.

## Right-side metrics

Primary:

```text
People
IN / OUT
Density
Seats
```

Secondary:

```text
Moving
Stationary
```

Do not prioritize visual-presentation attributes.

## Use shadcn for controls

Recommended:

```text
Overlay options
→ DropdownMenu or Popover

Debug options
→ Checkbox / Switch

Camera selector
→ Select

Reset confirmation if needed
→ AlertDialog

Tooltips
→ Tooltip
```

Do NOT recreate these accessibility-heavy controls manually unless necessary.

## Overlay menu

Compact top-level controls:

```text
Boxes
IDs
Overlays
```

Inside Overlays:

```text
Spatial
□ Zones
□ Seats
□ Motion
□ Trajectory

Attributes
□ Visual Attributes

Advanced
□ Debug Labels
```

Default labels should remain minimal.

## Status wording

Prefer:

```text
Live
Monitoring active
Preparing monitoring
Camera connected
```

Avoid:

```text
LIVE AI STREAM
AI Initializing
Model Connected
```

## Event Log

Only implement it if real backend events exist.

If there is no real event source, omit it.

Do not fabricate room events.

---

# Pass 5 — Room Setup

Use the final Room Setup Stitch screen.

Preserve actual supported behavior:

```text
room information
rows
seat layout
enable / disable seats
save layout
calibration
```

Use shadcn for:

```text
Layout / Calibration
→ Tabs

Room configuration controls
→ Input / Label / Button

Seat status help
→ Tooltip where useful

Save confirmation/error
→ appropriate Alert / toast mechanism if already available
```

Do not replace the SeatMap with a generic component.

Do not turn Room Setup into a free-form CAD editor.

Do not add unsupported:

```text
arbitrary desk creation
free drag
advanced snapping
layers
complex zoom tools
```

---

# Pass 6 — Spatial Analytics

Use the final Spatial Analytics Stitch screen.

Spatial remains primary.

Use actual backend:

```text
zones
heatmap
density
people count
dwell time only if available
```

The heatmap must be rendered from real backend values.

Do not recreate it as a static screenshot-like gradient.

Use shadcn where useful:

```text
Spatial / Attributes
→ Tabs

Tooltip for chart/zone details
→ Tooltip

Table if needed
→ shadcn Table
```

Do not hardcode zone counts.

Zone totals must remain logically consistent with current room data.

---

# Pass 7 — System

Use the final System Stitch screen.

Technical data belongs here.

Organize around:

```text
System Status
Connection
Processing
Pipeline
```

Use real telemetry only.

Possible values:

```text
Camera FPS
Update Rate
Processing Rate
Latency P50
Latency P95
Pending Frames
Detector
Tracker
```

Use shadcn for:

```text
Tabs if needed
Tooltips
Badges
Separators
Tables
```

Do not invent:

```text
uptime
health percentage
sensor score
core service score
```

unless backend exposes them.

---

# Pass 8 — Video Analysis

Keep existing product capability.

Use shadcn where appropriate:

```text
File picker button
Progress indicator only if real progress exists
Dialog only if needed
Alert for errors
```

Do not create fake:

```text
Recent Analyses
saved history
job queue
fake progress
```

Use real API limits and constraints.

---

# Pass 9 — Mobile

Use the final mobile Stitch reference.

Mobile priority:

```text
Camera / room status
People
IN / OUT
Occupancy / Density
Seats
Essential controls
```

Recommended shadcn:

```text
Navigation drawer
→ Sheet

Overlay controls
→ Drawer / Sheet / Popover depending screen size

Secondary actions
→ DropdownMenu
```

Do not expose full diagnostics by default.

Semantic colors:

```text
green = live / healthy
amber = preparing / warning
red = error / stop / destructive
```

---

# Styling Rules

Use Inter or the current equivalent for product UI.

Use monospace only for technical diagnostics:

```text
FPS
latency
track IDs
device IDs
```

Avoid repetitive Card-based layouts.

Do not make every metric:

```text
icon
label
large number
```

Use deliberate hierarchy and asymmetry.

Use whitespace and typography before borders.

Remove:

```text
radar
scanline
neon glow
cyber backgrounds
continuous pulse effects
decorative crosshairs
```

Use subtle shadows only.

---

# shadcn Customization Rules

For each shadcn component:

1. Match the Stitch design, not the default demo theme.
2. Use project design tokens.
3. Keep border radius consistent with the final design.
4. Keep focus states accessible but subtle.
5. Avoid default oversized spacing when it does not match the design.
6. Do not create visual inconsistency between custom components and shadcn components.

Prefer extending variants rather than duplicating components.

For example:

```text
Button
├── primary
├── secondary
├── ghost
└── destructive
```

Use consistent variants throughout the app.

---

# Micro-Interactions

Add life only through meaningful state changes.

Examples:

```text
People 25 → 26
IN +1
Vacant → Occupied
Preparing → Live
```

Use subtle 150–500ms transitions.

Do not add decorative animation.

Respect:

```text
prefers-reduced-motion
```

---

# Data and State Rules

Keep one source of truth.

Do not duplicate analytics state.

Do not create frontend mock-data stores.

Do not create separate fake session state for redesigned pages.

Preserve active LivePage/session behavior when switching pages.

Using shadcn components must not cause page unmounts or session recreation.

This is especially important for:

```text
Tabs
Sheet
Dialog
Conditional rendering
```

Do not accidentally unmount the live camera/session because of visual component changes.

---

# Quality Checks After Each Pass

After each page:

1. Run TypeScript/build.
2. Run lint if available.
3. Confirm no API contract changed.
4. Confirm no mock values were introduced.
5. Confirm responsive behavior.
6. Confirm empty/offline states.
7. Confirm keyboard navigation for shadcn controls.
8. Confirm focus states.
9. Confirm existing interactions still work.
10. Compare visually with the corresponding Stitch PNG.

For Live specifically verify:

```text
camera starts
camera remains smooth
warm-up works
session cleanup works
WebRTC works
WebSocket metadata works
HTTP fallback works
overlay alignment is correct
opening a Dropdown/Popover does not interrupt the camera
switching pages does not kill an active session unexpectedly
```

---

# Final Acceptance Criteria

The implementation is complete only when:

- the visual language closely matches the final Stitch redesign
- shadcn/ui is used for appropriate generic primitives
- generic controls were not unnecessarily rebuilt from scratch
- domain-specific Crowd Analytics visualization remains custom
- the app does not look like a default shadcn dashboard
- all pages use one consistent AppShell
- no `ADMIN CONSOLE` / generic template branding remains
- no cyberpunk UI remains
- People is the primary Overview metric
- Live remains camera-first
- Room Setup retains its domain-specific identity
- all metrics come from real data
- unsupported Stitch features are omitted
- existing backend/API/session behavior is preserved
- desktop/mobile responsive behavior works
- TypeScript build passes
- no obvious frontend regression is introduced

---

# Important Working Style

Do not rewrite the entire frontend at once.

Work incrementally.

Before each major pass:

- inspect the relevant existing component
- compare it with the Stitch reference
- identify visual vs behavioral responsibilities
- identify whether a generic UI primitive can use shadcn
- preserve behavior
- then modify presentation

Use this decision rule:

```text
Generic interaction primitive?
→ Prefer shadcn/ui

Crowd Analytics domain visualization?
→ Keep/custom build

Existing working behavior?
→ Preserve

Stitch placeholder-only feature?
→ Do not implement
```

When uncertain whether a Stitch element is real or decorative, do not implement it until a real data source or existing behavior is confirmed.

The final goal is not to reproduce a static screenshot.

The final goal is to make the **existing Crowd Analytics application behave exactly as before while visually becoming the final production-quality design shown in the Stitch export, using shadcn/ui intelligently for reusable generic interface primitives**.
