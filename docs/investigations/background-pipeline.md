# Investigação Arquitetural e Especificação: Background Pipeline (Milestone 8)

**Data:** 2026-08-26  
**Milestone:** 8. Background Pipeline (Milestone #9)  
**Status:** Implementado & Validado  
**Autor:** Antigravity (Pair Programming AI)

---

## 1. Resumo Executivo e Contexto

Com a conclusão bem-sucedida das Milestones 5 (**CHR Regions & Reservations**), 6 (**Tile Ownership & Asset Mapping**) e 7 (**Sprite Sheet → CHR Integration**), o PNG2CHR Studio estabeleceu uma sólida fundação arquitetural de domínio:

1. **Identidades Lógicas e Chaves Canônicas:** `ProjectAssetId` estável e `LogicalTileKey` no formato canônico `${assetId}:${tileX}:${tileY}` desacoplado de alocações físicas;
2. **Índice de Mapeamento Bidirecional em Tempo de Execução:** `ChrAssetMappingIndex`, distinguindo formalmente proveniência primária (`PhysicalTileOrigin`) de múltiplos usos ativos (`PhysicalTileUsage`) sob o invariante $Origin \neq Usage$;
3. **Gerenciamento Físico de CHR-ROM (8 KiB):** Alocação unificada com suporte a isolamento de Pattern Table (PT0 vs PT1), preservação estrita de Base CHR e bloqueio de alocação automática via CHR Reservations;
4. **Exportadores como Serializadores Puros:** Exportadores de C (cc65), ASM (ca65), JSON v5 e binários brutos apenas serializam modelos de domínio resolvidos sem recalcular alocação ou deduplicação.

O objetivo da **Milestone 8 — Background Pipeline** foi estender essa mesma maturidade arquitetural para o pipeline de **Cenários, Mapas e Backgrounds (Nametables & Attribute Tables)** do NES. O pipeline de background foi construído reutilizando as abstrações canônicas de domínio já estabelecidas no projeto, sem criar subsistemas paralelos ou quebrar compatibilidade.

---

## 2. Decisões Arquiteturais Fundamentais

### 2.1 Decisão Crucial: Referências Lógicas vs. Índices Físicos CHR no Mapa

- **Questão:** O mapa/background deve persistir índices físicos CHR diretamente (`0..255`) ou referências lógicas a tiles (`LogicalTileKey` / índices lógicos de catálogo) resolvidas dinamicamente para posições físicas pelo pipeline de CHR?
- **Decisão:** **O mapa persiste referências lógicas a tiles ($Logical \neq Physical$).**
- **Justificativa:**
  1. Se o mapa persistisse índices físicos de CHR, qualquer mudança na alocação, inserção de Base CHR, reorganização de CHR Reservations ou deduplicação corromperia imediatamente o mapa ou exigiria mutações em cascata.
  2. Manter índices físicos no mapa criaria duas fontes de verdade conflitantes para a posição física dos tiles.
  3. A **Nametable física final (960 bytes de índices de 8 bits `0..255`)** é uma estrutura **puramente derivada em tempo de execução** gerada pelo compilador de background (`buildBackgroundProjectModel` / `allocateBackgroundChr`).

### 2.2 Hardware Invariant: Deduplicação Estritamente Exata (Sem Flips)

- No NES, as entradas da Nametable na PPU são bytes puros de 8 bits (`$00..$FF`) que endereçam a Pattern Table selecionada para o background (bit 4 de `PPUCTRL`).
- Ao contrário dos sprites OAM (que possuem bits de flip H/V no byte de atributo), os tiles de background **não podem ser espelhados por hardware**.
- Portanto, o alocador de CHR para backgrounds utiliza **estritamente deduplicação exata** (`ExactMatch`), rejeitando deduplicação com flip para gráficos de background.

### 2.3 Separação de Responsabilidades no Pipeline

O compilador de background opera de forma unidirecional e determinística:
$$\text{Background / Map Source} \longrightarrow \text{Logical Tiles \& Palette Grid} \longrightarrow \text{CHR Deduplication \& Allocation (PT0/PT1)} \longrightarrow \text{BackgroundProjectModel} \longrightarrow \text{Nametable (960B) + Attribute Table (64B) + Exporters}$$

---

## 3. Modelo de Domínio e Tipos de Dados

### 3.1 Tipos de Domínio (`src/core/background-model.ts`)

```typescript
export type BackgroundPatternTable = 0 | 1;

/** Entrada lógica de uma célula 8x8 na grade do mapa. */
export interface BackgroundMapCell {
  readonly logicalKey: LogicalTileKey;
  readonly tileX: number;
  readonly tileY: number;
  readonly sourceTileIndex?: number;
}

/** Configuração e dados de um mapa de background. */
export interface BackgroundMapDefinition {
  readonly id: string;
  readonly name: string;
  readonly widthTiles: number; // Padrão: 32
  readonly heightTiles: number; // Padrão: 30
  readonly patternTable: BackgroundPatternTable;
  readonly assetId?: ProjectAssetId;
  readonly asset?: ProjectAssetReference;
  readonly cells: readonly (BackgroundMapCell | null)[];
  readonly paletteAssignments: readonly number[]; // 240 entradas (16x15)
}

/** Célula física resolvida na Nametable compilada. */
export interface ResolvedNametableCell {
  readonly column: number;
  readonly row: number;
  readonly cellIndex: number; // 0..959
  readonly logicalKey: LogicalTileKey;
  readonly localTileIndex: number; // 0..255 (byte gravado na Nametable)
  readonly physicalTileIndex: number; // 0..511 na CHR-ROM de 8 KiB
  readonly paletteIndex: number; // 0..3
}

/** Modelo físico compilado do Background pronto para consumo por exporters e runtime. */
export interface BackgroundProjectModel {
  readonly map: BackgroundMapDefinition;
  readonly patternTable: BackgroundPatternTable;
  readonly nametable: Uint8Array; // 960 bytes
  readonly attributeTable: Uint8Array; // 64 bytes
  readonly fullMapBuffer: Uint8Array; // 1024 bytes (960B nametable + 64B attribute table)
  readonly resolvedCells: readonly (ResolvedNametableCell | null)[];
  readonly finalChr: Uint8Array; // 8192 bytes
  readonly newTileCount: number;
  readonly reusedBaseTiles: number;
  readonly reusedProjectTiles: number;
  readonly estimatedRomBytes: number;
}
```

---

## 4. Estratégias por Componente

### 4.1 Nametable (32×30 Tiles, 960 Bytes)

- **Resolução:** Para cada uma das 960 células da grade 32×30, o compilador mapeia o `LogicalTileKey` para o slot físico alocado na Pattern Table (`patternTable * 256 + localTileIndex`).
- **Validação de Limites:** Se a quantidade de tiles únicos necessários pelo background (somados aos tiles ocupados pelo Base CHR e bloqueados por CHR Reservations) exceder a capacidade de 256 tiles da Pattern Table, o compilador emite um erro estruturado `BackgroundModelError('background-capacity-overflow', { required, available })`.

### 4.2 Attribute Table (64 Bytes, Blocos de 16×16 Pixels)

- **Granularidade do Hardware:**
  - Cada byte da Attribute Table cobre uma área de **32×32 pixels** (4×4 tiles 8×8).
  - O byte é particionado em 4 quadrantes de **16×16 pixels** (2×2 tiles 8×8):
    $$\text{attribute\_byte} = (\text{pal}_{BR} \ll 6) \mid (\text{pal}_{BL} \ll 4) \mid (\text{pal}_{TR} \ll 2) \mid \text{pal}_{TL}$$
- **Representação Canônica:** O modelo mantém no projeto uma grade de **16×15 subpaletas** (`paletteAssignments: Uint8Array(240)`), permitindo edição e renderização natural de blocos 16×16. A função pura `encodeBackgroundAttributeTable` realiza o empacotamento nos 64 bytes físicos com padding correto na linha 15 (fora do viewport visível de 240px).

### 4.3 Paletas de Background

- O background utiliza as 4 subpaletas de background da PPU (`$3F00–$3F0F`):
  - Todas as 4 subpaletas compartilham a Cor Universal de Fundo no índice 0 (`$3F00`).
- Reutiliza integralmente o `palette.paletteSet` (matriz 4×4) e as `PaletteDefinition`s do projeto, sem duplicar o subsistema de paletas.

### 4.4 Integração com CHR Memory, Regions e Ownership

- O alocador de background (`allocateBackgroundChr`) respeita integralmente:
  1. **Base CHR:** Tiles pré-carregados na Pattern Table são identificados e reutilizados por deduplicação exata;
  2. **CHR Reservations:** Faixas reservadas (`kind: 'reservation'`) são estritamente puladas durante a alocação;
  3. **Asset Mapping:** Cada célula do background gera um `BackgroundTileUsage` no `ChrAssetMappingIndex`, vinculando a nametable ao Tile Inspector com coordenadas de origem preservadas.

---

## 5. Exportação (cc65 C, ca65 ASM, Binários e CHR)

Os exportadores de background são serializadores puros que recebem `BackgroundProjectModel`:

1. **Binários Puros:**
   - `.nam` — Nametable de 960 bytes (`0..255`);
   - `.atr` — Attribute Table de 64 bytes;
   - `.map` — Arquivo combinado de 1.024 bytes (960B nametable + 64B attribute table);
   - `.pal` — 16 bytes de paleta de background do NES;
   - `.chr` — Pattern Table de 4 KiB ou CHR-ROM de 8 KiB.
2. **Código C (cc65) (`.h` / `.c`):**
   - Constante `#define ${PREFIX}_BACKGROUND_PATTERN_TABLE <0|1>` para configurar o bit 4 de `PPUCTRL`;
   - Tabelas `const unsigned char ${prefix}_nametable[960]` e `const unsigned char ${prefix}_attribute_table[64]` em ROM.
3. **Código Assembly (ca65) (`.inc` / `.s`):**
   - Constante `${PREFIX}_BACKGROUND_PATTERN_TABLE = <0|1>`;
   - Diretivas `.byte` formatadas para nametable e attribute table.

---

## 6. Decomposição e Execução da Milestone 8

A milestone foi dividida em 6 issues implementadas e auditadas:

1. **#108 — Core Domain Model e Attribute Table Packing:** `BackgroundMapDefinition`, `encodeBackgroundAttributeTable`, `decodeBackgroundAttributeTable`, `resolveLogicalNametable`.
2. **#109 — CHR Allocation com Pattern Tables, Base CHR e Reservations:** `allocateBackgroundChr`, `findExactTileMatch`, `buildBackgroundProjectModel`.
3. **#110 — Project Schema Integration e Lifecycle:** `ProjectBackgroundSettingsConfig`, `reconcileBackgroundMaps`, pure serialization sem contaminação física.
4. **#112 — Exporters de Background:** `.nam`, `.atr`, `.map`, `.chr`, `.pal`, cc65 C (`.h`/`.c`), ca65 ASM (`.inc`/`.s`).
5. **#111 — Background Workspace e UI:** Edição visual 32×30, pintura de subpaleta 16×16, tile browser, zoom, overlays, atalhos de teclado e integração com Tile Inspector.
6. **#113 — Quality Pass, Auditoria Ponta a Ponta e Smoke Test:** Testes E2E, correção de navegação bidirecional, alinhamento de coordenadas de origem e sincronização de documentação.
