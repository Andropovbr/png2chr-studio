const en = {
  appTitle: 'PNG2CHR Studio',
  appDescription:
    'Convert PNG artwork and playfields into NES data, entirely in your browser.',
  languageLabel: 'Language',
  localePtBr: 'Português (Brasil)',
  localeEn: 'English',
  importTitle: 'Import PNG',
  imageModeLabel: 'Image purpose',
  tilesetMode: 'Tileset / graphics',
  playfieldMode: 'Playfield / game screen',
  tilesetModeHint: 'Use any PNG whose width and height are multiples of 8.',
  playfieldModeHint:
    'A playfield must be exactly 256 × 240 px (32 × 30 tiles).',
  choosePng: 'Choose PNG',
  generateRandomPlayfield: 'Generate random playfield',
  randomPlayfieldHint:
    'Creates a simple test screen with one four-color NES palette and a small reusable tile set.',
  dropPrompt: 'or drop a PNG file here',
  processingLocal: 'Your image is processed locally and is never uploaded.',
  loadingImage: 'Reading {name}…',
  fileDetails: '{name} · {width} × {height} px',
  dimensionsValue: '{width} × {height} px',
  previewTitle: 'Image preview',
  previewEmpty: 'Import a valid PNG to see its preview.',
  previewCanvasLabel: 'Preview of the imported PNG',
  collisionCanvasLabel:
    'Playfield collision editor. Use arrow keys to move and Space or Enter to paint.',
  collisionEditorTitle: 'Collision map',
  collisionEditorHint:
    'Paint or erase 8 x 8 cells by clicking and dragging over the playfield.',
  collisionPaintSolid: 'Paint solid',
  collisionErase: 'Erase',
  collisionClearAll: 'Clear all',
  collisionCellFree: 'free',
  collisionCellSolid: 'solid',
  collisionCellStatus:
    'Column {column}, row {row}: {state}. {count} solid cells.',
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
  invalidFileType: 'Select a PNG file. Other file formats are not supported.',
  imageDecodeFailed:
    'The PNG could not be read. The file may be damaged or invalid.',
  invalidDimensions: 'The image width and height must both be multiples of 8.',
  invalidPixelData: 'The decoded image contains invalid pixel data.',
  partialTransparency: 'Partially transparent pixels are not supported yet.',
  tooManyColors:
    'Found {count} color indices. NES CHR tiles support four color indices per tile.',
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
  exportTitle: 'Export',
  defaultOutputName: 'image.chr',
  defaultNametableName: 'image.nam',
  defaultAttributeTableName: 'image.atr',
  defaultCollisionMapName: 'image.col',
  downloadChr: 'Download {name}',
  downloadNametable: 'Download {name}',
  downloadAttributeTable: 'Download {name}',
  downloadCollisionMap: 'Download {name}',
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
    'The Attribute Table selects palette 0 everywhere because this version uses one global four-color palette.',
  collisionExportNote:
    'The collision map contains {count} solid cells and uses 120 bytes (one bit per 8 x 8 cell, high bit first).',
} as const;

export type TranslationKey = keyof typeof en;
type TranslationTable = Record<TranslationKey, string>;

const ptBr = {
  appTitle: 'PNG2CHR Studio',
  generateRandomPlayfield: 'Gerar playfield aleat\u00f3rio',
  randomPlayfieldHint:
    'Cria uma tela simples para testes com uma paleta NES de quatro cores e um conjunto pequeno de tiles reutiliz\u00e1veis.',
  collisionCanvasLabel:
    'Editor de colis\u00f5es do playfield. Use as setas para mover e Espa\u00e7o ou Enter para pintar.',
  collisionEditorTitle: 'Mapa de colis\u00f5es',
  collisionEditorHint:
    'Pinte ou apague c\u00e9lulas de 8 x 8 clicando e arrastando sobre o playfield.',
  collisionPaintSolid: 'Pintar s\u00f3lido',
  collisionErase: 'Apagar',
  collisionClearAll: 'Limpar tudo',
  collisionCellFree: 'livre',
  collisionCellSolid: 's\u00f3lida',
  collisionCellStatus:
    'Coluna {column}, linha {row}: {state}. {count} c\u00e9lulas s\u00f3lidas.',
  defaultCollisionMapName: 'image.col',
  downloadCollisionMap: 'Baixar {name}',
  collisionExportNote:
    'O mapa de colis\u00f5es cont\u00e9m {count} c\u00e9lulas s\u00f3lidas e usa 120 bytes (um bit por c\u00e9lula de 8 x 8, bit mais alto primeiro).',
  appDescription:
    'Converta imagens PNG e playfields em dados para NES, totalmente no navegador.',
  languageLabel: 'Idioma',
  localePtBr: 'Português (Brasil)',
  localeEn: 'English',
  importTitle: 'Importar PNG',
  imageModeLabel: 'Finalidade da imagem',
  tilesetMode: 'Tileset / gráficos',
  playfieldMode: 'Playfield / tela do jogo',
  tilesetModeHint:
    'Use qualquer PNG cuja largura e altura sejam múltiplas de 8.',
  playfieldModeHint:
    'Um playfield deve ter exatamente 256 × 240 px (32 × 30 tiles).',
  choosePng: 'Selecionar PNG',
  dropPrompt: 'ou arraste um arquivo PNG para cá',
  processingLocal: 'Sua imagem é processada localmente e nunca é enviada.',
  loadingImage: 'Lendo {name}…',
  fileDetails: '{name} · {width} × {height} px',
  dimensionsValue: '{width} × {height} px',
  previewTitle: 'Prévia da imagem',
  previewEmpty: 'Importe um PNG válido para visualizar sua prévia.',
  previewCanvasLabel: 'Prévia do PNG importado',
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
  invalidFileType:
    'Selecione um arquivo PNG. Outros formatos não são suportados.',
  imageDecodeFailed:
    'Não foi possível ler o PNG. O arquivo pode estar danificado ou ser inválido.',
  invalidDimensions: 'A largura e a altura da imagem devem ser múltiplas de 8.',
  invalidPixelData: 'A imagem decodificada contém dados de pixel inválidos.',
  partialTransparency:
    'Pixels parcialmente transparentes ainda não são suportados.',
  tooManyColors:
    'Foram encontrados {count} índices de cor. Tiles CHR do NES permitem quatro índices de cor por tile.',
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
    'A Attribute Table seleciona a paleta 0 em toda a tela porque esta versão usa uma paleta global de quatro cores.',
} as const satisfies TranslationTable;

export const translations = {
  'pt-BR': ptBr,
  en,
} as const satisfies Record<'pt-BR' | 'en', TranslationTable>;
