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
│   ├── animation-exporters.ts  # Geradores de C (cc65), Assembly (ca65), JSON v5 e CHR
│   ├── animation-mapping.ts    # Projeção de tiles OAM locais vs físicos CHR
│   ├── animation-model.ts      # Modelo de metasprites, frames e animações
│   ├── animation-palette.ts    # Resolução hierárquica de paletas de animação
│   ├── asset-identity.ts       # Identidades lógicas de assets e chaves de tiles canônicas
│   ├── asset-lifecycle.ts      # Reconciliação atômica de reimportação, geometria e overrides
│   ├── c-identifier.ts         # Normalização e sanitização de identificadores C
│   ├── chr-asset-mapping.ts    # Índice de posse, proveniência e usos bidirecionais de CHR
│   ├── chr-decoder.ts          # Decodificação de binário 2bpp para pixels
│   ├── chr-encoder.ts          # Codificação de pixels para formato planar 2bpp
│   ├── chr-pattern-table.ts    # Gerenciamento de pattern tables de 4 KiB / 8 KiB
│   ├── chr-rom.ts              # Manipulação de CHR-ROM e concatenação de base CHR
│   ├── chr-spritesheet-allocation.ts # Pipeline unificado de alocação física de CHR
│   ├── collision-encoder.ts    # Empacotamento de matriz de colisão 480 bytes
│   ├── color-distance.ts       # Métricas de distância de cores (Euclidiana e OKLab)
│   ├── color-mapping.ts        # Mapeamento para os 64 códigos PPU do NES
│   ├── frame-detection.ts      # Detecção automática de grade de frames em spritesheets
│   ├── image-analysis.ts       # Validação de dimensões e transparência de PNG
│   ├── image-quantization.ts   # Redutores de cor (Nearest, Median Cut, K-Means)
│   ├── ines-rom.ts             # Parser de cabeçalho iNES e extração de NROM
│   ├── metasprite-extraction.ts# Extração lógica de metasprites e omissão de células transparentes
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
├── ui/                         # Componentes de interface, workspaces e editores Canvas
│   ├── animation-editor.ts     # Workspace e editor de metasprites/animação
│   ├── app-shell.ts            # Estrutura base de layout (header, sidebar, hosts)
│   ├── diagnostics.ts          # Painel de métricas e diagnósticos NES
│   ├── export-panel.ts         # Painel de exportação de binários e código
│   ├── header.ts               # Barra superior de controle do projeto
│   ├── image-editing-workspace.ts # Composição de preview e editor de paleta
│   ├── image-input.ts          # Área de importação e dropzone de arquivos
│   ├── image-preview.ts        # Preview Canvas 2D com zoom, grid e colisões
│   ├── inspector.ts            # Painel lateral inspetor
│   ├── palette-editor.ts       # Editor interativo de paletas e atribuições
│   ├── playfield-workspace.ts  # Workspace composicional do modo Playfield
│   ├── quantization-panel.ts   # Painel de controle de quantização e dithering
│   ├── sidebar.ts              # Barra lateral de navegação e âncoras
│   ├── tile-grid.ts            # Grade visualizadora de tiles CHR
│   └── tileset-workspace.ts    # Workspace composicional do modo Tileset
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

1. **`StudioProject` (Persistente):** Estado canônico de criação (modo selecionado, fontes gráficas com dataUrl, definições de paleta, slots ativos, pixel overrides, mapa de colisão, animações, instâncias de cena, base CHR, regiões e reservas de CHR `chrRegions`). Qualquer alteração gera uma nova identidade de objeto e marca o projeto como não-salvo (`isDirty = true`).
2. **`WorkspaceState` (Transiente):** Estado de layout e navegação da interface (área de trabalho ativa, ferramenta ativa no preview, zoom de edição, painéis colapsados, overlays numéricos de paleta).
3. **`DerivedStatus` (Status):** Estado volátil de carregamento e diagnósticos de erro recuperáveis.

### Estrutura de Layout do AppShell

A interface é orquestrada por um `AppShell` persistente que hospeda os principais marcos de interação:

- **Project Header (`headerHost`):** Metadados do projeto, nome editável, indicador de dirty, botões de ação (Novo, Abrir, Salvar, Salvar Como) e seletor de idioma.
- **Sidebar (`sidebarHost`):** Navegação entre workspaces (Tileset, Playfield, Animação, Paletas, Memória CHR, Exportação e Diagnósticos), âncoras de seção, arquivo ativo e seletor rápido de quantização.
- **Workspace Host (`workspaceHost`):** Hospeda os editores e painéis ativos do modo de trabalho atual. O layout principal reivindica toda a largura horizontal disponível quando o inspetor não possui conteúdo contextual ativo.
- **Inspector Host (`inspectorHost`):** Região lateral complementar para propriedades contextuais. Quando vazio, não reserva coluna vazia desnecessária no desktop; quando ativo, exibe controles contextuais e botão de fechar.
- **Diagnostics/Status Host (`diagnosticsHost`):** Painel de métricas, diagnósticos NES, erros de validação e status.

### Densidade Visual e Layout Responsivo

- **Sprite Palettes:** Slots ativos dispostos em grade responsiva de 4 colunas em telas largas (2 em médias, 1 em mobile). Definições de paletas organizadas em cartões multi-coluna auto-ajustáveis.
- **Animation Preview Dedicado e Colapsável:** A pré-visualização de animações permanece fixa (`sticky`) exclusivamente dentro de sua coluna dedicada na grade do editor selecionado (sem sobrepor ou cobrir controles de edição), oferecendo alternância de recolhimento `[-]` / `[+]` armazenada em `WorkspaceState` sem marcar o projeto como dirty.
- **Ações de Exportação:** Download do CHR final em destaque com grade responsiva (3 colunas no desktop) para as exportações secundárias (.pal, .json, .h, .c, .inc, .s).

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
- **Operações Puras de Edição de Tile (`src/core/chr-tile-editor.ts`):** Módulo desacoplado e funcional contendo transformações geométricas, mutação atômica e codificação de tiles NES 8×8 (64 pixels, valores 0..3):
  - _Transformações Geométricas:_ Espelhamento horizontal (`flipTileHorizontal`), espelhamento vertical (`flipTileVertical`), deslocamentos direcionais com preenchimento ou wrap cíclico (`shiftTile`) e rotações 90° horário/anti-horário (`rotateTile90`).
  - _Preenchimento e Limpeza:_ Preenchimento por inundação 4-conectado (`floodFillTile`), limpeza para índice arbitrário (`clearTile`) e mutação pontual com verificação de limites (`setTilePixel`).
  - _Codificação e Decodificação Planar Direta:_ Conversão bidirecional entre matriz de 64 pixels e buffer planar NES de 16 bytes (`encodeChrTileFromPixels`, `decodeChrTileToPixels`).
  - _Gerenciamento Genérico de Histórico (`createTileHistory`):_ Pilha delimitada de Undo/Redo com descarte de estados duplicados consecutivos e invalidação de histórico futuro em nova ação.
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

- Criação e edição de conjuntos de animações para entidades de jogo com arquitetura desacoplada:
  - **Lista de Animações / Entidades (`#section-animations`):** Visão geral em cartões compactos exibindo entidade, nome, quantidade de frames, modo de reprodução e status de seleção, sem expandir todos os formulários simultaneamente.
  - **Editor da Animação Selecionada (`#section-animation-editor`):** Focado exclusivamente na animação ativa com abas contextuais:
    - _Frames & Timing:_ Dimensões, âncora de origem (`originX`, `originY`), fonte PNG, detecção assistida de grade, durações por frame, paleta por frame e variantes de espelhamento (H/V).
    - _Pixel Overrides:_ Editor de pixels nos tiles 8×8 da animação ativa com preservação de sobreposições manuais.
    - _Metasprite Mapping:_ Inspeção detalhada do mapeamento de metasprites e células 8×8 da animação ativa.
    - _Scene Preview (Cena Interativa):_ Subworkspace integrado (`Animation > Scene`) com tela persistente NES 256×240, lista/seleção de instâncias e inspetor contextual de propriedades (entidade, animação, coordenadas X/Y, visibilidade, duplicação, ordem e slot de paleta). O canvas mantém o pipeline visual; cartões DOM focáveis formam a alternativa semântica acessível por instância, com nomes ARIA, anúncio de posição, foco preservado nos rerenders ordinários e atalhos locais (setas para mover, `Delete` para remover e `Ctrl+↑/↓` para alterar a ordem). Arrasto usa Pointer Events e confirma uma única atualização canônica de âncora ao terminar. A ordem persistida do array define renderização e hit testing. A análise usa somente instâncias visíveis e a paleta efetiva do frame atual, deduplica IDs simultâneos e exibe um único alerta ao exceder os quatro slots SPR do NES. O contexto read-only de recursos do frame atual é projetado diretamente de `AnimationProjectModel`, `ChrAssetMappingIndex` e das definições de paleta recebidas do orquestrador; ele informa sprites, slots físicos, Pattern Tables, reúso de Base CHR e compartilhamento sem reconstruir ownership. Ações contextuais usam `WorkspaceState` para abrir a animação/frame, paleta ou seleção/filtro da CHR Memory relacionados.
  - **Sticky Preview & Sumário:** Painel lateral fixo com player interativo (Play/Pause, Passo Anterior/Próximo), alternador de variantes (Original / Flip H / Flip V), modo de cor (NES / PNG Original) e sumário de métricas da animação selecionada.
