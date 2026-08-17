import {
  advanceScenePlayback,
  createSceneInstance,
  getAnimationsForEntity,
  getAvailableEntities,
  initializePlaybackStates,
  NES_SCREEN_HEIGHT,
  NES_SCREEN_WIDTH,
  resetPlaybackStates,
  resolveInstanceAnimation,
  type InstancePlaybackState,
  type ScenePreviewInstance,
} from '../core/scene-preview';
import { renderAnimationToRawImageData } from '../core/animation-palette';
import type { NesPaletteSet } from '../core/nes-palette';
import { t } from '../i18n';
import type { AnimationItemSetting } from './types';
import { cropCanvas } from './animation-editor';

export interface ScenePreviewPanelOptions {
  readonly instances: readonly ScenePreviewInstance[];
  readonly animations: readonly AnimationItemSetting[];
  readonly paletteSet: NesPaletteSet;
  readonly defaultPaletteIndex: number;
  readonly onAddInstance: (instance: ScenePreviewInstance) => void;
  readonly onRemoveInstance: (instanceId: string) => void;
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

  // Stats badge
  const availableEntities = getAvailableEntities(options.animations);
  const statsBadge = document.createElement('span');
  statsBadge.className = 'status-badge scene-preview-stats-badge';
  statsBadge.textContent = t('scenePreviewStats', {
    entities: availableEntities.length,
    instances: options.instances.length,
  });

  // Action controls
  const toolbar = document.createElement('div');
  toolbar.className = 'scene-preview-toolbar';

  let playing = true;
  let selectedInstanceId: string | null = options.instances[0]?.id ?? null;
  let playbackStates: Map<string, InstancePlaybackState> =
    initializePlaybackStates(options.instances);

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
    selectedInstanceId = newInst.id;
  });

  if (availableEntities.length > 1) {
    addContainer.append(addSelect, btnAddEntity);
  } else {
    addContainer.append(btnAddEntity);
  }

  toolbar.append(btnPlayPause, btnReset, addContainer, statsBadge);
  header.append(titleGroup, toolbar);
  section.append(header);

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

  // Instances list container
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
      const card = document.createElement('div');
      card.className = `scene-preview-instance-card${selectedInstanceId === inst.id ? ' is-selected' : ''}`;

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

      cardActions.append(btnVisible, btnRemove);
      cardHeader.append(cardTitle, cardActions);

      // Card Fields
      const fields = document.createElement('div');
      fields.className = 'scene-preview-card-fields';

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
        opt.selected = ent.toLowerCase() === inst.entityId.toLowerCase();
        entitySelect.append(opt);
      });
      entitySelect.addEventListener('change', () => {
        const newEntity = entitySelect.value;
        const entityAnims = getAnimationsForEntity(
          options.animations,
          newEntity,
        );
        const defaultAnim =
          entityAnims.find((a) => a.name.toLowerCase().includes('idle')) ??
          entityAnims[0];
        options.onUpdateInstance(inst.id, {
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
        inst.entityId,
      );
      if (entityAnims.length === 0) {
        const opt = document.createElement('option');
        opt.value = inst.animationName;
        opt.textContent = inst.animationName;
        animSelect.append(opt);
        animSelect.disabled = true;
      } else {
        entityAnims.forEach((a) => {
          const opt = document.createElement('option');
          opt.value = a.name;
          opt.textContent = a.name;
          opt.selected = a.name === inst.animationName;
          animSelect.append(opt);
        });
      }
      animSelect.addEventListener('change', () => {
        options.onUpdateInstance(inst.id, {
          animationName: animSelect.value,
        });
      });
      animLabel.append(animText, animSelect);

      // Coordinates X and Y
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
      xInput.value = String(inst.x);
      xInput.addEventListener('change', () => {
        const val = Math.max(
          0,
          Math.min(NES_SCREEN_WIDTH, parseInt(xInput.value, 10) || 0),
        );
        options.onUpdateInstance(inst.id, { x: val });
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
      yInput.value = String(inst.y);
      yInput.addEventListener('change', () => {
        const val = Math.max(
          0,
          Math.min(NES_SCREEN_HEIGHT, parseInt(yInput.value, 10) || 0),
        );
        options.onUpdateInstance(inst.id, { y: val });
      });
      yLabel.append(yText, yInput);

      coordRow.append(xLabel, yLabel);
      fields.append(entityLabel, animLabel, coordRow);

      card.append(cardHeader, fields);
      card.addEventListener('click', () => {
        selectedInstanceId = inst.id;
        document
          .querySelectorAll('.scene-preview-instance-card')
          .forEach((c) => {
            c.classList.remove('is-selected');
          });
        card.classList.add('is-selected');
        drawScene();
      });

      list.append(card);
    });

    listWrapper.append(list);
  }

  layout.append(canvasWrapper, listWrapper);
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
      const effectivePalette =
        anim.framePalettes?.[safeIndex] ??
        anim.paletteIndex ??
        options.defaultPaletteIndex;

      const nesImage = renderAnimationToRawImageData(
        anim.source.indexedImage,
        options.paletteSet,
        effectivePalette,
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
      if (inst.id === selectedInstanceId) {
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
        selectedInstanceId = inst.id;
        dragOffsetX = x - inst.x;
        dragOffsetY = y - inst.y;

        document
          .querySelectorAll('.scene-preview-instance-card')
          .forEach((c, cIdx) => {
            c.classList.toggle('is-selected', cIdx === i);
          });

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
  drawScene();

  return section;
}
