import type { QuantizationMode } from '../core/quantization-settings';
import { QUANTIZATION_MODES } from '../core/quantization-settings';
import { t, type TranslationKey } from '../i18n';
import type { WorkspaceView } from './workspace-state';

export interface SidebarOptions {
  readonly activeWorkspace: WorkspaceView;
  readonly fileName: string | null;
  readonly quantizationMode?: QuantizationMode;
  readonly onQuantizationModeChange?: (mode: QuantizationMode) => void;
  readonly onWorkspaceChange?: (workspace: WorkspaceView) => void;
}

const QUANTIZATION_LABELS: Record<QuantizationMode, TranslationKey> = {
  nearest: 'quantizationNearest',
  'median-cut': 'quantizationMedianCut',
  'k-means': 'quantizationKMeans',
};

export function createSidebar(options: SidebarOptions): HTMLElement {
  const sidebar = document.createElement('nav');
  sidebar.className = 'app-sidebar';
  sidebar.setAttribute('aria-label', t('sidebarLabel'));

  // 1. Workspaces navigation
  const workspacesSection = document.createElement('div');
  workspacesSection.className = 'sidebar-section sidebar-workspaces';

  const workspacesHeading = document.createElement('div');
  workspacesHeading.className = 'sidebar-section-heading';
  workspacesHeading.textContent = t('sidebarWorkspaces');

  const workspaceNav = document.createElement('div');
  workspaceNav.className = 'sidebar-nav-group';
  workspaceNav.setAttribute('role', 'group');
  workspaceNav.setAttribute('aria-label', t('sidebarWorkspaces'));

  const workspaces: readonly [WorkspaceView, TranslationKey][] = [
    ['tileset', 'tilesetMode'],
    ['playfield', 'playfieldMode'],
    ['animation', 'animationMode'],
    ['palette', 'palettesMode'],
    ['chr', 'chrMode'],
    ['deliver', 'deliverMode'],
  ];

  workspaces.forEach(([viewKey, labelKey]) => {
    const isActive = options.activeWorkspace === viewKey;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `sidebar-nav-item${isActive ? ' is-active' : ''}`;
    btn.textContent = t(labelKey);
    btn.setAttribute('aria-pressed', String(isActive));
    if (isActive) {
      btn.setAttribute('aria-current', 'page');
    }
    btn.addEventListener('click', () => {
      if (options.onWorkspaceChange) {
        options.onWorkspaceChange(viewKey);
      }
    });
    workspaceNav.append(btn);
  });

  workspacesSection.append(workspacesHeading, workspaceNav);

  // 2. Sections / Anchors navigation
  const sectionsGroup = document.createElement('div');
  sectionsGroup.className = 'sidebar-section sidebar-sections';

  const sectionsHeading = document.createElement('div');
  sectionsHeading.className = 'sidebar-section-heading';
  sectionsHeading.textContent = t('sidebarSections');

  const linksContainer = document.createElement('div');
  linksContainer.className = 'sidebar-links';

  const links: readonly (readonly [string, string])[] =
    options.activeWorkspace === 'deliver'
      ? [
          ['#section-delivery-readiness', t('deliveryReadinessTitle')],
          ['#section-delivery-diagnostics', t('diagnosticsTitle')],
          ['#section-delivery-artifacts', t('deliveryArtifactsTitle')],
          ['#section-delivery-links', t('deliveryLinksTitle')],
        ]
      : options.activeWorkspace === 'chr'
        ? [
            ['#section-chr-intro', t('chrWorkspaceIntroTitle')],
            ['#section-chr-viewer', t('chrWorkspaceViewerTitle')],
            ['#section-chr-occupancy', t('chrWorkspaceOccupancyTitle')],
            [
              '#section-chr-sprite-context',
              t('chrWorkspaceSpriteContextTitle'),
            ],
            ['#section-chr-tiles-reuse', t('chrWorkspaceReuseTitle')],
            ['#section-chr-export', t('chrWorkspaceExportTitle')],
          ]
        : options.activeWorkspace === 'palette'
          ? [
              ['#section-palettes-intro', t('paletteManagerTitle')],
              ['#section-active-slots', t('paletteManagerActiveSlotsTitle')],
              ['#section-palette-definitions', t('paletteManagerListTitle')],
              ['#section-palette-export', t('paletteWorkspaceExportTitle')],
            ]
          : options.activeWorkspace === 'animation'
            ? [
                ['#section-asset', t('navigationAsset')],
                ['#section-palettes', t('navigationPalettes')],
                ['#section-animations', t('navigationAnimations')],
                [
                  '#section-animation-editor',
                  t('animationSelectedEditorTitle'),
                ],
                ['#section-mapping', t('navigationMapping')],
                ['#section-export', t('navigationExport')],
              ]
            : [
                ['#section-image', t('navigationImage')],
                ['#section-palettes', t('navigationPalettes')],
                ['#section-tiles', t('navigationTiles')],
                ['#section-export', t('navigationExport')],
              ];

  links.forEach(([href, label]) => {
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.className = 'sidebar-link';
    anchor.textContent = label;
    linksContainer.append(anchor);
  });

  sectionsGroup.append(sectionsHeading, linksContainer);

  // 3. Meta / Quick settings
  const metaSection = document.createElement('div');
  metaSection.className = 'sidebar-section sidebar-meta';

  if (
    options.fileName !== null &&
    options.activeWorkspace !== 'palette' &&
    options.activeWorkspace !== 'chr' &&
    options.activeWorkspace !== 'deliver'
  ) {
    const file = document.createElement('div');
    file.className = 'sidebar-file';
    file.textContent = t('navigationImageValue', { name: options.fileName });
    file.title = options.fileName;
    metaSection.append(file);
  }

  if (
    options.activeWorkspace !== 'animation' &&
    options.activeWorkspace !== 'palette' &&
    options.activeWorkspace !== 'chr' &&
    options.activeWorkspace !== 'deliver' &&
    options.quantizationMode &&
    options.onQuantizationModeChange
  ) {
    const onQuantChange = options.onQuantizationModeChange;
    const currentMode = options.quantizationMode;
    const quantWrapper = document.createElement('div');
    quantWrapper.className = 'sidebar-quantization';

    const quantHeading = document.createElement('div');
    quantHeading.className = 'sidebar-subheading';
    quantHeading.textContent = t('quantizationModeLabel');

    const segmented = document.createElement('div');
    segmented.className = 'quantization-segmented';
    segmented.setAttribute('role', 'group');
    segmented.setAttribute('aria-label', t('quantizationModeLabel'));

    QUANTIZATION_MODES.forEach((mode) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `segmented-button${currentMode === mode ? ' is-active' : ''}`;
      button.setAttribute('aria-pressed', String(currentMode === mode));
      button.textContent = t(QUANTIZATION_LABELS[mode]);
      button.addEventListener('click', () => {
        onQuantChange(mode);
      });
      segmented.append(button);
    });

    quantWrapper.append(quantHeading, segmented);
    metaSection.append(quantWrapper);
  }

  sidebar.append(workspacesSection, sectionsGroup);
  if (metaSection.children.length > 0) {
    sidebar.append(metaSection);
  }

  return sidebar;
}
