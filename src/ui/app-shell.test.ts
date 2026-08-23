import { beforeEach, describe, expect, it } from 'vitest';

import { createAppShell } from './app-shell';
import { createInspector } from './inspector';

class MockElement {
  tagName: string;
  className = '';
  id = '';
  children: MockElement[] = [];
  attributes = new Map<string, string>();
  textContent = '';
  title = '';

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  get classList() {
    return {
      contains: (cls: string) => this.className.split(/\s+/).includes(cls),
      add: (cls: string) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        classes.add(cls);
        this.className = Array.from(classes).join(' ');
      },
      remove: (cls: string) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        classes.delete(cls);
        this.className = Array.from(classes).join(' ');
      },
    };
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  append(...nodes: (MockElement | string)[]) {
    nodes.forEach((node) => {
      if (typeof node === 'string') {
        this.textContent += node;
      } else {
        this.children.push(node);
      }
    });
  }

  contains(element: MockElement): boolean {
    if (this === element) return true;
    return this.children.some((child) => child.contains(element));
  }

  querySelector(selector: string): MockElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    const match = (el: MockElement): boolean => {
      if (selector.startsWith('.')) {
        return el.classList.contains(selector.slice(1));
      }
      if (selector.startsWith('#')) {
        return el.id === selector.slice(1);
      }
      return el.tagName.toLowerCase() === selector.toLowerCase();
    };

    const traverse = (el: MockElement) => {
      for (const child of el.children) {
        if (match(child)) results.push(child);
        traverse(child);
      }
    };
    traverse(this);
    return results;
  }
}

describe('AppShell layout and accessibility', () => {
  beforeEach(() => {
    (globalThis as unknown as { document: unknown }).document = {
      createElement: (tagName: string) => new MockElement(tagName),
    };
  });

  it('creates a complete AppShell with all structural hosts', () => {
    const header = document.createElement('div');
    header.id = 'mock-header';
    const sidebar = document.createElement('nav');
    sidebar.id = 'mock-sidebar';
    const workspace = document.createElement('div');
    workspace.id = 'mock-workspace';
    const diagnostics = document.createElement('div');
    diagnostics.id = 'mock-diagnostics';
    const inspector = createInspector({ title: 'Inspector Test' });

    const shell = createAppShell({
      header,
      sidebar,
      workspace,
      inspector,
      diagnostics,
    });

    expect(shell.classList.contains('app-shell')).toBe(true);
    expect(shell.id).toBe('app-shell');

    // Header Host
    expect(shell.headerHost).toBeDefined();
    expect(shell.headerHost.id).toBe('header-host');
    expect(shell.headerHost.getAttribute('role')).toBe('banner');
    expect(shell.headerHost.contains(header)).toBe(true);

    // Sidebar Host
    expect(shell.sidebarHost).toBeDefined();
    expect(shell.sidebarHost.id).toBe('sidebar-host');
    expect(shell.sidebarHost.getAttribute('aria-label')).toBeTruthy();
    expect(shell.sidebarHost.contains(sidebar)).toBe(true);

    // Workspace Host
    expect(shell.workspaceHost).toBeDefined();
    expect(shell.workspaceHost.id).toBe('workspace-host');
    expect(shell.workspaceHost.getAttribute('role')).toBe('main');
    expect(shell.workspaceHost.getAttribute('aria-label')).toBeTruthy();
    expect(shell.workspaceHost.contains(workspace)).toBe(true);

    // Diagnostics Host
    expect(shell.diagnosticsHost).toBeDefined();
    expect(shell.diagnosticsHost.id).toBe('diagnostics-host');
    expect(shell.diagnosticsHost.getAttribute('role')).toBe('region');
    expect(shell.diagnosticsHost.getAttribute('aria-label')).toBeTruthy();
    expect(shell.diagnosticsHost.contains(diagnostics)).toBe(true);

    // Inspector Host
    expect(shell.inspectorHost).toBeDefined();
    expect(shell.inspectorHost.id).toBe('inspector-host');
    expect(shell.inspectorHost.getAttribute('role')).toBe('complementary');
    expect(shell.inspectorHost.getAttribute('aria-label')).toBeTruthy();
    expect(shell.inspectorHost.contains(inspector)).toBe(true);
  });

  it('renders gracefully when optional inspector or diagnostics are omitted', () => {
    const header = document.createElement('div');
    const sidebar = document.createElement('div');
    const workspace = document.createElement('div');

    const shell = createAppShell({
      header,
      sidebar,
      workspace,
    });

    expect(shell.headerHost.contains(header)).toBe(true);
    expect(shell.sidebarHost.contains(sidebar)).toBe(true);
    expect(shell.workspaceHost.contains(workspace)).toBe(true);
    expect(shell.diagnosticsHost.children.length).toBe(0);
    expect(shell.inspectorHost.children.length).toBe(0);
  });

  it('does not add has-inspector class when inspector is empty so workspace reclaims space', () => {
    const header = document.createElement('div');
    const sidebar = document.createElement('div');
    const workspace = document.createElement('div');
    const emptyInspector = createInspector(); // empty without content

    const shell = createAppShell({
      header,
      sidebar,
      workspace,
      inspector: emptyInspector,
    });

    const layout = shell.querySelector('.app-shell-layout');
    expect(layout?.classList.contains('has-inspector')).toBe(false);
  });

  it('adds has-inspector class when inspector has populated content', () => {
    const header = document.createElement('div');
    const sidebar = document.createElement('div');
    const workspace = document.createElement('div');
    const content = document.createElement('div');
    content.textContent = 'Active properties';
    const populatedInspector = createInspector({
      title: 'Contextual Inspector',
      content,
    });

    const shell = createAppShell({
      header,
      sidebar,
      workspace,
      inspector: populatedInspector,
    });

    const layout = shell.querySelector('.app-shell-layout');
    expect(layout?.classList.contains('has-inspector')).toBe(true);
  });
});
