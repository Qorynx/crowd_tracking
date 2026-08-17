---
name: Operations Intelligence
colors:
  surface: '#071421'
  surface-dim: '#071421'
  surface-bright: '#2e3a49'
  surface-container-lowest: '#030f1c'
  surface-container-low: '#101c2a'
  surface-container: '#14212e'
  surface-container-high: '#1e2b39'
  surface-container-highest: '#293644'
  on-surface: '#d6e4f7'
  on-surface-variant: '#bdc8d1'
  inverse-surface: '#d6e4f7'
  inverse-on-surface: '#253140'
  outline: '#87929a'
  outline-variant: '#3e484f'
  surface-tint: '#7bd0ff'
  primary: '#8ed5ff'
  on-primary: '#00354a'
  primary-container: '#38bdf8'
  on-primary-container: '#004965'
  inverse-primary: '#00668a'
  secondary: '#adc6ff'
  on-secondary: '#002e6a'
  secondary-container: '#0566d9'
  on-secondary-container: '#e6ecff'
  tertiary: '#ffc176'
  on-tertiary: '#472a00'
  tertiary-container: '#f1a02b'
  on-tertiary-container: '#613b00'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#c4e7ff'
  primary-fixed-dim: '#7bd0ff'
  on-primary-fixed: '#001e2c'
  on-primary-fixed-variant: '#004c69'
  secondary-fixed: '#d8e2ff'
  secondary-fixed-dim: '#adc6ff'
  on-secondary-fixed: '#001a42'
  on-secondary-fixed-variant: '#004395'
  tertiary-fixed: '#ffddb8'
  tertiary-fixed-dim: '#ffb960'
  on-tertiary-fixed: '#2a1700'
  on-tertiary-fixed-variant: '#653e00'
  background: '#071421'
  on-background: '#d6e4f7'
  surface-variant: '#293644'
  app-bg: '#0A0F18'
  sidebar-bg: '#0D1420'
  surface-primary: '#111A28'
  surface-secondary: '#162131'
  surface-elevated: '#1A2637'
  border-default: '#243247'
  border-strong: '#33445C'
  text-primary: '#F1F5F9'
  text-muted: '#718096'
  success: '#22C55E'
  warning: '#F59E0B'
  danger: '#EF4444'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 36px
    fontWeight: '600'
    lineHeight: 44px
    letterSpacing: -0.02em
  display-md:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  title-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.02em
  technical-data:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  gutter: 24px
  margin-page: 32px
  card-padding: 20px
  sidebar-width: 224px
---

## Brand & Style

This design system is engineered for high-stakes monitoring environments where clarity and focus are paramount. The aesthetic moves away from speculative "sci-fi" tropes toward a refined **Corporate/Modern** style that prioritizes data density and ocular comfort during long monitoring shifts.

The personality is **calm, reliable, and precise**. It evokes the feeling of high-end infrastructure management—silent, powerful, and always vigilant. Visual noise is aggressively minimized to elevate actionable insights, using a "dark-first" philosophy to reduce eye strain and establish a clear hierarchy of information.

**Design Principles:**
- **Signal over Noise:** Every pixel must serve a functional purpose. Decorative elements are excluded in favor of clean margins and purposeful grouping.
- **Calm Authority:** A palette of deep, desaturated tones provides a stable foundation for high-contrast alerts and live data.
- **Functional Transparency:** Use subtle layering and depth to organize complex layouts without cluttering the user's field of vision.

## Colors

The color strategy utilizes a **sophisticated dark-first** palette. The foundation is built on deep navy and slate tones to create a cohesive environment that feels technical yet professional.

