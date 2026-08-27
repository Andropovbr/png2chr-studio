# Formatos e Exportação

Este documento especifica todos os formatos de arquivo suportados, importados e exportados pelo **PNG2CHR Studio**, detalhando seus contratos de dados, estruturas binárias e regras de compatibilidade com o hardware do Nintendo Entertainment System (NES).

---

## 1. Imagem PNG (`.png`)

O PNG é o formato primário de entrada para criação de gráficos (Tileset, Playfield e Spritesheet de Animação).

### Regras de validação de entrada

- **Dimensões:** A largura e a altura devem ser múltiplos positivos de 8 pixels.
  - Para o modo Playfield: a imagem deve ter exatamente **256×240 pixels** (32×30 tiles de 8×8).
  - Para o modo Spritesheet / Animação: a largura e altura dos frames devem ser múltiplos de 8 pixels.
- **Transparência:** Suporte estrito a transparência binária (1-bit alfa). Pixels devem ser 100% opacos (alfa = 255) ou 100% transparentes (alfa = 0). Pixels com transparência intermediária (1 a 254) são rejeitados com diagnóstico explícito.
- **Cores:** Pixels transparentes recebem automaticamente o índice 0 da paleta. Pixels opacos passam pelo pipeline configurável de quantização (Nearest, Median Cut ou K-Means) e são mapeados para a paleta master do NES (64 cores) e, em seguida, para os 4 índices da paleta ativa do tile/região.

---

## 2. CHR Binário do NES (`.chr`)

Arquivo binário contendo os padrões gráficos brutos no formato planar 2bpp (2 bits por pixel) nativo da PPU do NES.

### Estrutura de cada Tile 8×8 (16 bytes)

- **Tamanho:** 16 bytes por tile.
- **Bitplane 0 (bytes 0–7):** Bit menos significativo (bit 0) do índice de cor de cada pixel da linha correspondente (0 a 7).
- **Bitplane 1 (bytes 8–15):** Bit mais significativo (bit 1) do índice de cor de cada pixel da linha correspondente (0 a 7).
- **Ordem dos bits no byte:** O pixel mais à esquerda corresponde ao **bit 7** (MSB); o pixel mais à direita corresponde ao **bit 0** (LSB).
- **Montagem do índice de cor (0–3):** `cor = ((bitplane1 >> bit) & 1) << 1 | ((bitplane0 >> bit) & 1)`.

### Importação de CHR

- O arquivo deve ter tamanho múltiplo positivo de 16 bytes.
- Os tiles são decodificados em sequência e organizados em grade para visualização.

### Exportação de CHR

- **Modos Tileset e Playfield:** Exporta a lista de tiles brutos ou deduplicados.
- **Modo Animação:** Exporta um arquivo consolidado no formato de CHR-ROM física completa de **8.192 bytes** (512 tiles / duas pattern tables de 4 KiB: PT0 em `0x0000–0x0FFF` e PT1 em `0x1000–0x1FFF`).

---

## 3. Cartucho iNES / ROM NES (`.nes`)

Suporte a extração gráfica a partir de ROMs de jogos simples do NES.

### Regras de importação

- **Formato:** Cabeçalho iNES padrão (16 bytes, iniciando com `NES\x1A`).
- **Mapper:** Apenas **Mapper 0 (NROM)** é suportado. Outros mappers são rejeitados com mensagem descritiva.
- **Tamanho PRG-ROM:** 16 KiB ou 32 KiB.
- **Tamanho CHR-ROM:** Exatamente 8 KiB (512 tiles). Jogos que utilizam CHR-RAM (0 KB de CHR-ROM) ou múltiplos bancos de CHR são rejeitados.
- **Trainer:** Suporte opcional a trainer de 512 bytes antes do PRG-ROM.
- **Extração:** Extrai os 8.192 bytes de CHR-ROM divididos em duas pattern tables consecutivas de 256 tiles cada (PT0 e PT1).

---

## 4. Nametable do NES (`.nam`)

Representa o mapa de fundo (background) de uma tela completa de 256×240 pixels (32 colunas × 30 linhas de tiles 8×8).

