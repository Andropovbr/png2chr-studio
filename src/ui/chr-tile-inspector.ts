import type { AnimationProjectModel } from '../core/animation-model';
import {
  computeTileAddressingMetadata,
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

export type TileSlotState = 'empty' | 'project' | 'base';

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
): TileSlotDiagnosis {
  const startByte = physicalIndex * 16;
  const tileBytes =
    finalChrBytes.length >= startByte + 16
      ? finalChrBytes.subarray(startByte, startByte + 16)
      : new Uint8Array(16);
  const isNonZero = tileBytes.some((byte) => byte !== 0);

  // Check Base CHR attribution
  if (baseChr && baseChr.length > 0) {
    const fileTileSlots = Math.floor(baseChr.length / 16);
    const baseStart = fileTileSlots <= 256 ? destinationPatternTable * 256 : 0;
    if (
      physicalIndex >= baseStart &&
      physicalIndex < baseStart + fileTileSlots
    ) {
      const baseTileIndex = physicalIndex - baseStart;
      const baseRawOffset = baseTileIndex * 16;
      const baseHasData = baseChr
        .subarray(baseRawOffset, baseRawOffset + 16)
        .some((b) => b !== 0);

      if (baseHasData) {
        return {
          state: 'base',
          stateLabel: t('chrTileInspectorStateBase'),
          attribution: baseChrName
            ? t('chrTileInspectorBaseAttribution', { name: baseChrName })
            : t('chrTileInspectorStateBase'),
        };
      }
    }
  }

  // Animation mode attribution
  if (mode === 'animation' && animationModel !== null) {
    const references: string[] = [];
    for (const anim of animationModel.animations) {
      anim.frames.forEach((frame, frameIdx) => {
        if (
          frame.sprites.some(
            (sprite) => sprite.physicalTileIndex === physicalIndex,
          )
        ) {
          const frameLabel = `${anim.name} (#${String(frameIdx)})`;
          if (!references.includes(frameLabel)) {
            references.push(frameLabel);
          }
        }
      });
    }

    if (references.length > 0) {
      return {
        state: 'project',
        stateLabel: t('chrTileInspectorStateProject'),
        attribution: references.join(', '),
      };
    }

    if (isNonZero) {
      return {
        state: 'project',
        stateLabel: t('chrTileInspectorStateProject'),
        attribution: t('chrTileInspectorStateProject'),
      };
    }

    return {
      state: 'empty',
      stateLabel: t('chrTileInspectorStateEmpty'),
      attribution: t('chrTileInspectorNoAttribution'),
    };
  }

  // Tileset or Playfield mode
  if (isNonZero) {
    const matchedTile = tiles.find((tItem) => tItem.id === physicalIndex);
    const attribution = matchedTile
      ? `Tile #${String(matchedTile.id)} (${t('chrTileInspectorTilePos', { col: matchedTile.column, row: matchedTile.row })})`
      : t('chrTileInspectorStateProject');

    return {
      state: 'project',
      stateLabel: t('chrTileInspectorStateProject'),
      attribution,
    };
  }

  return {
    state: 'empty',
    stateLabel: t('chrTileInspectorStateEmpty'),
    attribution: t('chrTileInspectorNoAttribution'),
  };
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

    content.append(previewSection, metricsList);
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
