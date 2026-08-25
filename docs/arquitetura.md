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

1. **`StudioProject` (Persistente):** Estado canônico de criação (modo selecionado, fontes gráficas com dataUrl, definições de paleta, slots ativos, pixel overrides, mapa de colisão, animações, instâncias de cena, base CHR). Qualquer alteração gera uma nova identidade de objeto e marca o projeto como não-salvo (`isDirty = true`).
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
    - _Scene Preview (Cena Interativa):_ Subworkspace integrado (`Animation > Scene`) com tela persistente NES 256×240, lista/seleção de instâncias e inspetor contextual de propriedades (entidade, animação, coordenadas X/Y, visibilidade, duplicação e slot de paleta).
  - **Sticky Preview & Sumário:** Painel lateral fixo com player interativo (Play/Pause, Passo Anterior/Próximo), alternador de variantes (Original / Flip H / Flip V), modo de cor (NES / PNG Original) e sumário de métricas da animação selecionada.
- **Detecção Assistida de Frames (`src/core/frame-detection.ts`):** Analisa a transparência, calhas (_gutters_) e dimensões da folha para sugerir a grade e a contagem resultante de frames. Apresenta nível de confiança (Alta, Média, Baixa), auto-aplicação visível e reversível em alta confiança, preservação estrita de dimensões manuais em confiança média/baixa e botão para aplicação explícita das dimensões sugeridas.
- **Geração de Metasprites:** Cada frame selecionado é subdividido em células 8×8. Células totalmente transparentes são **omitidas**, economizando slots na OAM e respeitando o limite do hardware de 8 sprites por linha de varredura (_scanline limit_).
- **Projeção de Mapeamento (`src/core/animation-mapping.ts`):** Painel que inspeciona detalhadamente o índice local OAM, índice físico CHR, paleta efetiva e atributos de cada tile de cada frame.
- **Scene Preview Multi-Entidade (`src/core/scene-preview.ts`):** Permite instanciar múltiplas entidades em uma cena 256×240 com reprodução independente para verificar alinhamentos de âncoras e paletas em contexto de jogo.

### 6.4 Workspace de Paletas do Projeto (`src/ui/palette-workspace.ts`)

- Espaço dedicado para o gerenciamento de alto nível das definições de paleta do projeto e configuração dos slots ativos de hardware:
  - **Definições de Paleta Reutilizáveis:** Criação, renomeação, ajuste individual das 4 cores NES via seletor mestre, duplicação e exclusão segura com checagem de referências ativas em entidades/animações.
  - **Slots Ativos de Sprite (0..3):** Associação direta de qualquer paleta definida aos 4 slots de hardware da PPU com pré-visualização ao vivo.
  - **Atribuições Contextuais Preservadas:** A seleção de paletas por frame ou animação, o pincel de subpaletas em tiles/metatiles e a edição de pixel overrides permanecem estritamente contextuais nos seus respectivos editores (Tileset, Playfield e Animação).
  - **Exportação de Paleta:** Painel de resumo de métricas e exportação de binário `.pal` (16 bytes).

### 6.5 Workspace de Memória CHR e Tabelas de Padrões (`src/ui/chr-workspace.ts`)