- **Tamanho:** **960 bytes**.
- **Organização:** Array contínuo de 960 bytes, lido da esquerda para a direita, linha por linha (ordem de varredura).
- **Conteúdo:** Cada byte armazena o índice do tile (0 a 255) na pattern table da PPU selecionada para o background.
- **Restrição de Hardware:** Como cada entrada é de 1 byte (8 bits), o playfield não pode referenciar mais de 256 tiles únicos. Quando o playfield ultrapassa 256 tiles únicos e a deduplicação não é suficiente, a exportação de `.nam` e `.atr` é desabilitada na UI até que o número de tiles seja reduzido.

---

## 5. Attribute Table do NES (`.atr`)

Define a atribuição de paleta de background para as regiões do playfield.

- **Tamanho:** **64 bytes**.
- **Resolução de Hardware:** A PPU do NES não permite definir paletas por tile 8×8 individual no background; a seleção de paleta é feita em blocos de **16×16 pixels** (2×2 tiles), agrupados em metatiles de **32×32 pixels** (4 blocos 16×16 por byte).
- **Estrutura de cada Byte da Attribute Table:**
  - Bits 1–0: Paleta do quadrante superior esquerdo (Top-Left, 16×16)
  - Bits 3–2: Paleta do quadrante superior direito (Top-Right, 16×16)
  - Bits 5–4: Paleta do quadrante inferior esquerdo (Bottom-Left, 16×16)
  - Bits 7–6: Paleta do quadrante inferior direito (Bottom-Right, 16×16)
- **Cálculo de índice:** `byteIndex = (row / 4) * 8 + (col / 4)`.

---

## 6. Arquivo de Paletas do NES (`.pal`)

Os exportadores de `src/core/palette-exporters.ts` serializam exclusivamente o estado dual-bank canônico. Cada byte é um código de cor NES `$00..$3F`; slots vazios ou com referência dangling usam o fallback determinístico do domínio.

### 6.1 Binários

| Variante            | Tamanho      | Layout                                                                                 |
| :------------------ | :----------- | :------------------------------------------------------------------------------------- |
| Background `.pal`   | **16 bytes** | Quatro subpaletas BG em ordem de slot, correspondentes a `$3F00..$3F0F`.               |
| Sprite `.pal`       | **16 bytes** | Quatro subpaletas SPR em ordem de slot, correspondentes a `$3F10..$3F1F`.              |
| PPU completa `.pal` | **32 bytes** | Concatenação exata de **16 bytes Background + 16 bytes Sprites**, para `$3F00..$3F1F`. |

Em cada banco, os offsets `0`, `4`, `8` e `12` contêm `universalBackgroundColor`. No banco BG isso implementa os espelhos `$3F00/$04/$08/$0C`; no banco SPR representa os endereços transparentes `$3F10/$14/$18/$1C`, que espelham `$3F00` no hardware. Os bancos nunca consultam slots um do outro.

### 6.2 C para cc65 (`.h` / `.c`)

`generateCPaletteExport` gera:

- macros de tamanho, offsets BG/SPR e índices absolutos dos oito slots na Palette RAM;
- declarações `extern const unsigned char <símbolo>_bg[16]` e `<símbolo>_spr[16]`;
- duas tabelas `const` com valores `0xXX`, organizadas e comentadas por subpaleta física.

O símbolo e os nomes de arquivo passam por `normalizeCIdentifier`. As duas tabelas ocupam **32 bytes** de ROM.

### 6.3 Assembly para ca65 (`.inc` / `.s`)

`generateCa65PaletteExport` gera:

- include `.inc` com constantes de tamanho/offset/slot e diretivas `.import`;
- source `.s` com `.segment "RODATA"` por padrão, diretivas `.export` e tabelas `.byte $XX` separadas para BG e SPR;
- exatamente os mesmos 32 bytes e a mesma ordem da exportação C e do binário PPU completo.

---

## 7. Mapa de Colisão (`.col`)

Armazena dados de colisão e física para jogos de NES, pintados sobre a grade 32×30 do playfield.

- **Tamanho:** **480 bytes** (960 células / 2 células por byte).
- **Formato de Empacotamento:** Cada célula 8×8 é codificada como um valor de 4 bits (nibble, 0–15). Em cada byte:
  - **Nibble Alto (bits 7–4):** Célula da esquerda `(x, y)`
  - **Nibble Baixo (bits 3–0):** Célula da direita `(x+1, y)`
