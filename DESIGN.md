---
name: Website Inspo Library
description: A curated, filterable library of website designs that doubles as an agent-readable memory.
colors:
  paper: "#F2EFE6"
  paper-raised: "#FAF8F2"
  ink: "#17150F"
  ink-soft: "#6B6455"
  rule: "#D8D2C2"
  ink-minium: "#B4471C"
  ink-viridian: "#2C6551"
  ink-ultramarine: "#2B4A87"
  ink-rose-madder: "#93325A"
  ink-violet: "#5E4491"
  ink-ochre: "#7C5A10"
  ink-cerulean: "#24657F"
  ink-oxide: "#7A3A2A"
typography:
  display:
    fontFamily: "Libre Caslon Display, Georgia, serif"
    fontSize: "clamp(2rem, 4vw, 2.75rem)"
    fontWeight: 400
    lineHeight: 1.02
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Libre Caslon Display, Georgia, serif"
    fontSize: "1.625rem"
    fontWeight: 400
    lineHeight: 1.05
    letterSpacing: "normal"
  title-sm:
    fontFamily: "Libre Caslon Display, Georgia, serif"
    fontSize: "22px"
    fontWeight: 400
    lineHeight: 1.05
    letterSpacing: "normal"
  title-xs:
    fontFamily: "Libre Caslon Display, Georgia, serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: "normal"
  tab:
    fontFamily: "Libre Caslon Display, Georgia, serif"
    fontSize: "20px"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "normal"
  body:
    fontFamily: "Sometype Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "Sometype Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "0.12em"
  meta:
    fontFamily: "Sometype Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: "0.02em"
rounded:
  none: "0px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "40px"
  xxl: "64px"
components:
  chip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "10px 14px"
    typography: "{typography.label}"
  chip-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.none}"
    padding: "10px 14px"
    typography: "{typography.label}"
  tag:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.none}"
    padding: "6px 10px"
    typography: "{typography.meta}"
  card:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0px"
  button-copy:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "8px 12px"
    typography: "{typography.label}"
  button-copy-done:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.none}"
    padding: "8px 12px"
    typography: "{typography.label}"
  inspector-panel:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0px"
  inspector-field:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "3px 0px"
    typography: "{typography.meta}"
---

# Design System: Website Inspo Library

## Overview

**Creative North Star: "The Pressroom Index"**

This is printed matter that happens to be running in a browser. Warm off-white stock, ink that was never quite black, hairline rules that look ruled rather than drawn, and a monospaced apparatus doing all the labelling — counts, tags, indices, field names. Against that apparatus, one high-contrast serif carries the entry titles, and the difference between the two voices is the whole typographic idea: the serif names things, the mono measures them.

The density is deliberate and slightly higher than comfortable. This is an index, not a moodboard — it should feel like a working document that has been set properly, not a gallery that has been art-directed. Every number on the page is real and recomputes: the chip counts, the `NN / TT` index, the tag overflow. Nothing is decorative typography pretending to be data.

Color is almost entirely absent from the chrome, because the chrome is competing with 28 screenshots that each arrive with their own palette and will always win. The single exception is the group ink system: each design group owns one saturated printing ink, and that ink is the only chroma the interface itself is permitted. It does structural work — identifying a group at a glance across the whole grid — and it never decorates.

**Key Characteristics:**
- Warm paper ground, never white, never cream-sweet
- Zero border radius anywhere; printed matter has cut edges
- Monospace for all apparatus, high-contrast serif for all names
- Flat by default: depth comes from border weight and tonal layering, not shadow
- One saturated ink per group, used structurally and sparingly

## Colors

A neutral warm-paper system with a functional eight-ink accent palette borrowed from spot printing inks.

### Primary

- **Group Inks** (eight values, `ink-minium` through `ink-oxide`): The functional accent palette. Each design group is permanently assigned one ink at creation. That ink appears in exactly three places: the group's diamond marker, the fill of its chip when active, and the group label on its cards. Assigning a ninth group cycles back to the first. These are chosen as printing inks — dense, slightly dirty, never fluorescent — so they sit on paper rather than glowing on top of it.

### Neutral

- **Paper** (`#F2EFE6`): The page ground. A warm off-white with a faint grey cast, closer to uncoated book stock than to cream. Also the resting fill of chips and tags, so unselected controls read as cut from the page itself.
- **Raised Paper** (`#FAF8F2`): Card and overlay surfaces. Two steps lighter than the ground — enough to lift a card without a shadow, not enough to read as white.
- **Ink** (`#17150F`): All primary text, all strong borders, and the fill of the active `ALL` chip. A warm near-black; pure `#000` is banned.
- **Soft Ink** (`#6B6455`): Descriptors, tag text, counts, field labels, and every piece of secondary apparatus. Warm grey, deliberately low-contrast against ink so hierarchy reads without size changes.
- **Rule** (`#D8D2C2`): Hairline borders, dividers, and tag outlines. Always exactly 1px.