- **Detecção Assistida de Frames (`src/core/frame-detection.ts`):** Analisa a transparência, calhas (_gutters_) e dimensões da folha para sugerir a grade e a contagem resultante de frames. Apresenta nível de confiança (Alta, Média, Baixa), auto-aplicação visível e reversível em alta confiança, preservação estrita de dimensões manuais em confiança média/baixa e botão para aplicação explícita das dimensões sugeridas.
- **Reimportação, Mudança de Geometria e Reconciliação Funcional (`src/core/asset-lifecycle.ts`):**
  - _Preservação de `ProjectAssetId`:_ A identidade lógica do asset é estritamente preservada ao substituir ou recarregar um spritesheet existente, prevenindo rotatividade de IDs e quebra de referências lógicas no projeto.
  - _Reconciliação Pura de Geometria (`reconcileAnimationGeometry`):_ Trata alterações de resolução do PNG ou mudanças manuais de dimensões de frame (`frameWidth`, `frameHeight` em múltiplos de 8), recalculando o número total de células disponíveis na folha.
  - _Reconciliação de Pixel Overrides (`reconcilePixelOverridesForGeometry`):_ Preserva sobreposições manuais de pixel cujas coordenadas de célula `[tileX, tileY]` permanecem dentro dos novos limites da imagem e descarta ordenadamente overrides que caem fora da nova grade. A operação é pura, imutável e determinística.
  - _Alinhamento 1-a-1 de Sequências e Arrays Paralelos:_ Quando frames fora dos novos limites da grade são filtrados, `frameIndices`, `frameDurations`, `framePalettes` e `framePaletteIds` são reconciliados em conjunto, mantendo estrito alinhamento índice-a-índice entre durações e paletas por frame sobrevivente.
  - _Validação de Âncora NES (`isAnimationOriginValid`):_ Assegura que o ponto de origem (`originX`, `originY`) permaneça dentro dos limites de deslocamento relativo com sinal de 8 bits do hardware do NES (`-128..127`).
  - _Transação Atômica de Reimportação (`reconcileSpritesheetReimport`):_ Executa a reconstrução completa do modelo derivado (`AnimationProjectModel`) e do índice de mapeamento (`ChrAssetMappingIndex`). Em caso de falha (ex.: estouro de capacidade da Pattern Table `pattern-table-capacity-overflow`), o projeto original permanece 100% intocado, sem mutações parciais.
  - _Liberação de Tiles Físicos Obsoletos e Proteção de Reúso:_ Tiles físicos não mais referenciados pela folha atual são liberados da CHR derivada, enquanto tiles compartilhados por outros assets, faixas de CHR-Base ou Reservas de CHR permanecem protegidos.
- **Geração de Metasprites:** Cada frame selecionado é subdividido em células 8×8. Células totalmente transparentes são **omitidas**, economizando slots na OAM e respeitando o limite do hardware de 8 sprites por linha de varredura (_scanline limit_).
- **Validação de capacidade OAM por frame:** `src/core/oam-diagnostics.ts` conta cada sprite gerado como uma entrada OAM. Mais de 32 entradas gera aviso de pressão de sprite (não é limite de hardware); mais de 64 gera erro, pois excede as 64 entradas da OAM do NES.
- **Projeção de Mapeamento (`src/core/animation-mapping.ts`):** Painel que inspeciona detalhadamente o índice local OAM, índice físico CHR, paleta efetiva e atributos de cada tile de cada frame.
- **Scene Preview Multi-Entidade (`src/core/scene-preview.ts`):** Permite instanciar múltiplas entidades em uma cena 256×240 com reprodução independente para verificar alinhamentos de âncoras e paletas em contexto de jogo. A precedência de renderização e diagnóstico é `framePaletteIds[frameAtual]` sobre `animation.paletteId`; instâncias ocultas não consomem capacidade.
  - `deriveSceneInstanceResourceFacts(...)` é uma projeção pura e descartável dos modelos canônicos já construídos. Referências de animação ou paleta ausentes permanecem explícitas; nenhum dado de recurso é copiado para `scenePreview` ou serializado.
- **Projeção Lógica para OAM:** O adapter de `ProjectView` resolve `paletteId` e cada `framePaletteId` contra `activeSpriteSlots` antes de construir `AnimationProjectModel`. Assim, os bits 0–1 dos atributos OAM acompanham o slot SPR atual, enquanto os índices numéricos persistidos permanecem somente como fallback legado.

### 6.4 Workspace de Paletas do Projeto (`src/ui/palette-workspace.ts`)

- Espaço dedicado para o gerenciamento de alto nível das definições de paleta do projeto e configuração dos slots ativos de hardware:
  - **Toolbar Canônica:** Edição isolada da cor universal de Background (`$3F00`), criação de recursos lógicos e filtros transitórios (`Todas`, `Sprites`, `Backgrounds`, `Em Uso`).
  - **Bancos Físicos Independentes:** Quatro slots de Background (`$3F00..$3F0F`) e quatro slots de Sprite (`$3F10..$3F1F`), cada um com selector e preview resolvido. Background mostra a cor universal efetiva no índice 0; Sprite mostra transparência.
  - **Biblioteca de Paletas Reutilizáveis:** Grade responsiva sem limite artificial de quatro itens, com criação, renomeação por Enter/blur, cancelamento por Escape, edição das quatro cores armazenadas via seletor mestre, classificação de target, duplicação sem copiar slots e exclusão segura.
  - **Inspetor de Uso e Diagnósticos:** A seleção transitória exibe ID estável, target, posições nos bancos, referências de uso estruturadas e fatos filtrados de `analyzeProjectPaletteDiagnostics`, com scroll próprio para listas extensas.
  - **Política de Exclusão:** Definições sem uso podem ser confirmadas e removidas; definições referenciadas são bloqueadas com a lista de impactos. O dispatcher revalida os usos e nunca executa cascade delete silencioso.
  - **Atribuições Contextuais Preservadas:** A seleção de paletas por frame ou animação, o pincel de subpaletas em tiles/metatiles e a edição de pixel overrides permanecem estritamente contextuais nos seus respectivos editores (Tileset, Playfield e Animação).
  - **Estado e Callbacks:** `selectedPaletteId` e filtro vivem em `WorkspaceState`; mutações passam por callbacks do dispatcher e escrevem somente em `palettes`, `universalBackgroundColor`, `activeBackgroundSlots` ou `activeSpriteSlots`. O `paletteSet` legado não é source of truth nem recebe dual write.
  - **Acessibilidade e Foco:** Controles nativos, labels e estados ARIA descrevem slots, filtros, targets e códigos NES; dialogs restauram foco ao trigger e criação/duplicação focam o nome da nova definição.
  - **Exportação de Paleta:** O painel e o workspace de entrega derivam do estado dual-bank canônico os binários `.pal` de Background e Sprite de 16 bytes, o arquivo PPU completo de 32 bytes e as tabelas cc65 C e ca65 Assembly.

### 6.5 Workspace de Memória CHR e Tabelas de Padrões (`src/ui/chr-workspace.ts`)

