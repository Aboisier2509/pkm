# PKM — Biblioteca pessoal local

Sistema pessoal de gestão do conhecimento em desenvolvimento incremental: PWA com SQLite WebAssembly e dados locais em OPFS, usando o VFS `opfs-sahpool`. A versão `0.4.0` acrescenta backup e restauração sobre o esquema `2`.

A tela inicial é **Sua biblioteca**, com **Novo conteúdo**, **Editar** e **Backup e restauração**. O link **Diagnóstico** mantém o laboratório em `?view=lab`. Veja [Backup e restauração](docs/backup.md), [Como usar os formulários](docs/forms.md) e [Modelo do banco](docs/database-model.md). Compatibilidade em Android e iPad físicos permanece pendente.

Para publicar, siga o [passo a passo do GitHub Pages pelo navegador](docs/github-pages.md). A configuração está em `.github/workflows/pages.yml`. O comando `npm run prepare:github` gera a pasta `github-upload/` com os arquivos selecionados para envio, sem dependências, bancos ou backups pessoais. Crie o workflow separadamente na interface do GitHub, conforme o roteiro.

## Escopo

- Uma tabela `persistence_probe` com UUID, texto e data UTC.
- Dez tabelas de biblioteca e infraestrutura, com categorias, subcategorias, versões de metadados, conteúdos, tags, relações, metadados de anexos, histórico preparado e migrações.
- Migração transacional da versão 1 para 2, com ledger SHA-256 e conferência das definições SQL instaladas.
- Tipos e validações de domínio, incluindo definições de campos e quatro sugestões de categorias, sem inserir categorias automaticamente.
- Cadastro e edição com título, categoria/subcategoria, tags, conteúdo, origem, status, favorito, notas e campos específicos.
- Criação de categorias e subcategorias durante o preenchimento, com escolha explícita de modelo de campos.
- Gravação transacional de conteúdos, vínculos, snapshots de revisão e log de mudanças, com recusa de edição baseada em revisão antiga.
- Inserção parametrizada, listagem e fechamento/reabertura do banco.
- Diagnóstico do armazenamento, SQLite, VFS, FTS5, versão do esquema e número de migrações.
- Verificação de integridade e teste de rollback.
- Manifest, recursos locais e Service Worker para preparar o funcionamento offline.
- Controle de atualização dos arquivos da PWA.
- Exportação completa em JSON, prévia e restauração transacional com identificação de duplicados e conflitos.
- Exportação de uma imagem portátil SQLite; a restauração pela interface usa JSON.
- Download de diagnóstico técnico sem o conteúdo dos registros; não é um backup.

Cadastro, edição, listagem, backup e restauração da biblioteca estão implementados. O histórico e o log recebem registros nas gravações, mas ainda não há restauração individual de revisões pela interface. Pesquisa global, exclusão, anexos em arquivo, IA e sincronização pertencem às etapas seguintes.

## Ambiente e dependências

Ambiente inspecionado: Node.js `24.14.1`, npm `11.11.0`, Chrome `156` e Edge `157`. Git não foi localizado no PATH e não é necessário para executar a PoC.

Versões selecionadas para o projeto:

| Dependência | Versão | Uso |
| --- | --- | --- |
| Vite | `8.3.7` | Desenvolvimento e build estático |
| TypeScript | `7.0.2` | Tipagem e verificação do código |
| `@sqlite.org/sqlite-wasm` | `3.54.1-build1` | SQLite real no navegador |
| Playwright Test | `1.65.0` | Testes automatizados em navegador |

Use Node.js 24 e o arquivo `package-lock.json` do projeto para reproduzir esse ambiente. Os recursos necessários à execução serão empacotados localmente; o aplicativo não depende de CDN para funcionar offline.

Na validação local de 9 de novembro de 2026, o build e a verificação de tipos passaram, assim como **26 testes automatizados: 13 no Chrome e 13 no Edge**. Isso inclui reinício do processo do navegador com perfil persistente, abertura e gravação offline e preservação dos registros após atualização. Android, iPad e instalação pelo sistema ainda precisam da validação física descrita no roteiro.