- **Linha:** Cada linha de 32 células ocupa exatamente 16 bytes.
- **Tipos de Colisão Suportados:**

| Código | Nome Técnico (`CollisionType`) | Descrição                               |
| ------ | ------------------------------ | --------------------------------------- |
| `0`    | `none`                         | Espaço livre / sem colisão              |
| `1`    | `solid`                        | Sólido / obstáculo intransponível       |
| `2`    | `damage`                       | Dano / perigo / espinho                 |
| `3`    | `ladder`                       | Escada bidirecional                     |
| `4`    | `moveUp`                       | Força subida / escada de sentido único  |
| `5`    | `water`                        | Água / fluído                           |
| `6`    | `oneWay`                       | Plataforma unidirecional (atravessável) |
| `7`    | `ice`                          | Gelo / superfície escorregadia          |
| `8`    | `conveyorLeft`                 | Esteira rolante para esquerda           |
| `9`    | `conveyorRight`                | Esteira rolante para direita            |
| `10`   | `moveDown`                     | Força descida                           |

---

## 8. Arquivo de Projeto do Studio (`.p2c` / `.p2c.json` / `.json`)

Formato canônico em JSON para persistência completa de projetos no PNG2CHR Studio.

- **Extensões reconhecidas:** `.p2c`, `.p2c.json`, `.json`.
- **Versão atual do schema:** `1` (`CURRENT_PROJECT_FORMAT_VERSION = 1`).

### Estrutura do Schema `StudioProject` (`formatVersion: 1`)

```json
{
  "formatVersion": 1,
  "name": "Nome do Projeto",
  "mode": "tileset | playfield | animation",
  "settings": {
    "deduplicationEnabled": true,
    "flipDeduplicationEnabled": true,
    "quantization": {
      "quantizationMode": "nearest | median-cut | k-means",
      "ditheringMode": "none | floyd-steinberg",
      "colorDistanceMode": "perceptual | rgb | yuv"
    }
  },
  "palette": {
    "paletteSet": [
      [15, 0, 16, 48],
      [15, 6, 22, 38],
      [15, 9, 25, 41],
      [15, 12, 28, 44]
    ],
    "activePaletteIndex": 0,
    "activeColorIndex": 1,
    "palettes": [
      {
        "id": "pal_hero_blue",
        "name": "Hero Blue",
        "colors": [15, 1, 17, 33]
      }
    ],
    "activeSpritePaletteSlots": ["pal_hero_blue", null, null, null]
  },
  "chrRegions": [
    {
      "id": "reg_player",
      "name": "Player Sprites",
      "patternTable": 0,
      "startTile": 0,
      "endTile": 31,
      "kind": "region",
      "notes": "Main hero animations",
      "color": "#00E5FF"
    },
    {
      "id": "res_dynamic_fx",
      "name": "Dynamic Effects Bank",
      "patternTable": 1,
      "startTile": 192,
      "endTile": 255,
      "kind": "reservation"
    }
  ],
  "tileset": {
    "asset": {
      "path": "assets/tiles.png",
      "name": "tiles.png",
      "sourceKind": "png",
      "dataUrl": "data:image/png;base64,..."
    },
    "paletteAssignments": [0, 1, 2, 3],
    "pixelOverrides": [0, 0, 1, 2]
  },
  "playfield": {
    "asset": {
      "path": "stages/stage1.png",
      "name": "stage1.png",
      "sourceKind": "png",
      "dataUrl": "data:image/png;base64,..."
    },
    "collisionCells": [1, 0, 2],
    "activeCollisionType": 1,
    "randomPlayfieldFeatures": ["walls", "platforms", "clouds"],
    "paletteAssignments": [0, 1, 2, 3],
    "pixelOverrides": [0, 0, 1, 2]
  },
  "animation": {
    "name": "hero",
    "symbolPrefix": "hero",
    "defaultPaletteIndex": 0,
    "quantizationMode": "median-cut",
    "ditheringMode": "none",
    "flipDeduplication": true,
    "spritePalette": 0,
    "spriteColorIndex": 1,
    "patternTable": 0,
    "destinationPatternTable": 0,
    "destinationChr": {
      "id": "asset-base-chr-default",
      "path": "chr/base.chr",
      "name": "base.chr",
      "sourceKind": "chr",
      "dataUrl": "data:application/octet-stream;base64,..."
    },
    "animations": [
      {
        "id": "anim_1",
        "name": "walk",
        "entity": "hero",
        "asset": {
          "id": "asset-anim-walk-sheet",
          "path": "sprites/hero_walk.png",
          "name": "hero_walk.png",
          "sourceKind": "png",
          "dataUrl": "data:image/png;base64,..."
        },
        "paletteId": "pal_hero_blue",
        "paletteIndex": 0,
        "framePaletteIds": ["pal_hero_blue", "pal_hero_blue"],
        "quantizationMode": "median-cut",
        "ditheringMode": "none",
        "frameWidth": 16,
        "frameHeight": 32,
        "originX": 8,
        "originY": 32,
        "playback": "loop",
        "allowHorizontalFlip": true,
        "allowVerticalFlip": false,
        "flipH": false,
        "flipV": false,
        "defaultDuration": 6,
        "frameIndices": [0, 1, 2, 3],
        "frameDurations": [6, 6, 8, 6],
        "framePalettes": [0, 0, 0, 0],
        "pixelOverrides": {
          "0_0": { "0": 3, "1": 2 }
        }
      }
    ]
  },
  "scenePreview": {
    "instances": [
      {
        "id": "inst-1",
        "entityId": "hero",
        "animationName": "walk",
        "x": 120,
        "y": 100,
        "visible": true,
        "name": "Player 1"
      }
    ]
  }
}
```

