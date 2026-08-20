# Histórico de Mudanças Técnicas

Este diretório tem como finalidade registrar marcos importantes de arquitetura, alterações de formatos de arquivo, decisões estruturais ou mudanças relevantes de comportamento do **PNG2CHR Studio**.

## Objetivo

- Fornecer contexto técnico aprofundado sobre decisões tomadas ao longo da evolução do projeto.
- Evitar que o `README.md` principal ou os documentos de arquitetura se transformem em changelogs extensos.
- Registrar notas de migração de formatos ou breaking changes que ajudem desenvolvedores e mantenedores futuros.

## Diretrizes para novas entradas

Ao introduzir uma mudança técnica estrutural relevante (por exemplo: alteração de schema de persistência, reestruturação profunda de pipeline ou novo modelo de alocação de CHR):

1. Crie um arquivo markdown neste diretório com nome descritivo (ex.: `YYYY-MM-DD-nome-da-mudanca.md`).
2. Descreva:
   - **Contexto e Motivação:** o problema que originou a mudança.
   - **Decisão Técnica:** o que foi implementado e como funciona.
   - **Impactos e Migração:** impacto em arquivos salvos (.p2c), exportações (JSON/C/ca65) ou interfaces internas.
   - **Testes e Validação:** como a mudança foi validada e testada.
