import {
  advanceScenePlayback,
  computeInstanceProjection,
  createSceneInstance,
  deriveSceneInstanceResourceFacts,
  getInstanceAnimationReferenceStatus,
  getAnimationsForEntity,
  getAvailableEntities,
  NES_SCREEN_HEIGHT,
  NES_SCREEN_WIDTH,
  resetPlaybackStates,
  resolveInstanceAnimation,
  resolveScenePaletteIds,
  type InstancePlaybackState,
  type ScenePreviewInstance,
} from '../core/scene-preview';
import type { AnimationProjectModel } from '../core/animation-model';
import type { ChrAssetMappingIndex } from '../core/chr-asset-mapping';
import { renderIndexedImageWithPalette } from '../core/animation-palette';
import { applyPixelOverridesToImage } from '../core/pixel-overrides';
import {
  analyzeScenePalettes,
  resolveEffectivePaletteColors,
  resolveSpritePaletteSlot,
  type PaletteDefinition,
} from '../core/palette-manager';
import type { NesPaletteSet } from '../core/nes-palette';
import { t } from '../i18n';
import type { AnimationItemSetting } from './types';
import { cropCanvas } from './animation-editor';

export interface ScenePreviewPanelOptions {
  readonly instances: readonly ScenePreviewInstance[];
  readonly selectedInstanceId?: string | null;
  readonly animations: readonly AnimationItemSetting[];
  readonly spritePaletteSet: NesPaletteSet;
  readonly palettes: readonly PaletteDefinition[];
  readonly activeSpriteSlots: readonly (string | null)[];
  readonly defaultPaletteIndex: number;
  readonly animationModel?: AnimationProjectModel | null;
  readonly chrAssetMappingIndex?: ChrAssetMappingIndex | null;
  readonly playbackSession?: ScenePreviewPlaybackSession;
  readonly onSelectInstance?: (instanceId: string | null) => void;
  readonly onAddInstance: (instance: ScenePreviewInstance) => void;
  readonly onRemoveInstance: (instanceId: string) => void;
  readonly onDuplicateInstance?: (instanceId: string) => void;
  readonly onReorderInstance: (
    instanceId: string,
    direction: 'forward' | 'backward',
  ) => void;
  readonly onUpdateInstance: (
    instanceId: string,
    patch: Partial<ScenePreviewInstance>,
  ) => void;
  readonly onNavigateToAnimation?: (
    animationId: string,
    frameIndex: number,
  ) => void;
  readonly onNavigateToPalette?: (paletteId: string) => void;
  readonly onNavigateToChr?: (context: {
    readonly animationId: string;
    readonly frameIndex: number;
    readonly entity: string;
    readonly physicalTileIndex: number | null;
    readonly assetId: string | null;
  }) => void;
}

export interface ScenePreviewPlaybackSession {
  readonly playing: boolean;
  readonly playbackStates: Map<string, InstancePlaybackState>;
  reconcile(
    instances: readonly ScenePreviewInstance[],
    animations: readonly AnimationItemSetting[],
  ): void;
  setPlaying(playing: boolean): void;
  reset(instances: readonly ScenePreviewInstance[]): void;
  advance(
    instances: readonly ScenePreviewInstance[],
    animations: readonly AnimationItemSetting[],
    ticks: number,
  ): void;
  clear(): void;
}

export function createScenePreviewPlaybackSession(): ScenePreviewPlaybackSession {
  let playing = true;
  let playbackStates = new Map<string, InstancePlaybackState>();
  let animationIds = new Map<string, string>();

  return {
    get playing() {
      return playing;
    },
    get playbackStates() {
      return playbackStates;
    },
    reconcile(instances, animations) {
      const nextStates = new Map<string, InstancePlaybackState>();
      const nextAnimationIds = new Map<string, string>();
      for (const instance of instances) {
        const animationId =
          resolveInstanceAnimation(instance, animations)?.id ??
          instance.animationId;
        const existing = playbackStates.get(instance.id);
        const sameAnimation = animationIds.get(instance.id) === animationId;
        nextStates.set(
          instance.id,
          existing !== undefined && sameAnimation
            ? existing
            : {
                instanceId: instance.id,
                currentFrameIndex: 0,
                elapsedTicks: 0,
              },
        );
        nextAnimationIds.set(instance.id, animationId);
      }
      playbackStates = nextStates;
      animationIds = nextAnimationIds;
    },
    setPlaying(nextPlaying) {
      playing = nextPlaying;
    },
    reset(instances) {
      playbackStates = resetPlaybackStates(instances);
    },
    advance(instances, animations, ticks) {
      playbackStates = advanceScenePlayback(
        instances,
        playbackStates,
        animations,
        ticks,
      );
    },
    clear() {
      playing = true;
      playbackStates = new Map<string, InstancePlaybackState>();
      animationIds = new Map<string, string>();
    },
  };
}

const scenePreviewDisposers = new WeakMap<HTMLElement, () => void>();

type SceneKeyboardCommand =
  | { readonly type: 'move'; readonly deltaX: number; readonly deltaY: number }
  | { readonly type: 'remove' }
  | {
      readonly type: 'reorder';
      readonly direction: 'forward' | 'backward';
    };

let pendingSceneFocusInstanceId: string | null = null;
let pendingSceneAnnouncement: string | null = null;

export function getSceneKeyboardCommand(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey'>,
): SceneKeyboardCommand | null {
  if (event.altKey || event.metaKey) return null;
  if (event.ctrlKey) {
    if (event.key === 'ArrowUp') {
      return { type: 'reorder', direction: 'forward' };
    }
    if (event.key === 'ArrowDown') {
      return { type: 'reorder', direction: 'backward' };
    }
    return null;
  }
  switch (event.key) {
    case 'ArrowLeft':
      return { type: 'move', deltaX: -1, deltaY: 0 };
    case 'ArrowRight':
      return { type: 'move', deltaX: 1, deltaY: 0 };
    case 'ArrowUp':
      return { type: 'move', deltaX: 0, deltaY: -1 };
    case 'ArrowDown':
      return { type: 'move', deltaX: 0, deltaY: 1 };
    case 'Delete':
      return { type: 'remove' };
    default:
      return null;
  }
}