### Named Rules

**The Screenshot Owns The Color Rule.** Saturated color in the chrome is reserved for group inks. Everything else is paper, ink, soft ink, and rule. If a new UI element needs a color to be understood, it needs better typography instead.

**The Warm Neutral Rule.** No neutral in this system is chromatically neutral. Every grey and every black carries a yellow-red cast. A cool grey anywhere on the page is a bug.

## Typography

**Display Font:** Libre Caslon Display (with Georgia, serif)
**Label/Mono Font:** Sometype Mono (with ui-monospace, SFMono-Regular, Menlo, monospace)

**Character:** A high-contrast editorial serif doing nothing but naming things, against a mono that handles every other word on the page. There is no third voice and no sans-serif anywhere. Both faces load from Google Fonts with system fallbacks that hold the layout intact offline.

### Hierarchy

- **Display** (400, `clamp(2rem, 4vw, 2.75rem)`, 1.02): Masthead, detail-overlay entry titles, the studio viewer's variant title, and the final design's name.
- **Title** (400, 26px, 1.05): Card titles in the grid, and studio step names at 1.625rem. Set tight; these are names, not headlines.
- **Title SM** (400, 22px, 1.05): Variant titles on studio comparison tiles. A tile is a card at roughly two-thirds width, and 26px crowds a two-line generated title at that size.
- **Title XS** (400, 15px, 1.15): Reference-card titles in the studio's selected-references strip. Those cards run 180px wide; this is the smallest size at which the serif still reads as a name rather than as decoration.
- **Tab** (400, 20px, 1): The Library / Studio navigation. Sits between Title and Title SM because a tab names a whole surface but must not outweigh the masthead above it.
- **Body** (400, 13px, 1.6): Recipe, copy brief, and prompt text in the detail overlay. Capped at 68ch.
- **Label** (500, 11px, uppercase, 0.12em): Chip labels, field names, button text, section marks. The tracking is what makes mono read as apparatus rather than as code.
- **Meta** (400, 12px, 0.02em): Tags, descriptors, counts, indices.

### Named Rules

**The Two Voices Rule.** The serif names, the mono measures. A title is never mono; a count, tag, label, or index is never serif. There is no third typeface.

**The Brief Is Prose Rule.** Every input in the library is a field and is set in mono. The studio's brief is the one exception: it is a sentence a person writes, not a value they enter, so it is set in the serif. Nothing else that accepts typing may be.

**The Tabular Figure Rule.** Every number in the interface uses `font-variant-numeric: tabular-nums`. Counts and indices change constantly as filters apply, and columns must not jitter.

## Layout

A single centered column capped at 1600px with 24px gutters, widening to 40px above 900px. The grid is a plain 3-column CSS grid above 1200px, 2 columns above 760px, and 1 column below, with a uniform 24px gap — never masonry, because equal-height cards let the eye compare treatments across a row.

Vertical rhythm runs on an 8px base with named steps (4 / 8 / 16 / 24 / 40 / 64). Headings always carry more space above than below. The masthead, the chip bar, and the grid are each separated by a full-width hairline rule rather than by space alone, which is what makes the page read as a ruled document.

The studio's comparison board is a plain 2-column grid above 900px and 1 column below — never four across. Four tiles at this page width would be 380px each, too small to judge a landing page by, which is the only thing they exist for.

The chip bar wraps freely to as many rows as it needs and never scrolls horizontally; seeing every group at once is the point of the bar. Below `700px` chip padding and tracking tighten so the bar costs less vertical space, but it still wraps rather than scrolls.

Card captions push their footer down with `margin-top: auto`, so group labels and indices align across a row regardless of how many rows of tags each card carries. Descriptors set `text-wrap: balance` to stop two-line descriptors orphaning their last word.

## Elevation & Depth

Flat by default. There are no shadows on cards, chips, tags, or buttons at any state. Depth is created by exactly two devices: a 1px border in either rule or ink weight, and the two-step tonal lift from paper to raised paper.

The only exceptions are the two modal surfaces — the detail overlay and the studio viewer — which sit above a translucent ink scrim and carry one ambient shadow to separate them from the page beneath.

### Shadow Vocabulary

- **Overlay** (`box-shadow: 0 24px 80px rgba(23, 21, 15, 0.28)`): The detail overlay and the studio viewer. Never used on anything that is not modal.

