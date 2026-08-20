---
name: dsh-project-orchestrator
description: A restrained engineering console for auditable local project orchestration.
colors:
  surface-base: "#ffffff"
  surface-subtle: "#fafafa"
  surface-raised: "#f1f1f2"
  ink-primary: "#18181b"
  ink-secondary: "#52525b"
  ink-caption: "#6b7280"
  border-default: "#d4d4d8"
  border-subtle: "#e5e7eb"
  accent-primary: "#185fa3"
  accent-soft: "#eef5fb"
  success: "#11643b"
  success-soft: "#e6f5eb"
  warning: "#855900"
  warning-soft: "#fbf0cf"
  danger: "#a12929"
  danger-soft: "#fbe8e8"
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "normal"
  heading:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "normal"
  body:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  xxl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.ink-primary}"
    textColor: "{colors.surface-base}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  button-secondary:
    backgroundColor: "{colors.surface-base}"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "36px"
  input:
    backgroundColor: "{colors.surface-base}"
    textColor: "{colors.ink-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "38px"
  panel:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.ink-primary}"
    rounded: "{rounded.lg}"
    padding: "16px"
---

## Overview

The visual north star is an engineering console: familiar, quiet, and exact. The interface should disappear into project work, using Harness-provided tokens wherever available and the documented values only as resilient fallbacks. Layout density is purposeful rather than compressed; important actions and durable facts receive clear hierarchy without decorative spectacle. Responsive behavior is structural: sidebars collapse, forms become one column, and touch controls reach at least 44px on mobile.

## Colors

The palette is restrained and neutral. Base, subtle, and raised surfaces establish hierarchy; borders separate regions without card-heavy decoration. The primary accent is reserved for current selection, focus, information, and deliberate primary actions. Success, warning, and danger colors always appear with text or icon meaning so color is never the only status signal. Body and helper copy must maintain WCAG 2.2 AA contrast against their surface.

## Typography

Use one system sans family across product UI. Hierarchy comes from weight and a compact fixed scale, not display typography or fluid headings. Project names may use the display token; dialogs and section headings use heading; controls and status labels use label. Paths, commands, IDs, hashes, and evidence use mono. Human-facing prose should remain within roughly 68–72 characters per line where the layout permits.

## Elevation

Depth comes primarily from background layers and one-pixel borders. Standard pages, forms, cards, and context panels stay visually flat. Menus, dialogs, and transient feedback may use a restrained shadow because they genuinely float above the workbench. Avoid persistent card shadows, glass effects, gradients, or decorative glow.

## Components

Buttons, fields, and selectable controls use the existing 6px radius and shared focus-visible treatment. Every interactive control needs default, hover, focus, active, disabled, and loading behavior. Mode selection should use semantic radio controls presented as two concise selectable panels, with consequence-focused copy and a visible selected state. Directory paths remain selectable and copyable; the adjacent open action has a text label on spacious layouts, an accessible name in compact layouts, and a 44px mobile target. Empty states teach the next useful action instead of merely reporting absence.

## Do's and Don'ts

- Do keep AI planning an explicit user choice and explain when repository reading begins.
- Do keep commands, paths, IDs, and code symbols exact even in Chinese interfaces.
- Do preserve familiar form, radio, button, menu, and dialog affordances.
- Do use progressive disclosure for optional technical constraints.
- Do provide keyboard navigation, visible focus, Escape behavior, and reduced-motion support.
- Don't turn project creation into a chat flow or silently invoke automation.
- Don't add decorative gradients, oversized typography, excessive pills, or novelty icons.
- Don't place generic arbitrary-path actions in the client; directory actions operate only on persisted Project data.
- Don't use color alone to communicate selection, status, success, or failure.