function requestSceneFocus(
  instanceId: string | null,
  announcement?: string,
): void {
  pendingSceneFocusInstanceId = instanceId;
  pendingSceneAnnouncement = announcement ?? null;
  queueMicrotask(() => {
    if (pendingSceneFocusInstanceId === instanceId) {
      pendingSceneFocusInstanceId = null;
      pendingSceneAnnouncement = null;
    }
  });
}

function isEditableSceneShortcutTarget(target: EventTarget | null): boolean {
  const tagName = (
    target as { tagName?: string } | null
  )?.tagName?.toLowerCase();
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
    return true;
  }
  return (
    (target as { isContentEditable?: boolean } | null)?.isContentEditable ===
    true
  );
}

function createScenePositionPatch(
  instance: ScenePreviewInstance,
  animation: AnimationItemSetting | null,
  posX: number,
  posY: number,
): Pick<ScenePreviewInstance, 'x' | 'y' | 'anchorX' | 'anchorY'> | null {
  if (
    animation === null &&
    (instance.anchorX === undefined || instance.anchorY === undefined)
  ) {
    return null;
  }
  const clampedX = Math.max(0, Math.min(NES_SCREEN_WIDTH, posX));
  const clampedY = Math.max(0, Math.min(NES_SCREEN_HEIGHT, posY));
  const originX = animation?.originX ?? 0;
  const originY = animation?.originY ?? 0;
  return {
    anchorX: clampedX + originX,
    anchorY: clampedY + originY,
    x: clampedX,
    y: clampedY,
  };
}

export function disposeScenePreviewPanels(root: ParentNode): void {
  root
    .querySelectorAll<HTMLElement>('.scene-preview-panel')
    .forEach((panel) => {
      scenePreviewDisposers.get(panel)?.();
    });
}

