import { t } from '../i18n';

export interface AppShellOptions {
  readonly header: HTMLElement;
  readonly sidebar: HTMLElement;
  readonly workspace: HTMLElement;
  readonly inspector?: HTMLElement | null;
  readonly diagnostics?: HTMLElement | null;
}

export interface AppShellElement extends HTMLElement {
  readonly headerHost: HTMLElement;
  readonly sidebarHost: HTMLElement;
  readonly workspaceHost: HTMLElement;
  readonly inspectorHost: HTMLElement;
  readonly diagnosticsHost: HTMLElement;
}

export function createAppShell(options: AppShellOptions): AppShellElement {
  const shell = document.createElement('div') as unknown as AppShellElement;
  shell.className = 'app-shell';
  shell.id = 'app-shell';

  // 1. Project Header Host
  const headerHost = document.createElement('header');
  headerHost.className = 'app-shell-header-host';
  headerHost.id = 'header-host';
  headerHost.setAttribute('role', 'banner');
  headerHost.append(options.header);

  // 2. Layout container (Sidebar + Main Workspace Area + Inspector)
  const layout = document.createElement('div');
  layout.className = 'app-shell-layout';

  // Sidebar Host
  const sidebarHost = document.createElement('aside');
  sidebarHost.className = 'app-shell-sidebar-host';
  sidebarHost.id = 'sidebar-host';
  sidebarHost.setAttribute('aria-label', t('sidebarLabel'));
  sidebarHost.append(options.sidebar);

  // Main area containing Workspace Host + Diagnostics Host
  const mainArea = document.createElement('div');
  mainArea.className = 'app-shell-main-area';

  // Workspace Host
  const workspaceHost = document.createElement('main');
  workspaceHost.className = 'app-shell-workspace-host';
  workspaceHost.id = 'workspace-host';
  workspaceHost.setAttribute('role', 'main');
  workspaceHost.setAttribute('aria-label', t('workspaceHostLabel'));
  workspaceHost.append(options.workspace);

  // Diagnostics / Status Host
  const diagnosticsHost = document.createElement('section');
  diagnosticsHost.className = 'app-shell-diagnostics-host';
  diagnosticsHost.id = 'diagnostics-host';
  diagnosticsHost.setAttribute('role', 'region');
  diagnosticsHost.setAttribute('aria-label', t('diagnosticsHostLabel'));
  if (options.diagnostics) {
    diagnosticsHost.append(options.diagnostics);
  }

  mainArea.append(workspaceHost, diagnosticsHost);

  // Inspector Host
  const inspectorHost = document.createElement('aside');
  inspectorHost.className = 'app-shell-inspector-host';
  inspectorHost.id = 'inspector-host';
  inspectorHost.setAttribute('role', 'complementary');
  inspectorHost.setAttribute('aria-label', t('inspectorLabel'));
  if (options.inspector) {
    inspectorHost.append(options.inspector);
    if (!options.inspector.classList.contains('is-empty')) {
      layout.classList.add('has-inspector');
    }
  }

  layout.append(sidebarHost, mainArea, inspectorHost);
  shell.append(headerHost, layout);

  Object.defineProperties(shell, {
    headerHost: { value: headerHost, enumerable: true },
    sidebarHost: { value: sidebarHost, enumerable: true },
    workspaceHost: { value: workspaceHost, enumerable: true },
    inspectorHost: { value: inspectorHost, enumerable: true },
    diagnosticsHost: { value: diagnosticsHost, enumerable: true },
  });

  return shell;
}
