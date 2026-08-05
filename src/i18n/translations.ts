const en = {
  appTitle: 'PNG2CHR Studio',
  appDescription:
    'Convert PNG artwork, CHR tilesets, NROM graphics, and playfields into NES data, entirely in your browser.',
  languageLabel: 'Language',
  localePtBr: 'Português (Brasil)',
  localeEn: 'English',
  importTitle: 'Import PNG, CHR, or NROM',
  imageModeLabel: 'Image purpose',
  tilesetMode: 'Tileset / graphics',
  playfieldMode: 'Playfield / game screen',
  animationMode: 'Sprite sheet / animation',
  tilesetModeHint:
    'Use a PNG, a CHR file, or an iNES mapper 0 ROM with 8 KB of CHR-ROM.',
  playfieldModeHint:
    'A playfield must be exactly 256 × 240 px (32 × 30 tiles).',
  animationModeHint:
    'Import a PNG sprite sheet, select frames, and export animation-ready NES data.',
  animationEditorTitle: 'Sprite animation setup',
  animationEditorHint:
    'Define the frame grid, choose idle or movement, then click frames in their playback order.',
  animationNameLabel: 'Character name',
  animationFrameWidthLabel: 'Frame width (px)',
  animationFrameHeightLabel: 'Frame height (px)',
  animationSelectionTarget: 'Add selected frames to',
  animationIdle: 'Idle',
  animationMovement: 'Movement',
  animationMovementDirection: 'Primary movement direction',
  animationDirectionLeft: 'Left',
  animationDirectionRight: 'Right',
  animationExportMirroredMovement:
    'Also export the opposite direction using horizontal flip',
  animationExportMirroredHint:
    'Exports two movement animations. The opposite direction mirrors sprite positions and toggles the NES H-flip attribute.',
  animationExportSingleDirectionHint:
    'Exports only the primary direction without changing the artwork orientation. Useful for ships and direction-neutral objects.',
  animationIdleDuration: 'Default idle duration',
  animationMovementDuration: 'Default movement duration',
  animationFrameDurationLabel: 'Duration of frame {index}',
  animationDurationUnit: 'game frames',
  animationSpritePalette: 'Sprite palette',
  animationSpritePalettesTitle: 'Sprite palettes',
  animationSpritePalettesHint:
    'Select any palette slot, then choose a supported NES color below. Slot 0 is the shared universal background color and starts black.',
  animationDownloadPalette: 'Download sprite palettes',
  animationPreviewTitle: 'Animation preview',
  animationPreviewHint:
    'Plays the frames of the active animation using their individual durations at 60 game frames per second.',
  animationPreviewEmpty: 'Select frames in the active animation to preview it.',
  animationPreviewPlay: 'Play',
  animationPreviewPause: 'Pause',
  animationPreviewPrevious: 'Previous frame',
  animationPreviewNext: 'Next frame',
  animationPreviewCurrent:
    '{animation} · frame {index} · {duration} game frames',
  animationPreviewCurrentDirection:
    '{animation} · {direction} · frame {index} · {duration} game frames',
  animationPreviewDirection: 'Preview direction',
  animationGeneratedByFlip: 'generated with H-flip',
  animationOriginX: 'Origin X',
  animationOriginY: 'Origin Y',
  animationFlipDeduplication: 'Reuse tiles using H/V sprite flips',
  animationTransparencyHint:
    'Transparent source pixels map to universal color index 0. Fully empty 8 × 8 cells are still omitted from the metasprite.',
  animationDestinationTitle: 'Destination CHR',
  animationChooseDestination: 'Choose base CHR',
  animationClearDestination: 'Remove base CHR',
  animationNoDestination:
    'No destination CHR selected; tile indexes start at $00.',
  animationDestinationDetails:
    '{name}: {tiles} existing tiles ({bytes} bytes).',
  animationFrameGridTitle: 'Sprite-sheet frames',
  animationFrameGridHint:
    'Click a frame to append it to the active animation. Selected order is shown below.',
  animationFrameLabel: 'Frame {index}',
  animationSelectedFramesTitle: 'Selected frame order',
  animationNoFrames: 'No frames selected.',
  animationMoveEarlier: 'Move frame {index} earlier',
  animationMoveLater: 'Move frame {index} later',
  animationRemoveFrame: 'Remove frame {index}',
  animationMappingTitle: 'Final metasprite tile mapping',
  animationMappingEmpty:
    'Select at least one valid frame to preview tile mappings.',
  animationTileOmitted: 'omitted',
  animationTileNormal: 'normal',
  animationTileHorizontalFlip: 'H-FLIP',
  animationTileVerticalFlip: 'V-FLIP',
  animationTileCombinedFlip: 'H+V-FLIP',
  animationReuseDestination: 'destination',
  animationReuseImported: 'reused',
  animationReuseNew: 'new',
  animationStatsTitle: 'CHR allocation',
  animationBaseTiles: 'Existing tiles',
  animationReusedDestination: 'Reused from destination',
  animationReusedImported: 'Reused from imported frames',
  animationNewTiles: 'New tiles',
  animationAppendStart: 'Append starts at',
  animationFinalTiles: 'Final tiles',
  animationRemainingTiles: 'Remaining capacity',
  animationFinalChrSize: 'Final CHR size',
  animationExportsTitle: 'Animation exports',
  animationDownloadChr: 'Download final CHR',
  animationDownloadJson: 'Download JSON metadata',
  animationDownloadCHeader: 'Download C header',
  animationDownloadCSource: 'Download C source',
  animationDownloadAsmInclude: 'Download ca65 include',
  animationDownloadAsmSource: 'Download ca65 source',
  animationEstimatedRom:
    'Estimated animation metadata ROM size: {bytes} bytes.',
  animationErrorNoFrames: 'Select at least one frame.',
  animationErrorFrameDimensions:
    'Frame dimensions must be positive multiples of 8.',
  animationErrorFrameGrid:
    'Frame dimensions must divide the complete sprite sheet.',
  animationErrorName: 'Use a non-empty name without control characters.',
  animationErrorDuration: 'Frame duration must be between 1 and 255.',
  animationErrorOrigin:
    'The origin must keep every metasprite offset within the signed 8-bit range (-128 to 127).',
  animationErrorDestination:
    'The destination CHR must be a valid multiple of 16 bytes and fit within 256 tiles.',
  animationErrorCapacity:
    'The resulting CHR exceeds the 256-tile sprite pattern-table capacity.',
  animationErrorGeneric: 'The animation configuration is invalid.',
  choosePng: 'Choose PNG',
  choosePngOrChr: 'Choose PNG, CHR, or NES ROM',
  generateRandomPlayfield: 'Generate random playfield',
  randomFeaturesTitle: 'Background elements',
  randomFeatureWalls: 'Walls',
  randomFeaturePlatforms: 'Platforms',
  randomFeatureClouds: 'Clouds',
  randomFeatureStars: 'Stars',
  randomFeatureTrees: 'Trees',
  randomFeatureStairs: 'Stairs',
  randomFeatureTopBorder: 'Top border',
  randomFeatureBottomBorder: 'Bottom border',
  randomFeatureLeftBorder: 'Left border',
  randomFeatureRightBorder: 'Right border',
  randomPlayfieldHint:
    'Choose one or more elements. Borders cover their complete side, and stairs prefer to connect platforms.',
  dropPrompt: 'or drop a PNG, CHR, or NES ROM here',
  dropPngPrompt: 'or drop a PNG file here',
  processingLocal: 'Your file is processed locally and is never uploaded.',
  loadingImage: 'Reading {name}…',
  fileDetails: '{name} · {width} × {height} px',
  dimensionsValue: '{width} × {height} px',
  previewTitle: 'Image preview',
  previewEmpty: 'Import a valid PNG, CHR, or NROM file to see its preview.',
  previewCanvasLabel: 'Preview of the imported graphics',
  collisionCanvasLabel:
    'Playfield preview. Click to edit the palette region; drag to paint collisions.',
  collisionEditorTitle: 'Collision map',
  collisionEditorHint:
    'Choose a collision type, then paint or erase one 8 x 8 cell per click and multiple cells by dragging.',
  collisionEditPalette: 'Edit palette',
  collisionPaint: 'Paint collision',
  collisionPaintSolid: 'Paint solid',
  collisionErase: 'Erase',
  collisionClearAll: 'Clear all',
  collisionTypeLabel: 'Collision brush',
  collisionCellFree: 'free',
  collisionCellSolid: 'solid',
  collisionTypeSolid: 'Solid',
  collisionTypeDamage: 'Damage',
  collisionTypeLadder: 'Ladder (both directions)',
  collisionTypeMoveUp: 'Move up',
  collisionTypeMoveDown: 'Move down',
  collisionTypeWater: 'Water',
  collisionTypeOneWay: 'One-way platform',
  collisionTypeIce: 'Ice',
  collisionTypeConveyorLeft: 'Conveyor left',
  collisionTypeConveyorRight: 'Conveyor right',
  collisionCellStatus:
    'Column {column}, row {row}: {state}. {count} marked cells.',
  diagnosticsTitle: 'Diagnostics',
  dimensionsLabel: 'Dimensions',
  colorCountLabel: 'Color indices',
  tileCountLabel: 'Tiles',
  chrSizeLabel: 'CHR size',
  nametableSizeLabel: 'Nametable size',
  attributeTableSizeLabel: 'Attribute Table size',
  byteCount: '{count} bytes',
  unavailableValue: '—',
  colorMappingTitle: 'Color mapping',
  colorIndex: 'Index {index}',
  transparentColor: 'Transparent',
  unassignedColor: 'Unassigned',
  errorTitle: 'Conversion issue',
  invalidFileType: 'Select a PNG, CHR, or NES ROM file.',
  chrReadFailed: 'The CHR file could not be read.',
  emptyChrFile: 'The CHR file is empty.',
  invalidChrSize:
    'The CHR file size must be a positive multiple of 16 bytes (16 bytes per tile).',
  chrTilesetOnly: 'CHR and NES ROM files can only be imported in Tileset mode.',
  nesReadFailed: 'The NES ROM file could not be read.',
  invalidNesHeader: 'The file does not contain a valid iNES header.',
  nes2Unsupported: 'NES 2.0 ROMs are not supported in version 0.9.',
  nesMapperUnsupported:
    'Only NROM/mapper 0 is supported. This ROM uses mapper {mapper}.',
  nesPrgSizeUnsupported: 'NROM import requires a 16 KB or 32 KB PRG-ROM.',
  nesChrRamUnsupported:
    'This ROM uses CHR-RAM and has no static CHR-ROM tiles to extract.',
  nesChrSizeUnsupported: 'NROM import requires exactly 8 KB of CHR-ROM.',
  nesRomTruncated: 'The ROM ends before its declared CHR-ROM data.',
  imageDecodeFailed:
    'The PNG could not be read. The file may be damaged or invalid.',
  invalidDimensions: 'The image width and height must both be multiples of 8.',
  invalidPixelData: 'The decoded image contains invalid pixel data.',
  partialTransparency: 'Partially transparent pixels are not supported yet.',
  tooManyColors:
    'Found {count} source colors. At most 256 can be indexed before NES palette quantization.',
  invalidPlayfieldDimensions:
    'A playfield must be exactly 256 × 240 px (32 × 30 tiles). CHR export remains available.',
  invalidPlayfieldTiles:
    'The playfield tile layout is incomplete and cannot produce a nametable.',
  tooManyPlayfieldTiles:
    'The nametable can address at most 256 CHR tiles, but {count} tiles would be exported. Enable deduplication or reduce the artwork.',
  colorsFoundLabel: 'Opaque colors found:',
  tilesTitle: 'CHR tiles',
  tilesEmpty: 'No tiles to display yet.',
  deduplicateTiles: 'Remove duplicate tiles',
  deduplicateFlippedTiles: 'Also match horizontal and vertical flips',
  deduplicationHint:
    'Exact duplicate tiles can be hidden and omitted from the CHR file.',
  tileVisibilitySummary: 'Showing {visible} of {total} tiles.',
  tileDecimalId: 'ID {id}',
  tileHexId: '${id}',
  tilePosition: 'Column {column}, row {row}',
  tileCanvasLabel: 'Preview of tile {id}',
  paletteEditorTitle: 'NES palettes',
  paletteEditorHint:
    'Build four background palettes using only the 64 color codes supported by the NES PPU. Color 0 is the shared universal background color.',
  paletteEditorEmpty: 'Import or generate an image to assign palettes.',
  nesPaletteName: 'Palette {index}',
  nesPaletteSlotLabel:
    'Palette {palette}, color {slot}, current NES code {code}',
  nesMasterPaletteTitle: 'NES master palette ($00-$3F)',
  nesColorEditTarget:
    'Editing palette {palette}, color index {color} ({code}). Choose its NES color below.',
  nesColorButton: 'Use NES color {code}',
  paletteRegionsTitle: 'Paint CHR color indices',
  paletteRegionsHint:
    'Click the main image preview to open a {size} x {size} region here. Palette and pixel color editing is available only in the zoomed region.',
  paletteColorBrushTitle: 'CHR color brush',
  paletteColorBrushLabel: 'Paint color index {index}, NES code {code}',
  paletteActiveBrush:
    'Active brush: palette {palette}, color index {color}, NES code {code}.',
  paletteShowNumbers: 'Show palette numbers in image regions',
  paletteCanvasLabel:
    'NES palette editor. Left-click paints, right-click replaces matching colors, and middle-click zooms a region.',
  paletteZoomTitle: 'Zoomed region: column {column}, row {row}',
  paletteZoomDetails:
    '{size} x {size} pixels (x {startX}-{endX}, y {startY}-{endY}); tiles columns {tileStartX}-{tileEndX}, rows {tileStartY}-{tileEndY}; palette {palette}.',
  paletteZoomHint:
    'Left-click paints a pixel. Right-click replaces matching colors inside this region.',
  paletteZoomClose: 'Close zoom',
  paletteZoomCanvasLabel: 'Zoomed NES palette pixel editor.',
  paletteZoomEmpty: 'Click a region in the main image preview to edit it.',
  palettePixelPaintStatus:
    'Pixel column {column}, row {row}: paint color index {color} from palette {palette}.',
  exportTitle: 'Export',
  defaultOutputName: 'image.chr',
  defaultNametableName: 'image.nam',
  defaultAttributeTableName: 'image.atr',
  defaultCollisionMapName: 'image.col',
  defaultPaletteName: 'image.pal',
  downloadChr: 'Download {name}',
  downloadNametable: 'Download {name}',
  downloadAttributeTable: 'Download {name}',
  downloadCollisionMap: 'Download {name}',
  downloadPalette: 'Download {name}',
  exportUnavailable: 'Import a valid image to enable CHR export.',
  exportReady: '{count} tiles will be exported.',
  exportReadyDeduplicated:
    '{count} unique tiles out of {total} will be exported.',
  exportReadyFlipDeduplicated:
    '{count} unique tiles out of {total} will be exported after matching horizontal and vertical flips.',
  playfieldExportReady:
    'The playfield is ready with {count} CHR tiles, a 960-byte nametable, and a 64-byte Attribute Table.',
  playfieldExportIncomplete:
    'CHR export is available, but the playfield data needs the diagnostic issue to be resolved.',
  attributeTablePaletteNote:
    'The Attribute Table stores the selected palette for every 16 x 16 pixel region.',
  paletteExportNote:
    'The palette file contains four NES background palettes (16 PPU color codes).',
  collisionExportNote:
    'The collision map contains {count} marked cells and uses 480 bytes (two four-bit cell types per byte, left cell first).',
  quantizationTitle: 'PNG color reduction',
  quantizationHint:
    'Choose how PNG colors are reduced before the existing NES palette and tile conversion.',
  quantizationEmpty: 'Import a PNG to configure color reduction.',
  quantizationModeLabel: 'Quantization',
  quantizationNearest: 'Nearest',
  quantizationMedianCut: 'Median Cut',
  quantizationKMeans: 'K-Means',
  quantizationNearestHint:
    'Best for existing pixel art and images that already use few colors.',
  quantizationMedianCutHint:
    'Balanced default for illustrations and general-purpose artwork.',
  quantizationKMeansHint:
    'Deterministic clustering that can preserve dominant color groups.',
  ditheringModeLabel: 'Dithering',
  ditheringNone: 'None',
  ditheringFloydSteinberg: 'Floyd-Steinberg',
  ditheringAtkinson: 'Atkinson',
  ditheringBayer4: 'Bayer 4 x 4',
  ditheringBayer8: 'Bayer 8 x 8',
  ditheringHint:
    'None keeps clean pixels; diffusion smooths gradients; Bayer creates ordered retro patterns.',
  quantizationAdvanced: 'Advanced options',
  colorDistanceLabel: 'Color distance',
  colorDistanceRgb: 'RGB Euclidean',
  colorDistancePerceptual: 'Perceptual (OKLab)',
  quantizationReset: 'Reset color-reduction defaults',
  quantizationComparisonTitle: 'Preview comparison',
  quantizationComparisonHint:
    'Select a generated preview to make that quantizer active. Dithering and distance apply to every comparison.',
  quantizationOriginal: 'Original',
  quantizationPreviewLoading: 'Generating previews in the background…',
} as const;

