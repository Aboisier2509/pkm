# Resultados da prova de persistência

Este arquivo registra evidências, separando automação local de testes em dispositivos físicos. A aprovação de uma plataforma depende da execução do [roteiro](persistence-validation.md).

## Preparação para GitHub Pages — 12 de novembro de 2026

Build e verificação de tipos passaram, assim como os **66 testes de banco/validação** e **1 teste específico de hospedagem em `/pkm/` no Chrome**. O build continua `0.4.0+3ed0925422faf9fc`; o código do aplicativo e o esquema não foram alterados. Não foi repetida a suíte completa de 126 testes, cuja evidência anterior está abaixo.

O teste de hospedagem usa um servidor local isolado na porta 4184, que serve somente a subpasta `/pkm/`, com redirecionamento para a barra final e sem fallback que esconda caminhos incorretos. Confirmou manifest e ícones, escopo do Service Worker, recursos e MIME do WASM, SQLite em OPFS e recuperação do mesmo UUID após fechar a página e reabri-la offline. O servidor foi encerrado ao terminar. Relatório específico: `playwright-report-pages/`; artefatos: `test-results-pages/`.

Foram preparados um workflow para gerar/publicar apenas `dist/`, um roteiro pelo navegador e uma pasta de envio com os arquivos de código selecionados. Isso ainda não constitui execução do GitHub Actions nem publicação em uma conta real. Android, iPad e instalação continuam pendentes. Veja [Publicação no GitHub Pages](github-pages.md).

## Backup e restauração — 11 de novembro de 2026

A versão `0.4.0`, build `0.4.0+3ed0925422faf9fc`, mantém o esquema `2` e passou em **126 testes**, sem retries, em aproximadamente 2 minutos e 24 segundos: 66 de banco/validação, 30 no Chrome e 30 no Edge. Verificação de tipos e build passaram. Foram acrescentados 11 testes de integração do backup e 7 cenários em cada navegador.

Os cenários confirmaram recuperação completa em outro contexto isolado, preservação de UUIDs/revisões/metadados/tags/histórico, importação idempotente, combinação de bases independentes, bloqueio de conflitos, substituição com confirmação explícita, recusa de arquivos inválidos e prévias desatualizadas, restauração offline e rollback após falha de escrita no OPFS. A imagem SQLite exportada foi desserializada em outra conexão WASM e passou em `integrity_check` e `foreign_key_check`.

A revisão também acrescentou rejeição de categorias sem definição de campos e de valores que dependeriam de conversão automática de tipos pelo SQLite. A restauração valida uma base temporária antes de alterar o banco local e não faz leituras adicionais depois de confirmar o commit.

Os testes usam somente bases e perfis isolados, no servidor de testes da porta 4183. Não acessam a biblioteca pessoal. Android, iPad, download e escolha de arquivos nesses dispositivos e instalação PWA pelo sistema continuam pendentes. Veja [Backup e restauração](backup.md).

## Cadastro e edição — 11 de novembro de 2026

A versão `0.3.0`, mantendo esquema `2`, passou em **101 testes**: 55 de banco e validação, 23 no Chrome e 23 no Edge. Build e verificação de tipos passaram. Os formulários foram testados com cadastro completo, edição, cancelamento, categorias/subcategorias, tags, metadados e reabertura offline. A gravação de conteúdos, vínculos, snapshots e log é transacional. Consulte o [roteiro e os resultados dos formulários](forms.md).

Os testes usam o servidor isolado da porta 4183 e perfis de teste; não acessam a base pessoal do usuário. A sonda permanece em `?view=lab`. As evidências históricas abaixo foram preservadas.

## Fase 2 — 10 de novembro de 2026

A versão `0.2.0`, esquema `2`, passou em **70 testes**: 19 de SQL/migrações, 21 de validação e 15 em cada navegador (Chrome e Edge). A atualização de uma base OPFS da fase 1 preservou UUID, texto e data, inclusive em uma nova abertura offline. Build e verificação de tipos passaram. As evidências, limitações e instruções estão em [Validação da fase 2](phase-2-validation.md).

As seções abaixo conservam o histórico da primeira fase. Android, iPad e instalação pelo sistema permanecem pendentes; a entrega da fase 2 não amplia a compatibilidade física comprovada.

