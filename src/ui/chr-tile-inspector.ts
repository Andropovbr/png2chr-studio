import type { AnimationProjectModel } from '../core/animation-model';
import {
  classifyChrSlots,
  computeTileAddressingMetadata,
  type ChrTileReference,
  type ChrTileUsageDiagnostic,
  type SpritePatternTable,
  type TileAddressingMetadata,
} from '../core/chr-pattern-table';
import type { Tile } from '../core/types';
import { t } from '../i18n';
import type { ProjectMode } from './types';

export const NEUTRAL_NES_GRAYSCALE = [
  { red: 15, green: 22, blue: 32 }, // 0: background tone
  { red: 116, green: 116, blue: 116 }, // 1: NES $00
  { red: 188, green: 188, blue: 188 }, // 2: NES $10
  { red: 255, green: 255, blue: 255 }, // 3: NES $30
] as const;

export type TileSlotState = 'empty' | 'project' | 'base' | 'reserved';

export interface TileSlotDiagnosis {
  readonly state: TileSlotState;
  readonly stateLabel: string;
  readonly attribution: string;
}

export interface ChrTileInspectorOptions {
  readonly selectedTileIndex: number | null;
  readonly finalChrBytes: Uint8Array;
  readonly mode?: ProjectMode;
  readonly animationModel?: AnimationProjectModel | null;
  readonly baseChr?: Uint8Array | null;
  readonly baseChrName?: string | null;
  readonly destinationPatternTable?: SpritePatternTable;
  readonly tiles?: readonly Tile[];
  readonly colors?: readonly {
    readonly red: number;
    readonly green: number;
    readonly blue: number;
  }[];
  readonly isHighlighted?: boolean;
  readonly highlightScopeLabel?: string | null;
  readonly references?: readonly ChrTileReference[];
  readonly diagnostic?: ChrTileUsageDiagnostic | null;
  readonly heatmapEnabled?: boolean;
  readonly onNavigateToReference?: (reference: ChrTileReference) => void;
  readonly onDeselect?: () => void;
}

export function resolveTileSlotDiagnosis(
  physicalIndex: number,
  finalChrBytes: Uint8Array,
  mode: ProjectMode = 'tileset',
  animationModel: AnimationProjectModel | null = null,
  baseChr: Uint8Array | null = null,
  baseChrName: string | null = null,
  destinationPatternTable: SpritePatternTable = 0,
  tiles: readonly Tile[] = [],
  deduplicationEnabled = true,
  flipDeduplicationEnabled = false,
): TileSlotDiagnosis {
  const classifications = classifyChrSlots({
    mode,
    animationModel,
    baseChr,
    baseChrName,
    destinationPatternTable,
    tiles,
    deduplicationEnabled,
    flipDeduplicationEnabled,
    finalChrBytes,
  });

  const slot = classifications[physicalIndex] ?? {
    occupancy: 'empty',
  };

  switch (slot.occupancy) {
    case 'base':
      return {
        state: 'base',
        stateLabel: t('chrTileInspectorStateBase'),
        attribution:
          slot.attribution ??
          (baseChrName
            ? t('chrTileInspectorBaseAttribution', { name: baseChrName })
            : t('chrTileInspectorStateBase')),
      };
    case 'project':
      return {
        state: 'project',
        stateLabel: t('chrTileInspectorStateProject'),
        attribution: slot.attribution ?? t('chrTileInspectorStateProject'),
      };
    case 'reserved':
      return {
        state: 'reserved',
        stateLabel: t('chrTileInspectorStateReserved'),
        attribution: slot.attribution ?? t('chrTileInspectorStateReserved'),
      };
    case 'empty':
    default:
      return {
        state: 'empty',
        stateLabel: t('chrTileInspectorStateEmpty'),
        attribution: t('chrTileInspectorNoAttribution'),
      };
  }
}

