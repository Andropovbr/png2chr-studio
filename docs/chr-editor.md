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

- **Tileset e Playfield:** a edição atualiza `project.pixelOverrides` e recalcula os tiles derivados.
- **Animação:** a edição atualiza os overrides da spritesheet de origem e seus previews.
- **CHR-Base:** os 16 bytes planares do slot são atualizados sem alterar os demais bytes.
- **Slot vazio:** a primeira alteração materializa o slot em `destinationChr`. Editar PT1 expande uma base de 4 KiB para 8 KiB somente quando necessário.
- **PT0/PT1:** o índice físico é `0..511`; o índice local visível ao OAM continua sendo `physicalIndex % 256` na pattern table ativa.

As edições canônicas são salvas no `.p2c.json` e restauradas ao reabrir o projeto. O histórico é mantido em memória por tile enquanto o usuário permanece no mesmo projeto e modo, inclusive ao voltar a um tile já editado. Ele é descartado ao criar ou carregar um projeto, trocar de modo ou encerrar a sessão; Undo/Redo não é persistido no arquivo.

## Limitações conhecidas

- O clipboard é interno ao PNG2CHR Studio e não lê nem escreve o System Clipboard.
- O histórico não persiste entre sessões ou dentro do arquivo de projeto.
- O canvas ainda não oferece navegação e pintura pixel a pixel somente por teclado.
