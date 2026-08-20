# Guia de Desenvolvimento

Este guia destina-se a desenvolvedores que estão iniciando ou contribuindo no desenvolvimento do **PNG2CHR Studio**.

---

## 1. Requisitos

- **Node.js:** Versão `20.19.0` ou superior (recomendado utilizar a versão LTS atual do Node.js 20.x).
- **npm:** Gerenciador de pacotes padrão do Node.js.

> **Atenção:** O projeto utiliza recursos recentes do ecossistema Vite/Vitest (como `util.styleText` e novos parsers ES). Versões anteriores ao Node 20.19 podem falhar na execução dos testes e compilação.

---

## 2. Instalação e Execução

### Instalação das dependências

```bash
npm install
```

Para instalações limpas e reproduzíveis (como em pipelines de CI):

```bash
npm ci
```

### Execução em ambiente de desenvolvimento

```bash
npm run dev
```

Abra a URL exibida no terminal (geralmente `http://localhost:5173`).

> **Nota:** Não abra `index.html` diretamente através do protocolo `file://`, pois os módulos TypeScript dependem da transformação e serviço do Vite.

### Pré-visualização do build de produção

```bash
npm run preview
```

Permite testar localmente o pacote de produção gerado na pasta `dist/`.

---

## 3. Scripts de Validação e Qualidade

O `package.json` define os seguintes scripts que representam a fonte da verdade para o ciclo de validação:

| Comando                | Descrição                                                                       |
| ---------------------- | ------------------------------------------------------------------------------- |
| `npm run dev`          | Inicia o servidor de desenvolvimento com Hot Module Replacement (HMR).          |
| `npm run test`         | Executa a suíte completa de testes unitários e de integração via Vitest.        |
| `npm run lint`         | Executa a análise estática com ESLint e TypeScript-ESLint.                      |
| `npm run format:check` | Verifica a formatação do código com o Prettier (sem alterar arquivos).          |
| `npm run format`       | Corrige e aplica a formatação Prettier em todos os arquivos suportados.         |
| `npm run build`        | Compila o TypeScript (`tsc -b`) e gera o bundle de produção via Vite (`dist/`). |
| `npm run preview`      | Serve os arquivos da pasta `dist/` para validação prévia de release.            |

### Executando testes específicos

Para rodar apenas um arquivo ou grupo de testes durante o desenvolvimento:

```bash
npx vitest run src/core/animation-model.test.ts
npx vitest run src/core/project.test.ts
```

---

## 4. Estrutura do Código-Fonte

O código-fonte reside em `src/` e segue uma arquitetura com separação rígida de responsabilidades:

```text
src/
  core/       Regras puras de domínio NES, quantização, codificação CHR e persistência
  i18n/       Internacionalização tipada (pt-BR e en) e seleção de idioma
  ui/         Componentes modulares de interface, manipulação do DOM e Canvas
  utils/      Utilitários gerais (downloads de arquivos, manipulação de strings)
  workers/    Web Workers para processamento assíncrono pesado (ex.: quantização)
  main.ts     Orquestrador da aplicação e gerenciador do estado canônico
  style.css   Estilos visuais em CSS puro (sem frameworks ou pré-processadores)
```

---

## 5. Como Adicionar Novas Funcionalidades

1. **Domínio e Regras NES (`src/core/`):**
   - Toda lógica de conversão gráfica, cálculo de índices, validação de limites de hardware ou manipulação de dados deve residir em `src/core/`.
   - As funções devem ser **puras e determinísticas**, sem acesso ao DOM, `window` ou Canvas API.
2. **Interface do Usuário (`src/ui/`):**
   - Crie ou estenda componentes em `src/ui/`.
   - Os componentes devem receber dados via propriedades e emitir eventos por meio de callbacks tipados.
3. **Internacionalização (`src/i18n/`):**
   - Todas as strings visíveis para o usuário devem ser declaradas em `src/i18n/translations.ts` para ambos os idiomas (`pt-BR` e `en`).
   - O teste de internacionalização (`src/i18n/translations.test.ts`) garante que todas as chaves possuam traduções em ambos os idiomas.
4. **Fronteiras de Estado:**
   - Mutações de estado persistível devem passar por `updateProject(...)` em `src/main.ts`.
   - Estados visuais transitórios (painéis colapsados, overlays) pertencem a `WorkspaceState` e não devem sujar o projeto nem ser serializados (ver [`docs/project-state-boundaries.md`](./project-state-boundaries.md)).

---

## 6. Como Adicionar Testes

- Crie arquivos `.test.ts` ao lado do código que está sendo implementado (ex.: `src/core/meu-modulo.test.ts`).
- Priorize testes cobrindo:
  - Casos de borda das restrições do NES (limites de 256 tiles, 8 bits signed, 8 KiB CHR, limites de OAM).
  - Regressões de persistência e compatibilidade de schemas salvos.
  - Determinismo dos algoritmos de quantização e deduplicação.

---

## 7. Boas Práticas do Projeto

- **TypeScript em Modo Estrito:** Evite o uso de `any`, asserções não-nulas (`!`) forçadas e supressões de tipo (`@ts-ignore`).
- **Respeito ao Hardware NES:** Validações de limites (tamanho de pattern table, 64 cores PPU, 4 paletas) são requisitos de produto; não as ignore para contornar erros.
- **Transparência de Diagnóstico:** Mensagens de erro devem explicar a restrição física que motivou o problema e indicar a solução.
- **Sincronia com a Documentação:** Conforme definido no [`AGENTS.md`](../AGENTS.md), alterações em funcionalidades, formatos ou comandos de desenvolvimento devem atualizar a documentação correspondente no mesmo pull request.

---

## 8. Esteira de Integração Contínua (CI)

O projeto conta com uma esteira de CI no GitHub Actions configurada em `.github/workflows/ci.yml`.

A pipeline executa automaticamente a cada `push` na branch `main` e em todos os `pull_request` destinados à branch principal.

Etapas executadas pela CI:

1. **Checkout:** Clona o repositório (`actions/checkout@v4`).
2. **Setup Node.js:** Configura o Node.js 20 com cache de dependências npm (`actions/setup-node@v4`).
3. **Instalação:** `npm ci`.
4. **Validação de Formatação:** `npm run format:check`.
5. **Análise Estática (Lint):** `npm run lint`.
6. **Execução de Testes:** `npm run test`.
7. **Compilação de Produção:** `npm run build`.

Qualquer falha em uma dessas etapas bloqueia o merge do PR.