- Espaço visual e projetado de inspeção do modelo canônico de memória CHR-ROM (8 KiB / 512 slots de tiles):
  - **Visualização Completa das Pattern Tables (PT0 e PT1):** Renderização pixel-perfect das duas tabelas de padrões em grades 16×16 de 256 tiles cada (PT0: `$0000..$0FFF`, índices físicos 0..255; PT1: `$1000..$1FFF`, índices físicos 256..511), totalizando os 512 slots da CHR-ROM física.
  - **Visualização Multi-Modal de Ocupação de Slots (`classifyChrSlots`):** Classificação e identificação visual determinística de todos os 512 slots físicos em três estados fundamentais (e extensibilidade para slots reservados):
    - _Livre / Não alocado (`empty`):_ Espaço livre disponível na CHR-ROM. Representado por borda tracejada sutil, padrão matricial texturizado de fundo e marcador neutro.
    - _Tile do Projeto (`project`):_ Gráficos gerados ou importados para o projeto atual (deduplicados em Tileset/Playfield ou referenciados por frames no modo Animação). Representado por borda sólida, indicador sutil no canto superior e tooltip/ARIA com atribuição do asset.
    - _CHR-Base (`base`):_ Tiles importados de uma CHR-base de destino. Representado por borda âmbar e indicador específico.
    - _Reservado (`reserved`):_ Estrutura extensível pronta para futuras políticas de reserva explícita de faixas de slots sem alteração do esquema persistido atual.
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
  - **Layout Responsivo e Scroll Seguro no Zoom de 8×:** A área de visualização das Pattern Tables (`.chr-pt-canvas-wrapper`) utiliza contenção flexível e rolagem independente 2D segura, garantindo que em qualquer nível de ampliação (1×, 2×, 3×, 4× e 8×) todas as 16 colunas ($00..$0F) e 16 linhas permaneçam 100% visíveis e acessíveis via scroll sem estouro de página ou corte de coordenadas negativas.
  - **Agrupamento Semântico no Toolbar:** Os controles do visualizador são particionados em grupos semânticos (`.chr-toolbar-group.is-view-group` para zoom, paleta e heatmap; `.chr-toolbar-group.is-context-group` para escopo de destaque e legenda), garantindo quebra responsiva limpa sem sobreposição de rótulos. Suporte nativo a `prefers-reduced-motion` desativa transições visuais para usuários sensíveis a movimento.
  - **Sumários e Métricas de Utilização das Tabelas:** Cada cartão de Pattern Table (PT0 e PT1) exibe badge de contagem (`{ocupados} / 256`) e subtítulo com utilização e slots livres (`Faixa PPU $0000..$0FFF · 256 tiles (4 KiB) · {ocupados} / 256 ocupados ({livres} livres)`), complementando o sumário de ocupação global da ROM de 8 KiB (`{total} / 512 tiles ({percent}%)`).
  - **Pré-visualização Consciente de Paletas (Palette-Aware Preview):** Modo de visualização configurável no toolbar do viewer permitindo inspecionar as Pattern Tables em escala de cinza neutra (`grayscale`) ou interpretadas através de qualquer subpaleta ativa do projeto:
    - _Subpaletas de Background (BG 0..3):_ Mapeamento 2bpp das cores de cenário definidas em `paletteSet` via paleta master NES (`NES_MASTER_PALETTE`), respeitando a cor universal de fundo (`$3F00`) no índice 0.
    - _Subpaletas de Sprite (SP 0..3) e Personalizadas:_ Mapeamento das 4 cores dos slots ativos de sprite configurados no `palette-manager` com exibição da amostra de cores (_swatches_) em tempo real.
    - _Modo Estritamente Visual:_ A seleção de paleta no CHR Viewer é mantida de forma transiente em `WorkspaceState.chr.previewPalette` (`marksProjectDirty: false`), não alterando bytes da CHR, dados de paleta persistidos, atribuições de animação ou artefatos exportados.
  - **Controles de Zoom Pixel-Perfect:** Controles de ampliação (1×, 2×, 3×, 4×, 8×) com renderização nearest-neighbor (`image-rendering: pixelated`), gerenciados como estado transiente em `WorkspaceState` sem mutação do projeto.
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
    - _Histórico Atômico de Desfazer e Refazer (Undo/Redo):_ Gerenciamento de histórico de 50 níveis baseado em `createTileHistory`, agrupando traços contínuos de arrasto (Pencil e Eraser) como ações atômicas únicas no encerramento do stroke (`onStrokeEnd`), com invalidação imediata da pilha de Redo após novas mutações e suporte a reset por contexto ao inspecionar outro tile.
    - _Atalhos de Teclado e Isolamento de Inputs:_ Atalhos integrados para Desfazer (`Ctrl+Z` / `Cmd+Z`), Refazer (`Ctrl+Y` / `Ctrl+Shift+Z` / `Cmd+Shift+Z`), ferramentas (`P` para Pencil, `E` para Eraser, `I` para Eyedropper, `F` para Flood Fill), índices de cores (`0`, `1`, `2`, `3`), cópia/colagem contextual (`Ctrl+C`, `Ctrl+V`) e limpeza (`Delete` / `Backspace`), com proteção estrita via `isEditableElement` para não interceptar campos textuais (`<input>`, `<textarea>`, `<select>`, `contenteditable`).
    - _Seletor de Índice de Cor:_ Seletor de botões de rádio para os 4 índices planares da subpaleta NES (`0`, `1`, `2`, `3`), renderizados com as cores RGB da paleta de visualização ativa sem alterar os bytes do tile.
    - _Barra de Status de Coordenadas:_ Exibição em tempo real das coordenadas de hover `X: 0..7, Y: 0..7` no grid matricial.
  - **Integração do Editor ao Projeto e Fonte Única de Verdade (`src/core/chr-project-integration.ts`):** A edição de qualquer tile no CHR Viewer atualiza a fonte canônica correspondente sem buffers intermediários paralelos:
    - _Matriz de Origem do Tile:_
      - _Tile de Animação:_ Mapeado reversamente para a spritesheet de origem através da animação e frame referenciados (`(tileX, tileY)`), gravando as alterações em `animation.pixelOverrides` (`Record<string, SingleTileOverrides>`) persistidas no `.p2c.json`. Repercute instantaneamente nos previews de animação, strip de frames e Pattern Tables.
      - _Tile de Tileset / Playfield:_ Gravado diretamente em `project.pixelOverrides` (matriz de sobreposição sobre a imagem indexada), re-extraindo a lista deduplicada de tiles e atualizando nametables e grids.
      - _CHR-Base (PT0 / PT1):_ Grava exatamente os 16 bytes planares (`encodeChrTileFromPixels`) no offset correspondente em `destinationChr`, preservando os demais bytes da ROM inalterados.
      - _Slot Vazio (Materialização):_ Ao desenhar em um slot previamente livre (`occupancy: empty`), o tile é materializado em `destinationChr`. Caso a Base CHR não exista ou seja de 4 KiB em PT0 e a edição ocorra em PT1 (índices 256..511), o buffer é expandido para 8 KiB de forma transparente, preservando PT0 e atualizando as métricas de ocupação em tempo real.
    - _Desfazer/Refazer com Escopo e Persistência Reais:_ O histórico atua diretamente sobre o estado canônico do projeto. As instâncias de histórico são mantidas no host vinculadas à chave única do tile (`historyKey = `${project.name}:${project.mode}:${physicalIndex}``), sobrevivendo a re-renderizações e atualizações do projeto sem resetar a pilha de Undo/Redo, garantindo isolamento total entre tiles distintos e sendo limpas automaticamente na carga ou reinicialização de projetos.
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
- **Gerenciador de Paletas do Projeto (`src/core/palette-manager.ts`):** Permite criar paletas nomeadas independentes e associá-las aos 4 slots ativos de sprites (`activeSpritePaletteSlots`).
- **Pré-visualização Dinâmica no CHR Viewer:** O visualizador de Pattern Tables mapeia dinamicamente os valores de 2bpp `0..3` das tabelas PT0 e PT1 para as 4 cores de qualquer subpaleta de cenário ou sprite selecionada pelo usuário, com fallback seguro para escala de cinza neutra.
- **Hierarquia de Resolução:** A paleta de um sprite é determinada na seguinte ordem de precedência:
  `frame.paletteId` ➔ `animation.paletteId` ➔ `asset.defaultPaletteId` (Slot 0).

---

## 8. Persistência e Compatibilidade

- O arquivo de projeto (`.p2c`) armazena a estrutura canônica completa do projeto em JSON estruturado.
- **Auto-Contenção:** Imagens PNG importadas são armazenadas também como `dataUrl` em Base64 no arquivo de projeto, garantindo que o usuário possa reabrir o projeto em qualquer máquina mesmo sem os arquivos de imagem originais na mesma pasta.
- **Migração Retrocompatível (`src/core/project.ts`):** Suporte a migração automática de formatos antigos de projeto (como projetos legados sem paletas nomeadas ou com índices de paleta numéricos), garantindo que projetos salvos em versões anteriores continuem abrindo sem perda de dados.