- Espaço visual e projetado de inspeção do modelo canônico de memória CHR-ROM (8 KiB / 512 slots de tiles):
  - **Visualização Completa das Pattern Tables (PT0 e PT1):** Renderização pixel-perfect das duas tabelas de padrões em grades 16×16 de 256 tiles cada (PT0: `$0000..$0FFF`, índices físicos 0..255; PT1: `$1000..$1FFF`, índices físicos 256..511), totalizando os 512 slots da CHR-ROM física.
  - **Visualização Multi-Modal de Ocupação de Slots (`classifyChrSlots`):** Classificação e identificação visual determinística de todos os 512 slots físicos em três estados fundamentais (e extensibilidade para slots reservados):
    - _Livre / Não alocado (`empty`):_ Espaço livre disponível na CHR-ROM. Representado por borda tracejada sutil, padrão matricial texturizado de fundo e marcador neutro.
    - _Tile do Projeto (`project`):_ Gráficos gerados ou importados para o projeto atual (deduplicados em Tileset/Playfield ou referenciados por frames no modo Animação). Representado por borda sólida, indicador sutil no canto superior e tooltip/ARIA com atribuição do asset.
    - _CHR-Base (`base`):_ Tiles importados de uma CHR-base de destino. Representado por borda âmbar e indicador específico.
    - _Reservado (`reserved`):_ Modelo de domínio e persistência formalizado via `ChrRegion` (`kind: 'reservation'`). Bloqueia novas alocações automáticas de tiles em todos os fluxos (`buildAnimationProjectModel`, `composeChrWithAllocatedTiles`), preservando tiles físicos existentes e permitindo reúso/referência por deduplicação de conteúdo real já presente na faixa reservada (conforme especificado em [`docs/investigations/chr-regions-reservations.md`](./investigations/chr-regions-reservations.md)).
  - **Diagnósticos de Conflitos e Capacidade de CHR Regions & Reservations (`analyzeChrRegionDiagnostics` em `src/core/chr-pattern-table.ts`):**
    - _Separação Arquitetural Domínio vs. Apresentação:_ Análise pura e determinística em `core/` sem dependências do DOM, emitindo fatos estruturados (`ChrRegionDiagnosticFact`) com severidades (`error`, `warning`, `info`) e identificadores estáveis e ordenados.
    - _Diagnósticos de Sobreposição (Overlaps):_
      - _Região + Região (`region-region`):_ Alerta de sobreposição organizacional (`warning`) identificando ambas as regiões, a Pattern Table e o intervalo em notação hexadecimal canônica (ex.: `PT0:$20-$2F`).
      - _Reserva + Reserva (`reservation-reservation`):_ Alerta de reserva redundante (`warning`) indicando faixas de bloqueio duplicadas na mesma Pattern Table.
      - _Região + Reserva (`region-reservation`):_ Mensagem informativa descritiva (`info`) quando uma região organizacional engloba ou intercepta uma reserva técnica de runtime.
      - _Normalização e IDs Estáveis:_ Geração determinística de IDs ordenados (`chr-region-overlap:${idA}:${idB}`), prevenindo duplicatas e flicker na renderização da interface.
    - _Conteúdo Existente dentro de Reservas (`reservation-contains-occupied`):_
      - Quando uma reserva cobre slots contendo CHR-Base ou tiles de projeto (`occupied != reserved`), emite aviso (`warning`) com agregação de contagem e faixas exatas (ex.: `A reserva "Runtime FX" contém 8 tiles existentes em PT0:$20-$27. Os tiles existentes são preservados; a reserva apenas bloqueia novas alocações.`).
    - _Cálculo de Capacidade de Pattern Table e Prevenção de Contagem Dupla:_
      - Fórmula canônica: `availableSlots = 256 - totalOccupiedTiles - totalReservedEmptyTiles`.
      - Slots ocupados dentro de reservas contam sob `totalOccupiedTiles` e **nunca** sob `totalReservedEmptyTiles`, garantindo a soma exata de 256 slots por tabela sem contagem dupla.
      - _Esgotamento de Tabela (`pattern-table-exhausted`):_ Quando `availableSlots === 0`, gera diagnóstico crítico (`error`).
      - _Baixa Capacidade (`pattern-table-low-capacity`):_ Quando `availableSlots <= CHR_LOW_CAPACITY_THRESHOLD` (constante 8 slots), gera aviso de baixa capacidade (`warning`).
    - _Capacidade de Região Organizacional (`region-full`):_
      - Notificação descritiva (`info`) quando uma região preenche toda a sua extensão (`occupiedTiles === totalTiles`), sem pressupor bloqueio na alocação global da tabela.
    - _Neutralidade Absoluta:_ Quando `chrRegions` é vazio ou não possui conflitos, nenhum diagnóstico espúrio é emitido.
    - _Integração na Entrega (`src/ui/delivery-workspace.ts`):_ Fatos de diagnóstico são convertidos em itens da lista de prontidão (`delivery-diag-item`) com links diretos de navegação para a Memória CHR (`deliveryLinkChr`).
    - _Visualização na Memória CHR e Inspetor Contextual (`src/ui/chr-workspace.ts` e `src/ui/chr-tile-inspector.ts`):_
      - _Separação entre Ocupação e Pertencimento a Regiões/Reservas:_ A ocupação de dados (`empty`, `project`, `base`, `reserved`) é mantida como camada primária, enquanto o pertencimento a uma Região organizacional (`in-region`, tarja superior de acento) ou Reserva técnica (`in-reservation`, indicador de reserva) é renderizado como camada secundária e não-destrutiva sobre a arte gráfica 2bpp.
      - _Textura Diagonal de Reservas:_ Slots vazios dentro de reservas (`is-occupancy-reserved`) utilizam padrão diagonal em hatch roxo (`repeating-linear-gradient`), distinguindo-os claramente de slots livres comuns (`empty`).
      - _Preservação de Conteúdo Existente em Reservas:_ Tiles de CHR-Base ou Projeto que caiam dentro de uma faixa de reserva preservam integralmente sua ocupação (`base` ou `project`), recebendo marcação de reserva (`in-reservation`, `data-in-reservation="true"`) sem perder sua identidade de dados.
      - _Inspetor Read-Only Contextual:_ Ao selecionar qualquer tile (0..511), o inspetor detalha:
        - Estado de ocupação e atribuição de origem;
        - Regiões organizacionais que cobrem o slot (nome, faixa local `$XX-$YY` e amostra de cor customizada caso configurada);
        - Reservas técnicas que cobrem o slot (nome e faixa local `$XX-$YY`);
        - Suporte total a sobreposições (múltiplas regiões/reservas por slot).
      - _Acessibilidade e Navegação por Teclado:_ Overlays decorativos possuem `pointer-events: none` e não introduzem pontos de parada de tabulação (Tab stops) adicionais. As diretivas `aria-label` e tooltips agregam os nomes de regiões e reservas de forma concisa e acessível. Suporte a `@media (forced-colors: active)` através de contornos e bordas semânticas do sistema.
  - **Distinção Semântica Fundamental (Tiles Deliberadamente em Branco):** O estado de ocupação é derivado estritamente dos metadados canônicos de alocação da fonte gráfica, e **nunca** apenas por checar se os 16 bytes do tile são todos zero. Um tile deliberadamente transparente ou todo em cor 0 que pertença à lista de tiles do projeto é corretamente classificado como `Tile do Projeto`, enquanto slots não alocados no restante do espaço de 8 KiB são classificados como `Livre`.
  - **Recursos Visuais Multi-Modais e Acessibilidade:** O visualizador não depende exclusivamente de cor para transmitir o estado dos slots: utiliza bordas diferenciadas (tracejada vs. sólida), indicadores de canto, texturas sutis de fundo, legenda de ocupação na barra de ferramentas (`.chr-occupancy-legend`), atributos `data-occupancy`, `aria-label` descritivos e tooltips informativos. A arte gráfica dos tiles 2bpp permanece 100% legível por baixo das demarcações.
  - **Destaque Contextual de Uso de CHR (CHR Usage Highlighting):** Permite inspecionar diretamente quais slots físicos da CHR-ROM pertencem a um determinado escopo de uso sem alterar dados nem forçar re-exportação (`src/core/chr-pattern-table.ts`):
    - _Mapeamento Canônico Físico:_ Opera estritamente com base na identidade física do tile na CHR-ROM (`0..511`). Sprites de metasprite apontam para o índice físico canônico, e variantes espelhadas (H/V) ou reusadas no mesmo frame/animação convergem deterministamente para o mesmo slot único de CHR destacado.
    - _Escopos Suportados (`ChrHighlightScope`):_
      - `none`: Nenhum destaque ativo (exibição padrão de ocupação).
      - `frame`: Destaca todos os tiles físicos únicos consumidos pelo frame atualmente selecionado no Editor de Animação.
      - `animation`: Destaca a união dos tiles físicos utilizados em todos os frames da animação ativa.
      - `entity`: Destaca a união dos tiles físicos utilizados por todas as animações associadas à mesma entidade (ex.: `Hero_walk`, `Hero_attack`, etc.).
      - `base`: Destaca todos os slots preservados da CHR-Base importada.
      - `all`: Destaca todos os tiles do projeto atual alocados na CHR-ROM.
    - _Tratamento Visual e Hierarquia Estrita:_ Quando o destaque está ativo, a grade recebe a classe `.has-highlight`. Os slots fora do escopo recebem atenuação visual (`.is-dimmed`, opacidade 35%), enquanto os slots correspondentes recebem realce em ciano com contorno nítido e glow (`.is-highlighted`). A seleção interativa (`.is-selected`) e o foco de teclado mantêm dominância absoluta com contraste total (`foco/seleção > destaque de uso > marcador de ocupação > arte gráfica`).
    - _Sumário em Tempo Real e Integração com Inspetor:_ A barra de ferramentas exibe a contagem de tiles destacados com discriminação por tabela (`{count} tiles (PT0: {pt0} · PT1: {pt1})`), e o Inspetor de Tile exibe um badge contextual informando o escopo ativo quando o tile selecionado faz parte do conjunto destacado.
    - _Estado Transiente:_ O escopo de destaque é mantido exclusivamente em `WorkspaceState.chr.highlightScope` (`marksProjectDirty: false`), não alterando arquivos do projeto `.p2c` nem o estado de exportação.
  - **Mapa de Calor de Uso e Diagnósticos de Reúso (CHR Usage Heatmap & Reuse Diagnostics):** Modo analítico avançado para inspecionar a frequência de referências lógicas e a eficiência de compactação de cada slot da CHR-ROM (`src/core/chr-pattern-table.ts`):
    - _Distinção Fundamental (Ocupação Física vs. Contagem Lógica de Referências):_ A alocação de slots na CHR física é binária (cada slot ocupa exatamente 16 bytes na CHR-ROM), enquanto o reúso de tiles é a contagem lógica agregada de quantas vezes aquele padrão de 8×8 é referenciado ao longo de frames, metasprites, instâncias espelhadas (H/V), nametables de playfield e tilesets.
    - _Faixas Discretas de Intensidade (`ChrHeatmapBucket`):_
      - `unused` (0 referências): Não referenciado no projeto ativo.
      - `single` (1 referência): Referência única (sem reúso).
      - `moderate` (2–3 referências): Reúso moderado.
      - `high` (4–7 referências): Alto reúso.
      - `very-high` (8+ referências): Reúso intensivo / tile chave.
    - _Acessibilidade Multi-Modal:_ A interface não depende apenas de tons de cor. Cada slot com referências recebe um badge numérico no canto inferior direito (`.chr-slot-ref-badge`), tooltips contextuais com contagem exata e atributos `aria-label` acessíveis para leitores de tela.
    - _Terminologia Neutra e Não-Preconceituosa:_ Um slot ocupado que não possui referências lógicas conhecidas no projeto ativo (ex.: tiles pertencentes a uma CHR-base importada ou tiles mantidos na tabela para carregamento dinâmico) é diagnosticado de forma descritiva e neutra (`Ocupado · sem referências conhecidas no projeto` / `CHR-Base · 0 referências conhecidas no projeto`), sem suposições errôneas de erro.
    - _Barra de Métricas e Sumário Global:_ Quando o modo Heatmap está ativado, uma barra informativa exibe métricas agregadas do projeto: total de referências lógicas, tiles referenciados, tiles reutilizados (≥2 refs), tiles ocupados sem referências diretas, tile mais referenciado e taxa média de reúso.
    - _Diagnósticos Estruturados no Inspetor de Tile:_ Exibe métricas detalhadas com chips contextuais de dispersão de uso: total de referências lógicas, frames distintos, animações distintas, entidades distintas e recursos distintos (Animação, Playfield, Tileset).
    - _Preservação de Estado Transiente:_ A ativação do Heatmap é gerenciada via `WorkspaceState.chr.heatmapEnabled` sem sujar o projeto (`marksProjectDirty: false`).
  - **Dominância Visual da Seleção e Foco:** O foco do teclado (`:focus-visible`) e a seleção (`.is-selected`) possuem precedência e contraste visual superior sobre as demarcações de ocupação e mapa de calor, garantindo foco inequívoco (`foco do teclado > seleção > destaque de escopo > mapa de calor > marcador de ocupação > arte do tile`).
  - **Navegação Acessível por Teclado e Roving Tabindex:** O grid de 16×16 de cada Pattern Table implementa o padrão acessível de _roving tabindex_ (`role="grid"` e `role="gridcell"` com contagem de linhas e colunas), mantendo apenas uma célula focável (`tabindex="0"`) na sequência de Tab e as demais em `tabindex="-1"`. Suporta navegação bidimensional fluida por teclado via Setas (Cima, Baixo, Esquerda, Direita com wrap), Home/End (início/fim da linha ou tabela com Ctrl), PageUp/PageDown (topo/base da coluna), Enter/Espaço para selecionar e Escape para desmarcar.
  - **Layout Responsivo e Scroll Seguro no Visualizador CHR:** A área de visualização das Pattern Tables (`.chr-pt-canvas-wrapper`) utiliza contenção flexível e rolagem independente 2D segura, garantindo que em qualquer nível de ampliação (1×, 2×, 3× e 4×) todas as 16 colunas ($00..$0F) e 16 linhas permaneçam 100% visíveis e acessíveis via scroll sem estouro de página ou corte de coordenadas negativas.
  - **Agrupamento Semântico no Toolbar:** Os controles do visualizador são particionados em grupos semânticos (`.chr-toolbar-group.is-view-group` para zoom, paleta e heatmap; `.chr-toolbar-group.is-context-group` para escopo de destaque e legenda), garantindo quebra responsiva limpa sem sobreposição de rótulos. Suporte nativo a `prefers-reduced-motion` desativa transições visuais para usuários sensíveis a movimento.
  - **Sumários e Métricas de Utilização das Tabelas:** Cada cartão de Pattern Table (PT0 e PT1) exibe badge de contagem (`{ocupados} / 256`) e subtítulo com utilização e slots livres (`Faixa PPU $0000..$0FFF · 256 tiles (4 KiB) · {ocupados} / 256 ocupados ({livres} livres)`), complementando o sumário de ocupação global da ROM de 8 KiB (`{total} / 512 tiles ({percent}%)`).
  - **Pré-visualização Consciente de Paletas (Palette-Aware Preview):** Modo de visualização configurável no toolbar do viewer permitindo inspecionar as Pattern Tables em escala de cinza neutra (`grayscale`) ou interpretadas através de qualquer subpaleta ativa do projeto:
    - _Subpaletas de Background (BG 0..3):_ Mapeamento 2bpp derivado de `palettes + activeBackgroundSlots`, via paleta master NES (`NES_MASTER_PALETTE`), forçando `universalBackgroundColor` (`$3F00`) no índice 0.
    - _Subpaletas de Sprite (SPR 0..3):_ Mapeamento derivado de `palettes + activeSpriteSlots`; o índice 0 é transparente e usa checkerboard. O seletor contém exatamente escala de cinza + quatro BG + quatro SPR, sem expor definições soltas como modos físicos.
    - _Contexto no Inspetor:_ O Tile Inspector mostra banco/slot, nome e ID lógico, quatro códigos NES, RGB exato e o estado assigned/empty/dangling da paleta de preview.
    - _Modo Estritamente Visual:_ A seleção de paleta no CHR Viewer é mantida de forma transiente em `WorkspaceState.chr.previewPalette` (`marksProjectDirty: false`), não alterando bytes da CHR, dados de paleta persistidos, atribuições de animação ou artefatos exportados.
  - **Controles de Zoom Pixel-Perfect:** Controles de ampliação (1×, 2×, 3×, 4×) com renderização nearest-neighbor (`image-rendering: pixelated`), gerenciados como estado transiente em `WorkspaceState` sem mutação do projeto.
  - **Gerenciador de Regiões e Reservas de CHR (`src/ui/chr-region-manager.ts`):** Seção integrada ao workspace de Memória CHR permitindo listar, criar, editar e excluir objetos `ChrRegion` (do tipo organizacional `region` ou restritivo `reservation`).
    - _Entrada Hexadecimal Amigável com Espelho Decimal:_ Campos de tile inicial e final aceitam `$00..$FF` (case-insensitive com prefixos `$`, `0x` ou diretos) com conversão síncrona para espelho decimal (`($00) -> 0`).
    - _Validação em Tempo Real e Diagnósticos Não-Bloqueantes:_ Avisos de sobreposição e notificações de reservas sobre tiles existentes informam o usuário sem impedir o salvamento de configurações válidas no domínio.
    - _Ordenação Determinística e Gerenciamento de Foco:_ Listagem ordenada por Pattern Table (PT0/PT1) e índice inicial com restauração precisa de foco após criação, edição, cancelamento e exclusão.
  - **Seleção Interativa e Inspetor de Tile (`src/ui/chr-tile-inspector.ts`):** Seleção interativa de qualquer slot 8×8 em PT0 e PT1 via mouse/touch ou teclado (Enter, Espaço, Setas e Escape para desmarcar) com destaque visual acessível e de alto contraste (outline duplo, borda interna de contraste, marcador e `aria-selected`). O preview ampliado de 16× (128×128 px) do tile selecionado sincroniza imediatamente com a paleta de visualização ativa no CHR Viewer.
  - **Metadados de Endereçamento de Hardware da PPU:** Painel contextual com cálculo determinístico e em tempo real de:
    - _Índice Físico Global:_ Decimal 0..511 e Hexadecimal `$000..$1FF`.
    - _Índice Local na Tabela:_ Decimal 0..255 e Hexadecimal `$00..$FF`.
    - _Identificador da Tabela:_ `PT0 ($0000)` ou `PT1 ($1000)`.
    - _Coordenadas na Tabela 16×16:_ Coluna 0..15 e Linha 0..15.
    - _Offsets de Bytes na CHR-ROM:_ Offset inicial do tile na ROM (`$0000..$1FF0`, fórmula `physicalIndex * 16`), Offset do Bitplane 0 (`+0`) e Offset do Bitplane 1 (`+8`, fórmula `physicalIndex * 16 + 8`).
    - _Diagnóstico de Estado do Slot:_ Identificação visual precisa entre `Vazio (Não alocado)`, `Tile do Projeto (Ocupado)` e `CHR-Base (Importada)`.
    - _Atribuição de Origem:_ Rastreamento do asset, animação e frame de origem associados ao tile físico no modelo de animação ou metadados de tileset.
    - _Consulta Reversa de Uso ("Usado por" / "Used by"):_ Lista exaustiva e dinâmica de todas as referências lógicas do projeto associadas ao tile físico selecionado (`collectPhysicalTileReferences` em `src/core/chr-pattern-table.ts`), categorizadas com badges por tipo:
      - _Animação:_ Nome da entidade, nome da animação, índice do frame, índice do sprite, coordenadas locais `(x, y)` e flags de espelhamento (`Flip H`, `Flip V`).
      - _Playfield:_ Coordenadas na nametable `(col, row)` e índice local do tile `$XX`.
      - _Tileset:_ Identificador e índice do tile no conjunto extraído/deduplicado.
      - _Tratamento de Volume e Truncamento:_ Agrupamento compacto, limitação de altura máxima com scroll suave (`max-height: 22rem`) e botão expansível ("Mostrar todas (N)" / "Mostrar menos") com atributo `aria-expanded` para prevenir sobrecarga de layout.
      - _Ação de Salto Direto para Origem ("Ir para origem"):_ Cada referência lógica possui botão interativo acessível que navega imediatamente para o workspace de origem (selecionando a animação e o frame exato no Editor de Animação, a célula no Playfield ou o tile no Tileset), de forma puramente transiente via `WorkspaceState`.
  - **Ações Contextuais de Inspeção nos Workspaces de Origem ("Inspecionar na CHR"):** Botões contextuais nos cartões de tiles (Modo Tileset/Playfield) e nas células de mapeamento de metasprites (Modo Animação) que direcionam o usuário diretamente para o CHR Viewer com o tile físico `0..511` selecionado, foco imediato no slot correspondente, rolagem automática suave para visibilidade e preservação dos níveis de zoom e paletas ativas.
  - **Pré-visualização Ampliada e Editor de Tile 8×8 (`src/ui/chr-tile-editor.ts`):** Exibição ampliada dos 64 pixels do tile com renderização 2bpp nítida e sobreposição opcional da grade de pixels 8×8 com controle liga/desliga. Oferece um componente controlado e interativo de edição local de pixels:
    - _Ferramentas de Desenho:_ Lápis (`pencil`) com suporte a traço contínuo via drag e captura de ponteiro (`setPointerCapture`), Borracha (`eraser`) para escrita rápida do índice `0`, Conta-gotas (`eyedropper`) para captura do índice de cor do pixel clicado e Preenchimento (`fill`) por inundação 4-conectado via `floodFillTile`.
    - _Transformações Geométricas:_ Espelhamento horizontal (`flipTileHorizontal`), espelhamento vertical (`flipTileVertical`), rotação de 90° no sentido horário e anti-horário (`rotateTile90`), produzindo mutações atômicas e imutáveis sobre o buffer de 64 pixels.
    - _Deslocamento Direcional (Shift & Wrap):_ Deslocamento de 1 pixel em qualquer uma das 4 direções (`shiftTile` com 'up', 'down', 'left', 'right'), com suporte a alternador de modo envolvente (Wrap Shift) que circula os pixels para a extremidade oposta ou preenche com índice 0.
    - _Ações do Tile e Área de Transferência (Clipboard):_ Limpeza completa do tile (`clearTile`), cópia defensiva dos 64 índices de cores para o armazenamento interno de clipboard (`copyTileToClipboard`) e colagem atômica independente (`pasteTileFromClipboard`), permitindo transferir tiles entre instâncias sem acoplamento ao ciclo de vida do componente.
    - _Histórico Atômico de Desfazer e Refazer (Undo/Redo):_ Gerenciamento de histórico de 50 níveis baseado em `createTileHistory`. Durante traços contínuos de Pencil e Eraser (`pointerdown → pointermove`), o canvas local é renderizado de forma imediata e síncrona sem disparar reconstruções globais do DOM, e no término do stroke (`pointerup` ou `pointercancel`) é efetuado exatamente 1 registro no histórico e 1 commit canônico ao host, garantindo atomicidade estrita, preservação ininterrupta da captura de ponteiro e disponibilidade imediata de Undo.
    - _Atalhos de Teclado e Escopo de Foco:_ Atalhos integrados para Desfazer (`Ctrl+Z` / `Cmd+Z`), Refazer (`Ctrl+Y` / `Ctrl+Shift+Z` / `Cmd+Shift+Z`), ferramentas (`P` para Pencil, `E` para Eraser, `I` para Eyedropper, `F` para Flood Fill), índices de cores (`0`, `1`, `2`, `3`), cópia/colagem contextual (`Ctrl+C`, `Ctrl+V`) e limpeza (`Delete` / `Backspace`). O listener pertence ao contêiner do editor, não ao `window`; portanto, atalhos só são tratados quando o foco está dentro do editor. `isEditableElement` mantém uma defesa adicional para `<input>`, `<textarea>`, `<select>` e `contenteditable`.
    - _Navegação de Controles:_ Ferramentas, índices de cor, transformações, shifts e ações usam roving tabindex com setas e `Home`/`End`. O seletor de índices usa semântica `radiogroup`/`radio`, e as setas movem foco e seleção. Canvas, controles e região do editor possuem foco visível, inclusive em forced-colors.
    - _Seletor de Índice de Cor:_ Seletor de botões de rádio para os 4 índices planares da subpaleta NES (`0`, `1`, `2`, `3`), renderizados com as cores RGB da paleta de visualização ativa sem alterar os bytes do tile. Ferramenta, cor, Grid e Wrap vivem em `WorkspaceState`, evitando reset durante re-renderizações canônicas.
    - _Barra de Status de Coordenadas:_ Exibição em tempo real das coordenadas de hover `X: 0..7, Y: 0..7` no grid matricial.
  - **Integração do Editor ao Projeto e Fonte Única de Verdade (`src/core/chr-project-integration.ts`):** A edição de qualquer tile no CHR Viewer atualiza a fonte canônica correspondente sem buffers intermediários paralelos:
    - _Matriz de Origem do Tile:_
      - _Tile de Animação:_ Mapeado reversamente para a spritesheet de origem através da animação e frame referenciados (`(tileX, tileY)`), gravando as alterações em `animation.pixelOverrides` (`Record<string, SingleTileOverrides>`) persistidas no `.p2c.json`. Repercute instantaneamente nos previews de animação, strip de frames e Pattern Tables.
      - _Tile de Tileset / Playfield:_ Gravado diretamente em `project.pixelOverrides` (matriz de sobreposição sobre a imagem indexada), re-extraindo a lista deduplicada de tiles e atualizando nametables e grids.
      - _CHR-Base (PT0 / PT1):_ Grava exatamente os 16 bytes planares (`encodeChrTileFromPixels`) no offset correspondente em `destinationChr`, preservando os demais bytes da ROM inalterados.
      - _Slot Vazio (Materialização):_ Ao desenhar em um slot previamente livre (`occupancy: empty`), o tile é materializado em `destinationChr`. Caso a Base CHR não exista ou seja de 4 KiB em PT0 e a edição ocorra em PT1 (índices 256..511), o buffer é expandido para 8 KiB de forma transparente, preservando PT0 e atualizando as métricas de ocupação em tempo real.
    - _Desfazer/Refazer com Escopo e Persistência Reais:_ O histórico atua diretamente sobre o estado canônico do projeto. As instâncias de histórico são mantidas no host pela chave `${project.mode}:${physicalIndex}`, sobrevivendo a re-renderizações e ao retorno a um tile já visitado no mesmo projeto/modo. O mapa é limitado aos 512 slots físicos e limpo ao criar/carregar projeto ou trocar de modo; o histórico não é serializado no `.p2c.json`.
  - **Ocupação Física Total e Isolamento de Tabelas:** Exibe o total ocupado (`Total = PT0 + PT1`), detalhando a ocupação física das tabelas PT0 ($0000..$0FFF, 4 KiB, 256 tiles) e PT1 ($1000..$1FFF, 4 KiB, 256 tiles).
  - **Diferenciação Hardware (Índice Físico vs. Índice Local OAM):** Esclarece a distinção entre a posição física na ROM (0..511) e o índice de 8 bits gravado na OAM (0..255), determinado pelo registrador PPUCTRL (`$2000` bit 3).
  - **Capacidade Local de Sprites:** Exibe a capacidade da tabela de padrões ativa de sprites (256 tiles) e a contagem de tiles restantes para entidades.
  - **Detalhamento de Reúso e CHR-Base:** Discrimina tiles mantidos de CHR-base (4 KiB / 8 KiB / esparsos), tiles reutilizados por deduplicação/espelhamento e novos tiles alocados.
  - **Estado Transiente Isolado:** A seleção de tiles, zoom, paleta de preview e contexto de navegação cruzada são preservados exclusivamente em `WorkspaceState` via `applyWorkspaceUpdate` sem marcar o projeto como modificado (`dirty: false`).
  - **Links e Ações:** Acesso direto para download da CHR de 8 KiB (`.chr`) e atalhos de navegação para o Mapeamento de Metasprites, Editor de Animação e Workspace de Paletas.