## Execução local — 9 de novembro de 2026

Resultado final: **26 testes passaram**, sendo 13 no Chrome e 13 no Edge, sem retries. A execução completa levou aproximadamente 1 minuto e 12 segundos. A automação utilizou os navegadores instalados, em modo headless e perfis isolados, no Windows disponível (build 26300). Isso não constitui aprovação da instalação PWA pelo sistema nem das demais plataformas.

Aplicativo: `0.1.0`; build testado: `0.1.0+55b338eabf088387`; SQLite efetivamente carregado: `3.54.1`; pacote: `3.54.1-build1`; VFS: `opfs-sahpool`; origem de produção: `http://localhost:4173`. Chrome detectado: `156.0.8078.80`; Edge detectado: `157.0.4341.42`.

| Avaliação | Estado | Evidência |
| --- | --- | --- |
| Inspeção do ambiente Windows | Realizada | Node 24.14.1, npm 11.11.0, Chrome 156 e Edge 157 detectados; Git não localizado no PATH |
| Verificação de tipos | Passou | `npm run typecheck` e etapa de build |
| Build de produção | Passou | `npm run build`; 12 arquivos estáticos, aproximadamente 1,4 MB antes de compressão |
| Desenvolvimento | Passou | HTTP 200 em localhost:5173, banco conectado, CSS aplicado e nenhum erro de CSP/JavaScript; offline desabilitado conforme configuração |
| Playwright com Chrome local | Passou | 13 cenários, `channel: chrome` |
| Playwright com Edge local | Passou | 13 cenários, `channel: msedge` |
| Teste manual local relatado pelo usuário | Funcionamento confirmado no relato | Em 10/11/2026, o usuário informou que o teste local funcionou; a captura mostra reabertura do banco, um registro e recursos offline preparados |
| Reinício do processo do navegador com perfil persistente | Passou na automação | Processo encerrado, relançado com o mesmo perfil e contexto offline; registro recuperado nos dois navegadores |
| Abertura fria offline no teste manual do usuário | Não informada | A captura de prontidão offline e reabertura da conexão não demonstra, por si só, encerramento e nova abertura sem rede |
| PWA instalada pelo sistema / encerramento forçado manual no Windows | Pendente | Não inferir do teste automatizado |
| Android smartphone físico | Pendente | Equipamento, versão e execução a registrar |
| Android tablet físico | Pendente | Equipamento, versão e execução a registrar |
| iPad físico — Safari | Pendente | Equipamento, versão e execução a registrar |
| iPad físico — Tela de Início | Pendente | Testar separadamente do Safari em aba |
| Falta de espaço real por plataforma | Pendente | Simulação deve receber identificação própria |
| Atualização de Service Worker com preservação do banco | Passou na automação | Worker com versão distinta mantido em espera e aplicado por ação explícita; conteúdo anterior preservado |

## Teste manual relatado — 10 de novembro de 2026

O usuário relatou funcionamento satisfatório na máquina local onde Python está instalado. A captura fornecida na conversa mostra a mensagem de banco fechado e reaberto com recuperação do OPFS, estado do banco conectado, um registro salvo e estado “Pronto para uso offline”. Isso acrescenta evidência manual de reabertura da conexão e do preparo dos recursos da aplicação.

O navegador e sua versão, a origem completa, o comando de servidor utilizado, o UUID e o texto do registro não foram informados nessa execução. A presença do Python na máquina não é requisito do banco: SQLite WASM e OPFS executam no navegador. Não foi relatado separadamente o encerramento completo do aplicativo com nova abertura sem conexão; esse resultado manual permanece não informado, embora o cenário já tenha passado na automação local.

O usuário ainda não dispõe de uma forma de executar os testes em Android e iPad. Essas plataformas permanecem pendentes, sem que o sucesso no computador seja estendido a elas.

## Cenários automatizados comprovados

