import {
  advanceScenePlayback,
  computeInstanceProjection,
  createSceneInstance,
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
  readonly playbackSession?: ScenePreviewPlaybackSession;
  readonly onSelectInstance?: (instanceId: string | null) => void;
  readonly onAddInstance: (instance: ScenePreviewInstance) => void;
  readonly onRemoveInstance: (instanceId: string) => void;
  readonly onDuplicateInstance?: (instanceId: string) => void;
  readonly onUpdateInstance: (
    instanceId: string,
    patch: Partial<ScenePreviewInstance>,
  ) => void;
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
  const playbackStates = (): Map<string, InstancePlaybackState> =>
    playbackSession.playbackStates;

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

  const canvasOverlay = document.createElement('div');
  canvasOverlay.className = 'scene-preview-canvas-overlay';
  canvasOverlay.textContent = 'NES 256 × 240';

  canvasWrapper.append(canvas, canvasOverlay);

  // Side column container (Instances list + Contextual Inspector)
  const sideCol = document.createElement('div');
  sideCol.className = 'scene-preview-side-col';

  // 1. Instances list container
  const listWrapper = document.createElement('div');
  listWrapper.className = 'scene-preview-instances-wrapper';

  const listTitle = document.createElement('h3');
  listTitle.className = 'scene-preview-instances-title';
  listTitle.textContent = `${t('scenePreviewInstanceLabel')} (${String(options.instances.length)})`;
  listWrapper.append(listTitle);

  if (options.instances.length === 0) {
    const emptyMsg = document.createElement('p');
    emptyMsg.className = 'empty-message scene-preview-empty';
    emptyMsg.textContent = t('scenePreviewEmptyScene');
    listWrapper.append(emptyMsg);
  } else {
    const list = document.createElement('div');
    list.className = 'scene-preview-instances-list';

    options.instances.forEach((inst, index) => {
      const isSelected = currentSelectedInstanceId === inst.id;
      const card = document.createElement('div');
      card.className = `scene-preview-instance-card${isSelected ? ' is-selected' : ''}`;

      const cardHeader = document.createElement('div');
      cardHeader.className = 'scene-preview-card-header';

      const cardTitle = document.createElement('strong');
      cardTitle.className = 'scene-preview-card-title';
      cardTitle.textContent =
        inst.name ?? `${inst.entityId} #${String(index + 1)}`;

      const cardActions = document.createElement('div');
      cardActions.className = 'scene-preview-card-actions';

      // Visibility toggle
      const btnVisible = document.createElement('button');
      btnVisible.type = 'button';
      btnVisible.className = `button secondary-button scene-preview-vis-btn${inst.visible ? ' is-visible' : ' is-hidden'}`;
      btnVisible.textContent = inst.visible ? '👁' : '🚫';
      btnVisible.title = t('scenePreviewVisible');
      btnVisible.addEventListener('click', (e) => {
        e.stopPropagation();
        options.onUpdateInstance(inst.id, { visible: !inst.visible });
      });

      // Remove button
      const btnRemove = document.createElement('button');
      btnRemove.type = 'button';
      btnRemove.className = 'button secondary-button button-danger';
      btnRemove.textContent = '✕';
      btnRemove.title = t('scenePreviewRemove');
      btnRemove.addEventListener('click', (e) => {
        e.stopPropagation();
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
            c.classList.remove('is-selected');
          });
        card.classList.add('is-selected');
        renderInspector();
        drawScene();
      });

      list.append(card);
    });

    listWrapper.append(list);
  }

  // 2. Contextual Inspector Container
  const inspectorWrapper = document.createElement('div');
  inspectorWrapper.className = 'scene-preview-inspector-wrapper';

  const renderInspector = (): void => {
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

    const btnDelete = document.createElement('button');
    btnDelete.type = 'button';
    btnDelete.className = 'button secondary-button button-danger';
    btnDelete.textContent = t('scenePreviewRemove');
    btnDelete.addEventListener('click', () => {
      options.onRemoveInstance(selectedInst.id);
    });
    inspectorActions.append(btnDelete);

    inspectorCard.append(
      paletteStatus,
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

  // Drag & Drop on Canvas
  let dragging = false;
  let dragInstanceId: string | null = null;
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

  const getCanvasLogicalCoords = (e: MouseEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = NES_SCREEN_WIDTH / rect.width;
    const scaleY = NES_SCREEN_HEIGHT / rect.height;
    return {
      x: Math.floor((e.clientX - rect.left) * scaleX),
      y: Math.floor((e.clientY - rect.top) * scaleY),
    };
  };

  const handleMouseDown = (e: MouseEvent): void => {
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
        currentSelectedInstanceId = inst.id;
        if (options.onSelectInstance) {
          options.onSelectInstance(inst.id);
        }
        dragOffsetX = x - posX;
        dragOffsetY = y - posY;

        section
          .querySelectorAll('.scene-preview-instance-card')
          .forEach((c, cIdx) => {
            c.classList.toggle('is-selected', cIdx === i);
          });

        renderInspector();
        drawScene();
        break;
      }
    }
  };
  canvas.addEventListener('mousedown', handleMouseDown);

  const handleMouseMove = (e: MouseEvent): void => {
    if (!dragging || !dragInstanceId) return;
    const { x, y } = getCanvasLogicalCoords(e);
    // New render position after drag.
    const newPosX = Math.max(0, Math.min(NES_SCREEN_WIDTH, x - dragOffsetX));
    const newPosY = Math.max(0, Math.min(NES_SCREEN_HEIGHT, y - dragOffsetY));

    // Find the dragged instance so we can resolve its animation origin.
    const inst = options.instances.find((i) => i.id === dragInstanceId);
    const anim = inst
      ? resolveInstanceAnimation(inst, options.animations)
      : null;
    const originX = anim?.originX ?? 0;
    const originY = anim?.originY ?? 0;

    // Canonical update: anchorX/Y = newPosX/Y + originX/Y.
    // Also keep x/y in sync for legacy consumers (they will not be the source
    // of truth once anchorX/Y are present, but serialization round-trips
    // expect them to be present).
    pendingDragPatch = {
      instanceId: dragInstanceId,
      anchorX: newPosX + originX,
      anchorY: newPosY + originY,
      x: newPosX,
      y: newPosY,
    };
    drawScene();
  };

  const handleMouseUp = (): void => {
    const patch = pendingDragPatch;
    dragging = false;
    dragInstanceId = null;
    pendingDragPatch = null;
    if (patch !== null) {
      const { instanceId, ...position } = patch;
      options.onUpdateInstance(instanceId, position);
    }
  };

  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('mouseup', handleMouseUp);

  scenePreviewDisposers.set(section, () => {
    if (disposed) return;
    disposed = true;
    if (animationFrameHandle !== null) {
      cancelAnimationFrame(animationFrameHandle);
    }
    canvas.removeEventListener('mousedown', handleMouseDown);
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
    scenePreviewDisposers.delete(section);
  });

  // Initial draw
  renderPaletteStatus();
  drawScene();

  return section;
}