### Detalhamento dos Campos

- **Portabilidade e Identidade de Assets (`ProjectAssetReference`):** Cada referência a arquivo (`asset` ou `destinationChr`) armazena:
  - `id` (`ProjectAssetId`): identificador estável único do asset lógico (ex: `asset-anim-walk-sheet`, `asset-tileset-dungeon`). Projetos legados sem `id` são automaticamente normalizados com IDs determinísticos (`asset-tileset-default`, `asset-playfield-default`, `asset-base-chr-default`, `asset-anim-<animId>`), mantendo compatibilidade estrita (`formatVersion: 1`).
  - `path`: caminho relativo normalizado do arquivo.
  - `dataUrl`: dados binários embutidos codificados em Base64 para garantir portabilidade completa offline.
  - `sourceKind` e `name`: tipo de origem (`png`, `chr`, `nes`) e nome de exibição.
- **Chaves Canônicas de Tiles Lógicos (`LogicalTileKey`):** Identifica tiles na grade lógica de origem no formato `${assetId}:${tileX}:${tileY}` (ex: `asset-hero:0:0`), estritamente desacoplada da alocação de slots físicos em CHR (Pattern Tables, offsets ou deduplicação).
- **Gerenciador de Paletas (`palette`):** Persiste a biblioteca declarativa de paletas (`palettes: readonly PaletteDefinition[]`), a cor universal de fundo da PPU `$3F00` (`universalBackgroundColor: number`), os 4 slots ativos de hardware de Background (`activeBackgroundSlots: ActivePaletteSlots`), os 4 slots ativos de Sprites (`activeSpriteSlots: ActivePaletteSlots`), além dos índices de edição da UI e campos legados (`paletteSet`, `activeSpritePaletteSlots`) para retrocompatibilidade determinística e transparente (`formatVersion: 1`).
- **Regiões e Reservas de CHR (`chrRegions`):** Lista opcional de partições lógicas e reservas de exclusão de CHR (`ChrRegion`). Cada item contém `id`, `name`, `patternTable` (`0` ou `1`), `startTile` e `endTile` (índices locais `$00..$FF` / `0..255`, inclusive), `kind` (`"region"` para faixas organizacionais neutras ou `"reservation"` para reservas que bloqueiam novas alocações automáticas de tiles), além de `notes` e `color` opcionais. Uma reserva bloqueia novas alocações sem mover, apagar ou alterar tiles físicos existentes, permitindo que tiles reais pré-existentes na faixa sejam referenciados por deduplicação. Mantém total retrocompatibilidade (`formatVersion: 1`).
- **Tileset & Playfield:** Persiste caminhos/dados de imagem, atribuições de paleta por tile/metatile, substituições de pixels 8×8 (`pixelOverrides`), mapa de colisão de 480 bytes (`collisionCells` com 11 tipos), tipo de colisão ativo e parâmetros de geração procedural.
- **Animações e Metasprites (`animation`):** Múltiplas animações com identificadores estáveis (`id`), dimensões e âncoras de origem por animação, sequenciamento e temporização por frame, paletas atribuídas por frame ou globais (`paletteId` / `framePaletteIds`), mapa de substituições de pixel 8×8 (`pixelOverrides`) e alocação de Base CHR com isolamento de Pattern Table (PT0/PT1).
- **Scene Preview (`scenePreview`):** Instâncias multi-entidade com coordenadas no canvas (X, Y), animação associada, visibilidade e identificador único (`id`).
- **Mapeamento de CHR e Posse de Tiles (Runtime-Derived):** O índice bidirecional de atribuição física (`ChrAssetMappingIndex`, `PhysicalSlotAttribution`, `PhysicalTileOrigin`, `PhysicalTileUsage`, `isShared`) é uma estrutura puramente derivada em tempo de execução (`src/core/chr-asset-mapping.ts`), recalculada sob demanda a partir da fonte canônica do projeto. **Não é serializado no `.p2c`**, mantendo o formato estável e leve (`formatVersion: 1`).
- **Fronteiras de Estado:** Estados transitórios de UI (como subworkspace ativo na sidebar, abas do editor, níveis de zoom e recolhimento de painéis) são gerenciados no `WorkspaceState` e deliberadamente **não** são serializados no arquivo de projeto, evitando marcação indevida de modificação (_dirty state_).