| Cenário | Chrome | Edge |
| --- | --- | --- |
| Unicode, SQL e HTML como texto; reabertura da conexão e recarga sem duplicar | Passou | Passou |
| Integridade e rollback após violação deliberada de chave primária | Passou | Passou |
| Nova página offline, nova gravação e outra reabertura ainda offline | Passou | Passou |
| Encerramento completo do processo e relançamento offline com perfil persistente | Passou | Passou |
| Outra aba bloqueada; liberação e recuperação da base original | Passou | Passou |
| Cache artificialmente incompleto não é anunciado como pronto | Passou | Passou |
| Atualização controlada preservando os registros | Passou | Passou |
| Layout desktop 1440 px e celular 390 px, sem rolagem horizontal e com foco no formulário | Passou | Passou |
| OPFS indisponível simulado, sem fallback e com gravação bloqueada | Passou | Passou |
| Texto composto apenas por espaços rejeitado sem alterar os registros | Passou | Passou |
| Escrita OPFS rejeitada por falta de espaço simulada, preservando dados anteriores e integridade | Passou | Passou |
| Diagnóstico JSON sem conteúdo dos registros | Passou | Passou |
| Falha de inicialização concorrente sem Web Locks preserva o pool e os registros | Passou | Passou |

FTS5 foi confirmado no binário carregado com tabela temporária e consulta `MATCH`. `PRAGMA integrity_check` retornou `ok`. Os testes de rollback confirmaram ausência de inserções parciais. A suíte não exige concessão de `persist()`; o resultado dessa API depende do perfil e é mostrado no diagnóstico.

## Falhas encontradas e retestes

A primeira execução encontrou falha de abertura fria offline: respostas do servidor com `Vary: Origin` não correspondiam às requisições dos módulos no cache. O matching foi corrigido para os arquivos estáticos exatos, e o reteste de abertura, gravação e reabertura sem rede passou em ambos os navegadores.

O perfil persistente do teste inicialmente usava o diretório longo de artefatos do Playwright. No Chrome, isso impediu o preparo do cache em disco. O teste passou ao usar um diretório temporário curto e isolado, com remoção restrita à pasta criada pelo próprio teste. O cenário foi repetido na execução completa.

A falha de espaço é **simulada**: o teste faz uma única chamada nativa de escrita OPFS lançar `QuotaExceededError`, restaurando o método em seguida. O VFS propaga uma falha de I/O; a interface não anuncia sucesso, encerra a conexão e recupera os registros anteriores ao reabrir. Isso não comprova esgotamento físico de cota em Android ou iPad.

O teste de atualização altera somente a identificação do worker servido, mantendo os recursos desta PoC, e restaura o arquivo ao terminar. Uma atualização entre versões futuras com migrações diferentes precisará de seus próprios testes. As capturas de celular representam mudança de viewport no computador, não um dispositivo de toque real.

## Reproduzir

```powershell
npm run build
npm exec -- playwright test
```

O relatório da execução fica em `playwright-report/index.html`. Os artefatos ficam em `test-results/`; uma execução posterior pode substituí-los. A suíte inicia e encerra o servidor de prévia. Para evidências em dispositivo, o botão **Baixar diagnóstico** exporta versões e estado técnico sem o texto dos registros; ele não exporta um backup da base.

## Modelo de execução

Copie esta seção para cada dispositivo/contexto ou execução de automação.

```text
Identificador:
Data/hora/fuso:
Responsável:
Tipo: dispositivo físico / automação / simulação
Hardware:
Sistema e versão:
Navegador e versão:
Contexto: aba / PWA instalada
Origem completa:
Versão do aplicativo e build:
Versão SQLite:
VFS:
Resultado de persist()/persisted():
Uso e cota estimados (ou API indisponível):
Estado dos recursos offline:
UUID/texto público/data da sonda:

P01 criar/inserir/consultar:
P02 fechar/reabrir conexão:
P03 encerramento normal e forçado, nova inicialização:
P04 abertura fria, escrita e reabertura sem rede:
P05 integrity_check/rollback/FTS5:
P06 outra aba e recuperação após liberar:
P07 atualização de arquivos preservando dados:
P08 indisponível/sem espaço (indicar real ou simulado):
P09 validação e exibição de texto literal:

Evidências:
Falhas e passos de reprodução:
Resultado geral: aprovado / reprovado / pendente
Limites do resultado:
Reteste, se houver:
```

Não cole conteúdo pessoal, credenciais ou dumps de uma base de uso real. Mantenha capturas e registros limitados aos dados públicos de teste.
