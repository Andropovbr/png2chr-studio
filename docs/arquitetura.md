# Arquitetura do PNG2CHR Studio

Este documento descreve a arquitetura técnica real do **PNG2CHR Studio**, seus principais módulos, fluxo de dados, pipeline de processamento gráfico e os mecanismos que garantem aderência às restrições do hardware do Nintendo Entertainment System (NES).

---

## 1. Visão Geral e Princípios Arquiteturais

O PNG2CHR Studio é uma aplicação web cliente estática (_browser-only_), construída em **TypeScript estrito**, sem dependência de frameworks de interface (como React ou Vue), sem backend e sem banco de dados.

### Princípios-chave da arquitetura:

1. **Isolamento do Domínio (`src/core/`):** Toda a lógica de conversão, codificação binária, validação de regras do NES e persistência é implementada como funções puras e determinísticas, completamente livres de dependências da API do DOM ou do Canvas.
2. **Interface Declarativa e Modular (`src/ui/`):** Componentes criam e manipulam elementos DOM nativos e contextos Canvas 2D, comunicando-se com o orquestrador via callbacks e tipos imutáveis.
3. **Fronteiras Rígidas de Estado:** Separação explícita entre dados que pertencem ao projeto persistível (`StudioProject`), estado transitório de tela (`WorkspaceState`) e mensagens de status/progresso (`DerivedStatus`).
4. **Execução Local Segura:** O processamento ocorre 100% no navegador do usuário; nenhum arquivo PNG, ROM ou CHR é transmitido para servidores externos.

---

## 2. Estrutura de Módulos

```text
src/
├── core/                       # Domínio, algoritmos puros e regras NES
│   ├── animation-exporters.ts  # Geradores de C (cc65) e Assembly (ca65)
│   ├── animation-mapping.ts    # Projeção de tiles OAM locais vs físicos CHR
│   ├── animation-model.ts      # Modelo de metasprites, frames e animações
│   ├── animation-palette.ts    # Resolução hierárquica de paletas de animação
│   ├── c-identifier.ts         # Normalização e sanitização de identificadores C
│   ├── chr-decoder.ts          # Decodificação de binário 2bpp para pixels
│   ├── chr-encoder.ts          # Codificação de pixels para formato planar 2bpp
│   ├── chr-pattern-table.ts    # Gerenciamento de pattern tables de 4 KiB / 8 KiB
│   ├── chr-rom.ts              # Manipulação de CHR-ROM e concatenação de base CHR
│   ├── collision-encoder.ts    # Empacotamento de matriz de colisão 480 bytes
│   ├── color-distance.ts       # Métricas de distância de cores (Euclidiana e OKLab)
│   ├── color-mapping.ts        # Mapeamento para os 64 códigos PPU do NES
│   ├── frame-detection.ts      # Detecção automática de grade de frames em spritesheets
│   ├── image-analysis.ts       # Validação de dimensões e transparência de PNG
│   ├── image-quantization.ts   # Redutores de cor (Nearest, Median Cut, K-Means)
│   ├── ines-rom.ts             # Parser de cabeçalho iNES e extração de NROM
│   ├── nes-palette.ts          # Paleta master de 64 cores e paletas padrão
│   ├── palette-manager.ts      # Gerenciador de paletas nomeadas e slots ativos
│   ├── pixel-overrides.ts      # Camada de edição de pixels 8x8 por tile
│   ├── playfield-encoder.ts    # Geração de Nametable (.nam) e Attribute Table (.atr)
│   ├── png-load.ts             # Extração de ImageData a partir de PNG
│   ├── project.ts              # Schema de persistência .p2c, serialização e migração
│   ├── quantization-settings.ts# Configurações de quantização e dithering
│   ├── random-playfield.ts     # Gerador procedural de playfield de teste
│   ├── scene-preview.ts        # Composição multi-entidade em cena
│   ├── tile-deduplication.ts   # Deduplicação exata e flip-aware (H, V, HV)
│   ├── tile-extraction.ts      # Particionamento de imagens em blocos 8x8
│   └── types.ts                # Tipos fundamentais de imagem e tiles
├── i18n/                       # Internacionalização (pt-BR e en)
├── ui/                         # Componentes de interface e editores Canvas
├── utils/                      # Downloads de arquivos e sanitização de nomes
├── workers/                    # Web Worker de quantização assíncrona
└── main.ts                     # Orquestrador central e gerenciador de ciclo de vida
```

---

## 3. Gestão e Fronteiras de Estado