---

## 9. Metadados de Animação em JSON (`.json`)

Contrato padronizado de metadados para pipelines de assets em projetos de jogos.

- **Cabeçalho:** `"format": "png2chr-studio-animation"`, `"version": 5`.
- **Conteúdo:**
  - `name`, `symbol_prefix`, `symbol_base`, `default_palette_index`, `pattern_table`, `color_reduction`.
  - Estatísticas de CHR: `total_capacity`, `total_occupied`, `pattern_tables[0..1]`.
  - Array `animations`: Para cada animação, exporta `name`, `source_file`, `frame_width`, `frame_height`, `origin_x`, `origin_y`, `playback` (`"loop"` ou `"once"`), flags de flip (`allow_horizontal_flip`, `allow_vertical_flip`), `default_frame_duration` e lista de `frames`.
  - Cada frame contém lista de `sprites` (metasprite) com: `x`, `y` (offsets assinados de 8 bits), `tile_index` (índice local OAM de 8 bits `$00–$FF`), `physical_tile_index` (0–511), `attributes` (bits OAM da PPU: bits 0-1 paleta, bit 6 flip H, bit 7 flip V), `palette`, `flip_h`, `flip_v`, `reuse_source` e coordenadas da célula de origem.

---

## 10. Exportação C para cc65 (`.h` / `.c`)

Gera código-fonte em C e cabeçalho prontos para compilação com o compilador **cc65** para NES.

### Estruturas de Dados em ROM

```c
typedef struct {
    int8_t x;
    int8_t y;
    uint8_t tile;
    uint8_t attributes;
} Png2ChrAnimationMetaspriteTile;

typedef struct {
    uint16_t sprite_offset;
    uint8_t sprite_count;
    uint8_t duration;
} Png2ChrAnimationFrame;

typedef struct {
    uint16_t frame_offset;
    uint8_t frame_count;
    uint8_t width_tiles;
    uint8_t height_tiles;
    uint8_t playback;
    uint8_t flags;
} Png2ChrAnimation;
```

### Constantes e Otimização de Memória

- `Png2ChrAnimationMetaspriteTile`: **4 bytes** por sprite do metasprite (coordenadas com sinal `int8_t`, índice de tile local `0..255`, e byte de atributo OAM).
- `Png2ChrAnimationFrame`: **4 bytes** por frame.
- `Png2ChrAnimation`: **7 bytes** por animação.
- Constante `#define ${PREFIX}_SPRITE_PATTERN_TABLE <0|1>` gerada no cabeçalho para configuração do bit 3 do registrador `PPUCTRL` no código do jogo.
- Dados são declarados em tabelas `const` para residirem integralmente na ROM (PRG-ROM).
- Enum gerado `${PascalCase}AnimationId` com identificadores para indexação type-safe no jogo.

