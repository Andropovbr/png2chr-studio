# Demo NES do playfield

Demo NROM-128 para validar os arquivos exportados pelo PNG2CHR Studio em um jogo real.

## Controles

- Direcional: move o personagem nas quatro direções.
- As células marcadas no arquivo `.col` bloqueiam o movimento.

## Compilação

Coloque `random-playfield.chr`, `random-playfield.nam`, `random-playfield.atr` e
`random-playfield.col` nesta pasta e execute:

```powershell
.\build.ps1
```

O script usa `ca65` e `ld65` disponíveis no `PATH` e gera `playfield-demo.nes`.

O cenário ocupa a pattern table de fundo a partir do tile 0. Um tile adicional,
de índice 6, é incluído para representar o personagem como sprite.
