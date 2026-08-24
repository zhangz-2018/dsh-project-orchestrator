export const styles = `
.po-launcher {
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  cursor: pointer;
}
.po-launcher:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.po-launcher:active { background: var(--dsw-alias-interactive-bg-active); }
.po-launcher:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #2563eb); outline-offset: 2px; }
.po-launcher-wide { width: 100%; justify-content: flex-start; gap: 10px; padding: 0 10px; font: var(--dsw-font-s-14); }
.po-workbench {
  --po-accent: var(--dsw-alias-state-business-primary, #185fa3);
  --po-accent-surface: var(--dsw-alias-state-business-tertiary, #e5f1f8);
  --po-accent-ink: #0e6098;
  --po-success: var(--dsw-alias-state-success-primary, #168348);
  --po-success-surface: var(--dsw-alias-state-success-tertiary, #e6f5eb);
  --po-success-ink: #11643b;
  --po-warn: var(--dsw-alias-state-warn-primary, #ca8a04);
  --po-warn-surface: var(--dsw-alias-state-warn-tertiary, #fbf0cf);
  --po-warn-ink: #855900;
  --po-error: var(--dsw-alias-state-error-primary, #bd3f3f);
  --po-error-surface: color-mix(in srgb, var(--dsw-alias-state-error-primary, #bd3f3f) 11%, var(--dsw-alias-bg-layer-1, #fbe8e8));
  --po-error-ink: #a12929;
  --po-on-solid: var(--dsw-alias-label-primary-foreground, #fff);
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: auto;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: 224px minmax(0, 1fr);
  overflow: hidden;
  background: var(--dsw-alias-bg-base, #fff);
  color: var(--dsw-alias-label-primary, #18181b);
  font-family: var(--dsw-font-family, ui-sans-serif, system-ui, sans-serif);
  font-size: 14px;
  letter-spacing: 0;
}
body[data-ds-dark-theme] .po-workbench {
  --po-accent-ink: var(--dsw-alias-state-business-primary, #60a5fa);
  --po-success-ink: var(--dsw-alias-state-success-secondary, #4ed17e);
  --po-warn-ink: var(--dsw-alias-state-warn-secondary, #f7ad31);
  --po-error-ink: var(--dsw-alias-state-error-secondary, #f25a5a);
}
.po-workbench *, .po-workbench *::before, .po-workbench *::after { box-sizing: border-box; letter-spacing: 0; }
.po-workbench button, .po-workbench input, .po-workbench textarea, .po-workbench select { font: inherit; color: inherit; }
.po-workbench button:disabled, .po-workbench input:disabled, .po-workbench textarea:disabled, .po-workbench select:disabled { cursor: not-allowed; }
.po-workbench button:not(.po-button):disabled { color: var(--dsw-alias-label-tertiary, #8b8d94); }
.po-workbench button:focus-visible, .po-workbench input:focus-visible, .po-workbench textarea:focus-visible, .po-workbench select:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #2563eb); outline-offset: 2px; }
.po-workbench.po-loading { cursor: progress; }
.po-workbench.po-loading .po-button { pointer-events: none; }
.po-sidebar {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 14px 10px;
  border-right: 1px solid var(--dsw-alias-border-l2, #e5e7eb);
  background: var(--dsw-alias-bg-layer-1, #f7f7f8);
}
.po-sidebar-brand { min-height: 50px; padding: 4px 8px 14px; display: flex; align-items: center; gap: 10px; }
.po-sidebar-brand > div { min-width: 0; display: grid; gap: 2px; }
.po-sidebar-brand strong { overflow: hidden; font-size: 15px; line-height: 20px; text-overflow: ellipsis; white-space: nowrap; }
.po-sidebar-brand span:not(.po-brand-mark) { color: var(--dsw-alias-label-caption, #6b7280); font-size: 11px; }
.po-brand-mark { width: 30px; height: 30px; flex: 0 0 30px; border-radius: 6px; display: grid; place-items: center; color: var(--po-on-solid); background: var(--dsw-alias-button-primary-fill, #1f2937); }
.po-sidebar-section { padding: 18px 10px 8px; color: var(--dsw-alias-label-caption, #6b7280); font-size: 11px; font-weight: 650; text-transform: uppercase; }
.po-sidebar-section-spaced { margin-top: 12px; border-top: 1px solid var(--dsw-alias-border-l2, #e5e7eb); }
.po-side-nav, .po-side-action {
  width: 100%;
  min-height: 40px;
  border: 0;
  border-radius: 6px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--dsw-alias-label-secondary, #52525b);
  background: transparent;
  cursor: pointer;
  text-align: left;
}
.po-side-nav:hover, .po-side-action:hover { color: var(--dsw-alias-label-primary, #18181b); background: var(--dsw-alias-interactive-bg-hover, #e9e9eb); }
.po-side-nav:active, .po-side-action:active { background: var(--dsw-alias-interactive-bg-active, #e4e4e7); }
.po-side-nav[aria-current="page"] { color: var(--dsw-alias-label-primary, #18181b); background: var(--dsw-alias-interactive-bg-active, #e4e4e7); font-weight: 650; }
.po-side-count { margin-left: auto; color: var(--dsw-alias-label-caption, #71717a); font-variant-numeric: tabular-nums; }
.po-sidebar-metric { min-height: 30px; padding: 0 10px; display: flex; align-items: center; justify-content: space-between; color: var(--dsw-alias-label-secondary, #52525b); font-size: 12px; }
.po-sidebar-metric strong { color: var(--dsw-alias-label-primary, #18181b); font-variant-numeric: tabular-nums; }
.po-sidebar-footer { margin-top: auto; padding-top: 10px; border-top: 1px solid var(--dsw-alias-border-l2, #e5e7eb); }
.po-side-action { min-height: 36px; font-size: 12px; }
.po-main { position: relative; min-width: 0; min-height: 0; overflow: hidden; background: var(--dsw-alias-bg-base, #fff); }
.po-page { min-width: 0; min-height: 100%; height: 100%; display: flex; flex-direction: column; overflow: auto; }
.po-page-header {
  min-height: 76px;
  flex: 0 0 auto;
  padding: 14px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  border-bottom: 1px solid var(--dsw-alias-border-l2, #e5e7eb);
  background: var(--dsw-alias-bg-base, #fff);
}
.po-page-heading { min-width: 0; display: flex; align-items: center; gap: 10px; }
.po-page-heading > div { min-width: 0; }
.po-page-heading h1 { margin: 0; overflow: hidden; font-size: 20px; line-height: 26px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.po-page-heading p { max-width: 72ch; margin: 3px 0 0; overflow: hidden; color: var(--dsw-alias-label-secondary, #52525b); font-size: 12px; line-height: 17px; text-overflow: ellipsis; white-space: nowrap; }
.po-page-actions { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; }
.po-project-actions-menu { position: relative; }
.po-project-actions-menu summary { min-height: 36px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l2, #d4d4d8); border-radius: 6px; display: inline-flex; align-items: center; cursor: pointer; color: var(--dsw-alias-label-secondary, #3f3f46); font-size: 12px; }
.po-project-actions-menu summary:hover { color: var(--dsw-alias-label-primary, #18181b); background: var(--dsw-alias-interactive-bg-hover, #f4f4f5); }
.po-project-actions-menu > div { position: absolute; top: calc(100% + 6px); right: 0; z-index: 4; min-width: 130px; padding: 6px; border: 1px solid var(--dsw-alias-border-l2, #d4d4d8); border-radius: 6px; display: grid; gap: 4px; background: var(--dsw-alias-bg-base, #fff); box-shadow: 0 10px 24px rgba(0,0,0,.12); }
.po-project-actions-menu .po-button { justify-content: flex-start; }
.po-project-context-grid { padding: 18px 24px 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.po-context-panel { min-width: 0; padding: 14px; border: 1px solid var(--dsw-alias-border-l2, #e5e7eb); border-radius: 8px; background: var(--dsw-alias-bg-layer-1, #fafafa); }
.po-context-panel .po-section-heading { padding: 0 0 10px; border-bottom: 1px solid var(--dsw-alias-border-l3, #eeeeef); }
.po-context-panel h2 { font-size: 14px; }
.po-inbox-layout { padding: 18px 24px 24px; display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 16px; }
.po-inbox-list { min-width: 0; display: grid; gap: 10px; }
.po-inbox-item { padding: 14px; border: 1px solid var(--dsw-alias-border-l2, #e5e7eb); border-radius: 8px; background: var(--dsw-alias-bg-base, #fff); }
.po-inbox-item-heading { display: flex; justify-content: space-between; gap: 10px; align-items: center; }
.po-inbox-item-heading time { color: var(--dsw-alias-label-caption, #71717a); font-size: 11px; }
.po-inbox-item h2 { margin: 10px 0 4px; font-size: 14px; }
.po-inbox-item p { margin: 0; color: var(--dsw-alias-label-secondary, #52525b); font-size: 12px; line-height: 1.5; white-space: pre-wrap; }
.po-inbox-actions { margin-top: 12px; display: flex; gap: 7px; flex-wrap: wrap; }
.po-status-badge-warning { color: var(--po-warn-ink); background: var(--po-warn-surface); }
.po-workload-panel { align-self: start; padding: 14px; border: 1px solid var(--dsw-alias-border-l2, #e5e7eb); border-radius: 8px; background: var(--dsw-alias-bg-layer-1, #fafafa); }
.po-workload-row { width: 100%; padding: 10px 0; border: 0; border-bottom: 1px solid var(--dsw-alias-border-l3, #eeeeef); display: flex; justify-content: space-between; align-items: center; gap: 12px; color: inherit; background: transparent; cursor: pointer; text-align: left; }
.po-workload-row:last-child { border-bottom: 0; }
.po-workload-row:hover { background: var(--dsw-alias-interactive-bg-hover, #f1f1f2); }
.po-workload-row div { min-width: 0; flex: 1; display: grid; gap: 3px; }
.po-workload-row span { color: var(--dsw-alias-label-secondary, #52525b); font-size: 11px; }
.po-workload-row b { display: grid; justify-items: end; font-size: 12px; font-variant-numeric: tabular-nums; }
.po-workload-row b small { color: var(--dsw-alias-label-caption, #71717a); font-size: 10px; font-weight: 400; }
.po-workload-track { width: 100%; height: 4px; border-radius: 2px; overflow: hidden; background: var(--dsw-alias-border-l2, #e5e7eb); }
.po-workload-track i { height: 100%; display: block; background: var(--po-accent); }
.po-inbox-context { margin-top: 10px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; color: var(--dsw-alias-label-caption, #71717a); font-size: 11px; }
.po-inbox-context button { border: 0; padding: 0; color: var(--po-accent-ink); background: transparent; cursor: pointer; font-weight: 650; }
.po-inbox-context button:hover { color: var(--po-accent); text-decoration: underline; text-underline-offset: 2px; }
.po-inbox-resolution { margin-top: 12px; display: grid; gap: 6px; color: var(--dsw-alias-label-secondary, #52525b); font-size: 11px; }
.po-inbox-resolution textarea { width: 100%; min-height: 64px; border: 1px solid var(--dsw-alias-border-l2, #d4d4d8); border-radius: 6px; padding: 8px 10px; resize: vertical; color: var(--dsw-alias-label-primary, #18181b); background: var(--dsw-alias-bg-base, #fff); }
.po-context-panel p { margin: 2px 0 0; color: var(--dsw-alias-label-secondary, #52525b); font-size: 11px; }
.po-context-row { min-width: 0; padding: 9px 0; display: flex; align-items: baseline; justify-content: space-between; gap: 10px; border-bottom: 1px solid var(--dsw-alias-border-l3, #eeeeef); }
.po-context-row:last-child { border-bottom: 0; }
.po-context-row-button { width: 100%; border-left: 0; border-right: 0; border-top: 0; text-align: left; cursor: pointer; background: transparent; }
.po-context-row-button:hover { background: var(--dsw-alias-interactive-bg-hover, #f1f1f2); }
.po-issue-detail { display: grid; gap: 18px; }
.po-issue-detail section { padding-bottom: 16px; border-bottom: 1px solid var(--dsw-alias-border-l3, #eeeeef); }
.po-issue-detail section:last-child { border-bottom: 0; }
.po-issue-detail h3 { margin: 0 0 9px; font-size: 13px; }
.po-issue-detail h3 small { color: var(--dsw-alias-label-secondary, #52525b); font-weight: 400; }
.po-issue-description { margin: 0; white-space: pre-wrap; color: var(--dsw-alias-label-secondary, #52525b); line-height: 1.55; }
.po-issue-controls { display: flex; align-items: end; gap: 10px; }
.po-issue-controls .po-field { max-width: 220px; }
.po-issue-run-row { padding: 8px 0; display: flex; justify-content: space-between; border-bottom: 1px solid var(--dsw-alias-border-l3, #eeeeef); font-size: 12px; }
.po-issue-comments { display: grid; gap: 8px; margin-bottom: 10px; }
.po-issue-comment { padding: 10px; border-radius: 6px; background: var(--dsw-alias-bg-layer-1, #f7f7f8); }
.po-issue-comment p { margin: 5px 0; white-space: pre-wrap; line-height: 1.45; }
.po-issue-comment time, .po-issue-activity time { color: var(--dsw-alias-label-caption, #71717a); font-size: 11px; }
.po-issue-activity { display: grid; gap: 10px; }
.po-issue-activity > div { padding-left: 10px; border-left: 1px solid var(--dsw-alias-border-l3, #cbd5e1); }
.po-issue-activity span { color: var(--dsw-alias-label-secondary, #52525b); font-size: 11px; font-weight: 650; }
.po-issue-activity p { margin: 3px 0; font-size: 12px; }
.po-context-row strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.po-context-row span, .po-context-empty, .po-context-activity span { color: var(--dsw-alias-label-secondary, #52525b); font-size: 11px; }
.po-context-empty { margin: 12px 0 0; }
.po-context-activity { margin-top: 12px; display: grid; gap: 5px; }
.po-context-activity strong { font-size: 11px; }
.po-icon-button {
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  border: 0;
  border-radius: 6px;
  display: grid;
  place-items: center;
  color: var(--dsw-alias-label-secondary, #52525b);
  background: transparent;
  cursor: pointer;
}
.po-icon-button:hover { color: var(--dsw-alias-label-primary, #18181b); background: var(--dsw-alias-interactive-bg-hover, #f1f1f2); }
.po-icon-button:active { background: var(--dsw-alias-interactive-bg-active, #e4e4e7); }
.po-button {
  min-width: 0;
  min-height: 36px;
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 0 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  color: var(--dsw-alias-label-primary, #18181b);
  background: transparent;
  cursor: pointer;
  font-weight: 600;
  white-space: nowrap;
}
.po-button-sm { min-height: 30px; padding: 0 10px; font-size: 12px; }
.po-workbench .po-button-primary { color: var(--po-on-solid); border-color: var(--dsw-alias-button-primary-fill, #202226); background: var(--dsw-alias-button-primary-fill, #202226); }
.po-workbench .po-button-primary:hover:not(:disabled) { color: var(--po-on-solid); border-color: var(--dsw-alias-button-primary-hover, #34363a); background: var(--dsw-alias-button-primary-hover, #34363a); }
.po-workbench .po-button-primary:active:not(:disabled) { filter: brightness(0.92); }
.po-workbench .po-button-outline { color: var(--dsw-alias-label-primary, #18181b); border-color: var(--dsw-alias-border-l2, #d4d4d8); background: var(--dsw-alias-bg-base, #fff); }
.po-workbench .po-button-ghost { color: var(--dsw-alias-label-primary, #18181b); }
.po-button-outline:hover:not(:disabled), .po-button-ghost:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, #f1f1f2); }
.po-button-outline:active:not(:disabled), .po-button-ghost:active:not(:disabled) { background: var(--dsw-alias-interactive-bg-active, #e4e4e7); }
.po-workbench .po-button:disabled { color: var(--dsw-alias-label-tertiary, #8b8d94); border-color: var(--dsw-alias-border-l1, #dedfe2); background: var(--dsw-alias-button-primary-dimmed, #ececef); cursor: not-allowed; }
.po-button-icon { width: 16px; height: 16px; flex: 0 0 16px; display: grid; place-items: center; }
.po-toolbar {
  min-height: 58px;
  flex: 0 0 auto;
  padding: 9px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid var(--dsw-alias-border-l2, #e5e7eb);
}
.po-segments { display: inline-flex; align-items: center; gap: 4px; }
.po-segments button { min-height: 34px; border: 1px solid transparent; border-radius: 6px; padding: 0 14px; color: var(--dsw-alias-label-secondary, #52525b); background: transparent; cursor: pointer; }
.po-segments button:hover { color: var(--dsw-alias-label-primary, #18181b); background: var(--dsw-alias-interactive-bg-hover, #f1f1f2); }
.po-segments button:active { background: var(--dsw-alias-interactive-bg-active, #e4e4e7); }
.po-segments button[aria-pressed="true"] { color: var(--dsw-alias-label-primary, #18181b); border-color: var(--dsw-alias-border-l2, #e5e7eb); background: var(--dsw-alias-bg-layer-1, #f7f7f8); font-weight: 650; }
.po-search { width: min(320px, 42vw); min-height: 36px; border: 1px solid var(--dsw-alias-border-l2, #d4d4d8); border-radius: 7px; padding: 0 10px; display: flex; align-items: center; gap: 8px; color: var(--dsw-alias-label-caption, #6b7280); background: var(--dsw-alias-bg-base, #fff); }
.po-search:focus-within { border-color: var(--po-accent); box-shadow: 0 0 0 1px var(--po-accent); }
.po-search input { width: 100%; min-width: 0; border: 0; outline: 0; color: var(--dsw-alias-label-primary, #18181b); background: transparent; }
.po-search input::placeholder, .po-input::placeholder, .po-textarea::placeholder, .po-project-form-identity input::placeholder, .po-project-form-identity textarea::placeholder, .po-chat-composer textarea::placeholder { color: var(--dsw-alias-label-secondary, #62626b); opacity: 1; }
.po-toolbar-note { color: var(--dsw-alias-label-caption, #6b7280); font-size: 12px; }
.po-board { min-width: 1190px; min-height: 0; flex: 1 1 auto; padding: 14px; display: grid; grid-template-columns: repeat(5, minmax(220px, 1fr)); gap: 12px; overflow: auto; }
.po-board-column { min-width: 0; min-height: 100%; border: 1px solid var(--dsw-alias-border-l2, #e5e7eb); border-radius: 7px; display: flex; flex-direction: column; background: var(--dsw-alias-bg-layer-1, #f7f7f8); transition: border-color 120ms ease, box-shadow 120ms ease; }
.po-board-column.po-drop-target { border-color: var(--dsw-alias-state-business-primary, #2876bd); box-shadow: inset 0 0 0 2px rgba(40, 118, 189, 0.13); box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary, #2876bd) 22%, transparent); }
.po-board-column.po-drop-blocked { border-color: var(--dsw-alias-state-error-primary, #bd3f3f); box-shadow: inset 0 0 0 2px rgba(189, 63, 63, 0.12); box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-error-primary, #bd3f3f) 22%, transparent); }
.po-board-column > header { min-height: 52px; padding: 0 12px; display: flex; align-items: center; gap: 8px; }
.po-board-column > header strong { font-size: 13px; }
.po-board-column > header > span:not(.po-column-indicator) { color: var(--dsw-alias-label-caption, #6b7280); font-variant-numeric: tabular-nums; }
.po-board-column > header button { width: 28px; height: 28px; margin-left: auto; border: 0; border-radius: 5px; display: grid; place-items: center; background: transparent; cursor: pointer; }
.po-board-column > header button:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06)); }
.po-column-indicator { width: 9px; height: 9px; border: 2px solid var(--dsw-alias-label-tertiary, #71717a); border-radius: 50%; }
.po-board-plain { background: var(--dsw-alias-bg-layer-1, #fafafa); border-color: var(--dsw-alias-border-l2, #eeeeef); }
.po-board-amber { background: var(--dsw-alias-bg-layer-1, #fbf7ef); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #ca8a04) 7%, var(--dsw-alias-bg-layer-1, #fbf7ef)); border-color: var(--dsw-alias-border-l2, #f2eadc); border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #ca8a04) 20%, var(--dsw-alias-border-l2, #f2eadc)); }
.po-board-amber .po-column-indicator { border-color: var(--dsw-alias-state-warn-primary, #ca8a04); }
.po-board-green { background: var(--dsw-alias-bg-layer-1, #f2f7f3); background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #168348) 6%, var(--dsw-alias-bg-layer-1, #f2f7f3)); border-color: var(--dsw-alias-border-l2, #e1ece3); border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #168348) 18%, var(--dsw-alias-border-l2, #e1ece3)); }
.po-board-green .po-column-indicator { border-color: var(--dsw-alias-state-success-primary, #168348); }
.po-board-blue { background: var(--dsw-alias-bg-layer-1, #f1f6fa); background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #1674c4) 7%, var(--dsw-alias-bg-layer-1, #f1f6fa)); border-color: var(--dsw-alias-border-l2, #e1eaf2); border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary, #1674c4) 20%, var(--dsw-alias-border-l2, #e1eaf2)); }
.po-board-blue .po-column-indicator { border-color: var(--dsw-alias-state-business-primary, #1674c4); background: var(--dsw-alias-state-business-primary, #1674c4); }
.po-board-stack { min-height: 0; flex: 1 1 auto; padding: 0 9px 10px; display: flex; flex-direction: column; gap: 9px; overflow-y: auto; }
.po-column-empty { min-height: 160px; display: grid; place-items: center; color: var(--dsw-alias-label-caption, #6b7280); font-size: 12px; }
.po-task-card { position: relative; width: 100%; border: 1px solid var(--dsw-alias-border-l2, #dedee2); border-radius: 7px; display: block; color: var(--dsw-alias-label-primary, #18181b); background: var(--dsw-alias-bg-base, #fff); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04); text-align: left; transition: border-color 120ms ease, box-shadow 120ms ease, opacity 120ms ease, transform 120ms ease; }
.po-task-card[draggable="true"] { cursor: grab; }
.po-task-card:hover { border-color: var(--dsw-alias-border-l4, #a9abb2); box-shadow: 0 3px 10px rgba(0, 0, 0, 0.07); transform: translateY(-1px); }
.po-task-card-dragging { opacity: 0.42; transform: scale(0.985); }
.po-task-card-open { width: 100%; border: 0; border-radius: 7px; padding: 14px; display: block; color: inherit; background: transparent; cursor: pointer; text-align: left; }
.po-card-drag-handle { position: absolute; z-index: 2; top: 8px; right: 8px; width: 28px; height: 28px; border: 1px solid transparent; border-radius: 5px; display: grid; place-items: center; color: var(--dsw-alias-label-caption, #6b7280); background: var(--dsw-alias-bg-base, #fff); cursor: grab; touch-action: none; }
.po-card-drag-handle:hover { color: var(--dsw-alias-label-primary, #18181b); border-color: var(--dsw-alias-border-l2, #dedee2); background: var(--dsw-alias-bg-layer-1, #f7f7f8); }
.po-card-drag-handle:active { cursor: grabbing; }
.po-task-card:has(.po-card-move-menu) { z-index: 5; }
.po-card-move-menu { position: absolute; z-index: 4; top: 40px; right: 8px; min-width: 112px; border: 1px solid var(--dsw-alias-border-l2, #dedee2); border-radius: 6px; padding: 4px; display: grid; gap: 2px; background: var(--dsw-alias-bg-base, #fff); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14); }
.po-card-move-menu button { min-height: 30px; border: 0; border-radius: 4px; padding: 0 9px; color: var(--dsw-alias-label-secondary, #52525b); background: transparent; cursor: pointer; text-align: left; font-size: 12px; }
.po-card-move-menu button:hover, .po-card-move-menu button[aria-current="true"] { color: var(--dsw-alias-label-primary, #18181b); background: var(--dsw-alias-interactive-bg-hover, #f1f1f2); }
.po-card-move-menu button[aria-current="true"] { font-weight: 650; }
.po-card-code { padding-right: 30px; display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--dsw-alias-label-caption, #6b7280); font-size: 11px; font-weight: 650; }
.po-card-tags { margin-top: 10px; display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.po-card-tags span { max-width: 100%; border-radius: 3px; padding: 2px 6px; overflow: hidden; color: var(--dsw-alias-label-secondary, #52525b); background: var(--dsw-alias-bg-layer-2, #f1f1f2); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.po-card-status { margin-top: 9px; }
.po-task-card-failed, .po-task-card-blocked, .po-task-card-cancelled { border-color: var(--po-error); }
.po-task-card-verifying { border-color: var(--po-success); }
.po-task-card-open > strong { margin-top: 9px; display: -webkit-box; overflow: hidden; font-size: 14px; line-height: 20px; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
.po-task-card-open > p { margin: 6px 0 0; display: -webkit-box; overflow: hidden; color: var(--dsw-alias-label-secondary, #52525b); font-size: 12px; line-height: 18px; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.po-card-project { margin-top: 12px; display: flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-secondary, #52525b); font-size: 11px; }
.po-task-card-open > footer { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--dsw-alias-border-l3, #eeeeef); display: flex; align-items: center; gap: 7px; color: var(--dsw-alias-label-secondary, #52525b); font-size: 11px; }
.po-task-card-open > footer time { margin-left: auto; color: var(--dsw-alias-label-caption, #6b7280); }
.po-agent-dot { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; color: var(--po-on-solid); background: var(--dsw-alias-button-primary-fill, #222326); font-size: 10px; font-weight: 700; }
.po-project-table { min-width: 1100px; padding: 0 24px 28px; }
.po-project-table-head, .po-project-row { display: grid; grid-template-columns: minmax(240px, 1.8fr) 105px 75px 135px 95px 120px 145px; align-items: center; gap: 12px; }
.po-project-table-head { min-height: 48px; padding: 0 12px; color: var(--dsw-alias-label-caption, #6b7280); font-size: 12px; }
.po-project-row { width: 100%; min-height: 74px; border: 0; border-top: 1px solid var(--dsw-alias-border-l3, #ededee); padding: 10px 12px; color: var(--dsw-alias-label-secondary, #52525b); background: transparent; cursor: pointer; text-align: left; }
.po-project-row:hover { background: var(--dsw-alias-interactive-bg-hover, #f7f7f8); }
.po-project-row > span { min-width: 0; display: flex; align-items: center; gap: 8px; }
.po-project-row > span:last-child { justify-content: space-between; }
.po-project-name { color: var(--dsw-alias-label-primary, #18181b); }
.po-project-name > span { min-width: 0; display: grid; gap: 4px; }
.po-project-name strong, .po-project-name small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.po-project-name strong { font-size: 14px; }
.po-project-name small { color: var(--dsw-alias-label-caption, #6b7280); font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.po-progress-cell { font-variant-numeric: tabular-nums; }
.po-progress-ring { --po-progress: 0deg; width: 20px; height: 20px; border-radius: 50%; display: inline-block; background: conic-gradient(var(--po-success) var(--po-progress), var(--dsw-alias-border-l2, #e5e7eb) 0); position: relative; }
.po-progress-ring::after { content: ''; position: absolute; inset: 4px; border-radius: 50%; background: var(--dsw-alias-bg-base, #fff); }
.po-project-detail-page { padding-bottom: 48px; }
.po-project-summary-band { min-height: 86px; padding: 14px 24px; display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; border-bottom: 1px solid var(--dsw-alias-border-l2, #e5e7eb); background: var(--dsw-alias-bg-layer-1, #fafafa); }
.po-project-summary-band > div, .po-project-summary-band > button { min-width: 0; display: grid; align-content: center; gap: 6px; }
.po-project-directory { margin: 0 24px; padding: 14px 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 12px 18px; border-bottom: 1px solid var(--dsw-alias-border-l2, #e5e7eb); }
.po-directory-fact { min-width: 0; display: grid; gap: 6px; }
.po-directory-fact > span { color: var(--dsw-alias-label-caption, #6b7280); font-size: 11px; }
.po-directory-fact > strong { min-width: 0; overflow: hidden; font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; text-overflow: ellipsis; white-space: nowrap; }
.po-directory-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.po-directory-actions .po-button { align-self: center; }
.po-project-summary-band span:first-child { color: var(--dsw-alias-label-caption, #6b7280); font-size: 11px; }
.po-project-summary-band strong { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.po-delivery-gate, .po-document-section, .po-project-task-section, .po-run-summary { margin: 18px 24px 0; padding: 18px; border: 1px solid var(--dsw-alias-border-l2, #e5e7eb); border-radius: 7px; }
.po-delivery-gate { background: var(--dsw-alias-bg-layer-1, #fafafa); }
.po-section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.po-section-heading h2 { margin: 0; font-size: 15px; line-height: 21px; }
.po-section-heading p { margin: 4px 0 0; color: var(--dsw-alias-label-secondary, #52525b); font-size: 12px; }
.po-section-heading > span { color: var(--dsw-alias-label-caption, #6b7280); font-size: 11px; }
.po-gate-actions { margin-top: 16px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.po-lifecycle-stepper { margin: 18px 0 0; padding: 0; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); list-style: none; border-top: 1px solid var(--dsw-alias-border-l2, #e5e7eb); }
.po-lifecycle-stepper li { min-width: 0; padding: 12px 8px 0 0; display: flex; align-items: center; gap: 7px; color: var(--dsw-alias-label-caption, #6b7280); font-size: 11px; }
.po-lifecycle-stepper li span { width: 20px; height: 20px; flex: 0 0 auto; border: 1px solid var(--dsw-alias-border-l2, #d4d4d8); border-radius: 50%; display: grid; place-items: center; color: var(--dsw-alias-label-caption, #6b7280); background: var(--dsw-alias-bg-base, #fff); font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; }
.po-lifecycle-stepper li.current { color: var(--po-accent-ink); font-weight: 650; }
.po-lifecycle-stepper li.current span { border-color: var(--po-accent); color: var(--po-on-solid); background: var(--po-accent); }
.po-lifecycle-stepper li.done { color: var(--po-success-ink); }
.po-lifecycle-stepper li.done span { border-color: var(--po-success); color: var(--po-success-ink); background: var(--po-success-surface); }
.po-approval-summary, .po-intervention-panel { margin-top: 16px; padding: 12px 14px; border: 1px solid var(--dsw-alias-border-l2, #d4d4d8); border-radius: 6px; display: flex; align-items: baseline; gap: 10px; line-height: 1.5; }
.po-approval-summary { border-color: color-mix(in srgb, var(--po-accent) 30%, var(--dsw-alias-border-l2, #d4d4d8)); background: var(--po-accent-surface); }
.po-approval-summary span, .po-intervention-panel span { color: var(--dsw-alias-label-secondary, #52525b); font-size: 12px; }
.po-intervention-panel { border-color: var(--dsw-alias-state-warn-secondary, #c88c48); background: var(--po-warn-surface); }
.po-intervention-panel strong { color: var(--po-warn-ink); }
.po-project-content-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; padding: 0 24px; }
.po-project-content-grid .po-document-section { margin-left: 0; margin-right: 0; }
.po-project-artifacts { margin: 18px 24px 0; display: grid; gap: 1px; border: 1px solid var(--dsw-alias-border-l2, #e5e7eb); border-radius: 7px; overflow: hidden; }
.po-artifact-disclosure { padding: 0 16px; background: var(--dsw-alias-bg-base, #fff); }
.po-artifact-disclosure + .po-artifact-disclosure { border-top: 1px solid var(--dsw-alias-border-l2, #e5e7eb); }
.po-artifact-disclosure summary { min-height: 48px; display: flex; align-items: center; cursor: pointer; color: var(--dsw-alias-label-primary, #27272a); font-weight: 650; }
.po-artifact-disclosure .po-document-text { margin: 0 0 18px; }
.po-document-text { max-width: 75ch; margin-top: 14px; color: var(--dsw-alias-label-secondary, #3f3f46); line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
.po-document-secondary { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--dsw-alias-border-l3, #eeeeef); }
.po-requirement-batches { display: grid; gap: 8px; }
.po-requirement-batches details { border-top: 1px solid var(--dsw-alias-border-l3, #eeeeef); }
.po-requirement-batches summary { min-height: 40px; display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: pointer; }
.po-requirement-batches summary span { color: var(--dsw-alias-label-caption, #6b7280); font-size: 11px; }
.po-project-task-row { width: 100%; min-height: 62px; border: 0; border-top: 1px solid var(--dsw-alias-border-l3, #ededee); padding: 10px 4px; display: grid; grid-template-columns: 54px minmax(0, 1fr) auto 20px; align-items: center; gap: 12px; background: transparent; cursor: pointer; text-align: left; }
.po-project-task-row:hover { background: var(--dsw-alias-interactive-bg-hover, #f7f7f8); }
.po-task-kind-mark { color: var(--dsw-alias-label-caption, #6b7280); font-size: 10px; font-weight: 700; text-transform: uppercase; }
.po-project-task-row > span:nth-child(2) { min-width: 0; display: grid; gap: 4px; }
.po-project-task-row strong, .po-project-task-row small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.po-project-task-row small { color: var(--dsw-alias-label-caption, #6b7280); font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.po-run-summary dl, .po-agent-facts, .po-agent-preview dl { margin: 16px 0 0; display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 8px 14px; }
.po-run-summary dt, .po-agent-facts dt, .po-agent-preview dt { color: var(--dsw-alias-label-caption, #6b7280); }
.po-run-summary dd, .po-agent-facts dd, .po-agent-preview dd { margin: 0; overflow-wrap: anywhere; }
.po-agent-list { padding: 0 24px 28px; }
.po-agent-row { width: 100%; min-height: 78px; border: 0; border-bottom: 1px solid var(--dsw-alias-border-l3, #ededee); padding: 10px 12px; display: grid; grid-template-columns: 42px minmax(260px, 1.7fr) minmax(160px, 1fr) 140px 110px 20px; align-items: center; gap: 12px; background: transparent; cursor: pointer; text-align: left; }
.po-agent-row:hover { background: var(--dsw-alias-interactive-bg-hover, #f7f7f8); }
.po-agent-avatar { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; color: var(--po-on-solid); background: var(--dsw-alias-button-primary-fill, #24252a); font-weight: 700; }
.po-agent-row > span:nth-child(2), .po-agent-row > span:nth-child(4) { min-width: 0; display: grid; gap: 4px; }
.po-agent-row strong, .po-agent-row small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.po-agent-row small { color: var(--dsw-alias-label-secondary, #52525b); font-size: 12px; }
.po-agent-role { font-weight: 600; }
.po-agent-profile-grid { padding: 24px; display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(280px, 0.7fr); gap: 18px; }
.po-agent-profile-main, .po-agent-facts { padding: 22px; border: 1px solid var(--dsw-alias-border-l2, #e5e7eb); border-radius: 7px; }
.po-agent-avatar-large { width: 52px; height: 52px; font-size: 20px; }
.po-agent-profile-main h2 { margin: 16px 0 0; font-size: 18px; }
.po-agent-profile-main p { max-width: 75ch; margin: 12px 0 0; color: var(--dsw-alias-label-secondary, #3f3f46); line-height: 1.65; white-space: pre-wrap; }
.po-builder-start { background: var(--dsw-alias-bg-base, #fff); }
.po-builder-intro { margin: auto auto 30px; padding: 40px 24px 0; text-align: center; }
.po-builder-intro h2 { margin: 0; font-size: 28px; line-height: 36px; }
.po-builder-intro p { max-width: 58ch; margin: 10px auto 0; color: var(--dsw-alias-label-secondary, #52525b); font-size: 14px; line-height: 21px; }
.po-builder-options { width: min(820px, calc(100% - 48px)); margin: 0 auto auto; display: grid; grid-template-columns: 1fr 1fr; gap: 14px; padding-bottom: 48px; }
.po-builder-options button { position: relative; min-height: 230px; border: 1px solid var(--dsw-alias-border-l2, #d4d4d8); border-radius: 8px; padding: 22px; display: flex; flex-direction: column; align-items: flex-start; color: var(--dsw-alias-label-primary, #18181b); background: var(--dsw-alias-bg-base, #fff); cursor: pointer; text-align: left; transition: border-color 160ms ease, background-color 160ms ease, transform 160ms ease; }
.po-builder-options button:hover { border-color: var(--dsw-alias-border-l4, #85868e); background: var(--dsw-alias-bg-layer-1, #fafafa); transform: translateY(-1px); }
.po-builder-options button:active { background: var(--dsw-alias-interactive-bg-active, #f1f1f2); }
.po-builder-options button.po-builder-option-recommended { border-color: var(--po-accent); background: var(--po-accent-surface); }
.po-builder-options button.po-builder-option-recommended:hover { border-color: var(--po-accent); background: color-mix(in srgb, var(--po-accent) 16%, var(--dsw-alias-bg-base, #f7f9fc)); }
.po-builder-options button > span { width: 42px; height: 42px; border-radius: 7px; display: grid; place-items: center; color: var(--dsw-alias-label-secondary, #52525b); background: var(--dsw-alias-bg-layer-2, #f1f1f2); }
.po-builder-options button > small { position: absolute; top: 20px; right: 20px; border-radius: 12px; padding: 3px 8px; color: var(--po-accent-ink); background: var(--po-accent-surface); font-size: 11px; font-weight: 650; }
.po-builder-options strong { margin-top: 38px; font-size: 18px; }
.po-builder-options p { max-width: 42ch; margin: 10px 0 0; color: var(--dsw-alias-label-secondary, #52525b); line-height: 1.55; }
.po-builder-options em { margin-top: auto; display: flex; align-items: center; gap: 4px; font-style: normal; font-weight: 650; }
.po-agent-builder-page { overflow: hidden; }
.po-agent-builder-layout { min-width: 0; min-height: 0; flex: 1 1 auto; display: grid; grid-template-columns: minmax(0, 1fr) minmax(360px, 42%); overflow: hidden; }
.po-agent-manual-form { min-width: 0; min-height: 0; flex: 1 1 auto; display: flex; flex-direction: column; overflow: hidden; }
.po-agent-manual-form .po-agent-config { min-height: 0; flex: 1 1 auto; }
.po-agent-manual-form .po-config-scroll { width: min(780px, 100%); margin: 0 auto; padding: 30px 32px 48px; }
.po-agent-preview, .po-agent-chat { min-width: 0; min-height: 0; border-right: 1px solid var(--dsw-alias-border-l2, #e5e7eb); }
.po-agent-preview { padding: 12vh clamp(24px, 8vw, 120px) 40px; }
.po-preview-avatar { width: 70px; height: 70px; border-radius: 50%; display: grid; place-items: center; color: var(--dsw-alias-label-secondary, #52525b); background: var(--dsw-alias-bg-layer-2, #f1f1f2); }
.po-agent-preview h2 { margin: 26px 0 0; font-size: 26px; }
.po-agent-preview > p { max-width: 60ch; margin: 12px 0 0; color: var(--dsw-alias-label-secondary, #52525b); line-height: 1.6; }
.po-agent-preview dl { max-width: 620px; margin-top: 34px; }
.po-agent-config { min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--dsw-alias-bg-layer-1, #fafafa); }
.po-config-scroll { min-height: 0; flex: 1 1 auto; padding: 22px 24px 32px; overflow-y: auto; }
.po-config-heading { padding-bottom: 18px; }
.po-config-heading > div { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.po-config-heading h2 { margin: 0; font-size: 18px; }
.po-config-heading span { color: var(--po-warn-ink); font-size: 11px; font-weight: 650; }
.po-config-heading span.po-config-ready { color: var(--po-success-ink); }
.po-config-heading p { margin: 6px 0 0; color: var(--dsw-alias-label-secondary, #52525b); line-height: 1.5; }
.po-config-section { padding: 20px 0; border-top: 1px solid var(--dsw-alias-border-l2, #e5e7eb); }
.po-config-section-heading { margin-bottom: 14px; }
.po-config-section-heading h3 { margin: 0; font-size: 14px; }
.po-config-section-heading p { margin: 4px 0 0; color: var(--dsw-alias-label-secondary, #52525b); font-size: 12px; line-height: 18px; }
.po-config-section > .po-field + .po-field, .po-config-disclosure-body > .po-field + .po-field, .po-config-disclosure-body > .po-field + .po-field-pair { margin-top: 14px; }
.po-field-hint { justify-self: end; color: var(--dsw-alias-label-caption, #6b7280); font-size: 10px; }
.po-instructions-editor { min-height: 280px; font: 12px/1.65 ui-monospace, SFMono-Regular, Menlo, monospace; }
.po-config-disclosure { border-top: 1px solid var(--dsw-alias-border-l2, #e5e7eb); }
.po-config-disclosure:last-child { border-bottom: 1px solid var(--dsw-alias-border-l2, #e5e7eb); }
.po-config-disclosure summary { min-height: 64px; display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: pointer; list-style: none; }
.po-config-disclosure summary::-webkit-details-marker { display: none; }
.po-config-disclosure summary > span { min-width: 0; display: grid; gap: 3px; }
.po-config-disclosure summary strong { font-size: 14px; }
.po-config-disclosure summary small { overflow: hidden; color: var(--dsw-alias-label-secondary, #52525b); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.po-config-disclosure summary > svg { flex: 0 0 auto; transition: transform 160ms ease; }
.po-config-disclosure[open] summary > svg { transform: rotate(90deg); }
.po-config-disclosure-body { padding: 2px 0 20px; }
.po-skill-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.po-skill-chips span { max-width: 100%; border-radius: 4px; padding: 3px 7px; overflow: hidden; color: var(--dsw-alias-label-secondary, #3f3f46); background: var(--dsw-alias-bg-layer-2, #e9e9eb); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.po-choice-group { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.po-choice-group button { min-height: 66px; border: 1px solid var(--dsw-alias-border-l2, #d4d4d8); border-radius: 6px; padding: 9px; display: grid; align-content: center; gap: 3px; color: inherit; background: var(--dsw-alias-bg-base, #fff); cursor: pointer; text-align: left; }
.po-choice-group button:hover { background: var(--dsw-alias-interactive-bg-hover, #f4f4f5); }
.po-choice-group button[aria-checked="true"] { border-color: var(--po-accent); background: var(--po-accent-surface); }
.po-choice-group button[aria-checked="true"]:hover { background: color-mix(in srgb, var(--po-accent) 16%, var(--dsw-alias-bg-base, #eef3f8)); }
.po-choice-group button strong { font-size: 12px; }
.po-choice-group button span { color: var(--dsw-alias-label-secondary, #52525b); font-size: 10px; line-height: 14px; }
.po-config-footer { min-height: 68px; flex: 0 0 auto; padding: 12px 24px; border-top: 1px solid var(--dsw-alias-border-l2, #e5e7eb); display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
.po-agent-chat { display: flex; flex-direction: column; background: var(--dsw-alias-bg-base, #fff); }
.po-builder-chat-title { min-height: 60px; padding: 12px 22px; border-bottom: 1px solid var(--dsw-alias-border-l2, #e5e7eb); display: flex; align-items: center; justify-content: space-between; }
.po-builder-chat-title > div { display: grid; gap: 3px; }
.po-builder-chat-title span { color: var(--dsw-alias-label-secondary, #52525b); font-size: 12px; }
.po-online-dot::before { content: ''; width: 8px; height: 8px; margin-right: 7px; border-radius: 50%; display: inline-block; background: var(--po-success); }
.po-chat-history { min-height: 0; flex: 1 1 auto; padding: 28px clamp(22px, 6vw, 84px); overflow-y: auto; }
.po-chat-empty { min-height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.po-chat-empty > svg { color: var(--dsw-alias-label-caption, #6b7280); }
.po-chat-empty h2 { margin: 18px 0 0; font-size: 23px; }
.po-chat-empty p { max-width: 52ch; margin: 9px 0 0; color: var(--dsw-alias-label-secondary, #52525b); line-height: 20px; }
.po-prompt-examples { margin-top: 22px; display: flex; justify-content: center; gap: 8px; flex-wrap: wrap; }
.po-prompt-examples button { min-height: 36px; border: 1px solid var(--dsw-alias-border-l2, #d4d4d8); border-radius: 18px; padding: 0 14px; background: transparent; cursor: pointer; }
.po-prompt-examples button:hover { background: var(--dsw-alias-interactive-bg-hover, #f1f1f2); }
.po-chat-user { width: fit-content; max-width: min(70ch, 82%); margin: 0 0 0 auto; border-radius: 15px 15px 4px 15px; padding: 11px 14px; background: var(--dsw-alias-bg-layer-2, #f1f1f2); line-height: 1.55; white-space: pre-wrap; }
.po-chat-user + .po-chat-agent, .po-chat-agent + .po-chat-user { margin-top: 26px; }
.po-chat-agent { max-width: 72ch; margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--dsw-alias-border-l3, #eeeeef); line-height: 1.6; }
.po-assistant-heading { display: flex; align-items: center; gap: 8px; }
.po-assistant-heading .po-agent-dot { width: 24px; height: 24px; }
.po-chat-agent > p { margin: 12px 0 0; color: var(--dsw-alias-label-primary, #27272a); white-space: pre-wrap; }
.po-assistant-section { margin-top: 15px; }
.po-assistant-section > span { display: block; color: var(--dsw-alias-label-caption, #6b7280); font-size: 11px; font-weight: 650; }
.po-assistant-section p, .po-assistant-section ul { margin: 5px 0 0; color: var(--dsw-alias-label-secondary, #52525b); font-size: 12px; line-height: 19px; }
.po-assistant-section ul { padding-left: 18px; }
.po-protected-changes { border: 1px solid var(--dsw-alias-state-warn-secondary, #b26a00); border-radius: 6px; padding: 10px; background: var(--po-warn-surface); }
.po-protected-changes > button { min-height: 32px; margin-top: 8px; border: 1px solid var(--dsw-alias-border-l2, #c8c8cd); border-radius: 5px; padding: 5px 9px; color: var(--dsw-alias-label-primary, #27272a); background: var(--dsw-alias-bg-base, transparent); cursor: pointer; font-size: 12px; }
.po-protected-changes > button:hover { background: var(--dsw-alias-interactive-bg-hover, #f4f4f5); }
.po-question-actions { margin-top: 7px; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.po-question-actions button { min-height: 32px; border: 0; border-radius: 5px; padding: 5px 8px; color: var(--po-accent-ink); background: var(--po-accent-surface); cursor: pointer; text-align: left; font-size: 12px; line-height: 18px; }
.po-question-actions button:hover { background: color-mix(in srgb, var(--po-accent) 18%, var(--dsw-alias-bg-base, #e2ebf4)); }
.po-generating { display: flex; align-items: center; gap: 8px; color: var(--dsw-alias-label-secondary, #52525b); }
.po-generating svg { animation: po-spin 1s linear infinite; }
.po-chat-composer { min-height: 86px; margin: 0 clamp(18px, 5vw, 70px) 16px; border: 1px solid var(--dsw-alias-border-l2, #c8c8cd); border-radius: 8px; padding: 10px; display: grid; grid-template-columns: minmax(0, 1fr) 40px; gap: 8px; align-items: end; background: var(--dsw-alias-bg-base, #fff); }
.po-chat-composer:focus-within { border-color: var(--po-accent); box-shadow: 0 0 0 1px var(--po-accent); }
.po-chat-composer textarea { min-width: 0; min-height: 60px; max-height: 140px; border: 0; outline: 0; resize: vertical; background: transparent; }
.po-chat-composer button { width: 40px; height: 40px; border: 0; border-radius: 50%; display: grid; place-items: center; color: var(--po-on-solid); background: var(--dsw-alias-button-primary-fill, #222326); cursor: pointer; }
.po-chat-composer button:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover, #34363a); }
.po-chat-composer button:active:not(:disabled) { filter: brightness(0.92); }
.po-chat-composer button:disabled { color: var(--dsw-alias-label-tertiary, #71717a); background: var(--dsw-alias-button-primary-dimmed, #e4e4e7); cursor: not-allowed; }
.po-studio-pane-tabs { display: none; }
.po-studio-pane[hidden] { display: none !important; }
.po-studio-footer { min-height: 68px; flex: 0 0 auto; padding: 11px 22px; border-top: 1px solid var(--dsw-alias-border-l2, #e5e7eb); display: flex; align-items: center; justify-content: space-between; gap: 16px; background: var(--dsw-alias-bg-base, #fff); }
.po-studio-footer > span { color: var(--dsw-alias-label-secondary, #52525b); font-size: 11px; }
.po-studio-footer > div { display: flex; align-items: center; gap: 8px; }
.po-modal-backdrop { position: absolute; inset: 0; z-index: 20; padding: 24px; display: grid; place-items: center; background: var(--dsw-alias-bg-mask-3, rgba(17, 24, 39, 0.42)); backdrop-filter: blur(3px); }
.po-modal { width: min(620px, 100%); max-height: min(840px, calc(100vh - 48px)); border: 1px solid var(--dsw-alias-border-l2, #d4d4d8); border-radius: 8px; display: flex; flex-direction: column; overflow: hidden; background: var(--dsw-alias-bg-base, #fff); box-shadow: 0 24px 70px rgba(0, 0, 0, 0.24); }
.po-modal-wide { width: min(920px, 100%); }
.po-confirm-backdrop { position: absolute; inset: 0; z-index: 70; padding: 24px; display: grid; place-items: center; background: var(--dsw-alias-bg-mask-3, rgba(17, 24, 39, 0.46)); backdrop-filter: blur(3px); }
.po-confirm-dialog { width: min(460px, 100%); padding: 22px; display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 14px; border: 1px solid var(--dsw-alias-border-l2, #d4d4d8); border-radius: 8px; color: var(--dsw-alias-label-primary, #18181b); background: var(--dsw-alias-bg-base, #fff); box-shadow: 0 24px 70px rgba(0, 0, 0, 0.24); }
.po-confirm-icon { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 50%; color: var(--po-accent-ink); background: var(--po-accent-surface); }
.po-confirm-warning .po-confirm-icon { color: var(--po-warn-ink); background: var(--po-warn-surface); }
.po-confirm-danger .po-confirm-icon { color: var(--po-error-ink); background: var(--po-error-surface); }
.po-confirm-content h2 { margin: 2px 0 0; font-size: 16px; }
.po-confirm-content p { margin: 8px 0 0; color: var(--dsw-alias-label-secondary, #52525b); font-size: 13px; line-height: 1.55; white-space: pre-wrap; }
.po-confirm-actions { margin-top: 20px; display: flex; justify-content: flex-end; gap: 8px; }
.po-button-danger { color: var(--po-on-solid); border-color: var(--po-error); background: var(--po-error); }
.po-button-danger:hover { background: color-mix(in srgb, var(--po-error) 88%, #000); }
.po-modal > header, .po-modal > footer { flex: 0 0 auto; display: flex; align-items: center; }
.po-modal > header { min-height: 66px; padding: 12px 18px; justify-content: space-between; border-bottom: 1px solid var(--dsw-alias-border-l2, #e5e7eb); }
.po-modal > header h2 { margin: 0; font-size: 16px; }
.po-modal > header p { margin: 3px 0 0; color: var(--dsw-alias-label-secondary, #52525b); font-size: 12px; }
.po-modal-body { min-height: 0; padding: 20px; overflow-y: auto; }
.po-modal > footer { min-height: 64px; padding: 10px 18px; justify-content: flex-end; gap: 8px; border-top: 1px solid var(--dsw-alias-border-l2, #e5e7eb); }
.po-spacer { flex: 1; }
.po-project-intake { display: grid; gap: 18px; }
.po-project-mode { margin: 0; border: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.po-project-mode legend { grid-column: 1 / -1; margin-bottom: 8px; color: var(--dsw-alias-label-secondary, #52525b); font-size: 12px; font-weight: 650; }
.po-project-mode-option { min-width: 0; min-height: 88px; border: 1px solid var(--dsw-alias-border-l2, #d4d4d8); border-radius: 8px; padding: 14px; display: flex; align-items: flex-start; gap: 10px; cursor: pointer; background: var(--dsw-alias-bg-base, #fff); }
.po-project-mode-option:hover { background: var(--dsw-alias-interactive-bg-hover, #f4f4f5); }
.po-project-mode-option-selected { border-color: var(--po-accent); background: var(--po-accent-surface); box-shadow: inset 0 0 0 1px var(--po-accent); }
.po-project-mode-option-selected:hover { background: color-mix(in srgb, var(--po-accent) 16%, var(--dsw-alias-bg-base, #eef5fb)); }
.po-project-mode-option input { margin-top: 3px; accent-color: var(--po-accent); }
.po-project-mode-option span { min-width: 0; display: grid; gap: 5px; }
.po-project-mode-option strong { font-size: 13px; }
.po-project-mode-option small { color: var(--dsw-alias-label-secondary, #52525b); font-size: 11px; line-height: 1.5; }
.po-project-source-mode { padding-top: 16px; border-top: 1px solid var(--dsw-alias-border-l3, #e5e7eb); }
.po-directory-control { display: flex; align-items: stretch; gap: 8px; }
.po-directory-control .po-input { min-width: 0; flex: 1 1 auto; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.po-directory-control .po-button { min-width: max-content; }
.po-repository-import { display: grid; gap: 14px; padding: 14px; border: 1px solid var(--dsw-alias-border-l2, #d4d4d8); border-radius: 8px; background: var(--dsw-alias-bg-layer-1, #fafafa); }
.po-repository-summary { min-height: 62px; display: grid; align-content: center; gap: 5px; }
.po-repository-summary strong { font: 600 13px ui-monospace, SFMono-Regular, Menlo, monospace; }
.po-repository-summary span { color: var(--dsw-alias-label-secondary, #52525b); font-size: 11px; }
.po-issue-picker { margin: 0; border: 0; padding: 0; }
.po-issue-picker legend { margin-bottom: 8px; color: var(--dsw-alias-label-primary, #18181b); font-size: 12px; font-weight: 650; }
.po-issue-picker > p { margin: 0; color: var(--dsw-alias-label-secondary, #52525b); font-size: 12px; }
.po-issue-picker > div { max-height: 210px; overflow: auto; border: 1px solid var(--dsw-alias-border-l3, #e5e7eb); border-radius: 6px; background: var(--dsw-alias-bg-base, #fff); }
.po-issue-picker label { min-height: 48px; padding: 9px 10px; display: flex; align-items: flex-start; gap: 9px; cursor: pointer; }
.po-issue-picker label + label { border-top: 1px solid var(--dsw-alias-border-l3, #e5e7eb); }
.po-issue-picker label:hover { background: var(--dsw-alias-interactive-bg-hover, #f4f4f5); }
.po-issue-picker input { margin-top: 3px; accent-color: var(--po-accent); }
.po-issue-picker label span { min-width: 0; display: grid; gap: 3px; }
.po-issue-picker label strong { overflow: hidden; font-size: 12px; line-height: 1.45; text-overflow: ellipsis; white-space: nowrap; }
.po-issue-picker label small { color: var(--dsw-alias-label-caption, #6b7280); font-size: 10px; }
.po-empty-project-note { border: 1px solid var(--dsw-alias-border-l2, #e5e7eb); border-radius: 8px; padding: 14px; display: flex; align-items: flex-start; gap: 12px; color: var(--dsw-alias-label-secondary, #52525b); background: var(--dsw-alias-bg-layer-1, #fafafa); }
.po-empty-project-note > svg { flex: 0 0 auto; margin-top: 2px; }
.po-empty-project-note strong { color: var(--dsw-alias-label-primary, #18181b); font-size: 13px; }
.po-empty-project-note p { max-width: 68ch; margin: 5px 0 0; font-size: 12px; line-height: 1.55; }
.po-intake-intro { padding: 2px 0 6px; display: flex; align-items: flex-start; gap: 14px; }
.po-intake-intro h3 { margin: 0; font-size: 18px; }
.po-intake-intro p { max-width: 68ch; margin: 6px 0 0; color: var(--dsw-alias-label-secondary, #52525b); line-height: 1.55; }
.po-brief-editor { min-height: 220px; font-size: 14px; line-height: 1.6; }
.po-intake-file-actions { display: flex; align-items: center; gap: 12px; color: var(--dsw-alias-label-caption, #6b7280); font-size: 11px; }
.po-intake-file-actions span { margin-right: auto; }
.po-intake-file-actions button { min-height: 36px; border: 1px solid var(--dsw-alias-border-l2, #d4d4d8); border-radius: 6px; padding: 0 10px; color: var(--dsw-alias-label-secondary, #3f3f46); background: transparent; cursor: pointer; }
.po-intake-file-actions button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, #f4f4f5); }
.po-intake-file-actions button:disabled { color: var(--dsw-alias-label-tertiary, #8b8d94); background: var(--dsw-alias-bg-layer-1, #f7f7f8); cursor: not-allowed; }
.po-import-append { min-height: 36px; display: inline-flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-secondary, #52525b); cursor: pointer; }
.po-import-append input { accent-color: var(--po-accent); }
.po-import-disclosure { max-width: 72ch; margin: -10px 0 0; color: var(--dsw-alias-label-secondary, #52525b); font-size: 11px; line-height: 1.5; }
.po-import-status { min-height: 42px; border: 1px solid color-mix(in srgb, var(--po-accent) 30%, var(--dsw-alias-border-l2, #d4d4d8)); border-radius: 6px; padding: 8px 10px; display: flex; align-items: center; gap: 8px; color: var(--po-accent-ink); background: var(--po-accent-surface); font-size: 12px; }
.po-import-status > svg { flex: 0 0 auto; }
.po-import-status:has(button) > svg { animation: po-spin 1s linear infinite; }
.po-import-status span { min-width: 0; flex: 1; }
.po-import-status button { min-height: 30px; border: 0; border-radius: 5px; padding: 0 8px; color: var(--dsw-alias-label-primary, #18181b); background: var(--dsw-alias-bg-base, #fff); cursor: pointer; }
.po-import-status button:hover { background: var(--dsw-alias-interactive-bg-hover, #f4f4f5); }
.po-import-warnings { display: grid; gap: 6px; color: var(--po-warn-ink); font-size: 11px; line-height: 1.45; }
.po-import-warnings span { display: flex; align-items: flex-start; gap: 7px; }
.po-import-warnings svg { flex: 0 0 auto; margin-top: 1px; }
.po-project-constraints { border-top: 1px solid var(--dsw-alias-border-l2, #e5e7eb); padding-top: 14px; }
.po-project-constraints summary { cursor: pointer; color: var(--dsw-alias-label-secondary, #3f3f46); font-weight: 650; }
.po-project-constraints-body { display: grid; gap: 14px; padding-top: 16px; }
.po-project-form-identity { padding: 6px 12px 22px; display: grid; grid-template-columns: 48px minmax(0, 1fr); grid-template-rows: auto auto; gap: 8px 14px; }
.po-project-glyph { grid-row: 1 / 3; width: 48px; height: 48px; border-radius: 7px; display: grid; place-items: center; color: var(--dsw-alias-label-secondary, #52525b); background: var(--dsw-alias-bg-layer-2, #f1f1f2); }
.po-project-form-identity input, .po-project-form-identity textarea { width: 100%; border: 0; outline: 0; background: transparent; resize: none; }
.po-project-form-identity input { font-size: 24px; font-weight: 700; }
.po-project-form-identity textarea { min-height: 44px; color: var(--dsw-alias-label-secondary, #52525b); line-height: 1.5; }
.po-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.po-field { min-width: 0; display: grid; align-content: start; gap: 7px; }
.po-field-wide { grid-column: 1 / -1; }
.po-label { color: var(--dsw-alias-label-secondary, #52525b); font-size: 12px; font-weight: 600; }
.po-field-help { color: var(--dsw-alias-label-caption, #6b7280); font-size: 11px; line-height: 1.45; }
.po-input, .po-select, .po-textarea { width: 100%; min-width: 0; border: 1px solid var(--dsw-alias-border-l2, #d4d4d8); border-radius: 6px; color: var(--dsw-alias-label-primary, #18181b); background: var(--dsw-alias-bg-base, #fff); }
.po-input, .po-select { min-height: 38px; padding: 0 10px; }
.po-select[multiple] { min-height: 96px; padding: 6px; }
.po-textarea { min-height: 96px; padding: 10px; line-height: 1.5; resize: vertical; }
.po-textarea-tall { min-height: 160px; }
.po-field-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.po-agent-config fieldset > .po-field + .po-field, .po-agent-config fieldset > .po-field + .po-field-pair { margin-top: 12px; }
.po-evidence { margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--dsw-alias-border-l2, #e5e7eb); }
.po-evidence h3 { margin: 0; font-size: 14px; }
.po-evidence pre { max-height: 240px; margin: 10px 0 0; border: 1px solid var(--dsw-alias-border-l2, #e5e7eb); border-radius: 6px; padding: 12px; overflow: auto; color: var(--dsw-alias-label-secondary, #3f3f46); background: var(--dsw-alias-bg-layer-1, #fafafa); font: 11px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.po-evidence-meta { margin-top: 10px; color: var(--dsw-alias-label-caption, #6b7280); font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; }
.po-badge { width: fit-content; min-height: 24px; border-radius: 12px; padding: 3px 9px; display: inline-flex; align-items: center; gap: 5px; color: var(--dsw-alias-label-secondary, #3f3f46); background: var(--dsw-alias-bg-layer-2, #f0f0f1); font-size: 11px; font-weight: 650; white-space: nowrap; }
.po-badge::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.po-priority { width: fit-content; min-height: 22px; border-radius: 4px; padding: 2px 7px; display: inline-flex; align-items: center; color: var(--dsw-alias-label-secondary, #52525b); background: var(--dsw-alias-bg-layer-2, #f0f0f1); font-size: 10px; font-weight: 700; white-space: nowrap; }
.po-priority-high { color: var(--po-warn-ink); background: var(--po-warn-surface); }
.po-priority-urgent { color: var(--po-error-ink); background: var(--po-error-surface); }
.po-priority-low { color: var(--dsw-alias-label-secondary, #506070); background: var(--dsw-alias-bg-layer-2, #edf1f4); }
.po-status-completed { color: var(--po-success-ink); background: var(--po-success-surface); }
.po-status-running, .po-status-decomposing, .po-status-verifying { color: var(--po-warn-ink); background: var(--po-warn-surface); }
.po-status-awaiting_approval, .po-status-approved { color: var(--po-accent-ink); background: var(--po-accent-surface); }
.po-status-failed, .po-status-blocked, .po-status-cancelled { color: var(--po-error-ink); background: var(--po-error-surface); }
.po-directory-browser-backdrop { position: fixed; inset: 0; z-index: 80; padding: 24px; display: grid; place-items: center; background: var(--dsw-alias-bg-mask-3, rgba(24, 24, 27, 0.5)); }
.po-directory-browser { width: min(680px, 100%); max-height: min(680px, calc(100vh - 48px)); border: 1px solid var(--dsw-alias-border-l2, #d4d4d8); border-radius: 8px; display: grid; grid-template-rows: auto auto minmax(220px, 1fr) auto; overflow: hidden; color: var(--dsw-alias-label-primary, #18181b); background: var(--dsw-alias-bg-base, #fff); box-shadow: 0 24px 64px rgba(0, 0, 0, 0.24); }
.po-directory-browser > header { padding: 16px 18px; border-bottom: 1px solid var(--dsw-alias-border-l2, #e5e7eb); display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.po-directory-browser h3 { margin: 0; font-size: 16px; }
.po-directory-browser header p { margin: 4px 0 0; color: var(--dsw-alias-label-secondary, #52525b); font-size: 12px; }
.po-directory-crumbs { min-height: 42px; padding: 7px 12px; border-bottom: 1px solid var(--dsw-alias-border-l3, #eeeeef); display: flex; align-items: center; gap: 2px; overflow-x: auto; }
.po-directory-crumbs button { min-height: 28px; border: 0; border-radius: 4px; padding: 0 7px; color: var(--dsw-alias-label-secondary, #52525b); background: transparent; cursor: pointer; white-space: nowrap; }
.po-directory-crumbs button:hover { color: var(--dsw-alias-label-primary, #18181b); background: var(--dsw-alias-interactive-bg-hover, #f1f1f2); }
.po-directory-list { min-height: 220px; padding: 6px; overflow-y: auto; }
.po-directory-list > button { width: 100%; min-height: 42px; border: 0; border-radius: 5px; padding: 0 10px; display: grid; grid-template-columns: 18px minmax(0, 1fr) 14px; align-items: center; gap: 9px; color: inherit; background: transparent; cursor: pointer; text-align: left; }
.po-directory-list > button:hover { background: var(--dsw-alias-interactive-bg-hover, #f4f4f5); }
.po-directory-list > button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.po-directory-message { min-height: 220px; display: grid; place-items: center; color: var(--dsw-alias-label-secondary, #52525b); }
.po-directory-warning { margin: 0; padding: 8px 16px; color: var(--po-warn-ink); background: var(--po-warn-surface); font-size: 12px; }
.po-directory-browser > footer { min-height: 58px; padding: 10px 14px; border-top: 1px solid var(--dsw-alias-border-l2, #e5e7eb); display: flex; align-items: center; gap: 8px; }
.po-directory-current { min-width: 0; margin-right: auto; overflow: hidden; color: var(--dsw-alias-label-secondary, #52525b); font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; text-overflow: ellipsis; white-space: nowrap; }
.po-inline-error { margin: 14px 24px 0; border: 1px solid color-mix(in srgb, var(--po-error) 42%, var(--dsw-alias-border-l2, #efb3b3)); border-radius: 6px; padding: 10px 12px; display: flex; align-items: flex-start; gap: 8px; color: var(--po-error-ink); background: var(--po-error-surface); line-height: 1.45; }
.po-project-diagnostic { margin: 14px 24px 0; padding: 14px 16px; display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; border: 1px solid color-mix(in srgb, var(--po-error) 42%, var(--dsw-alias-border-l2, #efb3b3)); border-radius: 7px; color: var(--po-error-ink); background: var(--po-error-surface); }
.po-project-diagnostic-main { min-width: 0; display: flex; align-items: flex-start; gap: 9px; line-height: 1.45; }
.po-project-diagnostic-main > svg { flex: 0 0 auto; margin-top: 2px; }
.po-project-diagnostic-main strong { display: block; font-size: 13px; }
.po-project-diagnostic-main p, .po-project-diagnostic-main span { display: block; margin: 5px 0 0; color: var(--dsw-alias-label-secondary, #52525b); font-size: 12px; }
.po-project-diagnostic-actions { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.po-project-diagnostic-actions details { position: relative; }
.po-project-diagnostic-actions summary { cursor: pointer; color: var(--po-error-ink); font-size: 11px; }
.po-project-diagnostic-actions pre { position: absolute; z-index: 2; right: 0; top: calc(100% + 8px); width: min(520px, 70vw); max-height: 220px; overflow: auto; margin: 0; padding: 10px; border: 1px solid var(--dsw-alias-border-l2, #d4d4d8); border-radius: 6px; color: var(--dsw-alias-label-primary, #18181b); background: var(--dsw-alias-bg-base, #fff); font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; }
.po-modal .po-inline-error, .po-agent-chat .po-inline-error { margin: 0 0 12px; }
.po-empty { min-height: 180px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; color: var(--dsw-alias-label-caption, #6b7280); text-align: center; }
.po-empty strong { color: var(--dsw-alias-label-primary, #18181b); }
.po-toast { position: absolute; z-index: 30; right: 18px; bottom: 16px; max-width: min(440px, calc(100% - 36px)); min-height: 42px; border: 1px solid color-mix(in srgb, var(--po-error) 42%, var(--dsw-alias-border-l2, #e4b3b3)); border-radius: 7px; padding: 8px 10px 8px 12px; display: flex; align-items: center; gap: 10px; color: var(--po-error-ink); background: var(--po-error-surface); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.13); cursor: pointer; text-align: left; }
.po-toast:hover { filter: brightness(0.97); }
.po-toast svg { flex: 0 0 auto; }
.po-toast-success { color: var(--po-success-ink); border-color: color-mix(in srgb, var(--po-success) 42%, var(--dsw-alias-border-l2, #a9d7ba)); background: var(--po-success-surface); }
.po-mobile-nav { display: none; }
.po-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@keyframes po-spin { to { transform: rotate(360deg); } }
.po-entity-list { padding: 18px 24px 28px; display: grid; gap: 10px; }
.po-entity-row { width: 100%; min-height: 72px; padding: 12px 14px; border: 0; border-bottom: 1px solid var(--dsw-alias-border-l2, #e5e7eb); display: grid; grid-template-columns: minmax(0, 1fr) 190px 220px 16px; align-items: center; gap: 14px; color: inherit; background: transparent; cursor: pointer; text-align: left; }
.po-entity-row:hover { background: var(--dsw-alias-interactive-bg-hover, #f5f5f6); }
.po-project-row:active, .po-agent-row:active, .po-entity-row:active, .po-project-task-row:active, .po-workload-row:active { background: var(--dsw-alias-interactive-bg-active, #e4e4e7); }
.po-entity-row > span { min-width: 0; display: grid; gap: 4px; }
.po-entity-row strong, .po-entity-row small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.po-entity-row small { color: var(--dsw-alias-label-secondary, #52525b); font-size: 11px; }
.po-entity-panel { padding: 16px; border-bottom: 1px solid var(--dsw-alias-border-l2, #e5e7eb); }
.po-entity-panel dl, .po-run-disclosure dl { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 8px 12px; }
.po-entity-panel dt, .po-run-disclosure dt { color: var(--dsw-alias-label-secondary, #52525b); }
.po-entity-panel dd, .po-run-disclosure dd { margin: 0; overflow-wrap: anywhere; }
.po-inline-links, .po-inline-actions, .po-command-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.po-inline-links button { min-height: 30px; padding: 0 9px; border: 1px solid var(--dsw-alias-border-l2, #d4d4d8); border-radius: 999px; color: var(--po-accent-ink); background: transparent; cursor: pointer; }
.po-inline-links button:hover { border-color: var(--po-accent); background: var(--po-accent-surface); }
.po-command-bar .po-select { min-width: 210px; flex: 1 1 240px; }
.po-info-banner { margin: 16px 24px 0; padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--po-warn) 42%, var(--dsw-alias-border-l2, #e4c35a)); border-radius: 7px; display: flex; align-items: center; gap: 8px; color: var(--po-warn-ink); background: var(--po-warn-surface); }
.po-compact-select { width: auto; min-width: 150px; }
.po-issue-facts { display: flex; gap: 8px; flex-wrap: wrap; }
.po-issue-facts span { padding: 6px 8px; border-radius: 5px; color: var(--dsw-alias-label-secondary, #52525b); background: var(--dsw-alias-bg-layer-1, #f4f4f5); font-size: 11px; }
.po-run-disclosure, .po-artifact-list details { border-bottom: 1px solid var(--dsw-alias-border-l3, #eeeeef); }
.po-run-disclosure summary, .po-artifact-list summary { min-height: 44px; display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: pointer; }
.po-run-disclosure summary span, .po-artifact-list summary span { color: var(--dsw-alias-label-secondary, #52525b); font-size: 11px; }
.po-transcript { display: grid; gap: 8px; }
.po-transcript > div { padding: 10px; border-radius: 6px; background: var(--dsw-alias-bg-layer-1, #f4f4f5); }
.po-transcript pre, .po-artifact-list pre { max-height: 280px; margin: 6px 0 0; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font: var(--dsw-font-s-12, 12px/1.55 ui-monospace, monospace); }
.po-mobile-more { position: relative; min-width: 0; }
.po-mobile-more summary { height: 100%; min-height: 44px; display: grid; place-items: center; align-content: center; gap: 3px; color: var(--dsw-alias-label-secondary, #52525b); cursor: pointer; font-size: 10px; list-style: none; }
.po-mobile-more summary[aria-current="page"] { color: var(--po-accent-ink); background: var(--po-accent-surface); }
.po-mobile-more summary::-webkit-details-marker { display: none; }
.po-mobile-more summary:hover { color: var(--dsw-alias-label-primary, #18181b); background: var(--dsw-alias-interactive-bg-hover, #f4f4f5); }
.po-mobile-more > div { position: fixed; right: 8px; bottom: 64px; z-index: 20; min-width: 160px; padding: 6px; border: 1px solid var(--dsw-alias-border-l2, #d4d4d8); border-radius: 8px; display: grid; background: var(--dsw-alias-bg-base, #fff); box-shadow: 0 6px 8px rgba(0,0,0,.14); }
.po-mobile-more > div button { min-height: 38px; display: block; padding: 0 10px; text-align: left; }
.po-mobile-more > div button:hover { background: var(--dsw-alias-interactive-bg-hover, #f4f4f5); }
.po-sidebar-more-toggle { width: 100%; min-height: 36px; margin-top: 10px; border: 0; border-radius: 6px; padding: 0 10px; display: flex; align-items: center; gap: 10px; color: var(--dsw-alias-label-secondary, #52525b); background: transparent; cursor: pointer; text-align: left; font-weight: 650; }
.po-sidebar-more-toggle:hover { background: var(--dsw-alias-interactive-bg-hover, #f1f1f2); }
.po-sidebar-more-toggle[aria-expanded="true"] > svg { transform: rotate(90deg); }
.po-sidebar-more-toggle > svg { transition: transform 160ms ease; }
.po-sidebar-more-items { padding-left: 8px; }
.po-nav-warning, .po-nav-active { width: 7px; height: 7px; margin-left: auto; border-radius: 50%; background: var(--po-warn); }
.po-nav-active { background: var(--po-accent); }
.po-project-tabs { min-height: 48px; padding: 0 24px; border-bottom: 1px solid var(--dsw-alias-border-l2, #e5e7eb); display: flex; align-items: end; gap: 4px; overflow-x: auto; }
.po-project-tabs button { min-height: 40px; border: 0; border-bottom: 2px solid transparent; padding: 0 14px; color: var(--dsw-alias-label-secondary, #52525b); background: transparent; cursor: pointer; white-space: nowrap; }
.po-project-tabs button:hover { color: var(--dsw-alias-label-primary, #18181b); background: var(--dsw-alias-interactive-bg-hover, #f4f4f5); }
.po-project-tabs button[aria-current="page"] { color: var(--dsw-alias-label-primary, #18181b); border-bottom-color: var(--po-accent); font-weight: 650; }
.po-summary-link { min-width: 0; border: 0; padding: 0; display: grid; align-content: center; gap: 6px; color: inherit; background: transparent; cursor: pointer; text-align: left; }
.po-summary-link:hover strong { color: var(--po-accent-ink); text-decoration: underline; text-underline-offset: 2px; }
.po-orchestration-strip { margin: 18px 24px 0; border: 1px solid var(--dsw-alias-border-l2, #e5e7eb); border-radius: 7px; display: grid; grid-template-columns: auto repeat(5, minmax(0, 1fr)); overflow: hidden; }
.po-orchestration-strip h2 { margin: 0; padding: 12px 14px; display: flex; align-items: center; font-size: 13px; background: var(--dsw-alias-bg-layer-1, #fafafa); }
.po-orchestration-strip button { min-width: 0; min-height: 58px; border: 0; border-left: 1px solid var(--dsw-alias-border-l3, #eeeeef); padding: 8px 10px; display: grid; align-content: center; gap: 4px; color: inherit; background: transparent; cursor: pointer; text-align: left; }
.po-orchestration-strip button:hover { background: var(--dsw-alias-interactive-bg-hover, #f4f4f5); }
.po-orchestration-strip span { color: var(--dsw-alias-label-caption, #6b7280); font-size: 10px; }
.po-orchestration-strip strong { overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.po-project-tab-body { padding: 20px 24px 36px; }
.po-project-tab-body > .po-section-heading { margin-bottom: 16px; }
.po-project-squad-bindings { padding-bottom: 20px; border-bottom: 1px solid var(--dsw-alias-border-l2, #e5e7eb); }
.po-project-members-section { padding-top: 20px; }
.po-binding-list { border-top: 1px solid var(--dsw-alias-border-l2, #e5e7eb); }
.po-binding-row { min-height: 72px; border-bottom: 1px solid var(--dsw-alias-border-l3, #eeeeef); padding: 10px 0; display: grid; grid-template-columns: minmax(220px, 1fr) minmax(130px, .45fr) auto; align-items: center; gap: 14px; }
.po-binding-row > span { min-width: 0; display: grid; gap: 4px; }
.po-binding-row strong, .po-binding-row small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.po-binding-row small { color: var(--dsw-alias-label-secondary, #52525b); font-size: 11px; }
.po-binding-row em { margin-left: 7px; border-radius: 3px; padding: 2px 5px; color: var(--po-accent-ink); background: var(--po-accent-surface); font-size: 10px; font-style: normal; font-weight: 650; }
.po-binding-actions { display: flex !important; justify-content: flex-end; flex-wrap: wrap; }
.po-binding-replacement { grid-column: 1 / -1; padding: 10px 0 2px; display: flex; align-items: end; justify-content: flex-end; gap: 8px; }
.po-binding-replacement label { min-width: min(260px, 100%); display: grid; gap: 5px; color: var(--dsw-alias-label-secondary, #52525b); font-size: 11px; }
.po-binding-picker { margin: 0; border: 0; padding: 0; }
.po-binding-picker legend { margin-bottom: 8px; font-size: 13px; font-weight: 650; }
.po-binding-picker > label { min-height: 58px; border-top: 1px solid var(--dsw-alias-border-l3, #eeeeef); padding: 8px 4px; display: flex; align-items: flex-start; gap: 9px; cursor: pointer; }
.po-binding-picker input { margin-top: 4px; accent-color: var(--po-accent); }
.po-binding-picker label span { min-width: 0; display: grid; gap: 4px; }
.po-binding-picker label small, .po-helper-copy { color: var(--dsw-alias-label-secondary, #52525b); font-size: 11px; line-height: 1.5; }
.po-helper-copy { max-width: 70ch; margin: 8px 0 0; }
.po-state-warning { color: var(--po-warn-ink); }
.po-state-success { color: var(--po-success-ink); }
.po-member-list { border-top: 1px solid var(--dsw-alias-border-l2, #e5e7eb); }
.po-member-head, .po-member-row { display: grid; grid-template-columns: minmax(180px, 1.3fr) minmax(180px, 1.2fr) minmax(220px, 1.5fr) 90px minmax(190px, auto); gap: 12px; align-items: center; }
.po-member-head { min-height: 40px; color: var(--dsw-alias-label-caption, #6b7280); font-size: 11px; }
.po-member-row { min-height: 76px; border-top: 1px solid var(--dsw-alias-border-l3, #eeeeef); padding: 10px 0; }
.po-member-row > span { min-width: 0; display: grid; gap: 4px; }
.po-member-row strong, .po-member-row small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.po-member-row small { color: var(--dsw-alias-label-secondary, #52525b); font-size: 11px; }
.po-member-leadership { width: fit-content; padding: 2px 6px; border-radius: 4px; color: var(--po-accent-ink); background: var(--po-accent-surface); font-size: 10px; font-weight: 650; line-height: 1.4; }
.po-member-actions { display: flex !important; justify-content: flex-end; flex-wrap: wrap; }
.po-check { min-height: 32px; display: flex; align-items: center; gap: 7px; color: var(--dsw-alias-label-secondary, #52525b); font-size: 11px; cursor: pointer; }
.po-check input, .po-agent-picker input { accent-color: var(--po-accent); }
.po-add-members-panel, .po-batch-panel, .po-agent-join-panel { margin-bottom: 18px; border: 1px solid var(--dsw-alias-border-l2, #d4d4d8); border-radius: 7px; padding: 16px; background: var(--dsw-alias-bg-layer-1, #fafafa); }
.po-agent-join-panel { margin: 18px 24px 0; }
.po-add-members-panel > .po-search { width: 100%; margin-top: 14px; }
.po-agent-picker { max-height: 430px; margin-top: 10px; border-top: 1px solid var(--dsw-alias-border-l3, #e5e7eb); overflow: auto; }
.po-agent-picker-row { border-bottom: 1px solid var(--dsw-alias-border-l3, #e5e7eb); padding: 10px 4px; display: grid; grid-template-columns: minmax(220px, 1fr) minmax(260px, 1fr); gap: 12px; }
.po-agent-picker-row > label { min-height: 44px; display: flex; align-items: flex-start; gap: 9px; cursor: pointer; }
.po-agent-picker-row > label input { margin-top: 4px; }
.po-agent-picker-row > label span { display: grid; gap: 4px; }
.po-agent-picker-row small, .po-batch-row small { color: var(--dsw-alias-label-secondary, #52525b); font-size: 11px; }
.po-agent-picker-row.po-disabled { opacity: .65; }
.po-picker-config { display: grid; gap: 5px; }
.po-panel-actions { margin-top: 12px; display: flex; justify-content: flex-end; }
.po-batch-row { min-height: 58px; border-top: 1px solid var(--dsw-alias-border-l3, #e5e7eb); padding: 9px 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(220px, 320px); align-items: center; gap: 12px; }
.po-batch-row > span { min-width: 0; display: grid; gap: 4px; }
.po-history-members { margin-top: 18px; border-top: 1px solid var(--dsw-alias-border-l2, #e5e7eb); }
.po-history-members summary { min-height: 44px; display: flex; align-items: center; cursor: pointer; font-weight: 650; }
.po-history-members > div { min-height: 48px; border-top: 1px solid var(--dsw-alias-border-l3, #eeeeef); display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--dsw-alias-label-secondary, #52525b); }
.po-link-button { border: 0; padding: 0; color: var(--po-accent-ink); background: transparent; cursor: pointer; font-weight: 650; }
.po-link-button:hover { text-decoration: underline; text-underline-offset: 2px; }
.po-project-membership-link { width: 100%; min-height: 58px; border: 0; border-top: 1px solid var(--dsw-alias-border-l3, #eeeeef); padding: 8px 4px; display: grid; grid-template-columns: minmax(0, 1fr) auto 16px; align-items: center; gap: 12px; color: inherit; background: transparent; cursor: pointer; text-align: left; }
.po-project-membership-link:hover { background: var(--dsw-alias-interactive-bg-hover, #f4f4f5); }
.po-project-membership-link > span { display: grid; gap: 4px; }
.po-project-membership-link small { color: var(--dsw-alias-label-secondary, #52525b); font-size: 11px; }
.po-management-list { padding: 0 24px 28px; }
.po-management-row { width: 100%; min-height: 76px; border: 0; border-bottom: 1px solid var(--dsw-alias-border-l2, #e5e7eb); padding: 10px 12px; display: grid; grid-template-columns: minmax(220px, 1.5fr) minmax(160px, 1fr) minmax(220px, 1.2fr) auto 16px; align-items: center; gap: 14px; color: inherit; background: transparent; text-align: left; }
button.po-management-row { cursor: pointer; }
button.po-management-row:hover { background: var(--dsw-alias-interactive-bg-hover, #f4f4f5); }
.po-management-row > span { min-width: 0; display: grid; gap: 4px; }
.po-management-row strong, .po-management-row small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.po-management-row small { color: var(--dsw-alias-label-secondary, #52525b); font-size: 11px; }
.po-host-baseline { background: var(--dsw-alias-bg-layer-1, #fafafa); }
.po-drawer-backdrop { position: absolute; inset: 0; z-index: 20; display: flex; justify-content: flex-end; background: var(--dsw-alias-bg-mask-3, rgba(17, 24, 39, .42)); }
.po-drawer { width: min(620px, 100%); height: 100%; border-left: 1px solid var(--dsw-alias-border-l2, #d4d4d8); display: grid; grid-template-rows: auto minmax(0, 1fr) auto; background: var(--dsw-alias-bg-base, #fff); box-shadow: -6px 0 8px rgba(0, 0, 0, .12); }
.po-drawer > header { min-height: 68px; padding: 12px 18px; border-bottom: 1px solid var(--dsw-alias-border-l2, #e5e7eb); display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.po-drawer h2 { margin: 0; font-size: 16px; }
.po-drawer header p { margin: 4px 0 0; color: var(--dsw-alias-label-secondary, #52525b); font-size: 12px; }
.po-drawer-body { min-height: 0; padding: 20px; overflow-y: auto; }
.po-drawer-steps { margin: -4px 0 20px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.po-drawer-steps span { min-width: 0; border-bottom: 2px solid var(--dsw-alias-border-l2, #d4d4d8); padding: 0 4px 8px; color: var(--dsw-alias-label-caption, #71717a); font-size: 11px; overflow-wrap: anywhere; }
.po-drawer-steps span[aria-current="step"] { border-color: var(--po-accent); color: var(--dsw-alias-label-primary, #18181b); font-weight: 650; }
.po-drawer > footer { min-height: 66px; padding: 10px 18px; border-top: 1px solid var(--dsw-alias-border-l2, #e5e7eb); display: flex; justify-content: flex-end; align-items: center; gap: 8px; flex-wrap: wrap; }
.po-member-picker { margin: 0; border: 0; padding: 0; }
.po-member-picker legend { margin-bottom: 7px; color: var(--dsw-alias-label-secondary, #52525b); font-size: 12px; font-weight: 600; }
.po-member-picker legend span { margin-left: 5px; color: var(--dsw-alias-label-caption, #71717a); font-size: 11px; font-weight: 400; }
.po-member-picker > div { min-height: 52px; border-top: 1px solid var(--dsw-alias-border-l3, #eeeeef); padding: 7px 0; display: grid; grid-template-columns: minmax(150px, .8fr) minmax(180px, 1.2fr); align-items: center; gap: 12px; }
.po-member-picker label { min-height: 38px; display: flex; align-items: center; gap: 8px; cursor: pointer; }
.po-member-name { min-width: 0; display: flex; align-items: center; gap: 6px; }
.po-member-name > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.po-member-tool-policy { flex: 0 0 auto; border-radius: 3px; padding: 1px 5px; color: var(--dsw-alias-label-secondary, #52525b); background: var(--dsw-alias-bg-layer-2, #f1f1f2); font-size: 10px; line-height: 16px; }
.po-member-tool-policy-full { color: var(--po-success-ink); background: var(--po-success-surface); }
.po-member-picker input[type="checkbox"] { accent-color: var(--po-accent); }
.po-detail-facts, .po-local-data dl { margin: 0; display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 10px 14px; }
.po-detail-facts dt, .po-local-data dt { color: var(--dsw-alias-label-secondary, #52525b); }
.po-detail-facts dd, .po-local-data dd { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.po-drawer-section { margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--dsw-alias-border-l2, #e5e7eb); }
.po-drawer-section h3 { margin: 0 0 8px; font-size: 14px; }
.po-project-squads { margin: 18px 24px 0; padding: 14px 16px; border: 1px solid var(--dsw-alias-border-l2, #e5e7eb); border-radius: 7px; }
.po-project-squads .po-context-row { min-height: 44px; }
.po-squad-availability-warning { margin-top: 12px; padding: 12px; border: 1px solid var(--dsw-alias-state-warn-secondary, #c88c48); border-radius: 6px; background: var(--po-warn-surface); color: var(--po-warn-ink); }
.po-squad-availability-warning > strong { display: block; font-size: 12px; }
.po-squad-availability-warning > p { margin: 5px 0 10px; color: var(--dsw-alias-label-secondary, #52525b); font-size: 11px; line-height: 1.5; }
.po-squad-availability-row { min-width: 0; padding: 8px 0; border-top: 1px solid color-mix(in srgb, var(--po-warn-ink) 20%, transparent); display: grid; grid-template-columns: minmax(110px, .4fr) minmax(0, 1fr) auto; align-items: center; gap: 10px; font-size: 11px; }
.po-squad-availability-row > span { min-width: 0; color: var(--dsw-alias-label-secondary, #52525b); overflow-wrap: anywhere; }
.po-squad-availability-row .po-link-button { justify-self: end; }
.po-resource-binding { min-width: 0; padding: 9px 0; border-bottom: 1px solid var(--dsw-alias-border-l3, #eeeeef); display: grid; grid-template-columns: minmax(0, 1fr) minmax(150px, 190px) auto; align-items: center; gap: 8px; }
.po-resource-binding strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.po-impact-summary { margin: 14px 0; padding: 12px; display: grid; gap: 7px; background: var(--dsw-alias-bg-layer-1, #fafafa); }
.po-impact-summary > span, .po-impact-summary > div { color: var(--dsw-alias-label-secondary, #52525b); font-size: 11px; }
.po-assignment-mode { margin-bottom: 10px; }
.po-local-data { padding: 20px 24px 36px; display: grid; gap: 22px; }
.po-local-data > section { padding-bottom: 22px; border-bottom: 1px solid var(--dsw-alias-border-l2, #e5e7eb); }
.po-local-data h2 { margin: 0 0 14px; font-size: 15px; }
.po-local-data p { color: var(--dsw-alias-label-secondary, #52525b); }
.po-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.po-field-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 6px; color: var(--dsw-alias-label-caption, #6b7280); font-size: 11px; }
.po-squad-instructions { min-height: 220px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; line-height: 1.6; }
.po-trigger-picker { margin: 0; border: 1px solid var(--dsw-alias-border-l2, #e5e7eb); border-radius: 6px; padding: 12px; background: var(--dsw-alias-bg-layer-1, #fafafa); }
.po-trigger-picker legend { padding: 0 4px; font-weight: 650; }
.po-trigger-picker p { margin: 2px 0 10px; color: var(--dsw-alias-label-secondary, #52525b); font-size: 11px; }
.po-trigger-picker > div { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 14px; }
.po-trigger-picker label { min-height: 44px; display: flex; align-items: flex-start; gap: 8px; padding: 7px 0; cursor: pointer; }
.po-trigger-picker input, .po-member-picker input[type="checkbox"] { margin-top: 3px; accent-color: var(--po-accent); }
.po-trigger-picker label span { min-width: 0; display: grid; gap: 2px; }
.po-trigger-picker small { color: var(--dsw-alias-label-secondary, #52525b); font-size: 11px; line-height: 1.4; }
.po-field-error { display: block; margin-top: 8px; color: var(--po-error-ink); font-size: 11px; }
.po-fixed-policy { min-height: 44px; padding: 10px 12px; display: flex; align-items: baseline; gap: 8px; border: 1px solid var(--dsw-alias-border-l2, #e5e7eb); border-radius: 6px; background: var(--dsw-alias-bg-layer-1, #fafafa); font-size: 12px; }
.po-fixed-policy span, .po-scope-label { color: var(--dsw-alias-label-secondary, #52525b); font-size: 11px; }
.po-scope-label { display: block; margin-top: 4px; }
.po-squad-diagnostics { padding: 12px; border: 1px solid var(--dsw-alias-state-warn-secondary, #c88c48); border-radius: 6px; background: var(--po-warn-surface); color: var(--po-warn-ink); }
.po-squad-diagnostics h3 { margin: 0; display: flex; align-items: center; gap: 6px; font-size: 12px; }
.po-squad-diagnostics ul, .po-conflict-list, .po-evidence-diagnostics { margin: 8px 0 0; padding-left: 18px; display: grid; gap: 6px; font-size: 11px; }
.po-squad-diagnostics li { display: grid; grid-template-columns: 90px minmax(0, 1fr); gap: 8px; }
.po-squad-diagnostics li span { color: var(--dsw-alias-label-secondary, #52525b); }
.po-squad-diagnostics-clear { color: var(--po-success-ink); border-color: var(--dsw-alias-state-success-secondary, #8fbda2); background: var(--po-success-surface); }
.po-delegation-row { width: 100%; min-height: 52px; padding: 8px 0; border: 0; border-bottom: 1px solid var(--dsw-alias-border-l3, #eeeeef); display: flex; align-items: center; justify-content: space-between; gap: 12px; color: inherit; background: transparent; cursor: pointer; text-align: left; }
.po-delegation-row > span:first-child { min-width: 0; display: grid; gap: 3px; }
.po-delegation-row small { overflow: hidden; color: var(--dsw-alias-label-secondary, #52525b); text-overflow: ellipsis; white-space: nowrap; }
.po-delegation-row > span:last-child { color: var(--dsw-alias-label-secondary, #52525b); font-size: 11px; }
.po-conflict-list { list-style: none; padding-left: 0; }
.po-conflict-list li { display: flex; align-items: flex-start; gap: 7px; color: var(--po-warn-ink); }
.po-conflict-list li span { color: var(--dsw-alias-label-secondary, #52525b); }
.po-decision-evidence { padding: 10px 0; display: grid; gap: 7px; }
.po-decision-evidence > div { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.po-decision-evidence p { margin: 0; white-space: pre-wrap; line-height: 1.5; }
.po-decision-evidence small, .po-decision-evidence time { color: var(--dsw-alias-label-secondary, #52525b); font-size: 11px; }
@media (max-width: 1080px) {
  .po-workbench { grid-template-columns: 72px minmax(0, 1fr); }
  .po-sidebar { padding: 14px 8px; }
  .po-sidebar-brand { justify-content: center; padding-left: 0; padding-right: 0; }
  .po-sidebar-brand > div, .po-sidebar-section, .po-side-nav > span:not(.po-brand-mark), .po-side-count, .po-sidebar-metric, .po-side-action, .po-sidebar-more-toggle > span, .po-sidebar-more-toggle > i { display: none; }
  .po-sidebar-more-toggle { justify-content: center; padding: 0; }
  .po-sidebar-more-items { padding-left: 0; }
  .po-side-nav { justify-content: center; padding: 0; }
  .po-sidebar-footer { display: grid; place-items: center; }
  .po-project-content-grid { grid-template-columns: 1fr; }
  .po-agent-builder-layout { grid-template-columns: minmax(0, 1fr) 420px; }
  .po-agent-row { grid-template-columns: 42px minmax(220px, 1.5fr) 150px 120px 20px; }
  .po-agent-row > span:nth-child(5) { display: none; }
}
@media (min-width: 761px) and (max-width: 1080px) {
  .po-project-table { min-width: 0; }
  .po-project-table-head, .po-project-row { grid-template-columns: minmax(210px, 1.5fr) 105px 75px 95px 110px; }
  .po-project-table-head > :nth-child(4), .po-project-table-head > :nth-child(7), .po-project-row > :nth-child(4), .po-project-row > :nth-child(7) { display: none; }
  .po-project-summary-band { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 760px) {
  .po-workbench { grid-template-columns: 1fr; grid-template-rows: minmax(0, 1fr) 58px; }
  .po-sidebar { display: none; }
  .po-main { grid-column: 1; grid-row: 1; }
  .po-mobile-nav { grid-column: 1; grid-row: 2; z-index: 10; min-width: 0; display: grid; grid-template-columns: repeat(5, 1fr); border-top: 1px solid var(--dsw-alias-border-l2, #e5e7eb); background: var(--dsw-alias-bg-base, #fff); }
  .po-mobile-nav button { min-width: 0; border: 0; display: grid; place-items: center; align-content: center; gap: 3px; color: var(--dsw-alias-label-secondary, #52525b); background: transparent; font-size: 10px; }
  .po-mobile-nav button:hover { background: var(--dsw-alias-interactive-bg-hover, #f4f4f5); }
  .po-mobile-nav button[aria-current="page"] { color: var(--po-accent-ink); background: var(--po-accent-surface); }
  .po-mobile-nav button[aria-current="page"]:hover { background: color-mix(in srgb, var(--po-accent) 16%, var(--dsw-alias-bg-base, #eef5fb)); }
  .po-toast { right: 12px; bottom: 70px; max-width: calc(100% - 24px); }
  .po-page-header { min-height: 66px; padding: 10px 14px; }
  .po-page-heading h1 { font-size: 18px; }
  .po-page-heading p { max-width: 42vw; }
  .po-page-actions { gap: 4px; }
  .po-page-actions .po-button { min-height: 34px; padding: 0 10px; font-size: 12px; }
  .po-toolbar { padding: 8px 14px; flex-wrap: wrap; }
  .po-search { width: 100%; order: 2; }
  .po-board { min-width: 100%; padding: 10px 14px 18px; display: flex; scroll-snap-type: x mandatory; }
  .po-board-column { min-width: calc(100vw - 50px); min-height: 100%; scroll-snap-align: start; }
  .po-card-drag-handle { width: 34px; height: 34px; }
  .po-card-move-menu { top: 46px; min-width: 132px; }
  .po-card-move-menu button { min-height: 36px; }
  .po-card-code { padding-right: 36px; }
  .po-project-table { min-width: 0; padding: 10px 14px 24px; }
  .po-project-table-head { display: none; }
  .po-project-row { min-height: 94px; border: 1px solid var(--dsw-alias-border-l2, #e5e7eb); border-radius: 7px; margin-bottom: 10px; padding: 12px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; }
  .po-project-row > span:nth-child(4), .po-project-row > span:nth-child(6) { display: none; }
  .po-project-row > span:nth-child(3), .po-project-row > span:nth-child(5) { align-self: center; }
  .po-project-row > span:nth-child(5) { justify-self: end; }
  .po-project-row > span:last-child { grid-column: 1 / -1; font-size: 11px; }
  .po-project-tabs { padding: 0 8px; }
  .po-project-tabs button { min-height: 44px; padding: 0 12px; }
  .po-project-summary-band { min-height: auto; grid-template-columns: repeat(2, minmax(0, 1fr)); padding: 14px; gap: 14px 12px; }
  .po-project-directory { margin: 0 14px; grid-template-columns: 1fr; align-items: stretch; gap: 10px; }
  .po-directory-fact > strong { white-space: normal; overflow-wrap: anywhere; }
  .po-directory-actions { display: grid; grid-template-columns: 1fr 1fr; justify-content: stretch; }
  .po-directory-actions .po-button { width: 100%; justify-content: center; }
  .po-orchestration-strip { margin: 14px 14px 0; grid-template-columns: 1fr 1fr; }
  .po-orchestration-strip h2 { grid-column: 1 / -1; }
  .po-orchestration-strip button { min-height: 62px; border-left: 0; border-top: 1px solid var(--dsw-alias-border-l3, #eeeeef); }
  .po-orchestration-strip button:nth-of-type(even) { border-left: 1px solid var(--dsw-alias-border-l3, #eeeeef); }
  .po-project-tab-body { padding: 16px 14px 30px; }
  .po-project-tab-body > .po-section-heading, .po-project-squad-bindings > .po-section-heading, .po-project-members-section > .po-section-heading { align-items: stretch; flex-direction: column; }
  .po-binding-row { min-height: 0; padding: 14px 0; grid-template-columns: 1fr; gap: 8px; }
  .po-binding-actions { justify-content: flex-start; }
  .po-binding-actions .po-button { min-height: 44px; }
  .po-binding-replacement { grid-column: 1; align-items: stretch; flex-direction: column; }
  .po-binding-replacement label { width: 100%; }
  .po-member-head { display: none; }
  .po-member-row { min-height: 0; padding: 14px 0; grid-template-columns: 1fr 1fr; align-items: start; }
  .po-member-row > span:first-child, .po-member-row > span:nth-child(3), .po-member-actions { grid-column: 1 / -1; }
  .po-member-actions { justify-content: flex-start; }
  .po-member-actions .po-button { min-height: 44px; }
  .po-agent-picker-row, .po-batch-row { grid-template-columns: 1fr; }
  .po-trigger-picker > div { grid-template-columns: 1fr; }
  .po-trigger-picker label, .po-fixed-policy { min-height: 44px; }
  .po-field-toolbar { align-items: flex-start; flex-wrap: wrap; }
  .po-agent-picker-row > label { min-height: 44px; }
  .po-panel-actions .po-button { min-height: 44px; width: 100%; }
  .po-agent-join-panel { margin: 14px 14px 0; }
  .po-project-summary-band strong { white-space: normal; overflow-wrap: anywhere; }
  .po-lifecycle-stepper { grid-template-columns: 1fr; gap: 6px; border-top: 0; }
  .po-lifecycle-stepper li { padding: 0; }
  .po-lifecycle-stepper li:not(.current):not(.done) { display: none; }
  .po-project-diagnostic { margin: 14px 14px 0; flex-direction: column; gap: 12px; }
  .po-project-diagnostic-actions { width: 100%; justify-content: flex-start; }
  .po-project-diagnostic-actions details { width: 100%; }
  .po-project-diagnostic-actions pre { position: static; width: auto; max-height: 180px; margin-top: 8px; }
  .po-approval-summary, .po-intervention-panel { flex-direction: column; gap: 4px; }
  .po-delivery-gate, .po-document-section, .po-project-task-section, .po-run-summary { margin: 14px 14px 0; padding: 14px; }
  .po-project-content-grid { padding: 0; gap: 0; }
  .po-project-context-grid { padding: 14px 14px 0; grid-template-columns: 1fr; }
  .po-inbox-layout { padding: 14px; grid-template-columns: 1fr; }
  .po-workload-panel { order: -1; }
  .po-inbox-item { padding: 12px; }
  .po-entity-list { padding: 10px 14px 24px; }
  .po-management-list { padding: 0 14px 24px; }
  .po-management-row { min-height: 100px; padding: 12px 4px; grid-template-columns: minmax(0, 1fr) auto 16px; gap: 8px 10px; }
  .po-management-row > span:nth-child(2), .po-management-row > span:nth-child(3) { grid-column: 1 / 3; }
  .po-management-row > span:nth-child(4) { grid-column: 2; grid-row: 1; align-self: start; }
  .po-management-row > svg { grid-column: 3; grid-row: 1 / 4; }
  .po-drawer-backdrop { position: fixed; }
  .po-drawer { width: 100%; border-left: 0; box-shadow: none; }
  .po-drawer > header { min-height: 64px; padding: 10px 14px; }
  .po-drawer-body { padding: 16px 14px; }
  .po-drawer > footer { padding: 9px 12px; }
  .po-drawer > footer .po-button { min-height: 44px; flex: 1 1 140px; }
  .po-member-picker > div, .po-resource-binding { grid-template-columns: 1fr; }
  .po-field-toolbar { align-items: flex-start; }
  .po-field-toolbar .po-button { min-height: 44px; }
  .po-trigger-picker > div { grid-template-columns: 1fr; }
  .po-trigger-picker label { min-height: 52px; padding: 8px 4px; }
  .po-trigger-picker label:nth-child(odd) { border-right: 0; }
  .po-trigger-picker input { width: 20px; height: 20px; margin-top: 0; }
  .po-fixed-policy { align-items: flex-start; flex-direction: column; gap: 3px; }
  .po-squad-diagnostics li { grid-template-columns: 1fr; gap: 2px; }
  .po-squad-availability-row { grid-template-columns: 1fr; gap: 4px; }
  .po-squad-availability-row .po-link-button { justify-self: start; }
  .po-project-squads { margin: 14px 14px 0; padding: 12px; }
  .po-detail-facts, .po-local-data dl { grid-template-columns: 105px minmax(0, 1fr); }
  .po-local-data { padding: 16px 14px 30px; }
  .po-entity-row { min-height: 86px; padding: 12px 4px; grid-template-columns: minmax(0, 1fr) auto 16px; gap: 10px; }
  .po-entity-row > span:nth-child(3) { grid-column: 1 / 3; grid-row: 2; }
  .po-entity-row > svg { grid-column: 3; grid-row: 1 / 3; }
  .po-entity-panel { padding: 14px 0; }
  .po-entity-panel dl, .po-run-disclosure dl { grid-template-columns: 100px minmax(0, 1fr); }
  .po-info-banner { margin: 12px 14px 0; }
  .po-command-bar { align-items: stretch; }
  .po-command-bar > * { width: 100%; }
  .po-run-disclosure summary, .po-artifact-list summary { align-items: flex-start; flex-direction: column; padding: 8px 0; }
  .po-context-panel { padding: 12px; }
  .po-project-artifacts { margin: 14px 14px 0; }
  .po-gate-actions { display: grid; grid-template-columns: 1fr; }
  .po-project-task-row { grid-template-columns: 44px minmax(0, 1fr) auto; }
  .po-project-task-row > svg { display: none; }
  .po-agent-list { padding: 0 14px 24px; }
  .po-agent-row { grid-template-columns: 38px minmax(0, 1fr) 20px; }
  .po-agent-row > span:nth-child(3), .po-agent-row > span:nth-child(4), .po-agent-row > span:nth-child(5) { display: none; }
  .po-agent-profile-grid { padding: 14px; grid-template-columns: 1fr; }
  .po-builder-intro { margin-bottom: 24px; padding-top: 28px; }
  .po-builder-intro h2 { font-size: 23px; line-height: 30px; }
  .po-builder-options { width: calc(100% - 28px); grid-template-columns: 1fr; padding-bottom: 24px; }
  .po-builder-options button { min-height: 178px; }
  .po-builder-options strong { margin-top: 24px; }
  .po-agent-builder-page { overflow: hidden; }
  .po-agent-builder-page:has(.po-agent-builder-layout:not(.po-agent-studio)) { overflow: auto; }
  .po-agent-builder-layout:not(.po-agent-studio) { min-height: auto; flex: 0 0 auto; display: flex; flex-direction: column; overflow: visible; }
  .po-agent-builder-layout:not(.po-agent-studio) .po-agent-preview, .po-agent-builder-layout:not(.po-agent-studio) .po-agent-config { min-height: calc(100vh - 124px); }
  .po-agent-preview { padding: 40px 20px; border-right: 0; border-bottom: 1px solid var(--dsw-alias-border-l2, #e5e7eb); }
  .po-studio-pane-tabs { min-height: 44px; flex: 0 0 auto; padding: 5px 14px; display: grid; grid-template-columns: 1fr 1fr; gap: 4px; border-bottom: 1px solid var(--dsw-alias-border-l2, #e5e7eb); background: var(--dsw-alias-bg-base, #fff); }
  .po-studio-pane-tabs button { min-height: 34px; border: 0; border-radius: 5px; display: inline-flex; align-items: center; justify-content: center; gap: 5px; color: var(--dsw-alias-label-secondary, #52525b); background: transparent; }
  .po-studio-pane-tabs button[aria-selected="true"] { color: var(--dsw-alias-label-primary, #18181b); background: var(--dsw-alias-interactive-bg-active, #e9e9eb); font-weight: 650; }
  .po-agent-studio { min-height: 0; flex: 1 1 auto; display: block; overflow: hidden; }
  .po-agent-studio .po-studio-pane { width: 100%; height: 100%; min-height: 0; display: none; border: 0; }
  .po-agent-studio .po-studio-pane-active { display: flex; }
  .po-agent-studio .po-agent-config { min-height: 0; }
  .po-builder-chat-title { min-height: 54px; padding: 10px 14px; }
  .po-chat-history { padding: 20px 14px; }
  .po-chat-user { max-width: 88%; }
  .po-chat-agent { max-width: 100%; }
  .po-chat-composer { min-height: 78px; margin: 0 12px 12px; grid-template-columns: minmax(0, 1fr) 44px; }
  .po-chat-composer button { width: 44px; height: 44px; }
  .po-config-scroll { padding: 18px 16px 28px; }
  .po-instructions-editor { min-height: 240px; }
  .po-config-disclosure summary { min-height: 68px; }
  .po-choice-group { grid-template-columns: 1fr; }
  .po-choice-group button { min-height: 58px; }
  .po-studio-footer { min-height: 62px; padding: 9px 12px; }
  .po-studio-footer > span { display: none; }
  .po-studio-footer > div { width: 100%; }
  .po-studio-footer .po-button, .po-agent-manual-form .po-config-footer .po-button { min-height: 44px; flex: 1 1 0; }
  .po-agent-manual-form .po-config-footer { padding: 9px 12px; }
  .po-modal-backdrop, .po-confirm-backdrop { padding: 0; align-items: end; }
  .po-directory-browser-backdrop { padding: 0; align-items: end; }
  .po-directory-browser { width: 100%; max-height: calc(100vh - 20px); border-radius: 8px 8px 0 0; }
  .po-directory-browser > footer { flex-wrap: wrap; }
  .po-directory-current { width: 100%; flex: 1 0 100%; }
  .po-directory-browser > footer .po-button { min-height: 44px; flex: 1 1 140px; }
  .po-modal, .po-modal-wide { width: 100%; max-height: calc(100vh - 20px); border-radius: 8px 8px 0 0; }
  .po-confirm-dialog { width: 100%; border-radius: 8px 8px 0 0; padding: 18px 14px; }
  .po-confirm-actions { margin-top: 16px; }
  .po-confirm-actions .po-button { min-height: 44px; flex: 1 1 0; }
  .po-modal-body { padding: 16px 14px; }
  .po-form-grid, .po-field-pair, .po-project-mode { grid-template-columns: 1fr; }
  .po-project-mode-option { min-height: 88px; }
  .po-directory-control { align-items: stretch; flex-direction: column; }
  .po-directory-control .po-button { min-height: 44px; }
  .po-modal > footer { flex-wrap: wrap; }
  .po-modal > footer .po-button { min-height: 44px; flex: 1 1 150px; }
  .po-field-wide { grid-column: auto; }
  .po-intake-intro { padding-top: 4px; }
  .po-brief-editor { min-height: 200px; }
  .po-intake-file-actions { align-items: stretch; flex-wrap: wrap; }
  .po-intake-file-actions span { width: 100%; }
  .po-intake-file-actions button { min-height: 44px; flex: 1 1 140px; }
  .po-project-form-identity { grid-template-columns: 40px minmax(0, 1fr); padding-left: 0; padding-right: 0; }
  .po-project-glyph { width: 40px; height: 40px; }
  .po-project-form-identity input { font-size: 20px; }
}
@media (prefers-reduced-motion: reduce) {
  .po-workbench * { scroll-behavior: auto !important; transition-duration: 0ms !important; animation-duration: 0ms !important; }
  .po-task-card:hover { transform: none; }
}
`
