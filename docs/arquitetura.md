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

- Espaço projetado de leitura do modelo canônico de memória CHR-ROM (8 KiB / 512 slots de tiles):
  - **Ocupação Física Total e Isolamento de Tabelas:** Exibe o total ocupado (`Total = PT0 + PT1`), detalhando a ocupação física das tabelas PT0 ($0000..$0FFF, 4 KiB, 256 tiles) e PT1 ($1000..$1FFF, 4 KiB, 256 tiles).
  - **Diferenciação Hardware (Índice Físico vs. Índice Local OAM):** Esclarece a distinção entre a posição física na ROM (0..511) e o índice de 8 bits gravado na OAM (0..255), determinado pelo registrador PPUCTRL (`$2000` bit 3).
  - **Capacidade Local de Sprites:** Exibe a capacidade da tabela de padrões ativa de sprites (256 tiles) e a contagem de tiles restantes para entidades.
  - **Detalhamento de Reúso e CHR-Base:** Discrimina tiles mantidos de CHR-base (4 KiB / 8 KiB / esparsos), tiles reutilizados por deduplicação/espelhamento e novos tiles alocados.
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
- **Hierarquia de Resolução:** A paleta de um sprite é determinada na seguinte ordem de precedência:
  `frame.paletteId` ➔ `animation.paletteId` ➔ `asset.defaultPaletteId` (Slot 0).

---

## 8. Persistência e Compatibilidade

- O arquivo de projeto (`.p2c`) armazena a estrutura canônica completa do projeto em JSON estruturado.
- **Auto-Contenção:** Imagens PNG importadas são armazenadas também como `dataUrl` em Base64 no arquivo de projeto, garantindo que o usuário possa reabrir o projeto em qualquer máquina mesmo sem os arquivos de imagem originais na mesma pasta.
- **Migração Retrocompatível (`src/core/project.ts`):** Suporte a migração automática de formatos antigos de projeto (como projetos legados sem paletas nomeadas ou com índices de paleta numéricos), garantindo que projetos salvos em versões anteriores continuem abrindo sem perda de dados.