### 6.6 Workspace de Entrega e Exportação (`src/ui/delivery-workspace.ts`)

- Hub consolidado de validação de prontidão, diagnósticos de domínio e geração de artefatos de produção para todos os modos (Tileset, Playfield e Animação):
  - **Prontidão do Projeto & Diagnósticos:** Avaliação visual unificada do status de exportação (`Pronto para Produção`, `Pronto com Avisos`, `Ação Necessária`), integrando diagnósticos de dimensões, redução de cores, saturação de tabelas de padrões, slots de paleta não configurados e inconsistências de animação sem duplicar regras do hardware NES.
  - **Links Diretos para Correção:** Cada diagnóstico ou aviso oferece atalho direto de navegação para o workspace correspondente (Tileset, Playfield, Animação, Paletas ou Memória CHR).
  - **Artefatos de Produção Binários e Código-Fonte:** Disponibilização centralizada e consistente de todos os arquivos exportáveis mantendo 100% de compatibilidade byte-a-byte:
    - _Tileset:_ CHR de 8 KiB (`.chr`) e paleta binária (`.pal`).
    - _Playfield:_ CHR de 8 KiB (`.chr`), paleta (`.pal`), Nametable (`.nam`), Attribute Table (`.atr`) e Mapa de Colisões (`.col`).
    - _Animação:_ CHR de 8 KiB (`.chr`), paletas (`.pal`), metadados JSON (`.json`), cabeçalho e fonte C cc65 (`.h` / `.c`) e includes/fontes Assembly ca65 (`.inc` / `.s`).

