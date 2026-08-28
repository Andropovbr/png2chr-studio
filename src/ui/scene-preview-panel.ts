import {
  advanceScenePlayback,
  createSceneInstance,
  getInstanceAnimationReferenceStatus,
  getAnimationsForEntity,
  getAvailableEntities,
  initializePlaybackStates,
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
  readonly onSelectInstance?: (instanceId: string | null) => void;
  readonly onAddInstance: (instance: ScenePreviewInstance) => void;
  readonly onRemoveInstance: (instanceId: string) => void;
  readonly onDuplicateInstance?: (instanceId: string) => void;
  readonly onUpdateInstance: (
    instanceId: string,
    patch: Partial<ScenePreviewInstance>,
  ) => void;
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

  let playing = true;
  let currentSelectedInstanceId: string | null =
    options.selectedInstanceId !== undefined
      ? options.selectedInstanceId
      : (options.instances[0]?.id ?? null);
  let playbackStates: Map<string, InstancePlaybackState> =
    initializePlaybackStates(options.instances);

  const renderPaletteStatus = (): void => {
    const paletteIds = resolveScenePaletteIds(
      options.instances,
      playbackStates,
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
        playbackStates.get(instance.id)?.currentFrameIndex ?? 0;
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
        playbackStates.get(selectedInstance.id)?.currentFrameIndex ?? 0;
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
  btnPlayPause.textContent = t('scenePreviewPause');

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
        playbackStates.get(inst.id)?.currentFrameIndex ?? 0;
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
      playbackStates.get(selectedInst.id)?.currentFrameIndex ?? 0;
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

    // Coordinates X & Y
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
    xInput.value = String(selectedInst.x);
    xInput.addEventListener('change', () => {
      const val = Math.max(
        0,
        Math.min(NES_SCREEN_WIDTH, parseInt(xInput.value, 10) || 0),
      );
      options.onUpdateInstance(selectedInst.id, { x: val });
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
    yInput.value = String(selectedInst.y);
    yInput.addEventListener('change', () => {
      const val = Math.max(
        0,
        Math.min(NES_SCREEN_HEIGHT, parseInt(yInput.value, 10) || 0),
      );
      options.onUpdateInstance(selectedInst.id, { y: val });
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

      const anim = resolveInstanceAnimation(inst, options.animations);
      if (!anim?.source || anim.frameIndices.length === 0) continue;

      const playback = playbackStates.get(inst.id);
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

      const posX = inst.x;
      const posY = inst.y;

      ctx.save();
      ctx.imageSmoothingEnabled = false;

      // Handle flip variants if enabled on the animation
      if (anim.flipH) {
        ctx.translate(posX + anim.frameWidth, posY);
        ctx.scale(-1, 1);
        ctx.drawImage(cropped, 0, 0);
      } else if (anim.flipV) {
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
    playing = !playing;
    btnPlayPause.textContent = t(
      playing ? 'scenePreviewPause' : 'scenePreviewPlay',
    );
  });

  btnReset.addEventListener('click', () => {
    playbackStates = resetPlaybackStates(options.instances);
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

    if (playing) {
      accumulatedMs += delta;
      let ticks = 0;
      while (accumulatedMs >= MS_PER_FRAME) {
        accumulatedMs -= MS_PER_FRAME;
        ticks += 1;
      }
      if (ticks > 0) {
        playbackStates = advanceScenePlayback(
          options.instances,
          playbackStates,
          options.animations,
          ticks,
        );
        renderPaletteStatus();
        drawScene();
      }
    }

    animationFrameHandle = requestAnimationFrame(animationLoop);
  };

  animationFrameHandle = requestAnimationFrame(animationLoop);

  // Drag & Drop on Canvas
  let dragging = false;
  let dragInstanceId: string | null = null;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  const getCanvasLogicalCoords = (e: MouseEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = NES_SCREEN_WIDTH / rect.width;
    const scaleY = NES_SCREEN_HEIGHT / rect.height;
    return {
      x: Math.floor((e.clientX - rect.left) * scaleX),
      y: Math.floor((e.clientY - rect.top) * scaleY),
    };
  };

  canvas.addEventListener('mousedown', (e) => {
    const { x, y } = getCanvasLogicalCoords(e);

    // Find clicked instance in reverse order (topmost on screen)
    for (let i = options.instances.length - 1; i >= 0; i -= 1) {
      const inst = options.instances[i];
      if (!inst?.visible) continue;

      const anim = resolveInstanceAnimation(inst, options.animations);
      const w = anim?.frameWidth ?? 16;
      const h = anim?.frameHeight ?? 16;

      if (x >= inst.x && x < inst.x + w && y >= inst.y && y < inst.y + h) {
        dragging = true;
        dragInstanceId = inst.id;
        currentSelectedInstanceId = inst.id;
        if (options.onSelectInstance) {
          options.onSelectInstance(inst.id);
        }
        dragOffsetX = x - inst.x;
        dragOffsetY = y - inst.y;

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
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging || !dragInstanceId) return;
    const { x, y } = getCanvasLogicalCoords(e);
    const targetX = Math.max(0, Math.min(NES_SCREEN_WIDTH, x - dragOffsetX));
    const targetY = Math.max(0, Math.min(NES_SCREEN_HEIGHT, y - dragOffsetY));

    options.onUpdateInstance(dragInstanceId, { x: targetX, y: targetY });
  });

  window.addEventListener('mouseup', () => {
    dragging = false;
    dragInstanceId = null;
  });

  // Cleanup on element removal
  const observer = new MutationObserver(() => {
    if (!document.body.contains(section) && animationFrameHandle !== null) {
      cancelAnimationFrame(animationFrameHandle);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Initial draw
  renderPaletteStatus();
  drawScene();

  return section;
}