### Named Rules

**The Flat Page Rule.** If an element needs a shadow to be legible, its border weight is wrong. Hover states change border color and tonal value, never elevation.

## Shapes

Border radius is `0` on every element without exception — cards, chips, tags, buttons, inputs, images, the overlay. Corners are cut, not rounded.

The one recurring non-rectangular form is the **group diamond**: a 6px square rotated 45°, filled with the group ink, that marks a group label anywhere it appears. It is the only ornament in the system, and it earns its place by carrying color that is otherwise absent.

Borders are always exactly 1px. Weight is expressed through color (rule vs. ink), never through thickness.

## Components

### Chips (group filters)

- **Character:** Cut from the page, not placed on it.
- **Style:** Paper fill, 1px ink border, square corners, label typography, 10px/14px padding. Label and count sit on one line with the count in soft ink.
- **Active:** Fill inverts to the group's ink (or to ink for `ALL`), text to paper, count to paper at 60% opacity.
- **Hover:** Background shifts to raised paper; border stays. No movement, no shadow.
- **Focus:** 2px ink outline offset 2px.

### Tags

- **Style:** Paper fill, 1px rule border, soft ink text, meta typography, 6px/10px padding.
- **Overflow:** Cards show the first three tags plus a `+N` control. `+N` is a real button that expands the full set in place; it is not a label.

### Cards

- **Corner Style:** Square (0).
- **Background:** Raised paper.
- **Border:** 1px rule at rest, 1px ink on hover.
- **Shadow:** None at any state (see Elevation).
- **Structure:** Screenshot fills a fixed 4:3 area anchored to the top edge so hero compositions read correctly; a caption block below carries title and descriptor on one line, tags beneath, and a footer row with the group diamond plus group name on the left and the `NN / TT` index on the right.
- **Internal Padding:** 16px on the caption block; the image bleeds to the card edge.

### Inputs

- **Style:** Transparent fill, 1px rule bottom border only, meta typography, no top/side borders.
- **Focus:** Bottom border thickens to ink; no glow, no ring shift.
- **Placeholder:** Soft ink.

### Copy Buttons

- **Character:** The signature interaction; this library exists to hand text to the clipboard.
- **Style:** Paper fill, 1px ink border, label typography.
- **Done state:** The button inverts to ink fill with paper text and the label changes to `COPIED`, holding for 1.4s before returning. The state is expressed in the system's own vocabulary — no toast, no floating notification, no icon.

### Detail Sheet

- **Character:** A working document opened on the desk, not a lightbox.
- **Shape:** Square (0), 1px ink border, raised paper, capped at `1240px` and at
  the viewport height less one gutter. The only element in the system carrying a
  shadow.
- **Split:** Above `1000px` the body becomes two columns — plate and tags on the
  left, artifacts and actions on the right — with the left column `sticky` at
  `top: 0`. This exists so no copy button is ever below the fold: the sheet's job
  is handing text to the clipboard, and scrolling past a full-height screenshot
  to reach it was the version this replaced.
- **Single column:** Below `1000px` the plate caps at `58vh` with
  `object-fit: cover` anchored top, for the same reason.
- **Close:** A 44px square straddling the top-right corner at `-1px` inset, so it
  reads as cut into the sheet's edge rather than floating on it. Inverts to ink
  on hover. `Esc` and a backdrop click also close.

### Tabs (Library / Studio)

- **Character:** A running head, not a control. Tabs name surfaces; chips filter
  contents. Giving them the naming voice is what keeps the two from reading as
  the same thing when they sit 24px apart.
- **Style:** Serif at the Tab step, no box, no fill. Soft ink at rest, ink when
  selected, with a 1px ink underline under the selected label only.
- **Rule:** That underline sits 12px clear of the full-width rule beneath the
  bar. Two parallel hairlines is the mark; a single thickened one is a bug.

### Variant Tile (Studio)

- **Character:** A plate you judge a whole page by, so the preview is the
  content and everything else is caption.
- **Structure:** A head carrying the variant letter and its state, a 16:10 plate,
  then a caption with the page's own title, its world in one line, and the
  actions.
- **Preview:** An iframe rendered at 1440px and scaled down to fit, never
  reflowed into the tile's width. A squeezed preview is a lie about the design
  being picked.
- **States:** Rule border at rest, ink on hover and when picked, dashed soft-ink
  when the variant failed. Two across, never four — see Layout.
- **Waiting:** No spinner. A 1px soft-ink hairline passes down the empty plate
  over 2600ms. The page's own ruling, moving.

### Reference Card (Studio)

- **Style:** A miniature of the grid card — 4:3 plate, hairline border, serif
  name at Title XS over a two-line clamped descriptor.
