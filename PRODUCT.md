# Product

## Register

product

## Users

Developers and technical maintainers who run DeepSeek Harness on their own workstation and need to organize real repositories, requirements, tasks, execution evidence, and human approvals in one durable workspace. They may use AI planning for delivery work, but they also need lightweight empty Projects for organizing context before any task exists.

## Product Purpose

dsh-project-orchestrator provides an auditable local project workbench inside an existing Harness Web installation. It separates project organization, AI planning, approval, execution, verification, and review so each action is explicit and recoverable. Success means users can create the right amount of structure for the work at hand, understand what AI will do before it runs, and move from a Project directory to the underlying local workspace without weakening the loopback security boundary.

## Brand Personality

Professional, restrained, and trustworthy. The product should read like an engineering workbench: concise Chinese-first copy, precise status language, and calm guidance that explains consequences without marketing claims or chatbot theatrics.

## Anti-references

- Project creation flows that silently invoke AI, imply every Project needs automatic decomposition, or make opting out feel secondary.
- Chat-first interfaces that hide durable project state behind a conversation.
- Decorative SaaS dashboards that prioritize visual novelty over repository paths, approval facts, task state, and execution evidence.
- IDE-density layouts that expose every technical field at once instead of using purposeful progressive disclosure.

## Design Principles

1. Make automation an explicit choice. Creating a Project and asking AI to decompose work are separate user intentions, even when offered in one form.
2. State consequences before actions. Users should know when planning reads a repository, replaces tasks, invalidates approval, or opens a local directory.
3. Preserve durable facts. Project, task, approval, execution, and evidence state remain visible and recoverable across restarts.
4. Keep local actions narrow. Host capabilities such as opening a directory must validate persisted Project data and never become arbitrary command execution.
5. Prefer Chinese clarity while preserving technical identity. Human-facing explanations use concise Simplified Chinese; commands, paths, identifiers, and code symbols remain exact.

## Accessibility & Inclusion

Target WCAG 2.2 AA for new and changed interfaces. Preserve keyboard navigation, visible focus, semantic labels, sufficient contrast, and reduced-motion behavior. Error and status meaning must not depend on color alone. Long repository paths must remain readable, copyable, and operable without requiring precise pointer input.