export function renderEnlargedTileCanvas(
  canvas: HTMLCanvasElement,
  chrBytes: Uint8Array,
  physicalIndex: number,
  scale = 16,
  colors: readonly {
    readonly red: number;
    readonly green: number;
    readonly blue: number;
  }[] = NEUTRAL_NES_GRAYSCALE,
): void {
  const context = canvas.getContext('2d');
  if (context === null) {
    return;
  }

  const startByte = physicalIndex * 16;
  const tileBytes =
    chrBytes.length >= startByte + 16
      ? chrBytes.subarray(startByte, startByte + 16)
      : new Uint8Array(16);

  const canvasWidth = 8 * scale;
  const canvasHeight = 8 * scale;
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  const imageData = context.createImageData(canvasWidth, canvasHeight);
  const data = imageData.data;

  for (let py = 0; py < 8; py += 1) {
    const plane0 = tileBytes[py] ?? 0;
    const plane1 = tileBytes[py + 8] ?? 0;

    for (let px = 0; px < 8; px += 1) {
      const bit = 7 - px;
      const colorVal = ((plane0 >> bit) & 1) | (((plane1 >> bit) & 1) << 1);
      const fallbackColor = colors[0] ?? { red: 0, green: 0, blue: 0 };
      const color = colors[colorVal] ?? fallbackColor;

      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const pixelX = px * scale + sx;
          const pixelY = py * scale + sy;
          const offset = (pixelY * canvasWidth + pixelX) * 4;
          data[offset] = color.red;
          data[offset + 1] = color.green;
          data[offset + 2] = color.blue;
          data[offset + 3] = 255;
        }
      }
    }
  }

  context.putImageData(imageData, 0, 0);
}

