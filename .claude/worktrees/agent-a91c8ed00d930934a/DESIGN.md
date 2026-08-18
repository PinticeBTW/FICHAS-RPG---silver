---
name: RPGSILVER
description: New Vega's playable public-grid interface and RPG operations platform.
colors:
  void-990: "#050505"
  void-960: "#090909"
  void-930: "#101010"
  void-900: "#141414"
  acid-500: "#f3e600"
  acid-400: "#fff05f"
  signal-blue: "#53b5ff"
  signal-red: "#ff5468"
  signal-gray: "#9ca3b2"
  paper: "#f5f1d6"
typography:
  display:
    fontFamily: "Teko, sans-serif"
    fontSize: "2.15rem"
    fontWeight: 600
    lineHeight: 0.92
    letterSpacing: "0.05em"
  body:
    fontFamily: "Archivo, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
  label:
    fontFamily: "JetBrains Mono, monospace"
    fontSize: "0.68rem"
    fontWeight: 600
    letterSpacing: "0.28em"
rounded:
  micro: "0.22rem"
  control: "8px"
  window: "16px"
  panel: "28px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.acid-500}"
    textColor: "{colors.void-960}"
    typography: "{typography.display}"
    padding: "0.625rem 1rem"
  input-default:
    backgroundColor: "rgba(4, 4, 4, 0.9)"
    textColor: "{colors.paper}"
    padding: "0.625rem 1rem"
  window-shell:
    backgroundColor: "rgba(15, 11, 21, 0.95)"
    textColor: "#f4f6fa"
    rounded: "{rounded.window}"
  taskbar:
    backgroundColor: "rgba(7, 9, 13, 0.86)"
    rounded: "13px"
---

# Design System: RPGSILVER

## Overview

**Creative North Star: "VEIL OS // New Vega Civic System"**

RPGSILVER is a dark, authored civic interface for a fictional city. Its shared shell reads as durable public infrastructure: precise, institutional, and slightly industrial. The experience earns immersion through information hierarchy, spatial behavior, and material contrast—not generic cyberpunk ornament.

VEIL OS keeps the desktop and wallpaper open and breathable. The taskbar, launcher, application windows, dialogs, and snap previews are the moments allowed to separate from that field. VEGA MESH appears through restrained local-authority and secure-node status language, while individual applications retain their own editorial and emotional vocabulary inside this common operating frame.

**Key Characteristics:**

- Void-black infrastructure with acid-yellow signal color and restrained operational blue/red status accents.
- Teko display headings, Archivo body copy, and JetBrains Mono for labels, metadata, and system language.
- Thin borders, compact controls, explicit state changes, and a practical rather than decorative density.
- Depth reserved for active or floating hierarchy; default surfaces stay materially quiet.
- Distinct application identities without a flattened component language.

## Colors

The base palette is near-black and paper-toned; color is a signal with a job, not a pervasive ambient effect.

### Primary

- **Public Grid Acid** (`#f3e600`): primary confirmation, action, active navigation, and network signal.
- **Acid Highlight** (`#fff05f`): bright secondary emphasis and short-lived interaction detail.

### Secondary

- **Verification Blue** (`#53b5ff`): identity, trusted state, structured information, and technical confirmation.
- **Signal Red** (`#ff5468`): danger, destructive action, high-alert status, and PULSE's public urgency.

### Tertiary

- **System Gray** (`#9ca3b2`): restrained operational metadata and secondary status language.

### Neutral

- **Deep Void** (`#050505`, `#090909`, `#101010`, `#141414`): the four-step structural field for roots, panels, and nested surfaces.
- **Public Paper** (`#f5f1d6`): warm off-white text and document-like contrast against the void.

**The Signal, Not Scenery Rule.** Acid, blue, red, and app accents must explain hierarchy, state, ownership, or action. Do not spray them across a surface as atmosphere.

## Typography

**Display Font:** Teko, sans-serif

**Body Font:** Archivo, sans-serif

**Label/Mono Font:** JetBrains Mono, monospace

**Character:** Teko supplies compressed civic-scale authority; Archivo keeps long-form information readable; JetBrains Mono makes system state, labels, and audit-like metadata feel operational. Headings are uppercase, tight, and deliberate rather than oversized generic hero copy.

### Hierarchy

- **Display** (600, `2.15rem`, `0.92`): primary system and sheet titles; uppercase with `0.05em` tracking.
- **Headline** (600, application-defined, `0.92`): application section titles using the same display voice.
- **Title** (500, `1.18rem`, `1`): compact secondary headings and sheet subtitles.
- **Body** (400, `1rem`): readable narrative, form copy, and editorial content in Archivo.
- **Label** (600, `0.68rem`, `0.28em`): uppercase controls, metadata, and system labels in JetBrains Mono; application shells may use smaller mono metadata where density requires it.

