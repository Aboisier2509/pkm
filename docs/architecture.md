# Decisões da arquitetura

## Objetivo e limites

A fase 1 validou a persistência local no ambiente de testes Windows e recebeu um relato de funcionamento local do usuário. Android e iPad físicos continuam pendentes. A fase 2 acrescenta o [modelo relacional da biblioteca](database-model.md), seu controle de migrações e validações de domínio, mantendo a interface de sonda para regressão.

A aplicação não possui um banco remoto nem depende de um serviço de sincronização. O servidor de desenvolvimento ou a hospedagem HTTPS entrega somente os arquivos estáticos da aplicação.

## Separação de responsabilidades

```text
Interface HTML/CSS/TypeScript
           │ mensagens tipadas
           ▼
Worker dedicado → SQLite WASM → opfs-sahpool → OPFS

Service Worker → Cache API → HTML/CSS/JS/worker/WASM/ícones
```

O worker dedicado mantém a execução do SQLite fora da thread da interface. O Service Worker tem outro ciclo de vida e cuida dos arquivos necessários à inicialização offline. Dados do banco não fazem parte do cache de arquivos da aplicação.

As consultas são parametrizadas, e as operações que precisam de atomicidade usam transações. A interface só deve informar gravação bem-sucedida após a confirmação do `COMMIT`. Uma falha ou um timeout que impeça confirmar o resultado não deve ser exibido como sucesso.

A estrutura atual usa `PRAGMA user_version = 2` e `schema_migrations`, com nome, checksum SHA-256 e data. Bases da sonda na versão 1 são adotadas após conferir a estrutura histórica. A migração, seu ledger e a versão são atualizados na mesma transação. Uma estrutura futura ou incompatível é recusada sem recriar a base; as definições SQL dos objetos gerenciados também são conferidas. A gravação da sonda usa `synchronous = FULL`; a consulta após o commit compara UUID, texto e data com os valores enviados. Falhas de armazenamento encerram a conexão antes de permitir uma nova tentativa.

O texto cadastrado deve ser apresentado como texto, sem executar HTML. Logs e mensagens de diagnóstico não devem incluir o conteúdo pessoal dos registros.

## Distribuição SQLite

O projeto usa `@sqlite.org/sqlite-wasm`, um subprojeto oficial mantido por colaboradores da comunidade. A versão selecionada é `3.54.1-build1`; o JavaScript e o WASM precisam vir da mesma distribuição e constar do build e do cache offline.

Não há dependência de um arquivo WASM obtido em CDN durante a execução. FTS5 é verificado no binário realmente carregado, incluindo uma operação mínima com tabela temporária e `MATCH`. Essa comprovação não implementa ainda a pesquisa da biblioteca.

