# CHR Editor

O CHR Editor fica no workspace **Memória CHR**. Selecione qualquer slot de PT0 ou PT1 para abrir o editor 8×8 no Inspetor de Tile. Ele altera a fonte canônica do projeto; não existe uma cópia paralela do tile apenas para a interface.

## Ferramentas e operações

- **Pencil:** grava o índice de cor ativo (`0..3`). Um drag inteiro gera um único passo de histórico.
- **Eraser:** grava o índice `0`, também com um único commit por drag.
- **Eyedropper:** lê o índice CHR do pixel selecionado. Ele não lê nem altera valores RGB.
- **Fill:** preenche uma região 4-conectada com o índice ativo.
- **Grid:** exibe ou oculta a grade visual 8×8. O overlay não recebe eventos de ponteiro e não entra no histórico.
- **Transform:** flip horizontal/vertical e rotação de 90° horária/anti-horária.
- **Shift:** move um pixel para cima, baixo, esquerda ou direita. Com **Wrap** ativo, os pixels reaparecem na borda oposta; sem Wrap, as novas posições recebem índice `0`.
- **Clear, Copy e Paste:** limpam o tile ou usam o clipboard interno de 64 índices do Studio.
- **Undo/Redo:** mantêm até 50 estados por tile.

Ferramenta, índice de cor, Grid e Wrap são estado transitório do workspace: sobrevivem às reconstruções da interface durante a edição, mas não são gravados no arquivo de projeto.

## Teclado e foco

Os atalhos só ficam ativos quando o foco está no CHR Editor ou em um de seus controles. Inputs, textareas, selects, áreas `contenteditable` e o restante da aplicação mantêm o comportamento nativo do navegador.

| Ação                                | Atalho                                        |
| ----------------------------------- | --------------------------------------------- |
| Pencil / Eraser / Eyedropper / Fill | `P` / `E` / `I` / `F`                         |
| Índice de cor                       | `0`, `1`, `2`, `3`                            |
| Undo                                | `Ctrl+Z` ou `Cmd+Z`                           |
| Redo                                | `Ctrl+Y`, `Ctrl+Shift+Z` ou `Cmd+Shift+Z`     |
| Copy / Paste interno                | `Ctrl+C` / `Ctrl+V` ou equivalentes com `Cmd` |
| Clear                               | `Delete` ou `Backspace`                       |

Os grupos de ferramentas, cores, transformações, shifts e ações usam roving tabindex: `Tab` entra uma vez em cada grupo; setas navegam pelos itens; `Home` e `End` vão ao primeiro e ao último controle disponível. No seletor de cor, as setas também selecionam o novo índice, conforme o padrão de `radiogroup`.

O canvas pode receber foco para que os atalhos permaneçam disponíveis. A edição pixel a pixel por setas e `Space`/`Enter` ainda não foi implementada; desenho, preenchimento e conta-gotas requerem mouse, caneta ou toque.

## Integração e persistência

O compilador de gráficos do projeto é a única fonte de posicionamento físico.
Memória CHR, classificação de slot, posse e resolução de edição consomem o
manifesto de alocação imutável da compilação atual; nunca simulam primeiro slot
livre, ordem contígua de Tileset/Playfield ou igualdade numérica entre índices.
Para slot reutilizado, o editor grava a origem lógica canônica registrada no
manifesto e o inspetor lista todos os usos. A edição não separa consumidores
silenciosamente. Reservas continuam política de alocação, não posse.

- **Tileset:** a edição atualiza `project.pixelOverrides` e recalcula os tiles derivados.
- **Background Maps:** o inspector mostra placement compilado, mas edição direta de
  tile permanece bloqueada até existir uma mutação segura do override do asset
  canônico; isso evita perda de alteração na próxima compilação.
- **Animação:** a edição atualiza os overrides da spritesheet de origem e seus previews.
- **CHR-Base:** os 16 bytes planares do slot são atualizados sem alterar os demais bytes.
- **Slot vazio:** a primeira alteração materializa o slot em `destinationChr`. Editar PT1 expande uma base de 4 KiB para 8 KiB somente quando necessário.
- **PT0/PT1:** o índice físico é `0..511`; o índice local visível ao OAM continua sendo `physicalIndex % 256` na pattern table ativa.

As edições canônicas são salvas no `.p2c.json` e restauradas ao reabrir o projeto. O histórico é mantido em memória por tile enquanto o usuário permanece no mesmo projeto e modo, inclusive ao voltar a um tile já editado. Ele é descartado ao criar ou carregar um projeto, trocar de modo ou encerrar a sessão; Undo/Redo não é persistido no arquivo.

## Inspeção de Origem e Uso do Asset (Tile Ownership)