- **Remove:** A 26px square straddling the top-right corner at `-1px`, matching
  the detail sheet's close control. Hidden until hover or focus.

### Viewer (Studio)

- **Character:** The generated page opened full-bleed for a real look, with just
  enough apparatus above it to decide.
- **Shape:** Square, 1px ink border, viewport less one gutter in both axes. The
  second and last element in the system permitted the overlay shadow.
- **Structure:** Header (variant letter, page title at Display, world line, pick
  and open actions), then the variant's own influence record, then the frame.

### Workspace Bar (Studio)

- **Character:** One 44px ruled bar over a full-bleed page, and nothing else.
  The workspace exists to give a generated design the whole window, so its
  chrome earns its height or it does not appear.
- **Split:** what you are looking at on the left — reload, the page switcher,
  the design's name in soft ink — and what you are doing to it on the right:
  zoom, comment, present, edit. Nothing sits in the middle.
- **Controls:** 26px tall, paper fill, 1px rule border, label typography. The
  border goes to ink on hover; an active or open control inverts to ink fill,
  the same state vocabulary as chips.
- **Icons:** 13px, 1.3px stroke, `currentColor`, so they invert with their
  button. Dropdown carets are 9px chevrons drawn as SVG, never a text glyph —
  the system's two faces are not icon fonts.
- **Menus:** raised paper, 1px ink border, square, hard against the button
  below a 6px gap. Items are label typography on the left with a soft-ink note
  on the right — the page's own title, what a present mode will do. The current
  item inverts.
- **Presenting:** the bar and the inspector are removed outright, not faded or
  slid away, and a single ink-filled hint names the way back for 2.2s. A design
  being presented has no chrome at all.
- **Comment pins:** a 20px ink square carrying the comment's number, straddling
  the top-left corner of the element it marks so it never covers it — the same
  `-10px` corner idiom as the sheet's close control. Pins show whenever the
  page is being looked at and disappear while presenting.

### Inspector Panel (Studio)

- **Character:** Apparatus, not a tool palette. It is the same ruled document as
  the rest of the interface, stood on its end beside the page it measures.
- **Dock, not float:** 320px pinned to the viewer's right edge with a 1px ink
  border, taking its width from the frame rather than covering it. A panel that
  floats over the design being judged is a panel spent being dragged. Below
  `900px` it moves under the frame and caps at 46% of the height.
- **Minimised:** collapses to its head, leaving a labelled rail.
- **Groups:** Type, Colour, Space, Motion, Words, each a hairline-ruled block
  with its name in label typography at full ink.
- **Fields:** the system's input — transparent, 1px rule under it only, meta
  typography. Field names take the label step and separate from the group names
  above them by tonal value, not by size.
- **Placeholder is the page, value is you.** A field's placeholder is the
  element's computed value in soft ink; a value you typed is ink at 500. That
  contrast is the only state a field has, and it is what tells you at a glance
  which properties you have taken over.
- **Colour:** a 20px square swatch beside the value, never a swatch alone. The
  text field accepts any CSS value, so `transparent` and `var(--ink)` stay
  reachable, which a colour picker alone would take away.
- **Selection, drawn in the page:** 1px ink outline with a paper halo so it
  reads on any ground the generator invented, and an ink badge naming the
  element in label typography. Hover is the same rectangle in a dashed hairline.

### Signature Component: The Group Diamond

A 6px ink-filled square rotated 45°, always followed by the group name in label typography. It appears on every card footer, in the detail overlay header, and inside active chips. It is the system's only ornament and the only place group ink touches the page outside of chip fills.

## Do's and Don'ts

### Do:

- **Do** keep border radius at `0` on every element, without exception.
- **Do** give every group exactly one ink and reuse it in all three sanctioned places.
- **Do** use `tabular-nums` on every number that can change.
- **Do** express hover as a border-color and tonal change only.
- **Do** let the screenshot bleed to the card's edge; the image is the content, the caption is the apparatus.
- **Do** keep the chip bar fully visible and wrapping, never horizontally scrolling.

### Don't:

- **Don't** introduce a sans-serif. The system has exactly two faces.
- **Don't** add a shadow to any element except the detail overlay.
- **Don't** use pure white (`#FFF`) or pure black (`#000`) anywhere.
- **Don't** use a chromatically neutral grey; every neutral carries a warm cast.
- **Don't** let group ink touch body text, borders, or backgrounds outside the three sanctioned uses.
- **Don't** replace the grid with masonry; equal-height rows exist so treatments can be compared across a row.
- **Don't** show copy confirmation as a toast or floating notification.