export type TranslationKey = keyof typeof en;
type TranslationTable = Record<TranslationKey, string>;

const ptBr = {
  appTitle: 'PNG2CHR Studio',
  generateRandomPlayfield: 'Gerar playfield aleat\u00f3rio',
  randomFeaturesTitle: 'Elementos do background',
  randomFeatureWalls: 'Paredes',
  randomFeaturePlatforms: 'Plataformas',
  randomFeatureClouds: 'Nuvens',
  randomFeatureStars: 'Estrelas',
  randomFeatureTrees: '\u00c1rvores',
  randomFeatureStairs: 'Escadas',
  randomFeatureTopBorder: 'Borda superior',
  randomFeatureBottomBorder: 'Borda inferior',
  randomFeatureLeftBorder: 'Borda esquerda',
  randomFeatureRightBorder: 'Borda direita',
  randomPlayfieldHint:
    'Escolha um ou mais elementos. As bordas cobrem todo o lado correspondente e as escadas procuram ligar plataformas.',
  collisionCanvasLabel:
    'Pr\u00e9via do playfield. Clique para editar a regi\u00e3o de paleta; arraste para pintar colis\u00f5es.',
  collisionEditorTitle: 'Mapa de colis\u00f5es',
  collisionEditorHint:
    'Escolha um tipo de colis\u00e3o e pinte ou apague uma c\u00e9lula de 8 x 8 por clique e v\u00e1rias ao arrastar.',
  collisionEditPalette: 'Editar paleta',
  collisionPaint: 'Pintar colis\u00e3o',
  collisionPaintSolid: 'Pintar s\u00f3lido',
  collisionErase: 'Apagar',
  collisionClearAll: 'Limpar tudo',
  collisionTypeLabel: 'Pincel de colis\u00e3o',
  collisionCellFree: 'livre',
  collisionCellSolid: 's\u00f3lida',
  collisionTypeSolid: 'S\u00f3lido',
  collisionTypeDamage: 'Dano',
  collisionTypeLadder: 'Escada bidirecional',
  collisionTypeMoveUp: 'Movimento para cima',
  collisionTypeMoveDown: 'Movimento para baixo',
  collisionTypeWater: '\u00c1gua',
  collisionTypeOneWay: 'Plataforma atravess\u00e1vel',
  collisionTypeIce: 'Gelo',
  collisionTypeConveyorLeft: 'Esteira para esquerda',
  collisionTypeConveyorRight: 'Esteira para direita',
  collisionCellStatus:
    'Coluna {column}, linha {row}: {state}. {count} c\u00e9lulas marcadas.',
  defaultCollisionMapName: 'image.col',
  downloadCollisionMap: 'Baixar {name}',
  defaultPaletteName: 'image.pal',
  downloadPalette: 'Baixar {name}',
  collisionExportNote:
    'O mapa de colis\u00f5es cont\u00e9m {count} c\u00e9lulas marcadas e usa 480 bytes (dois tipos de 4 bits por byte, c\u00e9lula esquerda primeiro).',
  appDescription:
    'Converta imagens PNG, tilesets CHR, gráficos de NROM e playfields em dados para NES, totalmente no navegador.',
  languageLabel: 'Idioma',
  localePtBr: 'Português (Brasil)',
  localeEn: 'English',
  importTitle: 'Importar PNG, CHR ou NROM',
  imageModeLabel: 'Finalidade da imagem',
  tilesetMode: 'Tileset / gráficos',
  playfieldMode: 'Playfield / tela do jogo',
  animationMode: 'Sprite sheet / animação',
  tilesetModeHint:
    'Use um PNG, um arquivo CHR ou uma ROM iNES mapper 0 com 8 KB de CHR-ROM.',
  playfieldModeHint:
    'Um playfield deve ter exatamente 256 × 240 px (32 × 30 tiles).',
  animationModeHint:
    'Importe um sprite sheet PNG, selecione frames e exporte dados de animação para NES.',
  animationEditorTitle: 'Configuração da animação de sprite',
  animationEditorHint:
    'Defina a grade, escolha parado ou movimento e clique nos frames na ordem de reprodução.',
  animationNameLabel: 'Nome do personagem',
  animationFrameWidthLabel: 'Largura do frame (px)',
  animationFrameHeightLabel: 'Altura do frame (px)',
  animationSelectionTarget: 'Adicionar os frames selecionados a',
  animationIdle: 'Parado',
  animationMovement: 'Movimento',
  animationMovementDirection: 'Direção principal do movimento',
  animationDirectionLeft: 'Esquerda',
  animationDirectionRight: 'Direita',
  animationExportMirroredMovement:
    'Exportar também o sentido oposto usando flip horizontal',
  animationExportMirroredHint:
    'Exporta duas animações de movimento. O sentido oposto espelha as posições dos sprites e alterna o atributo H-flip do NES.',
  animationExportSingleDirectionHint:
    'Exporta somente a direção principal sem alterar a orientação da arte. Útil para naves e objetos sem direção visual.',
  animationIdleDuration: 'Duração padrão — Parado',
  animationMovementDuration: 'Duração padrão — Movimento',
  animationFrameDurationLabel: 'Duração do frame {index}',
  animationDurationUnit: 'frames do jogo',
  animationSpritePalette: 'Paleta de sprite',
  animationSpritePalettesTitle: 'Paletas de sprite',
  animationSpritePalettesHint:
    'Selecione qualquer cor da paleta e escolha abaixo uma cor suportada pelo NES. O índice 0 é a cor universal compartilhada e começa preto.',
  animationDownloadPalette: 'Baixar paletas de sprite',
  animationPreviewTitle: 'Prévia da animação',
  animationPreviewHint:
    'Reproduz os frames da animação ativa usando suas durações individuais a 60 frames de jogo por segundo.',
  animationPreviewEmpty:
    'Selecione frames na animação ativa para visualizar a prévia.',
  animationPreviewPlay: 'Reproduzir',
  animationPreviewPause: 'Pausar',
  animationPreviewPrevious: 'Frame anterior',
  animationPreviewNext: 'Próximo frame',
  animationPreviewCurrent:
    '{animation} · frame {index} · {duration} frames do jogo',
  animationPreviewCurrentDirection:
    '{animation} · {direction} · frame {index} · {duration} frames do jogo',
  animationPreviewDirection: 'Direção da prévia',
  animationGeneratedByFlip: 'gerada com H-flip',
  animationOriginX: 'Origem X',
  animationOriginY: 'Origem Y',
  animationFlipDeduplication: 'Reutilizar tiles usando flips H/V de sprite',
  animationTransparencyHint:
    'Pixels transparentes do PNG usam o índice universal 0. Células 8 × 8 totalmente vazias continuam omitidas do metasprite.',
  animationDestinationTitle: 'CHR de destino',
  animationChooseDestination: 'Selecionar CHR-base',
  animationClearDestination: 'Remover CHR-base',
  animationNoDestination:
    'Nenhum CHR de destino selecionado; os índices começam em $00.',
  animationDestinationDetails:
    '{name}: {tiles} tiles existentes ({bytes} bytes).',
  animationFrameGridTitle: 'Frames do sprite sheet',
  animationFrameGridHint:
    'Clique em um frame para adicioná-lo à animação ativa. A ordem aparece abaixo.',
  animationFrameLabel: 'Frame {index}',
  animationSelectedFramesTitle: 'Ordem dos frames selecionados',
  animationNoFrames: 'Nenhum frame selecionado.',
  animationMoveEarlier: 'Mover frame {index} para antes',
  animationMoveLater: 'Mover frame {index} para depois',
  animationRemoveFrame: 'Remover frame {index}',
  animationMappingTitle: 'Mapeamento final dos tiles do metasprite',
  animationMappingEmpty:
    'Selecione ao menos um frame válido para visualizar os tiles.',
  animationTileOmitted: 'omitido',
  animationTileNormal: 'normal',
  animationTileHorizontalFlip: 'H-FLIP',
  animationTileVerticalFlip: 'V-FLIP',
  animationTileCombinedFlip: 'H+V-FLIP',
  animationReuseDestination: 'destino',
  animationReuseImported: 'reutilizado',
  animationReuseNew: 'novo',
  animationStatsTitle: 'Alocação do CHR',
  animationBaseTiles: 'Tiles existentes',
  animationReusedDestination: 'Reutilizados do destino',
  animationReusedImported: 'Reutilizados dos frames importados',
  animationNewTiles: 'Tiles novos',
  animationAppendStart: 'Início da anexação',
  animationFinalTiles: 'Tiles finais',
  animationRemainingTiles: 'Capacidade restante',
  animationFinalChrSize: 'Tamanho final do CHR',
  animationExportsTitle: 'Exportações da animação',
  animationDownloadChr: 'Baixar CHR final',
  animationDownloadJson: 'Baixar metadados JSON',
  animationDownloadCHeader: 'Baixar cabeçalho C',
  animationDownloadCSource: 'Baixar fonte C',
  animationDownloadAsmInclude: 'Baixar include ca65',
  animationDownloadAsmSource: 'Baixar fonte ca65',
  animationEstimatedRom:
    'Tamanho estimado dos metadados na ROM: {bytes} bytes.',
  animationErrorNoFrames: 'Selecione ao menos um frame.',
  animationErrorFrameDimensions:
    'As dimensões do frame devem ser múltiplos positivos de 8.',
  animationErrorFrameGrid:
    'As dimensões do frame devem dividir todo o sprite sheet.',
  animationErrorName: 'Use um nome não vazio e sem caracteres de controle.',
  animationErrorDuration: 'A duração deve estar entre 1 e 255 frames.',
  animationErrorOrigin:
    'A origem deve manter todos os deslocamentos do metasprite no intervalo de 8 bits com sinal (-128 a 127).',
  animationErrorDestination:
    'O CHR de destino deve ser múltiplo de 16 bytes e caber em 256 tiles.',
  animationErrorCapacity:
    'O CHR resultante excede a capacidade de 256 tiles da pattern table de sprites.',
  animationErrorGeneric: 'A configuração da animação é inválida.',
  choosePng: 'Selecionar PNG',
  choosePngOrChr: 'Selecionar PNG, CHR ou ROM NES',
  dropPrompt: 'ou arraste um arquivo PNG, CHR ou ROM NES para cá',
  dropPngPrompt: 'ou arraste um arquivo PNG para cá',
  processingLocal: 'Seu arquivo é processado localmente e nunca é enviado.',
  loadingImage: 'Lendo {name}…',
  fileDetails: '{name} · {width} × {height} px',
  dimensionsValue: '{width} × {height} px',
  previewTitle: 'Prévia da imagem',
  previewEmpty:
    'Importe um arquivo PNG, CHR ou NROM válido para visualizar sua prévia.',
  previewCanvasLabel: 'Prévia dos gráficos importados',
  diagnosticsTitle: 'Diagnóstico',
  dimensionsLabel: 'Dimensões',
  colorCountLabel: 'Índices de cor',
  tileCountLabel: 'Tiles',
  chrSizeLabel: 'Tamanho do CHR',
  nametableSizeLabel: 'Tamanho da nametable',
  attributeTableSizeLabel: 'Tamanho da Attribute Table',
  byteCount: '{count} bytes',
  unavailableValue: '—',
  colorMappingTitle: 'Mapeamento de cores',
  colorIndex: 'Índice {index}',
  transparentColor: 'Transparente',
  unassignedColor: 'Sem cor atribuída',
  errorTitle: 'Problema na conversão',
  invalidFileType: 'Selecione um arquivo PNG, CHR ou uma ROM NES.',
  chrReadFailed: 'Não foi possível ler o arquivo CHR.',
  emptyChrFile: 'O arquivo CHR está vazio.',
  invalidChrSize:
    'O tamanho do arquivo CHR deve ser um múltiplo positivo de 16 bytes (16 bytes por tile).',
  chrTilesetOnly:
    'Arquivos CHR e ROMs NES só podem ser importados no modo Tileset.',
  nesReadFailed: 'Não foi possível ler o arquivo de ROM NES.',
  invalidNesHeader: 'O arquivo não contém um cabeçalho iNES válido.',
  nes2Unsupported: 'ROMs NES 2.0 não são suportadas na versão 0.8.',
  nesMapperUnsupported:
    'Apenas NROM/mapper 0 é suportado. Esta ROM usa o mapper {mapper}.',
  nesPrgSizeUnsupported:
    'A importação NROM requer uma PRG-ROM de 16 KB ou 32 KB.',
  nesChrRamUnsupported:
    'Esta ROM usa CHR-RAM e não possui tiles CHR-ROM estáticos para extrair.',
  nesChrSizeUnsupported: 'A importação NROM requer exatamente 8 KB de CHR-ROM.',
  nesRomTruncated: 'A ROM termina antes dos dados CHR-ROM declarados.',
  imageDecodeFailed:
    'Não foi possível ler o PNG. O arquivo pode estar danificado ou ser inválido.',
  invalidDimensions: 'A largura e a altura da imagem devem ser múltiplas de 8.',
  invalidPixelData: 'A imagem decodificada contém dados de pixel inválidos.',
  partialTransparency:
    'Pixels parcialmente transparentes ainda não são suportados.',
  tooManyColors:
    'Foram encontradas {count} cores na imagem. No máximo 256 podem ser indexadas antes da quantização para as paletas do NES.',
  invalidPlayfieldDimensions:
    'Um playfield deve ter exatamente 256 × 240 px (32 × 30 tiles). A exportação CHR continua disponível.',
  invalidPlayfieldTiles:
    'A organização de tiles do playfield está incompleta e não pode gerar uma nametable.',
  tooManyPlayfieldTiles:
    'A nametable pode endereçar no máximo 256 tiles CHR, mas {count} tiles seriam exportados. Ative a deduplicação ou reduza a imagem.',
  colorsFoundLabel: 'Cores opacas encontradas:',
  tilesTitle: 'Tiles CHR',
  tilesEmpty: 'Ainda não há tiles para exibir.',
  deduplicateTiles: 'Remover tiles duplicados',
  deduplicateFlippedTiles: 'Também considerar flips horizontais e verticais',
  deduplicationHint:
    'Tiles exatamente iguais podem ser ocultados e omitidos do arquivo CHR.',
  tileVisibilitySummary: 'Exibindo {visible} de {total} tiles.',
  tileDecimalId: 'ID {id}',
  tileHexId: '${id}',
  tilePosition: 'Coluna {column}, linha {row}',
  tileCanvasLabel: 'Prévia do tile {id}',
  paletteEditorTitle: 'Paletas do NES',
  paletteEditorHint:
    'Monte quatro paletas de fundo usando somente os 64 c\u00f3digos de cor suportados pela PPU do NES. A cor 0 \u00e9 a cor de fundo universal compartilhada.',
  paletteEditorEmpty: 'Importe ou gere uma imagem para atribuir as paletas.',
  nesPaletteName: 'Paleta {index}',
  nesPaletteSlotLabel:
    'Paleta {palette}, cor {slot}, c\u00f3digo NES atual {code}',
  nesMasterPaletteTitle: 'Paleta mestre do NES ($00-$3F)',
  nesColorEditTarget:
    'Editando a paleta {palette}, \u00edndice de cor {color} ({code}). Escolha abaixo a cor NES correspondente.',
  nesColorButton: 'Usar a cor NES {code}',
  paletteRegionsTitle: 'Pintar \u00edndices de cor CHR',
  paletteRegionsHint:
    'Clique na pr\u00e9via principal da imagem para abrir aqui uma regi\u00e3o de {size} x {size}. A edi\u00e7\u00e3o de paleta e das cores dos pixels fica dispon\u00edvel somente na regi\u00e3o ampliada.',
  paletteColorBrushTitle: 'Pincel de cor CHR',
  paletteColorBrushLabel:
    'Pintar \u00edndice de cor {index}, c\u00f3digo NES {code}',
  paletteActiveBrush:
    'Pincel ativo: paleta {palette}, \u00edndice de cor {color}, c\u00f3digo NES {code}.',
  paletteShowNumbers:
    'Mostrar n\u00fameros das paletas nas regi\u00f5es da imagem',
  paletteCanvasLabel:
    'Editor de paletas do NES. O bot\u00e3o esquerdo pinta, o direito substitui cores iguais e o bot\u00e3o do meio amplia uma regi\u00e3o.',
  paletteZoomTitle: 'Regi\u00e3o ampliada: coluna {column}, linha {row}',
  paletteZoomDetails:
    '{size} x {size} pixels (x {startX}-{endX}, y {startY}-{endY}); tiles nas colunas {tileStartX}-{tileEndX}, linhas {tileStartY}-{tileEndY}; paleta {palette}.',
  paletteZoomHint:
    'O bot\u00e3o esquerdo pinta um pixel. O direito substitui cores iguais dentro desta regi\u00e3o.',
  paletteZoomClose: 'Fechar amplia\u00e7\u00e3o',
  paletteZoomCanvasLabel: 'Editor ampliado de pixels da paleta do NES.',
  paletteZoomEmpty:
    'Clique em uma regi\u00e3o da pr\u00e9via principal para edit\u00e1-la.',
  palettePixelPaintStatus:
    'Pixel coluna {column}, linha {row}: pintar \u00edndice de cor {color} da paleta {palette}.',
  exportTitle: 'Exportar',
  defaultOutputName: 'image.chr',
  defaultNametableName: 'image.nam',
  defaultAttributeTableName: 'image.atr',
  downloadChr: 'Baixar {name}',
  downloadNametable: 'Baixar {name}',
  downloadAttributeTable: 'Baixar {name}',
  exportUnavailable:
    'Importe uma imagem válida para habilitar a exportação CHR.',
  exportReady: '{count} tiles serão exportados.',
  exportReadyDeduplicated: '{count} tiles únicos de {total} serão exportados.',
  exportReadyFlipDeduplicated:
    '{count} tiles únicos de {total} serão exportados após considerar flips horizontais e verticais.',
  playfieldExportReady:
    'O playfield está pronto com {count} tiles CHR, uma nametable de 960 bytes e uma Attribute Table de 64 bytes.',
  playfieldExportIncomplete:
    'A exportação CHR está disponível, mas os dados do playfield precisam que o problema do diagnóstico seja resolvido.',
  attributeTablePaletteNote:
    'A Attribute Table armazena a paleta selecionada para cada regi\u00e3o de 16 x 16 pixels.',
  paletteExportNote:
    'O arquivo de paletas cont\u00e9m quatro paletas de fundo do NES (16 c\u00f3digos de cor da PPU).',
  quantizationTitle: 'Redução de cores do PNG',
  quantizationHint:
    'Escolha como reduzir as cores do PNG antes da conversão existente para paletas e tiles do NES.',
  quantizationEmpty: 'Importe um PNG para configurar a redução de cores.',
  quantizationModeLabel: 'Quantização',
  quantizationNearest: 'Mais próxima (Nearest)',
  quantizationMedianCut: 'Median Cut',
  quantizationKMeans: 'K-Means',
  quantizationNearestHint:
    'Ideal para pixel art existente e imagens que já usam poucas cores.',
  quantizationMedianCutHint:
    'Opção padrão equilibrada para ilustrações e arte em geral.',
  quantizationKMeansHint:
    'Agrupamento determinístico que pode preservar grupos de cores dominantes.',
  ditheringModeLabel: 'Dithering',
  ditheringNone: 'Nenhum',
  ditheringFloydSteinberg: 'Floyd-Steinberg',
  ditheringAtkinson: 'Atkinson',
  ditheringBayer4: 'Bayer 4 x 4',
  ditheringBayer8: 'Bayer 8 x 8',
  ditheringHint:
    'Nenhum mantém pixels limpos; difusão suaviza gradientes; Bayer cria padrões retrô ordenados.',
  quantizationAdvanced: 'Opções avançadas',
  colorDistanceLabel: 'Distância entre cores',
  colorDistanceRgb: 'RGB euclidiana',
  colorDistancePerceptual: 'Perceptual (OKLab)',
  quantizationReset: 'Restaurar padrões de redução',
  quantizationComparisonTitle: 'Comparação de prévias',
  quantizationComparisonHint:
    'Selecione uma prévia gerada para ativar o quantizador. Dithering e distância valem para todas as comparações.',
  quantizationOriginal: 'Original',
  quantizationPreviewLoading: 'Gerando prévias em segundo plano…',
} as const satisfies TranslationTable;

export const translations = {
  'pt-BR': ptBr,
  en,
} as const satisfies Record<'pt-BR' | 'en', TranslationTable>;
