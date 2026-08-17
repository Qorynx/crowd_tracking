# Stitch Final Refinement Prompt — Crowd Analytics

Refine the current redesigned **Crowd Analytics** UI one final time.

This is **NOT a redesign from scratch**. Keep the current visual direction, layout language, dark professional style, sidebar structure, spacing rhythm, and overall composition.

The goal is to make the current design feel more like a **real production monitoring product** and less like an AI-generated enterprise dashboard.

Do not introduce new product features, new backend capabilities, fake analytics, or new information architecture.

---

# 1. Core Product Hierarchy

The product should visually prioritize:

```text
Room state
→ People
→ Occupancy / Density
→ Flow
→ Seats / Space
→ Monitoring status
→ Technical diagnostics
```

AI/model details must remain secondary.

The user should understand within 3 seconds:

- How many people are here?
- How full is the room?
- What is the current flow?
- Is monitoring active?
- Is anything unavailable or degraded?

---

# 2. Overview — Final Refinement

Keep Overview as the default landing page.

## Make People Count the hero metric

Current hierarchy over-emphasizes Occupancy percentage.

Change the main hero to:

```text
26
People currently in room
```

Occupancy becomes secondary:

```text
Occupancy
81%
```

Recommended hierarchy:

```text
CURRENT ROOM

26
People

Moving 3 · Stationary 23

Occupancy      Density       Seats
81%            0.41 /m²      24 / 32
```

Then:

```text
Room Flow

IN             OUT            NET
+3.2/min       1.1/min        +2.1/min
31 total       5 total
```

Do not add decorative charts.

Do not add AI scores or coverage metrics to Overview.

---

# 3. Remove Generic Enterprise / AI Template Language

Remove or replace:

```text
ADMIN CONSOLE
New Analysis
LIVE AI STREAM
AI Coverage
AI Engine
System Nominal
Model Connected
AI Pipeline
Neural
Intelligence Score
```

Preferred language:

```text
Crowd Analytics
Indoor Monitoring
Start Monitoring
Live
Monitoring active
Preparing monitoring
System ready
Room status
```

If a button currently says:

```text
+ New Analysis
```

replace it with:

```text
Start Monitoring
```

or remove it if redundant.

---

# 4. Live Monitor — Preserve Current Layout

Keep the current camera-first layout.

The camera must remain approximately 70–75% of the primary desktop content area.

Do not redesign the media layout.

Keep:

```text
local camera
+
transparent bounding-box canvas
```

Do not add radar, crosshair, scanlines, HUD graphics, or large glowing indicators.

---

# 5. Live Monitor — Simplify the Right Panel

Primary metrics:

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

Do NOT prioritize:

```text
Female / Male
Unknown
Attribute Coverage
Model FPS
Transport
Tracker internals
```

Those may exist under secondary analytics or System.

---

# 6. Live Event Log

Do not show low-level inference events such as:

```text
Model inference optimized
Tracker initialized
Tracking ID acquired
Detector ready
```

If an event log remains, it should contain room-level operational events only:

```text
10:43  Person entered
10:44  Occupancy changed to 26
10:45  Seat occupancy updated
```

If these events are not available from real backend data, remove the log entirely.

Do not fabricate events.

---

# 7. Live Overlay Controls

Keep the compact approach:

```text
Boxes ✓
IDs ✓
Overlays ▾
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

Avoid showing seven permanent checkboxes.

Default overlay should show only:

```text
P01
```

Do not display tracker IDs, confidence, attributes, or model source by default.

---

# 8. Warm-up / Startup State

Keep camera visible as soon as browser permission is granted.

Do not cover the entire camera while backend is preparing.

Use a small status element:

```text
Camera connected        ✓
Tracking service        Preparing…
Attributes              Preparing…
```

When ready:

```text
Monitoring active
```

Do not use fake percentage progress.

Do not use dramatic loading animations.

---

# 9. Analytics — Keep Spatial First

Keep:

```text
Spatial
Attributes
```

Spatial remains the primary tab.

Use only real backend values.

Do not invent:

- trend percentages
- focus zones
- dwell times
- comparison vs last hour
- occupancy history
- heatmap values
- zone percentages

unless those values actually exist.

If unavailable, show:

```text
—
No data yet
Not configured
Calibration required
```

---

# 10. Heatmap

Preserve the visual direction but make it look like real room analytics.

Prefer:

```text
room boundary
actual heatmap grid / interpolation
clear Low → High legend
```

Avoid purely decorative blurred glowing circles.

The heatmap should feel measurable, not illustrative.

---

# 11. Room Setup — Keep Strong Visual Identity

The current Room Setup visual direction is good and should be preserved.

However, do not turn it into a free-form CAD editor unless the real product supports that.

Avoid introducing unsupported tools such as:

```text
Add Desk
Free drag
Arbitrary object placement
Advanced snapping
Layer editor
Complex zoom workspace
```

unless already implemented.

For MVP, prioritize:

```text
Room information
Rows
Seat layout
Enable / disable seats
Save Layout
Calibration
```

The seat map should remain one of the most distinctive product-specific visuals.

---

# 12. Calibration

Keep calibration clean and practical.

Recommended structure:

```text
Calibration

Camera Reference

[ calibration canvas ]

Floor Width      8.0 m
Floor Depth      8.0 m
Points           4 / 4

