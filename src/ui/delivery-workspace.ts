import {
  generateCAnimationExport,
  generateCa65AnimationExport,
  serializeAnimationMetadata,
} from '../core/animation-exporters';
import {
  type AnimationModelError,
  type AnimationProjectModel,
} from '../core/animation-model';
import {
  analyzeChrRegionDiagnostics,
  CHR_LOW_CAPACITY_THRESHOLD,
  formatConsecutiveTileRanges,
  formatTileRangeHex,
  type ChrRegion,
  type ChrRegionDiagnosticFact,
} from '../core/chr-pattern-table';
import {
  analyzeChrOwnershipDiagnostics,
  calculateProjectChrOwnershipMetrics,
  formatChrOwnershipDiagnosticMessage,
  type ChrAssetMappingIndex,
} from '../core/chr-asset-mapping';
import type { ProjectAsset } from '../core/asset-identity';
import { padChrRom } from '../core/chr-rom';
import {
  exportBackgroundPaletteBinary,
  exportFullPpuPaletteBinary,
  exportSpritePaletteBinary,
  generateCa65PaletteExport,
  generateCPaletteExport,
  sanitizePaletteIdentifier,
} from '../core/palette-exporters';
import {
  analyzeProjectPaletteDiagnostics,
  formatPaletteDiagnosticMessage,
  type PaletteDiagnosticFact,
  type DualBankPaletteState,
} from '../core/palette-manager';
import type { IndexedImage } from '../core/types';
import {
  analyzeAnimationOamCapacity,
  formatOamCapacityDiagnosticMessage,
  type OamCapacityDiagnosticFact,
} from '../core/oam-diagnostics';
import {
  analyzeAnimationSpriteScanlinePressure,
  analyzeSceneInstanceVisibility,
  formatSceneInstanceVisibilityDiagnosticMessage,
  formatSpriteScanlinePressureDiagnosticMessage,
  type AnimationSpriteScanlinePressureFact,
  type SceneInstanceVisibilityFact,
} from '../core/nes-sprite-diagnostics';
import type { ProjectScenePreviewConfig } from '../core/scene-preview';
import type { BackgroundMapDefinition } from '../core/background-model';
import type { BackgroundPhysicalAssignment } from '../core/chr-background-allocation';
import type { LogicalTileKey } from '../core/asset-identity';
import {
  analyzeAttributeTableAssignments,
  type AttributeTableAssignmentFact,
} from '../core/nes-background-diagnostics';
import type {
  CompiledProjectGraphics,
  ProjectGraphicsCompilationResult,
} from '../core/project-graphics-compiler';
import { t, type TranslationKey } from '../i18n';
import type { DisplayError, ProjectMode } from './types';
import type { WorkspaceView } from './workspace-state';

export interface DeliveryArtifact {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly description: string;
  readonly sizeBytes: number;
  readonly isPrimary: boolean;
  readonly blocked?: boolean;
  readonly onDownload: () => void;
}

/** Explicit state of the one canonical project graphics compilation. */
export type DeliveryCompilationStatus =
  | { readonly kind: 'compiled'; readonly compiled: CompiledProjectGraphics }
  | { readonly kind: 'missing-assets'; readonly assetId: string }
  | { readonly kind: 'unsupported-source'; readonly assetId: string }
  | {
      readonly kind: 'failed-compilation';
      readonly result: Exclude<
        ProjectGraphicsCompilationResult,
        { success: true }
      >;
    }
  | { readonly kind: 'unknown' };

export interface DeliveryDiagnosticItem {
  readonly id?: string;
  readonly level: 'error' | 'warning' | 'info';
  readonly message: string;
  readonly targetWorkspace?: WorkspaceView;
  readonly actionLabel?: string;
}

export interface DeliveryWorkspaceOptions {
  readonly mode: ProjectMode;
  readonly projectName: string;
  readonly fileName: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly indexedImage: IndexedImage | null;
  readonly tileCount: number;
  readonly originalTileCount: number;
  readonly deduplicationEnabled: boolean;
  readonly flipDeduplicationEnabled: boolean;
  /** Placement-dependent facts and graphics artifact authority. */
  readonly compilation: DeliveryCompilationStatus;
  readonly chr: Uint8Array | null;
  readonly nametable: Uint8Array | null;
  /** Compiler-owned placements for the selected map. */
  readonly compiledBackground?: {
    readonly map: BackgroundMapDefinition;
    readonly assignments: readonly BackgroundPhysicalAssignment[];
  };
  readonly backgroundPaletteContexts?: ReadonlyMap<LogicalTileKey, number>;
  readonly attributeTable: Uint8Array | null;
  readonly collisionMap: Uint8Array | null;
  readonly paletteState: DualBankPaletteState;
  readonly paletteAnimations?: readonly {
    readonly id: string;
    readonly name: string;
    readonly entity?: string;
    readonly paletteId?: string | null;
    readonly framePaletteIds?: readonly (string | null)[];
  }[];
  readonly animationModel: AnimationProjectModel | null;
  readonly animationModelError: AnimationModelError | null;
  readonly error: DisplayError | null;
  readonly chrRegions?: readonly ChrRegion[];
  readonly chrAssetMappingIndex?: ChrAssetMappingIndex;
  readonly activeAssets?: readonly ProjectAsset[];
  readonly scenePreview?: ProjectScenePreviewConfig;
  readonly paletteDiagnostics?: readonly PaletteDiagnosticFact[];
  readonly onDownloadBytes: (bytes: Uint8Array, fileName: string) => void;
  readonly onDownloadText: (text: string, fileName: string) => void;
  readonly onNavigateWorkspace?: (view: WorkspaceView) => void;
}