---

## 7. Sistema de Paletas

O gerenciamento de paletas no Studio replica com fidelidade a arquitetura de cores da PPU do NES:

- **Paleta Master do NES:** Matriz fixa de 64 cores do NES (`$00` a `$3F`).
- **Paletas de Background vs Sprites:** Quatro subpaletas de 4 cores para background e quatro para sprites.
- **Cor Universal de Fundo:** O índice 0 de todas as paletas é compartilhado globalmente (espelhado na PPU em `$3F00`), preenchendo o fundo de telas e previews.
- **Gerenciador de Paletas do Projeto (`src/core/palette-manager.ts`):** Mantém definições nomeadas independentes e resolve os quatro slots canônicos de Background (`activeBackgroundSlots`) e Sprite (`activeSpriteSlots`) sem confundir ID lógico com posição física.
- **Pré-visualização Dinâmica no CHR Viewer:** O visualizador de Pattern Tables mapeia dinamicamente os valores de 2bpp `0..3` das tabelas PT0 e PT1 para as 4 cores de qualquer subpaleta de cenário ou sprite selecionada pelo usuário, com fallback seguro para escala de cinza neutra.
- **Hierarquia de Resolução:** A paleta de um sprite é determinada na seguinte ordem de precedência:
  `frame.paletteId` ➔ `animation.paletteId` ➔ `asset.defaultPaletteId` (Slot 0).

---

## 8. Persistência e Compatibilidade

- O arquivo de projeto (`.p2c`) armazena a estrutura canônica completa do projeto em JSON estruturado.
- **Auto-Contenção:** Imagens PNG importadas são armazenadas também como `dataUrl` em Base64 no arquivo de projeto, garantindo que o usuário possa reabrir o projeto em qualquer máquina mesmo sem os arquivos de imagem originais na mesma pasta.
- **Migração Retrocompatível (`src/core/project.ts`):** Suporte a migração automática de formatos antigos de projeto (como projetos legados sem paletas nomeadas ou com índices de paleta numéricos), garantindo que projetos salvos em versões anteriores continuem abrindo sem perda de dados.

---

## 9. Posse de Tiles, Identidade de Assets e Mapeamento Bidirecional (Milestone 6)

A Milestone 6 consolida o modelo arquitetural de **Identidade de Assets**, **Posse de Tiles (Ownership)** e **Mapeamento Bidirecional (Asset-to-CHR Mapping)** implementado em `src/core/chr-asset-mapping.ts`.

### 9.1 Distinção Fundamental: Origem (Ownership) versus Uso (Usage)

No hardware do NES, onde 256 slots por Pattern Table exigem deduplicação intensiva:

- **Origem / Proveniência (`PhysicalTileOrigin`):** Cada slot físico (0..511) possui no máximo uma única origem primária que descreve qual asset e coordenada lógica gerou o padrão (`primaryAssetId`, `logicalKey`, `creationKind: 'extracted' | 'base-chr' | 'manual-materialized'`).
- **Usos / Referências (`PhysicalTileUsage`):** Coleção estruturada de todos os consumidores ativos daquele slot físico (sprites de frames de animação, células de nametable do playfield ou entradas do catálogo de tileset).

### 9.2 Semântica de Compartilhamento (`isShared`) e Deduplicação

- **Compartilhamento Derivado:** `isShared` é verdadeiro quando `usageCount > 1` (múltiplas referências lógicas distintas apontam para o mesmo slot físico). Não é persistido no `.p2c`.
- **Deduplicação Interna (Same-Asset):** Múltiplos tiles lógicos do mesmo asset (`asset-hero:0:0` e `asset-hero:4:1`) com pixels idênticos reutilizam o mesmo slot físico, preservando ambas as referências de uso.
- **Deduplicação Cruzada (Cross-Asset):** Dois assets distintos (`asset-hero` e `asset-enemy`) que compartilham um padrão idêntico apontam para o mesmo slot físico. A origem primária permanece com o primeiro alocador, e ambos figuram em `usages`.
- **Deduplicação Flip-Aware:** Reúso por espelhamento horizontal ou vertical preserva os metadados de flip no `AnimationTileUsage` sem duplicar alocações nem alterar a origem.

### 9.3 Proveniência de Base CHR

- Slots ocupados da Base CHR (com bytes diferentes de zero) recebem origem do tipo `'base-chr'` vinculada ao asset de Base CHR (`asset-base-chr`).
- Slots preenchidos com zero (livres) na Base CHR **não** recebem origem de Base CHR.
- Quando o projeto reutiliza um tile da Base CHR por deduplicação, a origem permanece como Base CHR e o consumidor é registrado em `usages`.

### 9.4 Índice Derivado e Não-Persistido (`ChrAssetMappingIndex`)

- Construído pela função pura e determinística `buildChrAssetMappingIndex(...)`.
- Cobre exaustivamente os 512 slots físicos (PT0: 0..255 e PT1: 256..511).
- Fornece lookup reverso O(1) através de `physicalIndicesByAsset` (todos os slots físicos associados a um `ProjectAssetId` como origem ou consumidor).
- **Sem Persistência:** O índice é inteiramente recalculável sob demanda a partir do estado canônico do projeto (`StudioProject`). Nenhuma tabela de atribuição física é serializada no `.p2c`.

### 9.5 Reconciliação do Ciclo de Vida de Assets (`src/core/asset-lifecycle.ts`)

A reconciliação do ciclo de vida trata de mutações temporais nos assets do projeto (adição, substituição, remoção, alteração de dimensões e edições manuais):

- **Substituição de Asset (`planAssetReplacement`):**
  - O `ProjectAssetId` estável é rigorosamente preservado (a substituição de PNG ou arquivo-fonte não é tratada como exclusão + adição).
  - Se o novo arquivo for graficamente idêntico ou contiver padrões inalterados, as alocações físicas úteis e compartilhamentos são preservados, evitando churn de CHR.
  - Tiles físicos exclusivos tornados obsoletos pelo novo PNG são liberados para reciclagem.
  - _Pixel Overrides:_ Overrides manuais com coordenadas lógicas fora das novas dimensões são limpos deterministicamente (`reconcilePixelOverridesForGeometry`), enquanto overrides em coordenadas válidas são preservados.