- **Primary Accent (#38BDF8):** Reserved for active interactive states, primary action indicators, and live status updates. It provides a crisp, high-visibility contrast against the dark background.
- **Secondary Accent (#3B82F6):** Used for supporting actions and secondary links to maintain a distinction between "Status/Active" and "Navigation/Action."
- **Semantic Colors:** Green (Success), Amber (Warning), and Red (Danger) are used strictly for status reporting (e.g., occupancy limits, connectivity status).
- **Surface Strategy:** Depth is established through a four-tier surface system. Backgrounds are the darkest (`#0A0F18`), while interactive or nested components use lighter slate tones (`#111A28` to `#1A2637`) to imply elevation.

## Typography

The typography system is centered on **Inter** for its exceptional legibility and neutral, professional character. To maintain the "Operations Intelligence" aesthetic, font weights are used strategically to create hierarchy rather than relying on varied colors.

- **Data KPIs:** Primary metrics (e.g., "Total Occupancy") utilize `display-md` or `display-lg` with semibold weights to ensure immediate readability at a glance.
- **Technical Values:** **JetBrains Mono** is used exclusively for raw machine data, including FPS, latency, and device IDs. This distinguishes human-readable insights from technical diagnostic values.
- **Hierarchy:** Use `text-primary` for titles and data, `text-secondary` for supporting labels, and `text-muted` only for non-essential metadata or hints.

## Layout & Spacing

The layout utilizes a **fixed-fluid hybrid grid** designed for dashboard efficiency.

- **Structure:** A fixed left-hand sidebar (224px) handles global navigation, while the main content area utilizes a fluid grid that adapts to screen width.
- **Rhythm:** An 8px base grid governs all padding and margins. 
- **Video Containers:** In "Live" views, the video stream should occupy approximately 75% of the horizontal space, with technical metadata and flow charts occupying the remaining 25% in a side panel.
- **Responsive Behavior:** On desktop, cards are laid out in a multi-column grid (up to 12 columns). On mobile, the layout reflows into a single column with the sidebar collapsing into a top-level drawer or bottom navigation bar.

## Elevation & Depth

Hierarchy is established through **tonal layering** and **low-contrast outlines**. This system avoids heavy shadows to maintain a sleek, modern look.

- **Surface Tiering:** Higher-priority elements (like active cards or modals) use lighter surface colors (`surface-elevated`) and a 1px border (`border-strong`) to appear closer to the user.
- **Shadows:** Use extremely subtle, large-radius shadows (e.g., `0 10px 30px rgba(0,0,0,0.5)`) only for floating elements like dropdown menus or modals.
- **Overlays:** Semi-transparent overlays used on video streams for bounding boxes should use a 1.5px stroke of the primary or semantic color without any inner fill or glow, ensuring the underlying video remains clearly visible.

## Shapes

The shape language is **Rounded**, striking a balance between the clinical sharpness of legacy monitoring tools and the approachability of modern SaaS.

- **Containers:** Standard cards and video containers use a `1rem` (16px) radius to soften the interface.
- **Controls:** Buttons and input fields use a `0.5rem` (8px) radius.
- **Status Indicators:** Use "pill" shapes (full radius) for status chips (e.g., "LIVE", "OFFLINE") to distinguish them from interactive buttons.
- **Bounding Boxes:** For AI detections, use a tighter `4px` radius to maintain a sense of technical precision.

## Components

### Buttons
- **Primary:** Background `primary-color-hex`, text `app-bg`. High contrast.
- **Secondary:** Transparent background, `border-default`, text `text-primary`.
- **Ghost:** No background or border, text `text-secondary`, turns `primary-color-hex` on hover.

### Cards
- Background `surface-primary`, border `1px solid border-default`.
- Padding should be consistent at `20px`.
- Use `surface-secondary` for internal sections (e.g., a header within a card).

### Input Fields
- Background `surface-secondary`, border `border-default`.
- Focus state: Border changes to `primary-color-hex` with a subtle glow (0 0 0 2px).
- Labels use `label-md` in `text-secondary`.

### Status Chips
- Small, uppercase labels with a `pill` shape.
- Backgrounds are low-opacity versions of semantic colors (e.g., 15% opacity Red for "Danger") with a solid 1px border of the same color.

### Data Lists
- Horizontal dividers should use `border-default`.
- Alternating row colors are not required; use `surface-secondary` on hover to highlight specific data points.

### Video Overlays
- Bounding boxes: 1.5px stroke, no fill.
- Labels for boxes: Solid background of the accent color, `label-md` typography in black/navy for maximum legibility.