Referências: [distribuição npm do SQLite](https://sqlite.org/wasm/doc/trunk/npm.md), [release selecionada](https://github.com/sqlite/sqlite-wasm/releases/tag/3.54.1-build1) e [FTS5](https://sqlite.org/fts5.html).

## Escolha do VFS e concorrência

`opfs-sahpool` usa OPFS sem exigir `SharedArrayBuffer` e os cabeçalhos COOP/COEP. É uma opção adequada para a PoC de um aplicativo pessoal com uma instância ativa, especialmente pela necessidade de avaliar o Safari.

O VFS `opfs` tradicional tem outra estratégia de concorrência, exige isolamento e apresenta incompatibilidade documentada no Safari anterior ao 17 por um problema com sub-workers. A documentação aponta `opfs-sahpool` como alternativa para Safari 16.4 ou superior; isso é uma indicação de capacidade técnica, não um resultado de teste deste projeto.

O pool utiliza acesso exclusivo. A PoC deve controlar a propriedade da base e avisar quando outra aba ou instância estiver utilizando-a. Não será criada outra base ou selecionado armazenamento em memória para contornar esse bloqueio.

O fechamento precisa encerrar conexões e liberar os recursos do pool ou terminar o worker responsável. Apagar o VFS ou seus arquivos não é uma forma de fechar o banco.

O pool inicializa com `clearOnInit: false` e `preserveOnInitFailure: true`. A segunda opção evita a remoção dos arquivos do pool quando sua inicialização falha na distribuição utilizada. A exclusividade por Web Locks é uma primeira proteção; os handles nativos do OPFS continuam protegendo os arquivos se Web Locks estiver indisponível. A suíte também exercita esse segundo cenário.

Referência: [SQLite — opções de persistência](https://sqlite.org/wasm/doc/trunk/persistence.md).

## Origem, instalação e contexto seguro

Protocolo, host e porta definem a origem. Um banco em `http://localhost:5173` não deve ser procurado em `http://localhost:4173`. Perfis, navegadores e contextos de armazenamento também podem separar as bases.

O desenvolvimento usa porta fixa 5173 e a prévia de produção usa porta fixa 4173. Os testes de funcionamento offline são feitos na prévia de produção, pois o Service Worker não está habilitado no desenvolvimento.

OPFS e Service Worker precisam das capacidades de um contexto seguro. Para a máquina de desenvolvimento, `localhost` é aceito. Para celular e iPad acessando o computador pela rede, é necessário HTTPS com certificado confiável nesses dispositivos. `file://` e um endereço HTTP de LAN não são métodos válidos de distribuição desta PoC.

Referência: [MDN — uso de Service Workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).

## Preparação offline e atualizações

O build deve enumerar os recursos essenciais, incluindo arquivos gerados com nomes versionados, worker e WASM. O aplicativo só deve anunciar que está pronto para uso offline depois de confirmar que o Service Worker o controla e que esses recursos foram preparados.

Uma nova versão dos arquivos aguarda a ação de atualização. Antes de aplicá-la, a aplicação deve terminar operações em andamento e liberar o banco. A ativação de uma nova versão não inclui exclusão dos dados OPFS. A verificação de atualização deve ser testada preservando registros já gravados.

Enquanto houver páginas abertas, não há `skipWaiting()` automático: o botão de atualização fecha o banco, solicita a ativação e recarrega a interface. Se todas as páginas forem fechadas, o navegador pode ativar naturalmente um worker em espera. Os caches anteriores são preservados nesta PoC para servir os arquivos exatos de abas antigas; não há poda automática, e versões sucessivas podem aumentar o uso de armazenamento. A limpeza segura desses caches será avaliada antes do uso regular.

O plugin gera `sw.js` depois da escrita dos arquivos do build, com lista exata e SHA-256 de cada recurso. Na instalação, cada resposta é verificada antes de confirmar o cache. O matching ignora `Vary` apenas para URLs exatas dos arquivos estáticos conhecidos, evitando a diferença de `Origin` entre o precache e os módulos com CORS. Parâmetros de URL, origem e escopo continuam sendo respeitados. Ao iniciar offline, a interface reutiliza o registro local do Service Worker sem aguardar uma busca de `sw.js` na rede.

Referência: [MDN — operação offline de PWAs](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation).

## Armazenamento concedido não significa permanência

O diagnóstico consulta as APIs presentes, a estimativa de uso/cota e o estado de persistência quando disponíveis. A existência de uma API não comprova que a operação terá sucesso; são necessárias a abertura real da base e operações de leitura e gravação.

O WebKit documenta suporte completo à Storage API desde Safari/iPadOS 17. A concessão de `persist()` é heurística, e a execução a partir da Tela de Início pode fazer parte dessa avaliação. O retorno precisa ser exibido corretamente, sem confundir “solicitação concedida” com imunidade à exclusão pelo usuário.

Pressão de armazenamento, políticas de remoção e exclusão dos dados do navegador precisam ser consideradas. Estimativas de cota não representam reserva de espaço. Falhas de falta de espaço exigem tratamento próprio; uma operação rejeitada não deve produzir uma confirmação de gravação.

A aplicação não tenta identificar navegação privada por heurísticas. As capacidades e operações disponíveis naquele contexto são verificadas diretamente, sem prometer sobrevivência dos registros ao encerramento de um contexto temporário.

Referência: [WebKit — política de armazenamento](https://webkit.org/blog/14403/updates-to-storage-policy/).

## Evolução após a aprovação da persistência

A modelagem, as migrações e as validações básicas da biblioteca foram acrescentadas na fase 2. Cadastro, edição e backup foram acrescentados nas versões seguintes. A arquitetura mantém apresentação, comandos do banco, SQL e configuração PWA em módulos separados para permitir a evolução da pesquisa e das demais funções.

Na versão `0.3.0`, a tela inicial passa a ser a biblioteca com cadastro e edição. O laboratório fica em `?view=lab`, mantendo a origem e a base. A entrada carrega os módulos da tela escolhida; o precache inclui ambos e seus componentes para permitir a abertura offline. A API do worker acrescenta operações de domínio para catálogo, listagem, consulta, gravação e criação de categorias/subcategorias. O repositório valida os dados e grava conteúdos, vínculos, revisões e mudanças em transações. Edições com revisão desatualizada são recusadas.

Na versão `0.4.0`, o mesmo worker exporta JSON versionado e imagens SQLite portáteis. A importação aceita somente o JSON conhecido, valida uma base temporária construída com migrações confiáveis e grava em uma transação na base OPFS. A prévia identifica duplicados e conflitos, e uma impressão do estado local impede restaurar uma prévia desatualizada. O modo de adição não sobrescreve registros; a substituição exige confirmação explícita na interface. Os arquivos não são enviados a serviços externos. Veja [Backup e restauração](backup.md).

A imagem SQLite usa a API oficial [sqlite3_js_db_export](https://sqlite.org/wasm/doc/trunk/api-c-style.md#sqlite3_js_db_export), uma serialização do banco aberto. Não é uma cópia dos arquivos internos do pool OPFS. A restauração pela interface usa JSON para aplicar as validações do domínio e tratar conflitos.

Sincronização e IA continuam opcionais e posteriores. Nenhuma delas será necessária para consultar e manter a biblioteca localmente.

