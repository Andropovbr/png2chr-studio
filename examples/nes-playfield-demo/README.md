# Demo NES do playfield

Demo NROM-128 para validar os arquivos exportados pelo PNG2CHR Studio em um jogo real.

## Controles

- Direcional: move o personagem nas quatro direções.
- As células do tipo sólido (`$1`) no arquivo `.col` bloqueiam o movimento.

## Compilação

Coloque `random-playfield.chr`, `random-playfield.nam`, `random-playfield.atr` e
`random-playfield.col` e `random-playfield.pal` nesta pasta e execute:

```powershell
.\build.ps1
```

O script usa `ca65` e `ld65` disponíveis no `PATH` e gera `playfield-demo.nes`.

O cenário ocupa a pattern table de fundo a partir do tile 0. Um tile adicional
para o personagem é inserido automaticamente depois do último tile exportado.

As quatro paletas de fundo são carregadas diretamente do arquivo `.pal`
exportado pelo PNG2CHR Studio.

O mapa `.col` usa o formato tipado de 480 bytes da versão 0.9: cada byte
armazena duas células, com a célula esquerda no nibble alto. Este demo reage
somente ao tipo sólido; os demais tipos podem ser tratados pela lógica do jogo.
