# Auditoria final da validação NES — Milestone 11

Esta auditoria cobre as entregas #150–#155 e registra as decisões finais da
issue #156. O escopo permanece em validação estática derivada dos modelos do
Studio; não inclui emulação de PPU, timing de ciclos, prioridade de sprites ou
comportamento específico de mapper que o projeto não modele.

## Matriz de regras e severidades

| Regra                                              | Gating              | Severidade | Readiness        | Decisão                                                                        |
| -------------------------------------------------- | ------------------- | ---------- | ---------------- | ------------------------------------------------------------------------------ |
| Pressão de OAM acima de 32 entradas                | Animation           | `warning`  | permite exportar | Sinal de política do Studio, não limite do hardware.                           |
| OAM acima de 64 entradas                           | Animation           | `error`    | bloqueia         | Excede a capacidade física de 64 entradas.                                     |
| 6–8 sprites na mesma scanline do frame             | Animation           | `warning`  | permite exportar | Há pouca margem para composição com outros objetos.                            |
| Mais de 8 sprites na mesma scanline do frame       | Animation           | `error`    | bloqueia         | Excede o limite de avaliação de sprites por scanline do NES.                   |
| Metasprite totalmente fora da área 256×240         | Animation           | `warning`  | permite exportar | Pode ser intencional; clipping parcial permanece válido.                       |
| Coordenada absoluta fora de `0..255`               | Animation           | `info`     | permite exportar | Informa o wrap do byte OAM sem afirmar erro de hardware.                       |
| Nametable aponta para slot CHR reservado           | Playfield           | `info`     | permite exportar | Reserva não prova conteúdo nem ausência dele em runtime.                       |
| Nametable aponta para slot CHR vazio conhecido     | Playfield           | `warning`  | permite exportar | O projeto não fornece backing de Base CHR ou Project CHR.                      |
| Região 16×16 combina contextos de paleta distintos | Playfield           | `info`     | permite exportar | A Attribute Table escolhe um único slot; recoloração pode ser intencional.     |
| Modelo primário de exportação ausente              | modo correspondente | `error`    | bloqueia         | Não é correto declarar o modo pronto sem CHR, Nametable ou modelo de animação. |

Diagnósticos `info` nunca alteram o estado visual de prontidão. `warning`
produz “pronto com avisos”. Qualquer `error` produz “ação necessária”. Quando
duas fontes entregam o mesmo ID de fato, a ordem da primeira ocorrência é
preservada, mas a maior severidade prevalece.

## Correções da auditoria

1. Variantes de direção geradas por espelhamento horizontal deixaram de
   duplicar diagnósticos de OAM e scanline. A variante possui a mesma identidade
   editável, mesma contagem de sprites e mesma geometria vertical da animação
   canônica.
2. A validação da Attribute Table deixou de tratar `sourceTileIndex` como slot
   físico CHR. Slots físicos agora vêm exclusivamente de
   `BackgroundProjectModel.resolvedCells`; contexto de paleta continua indexado
   por `LogicalTileKey`. Assim, Base CHR, Reservations e deduplicação não
   confundem identidade lógica com alocação física.
3. Contexto de paleta só é produzido para o asset Tileset/Playfield atual, cuja
   grade e `paletteAssignments` são conhecidas. Assets sem essa proveniência
   permanecem indetermináveis e não geram diagnóstico.
4. Ausência do artefato principal do modo passou a ser bloqueio de readiness.
   Avisos e informações continuam sem bloquear downloads disponíveis.
5. Deduplicação de diagnósticos passou a preservar a maior severidade, evitando
   que um `info` anterior esconda um `error` posterior com a mesma identidade.
6. Deliver & Export ganhou atalho para Background e localização das ações de
   download/correção. O resumo agora contabiliza também fatos informativos.

## Cobertura cruzada

Os testes automatizados cobrem:

- limites exatos de OAM (32, 33, 64 e 65) e scanline (5, 6, 8 e 9);
- omissão de variantes espelhadas derivadas sem perder o fato canônico;
- clipping parcial, metasprite totalmente fora da tela, wrap e instâncias
  ocultas/não resolvidas;
- resolução PT0/PT1 da Nametable para Project CHR, Base CHR, Reservation e slot
  vazio;
- Attribute Table com modelo Background compilado, inclusive deslocamento de
  slot provocado por Base CHR;
- gating entre Tileset, Playfield e Animation;
- readiness com combinações de `info`, `warning` e `error`;
- navegação de cada família de diagnóstico e paridade i18n en/pt-BR.

O roteiro manual em `docs/stabilization-smoke-test.md` complementa a suíte para
interações de navegador, seleção de arquivos e downloads.