---

## 11. Exportação Assembler para ca65 (`.inc` / `.s`)

Gera arquivos de inclusão (`.inc`) e tabelas de dados em assembly 6502 (`.s`) para o montador **ca65**.

- Emite diretivas `.byte` e `.word` mapeando exatamente a mesma estrutura compacta da exportação C.
- Constantes simbólicas para IDs de animação, constante `${PREFIX}_SPRITE_PATTERN_TABLE = <0|1>`, flags de flip (`ANIMATION_ALLOW_H_FLIP = $40`, `ANIMATION_ALLOW_V_FLIP = $80`) e modos de reprodução (`ANIMATION_PLAYBACK_LOOP = 0`, `ANIMATION_PLAYBACK_ONCE = 1`).

---

## 12. Formatos e Exportação de Background Maps (Milestone 8)

O **Background Pipeline** implementa exportadores determinísticos e serializadores puros a partir do modelo compilado `BackgroundProjectModel`:

### 12.1 Formatos Binários

| Extensão | Tamanho             | Descrição                                                                                                                               |
| :------- | :------------------ | :-------------------------------------------------------------------------------------------------------------------------------------- |
| `.nam`   | **960 bytes**       | Nametable física do NES (32 colunas × 30 linhas). Cada byte contém o índice local de tile (`0..255`) na Pattern Table selecionada.      |
| `.atr`   | **64 bytes**        | Attribute Table do NES (8 colunas × 8 linhas). Cada byte empacota 4 quadrantes de 16×16 px (2×2 tiles) com valores de subpaleta `0..3`. |
| `.map`   | **1024 bytes**      | Arquivo combinado contendo os 960 bytes da Nametable seguidos imediatamente pelos 64 bytes da Attribute Table.                          |
| `.chr`   | **8192 B / 4096 B** | CHR-ROM completa (8 KiB) ou fatia de 4 KiB correspondente à Pattern Table utilizada pelo mapa.                                          |
| `.pal`   | **16 bytes**        | Paleta de 16 bytes de background do NES (4 subpaletas com Cor Universal de Fundo compartilhada).                                        |

### 12.2 Código C para cc65 (`.h` / `.c`)

Gera cabeçalho e fonte C compatíveis com o compilador **cc65**:

- **Constantes geradas no header (`.h`):**
  - `#define ${ID}_BACKGROUND_PATTERN_TABLE <0|1>` (para configuração do bit 4 de `PPUCTRL`);
  - `#define ${ID}_NAMETABLE_WIDTH_TILES 32`;
  - `#define ${ID}_NAMETABLE_HEIGHT_TILES 30`;
  - `#define ${ID}_NAMETABLE_SIZE 960`;
  - `#define ${ID}_ATTRIBUTE_TABLE_SIZE 64`;
  - `#define ${ID}_FULL_MAP_SIZE 1024`.
- **Declarações em ROM (`.c`):**
  - `const unsigned char ${id}_nametable[${ID}_NAMETABLE_SIZE]`: 30 linhas de 32 bytes hexadecimais;
  - `const unsigned char ${id}_attribute_table[${ID}_ATTRIBUTE_TABLE_SIZE]`: 8 linhas de 8 bytes hexadecimais;
  - `const unsigned char ${id}_full_map[${ID}_FULL_MAP_SIZE]` (quando habilitado).

### 12.3 Código Assembly para ca65 (`.inc` / `.s`)

Gera arquivos de inclusão e dados em assembly 6502 compatíveis com o montador **ca65**:

- **Constantes e Símbolos no include (`.inc`):**
  - `${ID}_BACKGROUND_PATTERN_TABLE = <0|1>`;
  - Constantes de dimensão e tamanho em bytes;
  - Diretivas `.import` correspondentes.
- **Tabelas de Dados no source (`.s`):**
  - Diretiva `.segment "RODATA"`;
  - Diretivas `.export`;
  - Blocos de dados `.byte $XX, $YY, ...` alinhados visualmente por linha da tela do NES.