function errorTranslation(error: AnimationModelError): TranslationKey {
  switch (error.code) {
    case 'no-selected-frames':
      return 'animationMappingEmpty';
    case 'duplicate-animation-name':
      return 'animationErrorDuplicateName';
    case 'duplicate-animation-identifier':
      return 'animationErrorDuplicateIdentifier';
    case 'invalid-playback':
      return 'animationErrorInvalidPlayback';
    default:
      return 'animationErrorGeneric';
  }
}

export function formatChrRegionDiagnosticMessage(
  fact: ChrRegionDiagnosticFact,
): string {
  switch (fact.kind) {
    case 'region-overlap': {
      const rangeStr = formatTileRangeHex(
        fact.overlapStartTile,
        fact.overlapEndTile,
      );
      if (fact.overlapType === 'reservation-reservation') {
        return t('chrRegionOverlapReservation', {
          nameA: fact.regionA.name,
          nameB: fact.regionB.name,
          patternTable: fact.patternTable,
          range: rangeStr,
        });
      }
      if (fact.overlapType === 'region-region') {
        return t('chrRegionOverlapRegion', {
          nameA: fact.regionA.name,
          nameB: fact.regionB.name,
          patternTable: fact.patternTable,
          range: rangeStr,
        });
      }
      // Mixed: region-reservation
      const reg = fact.regionA.kind === 'region' ? fact.regionA : fact.regionB;
      const res =
        fact.regionA.kind === 'reservation' ? fact.regionA : fact.regionB;
      return t('chrRegionOverlapMixed', {
        nameA: reg.name,
        nameB: res.name,
        patternTable: fact.patternTable,
        range: rangeStr,
      });
    }
    case 'reservation-contains-occupied': {
      const rangeStr = formatConsecutiveTileRanges(fact.occupiedTileIndices);
      const key =
        fact.occupiedCount === 1
          ? 'chrReservationContainsOccupiedSingle'
          : 'chrReservationContainsOccupiedMultiple';
      return t(key, {
        name: fact.region.name,
        count: fact.occupiedCount,
        patternTable: fact.patternTable,
        range: rangeStr,
      });
    }
    case 'pattern-table-exhausted': {
      return t('chrPatternTableExhausted', {
        patternTable: fact.patternTable,
        occupied: fact.totalOccupied,
        reserved: fact.totalReservedEmpty,
      });
    }
    case 'pattern-table-low-capacity': {
      const key =
        fact.availableSlots === 1
          ? 'chrPatternTableLowCapacitySingle'
          : 'chrPatternTableLowCapacityMultiple';
      return t(key, {
        patternTable: fact.patternTable,
        available: fact.availableSlots,
      });
    }
    case 'region-full': {
      return t('chrRegionFull', {
        name: fact.region.name,
        patternTable: fact.patternTable,
        occupied: fact.occupiedTiles,
        total: fact.totalTiles,
      });
    }
  }
}

export function formatAttributeTableAssignmentDiagnosticMessage(
  fact: AttributeTableAssignmentFact,
): string {
  return t('attributePaletteContextMismatch', {
    mapName: fact.mapId,
    pixelX: fact.pixelX,
    pixelY: fact.pixelY,
    paletteIndex: fact.paletteIndex,
    required: fact.requiredPaletteContexts.join(', '),
  });
}

function createAnimationDeliveryItem(
  fact:
    | OamCapacityDiagnosticFact
    | AnimationSpriteScanlinePressureFact
    | SceneInstanceVisibilityFact,
  message: string,
): DeliveryDiagnosticItem {
  return {
    id: fact.id,
    level: fact.severity,
    message,
    targetWorkspace: 'animation',
    actionLabel: t('deliveryLinkAnimation'),
  };
}

export function convertOamCapacityFactsToDeliveryItems(
  facts: readonly OamCapacityDiagnosticFact[],
): readonly DeliveryDiagnosticItem[] {
  return facts.map((fact) =>
    createAnimationDeliveryItem(fact, formatOamCapacityDiagnosticMessage(fact)),
  );
}

export function convertSpriteScanlineFactsToDeliveryItems(
  facts: readonly AnimationSpriteScanlinePressureFact[],
): readonly DeliveryDiagnosticItem[] {
  return facts.map((fact) =>
    createAnimationDeliveryItem(
      fact,
      formatSpriteScanlinePressureDiagnosticMessage(fact),
    ),
  );
}

export function convertSceneVisibilityFactsToDeliveryItems(
  facts: readonly SceneInstanceVisibilityFact[],
): readonly DeliveryDiagnosticItem[] {
  return facts.map((fact) =>
    createAnimationDeliveryItem(
      fact,
      formatSceneInstanceVisibilityDiagnosticMessage(fact),
    ),
  );
}