**The Three Voices Rule.** Use display for hierarchy, body for reading, and mono for system grammar. Do not make every sentence look like a terminal label.

## Layout

The application uses full-height, responsive web workspaces. VEIL OS is spatially organized around an open desktop: fixed top system bar, bottom taskbar, free window field, and protected usable bounds for floating windows. Desktop windows use controlled geometry; narrow screens collapse them into the usable workspace rather than simulating desktop manipulation on a phone.

Spacing is compact and modular, with recurring 6px, 8px, 12px, 16px, and 24px intervals. Dense operational controls may use 10px/14px increments. Two-column launcher and application layouts become single-column at the existing narrow-screen breakpoint. Preserve readable scroll regions and avoid horizontal overflow.

## Elevation & Depth

Depth is mostly flat by default. Borders, tonal separation, and grid/line texture establish ordinary structure; controlled shadows, translucency, backdrop blur, and sparse glow appear only when a surface is active or floating: HUD panels, application windows, taskbar, launcher, dialogs, and snap previews.

### Shadow Vocabulary

- **HUD lift** (`0 24px 60px rgba(0, 0, 0, 0.36)`): active authored panel with a quiet inset highlight.
- **Window lift** (`0 30px 90px rgba(0, 0, 0, 0.55)`): movable OS application hierarchy.
- **Taskbar lift** (`0 18px 60px rgba(0, 0, 0, 0.46)`): persistent shell separation above the desktop.
- **Launcher lift** (`0 26px 80px rgba(0, 0, 0, 0.56)`): temporary OS-shell focus.

**The State-Only Depth Rule.** Do not make every panel float, glow, blur, or look like glass. Elevation must communicate active hierarchy or a temporary system layer.

## Shapes

The shared system frame favors thin 1px strokes, near-rectangular controls, and restrained corner radii. Small controls generally use 6–9px radii; taskbar and window shells use 13–16px; the authentication HUD panel is the deliberate 28px exception. Some management surfaces use clipped technical corners and line-based framing. Avoid generic pill proliferation and soft rounded-card bento layouts.

## Components

### Buttons

- **Character:** explicit, tactile state controls rather than decorative calls to action.
- **Primary:** `signal-button` uses Public Grid Acid on void text, Teko uppercase type, and `0.625rem 1rem`-scale padding.
- **Hover / Focus:** compact `translateY(-1px)` lift or border/background shift over 140–180ms; focus uses visible border/ring treatment.
- **Ghost / Danger:** ghost controls use thin white strokes and quiet translucent fill; danger controls switch to Signal Red without pretending to be primary confirmation.

### Cards / Containers

- **Corner Style:** 8–16px for OS components; 28px only for the authored HUD/auth panel.
- **Background:** void-tonal layers with low-opacity borders; use transparent/tonal surfaces before adding another card.
- **Shadow Strategy:** flat at rest; reserve lift for active/floating shells.
- **Border:** 1px, typically low-opacity white, acid, or app-accent stroke.

### Inputs / Fields

- **Style:** `input-shell` is a dark fill with a thin acid-derived border and paper text.
- **Focus:** border strengthens and adds a tight 1px acid ring; search fields in VEIL OS use the same principle with their system accent.
- **Error / Disabled:** error uses Signal Red; disabled controls reduce opacity and remove action affordance.

### Navigation

- **Shell navigation:** desktop applications are entered through icons, taskbar controls, and the launcher; running state is explicit.
- **Window chrome:** title bars are tactile drag surfaces with labeled minimize, maximize/restore, and close controls.
- **Responsive behavior:** taskbar remains reachable; launcher becomes a constrained floating panel; windows become workspace-filling on narrow screens.

### VEIL OS Shell

The shell is infrastructure, not another app. Preserve open wallpaper space, compact mono labels, a fixed taskbar, and geometry-aware application windows. ECHO, PULSE, IDEN, NVN, and future LOOP may diverge in app-level color, rhythm, and content treatment while retaining this operating-system contract.

## Do's and Don'ts

### Do:

- **Do** preserve VEIL OS as an open desktop with purposeful floating system layers.
- **Do** use Public Grid Acid, Verification Blue, Signal Red, and app accents to explain state, authority, or interaction.
- **Do** maintain the display/body/mono hierarchy and compact operational label language.
- **Do** let individual VEIL OS applications retain meaningful visual identities.
- **Do** preserve responsive, keyboard-accessible, focus-visible, and reduced-motion behavior.

### Don't:

- **Don't** flatten ECHO, PULSE, IDEN, NVN, or LOOP into the same component language.
- **Don't** cover every surface with cards, blur, glow, gradients, or decorative neon.
- **Don't** turn the desktop into a dense dashboard or sacrifice wallpaper and breathing room for unused widgets.
- **Don't** add generic SaaS bento layouts, oversized hero typography, or decoration without an operational purpose.
- **Don't** use elevated/glass surfaces where no active hierarchy or state transition exists.
