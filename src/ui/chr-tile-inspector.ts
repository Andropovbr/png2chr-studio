import type { AnimationProjectModel } from '../core/animation-model';
import {
  classifyChrSlots,
  computeTileAddressingMetadata,
  findChrRegionsForPhysicalTile,
  formatTileRangeHex,
  sanitizeRegionColor,
  type ChrRegion,
  type ChrTileReference,
  type ChrTileUsageDiagnostic,
  type SpritePatternTable,
  type TileAddressingMetadata,
} from '../core/chr-pattern-table';
import {
  getPhysicalSlotAttribution,
  type ChrAssetMappingIndex,
  type PhysicalTileUsage,
} from '../core/chr-asset-mapping';
import {
  areTilePixelsEqual,
  cloneTilePixels,
  createTileHistory,
  decodeChrTileToPixels,
  type TileHistory,
} from '../core/chr-tile-editor';
import { createChrTileEditor, type ChrDrawingTool } from './chr-tile-editor';
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
  readonly highlightedAssetId?: string | null;
  readonly onHighlightAssetId?: (assetId: string | null) => void;
  readonly references?: readonly ChrTileReference[];
  readonly diagnostic?: ChrTileUsageDiagnostic | null;
  readonly heatmapEnabled?: boolean;
  readonly chrRegions?: readonly ChrRegion[];
  readonly mappingIndex?: ChrAssetMappingIndex;
  readonly onNavigateToReference?: (
    reference: ChrTileReference | PhysicalTileUsage,
  ) => void;
  readonly onNavigateToAnimation?: (
    animationId: string,
    frameIndex: number,
  ) => void;
  readonly onNavigateToPlayfield?: (column: number, row: number) => void;
  readonly onNavigateToTileset?: (tileIndex: number) => void;
  readonly onDeselect?: () => void;
  readonly onTilePixelsChange?: (
    physicalIndex: number,
    newPixels: Uint8Array,
  ) => void;
  readonly history?: TileHistory<Uint8Array>;
  readonly editorState?: {
    readonly activeTool: ChrDrawingTool;
    readonly selectedColorIndex: number;
    readonly showGrid: boolean;
    readonly shiftWrap: boolean;
  };
  readonly onEditorStateChange?: (state: {
    readonly activeTool: ChrDrawingTool;
    readonly selectedColorIndex: number;
    readonly showGrid: boolean;
    readonly shiftWrap: boolean;
  }) => void;
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
  chrRegions: readonly ChrRegion[] = [],
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
    chrRegions,
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

    // Interactive 8×8 CHR Tile Pixel Editor
    const selectedIdx = options.selectedTileIndex;
    const startByte = selectedIdx * 16;
    const tileBytes =
      options.finalChrBytes.length >= startByte + 16
        ? options.finalChrBytes.subarray(startByte, startByte + 16)
        : new Uint8Array(16);
    let localTilePixels = decodeChrTileToPixels(tileBytes);
    let localEditorState = options.editorState ?? {
      activeTool: 'pencil' as ChrDrawingTool,
      selectedColorIndex: 1,
      showGrid: true,
      shiftWrap: false,
    };
    const editorHistory =
      options.history ??
      createTileHistory(
        cloneTilePixels(localTilePixels),
        50,
        areTilePixelsEqual,
      );

    const editorContainer = document.createElement('div');
    editorContainer.className = 'chr-tile-inspector-editor-container';

    const renderLocalEditor = (): void => {
      editorContainer.replaceChildren();
      const editor = createChrTileEditor({
        pixels: localTilePixels,
        selectedColorIndex: localEditorState.selectedColorIndex,
        activeTool: localEditorState.activeTool,
        paletteColors: options.colors ?? NEUTRAL_NES_GRAYSCALE,
        showGrid: localEditorState.showGrid,
        shiftWrap: localEditorState.shiftWrap,
        history: editorHistory,
        onPixelsChange: (nextPixels) => {
          localTilePixels = nextPixels;
          options.onTilePixelsChange?.(selectedIdx, nextPixels);
        },
        onSelectColorIndex: (colorIdx) => {
          localEditorState = {
            ...localEditorState,
            selectedColorIndex: colorIdx,
          };
          options.onEditorStateChange?.(localEditorState);
          if (!options.onEditorStateChange) renderLocalEditor();
        },
        onSelectTool: (tool) => {
          localEditorState = { ...localEditorState, activeTool: tool };
          options.onEditorStateChange?.(localEditorState);
          if (!options.onEditorStateChange) renderLocalEditor();
        },
        onToggleGrid: (gridState) => {
          localEditorState = { ...localEditorState, showGrid: gridState };
          options.onEditorStateChange?.(localEditorState);
          if (!options.onEditorStateChange) renderLocalEditor();
        },
        onToggleShiftWrap: (wrapState) => {
          localEditorState = { ...localEditorState, shiftWrap: wrapState };
          options.onEditorStateChange?.(localEditorState);
          if (!options.onEditorStateChange) renderLocalEditor();
        },
        onUndo: () => {
          renderLocalEditor();
        },
        onRedo: () => {
          renderLocalEditor();
        },
      });
      editorContainer.append(editor);
    };

    renderLocalEditor();
    previewSection.append(previewWrapper, gridToggle, editorContainer);

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
      true,
      false,
      options.chrRegions ?? [],
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

    // Region Membership
    const covering = findChrRegionsForPhysicalTile(
      meta.physicalIndex,
      options.chrRegions ?? [],
    );
    const organizationalRegions = covering.filter((r) => r.kind === 'region');
    const reservations = covering.filter((r) => r.kind === 'reservation');

    const regionLabel =
      organizationalRegions.length > 1
        ? t('chrTileInspectorRegionsLabel')
        : t('chrTileInspectorRegionLabel');

    if (organizationalRegions.length === 0) {
      const noRegionSpan = document.createElement('span');
      noRegionSpan.className = 'muted';
      noRegionSpan.textContent = t('chrTileInspectorNoRegion');
      addMetric(regionLabel, noRegionSpan, 'chr-metric-region');
    } else {
      const regionList = document.createElement('div');
      regionList.className = 'chr-inspector-region-list';
      for (const reg of organizationalRegions) {
        const badge = document.createElement('span');
        badge.className = 'status-badge chr-region-badge';
        const rangeStr = formatTileRangeHex(reg.startTile, reg.endTile);
        const safeColor = sanitizeRegionColor(reg.color);
        if (safeColor) {
          const swatch = document.createElement('span');
          swatch.className = 'chr-region-color-swatch';
          swatch.style.backgroundColor = safeColor;
          swatch.setAttribute('aria-hidden', 'true');
          badge.append(swatch);
        }
        const textSpan = document.createElement('span');
        textSpan.textContent = `${reg.name} (${rangeStr})`;
        badge.append(textSpan);
        regionList.append(badge);
      }
      addMetric(regionLabel, regionList, 'chr-metric-region');
    }

    // Reservation Membership
    const reservationLabel =
      reservations.length > 1
        ? t('chrTileInspectorReservationsLabel')
        : t('chrTileInspectorReservationLabel');

    if (reservations.length === 0) {
      const noResSpan = document.createElement('span');
      noResSpan.className = 'muted';
      noResSpan.textContent = t('chrTileInspectorNoReservation');
      addMetric(reservationLabel, noResSpan, 'chr-metric-reservation');
    } else {
      const resList = document.createElement('div');
      resList.className = 'chr-inspector-reservation-list';
      for (const res of reservations) {
        const badge = document.createElement('span');
        badge.className = 'status-badge chr-reservation-badge';
        const rangeStr = formatTileRangeHex(res.startTile, res.endTile);
        const safeColor = sanitizeRegionColor(res.color);
        if (safeColor) {
          const swatch = document.createElement('span');
          swatch.className = 'chr-region-color-swatch';
          swatch.style.backgroundColor = safeColor;
          swatch.setAttribute('aria-hidden', 'true');
          badge.append(swatch);
        }
        const textSpan = document.createElement('span');
        textSpan.textContent = `${res.name} (${rangeStr})`;
        badge.append(textSpan);
        resList.append(badge);
      }
      addMetric(reservationLabel, resList, 'chr-metric-reservation');
    }

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

    // 3. Asset Origin & Usage Section (#chr-tile-ownership-section)
    const slotAttribution = options.mappingIndex
      ? getPhysicalSlotAttribution(
          options.selectedTileIndex,
          options.mappingIndex,
        )
      : undefined;

    const ownershipSection = document.createElement('div');
    ownershipSection.className = 'chr-tile-ownership-section';
    ownershipSection.id = 'chr-tile-ownership-section';

    const ownershipHeader = document.createElement('div');
    ownershipHeader.className = 'chr-tile-ownership-header';

    const ownershipTitle = document.createElement('h4');
    ownershipTitle.className = 'chr-tile-ownership-title';
    ownershipTitle.textContent = t('chrTileInspectorOwnershipTitle');

    ownershipHeader.append(ownershipTitle);

    if (slotAttribution?.isShared) {
      const sharedBadge = document.createElement('span');
      sharedBadge.className = 'status-badge chr-tile-shared-badge';

      const distinctAssetCount = new Set(
        slotAttribution.usages
          .map((u) => u.assetId)
          .filter((id): id is string => Boolean(id)),
      ).size;

      if (distinctAssetCount > 1) {
        sharedBadge.textContent = t('chrTileInspectorSharedMultiAssetBadge', {
          count: slotAttribution.usageCount,
          assets: distinctAssetCount,
        });
      } else {
        sharedBadge.textContent = t('chrTileInspectorSharedBadge', {
          count: slotAttribution.usageCount,
        });
      }
      ownershipHeader.append(sharedBadge);
    }
    ownershipSection.append(ownershipHeader);

    // Provenance / Origin
    const originCard = document.createElement('div');
    originCard.className = 'chr-tile-origin-card';

    if (slotAttribution?.origin) {
      const originDl = document.createElement('dl');
      originDl.className = 'chr-tile-origin-metrics';

      // Primary Asset
      const assetItem = document.createElement('div');
      assetItem.className = 'chr-origin-asset-item';

      const assetDt = document.createElement('dt');
      assetDt.textContent = t('chrTileInspectorOriginLabel');

      const assetDd = document.createElement('dd');
      assetDd.className = 'chr-origin-asset-dd';

      const assetNameSpan = document.createElement('span');
      assetNameSpan.className = 'chr-origin-asset-name';
      assetNameSpan.textContent =
        slotAttribution.origin.primaryAssetName ??
        slotAttribution.origin.primaryAssetId;

      const assetIdCode = document.createElement('code');
      assetIdCode.className = 'chr-origin-asset-id muted';
      assetIdCode.textContent = slotAttribution.origin.primaryAssetId;

      assetDd.append(assetNameSpan, assetIdCode);

      // Highlight asset action button
      if (options.onHighlightAssetId) {
        const isAssetHighlighted =
          options.highlightedAssetId === slotAttribution.origin.primaryAssetId;
        const highlightBtn = document.createElement('button');
        highlightBtn.type = 'button';
        highlightBtn.className = `btn btn-secondary chr-origin-highlight-btn${isAssetHighlighted ? ' is-active' : ''}`;
        highlightBtn.textContent = isAssetHighlighted
          ? t('chrTileInspectorClearHighlightAssetAction')
          : t('chrTileInspectorHighlightAssetAction');
        highlightBtn.setAttribute(
          'aria-pressed',
          isAssetHighlighted ? 'true' : 'false',
        );
        const targetAssetId = slotAttribution.origin.primaryAssetId;
        highlightBtn.addEventListener('click', () => {
          options.onHighlightAssetId?.(
            isAssetHighlighted ? null : targetAssetId,
          );
        });
        assetDd.append(highlightBtn);
      }

      assetItem.append(assetDt, assetDd);
      originDl.append(assetItem);

      // Logical Tile Key / Coordinates
      const logicalItem = document.createElement('div');
      const logicalDt = document.createElement('dt');
      logicalDt.textContent = t('chrTileInspectorLogicalTileLabel');
      const logicalDd = document.createElement('dd');
      if (slotAttribution.origin.sourceCoordinates) {
        const coords = slotAttribution.origin.sourceCoordinates;
        logicalDd.textContent = `(${String(coords.tileX)}, ${String(coords.tileY)}) · (px: ${String(coords.pixelX)}, ${String(coords.pixelY)})`;
      } else if (slotAttribution.origin.logicalKey) {
        logicalDd.textContent = slotAttribution.origin.logicalKey;
      } else {
        logicalDd.textContent = '—';
      }
      logicalItem.append(logicalDt, logicalDd);
      originDl.append(logicalItem);

      // Creation Kind
      const kindItem = document.createElement('div');
      const kindDt = document.createElement('dt');
      kindDt.textContent = t('chrTileInspectorCreatedAsLabel');
      const kindDd = document.createElement('dd');
      const kindBadge = document.createElement('span');
      kindBadge.className = `status-badge chr-creation-kind-badge kind-${slotAttribution.origin.creationKind}`;
      kindBadge.textContent =
        slotAttribution.origin.creationKind === 'extracted'
          ? t('chrTileInspectorCreationExtracted')
          : slotAttribution.origin.creationKind === 'base-chr'
            ? t('chrTileInspectorCreationBaseChr')
            : t('chrTileInspectorCreationManual');
      kindDd.append(kindBadge);
      kindItem.append(kindDt, kindDd);
      originDl.append(kindItem);

      originCard.append(originDl);
    } else if (diagnosis.state === 'empty') {
      const emptyMsg = document.createElement('p');
      emptyMsg.className = 'empty-message chr-origin-empty-msg';
      emptyMsg.textContent = t('chrTileInspectorNoAssociatedAsset');
      originCard.append(emptyMsg);
    } else if (diagnosis.state === 'base') {
      const baseMsg = document.createElement('div');
      baseMsg.className = 'chr-origin-base-desc';
      const baseLabel = document.createElement('strong');
      baseLabel.textContent = options.baseChrName
        ? `Base CHR — ${options.baseChrName}`
        : t('chrTileInspectorCreationBaseChr');
      const kindBadge = document.createElement('span');
      kindBadge.className =
        'status-badge chr-creation-kind-badge kind-base-chr';
      kindBadge.textContent = t('chrTileInspectorCreationBaseChr');
      baseMsg.append(baseLabel, kindBadge);
      originCard.append(baseMsg);
    } else {
      const unknownMsg = document.createElement('p');
      unknownMsg.className = 'muted chr-origin-unknown-msg';
      unknownMsg.textContent = t('chrTileInspectorUnknownProvenance');
      originCard.append(unknownMsg);
    }

    ownershipSection.append(originCard);

    // 4. Reverse Lookup: "Used by" Section
    const usedBySection = document.createElement('div');
    usedBySection.className = 'chr-tile-used-by-section';

    const usedByHeader = document.createElement('div');
    usedByHeader.className = 'chr-tile-used-by-header';

    const usedByTitle = document.createElement('h4');
    usedByTitle.className = 'chr-tile-used-by-title';

    // Usages can come from slotAttribution or options.references fallback
    const rawUsages = slotAttribution?.usages;
    const hasStructuredUsages = rawUsages !== undefined && rawUsages.length > 0;
    const legacyReferences = options.references ?? [];
    const usageCount = hasStructuredUsages
      ? rawUsages.length
      : legacyReferences.length;

    usedByTitle.textContent = t('chrTileInspectorUsedBy', {
      count: usageCount,
    });
    usedByHeader.append(usedByTitle);
    usedBySection.append(usedByHeader);

    if (usageCount === 0) {
      const emptyRefs = document.createElement('p');
      emptyRefs.className = 'empty-message chr-tile-used-by-empty';
      emptyRefs.textContent = t('chrTileInspectorUsedByEmpty');
      usedBySection.append(emptyRefs);
    } else {
      const refList = document.createElement('div');
      refList.className = 'chr-tile-used-by-list';

      const INITIAL_VISIBLE_COUNT = 6;
      let showAll = false;

      const renderUsageItems = (): void => {
        const itemNodes: HTMLElement[] = [];

        if (hasStructuredUsages) {
          const visibleUsages = showAll
            ? rawUsages
            : rawUsages.slice(0, INITIAL_VISIBLE_COUNT);

          visibleUsages.forEach((u) => {
            const item = document.createElement('div');
            item.className = `chr-tile-ref-item ref-type-${u.type}`;

            const infoWrap = document.createElement('div');
            infoWrap.className = 'chr-tile-ref-info';

            const typeBadge = document.createElement('span');
            typeBadge.className = `status-badge chr-tile-ref-badge badge-${u.type}`;
            typeBadge.textContent =
              u.type === 'animation'
                ? 'Animation'
                : u.type === 'playfield'
                  ? 'Playfield'
                  : 'Tileset';

            const desc = document.createElement('span');
            desc.className = 'chr-tile-ref-desc';

            if (u.type === 'animation') {
              const flips: string[] = [];
              if (u.horizontalFlip)
                flips.push(t('chrTileInspectorFlipHorizontal'));
              if (u.verticalFlip) flips.push(t('chrTileInspectorFlipVertical'));
              const flipText = flips.length > 0 ? ` [${flips.join(', ')}]` : '';
              const entityPrefix = u.entity ? `${u.entity} · ` : '';
              const animLabel = u.animationName ?? u.animationId;
              desc.textContent = `${entityPrefix}${animLabel} · Frame #${String(u.frameIndex)} · sprite (${String(u.x)}, ${String(u.y)})${flipText}`;
            } else if (u.type === 'playfield') {
              desc.textContent = `(${String(u.column)}, ${String(u.row)}) · tile $${u.localTileIndex.toString(16).toUpperCase().padStart(2, '0')}`;
            } else {
              const coordStr = u.sourceCoordinates
                ? ` (${String(u.sourceCoordinates.tileX)}, ${String(u.sourceCoordinates.tileY)})`
                : '';
              desc.textContent = `tile #${String(u.tileIndex)}${coordStr}`;
            }

            infoWrap.append(typeBadge, desc);

            // Jump Action
            const jumpBtn = document.createElement('button');
            jumpBtn.type = 'button';
            jumpBtn.className = 'button secondary-button chr-tile-ref-jump-btn';
            jumpBtn.textContent = t('chrTileInspectorJumpAction');

            if (u.type === 'animation') {
              jumpBtn.title = t('chrTileInspectorJumpAnimation', {
                name: u.animationName ?? u.animationId,
                frame: u.frameIndex,
              });
            } else if (u.type === 'playfield') {
              jumpBtn.title = t('chrTileInspectorJumpPlayfield', {
                col: u.column,
                row: u.row,
              });
            } else {
              jumpBtn.title = t('chrTileInspectorJumpTileset', {
                index: u.tileIndex,
              });
            }
            jumpBtn.setAttribute(
              'aria-label',
              jumpBtn.title || t('chrTileInspectorJumpAction'),
            );

            jumpBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              if (u.type === 'animation') {
                if (options.onNavigateToAnimation) {
                  options.onNavigateToAnimation(u.animationId, u.frameIndex);
                } else {
                  options.onNavigateToReference?.(u);
                }
              } else if (u.type === 'playfield') {
                if (options.onNavigateToPlayfield) {
                  options.onNavigateToPlayfield(u.column, u.row);
                } else {
                  options.onNavigateToReference?.(u);
                }
              } else {
                if (options.onNavigateToTileset) {
                  options.onNavigateToTileset(u.tileIndex);
                } else {
                  options.onNavigateToReference?.(u);
                }
              }
            });

            item.append(infoWrap, jumpBtn);
            itemNodes.push(item);
          });

          if (rawUsages.length > INITIAL_VISIBLE_COUNT) {
            const toggleMoreBtn = document.createElement('button');
            toggleMoreBtn.type = 'button';
            toggleMoreBtn.className =
              'button secondary-button chr-tile-refs-toggle-btn';
            toggleMoreBtn.textContent = showAll
              ? t('chrTileInspectorShowLessRefs')
              : t('chrTileInspectorShowAllRefs', {
                  count: rawUsages.length,
                });
            toggleMoreBtn.setAttribute('aria-expanded', String(showAll));
            toggleMoreBtn.addEventListener('click', () => {
              showAll = !showAll;
              renderUsageItems();
            });
            itemNodes.push(toggleMoreBtn);
          }
        } else {
          // Legacy references fallback
          const visibleRefs = showAll
            ? legacyReferences
            : legacyReferences.slice(0, INITIAL_VISIBLE_COUNT);

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
              jumpBtn.className =
                'button secondary-button chr-tile-ref-jump-btn';
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
              jumpBtn.setAttribute(
                'aria-label',
                jumpBtn.title || t('chrTileInspectorJumpAction'),
              );
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

          if (legacyReferences.length > INITIAL_VISIBLE_COUNT) {
            const toggleMoreBtn = document.createElement('button');
            toggleMoreBtn.type = 'button';
            toggleMoreBtn.className =
              'button secondary-button chr-tile-refs-toggle-btn';
            toggleMoreBtn.textContent = showAll
              ? t('chrTileInspectorShowLessRefs')
              : t('chrTileInspectorShowAllRefs', {
                  count: legacyReferences.length,
                });
            toggleMoreBtn.setAttribute('aria-expanded', String(showAll));
            toggleMoreBtn.addEventListener('click', () => {
              showAll = !showAll;
              renderUsageItems();
            });
            itemNodes.push(toggleMoreBtn);
          }
        }

        refList.replaceChildren(...itemNodes);
      };

      renderUsageItems();
      usedBySection.append(refList);
    }

    // 5. Reuse & Usage Diagnostics Section
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

    if (usageSection) {
      content.append(
        previewSection,
        metricsList,
        ownershipSection,
        usedBySection,
        usageSection,
      );
    } else {
      content.append(
        previewSection,
        metricsList,
        ownershipSection,
        usedBySection,
      );
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