- **Remoção de Asset (`planAssetRemoval`):**
  - Remover um asset exclui todas as suas ocorrências em `usages`.
  - Se o asset removido for a origem primária de um slot compartilhado que ainda possui outros consumidores ativos, a posse da origem é transferida deterministicamente para o primeiro consumidor sobrevivente (`transferredOrigins`).
  - Slots físicos que eram exclusivos do asset removido e sem outros consumidores são liberados para alocação.
  - _Segurança de Base CHR e Reservations:_ Remover um consumidor de projeto de um tile da Base CHR **nunca** apaga o conteúdo da Base CHR nem o torna órfão. Slots pertencentes a Reservations retornam ao status de ocupação reservada (`reserved`).
- **Detecção e Classificação de Órfãos (`detectOrphanedPhysicalTiles`, `classifyOrphanedPhysicalTiles`):**
  - Um slot físico é classificado como **órfão** estritamente quando: proveniência do projeto (`creationKind === 'extracted'`), zero consumidores ativos (`usageCount === 0`), não protegido por Base CHR, não protegido por Reserva e não marcado como `manual-materialized`.
  - Tiles criados ou materializados manualmente pelo usuário no CHR Editor (`creationKind === 'manual-materialized'`) são de autoria intencional e **não** são coletados como lixo como órfãos gerados ordinários.
- **Divergência de Edição no CHR Editor (`analyzeChrEditDivergence`):**
  - Quando um tile compartilhado por múltiplos assets é editado manualmente no CHR Editor, o sistema analisa a divergência antes de mutar, permitindo derivar e desacoplar o asset-alvo sem mutar silenciosamente os demais consumidores.
- **Sem Desfragmentação Global Automática:** A coleta e reconciliação liberam slots no local sem compactação global ou reindexação em massa, preservando o layout físico estável da CHR-ROM.

### 9.6 Métricas de Recursos CHR por Asset (`calculateAssetChrMetrics`, `calculateProjectChrOwnershipMetrics`)

O subsistema de contabilidade de recursos opera de forma pura e determinística em cima do `ChrAssetMappingIndex`:

- **Medições Fatuais:** Não inventa orçamentos artificiais de CHR; calcula medições rigorosas de slots físicos únicos (`uniquePhysicalSlots`), slots de posse primária (`primaryOwnedSlots`), slots consumidos (`consumedSlots`), deduplicação interna (`sharedSlots`), compartilhamento entre múltiplos assets (`crossAssetSharedSlots`), slots exclusivos (`exclusiveSlots`), reaproveitamento de Base CHR (`baseChrReusedSlots`), materializações manuais (`manualMaterializedSlots`) e decomposição em PT0 / PT1 (`patternTableSlots`).
- **Sem Estado Persistido ou Poluição do Workspace:** Métricas são inteiramente derivadas em tempo de execução e não residem no arquivo `.p2c` nem poluem o `WorkspaceState`.
- **Imutabilidade Absoluta:** O cálculo de métricas não muta o índice de mapeamento nem as estruturas de dados do projeto.

### 9.7 Diagnósticos de Integridade de Posse e Mapeamento (`analyzeChrOwnershipDiagnostics`)

O subsistema de integridade de mapeamento audita o estado de alocação de CHR e produz fatos diagnósticos estruturados (`ChrOwnershipDiagnosticFact`):

- **Fatos Estruturados Primeiro, Interface Depois:** Os diagnósticos são emitidos como estruturas de dados formais contendo severidade (`error` ou `warning`), tipo de fato, índice físico e metadados contextuais antes da formatação e localização textual.
- **Detecção de Órfãos Canônicos (`orphaned-project-tile`):** Reutiliza a semântica canônica de classificação de órfãos (`classifyOrphanedPhysicalTiles`), sinalizando tiles gerados sem uso ativo com severidade `warning`.
- **Integridade de Referências (`dangling-asset-usage`, `missing-origin-asset`):** Identifica com precisão referências a identificadores de assets inexistentes ou removidos com severidade `error`.
- **Validação de Índices e Chaves Lógicas (`invalid-physical-mapping`, `invalid-logical-key`):** Verifica conformidade com as restrições de limites de hardware (0..511) e coerência entre endereço físico e pattern table esperada.
- **Não Duplicação com Outros Subsistemas:** Não sobrepõe diagnósticos de conflito de reservas já fornecidos pelo Gerenciador de Regiões CHR (`ChrRegionManager`), nem validações de cena em nível de sistema (como limites de sprites por scanline, pertencentes a milestones posteriores).

---

## 10. Integração Sprite Sheet → CHR (Milestone 7)

A Milestone 7 integra o pipeline de spritesheets e metasprites de animação com a infraestrutura central de CHR alocada em 8 KiB (PT0 e PT1), respeitando ocupações de Base CHR, reservas bloqueantes de regions e o índice bidirecional de posse de tiles.

Para a investigação técnica completa e desenho arquitetural detalhado, consulte [**Investigação: Sprite Sheet → CHR Integration**](./investigations/spritesheet-chr-integration.md).

### Princípios do Pipeline de Spritesheets:

1. **Decoupling Lógico vs. Físico:** Uma spritesheet extrai células lógicas 8×8 identificadas por coordenadas de grade de frame e `LogicalTileKey` canônica (`${assetId}:${tileX}:${tileY}`). O posicionamento físico na CHR-ROM é decidido pelo alocador central de slots de Pattern Table.
2. **Omissão de Células Transparentes:** Células 100% transparentes são omitidas dos metasprites para economizar slots OAM (máximo de 64 sprites) e respeitar o limite do hardware de 8 sprites por scanline.
3. **Respeito a Reservas e Base CHR:** O alocador de spritesheets consulta as CHR Reservations bloqueantes da Milestone 5 e preserva Base CHR pré-existente sem sobrescrita.
4. **Deduplicação Flip-Aware e OAM:** Células espelhadas reaproveitam slots físicos existentes e codificam os bits 6 (Flip H) e 7 (Flip V) diretamente no byte de atributos OAM do metasprite.
5. **Reconciliação em Reimportação:** Redimensionamentos de spritesheet reconciliam overrides de pixel de forma pura, descartando posições inválidas e preservando as válidas.

### 10.1 Extração Lógica Pura de Metasprites (`src/core/metasprite-extraction.ts`)

A extração de células e frames lógicos é isolada e formalizada de forma pura e determinística:

- **Motor Lógico Puro (`extractLogicalMetaspriteTiles`, `extractLogicalAnimationFrames`):** Converte a imagem com pixel overrides em arrays de `LogicalMetaspriteTile` e `LogicalAnimationFrame`, calculando coordenadas relativas `(x, y)` em torno da âncora `(originX, originY)` e atribuindo chaves canônicas `LogicalTileKey` (`${assetId}:${tileX}:${tileY}`).
- **Omissão Transparente:** Células 8×8 com todos os pixels iguais a 0 são descartadas do array de sprites lógicos e contabilizadas em `omittedTileCount`, sem deslocar as coordenadas dos demais tiles.
- **Fronteira Estrita:** O módulo de extração não possui nenhum conhecimento de CHR física, Pattern Tables ou alocação, servindo de entrada imutável para a etapa de matching/allocation.

### 10.2 Alocador Físico Unificado de CHR para Spritesheets (`src/core/chr-spritesheet-allocation.ts`)

A etapa de atribuição e alocação física opera de maneira centralizada, transacional e determinística:

- **Motor Central de Alocação (`allocateSpritesheetChr`):** Recebe os frames lógicos extraídos, a Pattern Table alvo (PT0 ou PT1), o estado inicial dos 512 slots e o conjunto de índices bloqueados por reservas de CHR (`reservedIndices`).
- **Preservação de Base CHR:** Slots pré-ocupados por Base CHR (`source === 'destination'`) são protegidos contra sobrescrita e são reutilizados estritamente quando há equivalência exata de pixels.
- **Respeito a CHR Reservations:** Slots pertencentes a regiões do tipo `reservation` (Milestone 5) são ignorados durante a busca de slots disponíveis por `findNextAvailableChrSlot`, mesmo que estejam vazios.
- **Garantia de Atomicidade Transacional:** O alocador opera em cópia isolada de trabalho. Caso a capacidade da Pattern Table seja excedida, lança o erro estruturado `pattern-table-capacity-overflow` sem deixar mutações parciais ou corrupção no estado dos slots.
- **Forte Determinismo:** A mesma sequência de frames lógicos e configurações produz exatamente os mesmos assignments físicos e buffer de CHR em execuções repetidas.

### 10.3 Deduplicação Flip-Aware e Encoding de Atributos OAM do Hardware NES

A reutilização de tiles físicos através de espelhamento horizontal e vertical é formalizada como parte explícita do domínio NES:

- **Precedência Estrita de Matching (`findTileMatch`):**
  1. **Exact Match (`transform: 'none'`, `attributes: 0x00`):** Prioridade máxima absoluta; sempre vence qualquer match por flip, mesmo que o flip resida em um índice físico menor.
  2. **Horizontal Flip (`transform: 'h'`, `attributes: 0x40`):** Segunda precedência.
  3. **Vertical Flip (`transform: 'v'`, `attributes: 0x80`):** Terceira precedência.
  4. **Horizontal + Vertical Flip (`transform: 'hv'`, `attributes: 0xC0`):** Quarta precedência.
  - _Desempate Determinístico:_ Em caso de múltiplos slots equivalentes dentro do mesmo nível de precedência, o slot de menor índice físico (`physicalTileIndex`) é escolhido.
- **Encoding de Hardware OAM (`encodeOamAttributes`, `decodeOamAttributes`):**
  - **Bit 7 (`0x80`):** Vertical Flip.
  - **Bit 6 (`0x40`):** Horizontal Flip.
  - **Bit 5 (`0x20`):** Priority behind background.
  - **Bits 1–0 (`0x03`):** Subpaleta de sprite (0 a 3).
  - A composição é computada de forma pura via `encodeOamAttributes(flipAttributes, effectivePalette, priorityBehindBackground)`, garantindo isolamento entre flags de transformação e índices de paleta.
- **Desacoplamento entre Espelhamento de Animação e Flip de Alocação:**
  - O espelhamento semântico de uma animação (e.g. `Walk_left` gerado a partir de `Walk_right` via `exportMirroredDirection`) compõe visualmente invertendo o bit de flip horizontal ($\text{flip original} \oplus \text{espelhamento de animação} = \text{flip final no OAM}$).
- **Integração com `ChrAssetMappingIndex` (Milestone 6):**
  - **Invariante Origin ≠ Usage:** A primeira alocação de um slot físico registra seu `PhysicalTileOrigin` (`primaryAssetId`, `logicalKey`). Usos subsequentes (sejam exatos ou via flip) registram `PhysicalTileUsage`s adicionais marcando o slot como `isShared: true` sem nunca sobrescrever ou corromper a origem primária.
  - Cada uso preserva sua respectiva `LogicalTileKey` canônica original.