export function createChrTileInspector(
  options: ChrTileInspectorOptions,
): HTMLElement {
  const panel = document.createElement('section');
  const isSelected = options.selectedTileIndex !== null;
  panel.className = `panel chr-tile-inspector-panel${isSelected ? '' : ' is-empty'}`;
  panel.id = 'section-chr-tile-inspector';
  panel.setAttribute('aria-label', t('chrTileInspectorTitle'));

  // Header
  const header = document.createElement('div');
  header.className = 'chr-tile-inspector-header';

  const titleGroup = document.createElement('div');
  titleGroup.className = 'chr-tile-inspector-title-group';

  const heading = document.createElement('h3');
  heading.className = 'chr-tile-inspector-title';
  heading.textContent = t('chrTileInspectorTitle');

  titleGroup.append(heading);

  if (options.selectedTileIndex !== null) {
    let meta: TileAddressingMetadata;
    try {
      meta = computeTileAddressingMetadata(options.selectedTileIndex);
    } catch {
      meta = computeTileAddressingMetadata(0);
    }

    const subtitle = document.createElement('span');
    subtitle.className = 'chr-tile-inspector-target';
    subtitle.textContent = `PT${String(meta.patternTable)} Slot ${meta.localIndexHex} (#${String(meta.physicalIndex)})`;
    titleGroup.append(subtitle);

    if (options.onDeselect) {
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className =
        'button secondary-button chr-tile-inspector-deselect-btn';
      closeBtn.textContent = t('chrTileInspectorDeselect');
      closeBtn.setAttribute('aria-label', t('chrTileInspectorDeselect'));
      closeBtn.addEventListener('click', options.onDeselect);
      header.append(titleGroup, closeBtn);
    } else {
      header.append(titleGroup);
    }

    panel.append(header);

    // Contextual Content Container
    const content = document.createElement('div');
    content.className = 'chr-tile-inspector-content';

    // 1. Enlarged Tile Preview (16x scale / 128x128)
    const previewSection = document.createElement('div');
    previewSection.className = 'chr-tile-inspector-preview-section';

    const previewWrapper = document.createElement('div');
    previewWrapper.className = 'chr-tile-inspector-preview-wrapper';

    const canvas = document.createElement('canvas');
    canvas.className = 'chr-tile-inspector-canvas';
    canvas.width = 128;
    canvas.height = 128;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute(
      'aria-label',
      `Tile ${meta.physicalIndexHex} Preview (16×)`,
    );

    renderEnlargedTileCanvas(
      canvas,
      options.finalChrBytes,
      options.selectedTileIndex,
      16,
      options.colors ?? NEUTRAL_NES_GRAYSCALE,
    );

    const gridOverlay = document.createElement('div');
    gridOverlay.className = 'chr-tile-inspector-pixel-grid is-visible';
    for (let i = 0; i < 64; i += 1) {
      const cell = document.createElement('div');
      cell.className = 'chr-pixel-grid-cell';
      gridOverlay.append(cell);
    }

    previewWrapper.append(canvas, gridOverlay);

    const gridToggle = document.createElement('button');
    gridToggle.type = 'button';
    gridToggle.className = 'button secondary-button chr-tile-grid-toggle';
    gridToggle.textContent = t('chrTileInspectorGridToggle');
    gridToggle.setAttribute('aria-pressed', 'true');
    gridToggle.addEventListener('click', () => {
      const isVisible = gridOverlay.classList.contains('is-visible');
      if (isVisible) {
        gridOverlay.classList.remove('is-visible');
        gridToggle.setAttribute('aria-pressed', 'false');
        gridToggle.classList.remove('is-active');
      } else {
        gridOverlay.classList.add('is-visible');
        gridToggle.setAttribute('aria-pressed', 'true');
        gridToggle.classList.add('is-active');
      }
    });

    previewSection.append(previewWrapper, gridToggle);

    // 2. Metadata Metrics List
    const diagnosis = resolveTileSlotDiagnosis(
      options.selectedTileIndex,
      options.finalChrBytes,
      options.mode,
      options.animationModel,
      options.baseChr,
      options.baseChrName,
      options.destinationPatternTable,
      options.tiles,
    );

    const metricsList = document.createElement('dl');
    metricsList.className = 'metrics chr-tile-inspector-metrics';

    const addMetric = (
      label: string,
      valueNode: string | HTMLElement,
      className?: string,
    ): void => {
      const item = document.createElement('div');
      if (className) item.className = className;
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      if (typeof valueNode === 'string') {
        dd.textContent = valueNode;
      } else {
        dd.append(valueNode);
      }
      item.append(dt, dd);
      metricsList.append(item);
    };

    // Global Physical Index
    const physicalVal = document.createElement('span');
    const physicalStrong = document.createElement('strong');
    physicalStrong.textContent = String(meta.physicalIndex);
    const physicalHexSpan = document.createElement('span');
    physicalHexSpan.className = 'muted';
    physicalHexSpan.textContent = ` (${meta.physicalIndexHex})`;
    physicalVal.append(physicalStrong, physicalHexSpan);
    addMetric(t('chrTileInspectorPhysicalIndex'), physicalVal);

    // Local Pattern Table Index
    const localVal = document.createElement('span');
    const localStrong = document.createElement('strong');
    localStrong.textContent = String(meta.localIndex);
    const localHexSpan = document.createElement('span');
    localHexSpan.className = 'muted';
    localHexSpan.textContent = ` (${meta.localIndexHex})`;
    localVal.append(localStrong, localHexSpan);
    addMetric(t('chrTileInspectorLocalIndex'), localVal);

    // Pattern Table Identifier
    addMetric(t('chrTileInspectorPatternTable'), meta.patternTableLabel);

    // CHR-ROM Start Offset
    const startVal = document.createElement('span');
    const startStrong = document.createElement('strong');
    startStrong.textContent = meta.startByteOffsetHex;
    const startDecSpan = document.createElement('span');
    startDecSpan.className = 'muted';
    startDecSpan.textContent = ` (${String(meta.startByteOffset)})`;
    startVal.append(startStrong, startDecSpan);
    addMetric(t('chrTileInspectorStartOffset'), startVal);

    // Bitplane 0 Offset
    const bp0Val = document.createElement('span');
    bp0Val.textContent = meta.plane0OffsetHex;
    const bp0Rel = document.createElement('span');
    bp0Rel.className = 'muted';
    bp0Rel.textContent = ' (+0)';
    bp0Val.append(bp0Rel);
    addMetric(t('chrTileInspectorBitplane0'), bp0Val);

    // Bitplane 1 Offset
    const bp1Val = document.createElement('span');
    bp1Val.textContent = meta.plane1OffsetHex;
    const bp1Rel = document.createElement('span');
    bp1Rel.className = 'muted';
    bp1Rel.textContent = ' (+8)';
    bp1Val.append(bp1Rel);
    addMetric(t('chrTileInspectorBitplane1'), bp1Val);

    // Slot State Badge
    const stateBadge = document.createElement('span');
    stateBadge.className = `status-badge chr-slot-state-badge state-${diagnosis.state}`;
    stateBadge.textContent = diagnosis.stateLabel;
    addMetric(t('chrTileInspectorSlotState'), stateBadge);

    // Source Attribution
    const attrText = document.createElement('span');
    attrText.className = 'chr-attribution-text';
    attrText.textContent = diagnosis.attribution;
    addMetric(t('chrTileInspectorAttribution'), attrText);

    // Active Highlight Status (if highlighted in active scope)
    if (options.isHighlighted && options.highlightScopeLabel) {
      const highlightBadge = document.createElement('span');
      highlightBadge.className =
        'status-badge chr-tile-highlight-badge is-highlighted';
      highlightBadge.textContent = t('chrTileInspectorHighlightedBadge', {
        scope: options.highlightScopeLabel,
      });
      addMetric(t('chrWorkspaceHighlightLabel'), highlightBadge);
    }

    // 3. Reuse & Usage Diagnostics Section
    const diag = options.diagnostic;
    let usageSection: HTMLElement | null = null;
    if (diag !== undefined && diag !== null) {
      usageSection = document.createElement('div');
      usageSection.className = 'chr-tile-usage-section';

      const usageHeader = document.createElement('div');
      usageHeader.className = 'chr-tile-usage-header';

      const usageTitle = document.createElement('h4');
      usageTitle.className = 'chr-tile-usage-title';
      usageTitle.textContent = t('chrTileInspectorUsageTitle');

      let badgeText: string;
      let badgeClass = `status-badge chr-tile-usage-badge bucket-${diag.bucket}`;

      if (diag.referenceCount === 0) {
        if (diagnosis.state === 'project') {
          badgeText = t('chrTileInspectorUnreferencedProject');
          badgeClass += ' is-unreferenced-occupied';
        } else if (diagnosis.state === 'base') {
          badgeText = t('chrTileInspectorUnreferencedBase');
          badgeClass += ' is-unreferenced-base';
        } else {
          badgeText = t('chrTileInspectorUsageBucketUnused');
        }
      } else if (diag.referenceCount === 1) {
        badgeText = t('chrTileInspectorUsageBucketSingle');
      } else if (diag.referenceCount <= 3) {
        badgeText = t('chrTileInspectorUsageBucketModerate', {
          count: diag.referenceCount,
        });
      } else if (diag.referenceCount <= 7) {
        badgeText = t('chrTileInspectorUsageBucketHigh', {
          count: diag.referenceCount,
        });
      } else {
        badgeText = t('chrTileInspectorUsageBucketVeryHigh', {
          count: diag.referenceCount,
        });
      }

      const usageBadge = document.createElement('span');
      usageBadge.className = badgeClass;
      usageBadge.textContent = badgeText;

      usageHeader.append(usageTitle, usageBadge);
      usageSection.append(usageHeader);

      if (diag.referenceCount > 0) {
        const chipsGrid = document.createElement('div');
        chipsGrid.className = 'chr-tile-usage-chips';

        const addChip = (label: string, value: number | string): void => {
          const chip = document.createElement('span');
          chip.className = 'chr-tile-usage-chip';
          chip.textContent = `${label}: ${String(value)}`;
          chipsGrid.append(chip);
        };

        addChip(t('chrTileInspectorReferenceCount'), diag.referenceCount);

        if (options.mode === 'animation' || diag.frameCount > 0) {
          addChip(t('chrTileInspectorDistinctFrames'), diag.frameCount);
          addChip(t('chrTileInspectorDistinctAnimations'), diag.animationCount);
          if (diag.entityCount > 0) {
            addChip(t('chrTileInspectorDistinctEntities'), diag.entityCount);
          }
        } else if (diag.resourceCount > 0) {
          addChip(t('chrTileInspectorResourceCount'), diag.resourceCount);
        }

        usageSection.append(chipsGrid);
      }
    }

    // 4. Reverse Lookup: "Used by" Section
    const usedBySection = document.createElement('div');
    usedBySection.className = 'chr-tile-used-by-section';

    const usedByHeader = document.createElement('div');
    usedByHeader.className = 'chr-tile-used-by-header';

    const usedByTitle = document.createElement('h4');
    usedByTitle.className = 'chr-tile-used-by-title';
    const references = options.references ?? [];
    usedByTitle.textContent = t('chrTileInspectorUsedBy', {
      count: references.length,
    });
    usedByHeader.append(usedByTitle);
    usedBySection.append(usedByHeader);

    if (references.length === 0) {
      const emptyRefs = document.createElement('p');
      emptyRefs.className = 'empty-message chr-tile-used-by-empty';
      emptyRefs.textContent = t('chrTileInspectorUsedByEmpty');
      usedBySection.append(emptyRefs);
    } else {
      const refList = document.createElement('div');
      refList.className = 'chr-tile-used-by-list';

      const INITIAL_VISIBLE_COUNT = 6;
      let showAll = false;

      const renderRefs = (): void => {
        const visibleRefs = showAll
          ? references
          : references.slice(0, INITIAL_VISIBLE_COUNT);

        const itemNodes: HTMLElement[] = [];

        visibleRefs.forEach((ref) => {
          const item = document.createElement('div');
          item.className = `chr-tile-ref-item ref-type-${ref.type}`;

          const infoWrap = document.createElement('div');
          infoWrap.className = 'chr-tile-ref-info';

          const typeBadge = document.createElement('span');
          typeBadge.className = `status-badge chr-tile-ref-badge badge-${ref.type}`;
          typeBadge.textContent =
            ref.type === 'animation'
              ? 'Animation'
              : ref.type === 'playfield'
                ? 'Playfield'
                : 'Tileset';

          const desc = document.createElement('span');
          desc.className = 'chr-tile-ref-desc';

          if (ref.type === 'animation') {
            const flips: string[] = [];
            if (ref.horizontalFlip) flips.push('Flip H');
            if (ref.verticalFlip) flips.push('Flip V');
            const flipText = flips.length > 0 ? ` [${flips.join(', ')}]` : '';
            const entityPrefix = ref.entity ? `${ref.entity} · ` : '';
            desc.textContent = `${entityPrefix}${ref.animationName} · Frame #${String(ref.frameIndex)} · sprite (${String(ref.x)}, ${String(ref.y)})${flipText}`;
          } else if (ref.type === 'playfield') {
            desc.textContent = `(${String(ref.column)}, ${String(ref.row)}) · tile $${ref.tileIndex.toString(16).toUpperCase().padStart(2, '0')}`;
          } else {
            desc.textContent = `tile #${String(ref.tileIndex)}${ref.sourceIndex !== undefined ? ` (src: ${String(ref.sourceIndex)})` : ''}`;
          }

          infoWrap.append(typeBadge, desc);

          if (options.onNavigateToReference) {
            const jumpBtn = document.createElement('button');
            jumpBtn.type = 'button';
            jumpBtn.className = 'button secondary-button chr-tile-ref-jump-btn';
            jumpBtn.textContent = t('chrTileInspectorJumpAction');
            if (ref.type === 'animation') {
              jumpBtn.title = t('chrTileInspectorJumpAnimation', {
                name: ref.animationName,
                frame: ref.frameIndex,
              });
            } else if (ref.type === 'playfield') {
              jumpBtn.title = t('chrTileInspectorJumpPlayfield', {
                col: ref.column,
                row: ref.row,
              });
            } else {
              jumpBtn.title = t('chrTileInspectorJumpTileset', {
                index: ref.tileIndex,
              });
            }
            jumpBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              options.onNavigateToReference?.(ref);
            });
            item.append(infoWrap, jumpBtn);
          } else {
            item.append(infoWrap);
          }

          itemNodes.push(item);
        });

        if (references.length > INITIAL_VISIBLE_COUNT) {
          const toggleMoreBtn = document.createElement('button');
          toggleMoreBtn.type = 'button';
          toggleMoreBtn.className =
            'button secondary-button chr-tile-refs-toggle-btn';
          toggleMoreBtn.textContent = showAll
            ? t('chrTileInspectorShowLessRefs')
            : t('chrTileInspectorShowAllRefs', {
                count: references.length,
              });
          toggleMoreBtn.addEventListener('click', () => {
            showAll = !showAll;
            renderRefs();
          });
          itemNodes.push(toggleMoreBtn);
        }

        refList.replaceChildren(...itemNodes);
      };

      renderRefs();
      usedBySection.append(refList);
    }

    if (usageSection) {
      content.append(previewSection, metricsList, usageSection, usedBySection);
    } else {
      content.append(previewSection, metricsList, usedBySection);
    }
    panel.append(content);
  } else {
    panel.append(header);
    const placeholder = document.createElement('p');
    placeholder.className = 'empty-message chr-tile-inspector-empty';
    placeholder.textContent = t('chrTileInspectorEmpty');
    panel.append(placeholder);
  }

  return panel;
}