export function convertAttributeTableAssignmentFactsToDeliveryItems(
  facts: readonly AttributeTableAssignmentFact[],
): readonly DeliveryDiagnosticItem[] {
  return facts.map((fact) => ({
    id: fact.id,
    level: fact.severity,
    message: formatAttributeTableAssignmentDiagnosticMessage(fact),
    targetWorkspace: 'background',
    actionLabel: t('deliveryLinkBackground'),
  }));
}

export function convertChrRegionDiagnosticFactsToDeliveryItems(
  facts: readonly ChrRegionDiagnosticFact[],
): readonly DeliveryDiagnosticItem[] {
  return facts.map((fact) => ({
    id: fact.id,
    level: fact.severity,
    message: formatChrRegionDiagnosticMessage(fact),
    targetWorkspace: 'chr',
    actionLabel: t('deliveryLinkChr'),
  }));
}

function compiledCapacityDiagnostics(
  compiled: CompiledProjectGraphics | undefined,
): readonly ChrRegionDiagnosticFact[] {
  if (!compiled) return [];
  return compiled.capacity.flatMap(
    (capacity): readonly ChrRegionDiagnosticFact[] => {
      const totalOccupied = capacity.baseChrSlots + capacity.projectSlots;
      if (capacity.availableSlots === 0) {
        return [
          {
            kind: 'pattern-table-exhausted' as const,
            id: `chr-pattern-table-exhausted:${String(capacity.patternTable)}`,
            patternTable: capacity.patternTable,
            capacityTiles: capacity.capacitySlots,
            totalOccupied,
            totalReservedEmpty: capacity.reservedAvailableSlots,
            severity: 'error' as const,
          },
        ];
      }
      if (capacity.availableSlots <= CHR_LOW_CAPACITY_THRESHOLD) {
        return [
          {
            kind: 'pattern-table-low-capacity' as const,
            id: `chr-pattern-table-low-capacity:${String(capacity.patternTable)}`,
            patternTable: capacity.patternTable,
            capacityTiles: capacity.capacitySlots,
            availableSlots: capacity.availableSlots,
            totalOccupied,
            totalReservedEmpty: capacity.reservedAvailableSlots,
            severity: 'warning' as const,
          },
        ];
      }
      return [];
    },
  );
}

const DIAGNOSTIC_LEVEL_RANK: Readonly<
  Record<DeliveryDiagnosticItem['level'], number>
> = {
  info: 0,
  warning: 1,
  error: 2,
};

/** Keep stable order while preserving the highest severity for duplicate facts. */
export function deduplicateDeliveryDiagnosticItems(
  items: readonly DeliveryDiagnosticItem[],
): readonly DeliveryDiagnosticItem[] {
  const deduplicated: DeliveryDiagnosticItem[] = [];
  const indexByKey = new Map<string, number>();

  for (const item of items) {
    const key =
      item.id ??
      [
        item.level,
        item.message,
        item.targetWorkspace ?? '',
        item.actionLabel ?? '',
      ].join('|');
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, deduplicated.length);
      deduplicated.push(item);
      continue;
    }

    const existing = deduplicated[existingIndex];
    if (
      existing !== undefined &&
      DIAGNOSTIC_LEVEL_RANK[item.level] > DIAGNOSTIC_LEVEL_RANK[existing.level]
    ) {
      deduplicated[existingIndex] = item;
    }
  }

  return deduplicated;
}

function createPaletteDeliveryArtifacts(
  options: Pick<DeliveryWorkspaceOptions, 'onDownloadBytes' | 'onDownloadText'>,
  paletteState: DualBankPaletteState,
  baseName: string,
  artifactPrefix: string,
): readonly [
  DeliveryArtifact,
  DeliveryArtifact,
  DeliveryArtifact,
  DeliveryArtifact,
  DeliveryArtifact,
  DeliveryArtifact,
  DeliveryArtifact,
] {
  const background = exportBackgroundPaletteBinary(paletteState);
  const sprites = exportSpritePaletteBinary(paletteState);
  const full = exportFullPpuPaletteBinary(paletteState);
  const symbolBase = `${sanitizePaletteIdentifier(baseName)}_palette`;
  const c = generateCPaletteExport(paletteState, { symbolBase });
  const asm = generateCa65PaletteExport(paletteState, { symbolBase });

  return [
    {
      id: `${artifactPrefix}-pal`,
      name: `${baseName}.pal`,
      category: 'Palette',
      description: t('deliveryArtifactPalette'),
      sizeBytes: background.length,
      isPrimary: false,
      onDownload: () => {
        options.onDownloadBytes(background, `${baseName}.pal`);
      },
    },
    {
      id: `${artifactPrefix}-spr-pal`,
      name: `${baseName}_sprites.pal`,
      category: 'Palette',
      description: t('deliveryArtifactSpritePalette'),
      sizeBytes: sprites.length,
      isPrimary: false,
      onDownload: () => {
        options.onDownloadBytes(sprites, `${baseName}_sprites.pal`);
      },
    },
    {
      id: `${artifactPrefix}-ppu-pal`,
      name: `${baseName}_ppu.pal`,
      category: 'Palette',
      description: t('deliveryArtifactFullPalette'),
      sizeBytes: full.length,
      isPrimary: false,
      onDownload: () => {
        options.onDownloadBytes(full, `${baseName}_ppu.pal`);
      },
    },
    {
      id: `${artifactPrefix}-palette-c-header`,
      name: c.headerFileName,
      category: 'C Header',
      description: t('deliveryArtifactCHeader'),
      sizeBytes: new Blob([c.header]).size,
      isPrimary: false,
      onDownload: () => {
        options.onDownloadText(c.header, c.headerFileName);
      },
    },
    {
      id: `${artifactPrefix}-palette-c-source`,
      name: c.sourceFileName,
      category: 'C Source',
      description: t('deliveryArtifactCSource'),
      sizeBytes: new Blob([c.source]).size,
      isPrimary: false,
      onDownload: () => {
        options.onDownloadText(c.source, c.sourceFileName);
      },
    },
    {
      id: `${artifactPrefix}-palette-asm-include`,
      name: asm.includeFileName,
      category: 'ASM Include',
      description: t('deliveryArtifactAsmInclude'),
      sizeBytes: new Blob([asm.include]).size,
      isPrimary: false,
      onDownload: () => {
        options.onDownloadText(asm.include, asm.includeFileName);
      },
    },
    {
      id: `${artifactPrefix}-palette-asm-source`,
      name: asm.sourceFileName,
      category: 'ASM Source',
      description: t('deliveryArtifactAsmSource'),
      sizeBytes: new Blob([asm.source]).size,
      isPrimary: false,
      onDownload: () => {
        options.onDownloadText(asm.source, asm.sourceFileName);
      },
    },
  ];
}