No Inspetor de Tile do workspace **Memória CHR**, a seção **Origem e Uso do Asset** exibe a rastreabilidade completa e bidirecional do slot selecionado:

- **Endereço Físico:** Identificação do slot em PT0 ($0000..$0FFF) ou PT1 ($1000..$1FFF), com offset planar exato em bytes.
- **Origem do Asset:** Nome do asset primário, identificador canônico persistente (`ProjectAssetId`), coordenadas lógicas (`sourceCoordinates`) e chave canônica (`LogicalTileKey`).
- **Tipo de Criação:** Badges informativas indicando a proveniência:
  - `Extraído do asset` (`extracted`): Tile derivado de imagem ou spritesheet do projeto.
  - `CHR-Base` (`base-chr`): Tile pré-existente carregado do arquivo CHR-Base.
  - `Edição manual no CHR` (`manual-materialized`): Tile desenhado ou modificado diretamente no CHR Editor.
- **Status Compartilhado:** Badge de destaque para tiles reutilizados, diferenciando compartilhamento interno (mesmo asset) e compartilhamento entre múltiplos assets do projeto.
- **Usos no Projeto:** Lista estruturada de referências ativas:
  - **Animação:** Nome da animação, entidade, índice do quadro, índice do sprite, coordenadas e flags de espelhamento horizontal/vertical. Botão **Ir para origem** salta diretamente para o workspace de animação no quadro e animação corretos.
  - **Background Map:** Posição (coluna, linha), mapa e índice na Nametable.
  - **Tileset:** Índice do tile e coordenadas fonte.
- **Destacar Tiles do Asset:** Ação que aplica filtro de realce em todos os slots físicos pertencentes ao mesmo asset, com seletor correspondente na barra de ferramentas superior do visualizador CHR. O estado de realce é mantido em `WorkspaceState.chr.highlightedAssetId`.

## Métricas de Recursos CHR por Asset

O painel **Métricas e Recursos CHR por Asset** (`#section-chr-asset-metrics`) no workspace **Memória CHR** apresenta a contabilidade factual dos recursos de pattern table alocados para cada asset do projeto:

- **Slots Físicos Únicos:** Total de slots distintos ocupados pelo asset na memória CHR física (0..511).
- **Posse Primária vs. Consumo:** Distinção factual entre slots originados pelo asset (`primaryOwnedSlots`) e slots que o asset consome/referencia (`consumedSlots`).
- **Compartilhamento e Exclusividade:** Identificação de slots com deduplicação interna (`sharedSlots`), compartilhamento entre múltiplos assets distintos (`crossAssetSharedSlots`) e slots 100% dedicados exclusivamente ao asset (`exclusiveSlots`).
- **Proveniência de Origem:** Contagem de reutilização direta de Base CHR (`baseChrReusedSlots`) e de materializações manuais (`manualMaterializedSlots`).
- **Decomposição PT0 / PT1:** Divisão dos slots ocupados entre a Pattern Table 0 ($0000..$0FFF) e a Pattern Table 1 ($1000..$1FFF).
- **Ação Rápida:** Botão para destacar instantaneamente todos os tiles físicos do asset no grid CHR.

## Diagnósticos de Integridade de Mapeamento e Posse

O sistema avalia regras de integridade estrutural em tempo de execução sem modificar ou corromper os dados do projeto:

- **Tiles Órfãos Canônicos (`orphaned-project-tile`):** Alerta informativo quando um tile extraído de um asset não possui mais nenhum uso ativo no projeto (por exemplo, após edição ou desvinculação de quadro). Inclui botão de ação **Inspecionar Slot**.
- **Referências a Assets Inexistentes (`dangling-asset-usage`, `missing-origin-asset`):** Diagnóstico de erro caso algum registro de uso ou origem aponte para um ID de asset não registrado.
- **Inconsistências Físicas ou de Chave Lógica (`invalid-physical-mapping`, `invalid-logical-key`):** Validação contra índices fora dos limites de 0..511 ou incompatibilidades entre endereço planar e pattern table esperada.
- **Não Interferência:** Tiles compartilhados (`isShared === true`) e tiles de Base CHR/materializados manualmente não são incorretamente sinalizados como órfãos.

## Contabilidade no Workspace Entrega

No workspace **Entrega**, o painel **Resumo de Recursos CHR por Asset** (`#section-delivery-chr-assets`) resume os dados essenciais de ocupação e os diagnósticos de integridade de posse são integrados diretamente ao checklist de prontidão para entrega.

## Limitações conhecidas

- O clipboard é interno ao PNG2CHR Studio e não lê nem escreve o System Clipboard.
- O histórico não persiste entre sessões ou dentro do arquivo de projeto.
- O canvas ainda não oferece navegação e pintura pixel a pixel somente por teclado.
