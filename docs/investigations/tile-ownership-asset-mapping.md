# Investigação Técnica: Posse de Tiles, Identidade de Assets e Mapeamento Asset-to-CHR (Milestone 6)

**Status:** Concluído / Proposta Arquitetural  
**Data:** 25 de Agosto de 2026  
**Autores:** Equipe de Engenharia PNG2CHR Studio  
**Milestone Alvo:** [Milestone 6 — Tile Ownership & Asset Mapping](https://github.com/Andropovbr/png2chr-studio/milestone/7)  
**Documentos Relacionados:** [`docs/arquitetura.md`](../arquitetura.md), [`docs/formatos-e-exportacao.md`](../formatos-e-exportacao.md), [`docs/project-state-boundaries.md`](../project-state-boundaries.md), [`docs/investigations/chr-regions-reservations.md`](./chr-regions-reservations.md), [`AGENTS.md`](../../AGENTS.md)

---

## 1. Resumo Executivo

O **PNG2CHR Studio** gerencia um espaço canônico de 8 KiB de CHR-ROM (512 slots de 8×8 pixels, divididos em duas Pattern Tables de 4 KiB: PT0 e PT1). A Milestone 5 estabeleceu com sucesso o modelo de particionamento e restrição desse espaço físico através de **CHR Regions** (organização) e **Reservations** (bloqueio de alocação automática).

Contudo, a arquitetura atual trata a relação entre os arquivos gráficos de entrada (PNGs, Base CHR) e os slots físicos alocados de forma **implícita, dispersa e predominantemente efêmera**:

1. **Assimetria de Assets:** Imagens de Tileset e Playfield são armazenadas como referências soltas (`tileset.asset`, `playfield.asset`), enquanto animações possuem um array de itens (`animation.animations[]`) com referências individuais embutidas. Não existe um registro canônico e uniforme de _Assets Lógicos do Projeto_.
2. **Atribuição Reconstruída por Strings:** A relação de proveniência de um tile físico é reconstruída dinamicamente sob demanda através de rotinas como `collectPhysicalTileReferences` e `classifyChrSlots`, gerando rótulos textuais livres (como `"Project Tile"`, `"Base CHR"` ou `"Hero (#0)"`) em vez de identificadores de domínio estruturados.
3. **Ambiguidade entre Posse (Origem) e Uso (Consumo):** Quando múltiplos frames, sprites ou assets distintos reutilizam o mesmo slot de CHR através de deduplicação exata ou flip-aware, o sistema não possui uma distinção formal entre o _produtor primário_ do padrão gráfico e os _múltiplos consumidores ativos_.
4. **Fragilidade no Ciclo de Vida:** Ao substituir um PNG de animação ou deletar uma animação que compartilhe tiles com outras por deduplicação, não há um protocolo formal para determinar se os slots físicos devem ser preservados, realocados ou liberados, aumentando o risco de geração de tiles órfãos ("lixo" em CHR) ou quebra de referências em outros componentes.

### Objetivo da Milestone 6

Definir e consolidar o modelo arquitetural de **Posse de Tiles (Ownership)**, **Identidade de Assets** e **Mapeamento Bidirecional (Asset-to-CHR Mapping)**, respondendo deterministicamente à questão central:

> _Dado um slot físico de CHR, qual asset do projeto o produziu originalmente (Origem/Posse), quais elementos do projeto dependem dele (Usos/Referências), e como o sistema mantém essa relação íntegra ao longo de adições, edições, substituições, deduplicações e exclusões de assets?_

---

## 2. Definições e Terminologia

Para eliminar ambiguidades conceituais entre entidades de armazenamento, domínio e hardware NES, adotamos as seguintes definições formais:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                             Hierarquia Conceitual                           │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. Source Asset (Arquivo PNG / Base CHR bruto)                              │
│                                    │                                        │
│                                    ▼                                        │
│ 2. Logical Project Asset (Entidade com assetId estável)                     │
│                                    │                                        │
│                                    ▼                                        │
│ 3. Logical Tile (Coordenada canônica no asset: assetId:tileX:tileY)         │
│                                    │                                        │
│                       [Alocação & Deduplicação]                             │
│                                    │                                        │
│                                    ▼                                        │
│ 4. Physical CHR Slot (Endereço físico 0..511 na CHR-ROM de 8 KiB)           │
│                                    │                                        │
│             ┌──────────────────────┴──────────────────────┐                 │
│             ▼                                             ▼                 │
│    5. Tile Ownership                             6. Tile Usage              │
│  (Proveniência / Produtor)                    (Consumidores Ativos)         │
│  - Asset primário                            - Metasprites de frames        │
│  - Base CHR importada                        - Células de Nametable         │
│  - Editor manual CHR                         - Entradas de Tileset          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Termos Fundamentais

- **Source Asset / Source File (`ProjectAssetReference`):** Referência de armazenamento que encapsula o caminho relativo normalizado (`path`) e o payload bruto embutido (`dataUrl`). Não possui semântica de jogo; representa puramente o arquivo físico.
- **Logical Project Asset (`ProjectAsset`):** Representação de domínio de um recurso gráfico gerenciado pelo projeto (ex.: o spritesheet do jogador, o conjunto de tiles de cenário, a tela de mapa de fundo ou a Base CHR). Possui um `assetId` estável e imutável.
- **Tile (`Tile`):** Bloco gráfico bruto de 8×8 pixels quantizados (64 bytes de índices 0..3 na memória).
- **Logical Tile (`LogicalTileKey`):** Identificador unívoco de um tile no espaço bidimensional do asset de origem, formatado como `assetId:tileX:tileY` (ou índice linear no caso de Base CHR). É invariante em relação à posição física na CHR-ROM.
- **Physical CHR Slot:** Um dos 512 endereços de 16 bytes na CHR-ROM física de 8 KiB da PPU do NES (`0..255` em PT0, `256..511` em PT1).
- **Tile Ownership (Posse / Origem / Proveniência):** O vínculo que indica qual asset e coordenada lógica gerou inicialmente o padrão gráfico daquele slot.
- **Tile Usage / Tile Reference (Uso / Consumo):** Uma ocorrência ativa onde um componente do projeto referencia o slot físico para exibição (ex.: um sprite em um frame de animação, uma entrada de metatile no playfield, ou um tile na grade do tileset).
- **Allocation (Alocação):** O algoritmo que mapeia um Logical Tile para um Physical CHR Slot, respeitando a Pattern Table de destino, Base CHR pré-existente, deduplicação e Reservations.
- **Mapping (Mapeamento):** A relação bidirecional entre o grafo de Logical Assets/Tiles e a grade de Physical CHR Slots.
- **Base CHR Tile:** Slot físico cujo padrão gráfico é proveniente de um arquivo `.chr` importado (`destinationChr`).
- **Project Tile:** Slot físico gerado a partir de assets do projeto (Spritesheet, Tileset, Playfield).
- **Materialized CHR Editor Tile:** Slot físico gerado ou modificado por desenho direto de pixels no CHR Tile Editor em uma posição originalmente vazia ou desacoplada da imagem de origem.
- **Reserved Slot:** Slot físico contido em uma `ChrRegion` com `kind: 'reservation'`, protegido contra alocação automática.

### 2.2 Distinção Obrigatória: Posse (Ownership) versus Uso (Usage)

> **Regra Fundamental:** Posse e Uso **devem ser modelados como conceitos distintos**.

No hardware do NES, a restrição de 256 tiles por Pattern Table torna a **deduplicação** essencial. Em um projeto real:

1. O frame 0 da animação `walk` e o frame 2 da animação `attack` frequentemente compartilham o mesmo tile de cabeça de 8×8 pixels.
2. A animação `enemy_patrol` pode deduplicar um tile idêntico originalmente alocado por `hero_idle`.
3. Um frame de animação pode apontar diretamente para um tile existente na Base CHR.

Se o sistema impusesse um modelo simplista de "1 dono único = 1 usuário único", teríamos apenas duas opções ruins:

- _Desabilitar a deduplicação cross-asset_, desperdiçando CHR-ROM e violando restrições de hardware; ou
- _Sobrescrever o proprietário a cada novo uso_, tornando impossível saber qual asset gerou originalmente o tile e quebrando o rastreamento quando um dos assets for excluído.

Portanto, o modelo deve tratar a **Origem (Ownership)** como a proveniência geradora (1 primária) e o **Uso (Usage)** como uma coleção de referências $N$-para-1 em direção ao slot físico.

---

## 3. Mapeamento do Estado Atual do Código

A auditoria revelou a distribuição das responsabilidades no código atual:

| Módulo                      | Arquivo Fonte                         | Como lida hoje com Assets e Tiles                                                                                                                                                                 | Limitações Observadas                                                                                                                                                       |
| :-------------------------- | :------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Persistência de Projeto** | `src/core/project.ts`                 | `StudioProject` armazena referências separadas: `tileset.asset`, `playfield.asset`, `animation.animations[].asset`, `destinationChr`.                                                             | Não há lista unificada de assets. Identificadores de animação existem (`id`), mas tileset/playfield/base não possuem IDs homogêneos.                                        |
| **Alocação de Animações**   | `src/core/animation-model.ts`         | `buildAnimationProjectModel` extrai tiles dos frames, chama `findTileMatch` para deduplicação interna e Base CHR, e grava `physicalTileIndex` em cada `AnimationSprite`.                          | O modelo alocado é efêmero e recalculado na íntegra. Não registra a proveniência `(tileX, tileY)` no asset de forma persistente.                                            |
| **Classificação de CHR**    | `src/core/chr-pattern-table.ts`       | `classifyChrSlots` percorre 0..511 e classifica `occupancy: 'base' \| 'project' \| 'reserved' \| 'empty'`. Gera `attribution` como string concatenada.                                            | Atribuição é formatada puramente para apresentação humana (UI). Impossível realizar buscas estruturadas ou queries relacionais.                                             |
| **Coleta de Referências**   | `src/core/chr-pattern-table.ts`       | `collectPhysicalTileReferences` gera array de `ChrTileReference` sob demanda varrendo o modelo em memória.                                                                                        | Excelente base de partida, mas restrita à leitura transiente no Inspetor de Tile; não faz parte de um motor de mapeamento centralizado.                                     |
| **CHR Tile Editor**         | `src/core/chr-project-integration.ts` | `resolveTileEditOrigin` usa `collectPhysicalTileReferences` para inferir se um clique físico em `0..511` deve atualizar `animation.pixelOverrides`, `project.pixelOverrides` ou `destinationChr`. | A inferência assume o primeiro consumidor encontrado como destino de edição, o que pode causar efeitos colaterais silenciosos em tiles compartilhados por múltiplos assets. |
| **Scene Preview**           | `src/core/scene-preview.ts`           | Posiciona instâncias de entidades na cena (`SceneEntityInstance`) consumindo animações compiladas.                                                                                                | Desconectado do mapeamento físico de tiles; consome apenas o modelo de animação em alto nível.                                                                              |

---

## 4. Matriz de Produtores e Consumidores

A tabela abaixo detalha todas as origens (produtores) e destinos (consumidores) de tiles no sistema atual:

| Produtor                                              | Consumidores Típicos                                          | Identidade Lógica                             | Identidade Física                              | Sobrevive a Save/Reload?                       | Mecanismo de Reconstrução                                       | Riscos Identificados                                                                                  |
| :---------------------------------------------------- | :------------------------------------------------------------ | :-------------------------------------------- | :--------------------------------------------- | :--------------------------------------------- | :-------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------- |
| **Tileset PNG** (`tileset.asset`)                     | Tileset Workspace, Exportador `.chr`/`.pal`                   | `tile.id` (0..N sequencial na imagem)         | `0..N` ou offset com Base CHR                  | Sim (via imagem e pixelOverrides)              | Determinístico: re-extrai e deduplica na inicialização.         | Substituir PNG pode alterar IDs de tiles sem aviso se dimensões mudarem.                              |
| **Playfield PNG** (`playfield.asset`)                 | Playfield Nametable, Exportadores `.nam`/`.atr`               | `tile.id` na imagem 256×240                   | `0..255` em PT0/PT1 mapeado na Nametable       | Sim (via imagem e collisionCells)              | Determinístico: re-extrai, deduplica e regenera Nametable.      | Re-quantização pode alterar índices locais `$00..$FF` consumidos pela Nametable.                      |
| **Spritesheet PNG** (`animation.animations[i].asset`) | Metasprites de Frames, Scene Preview, Exportadores C/ASM/JSON | Coordenada na grade `(tileX, tileY)` no frame | `physicalTileIndex` (0..511) gravado no sprite | Sim (via imagem, frames e pixelOverrides)      | Determinístico: `buildAnimationProjectModel` remonta slots.     | Excluir animação que produziu tile compartilhado pode invalidar referências em outras animações.      |
| **Base CHR Import** (`destinationChr`)                | Todos os modos (Tileset, Playfield, Animação)                 | Offset linear de 16 bytes (`0..511`)          | Posição física exata (`0..511`)                | Sim (bytes Base64 em `destinationChr.dataUrl`) | Direto: carrega buffer binário na memória.                      | Edição no CHR Editor altera bytes diretamente, sem histórico em relação ao arquivo original no disco. |
| **CHR Tile Editor** (Edição Manual)                   | O próprio slot e todos os seus consumidores                   | `PixelOverrideKey` (`animId:x:y` ou `tileId`) | Slot físico selecionado `0..511`               | Sim (`pixelOverrides` ou `destinationChr`)     | `applyChrTileEdit` aplica overrides sobre os buffers extraídos. | Editar slot compartilhado afeta todos os frames sem aviso prévio de múltiplos usos.                   |
| **Deduplicação Cross-Asset**                          | Metasprites de múltiplos assets                               | `flipInvariantTileKey` / hash de pixels       | Slot físico do primeiro asset alocado          | Sim (recalculado pelo allocator)               | Recalculado em tempo de execução na compilação do modelo.       | A ordem de alocação das animações determina quem é o "produtor" físico do slot.                       |

---

## 5. Problemas Arquiteturais Identificados (Rankeados por Risco)

### Problema 1: Atribuição Implícita e Baseada em Strings (Risco Crítico)

- **Diagnóstico:** As funções de classificação de CHR geram labels de texto livre para a interface (ex.: `attribution: "Hero (#0)"`). Não há tipagem estruturada de proveniência (`assetId`, `logicalCoordinates`, `creationKind`).
- **Impacto:** Impossibilidade de construir validações confiáveis de integridade, diagnósticos estruturados de dependência e navegação semântica no Inspetor de Tiles.

### Problema 2: Dessincronização na Substituição de PNGs (Risco Alto)

- **Diagnóstico:** Quando o usuário substitui um arquivo PNG de spritesheet por uma versão atualizada com dimensões diferentes ou distribuição de frames alterada, os `pixelOverrides` antigos permanecem vinculados a coordenadas que podem não fazer mais sentido ou cair fora dos limites da imagem.
- **Impacto:** O projeto pode acumular overrides fantasmas ou falhar silenciosamente ao renderizar frames modificados.

### Problema 3: Ambiguidade na Exclusão de Assets com Tiles Compartilhados (Risco Alto)

- **Diagnóstico:** Se a Animação A alocou o tile físico `$10` e a Animação B deduplicou contra ele, a exclusão da Animação A não possui um protocolo claro: o tile físico `$10` é desalocado (quebrando B), ou B assume a posse física do slot?
- **Impacto:** Risco de corrupção visual em tempo de edição ou geração de tiles órfãos indevidos.

### Problema 4: Falta de Transparência no CHR Tile Editor para Slots Reutilizados (Risco Médio)

- **Diagnóstico:** Ao clicar em um tile físico na Memória CHR e usar a ferramenta Lápis/Borracha, `resolveTileEditOrigin` escolhe o primeiro consumidor retornado por `collectPhysicalTileReferences`. Se o tile for compartilhado por 4 frames diferentes, todos os 4 são alterados simultaneamente sem que o usuário tenha sido informado dessa multiplicidade de usos.
- **Impacto:** Modificações acidentais em frames que o usuário não pretendia alterar.

### Problema 5: Assimetria na Identidade de Assets entre Modos (Risco Médio)

- **Diagnóstico:** `AnimationItemSetting` possui `id: string`, mas os modos Tileset e Playfield tratam a imagem como um campo anônimo único `asset`. Isso impede a criação de rotinas unificadas de gestão de ciclo de vida de assets (`addAsset`, `replaceAsset`, `removeAsset`).
- **Impacto:** Duplicação de código de gestão de imagens e divergência de comportamento entre workspaces.

---

## 6. Modelo de Domínio Recomendado

Propomos um modelo de domínio baseado na **unificação da identidade lógica de assets**, **estruturação formal da proveniência (Origem)** e **índice derivado bidirecional de alta performance**.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Entidades do Domínio                               │
├─────────────────────────────────────────────────────────────────────────────┤
│ ProjectAsset (Identidade Lógica Persistida)                                 │
│  ├── id: string (UUID ou 'asset-hero-spritesheet')                          │
│  ├── name: string                                                           │
│  ├── kind: 'spritesheet' | 'tileset-image' | 'playfield-image' | 'base-chr' │
│  └── reference: ProjectAssetReference                                       │
│                                                                             │
│ LogicalTileDefinition (Coordenada Canônica de Origem)                       │
│  ├── assetId: string                                                        │
│  ├── tileX: number (0..W-1)                                                 │
│  ├── tileY: number (0..H-1)                                                 │
│  └── key: LogicalTileKey (`${assetId}:${tileX}:${tileY}`)                  │
│                                                                             │
│ TileOrigin (Proveniência Primária de um Slot Físico)                        │
│  ├── primaryAssetId: string                                                 │
│  ├── primaryLogicalKey: LogicalTileKey                                      │
│  ├── creationKind: 'extracted' | 'base-chr' | 'manual-editor'               │
│  └── allocatedAt: number (timestamp ou ordem de alocação)                   │
│                                                                             │
│ TileUsage (Consumo Ativo de um Slot Físico)                                 │
│  ├── type: 'animation-sprite' | 'playfield-cell' | 'tileset-tile'           │
│  ├── consumerId: string (ex: animationId, nametableIndex)                   │
│  ├── context: string (ex: 'Hero / Run / Frame 2')                           │
│  ├── flip: { h: boolean; v: boolean }                                       │
│  └── physicalTileIndex: number (0..511)                                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.1 Definições Tipadas em TypeScript

```ts
/** Identificador estável de asset de projeto */
export type ProjectAssetId = string;

/** Chave canônica de tile lógico: `${assetId}:${tileX}:${tileY}` */
export type LogicalTileKey = string;

/** Tipos de assets suportados pelo domínio */
export type ProjectAssetKind =
  'spritesheet' | 'tileset-image' | 'playfield-image' | 'base-chr';

/** Metadados canônicos de um asset do projeto */
export interface ProjectAsset {
  readonly id: ProjectAssetId;
  readonly name: string;
  readonly kind: ProjectAssetKind;
  readonly reference: ProjectAssetReference;
}

/** Proveniência / Posse original de um slot físico na CHR-ROM */
export interface PhysicalTileOrigin {
  readonly physicalIndex: number;
  readonly patternTable: 0 | 1;
  readonly primaryAssetId: ProjectAssetId;
  readonly primaryAssetName: string;
  readonly logicalKey?: LogicalTileKey;
  readonly sourceCoordinates?: {
    readonly tileX: number;
    readonly tileY: number;
    readonly pixelX: number;
    readonly pixelY: number;
  };
  readonly creationKind: 'extracted' | 'base-chr' | 'manual-materialized';
}

/** Uso de tile por frame de animação (Metasprite) */
export interface AnimationTileUsage {
  readonly type: 'animation';
  readonly assetId: ProjectAssetId;
  readonly entity?: string;
  readonly animationId: string;
  readonly animationName: string;
  readonly frameIndex: number;
  readonly spriteIndex: number;
  readonly x: number;
  readonly y: number;
  readonly horizontalFlip: boolean;
  readonly verticalFlip: boolean;
  readonly physicalTileIndex: number;
  readonly logicalKey?: LogicalTileKey;
}

/** Uso de tile por célula de Nametable (Playfield) */
export interface PlayfieldTileUsage {
  readonly type: 'playfield';
  readonly assetId: ProjectAssetId;
  readonly column: number;
  readonly row: number;
  readonly nametableIndex: number;
  readonly localTileIndex: number;
  readonly physicalTileIndex: number;
}

/** Uso de tile por entrada de catálogo (Tileset) */
export interface TilesetTileUsage {
  readonly type: 'tileset';
  readonly assetId: ProjectAssetId;
  readonly tileIndex: number;
  readonly sourceIndex?: number;
  readonly physicalTileIndex: number;
}

/** União discriminada de todos os usos de tiles no projeto */
export type PhysicalTileUsage =
  AnimationTileUsage | PlayfieldTileUsage | TilesetTileUsage;

/** Visão agregada completa de um slot físico na CHR-ROM */
export interface PhysicalSlotAttribution {
  readonly physicalIndex: number;
  readonly localIndex: number;
  readonly patternTable: 0 | 1;
  readonly occupancy: 'empty' | 'project' | 'base' | 'reserved';
  readonly origin?: PhysicalTileOrigin;
  readonly usages: readonly PhysicalTileUsage[];
  readonly isShared: boolean;
  readonly referenceCount: number;
  readonly regions: readonly ChrRegion[];
  readonly isReserved: boolean;
}

/** Índice bidirecional compilado de mapeamento de CHR */
export interface ChrAssetMappingIndex {
  /** Busca atribuição completa por índice físico (0..511) */
  readonly byPhysicalIndex: readonly PhysicalSlotAttribution[];
  /** Busca slots físicos associados a um asset lógico */
  readonly physicalIndicesByAsset: ReadonlyMap<
    ProjectAssetId,
    ReadonlySet<number>
  >;
  /** Busca usos por chave lógica de tile */
  readonly usagesByLogicalKey: ReadonlyMap<
    LogicalTileKey,
    readonly PhysicalTileUsage[]
  >;
  /** Contagem de slots órfãos do projeto */
  readonly orphanPhysicalIndices: ReadonlySet<number>;
}
```

### 6.2 Separação entre Estado Persistido e Estado Derivado

Para respeitar as diretrizes de integridade arquitetural do repositório:

1. **Estado Persistido (`StudioProject`):**
   - Armazena exclusivamente a **fonte canônica de verdade**: arquivos de assets com `id`, definições de animação com durações e metadados, pixel overrides, atribuições de paleta e `chrRegions`.
   - **NUNCA** serializa o array de `PhysicalSlotAttribution` ou tabelas de mapeamento físico pré-calculadas.
2. **Estado Derivado em Runtime (`ChrAssetMappingIndex`):**
   - Construído por uma função pura `buildChrAssetMappingIndex(...)` em `src/core/chr-asset-mapping.ts` a partir do projeto ativo.
   - Executa em < 5ms para 512 slots e pode ser armazenado em cache no `ProjectView` durante o ciclo de renderização.

---

## 7. Semântica de Posse e Uso em Cenários Reais

### Cenário 1: Deduplicação Interna no mesmo Spritesheet

- **Situação:** O asset `hero.png` possui dois frames de animação (`idle` frame 0 e `idle` frame 1). A bota do personagem (8×8 pixels) é idêntica nos dois frames.
- **Comportamento:**
  - O slot físico `$05` é alocado na Pattern Table 0.
  - **Origem:** `primaryAssetId = 'asset-hero'`, `logicalKey = 'asset-hero:0:2'` (coordenada do primeiro frame).
  - **Usos:** Contém 2 itens:
    1. `Hero / idle / Frame 0 / Sprite 2` (`x: 0, y: 16`, flip: normal).
    2. `Hero / idle / Frame 1 / Sprite 2` (`x: 0, y: 16`, flip: normal).
  - `isShared = true`, `referenceCount = 2`.

### Cenário 2: Deduplicação Cruzada entre Assets Distintos

- **Situação:** O asset `hero.png` alocou o tile `$08`. O asset `enemy.png` contém um efeito de partícula de 8×8 pixels com os mesmos valores de pixels 2bpp.
- **Comportamento:**
  - O allocator identifica o padrão em `$08` e reutiliza o slot físico.
  - **Origem:** `primaryAssetId = 'asset-hero'` (foi o primeiro alocador).
  - **Usos:** Contém 2 itens de assets distintos:
    1. `Hero / walk / Frame 3 / Sprite 0` (`assetId = 'asset-hero'`).
    2. `Enemy / spawn / Frame 0 / Sprite 1` (`assetId = 'asset-enemy'`).
  - O Inspetor de Tiles exibe com clareza: _"Origem: Hero Spritesheet | Usado por: Hero (1 ref), Enemy (1 ref)"_.

### Cenário 3: Reutilização de Base CHR

- **Situação:** O projeto carrega uma `Base CHR` com fontes de texto nos slots `$00..$3F`. Uma animação de interface usa o caractere de exclamação `!` no slot `$21`.
- **Comportamento:**
  - **Origem:** `primaryAssetId = 'asset-base-chr'`, `creationKind = 'base-chr'`, `physicalIndex = 33`.
  - **Usos:**
    1. `Base CHR` (posse nativa).
    2. `UI_Alert / flash / Frame 0 / Sprite 0` (`physicalTileIndex = 33`).
  - `occupancy = 'base'`.

### Cenário 4: Edição no CHR Tile Editor em Slot Compartilhado

- **Situação:** O usuário clica no slot `$05` (compartilhado por `Hero` e `Enemy`) e edita 3 pixels com o Lápis.
- **Comportamento:**
  - O editor consulta a Origem: `primaryAssetId = 'asset-hero'`, `logicalKey = 'asset-hero:0:2'`.
  - O sistema aplica a substituição em `hero.pixelOverrides`.
  - Na compilação seguinte:
    - Se `Hero` e `Enemy` continuarem idênticos (override aplicado em ambos ou sincronizado), mantêm o slot compartilhado.
    - Se apenas o `Hero` teve seus pixels alterados, o allocator detecta a divergência: `Hero` continua no slot `$05` (com o novo desenho), e `Enemy` é automaticamente realocado para um novo slot livre (ex.: `$14`), **sem quebrar o visual de nenhum dos dois**.

---

## 8. Ciclo de Vida dos Assets (Asset Lifecycle)

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Ciclo de Vida de Assets                          │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. ADD:                                                                     │
│    Gera assetId -> Extrai Logical Tiles -> Busca Dedup -> Aloca Slots       │
│                                                                             │
│ 2. REPLACE (Substituição de PNG):                                           │
│    Mapeia novos tiles -> Preserva Overrides válidos -> Realoca CHR          │
│    -> Libera slots que ficaram sem uso (Garbage Collection)                 │
│                                                                             │
│ 3. REMOVE:                                                                  │
│    Remove Usos do Asset -> Verifica outros consumidores                    │
│    ├── Se referenceCount == 0: Libera slot físico                           │
│    └── Se referenceCount > 0: Transfere Origem para o próximo consumidor    │
│                                                                             │
│ 4. EDIT (CHR Editor):                                                       │
│    Aplica Pixel Override na Origem -> Re-quantiza -> Atualiza Mapeamento    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 8.1 Protocolo de Adição (Add)

1. Atribui um `assetId` estável (ex.: `asset-anim-walk-5f8a`).
2. Extrai a grade de tiles de 8×8 pixels.
3. Para cada tile lógico:
   - Verifica se coincide com tile existente (Base CHR ou outro asset do projeto).
   - Se coincidir: registra novo `TileUsage` apontando para o slot físico já existente.
   - Se não coincidir: encontra o próximo slot livre na Pattern Table ativa (pulando `Reservations`), aloca o slot e registra a `TileOrigin` e o `TileUsage`.

### 8.2 Protocolo de Substituição (Replace)

Quando o usuário atualiza um arquivo de imagem (mantendo o mesmo `assetId`):

1. Re-extrai a nova matriz de tiles.
2. Invalida `pixelOverrides` cujas coordenadas `(tileX, tileY)` estejam além das novas dimensões.
3. Re-executa a alocação e deduplicação.
4. **Coleta de Lixo Automática (Garbage Collection):** Slots físicos que pertenciam exclusivamente ao asset substituído e não são mais utilizados por nenhum frame são devolvidos ao estado `empty` (16 bytes de `$00`).

### 8.3 Protocolo de Remoção (Remove)

Quando uma animação ou asset é deletado:

1. Remove todas as instâncias de `TileUsage` vinculadas àquele `assetId`.
2. Para cada slot físico anteriormente utilizado por ele:
   - Se `usages.length === 0`: o slot é liberado (`empty`), permitindo reutilização imediata.
   - Se `usages.length > 0`: o slot **continua alocado** para atender aos demais consumidores. A `TileOrigin` é deterministicamente transferida para o primeiro consumidor remanescente.

---

## 9. Estratégia de Persistência e Evolução de Schema

### Recomendação Formal: Manter `formatVersion: 1`

Auditamos exaustivamente o schema de persistência `.p2c` em `src/core/project.ts` e concluímos que **NÃO é necessário incrementar para `formatVersion: 2`**:

1. **Retrocompatibilidade Aditiva:** Os campos de identidade de assets (`id`) e metadados adicionais em `StudioProject` podem ser introduzidos como propriedades opcionais sem quebrar a estrutura existente.
2. **Derivação Pura:** Como o índice de mapeamento (`ChrAssetMappingIndex`) é calculado deterministicamente em tempo de execução a partir dos dados do projeto, o arquivo `.p2c` não precisa armazenar tabelas físicas redundantes.
3. **Migração Transparente:** Ao deserializar um projeto legado no formato v1 sem IDs explícitos, a rotina `deserializeProject` injetará identificadores estáveis e previsíveis:
   - `tileset.asset` $\rightarrow$ `id: 'asset-tileset-default'`
   - `playfield.asset` $\rightarrow$ `id: 'asset-playfield-default'`
   - `animation.animations[i]` $\rightarrow$ reaproveita `anim.id` existente ou gera `asset-anim-${index}`
   - `destinationChr` $\rightarrow$ `id: 'asset-base-chr-default'`

---

## 10. Mapa de Integração com o Sistema

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Mapa de Integração Geral                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                               StudioProject                                 │
│                                    │                                        │
│                        buildChrAssetMappingIndex()                          │
│                                    │                                        │
│                                    ▼                                        │
│                          ChrAssetMappingIndex                               │
│              ┌─────────────────────┼─────────────────────┐                  │
│              ▼                     ▼                     ▼                  │
│       CHR Tile Inspector     CHR Memory Visuals     Diagnostics Hub         │
│       - Asset de Origem      - Filtro por Asset     - Tiles Órfãos          │
│       - Lista de Usos        - Realce de Posse      - Conflitos de Reserva  │
│       - Botões de Navegação  - Heatmap de Consumo   - Budgets de Entidade   │
└─────────────────────────────────────────────────────────────────────────────┘
```

1. **CHR Memory & Tile Inspector:**
   - O painel lateral do Inspetor de Tile exibirá a seção estruturada **"Asset Origin & References"**:
     - **Origin:** Nome do asset produtor, tipo (`spritesheet`, `base-chr`, `manual`), coordenada no PNG (`Col 2, Row 1`).
     - **Used by:** Lista rolável de todos os frames e células que utilizam o tile, com botão de atalho `[Jump to Frame]` que navega diretamente para o frame correspondente no Animation Editor.
     - **Sharing Badge:** Badge visual indicando se o tile é `Exclusive` (1 uso) ou `Shared` ($N$ usos).
2. **CHR Memory Workspace Overlay:**
   - Adição de filtro de realce no cabeçalho da Memória CHR: _Highlight by Asset_ (permite selecionar um asset específico no dropdown e destacar instantaneamente na grade 16×16 todos os slots físicos pertencentes a ele).
3. **CHR Regions & Reservations:**
   - Coexistência ortogonal e harmoniosa:
     - A **Região** indica a _partição de endereçamento PPU_ (ex.: `$00..$1F`).
     - O **Owner** indica o _recurso lógico_ (ex.: `Hero`).
     - O Inspetor exibe ambos simultaneamente sem conflito conceitual.
4. **Delivery & Export:**
   - Relatório de métricas de ocupação de CHR agrupado por Asset no workspace de entrega (ex.: `Hero: 24 tiles (9.3%)`, `Enemies: 48 tiles (18.7%)`, `HUD: 16 tiles (6.2%)`).

---

## 11. Estratégia de Migração e Retrocompatibilidade

- **Projetos Legados sem IDs:** Carregamento suave com geração determinística de IDs na deserialização (`deserializeProject`).
- **Preservação de Projetos Existentes:** Nenhum arquivo `.p2c` existente terá seu hash ou conteúdo alterado silenciosamente a menos que o usuário realize uma modificação explícita.
- **Projetos sem Base CHR:** Funcionamento 100% preservado.
- **Mapeamentos Inerentemente Desconhecidos:** Slots da Base CHR sem arquivo original de origem associado são classificados como `primaryAssetId: 'asset-base-chr'`, `creationKind: 'base-chr'`.

---

## 12. Riscos e Alternativas Rejeitadas

### Alternativa 1: Modelo de Posse Rígida 1-para-1 (Rejeitada)

- **Conceito:** Cada slot de CHR possui apenas 1 proprietário e só pode ser usado por ele.
- **Motivo da Rejeição:** Incompatível com o desenvolvimento para NES. Impede a deduplicação de tiles entre múltiplos frames e entidades, saturando os 256 tiles da Pattern Table quase imediatamente.

### Alternativa 2: Persistir a Tabela de Mapeamento Físico no JSON `.p2c` (Rejeitada)

- **Conceito:** Salvar explicitamente no JSON uma tabela de índices `{ physicalIndex: 5, assetId: 'hero' }`.
- **Motivo da Rejeição:** Cria uma **dupla fonte de verdade**. Se o usuário editar a imagem fora do estúdio ou alterar uma configuração de paleta, a tabela persistida entraria em descompasso com o resultado da re-quantização. O mapeamento derivado em runtime garante 100% de consistência.

### Alternativa 3: Incrementar para `formatVersion: 2` (Rejeitada)

- **Conceito:** Quebrar a compatibilidade de schema para forçar um formato novo.
- **Motivo da Rejeição:** Desnecessária. A especificação v1 acomoda propriedades opcionais com total segurança e sem impor migrações destrutivas aos usuários.

---

## 13. Plano de Implementação Ordenado

A Milestone 6 deve ser executada nas seguintes **6 fases sequenciais**:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                   Sequência Incremental da Milestone 6                      │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. Domínio & Tipos de Identidade de Assets (`src/core/`)                    │
│                                    │                                        │
│                                    ▼                                        │
│ 2. Motor de Mapeamento Bidirecional (`src/core/chr-asset-mapping.ts`)       │
│                                    │                                        │
│                                    ▼                                        │
│ 3. Ciclo de Vida Reativo & Descarte de Órfãos (`src/core/`, `src/ui/`)      │
│                                    │                                        │
│                                    ▼                                        │
│ 4. Inspetor Rico de Posse & Usos em CHR Memory (`src/ui/`)                  │
│                                    │                                        │
│                                    ▼                                        │
│ 5. Diagnósticos de Posse & Métricas por Asset (`src/ui/diagnostics.ts`)     │
│                                    │                                        │
│                                    ▼                                        │
│ 6. Integração Final, Testes de Regressão & Documentação                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 14. Issues Recomendadas para o GitHub

Recomendamos a decomposição da Milestone 6 nas seguintes **6 issues executáveis e ordenadas por dependência**:

---

### Issue 1: `core: project asset identity model and logical tile indexing`

- **Objetivo:** Estabelecer os tipos de domínio para identidade de assets lógicos (`ProjectAsset`, `ProjectAssetId`, `LogicalTileKey`) e garantir persistência/deserialização retrocompatível em `StudioProject`.
- **Escopo:**
  - Criar tipos em `src/core/chr-asset-types.ts`.
  - Atualizar `StudioProject` em `src/core/project.ts` para suportar metadados de assets opcionais.
  - Implementar migração/injeção de IDs determinísticos em `deserializeProject` para projetos legados.
  - Função pura `generateLogicalTileKey(assetId, tileX, tileY)`.
- **Dependências:** Nenhuma (Primeira issue da milestone).
- **Arquivos Afetados:** `src/core/project.ts`, `src/core/project.test.ts`, novos arquivos em `src/core/`.
- **Nível de Risco:** Baixo.
- **Riscos de Regressão:** Quebra de deserialização de projetos existentes salvos em `.p2c`.
- **Testes Obrigatórios:** Testes de round-trip de persistência com e sem IDs de assets, testes de migração de projetos legados v1.
- **Critérios de Aceite:**
  - Projetos sem IDs recebem IDs determinísticos ao carregar.
  - Projetos salvos mantêm integridade completa de schema.
  - Cobertura de 100% de testes unitários para geradores de chaves lógicas.

---

### Issue 2: `core: bidirectional tile mapping engine (origin, usages, sharing)`

- **Objetivo:** Criar o motor unificado de mapeamento bidirecional entre assets lógicos e slots físicos da CHR-ROM.
- **Escopo:**
  - Implementar `buildChrAssetMappingIndex(options)` em `src/core/chr-asset-mapping.ts`.
  - Mapear proveniência primária (`PhysicalTileOrigin`) para cada slot físico 0..511.
  - Mapear todos os usos ativos (`PhysicalTileUsage`) para Animações, Playfield e Tileset.
  - Detectar compartilhamento (`isShared`, `referenceCount`) e slots órfãos (`orphanPhysicalIndices`).
- **Dependências:** Issue 1.
- **Arquivos Afetados:** `src/core/chr-asset-mapping.ts`, `src/core/chr-pattern-table.ts`, `src/core/animation-model.ts`.
- **Nível de Risco:** Médio.
- **Riscos de Regressão:** Desacordo entre os índices gerados e as classificações de `classifyChrSlots`.
- **Testes Obrigatórios:** Testes cobrindo deduplicação interna, deduplicação cross-asset, reutilização de Base CHR e cálculo exato de `referenceCount`.
- **Critérios de Aceite:**
  - O índice responde instantaneamente a buscas por slot físico ou por asset.
  - Casos de deduplicação reportam corretamente múltiplos usos com o asset de origem original preservado.

---

### Issue 3: `core: asset lifecycle management (replace, remove, orphan detection)`

- **Objetivo:** Implementar os protocolos determinísticos de ciclo de vida de assets para adição, substituição de PNGs, exclusão e re-alocação segura.
- **Escopo:**
  - Função pura de re-mapeamento após substituição de PNG (diffing de tiles e limpeza de overrides inválidos).
  - Protocolo de transferência de posse quando o asset originador for removido mas outros ainda utilizarem o slot.
  - Protocolo de liberação de slots órfãos (`garbageCollection`).
- **Dependências:** Issues 1 e 2.
- **Arquivos Afetados:** `src/core/chr-asset-lifecycle.ts`, `src/core/chr-project-integration.ts`, `src/ui/animation-editor.ts`.
- **Nível de Risco:** Médio-Alto.
- **Riscos de Regressão:** Deletar acidentalmente tiles compartilhados ou deixar lixo gráfico persistido em CHR.
- **Testes Obrigatórios:** Testes de ciclo de vida completo (Add $\rightarrow$ Dedup $\rightarrow$ Remove Originador $\rightarrow$ Verify Slot Retention $\rightarrow$ Remove Last Consumer $\rightarrow$ Verify Slot Freed).
- **Critérios de Aceite:**
  - Excluir um asset não corrompe tiles compartilhados por outros assets.
  - Substituir uma imagem com resolução menor limpa overrides fora de limite.

---

### Issue 4: `ui: rich tile ownership and usage inspector in CHR Memory`

- **Objetivo:** Exibir a proveniência e a lista detalhada de usos no painel lateral do CHR Tile Inspector e permitir navegação direta para os frames consumidores.
- **Escopo:**
  - Atualizar `src/ui/chr-tile-inspector.ts` para renderizar a seção "Asset Origin & Usage References".
  - Exibir badge de compartilhamento (`Shared: 3 references` vs `Exclusive`).
  - Implementar botões de salto/navegação (`[Jump to Frame]`) com dispatch de evento de navegação para a sidebar.
  - Adicionar filtro de realce por asset no cabeçalho do CHR Memory workspace (`Highlight by Asset`).
- **Dependências:** Issues 2 e 3.
- **Arquivos Afetados:** `src/ui/chr-tile-inspector.ts`, `src/ui/chr-workspace.ts`, `src/style.css`, `src/i18n/translations.ts`.
- **Nível de Risco:** Médio.
- **Riscos de Regressão:** Problemas de layout/overflow em slots com muitos consumidores ou quebra de acessibilidade por teclado.
- **Testes Obrigatórios:** Testes de renderização DOM, testes de clique em botões de salto e testes de acessibilidade (ARIA e teclado).
- **Critérios de Aceite:**
  - O Inspetor exibe com clareza o asset de origem e todos os frames/células consumidores.
  - Clicar em `[Jump]` altera o workspace ativo e seleciona o frame no Animation Editor.

---

### Issue 5: `core & ui: ownership-based diagnostics and per-asset CHR metrics`

- **Objetivo:** Integrar diagnósticos semânticos baseados no grafo de posse e exibir métricas de consumo de CHR agrupadas por asset na tela de entrega.
- **Escopo:**
  - Adicionar diagnósticos em `src/ui/diagnostics.ts` e `src/core/chr-pattern-table.ts`:
    - `unreferenced-project-tile` (aviso neutro para tiles alocados sem uso ativo).
    - `asset-exceeds-budget` (se configurado limite de tiles por entidade/asset).
    - `stale-override-detected` (override órfão após substituição de imagem).
  - Exibir breakdown de consumo de CHR por asset em `src/ui/delivery-workspace.ts`.
- **Dependências:** Issues 2, 3 e 4.
- **Arquivos Afetados:** `src/ui/diagnostics.ts`, `src/ui/delivery-workspace.ts`, `src/i18n/translations.ts`.
- **Nível de Risco:** Baixo.
- **Riscos de Regressão:** Emissão de falsos positivos em diagnósticos existentes.
- **Testes Obrigatórios:** Testes de emissão de fatos de diagnóstico com severidades apropriadas e cálculos matemáticos de percentual de ocupação por asset.
- **Critérios de Aceite:**
  - A tela de entrega lista a porcentagem exata de CHR consumida por cada asset.
  - Diagnósticos alertam sobre inconsistências sem bloquear operações válidas.

---

### Issue 6: `quality: cross-mode regression testing, migration coverage and documentation`

- **Objetivo:** Realizar a auditoria final da Milestone 6, adicionar testes de regressão de ponta a ponta e atualizar toda a documentação técnica viva do repositório.
- **Escopo:**
  - Testes de regressão cobrindo fluxos cruzados (Tileset + Playfield + Animação + Base CHR + CHR Editor).
  - Atualizar `docs/arquitetura.md`, `docs/formatos-e-exportacao.md`, `docs/project-state-boundaries.md` e `README.md`.
  - Adicionar roteiro de smoke test dedicado para posse de tiles em `docs/stabilization-smoke-test.md`.
- **Dependências:** Issues 1 a 5.
- **Arquivos Afetados:** `docs/*`, `README.md`, `src/core/chr-project-integration.test.ts`.
- **Nível de Risco:** Baixo.
- **Riscos de Regressão:** N/A (Passe de qualidade).
- **Testes Obrigatórios:** Execução de `npm test`, `npm run lint`, `npx tsc -b`, `npm run build` e `npm run format:check`.
- **Critérios de Aceite:**
  - Todos os checks oficiais passam com 0 erros e 0 warnings.
  - Documentação reflete com 100% de fidelidade as implementações realizadas.

---

## 15. Conclusão

A arquitetura proposta para a **Milestone 6 — Tile Ownership & Asset Mapping** soluciona a falta de visibilidade sobre a proveniência e consumo de tiles sem comprometer o hardware do NES nem criar duplicações de fontes de verdade. Ao separar formalmente **Posse (Origem)** de **Uso (Consumo)** e derivar o mapeamento bidirecional sob demanda, o PNG2CHR Studio ganha rastreabilidade completa, diagnósticos ricos e segurança em todo o ciclo de vida dos assets gráficos.