export function createDeliveryWorkspace(
  options: DeliveryWorkspaceOptions,
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'workspace delivery-workspace';

  // 1. Header
  const headerPanel = document.createElement('section');
  headerPanel.className = 'panel delivery-intro-panel';
  headerPanel.id = 'section-delivery-intro';

  const heading = document.createElement('h2');
  heading.textContent = t('deliveryWorkspaceTitle');

  const hint = document.createElement('p');
  hint.className = 'panel-hint';
  hint.textContent = t('deliveryWorkspaceHint');

  const modeBadge = document.createElement('span');
  modeBadge.className = 'status-badge delivery-mode-badge';
  modeBadge.textContent = t(
    options.mode === 'animation'
      ? 'animationMode'
      : options.mode === 'playfield'
        ? 'playfieldMode'
        : 'tilesetMode',
  );

  headerPanel.append(heading, hint, modeBadge);
  container.append(headerPanel);

  // Collect Diagnostics & Readiness. Physical placement facts come only from
  // the compiler result; unavailable compilation leaves runtime backing UNKNOWN.
  const diagnostics: DeliveryDiagnosticItem[] = [];
  const compilation = options.compilation;
  const compiled =
    compilation.kind === 'compiled' ? compilation.compiled : undefined;

  if (compilation.kind === 'missing-assets') {
    diagnostics.push({
      level: 'error',
      message: t('deliveryCompilerMissingAsset', {
        assetId: compilation.assetId,
      }),
      targetWorkspace: 'tileset',
      actionLabel: t('deliveryLinkTileset'),
    });
  } else if (compilation.kind === 'unsupported-source') {
    diagnostics.push({
      level: 'error',
      message: t('deliveryCompilerUnsupportedSource', {
        assetId: compilation.assetId,
      }),
      targetWorkspace: 'tileset',
      actionLabel: t('deliveryLinkTileset'),
    });
  } else if (compilation.kind === 'failed-compilation') {
    for (const failure of compilation.result.failures) {
      diagnostics.push({
        id: `compiler:${failure.code}`,
        level: 'error',
        message: t('deliveryCompilerFailure', {
          code: failure.code,
          message: failure.message,
        }),
        targetWorkspace: 'chr',
        actionLabel: t('deliveryLinkChr'),
      });
    }
  } else if (compilation.kind === 'unknown') {
    diagnostics.push({
      level: 'info',
      message: t('deliveryCompilerUnknown'),
      targetWorkspace: 'chr',
      actionLabel: t('deliveryLinkChr'),
    });
  }

  if (options.error !== null) {
    diagnostics.push({
      level: 'error',
      message: t(options.error.key, options.error.variables),
      targetWorkspace: options.mode === 'playfield' ? 'playfield' : 'tileset',
      actionLabel:
        options.mode === 'playfield'
          ? t('deliveryLinkPlayfield')
          : t('deliveryLinkTileset'),
    });
  }

  if (options.mode === 'animation') {
    if (options.animationModelError !== null) {
      diagnostics.push({
        level: 'error',
        message: t(errorTranslation(options.animationModelError)),
        targetWorkspace: 'animation',
        actionLabel: t('deliveryLinkAnimation'),
      });
    } else if (options.animationModel === null) {
      diagnostics.push({
        level: 'error',
        message: t('animationPreviewEmpty'),
        targetWorkspace: 'animation',
        actionLabel: t('deliveryLinkAnimation'),
      });
    } else {
      const model = options.animationModel;
      if (model.chr.remainingTiles < 16) {
        diagnostics.push({
          level: 'warning',
          message: t('chrWorkspaceSpriteCapacity', {
            remaining: model.chr.remainingTiles,
            capacity: model.chr.patternTableCapacityTiles,
          }),
          targetWorkspace: 'chr',
          actionLabel: t('deliveryLinkChr'),
        });
      }

      diagnostics.push(
        ...convertOamCapacityFactsToDeliveryItems(
          analyzeAnimationOamCapacity(model),
        ),
        ...convertSpriteScanlineFactsToDeliveryItems(
          analyzeAnimationSpriteScanlinePressure(model),
        ),
        ...convertSceneVisibilityFactsToDeliveryItems(
          analyzeSceneInstanceVisibility(
            options.scenePreview?.instances ?? [],
            model.animations,
          ),
        ),
      );
    }
  } else if (options.mode === 'playfield') {
    const missingArtifacts = [
      compiled === undefined
        ? 'compiled graphics'
        : options.chr === null
          ? 'CHR'
          : null,
      options.nametable === null ? 'Nametable' : null,
      options.attributeTable === null ? 'Attribute Table' : null,
    ].filter((name): name is string => name !== null);
    if (missingArtifacts.length > 0 && options.error === null) {
      diagnostics.push({
        level: 'error',
        message: t('deliveryMissingArtifacts', {
          artifacts: missingArtifacts.join(', '),
        }),
        targetWorkspace: 'playfield',
        actionLabel: t('deliveryLinkPlayfield'),
      });
    }
    if (options.collisionMap === null) {
      diagnostics.push({
        level: 'warning',
        message: t('deliveryMissingArtifacts', {
          artifacts: t('collisionEditorTitle'),
        }),
        targetWorkspace: 'playfield',
        actionLabel: t('deliveryLinkPlayfield'),
      });
    }

    if (options.compiledBackground) {
      diagnostics.push(
        ...convertAttributeTableAssignmentFactsToDeliveryItems(
          analyzeAttributeTableAssignments(
            options.compiledBackground,
            options.backgroundPaletteContexts ?? new Map(),
          ),
        ),
      );
    }
  } else {
    // Tileset mode
    if (
      (compiled === undefined || options.chr === null) &&
      options.error === null
    ) {
      diagnostics.push({
        level: 'error',
        message: t('exportUnavailable'),
        targetWorkspace: 'tileset',
        actionLabel: t('deliveryLinkTileset'),
      });
    }
  }

  // 1.4 CHR Regions & Reservations Conflicts / Capacity Diagnostics
  if (options.chrRegions) {
    const facts = analyzeChrRegionDiagnostics({
      chrRegions: options.chrRegions,
      checkPatternTableCapacity: false,
    });
    const regionDiagnostics =
      convertChrRegionDiagnosticFactsToDeliveryItems(facts);
    diagnostics.push(...regionDiagnostics);
  }
  diagnostics.push(
    ...convertChrRegionDiagnosticFactsToDeliveryItems(
      compiledCapacityDiagnostics(compiled),
    ),
  );

  // 1.5 CHR Ownership & Mapping Diagnostics
  if (options.chrAssetMappingIndex) {
    const ownershipFacts = analyzeChrOwnershipDiagnostics({
      mappingIndex: options.chrAssetMappingIndex,
      activeAssets: options.activeAssets,
      chrRegions: options.chrRegions,
      mode: options.mode,
    });
    for (const fact of ownershipFacts) {
      diagnostics.push({
        level: fact.severity,
        message: formatChrOwnershipDiagnosticMessage(fact),
        targetWorkspace: 'chr',
        actionLabel: t('deliveryLinkChr'),
      });
    }
  }

  // 1.6 Palette integrity and NES hardware diagnostics
  const paletteFacts =
    options.paletteDiagnostics ??
    analyzeProjectPaletteDiagnostics({
      universalBackgroundColor: options.paletteState.universalBackgroundColor,
      palettes: options.paletteState.palettes,
      activeBackgroundSlots: options.paletteState.activeBackgroundSlots,
      activeSpriteSlots: options.paletteState.activeSpriteSlots,
      animations: options.paletteAnimations,
      scenePreview: options.scenePreview,
    });
  for (const fact of paletteFacts) {
    diagnostics.push({
      id: fact.id,
      level: fact.severity,
      message: formatPaletteDiagnosticMessage(fact),
      targetWorkspace: 'palette',
      actionLabel: t('deliveryLinkPalettes'),
    });
  }

  const uniqueDiagnostics = deduplicateDeliveryDiagnosticItems(diagnostics);
  diagnostics.length = 0;
  diagnostics.push(...uniqueDiagnostics);

  const errorCount = diagnostics.filter((d) => d.level === 'error').length;
  const warnCount = diagnostics.filter((d) => d.level === 'warning').length;
  const infoCount = diagnostics.filter((d) => d.level === 'info').length;
  const isReady = errorCount === 0;

  // 2. Readiness & Diagnostics Section
  const readinessPanel = document.createElement('section');
  readinessPanel.className = 'panel delivery-readiness-panel';
  readinessPanel.id = 'section-delivery-readiness';

  const readinessHeading = document.createElement('h3');
  readinessHeading.textContent = t('deliveryReadinessTitle');

  const statusCard = document.createElement('div');
  statusCard.className = `delivery-status-card ${
    !isReady
      ? 'status-error'
      : warnCount > 0
        ? 'status-warning'
        : 'status-ready'
  }`;

  const statusTitle = document.createElement('strong');
  statusTitle.className = 'delivery-status-title';
  statusTitle.textContent = !isReady
    ? t('deliveryStatusError')
    : warnCount > 0
      ? t('deliveryStatusWarning')
      : t('deliveryStatusReady');

  const statusDetails = document.createElement('p');
  statusDetails.className = 'delivery-status-details';
  statusDetails.textContent = t('deliveryStatusDetails', {
    readyCount: isReady ? 1 : 0,
    infoCount,
    warnCount,
    errorCount,
  });

  statusCard.append(statusTitle, statusDetails);
  readinessPanel.append(readinessHeading, statusCard);

  if (diagnostics.length > 0) {
    const diagList = document.createElement('div');
    diagList.className = 'delivery-diagnostics-list';

    diagnostics.forEach((diag) => {
      const item = document.createElement('div');
      item.className = `delivery-diag-item is-${diag.level}`;

      const icon = document.createElement('span');
      icon.className = 'delivery-diag-icon';
      icon.textContent =
        diag.level === 'error' ? '❌' : diag.level === 'warning' ? '⚠️' : 'ℹ️';

      const text = document.createElement('span');
      text.className = 'delivery-diag-text';
      text.textContent = diag.message;

      item.append(icon, text);

      if (diag.targetWorkspace && options.onNavigateWorkspace) {
        const onNav = options.onNavigateWorkspace;
        const target = diag.targetWorkspace;
        const actionBtn = document.createElement('button');
        actionBtn.type = 'button';
        actionBtn.className = 'button secondary-button delivery-diag-action';
        actionBtn.textContent = diag.actionLabel ?? t('deliveryFixAction');
        actionBtn.addEventListener('click', () => {
          onNav(target);
        });
        item.append(actionBtn);
      }

      diagList.append(item);
    });

    readinessPanel.append(diagList);
  }

  container.append(readinessPanel);

  // 3. Artifacts Collection
  const artifacts: DeliveryArtifact[] = [];
  const compiledArtifactsAvailable = compiled !== undefined;
  const baseName = options.fileName
    ? options.fileName.replace(/\.[^/.]+$/, '')
    : 'graphics';
  let supplementalPaletteArtifacts: readonly DeliveryArtifact[] = [];

  if (options.mode === 'animation' && options.animationModel !== null) {
    const model = options.animationModel;
    const exportedChr = padChrRom(model.finalChr);
    const id = model.symbolBase;
    const c = generateCAnimationExport(model);
    const asm = generateCa65AnimationExport(model);
    const [backgroundPaletteArtifact, ...additionalPaletteArtifacts] =
      createPaletteDeliveryArtifacts(options, options.paletteState, id, 'anim');
    supplementalPaletteArtifacts = additionalPaletteArtifacts;

    artifacts.push(
      {
        id: 'anim-chr',
        name: model.chr.output || `${id}.chr`,
        category: 'CHR-ROM',
        description: t('deliveryArtifactChr'),
        sizeBytes: exportedChr.length,
        isPrimary: true,
        onDownload: () => {
          options.onDownloadBytes(exportedChr, model.chr.output || `${id}.chr`);
        },
      },
      backgroundPaletteArtifact,
      {
        id: 'anim-json',
        name: `${id}.json`,
        category: 'Metadata',
        description: t('deliveryArtifactJson'),
        sizeBytes: new Blob([serializeAnimationMetadata(model)]).size,
        isPrimary: false,
        onDownload: () => {
          options.onDownloadText(
            serializeAnimationMetadata(model),
            `${id}.json`,
          );
        },
      },
      {
        id: 'anim-c-header',
        name: c.headerFileName,
        category: 'C Header',
        description: t('deliveryArtifactCHeader'),
        sizeBytes: new Blob([c.header]).size,
        isPrimary: false,
        onDownload: () => {
          options.onDownloadText(c.header, c.headerFileName);
        },
      },
      {
        id: 'anim-c-source',
        name: c.sourceFileName,
        category: 'C Source',
        description: t('deliveryArtifactCSource'),
        sizeBytes: new Blob([c.source]).size,
        isPrimary: false,
        onDownload: () => {
          options.onDownloadText(c.source, c.sourceFileName);
        },
      },
      {
        id: 'anim-asm-include',
        name: asm.includeFileName,
        category: 'ASM Include',
        description: t('deliveryArtifactAsmInclude'),
        sizeBytes: new Blob([asm.include]).size,
        isPrimary: false,
        onDownload: () => {
          options.onDownloadText(asm.include, asm.includeFileName);
        },
      },
      {
        id: 'anim-asm-source',
        name: asm.sourceFileName,
        category: 'ASM Source',
        description: t('deliveryArtifactAsmSource'),
        sizeBytes: new Blob([asm.source]).size,
        isPrimary: false,
        onDownload: () => {
          options.onDownloadText(asm.source, asm.sourceFileName);
        },
      },
    );
  } else if (options.mode === 'playfield') {
    const [backgroundPaletteArtifact, ...additionalPaletteArtifacts] =
      createPaletteDeliveryArtifacts(
        options,
        options.paletteState,
        baseName,
        'pf',
      );
    supplementalPaletteArtifacts = additionalPaletteArtifacts;
    if (options.chr !== null) {
      artifacts.push({
        id: 'pf-chr',
        name: `${baseName}.chr`,
        category: 'CHR-ROM',
        description: t('deliveryArtifactChr'),
        sizeBytes: options.chr.length,
        isPrimary: true,
        onDownload: () => {
          if (options.chr)
            options.onDownloadBytes(options.chr, `${baseName}.chr`);
        },
      });
    }

    artifacts.push(backgroundPaletteArtifact);

    if (options.nametable !== null) {
      artifacts.push({
        id: 'pf-nam',
        name: `${baseName}.nam`,
        category: 'Nametable',
        description: t('deliveryArtifactNametable'),
        sizeBytes: options.nametable.length,
        isPrimary: false,
        onDownload: () => {
          if (options.nametable) {
            options.onDownloadBytes(options.nametable, `${baseName}.nam`);
          }
        },
      });
    }

    if (options.attributeTable !== null) {
      artifacts.push({
        id: 'pf-atr',
        name: `${baseName}.atr`,
        category: 'Attribute Table',
        description: t('deliveryArtifactAttributeTable'),
        sizeBytes: options.attributeTable.length,
        isPrimary: false,
        onDownload: () => {
          if (options.attributeTable) {
            options.onDownloadBytes(options.attributeTable, `${baseName}.atr`);
          }
        },
      });
    }

    if (options.collisionMap !== null) {
      artifacts.push({
        id: 'pf-col',
        name: `${baseName}.col`,
        category: 'Collision Map',
        description: t('deliveryArtifactCollision'),
        sizeBytes: options.collisionMap.length,
        isPrimary: false,
        onDownload: () => {
          if (options.collisionMap) {
            options.onDownloadBytes(options.collisionMap, `${baseName}.col`);
          }
        },
      });
    }
  } else {
    // Tileset mode
    const [backgroundPaletteArtifact, ...additionalPaletteArtifacts] =
      createPaletteDeliveryArtifacts(
        options,
        options.paletteState,
        baseName,
        'ts',
      );
    supplementalPaletteArtifacts = additionalPaletteArtifacts;
    if (options.chr !== null) {
      artifacts.push({
        id: 'ts-chr',
        name: `${baseName}.chr`,
        category: 'CHR-ROM',
        description: t('deliveryArtifactChr'),
        sizeBytes: options.chr.length,
        isPrimary: true,
        onDownload: () => {
          if (options.chr)
            options.onDownloadBytes(options.chr, `${baseName}.chr`);
        },
      });
    }

    artifacts.push(backgroundPaletteArtifact);
  }

  artifacts.push(...supplementalPaletteArtifacts);

  // 4. Artifacts Panel
  const artifactsPanel = document.createElement('section');
  artifactsPanel.className = 'panel delivery-artifacts-panel';
  artifactsPanel.id = 'section-delivery-artifacts';

  const artifactsHeading = document.createElement('h3');
  artifactsHeading.textContent = t('deliveryArtifactsTitle');

  const artifactsHint = document.createElement('p');
  artifactsHint.className = 'panel-hint';
  artifactsHint.textContent = t('deliveryArtifactsHint');

  artifactsPanel.append(artifactsHeading, artifactsHint);

  if (artifacts.length === 0) {
    const emptyMsg = document.createElement('p');
    emptyMsg.className = 'empty-message delivery-empty-artifacts';
    emptyMsg.textContent = t('deliveryNoArtifacts');
    artifactsPanel.append(emptyMsg);
  } else {
    const artifactsGrid = document.createElement('div');
    artifactsGrid.className = 'delivery-artifacts-grid';

    artifacts.forEach((art) => {
      const card = document.createElement('article');
      const blocked =
        art.blocked === true ||
        (!compiledArtifactsAvailable &&
          art.category !== 'Palette' &&
          art.category !== 'Collision Map');
      card.className = `delivery-artifact-card${art.isPrimary ? ' is-primary' : ''}${blocked ? ' is-blocked' : ''}`;
      card.setAttribute('data-artifact-id', art.id);

      const cardHeader = document.createElement('div');
      cardHeader.className = 'delivery-artifact-header';

      const catBadge = document.createElement('span');
      catBadge.className = 'delivery-artifact-cat';
      catBadge.textContent = art.category;

      const sizeLabel = document.createElement('span');
      sizeLabel.className = 'delivery-artifact-size';
      sizeLabel.textContent = `${String(art.sizeBytes)} B`;

      cardHeader.append(catBadge, sizeLabel);

      const nameHeading = document.createElement('h4');
      nameHeading.className = 'delivery-artifact-name';
      nameHeading.textContent = art.name;

      const desc = document.createElement('p');
      desc.className = 'delivery-artifact-desc';
      desc.textContent = art.description;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `button ${art.isPrimary ? 'primary-button' : 'secondary-button'} delivery-download-btn`;
      btn.textContent = t('deliveryDownloadArtifact', { name: art.name });
      btn.disabled = blocked;
      if (!blocked) btn.addEventListener('click', art.onDownload);

      card.append(cardHeader, nameHeading, desc, btn);
      artifactsGrid.append(card);
    });

    artifactsPanel.append(artifactsGrid);
  }

  container.append(artifactsPanel);

  // 4. CHR Resource Accounting by Asset
  if (options.chrAssetMappingIndex) {
    const ownershipMetrics = calculateProjectChrOwnershipMetrics({
      mappingIndex: options.chrAssetMappingIndex,
      activeAssets: options.activeAssets,
    });

    if (ownershipMetrics.byAsset.length > 0) {
      const assetsPanel = document.createElement('section');
      assetsPanel.className = 'panel delivery-chr-assets-panel';
      assetsPanel.id = 'section-delivery-chr-assets';

      const assetsHeader = document.createElement('div');
      assetsHeader.className = 'delivery-chr-assets-header';

      const assetsHeading = document.createElement('h3');
      assetsHeading.textContent = t('deliveryResourceSummaryTitle');

      const assetsSubtitle = document.createElement('p');
      assetsSubtitle.className = 'delivery-chr-assets-subtitle muted';
      assetsSubtitle.textContent = t('deliveryResourceSummarySubtitle');

      assetsHeader.append(assetsHeading, assetsSubtitle);
      assetsPanel.append(assetsHeader);

      const assetsGrid = document.createElement('div');
      assetsGrid.className = 'chr-asset-metrics-grid';

      for (const assetMetric of ownershipMetrics.byAsset) {
        const card = document.createElement('div');
        card.className = 'chr-asset-metric-card';

        const cardHeader = document.createElement('div');
        cardHeader.className = 'chr-asset-metric-card-header';

        const cardTitleGroup = document.createElement('div');
        cardTitleGroup.className = 'chr-asset-metric-name-group';

        const assetName = document.createElement('strong');
        assetName.className = 'chr-asset-metric-name';
        assetName.textContent = assetMetric.assetName ?? assetMetric.assetId;

        const assetId = document.createElement('code');
        assetId.className = 'chr-asset-metric-id muted';
        assetId.textContent = assetMetric.assetId;

        cardTitleGroup.append(assetName, assetId);
        cardHeader.append(cardTitleGroup);
        card.append(cardHeader);

        const chipsList = document.createElement('ul');
        chipsList.className = 'chr-asset-metric-chips';

        const addChip = (text: string, className?: string) => {
          const chip = document.createElement('li');
          chip.className = `chr-metric-chip ${className ?? ''}`;
          chip.textContent = text;
          chipsList.append(chip);
        };

        addChip(
          t('chrAssetMetricsUniqueSlots', {
            count: assetMetric.uniquePhysicalSlots,
          }),
          'chip-unique',
        );
        addChip(
          t('chrAssetMetricsOwnedSlots', {
            count: assetMetric.primaryOwnedSlots,
          }),
          'chip-owned',
        );

        if (assetMetric.sharedSlots > 0) {
          addChip(
            t('chrAssetMetricsSharedSlots', {
              count: assetMetric.sharedSlots,
            }),
            'chip-shared',
          );
        }

        if (assetMetric.baseChrReusedSlots > 0) {
          addChip(
            t('chrAssetMetricsBaseChrReusedSlots', {
              count: assetMetric.baseChrReusedSlots,
            }),
            'chip-base-chr',
          );
        }

        addChip(
          t('chrAssetMetricsPt0Pt1Breakdown', {
            pt0: assetMetric.patternTableSlots[0],
            pt1: assetMetric.patternTableSlots[1],
          }),
          'chip-pt-breakdown',
        );

        card.append(chipsList);
        assetsGrid.append(card);
      }

      assetsPanel.append(assetsGrid);
      container.append(assetsPanel);
    }
  }

  // 5. Editing Shortcuts & Links
  const linksPanel = document.createElement('section');
  linksPanel.className = 'panel delivery-links-panel';
  linksPanel.id = 'section-delivery-links';

  const linksHeading = document.createElement('h3');
  linksHeading.textContent = t('deliveryLinksTitle');

  const linksGrid = document.createElement('div');
  linksGrid.className = 'delivery-links-grid';

  const shortcuts: readonly [WorkspaceView, TranslationKey][] = [
    ['tileset', 'deliveryLinkTileset'],
    ['playfield', 'deliveryLinkPlayfield'],
    ['background', 'deliveryLinkBackground'],
    ['animation', 'deliveryLinkAnimation'],
    ['palette', 'deliveryLinkPalettes'],
    ['chr', 'deliveryLinkChr'],
  ];

  shortcuts.forEach(([view, labelKey]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'button secondary-button delivery-link-btn';
    btn.textContent = t(labelKey);
    btn.addEventListener('click', () => {
      if (options.onNavigateWorkspace) {
        options.onNavigateWorkspace(view);
      }
    });
    linksGrid.append(btn);
  });

  linksPanel.append(linksHeading, linksGrid);
  container.append(linksPanel);

  return container;
}