Conforme documentado em [`docs/project-state-boundaries.md`](./project-state-boundaries.md), a aplicação estabelece três limites estritos de dados em `src/main.ts`:

```
┌─────────────────────────────────────────────────────────────┐
│                         src/main.ts                         │
├──────────────────────────────┬──────────────────────────────┤
│    updateProject(...)        │  Altera dados do projeto     │
│    (StudioProject)           │  - Marca dirty (*)           │
│                              │  - Serializado em .p2c       │
├──────────────────────────────┼──────────────────────────────┤
│    updateWorkspace(...)      │  Altera visualização da UI   │
│    (WorkspaceState)          │  - NÃO marca dirty           │
│                              │  - NÃO é serializado         │
├──────────────────────────────┼──────────────────────────────┤
│    setDerivedStatus(...)     │  Progresso e mensagens       │
│    (DerivedStatus)           │  - NÃO marca dirty           │
│                              │  - NÃO é serializado         │
└──────────────────────────────┴──────────────────────────────┘
```

1. **`StudioProject` (Persistente):** Estado canônico de criação (modo selecionado, fontes gráficas com dataUrl, definições de paleta, slots ativos, pixel overrides, mapa de colisão, animações, instâncias de cena, base CHR). Qualquer alteração gera uma nova identidade de objeto e marca o projeto como não-salvo (`isDirty = true`).
2. **`WorkspaceState` (Transiente):** Estado de layout da interface (ferramenta ativa no preview, zoom de edição, painéis colapsados, overlays numéricos de paleta).
3. **`DerivedStatus` (Status):** Estado volátil de carregamento e diagnósticos de erro recuperáveis.

---

## 4. Pipeline de Processamento: PNG → Dados NES

O fluxo de transformação de uma imagem PNG em estruturas consumíveis pelo NES segue etapas bem definidas:

```
[ PNG (ArrayBuffer/Blob) ]
           │
           ▼
[ Decodificação Canvas/ImageData ]
           │
           ▼
[ Validação de Dimensões e Transparência ] (múltiplos de 8, sem alfa intermediário)
           │
           ▼
[ Redução de Cores / Quantização ] (Nearest | Median Cut | K-Means + Dithering)
           │
           ▼
[ Mapeamento de Paletas PPU ] (Códigos $00–$3F)
           │
           ▼
[ Extração de Tiles 8×8 ] (Leitura linha a linha, 64 pixels por tile)
           │
           ▼
[ Aplicação de Pixel Overrides ] (Edições manuais de pixel mantidas sobre a imagem)
           │
           ▼
[ Deduplicação e Alocação ] (Exata e/ou Espelhamentos H/V/HV)
           │
           ▼
[ Codificação 2bpp Planar ] (16 bytes por tile: Bitplane 0 + Bitplane 1)
           │
           ▼
[ Saídas Específicas de Modo ]
   ├── Tileset:       .chr bruto/deduplicado + .pal
   ├── Playfield:     .chr + .nam (960 B) + .atr (64 B) + .col (480 B) + .pal
   └── Sprites/Anim:  .chr (8 KiB) + JSON v5 + C (cc65) + ASM (ca65) + .pal
```

### Quantização e Dithering

- **Quantizadores:**
  - _Nearest:_ Mapeia diretamente para as cores NES mais frequentes mais próximas (ideal para pixel art pré-existente).
  - _Median Cut:_ Agrupa o espaço de cores em caixas representativas (padrão para ilustrações gerais).
  - _K-Means:_ Agrupamento determinístico por centróides com inicialização do ponto mais distante.
- **Métricas de Distância:** Espaço Euclidiano RGB ou espaço perceptual **OKLab** (padrão).
- **Dithering:** None, Floyd-Steinberg, Atkinson, Bayer 4×4 e Bayer 8×8.

---

## 5. Manipulação de CHR e Pattern Tables

A PPU do NES endereça graficamente até **8 KiB de CHR-ROM**, organizados como duas **Pattern Tables de 4 KiB** (PT0 e PT1), contendo 256 tiles de 8×8 cada.