A versão `0.2.0` passou em **70 testes**: 40 de modelagem/validação e 15 em cada navegador. A migração de uma base OPFS da fase 1 preservou o registro original e sua recuperação offline. Veja [Validação da fase 2](docs/phase-2-validation.md), separada das evidências históricas da primeira fase.

A versão `0.3.0` passou em **101 testes**: 55 de banco/validação e 23 em cada navegador. Os cenários cobrem cadastro, edição, cancelamento, campos de categoria, gravação offline e falhas de escrita. Consulte [Formulários e validação](docs/forms.md). As evidências de backup da versão `0.4.0` constam em [Resultados dos testes](docs/test-results.md).

A versão atual `0.4.0` passou em **126 testes**: 66 de banco/validação, 30 no Chrome e 30 no Edge. A validação inclui restauração completa, conflitos, duplicados, operação offline e reversão de uma restauração com falha de escrita, além das regressões anteriores. Build e verificação de tipos passaram.

## Executar

Na pasta do projeto:

```powershell
npm install
npm run dev
```

Abra `http://localhost:5173`. O modo de desenvolvimento serve para editar a aplicação e **não habilita o Service Worker**. Não use esse modo como evidência de funcionamento offline.

Para preparar e testar a PWA:

```powershell
npm run build
npm run preview
```

Abra `http://localhost:4173`, mantenha a conexão até a aplicação confirmar a preparação offline e execute o roteiro de validação. A prévia serve os arquivos estáticos de `dist/`; não é um backend de dados. Depois da preparação, o teste offline precisa incluir o fechamento e uma nova abertura da aplicação.

Se o PowerShell bloquear `npm.ps1`, execute os mesmos comandos com `npm.cmd`. Se a configuração local do npm estiver em modo offline durante a primeira instalação, use `npm install --offline=false --cache .npm-cache` para obter as dependências. A primeira instalação exige acesso ao registro npm.

Não abra `index.html` por `file://`. Service Worker e as APIs de armazenamento utilizadas exigem contexto seguro. `localhost` recebe uma exceção para desenvolvimento, mas um endereço HTTP da rede local acessado pelo celular ou iPad não recebe essa exceção.

## Atualizar a base que você já testou

Sirva o novo `dist/` usando **a mesma URL, porta, navegador e perfil** do teste anterior. Se a versão anterior já estiver no cache, use **Verificar atualização** e depois **Aplicar atualização**. A versão `0.4.0` acrescenta **Backup e restauração** à biblioteca. O diagnóstico continua mostrando esquema `v2` e duas migrações registradas.

A migração ocorre ao abrir o banco quando necessária. Ela preserva `persistence_probe`, seus UUIDs, textos e datas. A versão `0.4.0` mantém o esquema `2` e usa as tabelas já criadas. Os registros da sonda continuam em **Diagnóstico** e não são convertidos automaticamente em conteúdos da biblioteca. O nome do banco e do pool OPFS foi mantido. Não é necessário limpar os dados do site para atualizar.

## Android e iPad

Para testar agora em Android com cabo USB, siga o [roteiro de teste Android](docs/android-testing.md). O encaminhamento do Chrome permite usar `http://localhost:4173` no celular como uma origem local de teste, sem configurar certificados.

Para acessar pela rede, sirva o conteúdo de `dist/` em uma origem HTTPS com certificado confiável nos dispositivos. Apenas adicionar `--host` ao servidor e acessar `http://IP-do-computador` não resolve o requisito de contexto seguro. A configuração e a distribuição de certificados devem ser feitas antes dos testes pela rede; não desative a segurança do navegador para obter um resultado aparente.

No Android, use a opção de instalação disponível no navegador. No iPad, use o Safari e a opção de adicionar à Tela de Início, conforme a versão do sistema. A instalação do ícone não comprova que o WASM e os demais recursos estejam disponíveis offline: aguarde o estado de preparação indicado pela aplicação e realize uma abertura fria sem rede.