Reset Points                     Save Calibration
```

Do not add unnecessary technical controls.

---

# 13. Video Analysis — Match Real Product Capability

Do not imply unsupported backend features.

Remove:

```text
Recent Analyses
Persistent History
65% Processing Job
Saved Analysis Queue
500 MB limit
```

unless those features really exist.

Prefer:

```text
Video Analysis

Drop a short video here
MP4 / WebM

Maximum 60 seconds
Maximum 64 MB

Select Video
```

Then show real analysis results after completion.

No fake job history.

---

# 14. System Page

System is where technical information belongs.

Keep:

```text
System Status
Connection
Processing
Pipeline
```

Technical values may include:

```text
Detector
Tracker
Camera FPS
Update Rate
Processing Rate
Latency P50
Latency P95
Pending Frames
```

Prefer:

```text
Update Rate
Processing Rate
```

instead of:

```text
AI RATE
MODEL PROC
```

Do not make System visually compete with Overview or Live.

---

# 15. Remove the Global Technical Footer

Do not permanently show:

```text
CAM
AI RATE
MODEL PROC
LATENCY P95
```

on every page.

Either remove the footer or show technical telemetry only on Live / System.

A small status indicator such as:

```text
● Healthy
```

is enough globally.

---

# 16. Reduce the “AI-Generated Dashboard” Look

Avoid repetitive patterns such as:

```text
icon + label + large number
icon + label + large number
icon + label + large number
```

for every metric.

Do not put every piece of information inside an identical card.

Use a mix of:

- hero metric
- supporting text
- compact stat rows
- subtle dividers
- whitespace
- one dominant panel
- secondary panels

Create deliberate asymmetry.

Do not use perfectly repetitive 3×2 or 4×2 card grids unless the information genuinely requires it.

---

# 17. Reduce Decorative Styling

Keep the current professional dark visual language.

Reduce further:

- glow
- glass effects
- cyan borders
- icon containers
- pills
- gradients
- uppercase labels
- monospace

Use accent color only when it communicates:

```text
selected
live
success
warning
action
```

Informational surfaces should remain neutral.

---

# 18. Micro-Interactions — Add Life Through Real Data

Do not add decorative animation.

Use subtle state-driven interactions:

```text
People 25 → 26
```

Brief number transition.

```text
IN +1
```

Short 300–500 ms highlight.

```text
Vacant → Occupied
```

Smooth 150–250 ms seat transition.

```text
Offline → Preparing → Live
```

Smooth status transition.

Bounding boxes may interpolate smoothly between real updates.

Heatmap intensity may transition gently between real samples.

Do not animate data that has not changed.

---

# 19. Domain-Specific Identity

Make the product feel specific to indoor crowd monitoring.

Prefer labels such as:

```text
Classroom A
Front Camera
Entrance
Front Rows
Middle Area
Back Rows
Teacher Area
Seat A12
Room Flow
Current People
```

Avoid generic SaaS terms such as:

```text
Users
Performance
Engagement
Insights
Intelligence
AI Score
```

The product should not look interchangeable with a finance, CRM, or admin dashboard.

---

# 20. Mobile Refinement

Keep the current mobile direction.

## Mobile Overview

Hero:

```text
26
People
```

Then:

```text
Occupancy     Density
81%           0.41 /m²

IN / OUT      Seats
31 / 5        24 / 32
```

Keep the mobile interface visually quiet.

---

## Mobile Live

Camera remains the dominant element.

Below it:

```text
People        26
IN / OUT      31 / 5
Density       0.41 /m²
Seats         24 / 32
```

Actions:

```text
Overlays
Fullscreen
```

Do not show detailed system telemetry by default on mobile.

---

# 21. Data Integrity Rules

This is critical.

Never create fake data just to make the design look complete.

If the real system does not provide a value, display:

```text
—
```

or:

```text
No data yet
Not configured
Calibration required
Unavailable
```

Do not fabricate:

- trends
- percentages
- history
- confidence
- event logs
- health scores
- AI scores
- dwell time
- analysis jobs
- room status

The design must remain credible when connected to the real backend.

---

# 22. Keep Current Design Strengths

Preserve the strongest parts of the current redesign:

- professional dark palette
- restrained blue accent
- strong whitespace
- clean sidebar
- camera-first Live Monitor
- domain-specific Room Setup
- responsive mobile layouts
- simpler typography
- reduced cyberpunk styling

Do not revert to neon cyberpunk.

---

# Required Final Screens

Refine these existing screens rather than creating new unrelated concepts:

1. Overview — Desktop
2. Overview — Calibration Required
3. Live Monitor — Camera Off
4. Live Monitor — Preparing
5. Live Monitor — Active
6. Live Monitor — Overlay Menu
7. Spatial Analytics
8. Attributes Analytics
9. Room Setup — Layout
10. Room Setup — Calibration
11. Video Analysis
12. System
13. Mobile Overview
14. Mobile Live
15. Mobile Live Fullscreen

---

# Final Objective

The final UI should feel:

```text
specific
intentional
operational
credible
alive
professional
```

It should NOT feel:

```text
AI-generated
generic SaaS
cyberpunk
admin template
computer-vision demo
```

The source of visual life should be:

```text
real room data
state transitions
meaningful interaction
domain-specific structure
```

not decorative effects.

Keep the existing redesign and perform a final refinement pass using these constraints.
