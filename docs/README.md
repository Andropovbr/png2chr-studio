# Documentação Técnica do PNG2CHR Studio

Bem-vindo à documentação técnica do **PNG2CHR Studio**, uma ferramenta estática baseada em navegador para criação, conversão, inspeção e gestão de gráficos e metadados para o **Nintendo Entertainment System (NES)**.

---

## 🎯 Objetivo do Projeto

O PNG2CHR Studio foi desenvolvido para oferecer a artistas, desenvolvedores de jogos e entusiastas de _homebrew_ uma ponte direta, transparente e confiável entre ferramentas modernas de arte (PNG) e os formatos nativos de hardware do NES (CHR 2bpp, Nametables, Attribute Tables, Metasprites, Mapas de Colisão e Paletas).

A ferramenta opera inteiramente no navegador do usuário (sem backend nem upload para servidores externos), garantindo privacidade e execução determinística.

---

## 🕹️ Principais Modos e Workflows

1. **Modo Tileset:**
   - Importação e conversão de PNGs em conjuntos de tiles 8×8 no formato 2bpp.
   - Atribuição de paletas por tile individual.
   - Deduplicação exata e deduplicação com reconhecimento de espelhamentos horizontais e verticais (flip-aware).
   - Edição de pixels integrada e exportação de `.chr` e `.pal`.

2. **Modo Playfield:**
   - Criação e conversão de telas completas de 256×240 pixels (32×30 tiles).
   - Validação de restrições do NES e geração de Nametable (`.nam`), Attribute Table (`.atr`) e Paletas (`.pal`).
   - Editor de mapa de colisão com 11 tipos tipados e exportação de mapa empacotado (`.col`).
   - Gerador procedural de telas de teste com plataformas, escadas e elementos decorativos.

3. **Modo Sprite Sheet / Animação:**
   - Configuração de múltiplas animações com spritesheets independentes.
   - Detecção assistida de grade de frames.
   - Geração de metasprites com omissão de células transparentes para otimização de OAM e scanline.
   - Alocação em pattern tables independentes (PT0 ou PT1) com preservação de bases CHR pré-existentes.
   - Preview de cena multi-entidade com posicionamento e reprodução independentes.
   - Exportação de CHR física de 8 KiB, metadados JSON v5, código C pronto para cc65 e assembly para ca65.

---

## 📚 Índice da Documentação

A documentação técnica detalhada está estruturada nos seguintes tópicos:

| Documento                                                                                            | Descrição                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [**Arquitetura**](./arquitetura.md)                                                                  | Visão geral da arquitetura do sistema, separação de módulos (`src/core`, `src/ui`, etc.), pipeline gráfico, fluxo de estado e aderência ao hardware NES.                           |
| [**CHR Editor**](./chr-editor.md)                                                                    | Guia de uso do editor 8×8, ferramentas, atalhos, foco, integração com PT0/PT1 e CHR-Base, persistência e limitações conhecidas.                                                    |
| [**Guia de Desenvolvimento**](./desenvolvimento.md)                                                  | Instruções para configuração de ambiente, scripts de desenvolvimento/testes/build, boas práticas, adição de novas funcionalidades e esteira de CI.                                 |
| [**Formatos e Exportação**](./formatos-e-exportacao.md)                                              | Especificação técnica detalhada de todos os formatos de arquivo (PNG, CHR, ROM iNES, `.nam`, `.atr`, `.pal`, `.col`, JSON de projeto `.p2c`, JSON de animação, C cc65 e ASM ca65). |
| [**Fronteiras de Estado do Projeto**](./project-state-boundaries.md)                                 | Regras de integridade para separação entre estado persistível (`StudioProject`), estado transiente de interface (`WorkspaceState`) e mensagens derivadas (`DerivedStatus`).        |
| [**Teste de Fumaça de Estabilização**](./stabilization-smoke-test.md)                                | Roteiro prático para verificação manual e testes automatizados de regressão em fluxos de animação e alocação de CHR.                                                               |
| [**Histórico de Mudanças Técnicas**](./historico/README.md)                                          | Diretório destinado ao registro de decisões arquiteturais, alterações estruturais de formato e notas de migração técnica.                                                          |
| [**Investigação: CHR Regions & Reservations**](./investigations/chr-regions-reservations.md)         | Desenho técnico, modelo de domínio e plano de implementação para a Milestone 5 (Regiões e Reservas de CHR).                                                                        |
| [**Investigação: Tile Ownership & Asset Mapping**](./investigations/tile-ownership-asset-mapping.md) | Desenho técnico, modelo de domínio e plano de implementação para a Milestone 6 (Posse de Tiles, Identidade de Assets e Mapeamento Asset-to-CHR).                                   |

---

## 🛠️ Onde Encontrar Informações para Desenvolvimento

- Para instruções passo a passo sobre como rodar o projeto localmente, executar testes e fazer build, consulte o [**Guia de Desenvolvimento**](./desenvolvimento.md).
- Para diretrizes sobre código, integridade de documentação e checklist de tarefas, consulte o [`AGENTS.md`](../AGENTS.md).