### 10.4 Reconciliação de Reimportação e Ciclo de Vida de Assets (`src/core/asset-lifecycle.ts`)

A substituição ou atualização de uma spritesheet no projeto preserva a identidade lógica estável dos assets enquanto reconcilia o estado físico e visual:

- **Preservação de `ProjectAssetId` e `LogicalTileKey`:** Assets existentes mantêm seu identificador imutável. Reimportações com dimensões idênticas ou alteradas operam sobre a mesma identidade de asset.
- **Reconciliação Pura de Geometria e Pixel Overrides:** Overrides de pixel dentro dos limites da nova geometria `(newWidth, newHeight)` são integralmente preservados; overrides em coordenadas excedentes são descartados deterministicamente.
- **Alinhamento de Metadados de Frame:** Arrays dependentes de índice de frame (`frameIndices`, `frameDurations`, `framePalettes`, `framePaletteIds`) são truncados para o novo `frameCountMax` quando as dimensões diminuem, ou preservados quando aumentam.
- **Reconstrução Transacional do CHR e Mapeamento:** A substituição de conteúdo gráfico desaloca tiles físicos obsoletos e reconstrói o CHR de forma atômica. Caso a nova imagem exceda a capacidade da Pattern Table, o alocador falha sem corromper o estado canônico anterior.

### 10.5 Alinhamento Unificado de Exportação: cc65 C, ca65 ASM, JSON v5 e CHR Binary (`src/core/animation-exporters.ts`)

Os exportadores de código e metadados funcionam estritamente como **serializadores puros** do modelo físico resolvido (`AnimationProjectModel`):

- **Invariante de Domínio: Exportadores Não Alocam:**
  - O pipeline canônico de compilação segue uma ordem estrita unidirecional:
    $$\text{Spritesheet} \longrightarrow \text{Extração Lógica} \longrightarrow \text{Alocação Física / Deduplicação} \longrightarrow \text{AnimationProjectModel} \longrightarrow \text{Exportadores}$$
  - Os exportadores **nunca** recalculam alocação de tiles, deduplicação, detecção de flip ou limites de CHR. Eles consomem exclusivamente os arrays e flags já resolvidos no domínio.
- **Índice Local vs. Índice Físico de CHR:**
  - O hardware do NES no modo sprite 8×8 endereça 256 tiles locais (`0..255`) em uma Pattern Table selecionada via registrador PPU (`$2000`).
  - **Em C (`.h` / `.c`) e ASM (`.inc` / `.s`):** O campo `tile` gravado nas tabelas de metasprites OAM é estritamente o índice local de 8 bits `0..255` (`hex(sprite.tile)` / `asmHex(sprite.tile)`).
  - **Constante de Pattern Table:** A constante `${PREFIX}_SPRITE_PATTERN_TABLE` (`0` para PT0, `1` para PT1) é exportada em C (`#define`) e ASM (`=`) para permitir que o engine de jogo configure corretamente o bit 3 de `PPUCTRL`.
  - **Em JSON v5:** O modelo expõe simultaneamente `tile` (local `0..255`), `physical_tile_index` (global `0..511`), `pattern_table` (`0` ou `1`) e `destination_pattern_table`, satisfazendo a invariante `physical_tile_index = pattern_table * 256 + tile`.
- **Encoding de Atributos OAM:**
  - O byte de atributos OAM (`sprite.attributes`) contém a combinação exata de subpaleta (bits 1–0), flip horizontal (bit 6, `0x40`) e flip vertical (bit 7, `0x80`), formatado byte-a-byte em hexadecimal (`0x00..0xFF` em C, `$00..$FF` em ASM).
- **Tratamento de Coordenadas com Sinal:**
  - Coordenadas de metasprites relativas à âncora `(x, y)` abrangem o intervalo com sinal `[-128, 127]`.
  - Em C, são serializadas como números decimais com sinal (`int8_t x, y;`).
  - Em ASM, são serializadas como bytes hexadecimais via representação em complemento de dois (`asmHex(signedByte(x))`).
  - Em JSON, são serializadas diretamente como números JSON.
- **Equivalência Semântica entre Todos os Formatos:**
  - cc65 C, ca65 ASM e JSON v5 refletem exatamente a mesma contagem de animações, sequenciamento de frames, durações por frame, contagem de sprites visíveis (com células transparentes omitidas) e buffer de CHR (`exportAnimationChr`).

---

## 11. Pipeline de Background (Milestone 8)

A Milestone 8 estabelece o pipeline de **Cenários, Mapas e Backgrounds** (Nametable e Attribute Table) do NES, seguindo os mesmos invariantes de desacoplamento, determinismo e pureza arquitetural das milestones anteriores.

### 11.1 Modelo de Domínio e Invariantes (`src/core/background-model.ts`, `src/core/background-error.ts`)

- **Invariante Fundamental $Logical \neq Physical$:**
  - O modelo de um background (`BackgroundMapDefinition`) armazena referências lógicas a tiles (`BackgroundMapCell` com `LogicalTileKey` e coordenadas na grade de origem), e **não** posições físicas derivadas na CHR-ROM.
  - Células vazias são modeladas explicitamente como `null` na grade `cells` (comprimento 960 para uma tela 32×30), evitando magic numbers (`-1`, `255` ou `""`).
- **Dimensões Base em Tiles 8×8:**
  - Grade canônica padrão de uma tela NES: 32 colunas × 30 linhas = 960 células.
- **Hardware Invariant: Deduplicação Estritamente Exata:**
  - A PPU do NES não possui suporte a hardware flip em entradas de Nametable (que são bytes puros `0..255`).
  - Portanto, backgrounds utilizam estritamente deduplicação exata (`ExactMatch`), sem flags de espelhamento.
- **Granularidade da Attribute Table:**
  - Subpaletas são definidas na granularidade de blocos de 16×16 pixels (2×2 tiles de 8×8), correspondendo à grade lógica de 16 colunas × 15 linhas (240 entradas com valores `0..3`).
  - A função pura `encodeBackgroundAttributeTable` empacota a grade 16×15 em exatamente 64 bytes físicos da Attribute Table do NES com a fórmula canônica:
    $$\text{attribute\_byte} = (\text{pal}_{BR} \ll 6) \mid (\text{pal}_{BL} \ll 4) \mid (\text{pal}_{TR} \ll 2) \mid \text{pal}_{TL}$$
  - A linha 15 (fora do viewport vertical de 240 px) recebe preenchimento determinístico com `0`.
- **Contrato Puro de Resolução da Nametable:**
  - `resolveLogicalNametable` permite compilar a Nametable física de 960 bytes a partir de um mapeador/resolvedor de `LogicalTileKey` fornecido externamente, validando limites de bytes (`0..255`) e tratamento de células vazias.

### 11.2 Alocação Física de CHR e Integração com Pattern Tables (`src/core/chr-background-allocation.ts`, `src/core/chr-asset-mapping.ts`)

- **Isolamento de Pattern Tables (PT0 / PT1):**
  - A propriedade `BackgroundMapDefinition.patternTable` (`0 | 1`) restringe a alocação estritamente à Pattern Table alvo:
    - PT0 $\rightarrow$ slots físicos 0..255 (endereço base `$0000`);
    - PT1 $\rightarrow$ slots físicos 256..511 (endereço base `$1000`).
  - O buffer físico da Nametable gerado (960 bytes) armazena estritamente o índice local na Pattern Table:
    $$\text{localTileIndex} = \text{physicalTileIndex} - (\text{patternTable} \times 256) \in [0, 255]$$
- **Deduplicação ExactMatch:**
  - Backgrounds não possuem suporte a espelhamento em hardware (diferente de sprites OAM). A busca por deduplicação (`findExactTileMatch`) compara exclusivamente os 16 bytes de CHR idênticos (ExactMatch).
  - Variações espelhadas (H-flip, V-flip, HV-flip) são obrigatoriamente alocadas em slots distintos.
- **Reutilização e Preservação de Base CHR:**
  - Quando um tile lógico do background coincide por ExactMatch com um tile pré-existente de Base CHR, o slot é reutilizado sem duplicação de dados e sua proveniência original (`source: 'destination'`) é preservada.
- **Respeito Estrito a CHR Reservations:**
  - Slots físicos demarcados como `Reservation` são rigorosamente ignorados pelo algoritmo de busca de novos slots (`findNextAvailableChrSlot`).
  - Caso o espaço disponível dentro da Pattern Table seja insuficiente após considerar Base CHR, Reservations e deduplicação, o allocator lança um `BackgroundModelError('background-capacity-overflow')` estruturado com métricas detalhadas.
- **Invariante Origin $\neq$ Usage e Mapeamento Bidirecional:**
  - Backgrounds integram-se ao `ChrAssetMappingIndex` através do tipo discriminado `BackgroundTileUsage`:
    - Permite rastrear `mapId`, `column`, `row`, `nametableIndex`, `localTileIndex`, `physicalTileIndex` e `logicalKey`.
    - Compartilhamento físico de tiles entre múltiplas células ou entre diferentes assets não altera a proveniência original (`origin`) do slot.
- **Atomicidade Transacional e Determinismo:**
  - O processo de alocação opera sobre uma cópia de trabalho (`workingSlots`). Qualquer falha por overflow de capacidade ou inconsistência de dados aborta a operação sem deixar mutações parciais no estado do projeto.
  - A ordem de alocação sequencial (da célula 0 até 959) garante repetibilidade bit-a-bit idêntica entre execuções.

### 11.3 Persistência de Backgrounds no Projeto e Lifecycle (`src/core/project.ts`, `src/core/asset-lifecycle.ts`, `src/core/asset-identity.ts`)

- **Schema de Persistência Canônico (`ProjectBackgroundSettingsConfig`):**
  - O modelo do projeto (`StudioProject`) inclui o container opcional `backgrounds?: ProjectBackgroundSettingsConfig`:
    - `activeMapId?: string | null`: identificador do mapa de background selecionado para edição ou visualização ativa.
    - `maps: readonly BackgroundMapDefinition[]`: coleção declarativa dos mapas de background do projeto.