- **Codificação Planar 2bpp:** Cada tile é composto por 16 bytes. Os primeiros 8 bytes representam o plano de bits menos significativo (bitplane 0) de cada uma das 8 linhas do tile. Os 8 bytes seguintes representam o plano mais significativo (bitplane 1).
- **Alocação de Sprites e Pattern Table Selecionada:** No modo animação, o usuário seleciona explicitamente a pattern table de sprites (PT0 ou PT1) que o jogo ativará no registro `PPUCTRL` (bit 3).
- **Indexação Local OAM (8 bits):** O hardware de sprites do NES (OAM) armazena um índice de tile de 8 bits (`$00–$FF`). O Studio traduz o índice físico (0 a 511 na CHR física) para o índice local correspondente da tabela ativa (`tileIndex = physicalIndex - tableOffset`).
- **Reutilização e Concatenação com Base CHR:** O Studio permite importar um arquivo base `.chr` de até 8 KiB. Os slots ocupados pela base são respeitados, e novos tiles do projeto são alocados nos primeiros slots livres da pattern table selecionada, evitando colisões ou substituições indevidas.

---

## 6. Fluxos de Trabalho Específicos

### 6.1 Modo Tileset

- Destinado à criação e organização de bancos de tiles avulsos.
- Atribuição de paletas feita individualmente por tile 8×8.
- Suporte a deduplicação com reconhecimento de rotações/flips (H, V, HV).
- Editor de pixels integrado para retoques rápidos nos tiles.

### 6.2 Modo Playfield

- Processa telas estáticas completas de **256×240 pixels** (32 colunas × 30 linhas de tiles).
- Gera a **Nametable (`.nam`)** com 960 bytes representando a grade de índices de tiles.
- Gera a **Attribute Table (`.atr`)** com 64 bytes para as paletas dos metatiles 16×16.
- Editor interativo de colisão com suporte a 11 tipos (sólido, dano, escadas, esteiras, plataformas unidirecionais, etc.), exportando o mapa `.col` de 480 bytes (4 bits por célula).
- Gerador procedural de telas de teste com elementos configuráveis (plataformas, escadas conectadas, nuvens, árvores e bordas).

### 6.3 Modo Spritesheet e Animação

- Criação de conjuntos de animações genéricas para entidades de jogo.
- Cada animação possui controle de spritesheet PNG, dimensões de frame, âncora de origem assinada (`originX`, `originY`), modo de reprodução (`loop` ou `once`), flags de flip e durações por frame.
- **Detecção Assistida de Frames (`src/core/frame-detection.ts`):** Analisa a transparência e as dimensões da folha para sugerir a grade de frames automaticamente.
- **Geração de Metasprites:** Cada frame selecionado é subdividido em células 8×8. Células totalmente transparentes são **omitidas**, economizando slots na OAM e respeitando o limite do hardware de 8 sprites por linha de varredura (_scanline limit_).
- **Projeção de Mapeamento (`src/core/animation-mapping.ts`):** Painel que inspeciona detalhadamente o índice local OAM, índice físico CHR, paleta efetiva e atributos de cada tile de cada frame.
- **Scene Preview Multi-Entidade (`src/core/scene-preview.ts`):** Permite instanciar múltiplas entidades em uma cena 256×240 com reprodução independente para verificar alinhamentos de âncoras e paletas em contexto de jogo.

---

## 7. Sistema de Paletas

O gerenciamento de paletas no Studio replica com fidelidade a arquitetura de cores da PPU do NES:

- **Paleta Master do NES:** Matriz fixa de 64 cores do NES (`$00` a `$3F`).
- **Paletas de Background vs Sprites:** Quatro subpaletas de 4 cores para background e quatro para sprites.
- **Cor Universal de Fundo:** O índice 0 de todas as paletas é compartilhado globalmente (espelhado na PPU em `$3F00`), preenchendo o fundo de telas e previews.
- **Gerenciador de Paletas do Projeto (`src/core/palette-manager.ts`):** Permite criar paletas nomeadas independentes e associá-las aos 4 slots ativos de sprites (`activeSpritePaletteSlots`).
- **Hierarquia de Resolução:** A paleta de um sprite é determinada na seguinte ordem de precedência:
  `frame.paletteId` ➔ `animation.paletteId` ➔ `asset.defaultPaletteId` (Slot 0).

---

## 8. Persistência e Compatibilidade

- O arquivo de projeto (`.p2c`) armazena a estrutura canônica completa do projeto em JSON estruturado.
- **Auto-Contenção:** Imagens PNG importadas são armazenadas também como `dataUrl` em Base64 no arquivo de projeto, garantindo que o usuário possa reabrir o projeto em qualquer máquina mesmo sem os arquivos de imagem originais na mesma pasta.
- **Migração Retrocompatível (`src/core/project.ts`):** Suporte a migração automática de formatos antigos de projeto (como projetos legados sem paletas nomeadas ou com índices de paleta numéricos), garantindo que projetos salvos em versões anteriores continuem abrindo sem perda de dados.