O primeiro alvo de validação física é iPadOS 17 ou superior. Safari/iPadOS 16.4 é candidato a teste específico, pois há APIs OPFS relevantes nessa versão, mas não é uma compatibilidade já demonstrada. Teste separadamente a aba do navegador e a PWA instalada; não presuma que diferentes contextos, perfis ou navegadores compartilhem a mesma base.

## Como os dados são guardados

A interface envia comandos para um worker dedicado. Nesse worker, SQLite executa as consultas e mantém o banco no OPFS com `opfs-sahpool`. O Service Worker guarda os arquivos da aplicação no Cache API; ele não guarda nem substitui o banco SQLite.

O banco pertence à origem e ao contexto de armazenamento. Trocar protocolo, host, porta, perfil ou navegador pode apresentar uma base diferente. Em particular, `localhost:5173` e `localhost:4173` têm bases distintas. Mantenha a mesma origem durante cada sequência de validação.

Há um único proprietário ativo do banco. Feche a outra aba ou instância que estiver utilizando a base antes de tentar abri-la novamente. Falhas de persistência devem ser apresentadas como falhas; não há troca silenciosa para uma base em memória.

`navigator.storage.persist()` é uma solicitação ao navegador. Sua concessão pode reduzir o risco de remoção automática, mas não torna os dados permanentes. Limpar dados do site, mudanças de perfil, pressão de armazenamento ou a remoção da aplicação, conforme o sistema, podem eliminar dados locais. O navegador também pode impor limites específicos em navegação privada; esta PoC verifica capacidades reais e não tenta detectar esse modo.

Use **Backup e restauração → Exportar backup JSON** para guardar uma cópia fora do navegador. Confira o arquivo na pasta de destino e teste a restauração em outro perfil antes de depender dele. O arquivo contém dados pessoais sem criptografia. Para transferir a biblioteca a outro navegador, importe esse JSON; não há sincronização automática.

## Testes automatizados

```powershell
npm test
```

O comando verifica os tipos, gera o build, executa os testes de validação/modelagem e a suíte no Chrome instalado, pelo canal `chrome`. Se esse navegador não estiver disponível, instale-o ou ajuste conscientemente o canal da configuração de testes.

Para testar somente validação, migrações e repositórios de cadastro e backup, sem servidor, build ou navegador:

```powershell
npm run test:unit
```

Os testes SQL carregam o SQLite WASM oficial em memória, na mesma versão do binário da aplicação. São complementados pelos testes de migração e persistência OPFS dentro dos navegadores.

Para executar no Edge instalado:

```powershell
npm run test:edge
```

Para executar todos os testes, incluindo os dois navegadores, depois de gerar o build:

```powershell
npm exec -- playwright test
```

`npm run test:e2e` executa somente o Chrome sobre o build existente. O relatório HTML fica em `playwright-report/index.html`; capturas, traces de falhas e diagnósticos de teste ficam em `test-results/`. Esses diretórios são gerados e ignorados pelo versionamento. A suíte inicia e encerra um servidor exclusivo em `http://localhost:4183`, com uma cópia em `.test-dist/` e perfis isolados. Não altera o perfil pessoal nem os arquivos de `dist/` durante o teste de atualização. O teste de reinício usa uma pasta temporária curta para evitar limites de caminhos do Windows.

Testes automatizados em um computador não substituem o encerramento real da PWA e a avaliação do armazenamento pelo Android e pelo iPadOS. Uma execução de WebKit em ambiente de teste não equivale a um iPad físico.

## Documentação

- [Decisões da arquitetura](docs/architecture.md)
- [Cadastro, edição e roteiro de uso](docs/forms.md)
- [Modelo relacional, diagrama e dicionário de dados](docs/database-model.md)
- [Validação da fase 2](docs/phase-2-validation.md)
- [Roteiro e critérios de validação](docs/persistence-validation.md)
- [Resultados e evidências](docs/test-results.md)