export function createScenePreviewPanel(
  options: ScenePreviewPanelOptions,
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'panel scene-preview-panel';
  section.id = 'section-scene-preview';

  const header = document.createElement('header');
  header.className = 'panel-header scene-preview-header';

  const titleGroup = document.createElement('div');
  titleGroup.className = 'scene-preview-title-group';

  const title = document.createElement('h2');
  title.textContent = t('scenePreviewTitle');

  const hint = document.createElement('p');
  hint.className = 'panel-hint';
  hint.textContent = t('scenePreviewHint');

  titleGroup.append(title, hint);

  const availableEntities = getAvailableEntities(options.animations);
  const statsBadge = document.createElement('span');
  statsBadge.className = 'status-badge scene-preview-stats-badge';
  const capacityAlert = document.createElement('p');
  capacityAlert.className = 'scene-preview-palette-capacity-alert';
  capacityAlert.setAttribute('role', 'alert');

  // Action controls
  const toolbar = document.createElement('div');
  toolbar.className = 'scene-preview-toolbar';

  const playbackSession =
    options.playbackSession ?? createScenePreviewPlaybackSession();
  playbackSession.reconcile(options.instances, options.animations);
  let currentSelectedInstanceId: string | null =
    options.selectedInstanceId !== undefined
      ? options.selectedInstanceId
      : (options.instances[0]?.id ?? null);
  const focusInstanceId = pendingSceneFocusInstanceId;
  const initialAnnouncement = pendingSceneAnnouncement;
  pendingSceneFocusInstanceId = null;
  pendingSceneAnnouncement = null;
  const playbackStates = (): Map<string, InstancePlaybackState> =>
    playbackSession.playbackStates;
  let renderSelectedResourceContext: (() => void) | null = null;

  const renderPaletteStatus = (): void => {
    const paletteIds = resolveScenePaletteIds(
      options.instances,
      playbackStates(),
      options.animations,
    );
    const paletteAnalysis = analyzeScenePalettes(
      paletteIds,
      options.activeSpriteSlots,
      options.palettes,
    );
    const slotWarningText =
      paletteAnalysis.unassignedPaletteIds.length > 0
        ? ` (⚠️ ${t('scenePreviewSlotWarning', { count: paletteAnalysis.unassignedPaletteIds.length })})`
        : '';
    statsBadge.textContent = `${t('scenePreviewStats', {
      entities: availableEntities.length,
      instances: options.instances.length,
    })} · ${t('scenePreviewPalettesUsed', { count: paletteAnalysis.requiredCount })}${slotWarningText}`;

    capacityAlert.hidden = paletteAnalysis.requiredCount <= 4;
    if (!capacityAlert.hidden) {
      const paletteNames = paletteAnalysis.distinctPaletteIds
        .map(
          (paletteId) =>
            options.palettes.find((palette) => palette.id === paletteId)
              ?.name ?? paletteId,
        )
        .join(', ');
      capacityAlert.textContent = t('scenePreviewPaletteCapacityAlert', {
        count: paletteAnalysis.requiredCount,
        palettes: paletteNames,
      });
    }

    options.instances.forEach((instance) => {
      const badge = section.querySelector<HTMLElement>(
        `[data-scene-palette-instance="${instance.id}"]`,
      );
      if (badge === null) return;
      const animation = resolveInstanceAnimation(instance, options.animations);
      const frameIndex =
        playbackStates().get(instance.id)?.currentFrameIndex ?? 0;
      const paletteId =
        animation?.framePaletteIds?.[frameIndex] ?? animation?.paletteId;
      badge.hidden = !paletteId;
      if (!paletteId) return;
      const slot = resolveSpritePaletteSlot(
        paletteId,
        options.activeSpriteSlots,
        options.palettes,
      );
      badge.className = `status-badge ${slot.isActive ? 'scene-slot-active-badge' : 'scene-slot-inactive-badge'}`;
      badge.textContent = slot.isActive
        ? `SPR ${String(slot.slotIndex)}`
        : `⚠️ ${t('paletteManagerSlotInactive')}`;
      badge.title = slot.definition?.name ?? paletteId;
    });

    const selectedInstance = options.instances.find(
      (instance) => instance.id === currentSelectedInstanceId,
    );
    const inspectorStatus = section.querySelector<HTMLElement>(
      '.scene-preview-inspector-palette-status',
    );
    if (selectedInstance !== undefined && inspectorStatus !== null) {
      const animation = resolveInstanceAnimation(
        selectedInstance,
        options.animations,
      );
      const frameIndex =
        playbackStates().get(selectedInstance.id)?.currentFrameIndex ?? 0;
      const paletteId =
        animation?.framePaletteIds?.[frameIndex] ?? animation?.paletteId;
      const slot = resolveSpritePaletteSlot(
        paletteId,
        options.activeSpriteSlots,
        options.palettes,
      );
      inspectorStatus.textContent = `${t('scenePreviewPaletteStatus')}: ${
        slot.definition?.name ?? paletteId ?? t('paletteManagerSlotEmpty')
      } · ${
        slot.isActive
          ? `SPR ${String(slot.slotIndex)}`
          : t('paletteManagerSlotInactive')
      }`;
    }
    renderSelectedResourceContext?.();
  };
  renderPaletteStatus();

  const btnPlayPause = document.createElement('button');
  btnPlayPause.type = 'button';
  btnPlayPause.className = 'button primary-button';
  btnPlayPause.textContent = t(
    playbackSession.playing ? 'scenePreviewPause' : 'scenePreviewPlay',
  );

  const btnReset = document.createElement('button');
  btnReset.type = 'button';
  btnReset.className = 'button secondary-button';
  btnReset.textContent = t('scenePreviewReset');

  // Add entity dropdown / button
  const addContainer = document.createElement('div');
  addContainer.className = 'scene-preview-add-container';

  const btnAddEntity = document.createElement('button');
  btnAddEntity.type = 'button';
  btnAddEntity.className = 'button primary-button';
  btnAddEntity.textContent = t('scenePreviewAddEntity');

  if (availableEntities.length === 0) {
    btnAddEntity.disabled = true;
    btnAddEntity.title = t('scenePreviewNoEntities');
  }

  const addSelect = document.createElement('select');
  addSelect.className = 'scene-preview-entity-select-dropdown';
  availableEntities.forEach((ent) => {
    const opt = document.createElement('option');
    opt.value = ent;
    opt.textContent = ent;
    addSelect.append(opt);
  });

  btnAddEntity.addEventListener('click', () => {
    const targetEntity =
      addSelect.value !== ''
        ? addSelect.value
        : (availableEntities[0] ?? 'entity');
    const newInst = createSceneInstance(targetEntity, options.animations);
    options.onAddInstance(newInst);
    currentSelectedInstanceId = newInst.id;
    if (options.onSelectInstance) {
      options.onSelectInstance(newInst.id);
    }
  });

  if (availableEntities.length > 1) {
    addContainer.append(addSelect, btnAddEntity);
  } else {
    addContainer.append(btnAddEntity);
  }

  toolbar.append(btnPlayPause, btnReset, addContainer, statsBadge);
  header.append(titleGroup, toolbar);
  section.append(header, capacityAlert);

  // Main Layout
  const layout = document.createElement('div');
  layout.className = 'scene-preview-layout';

  // Canvas container
  const canvasWrapper = document.createElement('div');
  canvasWrapper.className = 'scene-preview-canvas-wrapper';

  const canvas = document.createElement('canvas');
  canvas.className = 'scene-preview-canvas';
  canvas.width = NES_SCREEN_WIDTH;
  canvas.height = NES_SCREEN_HEIGHT;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', t('scenePreviewTitle'));
  canvas.setAttribute('aria-describedby', 'scene-preview-keyboard-hint');

  const keyboardHint = document.createElement('p');
  keyboardHint.id = 'scene-preview-keyboard-hint';
  keyboardHint.className = 'visually-hidden';
  keyboardHint.textContent = t('scenePreviewKeyboardHint');

  const liveStatus = document.createElement('p');
  liveStatus.className = 'visually-hidden scene-preview-live-status';
  liveStatus.setAttribute('role', 'status');
  liveStatus.setAttribute('aria-live', 'polite');
  liveStatus.setAttribute('aria-atomic', 'true');
  liveStatus.textContent = initialAnnouncement ?? '';

  const canvasOverlay = document.createElement('div');
  canvasOverlay.className = 'scene-preview-canvas-overlay';
  canvasOverlay.textContent = 'NES 256 × 240';

  canvasWrapper.append(canvas, canvasOverlay, keyboardHint, liveStatus);

  // Side column container (Instances list + Contextual Inspector)
  const sideCol = document.createElement('div');
  sideCol.className = 'scene-preview-side-col';

  // 1. Instances list container
  const listWrapper = document.createElement('div');
  listWrapper.className = 'scene-preview-instances-wrapper';

  const listTitle = document.createElement('h3');
  listTitle.id = 'scene-preview-instances-title';
  listTitle.className = 'scene-preview-instances-title';
  listTitle.textContent = `${t('scenePreviewInstanceLabel')} (${String(options.instances.length)})`;
  listWrapper.append(listTitle);
  const cardByInstanceId = new Map<string, HTMLElement>();

  if (options.instances.length === 0) {
    const emptyMsg = document.createElement('p');
    emptyMsg.className = 'empty-message scene-preview-empty';
    emptyMsg.textContent = t('scenePreviewEmptyScene');
    listWrapper.append(emptyMsg);
  } else {
    const list = document.createElement('div');
    list.className = 'scene-preview-instances-list';
    list.setAttribute('role', 'list');
    list.setAttribute('aria-labelledby', listTitle.id);
    list.setAttribute('aria-describedby', keyboardHint.id);
    options.instances.forEach((inst, index) => {
      const isSelected = currentSelectedInstanceId === inst.id;
      const card = document.createElement('div');
      card.className = `scene-preview-instance-card${isSelected ? ' is-selected' : ''}`;
      card.setAttribute('role', 'listitem');
      card.setAttribute('aria-posinset', String(index + 1));
      card.setAttribute('aria-setsize', String(options.instances.length));
      card.setAttribute('data-scene-instance-id', inst.id);

      const instanceName =
        inst.name ?? `${inst.entityId} #${String(index + 1)}`;
      const animation = resolveInstanceAnimation(inst, options.animations);
      const projection = computeInstanceProjection(inst, animation);
      const cardHeader = document.createElement('div');
      cardHeader.className = 'scene-preview-card-header';

      const cardTitle = document.createElement('button');
      cardTitle.type = 'button';
      cardTitle.className =
        'scene-preview-card-title scene-preview-instance-focus-target';
      cardTitle.textContent = instanceName;
      cardTitle.setAttribute('aria-pressed', String(isSelected));
      cardTitle.setAttribute('data-scene-instance-id', inst.id);
      cardTitle.setAttribute(
        'aria-label',
        t('scenePreviewInstanceAriaLabel', {
          name: instanceName,
          x: projection.posX,
          y: projection.posY,
          position: index + 1,
          total: options.instances.length,
        }),
      );
      cardByInstanceId.set(inst.id, cardTitle);

      const cardActions = document.createElement('div');
      cardActions.className = 'scene-preview-card-actions';

      // Visibility toggle
      const btnVisible = document.createElement('button');
      btnVisible.type = 'button';
      btnVisible.className = `button secondary-button scene-preview-vis-btn${inst.visible ? ' is-visible' : ' is-hidden'}`;
      btnVisible.textContent = inst.visible ? '👁' : '🚫';
      btnVisible.title = t('scenePreviewVisible');
      btnVisible.setAttribute(
        'aria-label',
        t('scenePreviewVisibilityAriaLabel', { name: instanceName }),
      );
      btnVisible.addEventListener('click', (e) => {
        e.stopPropagation();
        requestSceneFocus(inst.id);
        options.onUpdateInstance(inst.id, { visible: !inst.visible });
      });

      // Remove button
      const btnRemove = document.createElement('button');
      btnRemove.type = 'button';
      btnRemove.className = 'button secondary-button button-danger';
      btnRemove.textContent = '✕';
      btnRemove.title = t('scenePreviewRemove');
      btnRemove.setAttribute(
        'aria-label',
        t('scenePreviewRemoveAriaLabel', { name: instanceName }),
      );
      btnRemove.addEventListener('click', (e) => {
        e.stopPropagation();
        requestSceneFocus(
          options.instances[index + 1]?.id ??
            options.instances[index - 1]?.id ??
            null,
        );
        options.onRemoveInstance(inst.id);
      });

      const instAnim = resolveInstanceAnimation(inst, options.animations);
      const animationStatus = getInstanceAnimationReferenceStatus(
        inst,
        options.animations,
      );
      const currentFrameIndex =
        playbackStates().get(inst.id)?.currentFrameIndex ?? 0;
      const effectivePaletteId =
        instAnim?.framePaletteIds?.[currentFrameIndex] ?? instAnim?.paletteId;
      const slotRes = resolveSpritePaletteSlot(
        effectivePaletteId,
        options.activeSpriteSlots,
        options.palettes,
      );

      if (options.palettes.length > 0) {
        const slotBadge = document.createElement('span');
        slotBadge.setAttribute('data-scene-palette-instance', inst.id);
        slotBadge.hidden = !effectivePaletteId;
        slotBadge.className = `status-badge ${slotRes.isActive ? 'scene-slot-active-badge' : 'scene-slot-inactive-badge'}`;
        slotBadge.textContent = slotRes.isActive
          ? `SPR ${String(slotRes.slotIndex)}`
          : `⚠️ ${t('paletteManagerSlotInactive')}`;
        slotBadge.title = slotRes.definition?.name ?? '';
        cardActions.append(slotBadge);
      }

      cardActions.append(btnVisible, btnRemove);
      cardHeader.append(cardTitle, cardActions);
      card.append(cardHeader);

      if (animationStatus !== 'resolved') {
        const warning = document.createElement('p');
        warning.className = 'scene-preview-invalid-animation-warning';
        warning.setAttribute('role', 'alert');
        warning.textContent = t('scenePreviewInvalidAnimationWarning', {
          name: inst.animationName,
        });
        card.append(warning);
      }

      card.addEventListener('click', () => {
        currentSelectedInstanceId = inst.id;
        if (options.onSelectInstance) {
          options.onSelectInstance(inst.id);
        }
        section
          .querySelectorAll('.scene-preview-instance-card')
          .forEach((c) => {
            const selected = c === card;
            c.classList.toggle('is-selected', selected);
            c.querySelector(
              '.scene-preview-instance-focus-target',
            )?.setAttribute('aria-pressed', String(selected));
          });
        card.classList.add('is-selected');
        cardTitle.focus({ preventScroll: true });
        renderInspector();
        drawScene();
      });

      cardTitle.addEventListener('keydown', (event) => {
        if (
          isEditableSceneShortcutTarget(event.target) ||
          (event.target !== null && event.target !== cardTitle)
        ) {
          return;
        }
        const command = getSceneKeyboardCommand(event);
        if (command === null) return;
        event.preventDefault();

        if (command.type === 'remove') {
          requestSceneFocus(
            options.instances[index + 1]?.id ??
              options.instances[index - 1]?.id ??
              null,
          );
          options.onRemoveInstance(inst.id);
          return;
        }

        if (command.type === 'reorder') {
          requestSceneFocus(
            inst.id,
            t('scenePreviewOrderAnnouncement', { name: instanceName }),
          );
          options.onReorderInstance(inst.id, command.direction);
          return;
        }

        const currentProjection = computeInstanceProjection(inst, animation);
        const patch = createScenePositionPatch(
          inst,
          animation,
          currentProjection.posX + command.deltaX,
          currentProjection.posY + command.deltaY,
        );
        if (patch === null) return;
        requestSceneFocus(
          inst.id,
          t('scenePreviewMovedAnnouncement', {
            name: instanceName,
            x: patch.x,
            y: patch.y,
          }),
        );
        options.onUpdateInstance(inst.id, patch);
      });

      list.append(card);
    });

    listWrapper.append(list);

    if (focusInstanceId !== null) {
      const focusCard = cardByInstanceId.get(focusInstanceId);
      queueMicrotask(() => focusCard?.focus({ preventScroll: true }));
    }
  }

  // 2. Contextual Inspector Container
  const inspectorWrapper = document.createElement('div');
  inspectorWrapper.className = 'scene-preview-inspector-wrapper';

  const renderInspector = (): void => {
    renderSelectedResourceContext = null;
    inspectorWrapper.replaceChildren();

    const inspectorHeading = document.createElement('h3');
    inspectorHeading.className = 'scene-preview-inspector-title';
    inspectorHeading.textContent = t('scenePreviewInspectorTitle');
    inspectorWrapper.append(inspectorHeading);

    const selectedInst = options.instances.find(
      (inst) => inst.id === currentSelectedInstanceId,
    );

    if (!selectedInst) {
      const emptyPrompt = document.createElement('p');
      emptyPrompt.className = 'empty-message scene-preview-inspector-empty';
      emptyPrompt.textContent = t('scenePreviewNoSelectedInstance');
      inspectorWrapper.append(emptyPrompt);
      return;
    }

    const inspectorCard = document.createElement('div');
    inspectorCard.className = 'scene-preview-inspector-card';

    const selectedAnimation = resolveInstanceAnimation(
      selectedInst,
      options.animations,
    );
    const selectedFrameIndex =
      playbackStates().get(selectedInst.id)?.currentFrameIndex ?? 0;
    const selectedPaletteId =
      selectedAnimation?.framePaletteIds?.[selectedFrameIndex] ??
      selectedAnimation?.paletteId;
    const selectedPaletteSlot = resolveSpritePaletteSlot(
      selectedPaletteId,
      options.activeSpriteSlots,
      options.palettes,
    );
    const paletteStatus = document.createElement('p');
    paletteStatus.className = 'scene-preview-inspector-palette-status';
    paletteStatus.textContent = `${t('scenePreviewPaletteStatus')}: ${
      selectedPaletteSlot.definition?.name ??
      selectedPaletteId ??
      t('paletteManagerSlotEmpty')
    } · ${
      selectedPaletteSlot.isActive
        ? `SPR ${String(selectedPaletteSlot.slotIndex)}`
        : t('paletteManagerSlotInactive')
    }`;

    const resourcePanel = document.createElement('section');
    resourcePanel.className = 'scene-preview-resource-context';
    const resourceHeading = document.createElement('h4');
    resourceHeading.textContent = t('scenePreviewResourceContextTitle');
    const resourceSummary = document.createElement('p');
    resourceSummary.className = 'scene-preview-resource-summary';
    const ownershipSummary = document.createElement('p');
    ownershipSummary.className =
      'scene-preview-resource-summary scene-preview-resource-ownership';
    const missingPalette = document.createElement('p');
    missingPalette.className = 'scene-preview-resource-warning';
    resourcePanel.append(
      resourceHeading,
      resourceSummary,
      ownershipSummary,
      missingPalette,
    );

    const resourceActions = document.createElement('div');
    resourceActions.className = 'scene-preview-resource-actions';
    const openAnimation = document.createElement('button');
    openAnimation.type = 'button';
    openAnimation.className =
      'button secondary-button scene-preview-open-animation';
    openAnimation.textContent = t('scenePreviewOpenAnimation');
    openAnimation.addEventListener('click', () => {
      if (selectedAnimation === null) return;
      options.onNavigateToAnimation?.(
        selectedAnimation.id,
        playbackStates().get(selectedInst.id)?.currentFrameIndex ?? 0,
      );
    });

    const openPalette = document.createElement('button');
    openPalette.type = 'button';
    openPalette.className =
      'button secondary-button scene-preview-open-palette';
    openPalette.textContent = t('scenePreviewOpenPalette');
    openPalette.addEventListener('click', () => {
      const frameIndex =
        playbackStates().get(selectedInst.id)?.currentFrameIndex ?? 0;
      const paletteId =
        selectedAnimation?.framePaletteIds?.[frameIndex] ??
        selectedAnimation?.paletteId;
      if (
        paletteId === null ||
        paletteId === undefined ||
        !options.palettes.some((palette) => palette.id === paletteId)
      ) {
        return;
      }
      options.onNavigateToPalette?.(paletteId);
    });

    const inspectChr = document.createElement('button');
    inspectChr.type = 'button';
    inspectChr.className = 'button secondary-button scene-preview-open-chr';
    inspectChr.textContent = t('scenePreviewInspectChr');
    inspectChr.addEventListener('click', () => {
      const frameIndex =
        playbackStates().get(selectedInst.id)?.currentFrameIndex ?? 0;
      const resourceContext = deriveSceneInstanceResourceFacts(
        selectedInst,
        frameIndex,
        options.animations,
        options.animationModel ?? null,
        options.chrAssetMappingIndex ?? null,
      );
      if (resourceContext.status !== 'resolved') return;
      options.onNavigateToChr?.({
        animationId: resourceContext.animationId,
        frameIndex: resourceContext.frameIndex,
        entity: selectedInst.entityId,
        physicalTileIndex: resourceContext.physicalTileIndices[0] ?? null,
        assetId: resourceContext.assetId,
      });
    });
    resourceActions.append(openAnimation, openPalette, inspectChr);
    resourcePanel.append(resourceActions);

    renderSelectedResourceContext = () => {
      const frameIndex =
        playbackStates().get(selectedInst.id)?.currentFrameIndex ?? 0;
      const resourceContext = deriveSceneInstanceResourceFacts(
        selectedInst,
        frameIndex,
        options.animations,
        options.animationModel ?? null,
        options.chrAssetMappingIndex ?? null,
      );
      const paletteId = resourceContext.paletteId;
      const paletteExists =
        paletteId !== null &&
        options.palettes.some((palette) => palette.id === paletteId);

      openAnimation.disabled = selectedAnimation === null;
      openPalette.disabled = !paletteExists;
      inspectChr.disabled = resourceContext.status !== 'resolved';
      missingPalette.hidden = paletteId === null || paletteExists;
      missingPalette.textContent =
        paletteId !== null && !paletteExists
          ? t('scenePreviewResourcePaletteUnresolved', { id: paletteId })
          : '';
      ownershipSummary.hidden = resourceContext.status !== 'resolved';

      if (resourceContext.status === 'resolved') {
        const patternTables = resourceContext.patternTables
          .map((patternTable) => `PT${String(patternTable)}`)
          .join(' + ');
        resourceSummary.textContent = t('scenePreviewResourceSummary', {
          frame: resourceContext.frameIndex + 1,
          frames: resourceContext.frameCount,
          sprites: resourceContext.spriteCount,
          slots: resourceContext.physicalTileIndices.length,
          patternTables: patternTables === '' ? '—' : patternTables,
        });
        ownershipSummary.textContent = t(
          'scenePreviewResourceOwnershipSummary',
          {
            base: resourceContext.baseChrTileCount,
            shared: resourceContext.sharedTileCount,
          },
        );
      } else if (resourceContext.status === 'unresolved-animation') {
        resourceSummary.textContent = t(
          'scenePreviewResourceAnimationUnresolved',
        );
      } else {
        resourceSummary.textContent = t('scenePreviewResourceChrUnavailable');
      }
    };
    renderSelectedResourceContext();

    // Name field
    const nameLabel = document.createElement('label');
    nameLabel.className = 'scene-preview-field';
    const nameText = document.createElement('span');
    nameText.textContent = t('scenePreviewInstanceName');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = selectedInst.name ?? '';
    nameInput.placeholder = `${selectedInst.entityId} instance`;
    nameInput.addEventListener('change', () => {
      options.onUpdateInstance(selectedInst.id, {
        name: nameInput.value.trim() || undefined,
      });
    });
    nameLabel.append(nameText, nameInput);

    // Entity select
    const entityLabel = document.createElement('label');
    entityLabel.className = 'scene-preview-field';
    const entityText = document.createElement('span');
    entityText.textContent = t('scenePreviewEntityLabel');
    const entitySelect = document.createElement('select');
    availableEntities.forEach((ent) => {
      const opt = document.createElement('option');
      opt.value = ent;
      opt.textContent = ent;
      opt.selected = ent.toLowerCase() === selectedInst.entityId.toLowerCase();
      entitySelect.append(opt);
    });
    entitySelect.addEventListener('change', () => {
      const newEntity = entitySelect.value;
      const entityAnims = getAnimationsForEntity(options.animations, newEntity);
      const defaultAnim =
        entityAnims.find((a) => a.name.toLowerCase().includes('idle')) ??
        entityAnims[0];
      options.onUpdateInstance(selectedInst.id, {
        animationId: defaultAnim?.id ?? '',
        entityId: newEntity,
        animationName: defaultAnim?.name ?? 'idle',
      });
    });
    entityLabel.append(entityText, entitySelect);

    // Animation select
    const animLabel = document.createElement('label');
    animLabel.className = 'scene-preview-field';
    const animText = document.createElement('span');
    animText.textContent = t('scenePreviewAnimationLabel');
    const animSelect = document.createElement('select');
    const entityAnims = getAnimationsForEntity(
      options.animations,
      selectedInst.entityId,
    );
    const referenceStatus = getInstanceAnimationReferenceStatus(
      selectedInst,
      options.animations,
    );
    if (referenceStatus !== 'resolved') {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = selectedInst.animationName;
      opt.selected = true;
      animSelect.append(opt);
    }
    entityAnims.forEach((a) => {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.name;
      opt.selected = a.id === selectedInst.animationId;
      animSelect.append(opt);
    });
    animSelect.disabled = entityAnims.length === 0;
    animSelect.addEventListener('change', () => {
      const selected = options.animations.find(
        (animation) => animation.id === animSelect.value,
      );
      if (selected === undefined) return;
      options.onUpdateInstance(selectedInst.id, {
        animationId: selected.id,
        entityId: selected.entity ?? 'entity',
        animationName: selected.name,
      });
    });
    animLabel.append(animText, animSelect);

    if (referenceStatus !== 'resolved') {
      const warning = document.createElement('p');
      warning.className = 'scene-preview-invalid-animation-warning';
      warning.setAttribute('role', 'alert');
      warning.textContent = t('scenePreviewInvalidAnimationWarning', {
        name: selectedInst.animationName,
      });
      inspectorCard.append(warning);
    }

    // Coordinates X & Y – display and edit the render position (posX/posY).
    // Internally stored as anchorX/anchorY; posX = anchorX - originX.
    const { posX: instPosX, posY: instPosY } = computeInstanceProjection(
      selectedInst,
      selectedAnimation,
    );
    const instOriginX = selectedAnimation?.originX ?? 0;
    const instOriginY = selectedAnimation?.originY ?? 0;

    const coordRow = document.createElement('div');
    coordRow.className = 'scene-preview-coord-row';

    const xLabel = document.createElement('label');
    xLabel.className = 'scene-preview-field scene-preview-coord-field';
    const xText = document.createElement('span');
    xText.textContent = t('scenePreviewPosX');
    const xInput = document.createElement('input');
    xInput.type = 'number';
    xInput.min = '0';
    xInput.max = String(NES_SCREEN_WIDTH);
    xInput.value = String(instPosX);
    xInput.addEventListener('change', () => {
      const val = Math.max(
        0,
        Math.min(NES_SCREEN_WIDTH, parseInt(xInput.value, 10) || 0),
      );
      options.onUpdateInstance(selectedInst.id, {
        anchorX: val + instOriginX,
        x: val,
      });
    });
    xLabel.append(xText, xInput);

    const yLabel = document.createElement('label');
    yLabel.className = 'scene-preview-field scene-preview-coord-field';
    const yText = document.createElement('span');
    yText.textContent = t('scenePreviewPosY');
    const yInput = document.createElement('input');
    yInput.type = 'number';
    yInput.min = '0';
    yInput.max = String(NES_SCREEN_HEIGHT);
    yInput.value = String(instPosY);
    yInput.addEventListener('change', () => {
      const val = Math.max(
        0,
        Math.min(NES_SCREEN_HEIGHT, parseInt(yInput.value, 10) || 0),
      );
      options.onUpdateInstance(selectedInst.id, {
        anchorY: val + instOriginY,
        y: val,
      });
    });
    yLabel.append(yText, yInput);

    coordRow.append(xLabel, yLabel);

    // Visibility Checkbox
    const visCheckboxLabel = document.createElement('label');
    visCheckboxLabel.className = 'checkbox-control scene-preview-vis-checkbox';
    const visCheckbox = document.createElement('input');
    visCheckbox.type = 'checkbox';
    visCheckbox.checked = selectedInst.visible;
    visCheckbox.addEventListener('change', () => {
      options.onUpdateInstance(selectedInst.id, {
        visible: visCheckbox.checked,
      });
    });
    visCheckboxLabel.append(visCheckbox, t('scenePreviewVisible'));

    // Inspector Action Buttons (Duplicate / Remove)
    const inspectorActions = document.createElement('div');
    inspectorActions.className = 'scene-preview-inspector-actions';
    const selectedIndex = options.instances.findIndex(
      (instance) => instance.id === selectedInst.id,
    );

    const btnMoveBackward = document.createElement('button');
    btnMoveBackward.type = 'button';
    btnMoveBackward.className = 'button secondary-button';
    btnMoveBackward.textContent = t('scenePreviewMoveBackward');
    btnMoveBackward.disabled = selectedIndex <= 0;
    btnMoveBackward.addEventListener('click', () => {
      requestSceneFocus(selectedInst.id);
      options.onReorderInstance(selectedInst.id, 'backward');
    });

    const btnMoveForward = document.createElement('button');
    btnMoveForward.type = 'button';
    btnMoveForward.className = 'button secondary-button';
    btnMoveForward.textContent = t('scenePreviewMoveForward');
    btnMoveForward.disabled = selectedIndex >= options.instances.length - 1;
    btnMoveForward.addEventListener('click', () => {
      requestSceneFocus(selectedInst.id);
      options.onReorderInstance(selectedInst.id, 'forward');
    });

    if (options.onDuplicateInstance) {
      const onDuplicate = options.onDuplicateInstance;
      const btnDuplicate = document.createElement('button');
      btnDuplicate.type = 'button';
      btnDuplicate.className = 'button secondary-button';
      btnDuplicate.textContent = t('scenePreviewDuplicate');
      btnDuplicate.addEventListener('click', () => {
        onDuplicate(selectedInst.id);
      });
      inspectorActions.append(btnDuplicate);
    }

    inspectorActions.append(btnMoveBackward, btnMoveForward);

    const btnDelete = document.createElement('button');
    btnDelete.type = 'button';
    btnDelete.className = 'button secondary-button button-danger';
    btnDelete.textContent = t('scenePreviewRemove');
    btnDelete.addEventListener('click', () => {
      requestSceneFocus(
        options.instances[selectedIndex + 1]?.id ??
          options.instances[selectedIndex - 1]?.id ??
          null,
      );
      options.onRemoveInstance(selectedInst.id);
    });
    inspectorActions.append(btnDelete);

    inspectorCard.append(
      paletteStatus,
      resourcePanel,
      nameLabel,
      entityLabel,
      animLabel,
      coordRow,
      visCheckboxLabel,
      inspectorActions,
    );
    inspectorWrapper.append(inspectorCard);
  };

  renderInspector();

  sideCol.append(listWrapper, inspectorWrapper);
  layout.append(canvasWrapper, sideCol);
  section.append(layout);

  // Rendering & Animation Engine
  const drawScene = (): void => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, NES_SCREEN_WIDTH, NES_SCREEN_HEIGHT);
    ctx.imageSmoothingEnabled = false;

    // Background color (NES dark navy / solid backdrop)
    ctx.fillStyle = '#0e0f17';
    ctx.fillRect(0, 0, NES_SCREEN_WIDTH, NES_SCREEN_HEIGHT);

    // Grid lines indicator (subtle 16x16 NES tile grid)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= NES_SCREEN_WIDTH; x += 16) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, NES_SCREEN_HEIGHT);
      ctx.stroke();
    }
    for (let y = 0; y <= NES_SCREEN_HEIGHT; y += 16) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(NES_SCREEN_WIDTH, y);
      ctx.stroke();
    }

    // Render instances in list order
    for (const inst of options.instances) {
      if (!inst.visible) continue;

      const displayedInstance = getDisplayedInstance(inst);
      const anim = resolveInstanceAnimation(
        displayedInstance,
        options.animations,
      );
      if (!anim?.source || anim.frameIndices.length === 0) continue;

      const playback = playbackStates().get(inst.id);
      const safeIndex =
        playback && playback.currentFrameIndex < anim.frameIndices.length
          ? playback.currentFrameIndex
          : 0;

      const sourceFrameIndex = anim.frameIndices[safeIndex] ?? 0;
      const effectivePaletteId =
        anim.framePaletteIds?.[safeIndex] ?? anim.paletteId;
      const effectiveColors = resolveEffectivePaletteColors(
        effectivePaletteId,
        options.palettes,
        anim.framePalettes?.[safeIndex] ??
          anim.paletteIndex ??
          options.defaultPaletteIndex,
        options.spritePaletteSet,
      );

      const nesImage = renderIndexedImageWithPalette(
        applyPixelOverridesToImage(
          anim.source.indexedImage,
          anim.pixelOverrides,
        ),
        effectiveColors,
      );

      const frameCols = Math.floor(nesImage.width / anim.frameWidth);
      if (frameCols <= 0) continue;

      const sourceX = (sourceFrameIndex % frameCols) * anim.frameWidth;
      const sourceY =
        Math.floor(sourceFrameIndex / frameCols) * anim.frameHeight;

      const cropped = cropCanvas(
        nesImage,
        sourceX,
        sourceY,
        anim.frameWidth,
        anim.frameHeight,
      );

      // Use projection helper
      const { posX, posY, flipH, flipV } = computeInstanceProjection(
        displayedInstance,
        anim,
      );

      ctx.save();
      ctx.imageSmoothingEnabled = false;

      // Handle combined flips
      if (flipH && flipV) {
        ctx.translate(posX + anim.frameWidth, posY + anim.frameHeight);
        ctx.scale(-1, -1);
        ctx.drawImage(cropped, 0, 0);
      } else if (flipH) {
        ctx.translate(posX + anim.frameWidth, posY);
        ctx.scale(-1, 1);
        ctx.drawImage(cropped, 0, 0);
      } else if (flipV) {
        ctx.translate(posX, posY + anim.frameHeight);
        ctx.scale(1, -1);
        ctx.drawImage(cropped, 0, 0);
      } else {
        ctx.drawImage(cropped, posX, posY);
      }
      ctx.restore();

      // Bounding box if selected
      if (inst.id === currentSelectedInstanceId) {
        ctx.strokeStyle = '#4da6ff';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.strokeRect(
          posX - 0.5,
          posY - 0.5,
          anim.frameWidth + 1,
          anim.frameHeight + 1,
        );
        ctx.setLineDash([]);
      }
    }
  };

  // Play / Pause / Reset handlers
  btnPlayPause.addEventListener('click', () => {
    playbackSession.setPlaying(!playbackSession.playing);
    btnPlayPause.textContent = t(
      playbackSession.playing ? 'scenePreviewPause' : 'scenePreviewPlay',
    );
  });

  btnReset.addEventListener('click', () => {
    playbackSession.reset(options.instances);
    renderPaletteStatus();
    drawScene();
  });

  // Unified animation tick loop
  let lastTimestamp = performance.now();
  let accumulatedMs = 0;
  const MS_PER_FRAME = 1000 / 60; // 60 FPS (16.67ms per NES game tick)
  let animationFrameHandle: number | null = null;

  const animationLoop = (timestamp: number): void => {
    const delta = Math.min(100, timestamp - lastTimestamp);
    lastTimestamp = timestamp;

    if (playbackSession.playing) {
      accumulatedMs += delta;
      let ticks = 0;
      while (accumulatedMs >= MS_PER_FRAME) {
        accumulatedMs -= MS_PER_FRAME;
        ticks += 1;
      }
      if (ticks > 0) {
        playbackSession.advance(options.instances, options.animations, ticks);
        renderPaletteStatus();
        drawScene();
      }
    }

    if (!disposed) {
      animationFrameHandle = requestAnimationFrame(animationLoop);
    }
  };

  let disposed = false;
  animationFrameHandle = requestAnimationFrame(animationLoop);

  // Pointer drag on canvas. Preview stays local; pointerup commits once.
  let dragging = false;
  let dragInstanceId: string | null = null;
  let activePointerId: number | null = null;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let pendingDragPatch:
    | (Pick<ScenePreviewInstance, 'x' | 'y' | 'anchorX' | 'anchorY'> & {
        readonly instanceId: string;
      })
    | null = null;

  const getDisplayedInstance = (
    instance: ScenePreviewInstance,
  ): ScenePreviewInstance =>
    pendingDragPatch?.instanceId === instance.id
      ? { ...instance, ...pendingDragPatch }
      : instance;

  const getCanvasLogicalCoords = (
    e: Pick<PointerEvent, 'clientX' | 'clientY'>,
  ): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = NES_SCREEN_WIDTH / rect.width;
    const scaleY = NES_SCREEN_HEIGHT / rect.height;
    return {
      x: Math.floor((e.clientX - rect.left) * scaleX),
      y: Math.floor((e.clientY - rect.top) * scaleY),
    };
  };

  const handlePointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const { x, y } = getCanvasLogicalCoords(e);

    // Find clicked instance in reverse order (topmost on screen).
    // Hit-testing uses the same projected position as rendering so the
    // clickable area always matches what is drawn on canvas.
    for (let i = options.instances.length - 1; i >= 0; i -= 1) {
      const inst = options.instances[i];
      if (!inst?.visible) continue;

      const displayedInstance = getDisplayedInstance(inst);
      const anim = resolveInstanceAnimation(
        displayedInstance,
        options.animations,
      );
      const { posX, posY } = computeInstanceProjection(displayedInstance, anim);
      const w = anim?.frameWidth ?? 16;
      const h = anim?.frameHeight ?? 16;

      if (x >= posX && x < posX + w && y >= posY && y < posY + h) {
        dragging = true;
        dragInstanceId = inst.id;
        activePointerId = e.pointerId;
        canvas.setPointerCapture(e.pointerId);
        currentSelectedInstanceId = inst.id;
        if (options.onSelectInstance) {
          options.onSelectInstance(inst.id);
        }
        dragOffsetX = x - posX;
        dragOffsetY = y - posY;

        section
          .querySelectorAll('.scene-preview-instance-card')
          .forEach((c) => {
            const selected =
              c.getAttribute('data-scene-instance-id') === inst.id;
            c.classList.toggle('is-selected', selected);
            c.querySelector(
              '.scene-preview-instance-focus-target',
            )?.setAttribute('aria-pressed', String(selected));
          });

        cardByInstanceId.get(inst.id)?.focus({ preventScroll: true });
        renderInspector();
        drawScene();
        e.preventDefault();
        break;
      }
    }
  };
  canvas.addEventListener('pointerdown', handlePointerDown);

  const handlePointerMove = (e: PointerEvent): void => {
    if (!dragging || !dragInstanceId || activePointerId !== e.pointerId) {
      return;
    }
    const { x, y } = getCanvasLogicalCoords(e);
    // New render position after drag.
    const newPosX = Math.max(0, Math.min(NES_SCREEN_WIDTH, x - dragOffsetX));
    const newPosY = Math.max(0, Math.min(NES_SCREEN_HEIGHT, y - dragOffsetY));

    // Find the dragged instance so we can resolve its animation origin.
    const inst = options.instances.find((i) => i.id === dragInstanceId);
    const anim = inst
      ? resolveInstanceAnimation(inst, options.animations)
      : null;
    if (inst === undefined) return;
    const positionPatch = createScenePositionPatch(
      inst,
      anim,
      newPosX,
      newPosY,
    );
    if (positionPatch === null) return;
    pendingDragPatch = {
      instanceId: dragInstanceId,
      ...positionPatch,
    };
    drawScene();
    e.preventDefault();
  };

  const finishPointerDrag = (e: PointerEvent, commit: boolean): void => {
    if (activePointerId !== e.pointerId) return;
    const patch = commit ? pendingDragPatch : null;
    if (canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
    dragging = false;
    dragInstanceId = null;
    activePointerId = null;
    pendingDragPatch = null;
    if (patch !== null) {
      const { instanceId, ...position } = patch;
      requestSceneFocus(instanceId);
      options.onUpdateInstance(instanceId, position);
    }
  };

  const handlePointerUp = (e: PointerEvent): void => {
    finishPointerDrag(e, true);
  };
  const handlePointerCancel = (e: PointerEvent): void => {
    finishPointerDrag(e, false);
    drawScene();
  };

  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('pointerup', handlePointerUp);
  canvas.addEventListener('pointercancel', handlePointerCancel);

  scenePreviewDisposers.set(section, () => {
    if (disposed) return;
    disposed = true;
    if (animationFrameHandle !== null) {
      cancelAnimationFrame(animationFrameHandle);
    }
    canvas.removeEventListener('pointerdown', handlePointerDown);
    canvas.removeEventListener('pointermove', handlePointerMove);
    canvas.removeEventListener('pointerup', handlePointerUp);
    canvas.removeEventListener('pointercancel', handlePointerCancel);
    scenePreviewDisposers.delete(section);
  });

  // Initial draw
  renderPaletteStatus();
  drawScene();

  return section;
}
