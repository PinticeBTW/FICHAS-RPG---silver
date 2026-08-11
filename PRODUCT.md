# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

RPG players and the Game Master.

Players manage their characters and use VEIL OS to interact with New Vega's fictional digital world through social, news, identity, and future contextual/NPC systems.

The Game Master manages the RPG world, characters, and NPCs; controls fictional personas; publishes THE NET content; influences events; and will eventually use a GM-only control layer.

## Product Purpose

RPGSILVER is both an RPG management platform and an immersive diegetic interface. It makes New Vega's digital ecosystem a playable part of the game: players can use applications, create in-world accounts, communicate with characters, discover lore, investigate events, read news, and experience story consequences through THE NET.

## Positioning

RPGSILVER turns the game's digital world into an interactive system rather than treating it as static setting material or a character-sheet companion alone.

## Operating Context

VEIL OS is New Vega's closed civic operating environment, backed by the locally controlled VEGA MESH. It provides desktop space, wallpaper, windows, launcher, taskbar, system tools, and application installation. Individual applications provide distinct in-world interaction modes. The long-term platform also includes privileged GM controls for the digital world.

VEGA MESH is distributed across secure city and district nodes. It provides resilient local routing, encrypted realtime communications, authentication, identity and application trust; compromised nodes can be isolated, and local service continues when external network links are unavailable.

## Capabilities and Constraints

- React and TypeScript are the application stack.
- Existing architecture should be extended rather than duplicated with parallel systems.
- Player-specific wallpaper, window layout, installed applications, and future app accounts must remain isolated per authenticated user.
- Shared fictional people, organisations, districts, locations, and events should increasingly reference the Shared World Core rather than introducing conflicting records.
- GM capabilities must be explicit privileged persona/control systems, never unsafe impersonation through player authentication credentials.
- Existing functionality and user flows must not be sacrificed for visual polish.

## Brand Commitments

- The product should feel intentionally authored, never like generic AI-generated SaaS.
- VEIL OS must behave like a believable operating system, not merely resemble one.
- Wallpaper and desktop space remain important parts of the experience.
- Windows, launcher, taskbar, system tools, and future Net Store share a coherent OS language.
- Individual applications retain their own identities: ECHO is emotional, contextual, spatial, and Resonance-focused; PULSE is fast, public, coral/red, and Heat-focused; IDEN is clinical cold-blue institutional identity and trust; NVN is restrained-teal independent newsroom; LOOP is energetic magenta creator/music culture.
- Avoid unnecessary interface elements, excessive cards or glass effects, gratuitous gradients/neon, repetitive bento layouts, generic oversized hero typography, and decoration without purpose.

## Evidence on Hand

- Existing React application and VEIL OS implementation in `src/`.
- Existing New Vega application surfaces: ECHO, PULSE, IDEN, NVN, wallpaper settings, Window Manager V2, and Launcher V1.
- No external testimonials, benchmarks, or product claims should be fabricated.

## Product Principles

1. Make the fictional world operational, not merely visible.
2. Preserve distinct application identities within one coherent operating system.
3. Favor deliberate hierarchy and one dominant idea over ornamental interface density.
4. Keep player data isolated and GM authority explicit.
5. Build systems that can grow through shared canonical world data without breaking current play.

## Accessibility & Inclusion

Maintain responsive behavior, keyboard access, visible focus states, and reduced-motion support.