- **Invariante Fundamental: Estado Lógico é Persistido, Estado Físico é Derivado ($Logical \neq Physical$):**
  - O arquivo de projeto (`.p2c.json`) serializa exclusivamente definições lógicas puras:
    - Identidade estável do mapa (`id`, `name`);
    - Dimensões lógicas canônicas (`widthTiles: 32`, `heightTiles: 30`);
    - Pattern Table de destino (`patternTable: 0 | 1`);
    - Identidade e referência do asset (`assetId`, `asset: ProjectAssetReference`);
    - Grade lógica de células (`cells`: 960 elementos, com `null` para células vazias e `BackgroundMapCell` com `logicalKey`, `tileX`, `tileY`, `sourceTileIndex`);
    - Grade lógica de subpaletas (`paletteAssignments`: 240 inteiros `0..3`).
  - Buffers de hardware (`nametable`, `attributeTable`, `fullMapBuffer`, `finalChr`), índices locais ou globais (`localTileIndex`, `physicalTileIndex`), `resolvedCells` e `BackgroundProjectModel` **nunca** são gravados no JSON. São reconstruídos deterministicamente a quente via `buildBackgroundProjectModel`.
- **Coexistência Pacífica com o Playfield Legado:**
  - `ProjectPlayfieldConfig` (`project.playfield`) é mantido intacto no schema e funcional lado a lado.
  - Não há migração destrutiva ou remoção do formato legado de playfield de imagem única nesta milestone, garantindo retrocompatibilidade total.
- **Formato do Projeto e Backward Compatibility:**
  - Mantido `formatVersion: 1`. Projetos mais antigos sem o campo `backgrounds` continuam desserializando perfeitamente sem falhas ou mutações inesperadas.
- **Integração com Asset Lifecycle e Diagnósticos Puros (`reconcileBackgroundMaps`):**
  - Assets de background são classificados como `kind: 'background-image'` em `extractProjectAssets`.
  - `findMissingAssets` valida caminhos e existência em disco de referências a imagens de background.
  - A rotina pura `reconcileBackgroundMaps` audita coleções de mapas e emite fatos estruturados (`BackgroundMapReconciliationFact`) com severidades de `error` ou `warning` para inconsistências como duplicatas de ID, dimensões incorretas, pattern table inválida, subpaletas fora de `0..3`, chaves lógicas malformadas, coordenadas fora dos limites do asset ou assets ausentes.
  - Na remoção de assets, `createOriginFromUsage` trata consumidores de background (`usage.type === 'background'`), permitindo transferência determinística de proveniência de tiles compartilhados.

### 11.4 Exporters de Background: Contrato Puro e Serialização (`src/core/background-exporters.ts`)

- **Contrato Arquitetural Central: Serializadores Puros:**
  - O fluxo de exportação opera estritamente como uma transformação pura unidirecional:
    $$\text{BackgroundProjectModel} \longrightarrow \text{exporter} \longrightarrow \text{bytes / text}$$
  - O exporter **não** executa alocação de CHR, deduplicação, resolução de `LogicalTileKey`, consulta a Reservations, mutação de estado de projeto nem recálculo independente de Attribute Table.
- **Formatos Binários Nativos:**
  - **Nametable (`.nam`):** exatamente 960 bytes compilados (`0..255`), idênticos byte-a-byte a `model.nametable`.
  - **Attribute Table (`.atr`):** exatamente 64 bytes compilados, idênticos a `model.attributeTable`.
  - **Mapa Combinado (`.map`):** exatamente 1024 bytes (960 bytes de Nametable seguidos de 64 bytes de Attribute Table).
  - **CHR (`.chr`):** buffer de 8192 bytes (8 KiB) por padrão (`exportBackgroundChr`), ou fatia de 4096 bytes (4 KiB) da Pattern Table utilizada (`exportBackgroundPatternTableChr`).
  - **Palette (`.pal`):** 16 bytes da paleta de background do NES (`exportBackgroundPalette`), reutilizando a primitiva canônica `encodeNesBackgroundPalettes`.
- **Exportação cc65 C (`generateCBackgroundExport`):**
  - **Header (`.h`):** macro `#define ${ID}_BACKGROUND_PATTERN_TABLE 0|1`, constantes de dimensão (`NAMETABLE_SIZE 960`, `ATTRIBUTE_TABLE_SIZE 64`, `FULL_MAP_SIZE 1024`), e declarações `extern const unsigned char ...`.
  - **Source (`.c`):** arrays formatados deterministicamente espelhando a grade do NES (30 linhas de 32 valores hexadecimais para a Nametable, e 8 linhas de 8 valores para a Attribute Table).
- **Exportação ca65 Assembly (`generateCa65BackgroundExport`):**
  - **Include (`.inc`):** constantes(`${ID}_BACKGROUND_PATTERN_TABLE = 0|1`, tamanhos) e diretivas `.import`.
  - **Source (`.s`):** diretiva `.segment "RODATA"`, diretivas `.export` e blocos de dados organizados com `.byte` alinhados a cada uma das 30 linhas da tela física.
- **Sanitização, Determinismo e Validação:**
  - Reutiliza `normalizeCIdentifier` para sanitizar símbolos contra espaços, hífens, acentos, dígitos iniciais e palavras reservadas de C/ASM.
  - Saídas são 100% determinísticas (sem timestamps, IDs aleatórios ou dependências de locale).
  - Validações estritas de tamanho de buffer (`960B`, `64B`, `8192B`) e Pattern Table (`0 | 1`) garantem integridade sem mascarar erros.

### 11.5 Background Workspace e Edição Visual de Nametables (`src/ui/background-workspace.ts`)

- **Composição e Arquitetura de Tela:**
  - O **Background Workspace** organiza a experiência de edição em três regiões articuladas sem criar empilhamento vertical excessivo:
    - **Toolbar Superior (`.background-toolbar`):** seletor de mapa ativo, botão de criação (`+ Novo Mapa`), exclusão com confirmação, renomeação de mapa, seletor de Pattern Table (`PT0 ($0000)` / `PT1 ($1000)`) e associação de asset de imagem fonte (`kind: 'background-image'`).
    - **Painel Esquerdo:** ferramentas de edição (Carimbo, Conta-gotas, Borracha, Pintura de Subpaleta), seletor de 4 subpaletas com cores reais do NES e identidade lógica resolvida por slot BG, e **Tile Browser** do asset fonte com navegação por teclado (roving tabindex). Slots vazios ou dangling possuem estado visual explícito.
    - **Painel Central (Canvas 32×30):** viewport com HTML5 Canvas 256×240 px, escalável em 1x, 2x, 3x e 4x com renderização pixelada, grade 8×8 opcional, overlay de blocos 16×16 da Attribute Table com números de subpaleta visíveis, e suporte a gestos atômicos de arrasto.
    - **Painel Direito (Inspetor & Diagnósticos):** exibe coordenadas de tela, pixel X/Y, chave lógica (`logicalKey`), subpaleta do bloco, índice da Attribute Table, índice local compilado (`localTileIndex`), slot físico compilado (`physicalTileIndex`) e botão para inspecionar o slot correspondente na **CHR Memory**, além da lista de diagnósticos do mapa.
- **Invariante Central: UI Edita Exclusivamente o Modelo Lógico:**
  - O workspace manipula e comita apenas instâncias de `BackgroundMapDefinition` (`cells` lógicas e `paletteAssignments`).
  - O canvas renderiza o estado resolvido produzido por `buildBackgroundProjectModel`, garantindo que nenhuma decisão de alocação de CHR seja antecipada ou gravada pela interface gráfica.
  - `paletteAssignments` continua armazenando apenas índices físicos `0..3`; reatribuir uma definição lógica a um slot altera as cores renderizadas sem reescrever o mapa.
- **Pintura de Subpaleta com Granularidade Real de Hardware (16×16 px):**
  - A interface reforça a restrição de hardware da Attribute Table: paletas são atribuídas a quadrantes 16×16 (2×2 tiles de 8×8).
  - Ao pintar uma subpaleta, o quadrante correspondente (`quadrantIndex = Math.floor(row / 2) * 16 + Math.floor(col / 2)`) é atualizado e reflete imediatamente em todas as 4 células do bloco.
- **Acessibilidade e Atalhos de Teclado:**
  - Viewport focável com cursor navegável via setas (`ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`);
  - `Espaço` / `Enter`: aplica a ferramenta ativa na célula atual;
  - `Delete` / `Backspace`: apaga a célula atual (`null`);
  - `1`, `2`, `3`, `4`: seleciona subpaletas 0 a 3;
  - `G`: alterna grade de tiles 8×8;
  - `A`: alterna overlay da Attribute Table 16×16;
  - `P`, `E`, `I`: alternam para Carimbo (`pencil`), Borracha (`erase`) e Conta-gotas (`picker`).

---

## 12. Palette Manager (Milestone 9)

A Milestone 9 formaliza o subsistema de **Paletas NES** como recursos explícitos de primeira classe do projeto, eliminando conflitos entre sprites e backgrounds e garantindo aderência rigorosa às restrições de memória de paleta da PPU do NES ($3F00..$3F1F).

Para a especificação técnica completa e detalhamento de cada aspecto, consulte [**Arquitetura e Especificação: Palette Manager**](./palette-manager.md).

### Princípios do Palette Manager:

1. **Recurso de Primeira Classe (`PaletteDefinition`):** Paletas possuem identidade estável (`ProjectPaletteId`), nomes descritivos e 4 entradas de cor NES ($00..$3F), existindo de forma independente de suas atribuições físicas a slots de hardware.
2. **Bancos Ativos Duplos (Dual Hardware Banks):**
   - **Banco de Background (PPU $3F00..$3F0F):** 4 slots de subpaleta (0..3) dedicados a Nametables e cenários;
   - **Banco de Sprites (PPU $3F10..$3F1F):** 4 slots de subpaleta (0..3) dedicados a metasprites OAM.
3. **Gestão Canônica da Cor Universal de Background ($3F00):** O endereço `$3F00`é a cor de fundo universal do projeto; seus espelhos em`$3F04`, `$3F08`, `$3F0C` e `$3F10`, `$3F14`, `$3F18`, `$3F1C` são tratados de forma coerente em renderização, edição e exportação. Em sprites, o índice de cor 0 continua transparente.
4. **Rastreamento de Uso Bidirecional:** Localização determinística de referências em animações, metasprites, frames, mapas de background e slots ativos.
5. **Diagnósticos e Validação NES:** `analyzeProjectPaletteDiagnostics` produz fatos puros e estruturados (`dangling-palette-reference`, `unassigned-active-slot`, `slot-capacity-exceeded`, `invalid-nes-color`, `inconsistent-universal-color`) e o agregador de readiness em `delivery-workspace.ts` os apresenta com i18n. A capacidade é avaliada por contexto simultâneo de cena e por IDs distintos, nunca pelo tamanho total da biblioteca.
6. **Exportação Abrangente:** Suporte a arquivos binários `.pal` (16B e 32B), arrays em C (cc65) e ca65 Assembly com tabelas separadas para background e sprites.
