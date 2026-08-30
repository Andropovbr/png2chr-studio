# Investigação Técnica: CHR Regions & Reservations (Milestone 5)

**Status:** Implementado e Validado (Milestone 5 Concluída)  
**Data:** 25 de Agosto de 2026  
**Autores:** Equipe de Engenharia PNG2CHR Studio  
**Milestone Alvo:** [Milestone 5 — CHR Regions & Reservations](https://github.com/Andropovbr/png2chr-studio/milestone/6)  
**Documentos Relacionados:** [`docs/arquitetura.md`](../arquitetura.md), [`docs/formatos-e-exportacao.md`](../formatos-e-exportacao.md), [`docs/project-state-boundaries.md`](../project-state-boundaries.md), [`AGENTS.md`](../../AGENTS.md)

---

## 1. Resumo Executivo

O **PNG2CHR Studio** gerencia atualmente um espaço físico canônico de **8 KiB de CHR-ROM** (512 slots de tiles de 8×8 pixels, divididos em duas Pattern Tables de 4 KiB: PT0 e PT1). A alocação de tiles gerados a partir de imagens ou frames de animação ocorre de forma automática, sequencial ou baseada em deduplicação exata/flip-aware.

A **Milestone 5 — CHR Regions & Reservations** tem como objetivo introduzir no domínio e na interface do Studio a capacidade de:

1. **Nomear e delimitar faixas lógicas de CHR ("Regions"):** Organizar o espaço de tiles de acordo com a intenção do desenvolvedor NES (ex.: `$00–$1F: Player`, `$20–$7F: Enemies`, `$80–$BF: Background/HUD`).
2. **Reservar faixas para impedir alocação automática ("Reservations"):** Bloquear faixas específicas de slots para que os algoritmos automáticos de alocação de tiles (em Tileset, Playfield e Animação) as preservem intactas, mesmo quando os slots estiverem vazios (sem bytes gráficos).

### Diretrizes Centrais da Investigação

- **Zero regressão em projetos existentes:** Projetos salvos no formato `.p2c` sem regiões/reservas devem continuar carregando e operando com 100% de paridade com a versão atual.
- **Fidelidade estrita ao hardware NES:** A PPU do NES não possui conceito de "região" ou "reserva" — ela apenas lê bytes 2bpp nos endereços `$0000..$1FFF`. Portanto, regiões e reservas são **metadados de projeto** e **restrições do orquestrador de alocação**, não devendo poluir ou alterar os binários brutos `.chr` exportados (slots reservados vazios continuam sendo 16 bytes de `$00`).
- **Isolamento de Domínio (`src/core/`):** Toda a lógica de verificação de limites, cálculo de ranges físicos, detecção de conflitos e filtragem de slots candidatos deve residir em funções puras e testáveis sem dependência do DOM.
- **Sem antecipação prematura de complexidade:** Recursos avançados de runtime de mappers (como troca de bancos MMC3 ou streaming de CHR-RAM) permanecem explicitamente fora do escopo desta milestone, embora o modelo de dados seja desenhado para ser compatível com extensões futuras.

---

## 2. Estado Atual da Arquitetura

> Atualização da Issue #167: o compilador canônico usa a política explícita de
> Base CHR de `graphics.baseChr`; não infere disponibilidade a partir de bytes
> zero. As descrições históricas abaixo registram o comportamento dos fluxos
> anteriores à compilação project-wide. Regions continuam organizacionais e
> Reservations continuam bloqueando somente novas alocações automáticas.

### 2.1 Estrutura Física de CHR e Indexação

A PPU do NES endereça graficamente até 8 KiB de memória de padrões:

- **512 slots físicos de tiles** (índices `0..511`).
- **Dois bancos físicos de 4 KiB** (Pattern Tables):
  - **PT0:** Faixa PPU `$0000..$0FFF`, índices físicos `0..255`, offset de bytes `$0000..$0FF0`.
  - **PT1:** Faixa PPU `$1000..$1FFF`, índices físicos `256..511`, offset de bytes `$1000..$1FF0`.
- **Codificação Planar 2bpp:** Cada slot possui exatamente 16 bytes (8 bytes para o bitplane 0 e 8 bytes para o bitplane 1).

As conversões canônicas estão centralizadas em `src/core/chr-pattern-table.ts`:

- `physicalTileIndex(patternTable: 0 | 1, localIndex: 0..255): number`  
  Calcula `patternTable * 256 + localIndex`.
- `localPatternTableTileIndex(physicalIndex: 0..511): number`  
  Calcula `physicalIndex % 256` (produz o índice de 8 bits `$00..$FF` consumido por OAM e Nametables).
- `patternTableForPhysicalTile(physicalIndex: 0..511): 0 | 1`  
  Calcula `physicalIndex < 256 ? 0 : 1`.
- `patternTablePhysicalRange(patternTable: 0 | 1): [number, number]`  
  Retorna `[0, 255]` para PT0 ou `[256, 511]` para PT1.
- `computeTileAddressingMetadata(physicalIndex: 0..511): TileAddressingMetadata`  
  Calcula em tempo real índice físico (dec/hex), índice local (dec/hex), tabela PPU, coordenadas na grade 16×16 (`tileCol`, `tileRow`) e offsets de bytes na ROM (início, plano 0 e plano 1).

### 2.2 Modelo de Ocupação de Slots

Atualmente, o estado de cada um dos 512 slots físicos é classificado por `classifyChrSlots` em `src/core/chr-pattern-table.ts`:

```ts
export type ChrSlotOccupancy = 'empty' | 'project' | 'base' | 'reserved';
```

1. **`base` (CHR-Base Importada):**
   - Ocorre quando o projeto possui um buffer `destinationChr` (ou arquivo `.chr` importado).
   - A função `rawChrTileOccupied(baseChr, index)` inspeciona os 16 bytes do slot. Se ao menos um byte for diferente de zero (`byte !== 0`), o slot é marcado como ocupado pela base (`source: 'destination'`).
   - Se os 16 bytes forem todos zero, o slot da CHR-Base é considerado livre/vazio, permitindo que novos tiles do projeto sejam inseridos naquele espaço.
2. **`project` (Tile do Projeto):**
   - Ocorre quando o slot é referenciado por metasprites de animações (`AnimationModel`), por células da Nametable (`Playfield`), por tiles extraídos/deduplicados (`Tileset`) ou quando possui pixels desenhados via CHR Tile Editor.
   - Um tile deliberadamente transparente ou todo na cor 0 que pertença ao projeto é preservado como `project`, diferenciando-se de um slot não-alocado.
3. **`empty` (Livre / Não alocado):**
   - Espaço virgem na CHR-ROM de 8 KiB (16 bytes de `$00`).
4. **`reserved` (Reservado):**
   - O tipo já existe em `ChrSlotOccupancy` e o CSS já possui regras estilizadas (`.chr-tile-slot.is-occupancy-reserved` em `src/style.css`), porém `classifyChrSlots` **atualmente nunca emite esse estado** porque o projeto ainda não possui a estrutura de dados de reservas.

---

## 3. Mapa dos Fluxos de Alocação

Foi realizado um levantamento exaustivo de todos os módulos que escolhem ou produzem índices CHR no código atual:

| Módulo / Fluxo      | Arquivo Fonte                                                    | Entrada                                             | Algoritmo Atual de Alocação                                                                                                                                                                                                         | Respeita Pattern Table?                                                                                                      | Pode Sobrescrever / Reutilizar?                                                             |
| :------------------ | :--------------------------------------------------------------- | :-------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------ |
| **Tileset Mode**    | `src/ui/tileset-workspace.ts`, `src/core/chr-encoder.ts`         | Imagem PNG, atribuições de paleta, pixel overrides. | `extractTiles` ➔ `deduplicateTiles` (ou flip-aware) ➔ `composeChrWithAllocatedTiles` (se Base CHR) ou `padChrRom(encodeChr)`.                                                                                                       | Não estritamente: preenche sequencialmente a partir do índice físico 0.                                                      | Reutiliza tiles idênticos por deduplicação. Pula slots não-zero da Base CHR.                |
| **Playfield Mode**  | `src/core/playfield-encoder.ts`, `src/ui/playfield-workspace.ts` | Imagem 256×240, metatiles 16×16.                    | `extractTiles` ➔ `encodePlayfield` ➔ `deduplicateTileSet`. Produz Nametable de 960 bytes (`0..255`).                                                                                                                                | Assume tabela local (geralmente PT0). Erro se > 256 tiles únicos.                                                            | Reutiliza tiles por deduplicação exata na Nametable.                                        |
| **Animation Mode**  | `src/core/animation-model.ts`                                    | Spritesheets, frames, durações, pixel overrides.    | `buildAnimationProjectModel`: omite células transparentes, executa `findTileMatch` no range da tabela ativa. Se não encontrar, busca o primeiro slot onde `slot.tile === null` dentro de `patternTablePhysicalRange(patternTable)`. | **Sim, estritamente:** aloca apenas na `patternTable` selecionada (0 ou 1). Erro `pattern-table-capacity-overflow` se lotar. | Reutiliza tiles exatos ou espelhados (H/V/HV) dentro da mesma Pattern Table.                |
| **Base CHR Import** | `src/core/chr-pattern-table.ts`, `src/main.ts`                   | Arquivo `.chr` binário (4 KiB ou 8 KiB).            | `createPatternTableSlots`: mapeia blocos de 16 bytes não-zero em `slots[start + index]`. 4 KiB é posicionado em `destinationPatternTable * 256`.                                                                                    | Sim: 4 KiB vai para PT0 ou PT1; 8 KiB ocupa PT0 e PT1.                                                                       | Slots com bytes zero são considerados vazios e liberados para inserção de tiles do projeto. |
| **CHR Tile Editor** | `src/core/chr-project-integration.ts`                            | Edição direta de 64 pixels em slot físico `0..511`. | `applyChrTileEdit`: mapeia para `animation.pixelOverrides`, `project.pixelOverrides` ou grava 16 bytes em `destinationChr`. Se slot era `empty`, materializa na Base CHR (expandindo para 8 KiB se necessário).                     | Opera sobre o slot físico específico selecionado pelo usuário.                                                               | Modifica diretamente a fonte de verdade do tile editado.                                    |
| **Deduplicação**    | `src/core/tile-deduplication.ts`                                 | Array de `Tile` (64 pixels).                        | `deduplicateTileSet` gera mapa por `tilePixelKey`. `deduplicateTilesConsideringFlips` usa `flipInvariantTileKey`.                                                                                                                   | Não tem ciência de tabelas — opera puramente sobre a lista de tiles.                                                         | Reatribui IDs `0..N` para tiles únicos.                                                     |

---

## 4. Problemas e Riscos Encontrados

Durante a auditoria do código, identificamos 5 riscos arquiteturais críticos que a implementação da Milestone 5 deve prevenir:

### Risco 1: Duplicação de Algoritmos de Alocação de Slots

- `buildAnimationProjectModel` (em `src/core/animation-model.ts`) e `composeChrWithAllocatedTiles` (em `src/core/chr-pattern-table.ts`) possuem **loops independentes de busca de slots livres** (`slots.find(s => s.tile === null)`).
- _Impacto:_ Se as regras de exclusão de reservas forem implementadas apenas em um dos módulos, o modo Animação respeitará reservas enquanto o modo Tileset/Playfield as ignorará (ou vice-versa).
- _Solução:_ Centralizar a seleção de slots livres em uma função pura e compartilhada em `src/core/chr-pattern-table.ts`.

### Risco 2: Contaminação de Exportação por "Tiles Fantasma"

- Se uma reserva for representada como um tile fictício no array de slots, exportadores binários (`.chr`), geradores de metasprites e Nametables poderiam emitir dados espúrios ou contar slots reservados vazios como "tiles utilizados".
- _Impacto:_ Rompimento da compatibilidade byte-a-byte e desperdício de ROM.
- _Solução:_ Uma reserva vazia **nunca é um `Tile`**. Ela é apenas uma máscara de exclusão (`ReadonlySet<number>`) consultada durante a busca por candidatos a alocação.

### Risco 3: Conflito com Projetos Pré-Existentes que já Ocupam a Faixa

- O usuário pode abrir um projeto existente onde tiles já foram alocados em `$E0..$FF` e posteriormente definir uma reserva para `$E0..$FF`.
- _Impacto:_ Destruir ou mover silenciosamente os tiles alocados violaria a regra fundamental de integridade de dados (`AGENTS.md`).
- _Solução:_ O Studio **nunca deve realocar ou apagar tiles existentes silenciosamente**. A presença de tiles em uma faixa recém-reservada deve gerar um **diagnóstico de aviso (Warning)** claro, impedindo apenas _novas alocações automáticas_ naquela faixa.

### Risco 4: Ambiguidade entre Índices Físicos (`0..511`) e Locais (`$00..$FF`)

- Sprites OAM e Nametables endereçam tiles de 8 bits (`$00..$FF`), mas a CHR-ROM totaliza 512 tiles.
- _Impacto:_ Erros clássicos de off-by-256 ao salvar uma reserva como "tile 10" sem especificar se pertence a PT0 ou PT1.
- _Solução:_ O modelo canônico persistido deve armazenar explicitamente `patternTable: 0 | 1`, `startTile: 0..255` e `endTile: 0..255`.

### Risco 5: Conflito entre Materialização no Editor CHR e Reservas

- O CHR Editor permite ao usuário clicar e desenhar em qualquer slot livre da memória CHR.
- _Impacto:_ Se o usuário desenhar intencionalmente em um slot reservado, o editor deve bloquear a ação ou permitir a materialização manual?
- _Solução:_ Permitir a edição explícita do usuário (ação direta de autoria), porém sinalizando visualmente no inspetor que o slot pertence a uma faixa reservada. O bloqueio estrito aplica-se a **alocadores automáticos** (importação de imagem e geração de metasprites).

---

## 5. Alternativas de Modelo de Domínio

Avaliamos três abordagens estruturais para representar Regions e Reservations no domínio:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Alternativas de Modelagem de Domínio                     │
├────────────────────────────────┬────────────────────────────────────────────┤
│ Alternativa A (Recomendada)    │ Modelo Unificado: ChrRegion com 'kind'     │
│ Alternativa B                  │ Estruturas Separadas: Region e Reservation │
│ Alternativa C                  │ Bitmask / Conjunto de Índices Físicos      │
└────────────────────────────────┴────────────────────────────────────────────┘
```

### Comparativo Detalhado

| Critério                    | Alternativa A: Modelo Unificado (`ChrRegion`)                                                                                              | Alternativa B: Estruturas Separadas (`ChrRegion` + `ChrReservation`)                                                                                | Alternativa C: Bitmask / Slots Físicos (`number[]`)            |
| :-------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------- |
| **Definição de Tipos**      | `interface ChrRegion { id, name, patternTable, startTile, endTile, kind: 'region' \| 'reservation', notes? }`                              | `interface ChrRegion { id, name, patternTable, startTile, endTile }` e `interface ChrReservation { id, patternTable, startTile, endTile, reason? }` | `readonly reservedSlots: readonly number[]`                    |
| **Clareza Semântica**       | **Excelente:** Trata ambos como intervalos nomeados de Pattern Table, diferenciados pelo propósito (`kind`).                               | **Boa:** Separa rigidamente metadados visuais de restrições de alocador.                                                                            | **Ruim:** Perde nomes, intervalos e intenção do desenvolvedor. |
| **Persistência (`.p2c`)**   | **Simples:** Um único array `chrRegions: readonly ChrRegion[]` no root do projeto.                                                         | **Moderada:** Dois arrays separados (`chrRegions` e `chrReservations`).                                                                             | **Compacta**, mas opaca e inexpressiva.                        |
| **Complexidade de UI**      | **Baixa:** Um único painel "Region Manager" com filtro ou coluna de tipo. Formulário único de criação/edição.                              | **Alta:** Dois painéis ou duas listas separadas com formulários duplicados.                                                                         | **Muito Baixa**, porém sem UX amigável.                        |
| **Extensibilidade**         | **Alta:** Permite no futuro adicionar `kind: 'dynamic-bank'`, `kind: 'palette-shared'`, ou vincular `asset.preferredRegionId = region.id`. | **Média:** Exige reconciliação entre regiões que também são reservas.                                                                               | **Nula:** Não suporta metadados adicionais.                    |
| **Risco de Inconsistência** | **Baixo:** Um único validador de ranges e overlap.                                                                                         | **Médio:** Usuário pode criar uma Region e uma Reservation com o mesmo range e nomes conflitantes.                                                  | **Baixo**, mas sem valor semântico.                            |
| **Custo de Implementação**  | **Otimizado:** Menor duplicação de código em validadores, CRUD, formulários e testes.                                                      | **Elevado:** Duplicação de schemas, stores, formulários e testes.                                                                                   | **Baixo**, mas insuficiente para o produto.                    |

---

## 6. Modelo Recomendado

Recomendamos formalmente a **Alternativa A (Modelo Unificado)** com os seguintes tipos TypeScript em `src/core/chr-pattern-table.ts` e `src/core/project.ts`:

```ts
/**
 * Tipo de finalidade da região de CHR:
 * - 'region': Faixa nomeada puramente organizacional (informativa).
 * - 'reservation': Faixa reservada que bloqueia alocação automática de novos tiles.
 */
export type ChrRegionKind = 'region' | 'reservation';

export interface ChrRegion {
  /** Identificador único estável da região (ex.: 'reg_player_01'). */
  readonly id: string;
  /** Nome legível atribuído pelo usuário (ex.: 'Player', 'Enemies', 'HUD'). */
  readonly name: string;
  /** Tabela de padrões onde a região reside (0 = PT0 $0000, 1 = PT1 $1000). */
  readonly patternTable: 0 | 1;
  /** Índice local inicial (0..255, inclusive, correspondente a $00..$FF). */
  readonly startTile: number;
  /** Índice local final (0..255, inclusive, correspondente a $00..$FF, >= startTile). */
  readonly endTile: number;
  /** Finalidade funcional da faixa. */
  readonly kind: ChrRegionKind;
  /** Observações ou notas técnicas opcionais do desenvolvedor. */
  readonly notes?: string;
  /** Cor de destaque visual opcional para identificação na grade (ex.: '#00E5FF'). */
  readonly color?: string;
}
```

### Por que esta é a melhor escolha?

1. **Mentalidade do Desenvolvedor NES:** Para quem desenvolve jogos para o NES, o espaço de uma Pattern Table ($00..$FF) é tradicionalmente particionado em blocos nomeados. Alguns blocos são estáticos ("Player"), outros são dinâmicos ou de efeitos ("Reserved: Sprite Overlays").
2. **Código Mais Limpo e Conciso:** Um único validador (`validateChrRegion`), um único componente de formulário e uma única lista no gerenciador de regiões.
3. **Pronto para Futuros Vínculos:** Quando uma animação puder escolher sua região preferida (`animation.preferredRegionId`), basta associar o ID da `ChrRegion`, independentemente de ela ser do tipo `region` ou `reservation`.

---

## 7. Semântica de Region vs Reservation

A tabela a seguir define com precisão absoluta as regras de comportamento para cada combinação de estado de slot e região:

| Estado do Slot CHR                  | Dentro de `kind: 'region'`                                      | Dentro de `kind: 'reservation'`                                                                   | Fora de Regiões                         |
| :---------------------------------- | :-------------------------------------------------------------- | :------------------------------------------------------------------------------------------------ | :-------------------------------------- |
| **Vazio (`empty`)**                 | Disponível para alocação automática. Exibido com tag da região. | **INDISPONÍVEL para alocação automática.** Permanece como `$00` na exportação binária.            | Disponível para alocação automática.    |
| **Ocupado por Base CHR (`base`)**   | Preservado. Exibido como `Base CHR` dentro da região.           | Preservado. Alocador automático não toca nos slots vazios restantes da reserva.                   | Preservado.                             |
| **Ocupado por Projeto (`project`)** | Preservado. Exibido como `Tile do Projeto` dentro da região.    | Preservado. Gera diagnóstico de **Warning** informando que existem tiles na faixa reservada.      | Preservado.                             |
| **Deduplicação de Novo Tile**       | Alocador pode inserir novos tiles aqui se houver espaço livre.  | **Alocador NÃO pode alocar novos tiles aqui.**                                                    | Alocador pode inserir novos tiles aqui. |
| **Reúso de Tile já Existente**      | Pode ser referenciado normalmente por metasprites / Nametable.  | **Pode ser referenciado se o tile já existir fisicamente** (ex.: Base CHR). Não coloca novo tile. | Pode ser referenciado normalmente.      |
| **Edição Manual (CHR Editor)**      | Permitida normalmente.                                          | Permitida com aviso contextual no inspetor (autoria explícita do usuário).                        | Permitida normalmente.                  |

---

## 8. Estratégia de Índices

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Sistema de Coordenadas                            │
├──────────────────────────────┬──────────────────────────────────────────────┤
│ Persistido no Projeto (.p2c) │ patternTable (0|1) + startTile/endTile (0..255)│
├──────────────────────────────┼──────────────────────────────────────────────┤
│ Representação de Domínio     │ patternTable (0|1) + local/physical ranges   │
├──────────────────────────────┼──────────────────────────────────────────────┤
│ Apresentação na UI           │ PT0: $00–$1F (32 tiles) · PPU $0000–$01F0     │
└──────────────────────────────┴──────────────────────────────────────────────┘
```

### Funções Puras de Conversão Necessárias em `src/core/chr-pattern-table.ts`

```ts
/** Converte uma ChrRegion no intervalo fechado de índices físicos [start, end] (0..511). */
export function chrRegionPhysicalRange(
  region: ChrRegion,
): readonly [number, number] {
  const base = region.patternTable * NES_PATTERN_TABLE_TILE_COUNT;
  return [base + region.startTile, base + region.endTile];
}

/** Verifica se um índice físico (0..511) está contido em uma ChrRegion. */
export function isPhysicalTileInRegion(
  physicalIndex: number,
  region: ChrRegion,
): boolean {
  const [start, end] = chrRegionPhysicalRange(region);
  return physicalIndex >= start && physicalIndex <= end;
}

/** Retorna o conjunto imutável de todos os índices físicos (0..511) bloqueados por reservas ativas. */
export function collectReservedPhysicalTileIndices(
  regions: readonly ChrRegion[] = [],
  patternTable?: 0 | 1,
): ReadonlySet<number> {
  const reserved = new Set<number>();
  for (const region of regions) {
    if (region.kind === 'reservation') {
      if (patternTable === undefined || region.patternTable === patternTable) {
        const [start, end] = chrRegionPhysicalRange(region);
        for (let i = start; i <= end; i += 1) {
          reserved.add(i);
        }
      }
    }
  }
  return reserved;
}
```

---

## 9. Regras de Overlap e Conflitos

Para manter a experiência ágil sem criar travas desnecessárias, diferenciamos entre **erros estruturais (que bloqueiam a criação/edição)** e **avisos informativos (diagnósticos não-bloqueantes)**:

```
                  ┌─────────────────────────────────┐
                  │    Validação de Configuração    │
                  └────────────────┬────────────────┘
                                   │
         ┌─────────────────────────┴─────────────────────────┐
         ▼                                                   ▼
┌──────────────────┐                               ┌──────────────────┐
│  ERRO BLOQUEANTE │                               │  AVISO (WARNING) │
├──────────────────┤                               ├──────────────────┤
│ startTile > end  │                               │ Overlap parcial  │
│ Fora de 0..255   │                               │ Tiles em reserva │
│ Nome vazio       │                               │ PT quase cheia   │
└──────────────────┘                               └──────────────────┘
```

### Matriz de Decisão de Conflitos

| Cenário de Conflito                                            | Classificação        | Comportamento do Studio                                                                                                                                             |
| :------------------------------------------------------------- | :------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`startTile > endTile`** ou índices fora de `0..255`          | **Erro Bloqueante**  | Impede salvar a região no modal/formulário. Exibe mensagem de validação imediata.                                                                                   |
| **Nome vazio ou apenas espaços**                               | **Erro Bloqueante**  | Impede salvar. Nome é obrigatório para identificação.                                                                                                               |
| **ID duplicado**                                               | **Erro Bloqueante**  | Gera ID único automaticamente via UUID v4 ou `generateRegionId()`.                                                                                                  |
| **Reservation sobreposta a outra Reservation (mesma PT)**      | **Aviso (Warning)**  | Permitido. O validador emite diagnóstico: `Reserva "B" sobrepõe Reserva "A" na faixa PT0:$20-$3F`. O conjunto de slots bloqueados é a união dos intervalos.         |
| **Region sobreposta a outra Region (mesma PT)**                | **Aviso (Warning)**  | Permitido. Emite aviso de sobreposição se os nomes forem diferentes.                                                                                                |
| **Region sobreposta a Reservation (mesma PT)**                 | **Permitido / Info** | Completamente válido (ex.: nomear uma área organizacional que também é reservada).                                                                                  |
| **Tiles do projeto pré-existentes dentro de nova Reservation** | **Aviso (Warning)**  | Permitido. Não deleta tiles existentes. Emite: `A faixa reservada PT0:$E0-$FF contém 4 tiles alocados do projeto. Novas alocações automáticas evitarão esta faixa.` |
| **Base CHR dentro de Reservation**                             | **Permitido / Info** | Válido. Tiles da base são preservados; slots vazios dentro da base permanecem protegidos contra preenchimento automático.                                           |

---

## 10. Impacto no Allocator

### 10.1 Pipeline de Seleção de Slots Livres

O algoritmo consolidado de seleção de slots em `src/core/chr-pattern-table.ts` passará a operar com o filtro de reservas:

```
[ Início da Alocação de Novo Tile ]
               │
               ▼
[ Obter Slots da Pattern Table Ativa ] (PT0: 0..255 ou PT1: 256..511)
               │
               ▼
[ Coletar Conjunto de Índices Reservados ] (collectReservedPhysicalTileIndices)
               │
               ▼
[ Iterar Slots Físicos no Range da Tabela ]
   ├── Slot ocupado por Base CHR com dados?  ──► SIM ──► PULAR (Indisponível)
   ├── Slot ocupado por Tile do Projeto?      ──► SIM ──► PULAR (Indisponível)
   ├── Slot pertence ao Conjunto Reservado?   ──► SIM ──► PULAR (Indisponível para auto-alocação)
   └── Slot vazio e NÃO reservado?            ──► SIM ──► CANDIDATO SELECIONADO
               │
               ▼
[ Encontrou Slot Candidato? ]
   ├── SIM ──► Grava Tile no Slot Físico e marca source: 'imported'
   └── NÃO ──► Dispara Erro/Diagnóstico: pattern-table-capacity-overflow
```

### 10.2 Deduplicação vs. Reservas

Uma questão crucial analisada nesta investigação: **Se um tile idêntico já existir fisicamente na CHR dentro de uma faixa reservada, a deduplicação pode apontar para ele?**

- **Resposta e Recomendação:** **SIM.**
- **Justificativa:** A finalidade da Reservation é **não gravar novos tiles em slots protegidos**. Se o gráfico necessário já existe em um slot da Base CHR dentro da faixa reservada, emitir o índice desse tile no frame OAM ou na Nametable **não consome nem altera** o espaço reservado — apenas reutiliza a referência já existente.
- **Ressalva:** Slots reservados que estejam **vazios** (sem dados) nunca participam de deduplicação, pois não possuem pixels para correspondência.

---

## 11. Persistência e Migração

### 11.1 Alteração no Schema de `StudioProject`

Em `src/core/project.ts`, adicionamos o campo opcional `chrRegions`:

```ts
export interface StudioProject {
  readonly formatVersion: 1; // Mantido em 1 (extensão retrocompatível aditiva)
  readonly name: string;
  readonly mode: ProjectMode;
  readonly settings: {
    readonly deduplicationEnabled: boolean;
    readonly flipDeduplicationEnabled: boolean;
    readonly quantization: QuantizationSettings;
  };
  readonly palette: ProjectPaletteConfig;
  readonly chrRegions?: readonly ChrRegion[]; // NOVO CAMPO OPCIONAL
  readonly tileset?: ProjectTilesetConfig;
  readonly playfield?: ProjectPlayfieldConfig;
  readonly animation?: ProjectAnimationSettingsConfig;
  readonly scenePreview?: ProjectScenePreviewConfig;
}
```

### 11.2 Regras de Desserialização e Migração

Em `deserializeProject(jsonText)`:

- Se `raw.chrRegions` for omitido ou `undefined` (projetos legados v1.0.0 a v0.13.0): inicializa `chrRegions = []`.
- Se presente, sanitiza cada entrada (`id`, `name`, `patternTable`, `startTile`, `endTile`, `kind`, `notes`).
- **Comportamento Padrão:** Um projeto sem regiões/reservas configuradas comporta-se com **100% de paridade** com o sistema atual.
- **Formato Serializado (`.p2c`):** O serializador JSON emite `chrRegions` apenas quando houver ao menos uma região cadastrada, mantendo o arquivo limpo.

---

## 12. Impacto por Workspace

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             Impacto nos Modos                               │
├───────────────────┬─────────────────────────────────────────────────────────┤
│ Tileset Mode      │ Respeita reservas ao empacotar CHR bruta / deduplicada  │
├───────────────────┼─────────────────────────────────────────────────────────┤
│ Playfield Mode    │ Nametable respeita slots não-reservados                 │
├───────────────────┼─────────────────────────────────────────────────────────┤
│ Animation Mode    │ Metasprites pulam faixas reservadas na PT ativa         │
├───────────────────┼─────────────────────────────────────────────────────────┤
│ CHR Memory Hub    │ Hub central de visualização e edição de Regiões/Reservas│
├───────────────────┼─────────────────────────────────────────────────────────┤
│ Deliver Workspace │ Diagnósticos de capacidade e conflitos de reservas      │
└───────────────────┴─────────────────────────────────────────────────────────┘
```

1. **Modo Tileset:** O gerador de CHR empacota tiles do tileset apenas nos slots livres não-reservados da tabela de destino.
2. **Modo Playfield:** A Nametable mapeia metatiles evitando slots reservados. Se o número de tiles necessários exceder os slots não-reservados disponíveis, emite diagnóstico no painel de prontidão.
3. **Modo Animação:** `buildAnimationProjectModel` recebe a lista de `chrRegions`. Ao alocar novos tiles de metasprites, pula automaticamente qualquer slot contido em `collectReservedPhysicalTileIndices(chrRegions, patternTable)`.
4. **Workspace de Memória CHR:** Hospeda o novo painel **Region Manager** (`#section-chr-regions`) e renderiza os demarcadores visuais sobre as Pattern Tables PT0 e PT1.
5. **Workspace de Entrega (Deliver):** Avalia se há overflow ou saturação decorrente de reservas excessivas no painel de prontidão de exportação.

---

## 13. Proposta de Interface de Usuário (UI)

### 13.1 Visualização na Grade 16×16 de CHR Memory

As grades das Pattern Tables exibirão a sobreposição visual multi-modal:

```text
+-------------------------------------------------------------+
| Pattern Table 0 (PPU $0000..$0FFF)              214/256 occ |
+-------------------------------------------------------------+
| $00 [P][P][P][P] [P][P][P][P] [P][P][P][P] [P][P][P][P]     | <- Region: "Player" ($00-$1F)
| $10 [P][P][P][P] [P][P][P][P] [P][P][P][P] [P][P][P][P]     |
| $20 [E][E][E][E] [E][E][E][E] [E][E][E][E] [E][E][E][E]     | <- Region: "Enemies" ($20-$7F)
| ...                                                         |
| $C0 [ // ][ // ] [ // ][ // ] [ // ][ // ] [ // ][ // ]     | <- Reservation: "Dynamic Effects" ($C0-$DF)
| $D0 [ // ][ // ] [ // ][ // ] [ // ][ // ] [ // ][ // ]     |    (Textura diagonal / Badge "RES")
| $E0 [ . ][ . ]   [ . ][ . ]   [ . ][ . ]   [ . ][ . ]       | <- Free Slots ($E0-$FF)
+-------------------------------------------------------------+
Legenda: [P] Projeto  [E] Inimigo  [ // ] Reservado  [ . ] Livre
```

- **Slots Reservados Vazios:** Renderizados com textura hachurada sutil em diagonal (`background: repeating-linear-gradient(...)`), borda tracejada em tom violeta/magenta e badge acessível `aria-label="PT0 Tile $C0 (Reservado - Dynamic Effects)"`.
- **Slots Reservados com Tile:** Exibem o gráfico do tile com marcador de canto específico indicando pertencimento à reserva.
- **Seleção e Foco por Teclado:** Mantêm precedência visual máxima sobre a textura de reserva (`foco > seleção > reserva > heatmap > arte`).

### 13.2 Painel "Region Manager" (`#section-chr-regions`)

Localizado dentro do workspace de Memória CHR (`src/ui/chr-workspace.ts`), abaixo do visualizador de Pattern Tables:

```text
+-----------------------------------------------------------------------------------------+
| [v] Regiões e Reservas de CHR                                           [+ Nova Região] |
+-----------------------------------------------------------------------------------------+
| Nome        | Tipo        | Tabela | Faixa     | Total Slots | Ocupação     | Ações     |
+-------------+-------------+--------+-----------+-------------+--------------+-----------+
| Player      | Região      | PT0    | $00 - $1F | 32 tiles    | 28/32 (87%)  | [✎] [🗑]  |
| Enemies     | Região      | PT0    | $20 - $7F | 96 tiles    | 64/96 (66%)  | [✎] [🗑]  |
| Effects     | Reserva     | PT0    | $C0 - $DF | 32 tiles    | 0/32 (0%)    | [✎] [🗑]  |
| HUD & Font  | Região      | PT1    | $00 - $3F | 64 tiles    | 40/64 (62%)  | [✎] [🗑]  |
+-----------------------------------------------------------------------------------------+
```

### 13.3 Formulário / Modal de Criação e Edição

Controles convencionais, acessíveis e amigáveis ao desenvolvedor NES:

```text
+-------------------------------------------------------------+
| Criar Região / Reserva de CHR                               |
+-------------------------------------------------------------+
| Nome:           [ Player Sprites                   ]        |
| Tipo:           (o) Região Organizacional  ( ) Reserva      |
| Pattern Table:  [ PT0 ($0000)                    v ]        |
| Início (Hex):   [ $00 ]   (Decimal: 0)                      |
| Fim (Hex):      [ $1F ]   (Decimal: 31)                     |
| Total de Slots: 32 tiles (512 bytes)                        |
| Notas:          [ Sprites do herói principal      ]        |
|                                                             |
| [✓] Prévia: PT0 $00..$1F (Nenhum conflito detectado)       |
|                                                             |
|                         [ Cancelar ]  [ Salvar Região ]     |
+-------------------------------------------------------------+
```

- Entradas hexadecimais aceitam formatos flexíveis: `00`, `$00`, `0x00` com conversão síncrona para decimal.
- Validação ao vivo previne `startTile > endTile` ou valores `> $FF`.

---

## 14. Diagnostics (Matriz de Mensagens do Domínio)

| Código de Diagnóstico                    | Nível       | Mensagem de Exemplo                                                                                                              | Ação Recomendada                                                         | Bloqueia Operação?                               |
| :--------------------------------------- | :---------- | :------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------- | :----------------------------------------------- |
| `chr-region-invalid-range`               | **Error**   | `O tile inicial ($80) não pode ser maior que o tile final ($40).`                                                                | Ajustar os valores de início/fim.                                        | **Sim** (impede salvar região).                  |
| `chr-region-out-of-bounds`               | **Error**   | `O índice do tile ($120) ultrapassa o limite de 256 tiles da Pattern Table.`                                                     | Informar valor entre `$00` e `$FF`.                                      | **Sim** (impede salvar região).                  |
| `chr-capacity-exhausted-by-reservations` | **Error**   | `Não há slots livres suficientes na PT0: o projeto necessita de 48 tiles, mas apenas 32 slots não-reservados estão disponíveis.` | Reduzir o tamanho das reservas ou reativar slots.                        | **Sim** (impede build/exportação até resolução). |
| `chr-reservation-contains-project-tiles` | **Warning** | `A reserva "Effects" (PT0:$C0-$DF) contém 6 tiles do projeto já alocados. Novas alocações automáticas evitarão esta faixa.`      | Inspecionar os tiles na CHR Memory para confirmar se devem ser mantidos. | Não (informativo).                               |
| `chr-region-overlap`                     | **Warning** | `A região "Player" sobrepõe a região "Enemies" na faixa PT0:$20-$2F.`                                                            | Ajustar limites para evitar ambiguidade.                                 | Não (informativo).                               |
| `chr-region-near-capacity`               | **Warning** | `A região "Player" possui apenas 2 slots livres restantes (30/32 ocupados).`                                                     | Expandir a região ou otimizar tiles por deduplicação.                    | Não (informativo).                               |
| `chr-region-capacity-summary`            | **Info**    | `Região "Enemies": 64/96 tiles ocupados (32 livres).`                                                                            | Nenhuma ação necessária.                                                 | Não.                                             |

---

## 15. Impacto em Exportação

1. **Binários CHR (`.chr`):**
   - **Garantia de Não-Contaminação:** Regiões e reservas são metadados. Um arquivo `.chr` de 8 KiB exportado conterá exatamente os bytes dos tiles alocados e preencherá slots vazios (reservados ou não) com `0x00`.
   - **Compatibilidade Byte-a-Byte:** Dois projetos com a mesma arte e os mesmos tiles alocados produzirão binários `.chr` idênticos, independentemente de possuírem ou não regiões nomeadas.
2. **Código C (cc65) e ASM (ca65):**
   - Os exportadores de código continuam gerando as estruturas de animação e Nametables normalmente. Opcionalmente, em uma milestone futura, poderão emitir `#define REGION_PLAYER_START 0x00`. Na Milestone 5, os exportadores de código permanecem inalterados para estabilidade.
3. **Metadados JSON de Animação (`.json` v5):**
   - Permanece retrocompatível. Pode receber um campo opcional e aditivo `regions: [...]` sem quebrar parsers existentes de motores NES em C/Assembly.
4. **Projeto do Studio (`.p2c`):**
   - Persiste a lista integral de `chrRegions`.

---

## 16. Estratégia de Testes

Uma suíte completa de testes automatizados deverá acompanhar a futura implementação:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             Matriz de Testes                                │
├────────────────────────────────┬────────────────────────────────────────────┤
│ 1. Domínio & Indexação         │ - Ranges fechados de PT0 ($00..$FF) e PT1  │
│                                │ - Conversões physicalTileIndex e locais    │
│                                │ - collectReservedPhysicalTileIndices       │
├────────────────────────────────┼────────────────────────────────────────────┤
│ 2. Validações e Conflitos      │ - startTile > endTile rejeitado            │
│                                │ - Overlaps parciais e totais diagnosticados│
│                                │ - Detecção de tiles em faixas reservadas   │
├────────────────────────────────┼────────────────────────────────────────────┤
│ 3. Alocador com Reservas       │ - composeChr pulando slots reservados      │
│                                │ - buildAnimationModel pulando reservas     │
│                                │ - Erro de saturação ao esgotar não-reservas│
├────────────────────────────────┼────────────────────────────────────────────┤
│ 4. Deduplicação e Reúso        │ - Reúso de tile existente em reserva       │
│                                │ - Não-correspondência em reserva vazia     │
├────────────────────────────────┼────────────────────────────────────────────┤
│ 5. Persistência & Migração     │ - Round-trip .p2c com e sem chrRegions     │
│                                │ - Carga de projetos legados sem erro       │
├────────────────────────────────┼────────────────────────────────────────────┤
│ 6. Interface & CHR Memory      │ - Renderização de slots .is-occupancy-res  │
│                                │ - CRUD de regiões no Region Manager        │
│                                │ - Acessibilidade por teclado (roving tab)  │
│                                │ - Inspetor exibindo badges de região       │
└────────────────────────────────┴────────────────────────────────────────────┘
```

---

## 17. Fora de Escopo

Para manter a Milestone 5 enxuta, focada e entregável, os seguintes itens estão **explicitamente fora de escopo**:

- Suporte a mappers avançados (MMC1, MMC3, MMC5) ou troca dinâmica de bancos de CHR (_CHR bank switching_).
- Gerenciamento de CHR-RAM dinâmico ou streaming de tiles em tempo de execução.
- Repacking ou compactação global automática de CHR.
- Associação forçada de assets a regiões (ex.: `animation.preferredRegionId`) — o modelo aceita a extensão, mas a UI não exigirá nem implementará vínculo nesta etapa.
- Redimensionamento visual de regiões por drag-and-drop no Canvas (controles numéricos/hexadecimais são mais precisos e acessíveis).

---

## 18. Plano Incremental de Implementação

A execução da Milestone 5 deve seguir uma sequência rigorosa de dependências para garantir commits atômicos e revisões limpas:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                   Sequência Incremental de Implementação                    │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. Domínio & Persistência (Types, Ranges, Validadores, Schema .p2c)         │
│                                    │                                        │
│                                    ▼                                        │
│ 2. Allocator com Reservas (composeChr e buildAnimationModel unificados)     │
│                                    │                                        │
│                                    ▼                                        │
│ 3. Diagnósticos de Região & Reserva (Detecção de overlaps e saturação)      │
│                                    │                                        │
│                                    ▼                                        │
│ 4. Visualização em CHR Memory (Overlays de grade, texturas, acessibilidade) │
│                                    │                                        │
│                                    ▼                                        │
│ 5. Region Manager UI (Formulário, tabela CRUD, inputs hex, i18n)            │
│                                    │                                        │
│                                    ▼                                        │
│ 6. Integração Final, Testes de Regressão & Documentação Viva                │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 19. Issues Recomendadas para Concluir a Milestone 5

Recomendamos decompor a Milestone 5 nas seguintes **6 issues executáveis**:

### Issue 1: `core: domain model, validation and persistence for CHR regions & reservations`

- **Escopo:** Adicionar `ChrRegion`, `ChrRegionKind`, validadores de range, funções de range físico (`chrRegionPhysicalRange`, `collectReservedPhysicalTileIndices`) em `src/core/chr-pattern-table.ts`. Atualizar `StudioProject` e `deserializeProject` em `src/core/project.ts` com suporte retrocompatível a `chrRegions`.
- **Testes:** Testes unitários de validação, conversão de ranges e persistência round-trip em `src/core/chr-pattern-table.test.ts` e `src/core/project.test.ts`.

### Issue 2: `core: reservation-aware tile allocation in animation and composite CHR`

- **Escopo:** Atualizar `buildAnimationProjectModel` e `composeChrWithAllocatedTiles` para receber `reservedIndices` e ignorar slots reservados durante a busca por candidatos livres. Centralizar o predicado de slot elegível.
- **Testes:** Testes comprovando que novos tiles de animação e tileset pulam slots reservados e disparam erro correto ao saturar a capacidade não-reservada.

### Issue 3: `core: domain diagnostics for CHR region overlaps and capacity warnings`

- **Escopo:** Implementar detecção pura de conflitos (overlap de reservas, regiões sobrepostas, tiles existentes em reservas) e cálculo de métricas de ocupação por região. Conectar ao painel de diagnósticos em `src/ui/diagnostics.ts` e `src/ui/delivery-workspace.ts`.
- **Testes:** Testes de emissão e severidade de diagnósticos (info, warning, error).

### Issue 4: `ui: visual overlay for regions and reservations in CHR Memory workspace`

- **Escopo:** Atualizar `classifyChrSlots` para emitir `occupancy: 'reserved'` em slots vazios reservados. Renderizar texturas hachuradas e marcadores visuais no grid 16×16 de PT0 e PT1 (`src/ui/chr-workspace.ts` e `src/style.css`). Atualizar Inspetor de Tile (`src/ui/chr-tile-inspector.ts`) para exibir dados da região.
- **Testes:** Testes de DOM e acessibilidade (ARIA labels, legendas e contraste) em `src/ui/chr-workspace.test.ts` e `src/ui/chr-tile-inspector.test.ts`.

### Issue 5: `ui: region manager panel and interactive creation/editing form`

- **Escopo:** Criar o componente `RegionManagerPanel` em `src/ui/chr-workspace.ts` com listagem de regiões cadastradas, formulário de adição/edição com inputs hexadecimais `$00..$FF`, validação visual imediata, ações de exclusão e suporte completo a i18n (pt-BR e en).
- **Testes:** Testes de interação, teclado e despacho de atualizações de projeto via `onProjectUpdate`.

### Issue 6: `quality: workspace integration, cross-mode regression testing and documentation update`

- **Escopo:** Integrar o fluxo completo em `src/main.ts`. Executar testes cruzados entre Tileset, Playfield, Animação e CHR Memory. Atualizar `docs/arquitetura.md`, `docs/formatos-e-exportacao.md` e `README.md` refletindo as novas funcionalidades implementadas.
- **Testes:** Suíte completa de testes (`npm test`), linter (`npm run lint`), checagem de tipos (`tsc -b`) e build de produção (`npm run build`).

---

## 20. Decisões Arquiteturais Consolidadas na Milestone 5

As seguintes decisões técnicas foram validadas e consolidadas durante a implementação da Milestone 5:

1. **Localização do Region Manager:** Integrado como a seção `#section-chr-regions` dentro do workspace de **Memória CHR**, mantendo todo o gerenciamento de CHR-ROM e alocação centralizado em um único hub.
2. **Cores de Destaque:** Cores customizáveis via color picker HTML com sanitização de injeção CSS e valores padrão semânticos (`#38bdf8` para Region organizacional, `#a855f7` para Reservation restritiva).
3. **Escopo dos Metadados:** `chrRegions` é mantido estritamente como metadado de projeto no `.p2c`, sem contaminar os binários de exportação `.chr`, arquivos C/ASM ou metadados de animação JSON.
