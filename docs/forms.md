# Cadastro e edição de conteúdos

A versão `0.3.0` acrescenta a biblioteca e seus formulários sobre o esquema SQLite `2`, sem mudar o banco ou o pool OPFS. O laboratório de persistência continua disponível pelo link **Diagnóstico**, em `?view=lab`.

## Validação — 11 de novembro de 2026

Build validado: `0.3.0+33afe9aa278a7d8d`. Verificação de tipos e build passaram. A suíte completa passou em **101 testes**, sem retries, em aproximadamente 2 minutos e 24 segundos:

| Grupo | Resultado |
| --- | --- |
| SQL, migrações, repositório e validação de domínio | 55 passaram com SQLite WASM real em memória e testes Node |
| Chrome instalado, perfil isolado | 23 passaram, incluindo oito cenários novos de formulários |
| Edge instalado, perfil isolado | 23 passaram, incluindo oito cenários novos de formulários |

Os cenários novos de navegador comprovam cadastro completo com subcategoria, tags e metadados; edição preservando UUID e incrementando revisão; abertura, edição e reabertura offline; cancelamento com confirmação; categorias próprias e quatro modelos; URL insegura recusada com rascunho preservado; HTML/SQL como texto sem conteúdo nos logs; falha OPFS simulada sem confirmação falsa; e formulário em viewport de 390 px com toque simulado e sem rolagem horizontal.

Os 15 testes novos do repositório verificam também conflitos de revisão, preservação da definição antiga de metadados, relógio recuado, limites de JSON e rollback tardio em snapshot, log, categoria e subcategoria. Falhas são injetadas em bases isoladas; não são evidência de esgotamento físico de armazenamento. Android e iPad físicos continuam pendentes.

Artefatos da execução ficam em `test-results/` e `playwright-report/`, que podem ser substituídos por outra execução. A conferência de layout confirmou o menu lateral no topo, o link de pular conteúdo disponível pelo foco e ausência de rolagem horizontal.

## Cadastrar

1. Abra a biblioteca e escolha **Novo conteúdo**.
2. Informe o título e selecione uma categoria. Use **Criar categoria** se ainda não houver uma adequada.
3. Preencha conteúdo, resumo, origem, notas, status, favorito e tags conforme necessário.
4. Preencha os campos específicos da categoria e escolha **Salvar conteúdo**.

As sugestões de categorias são Prompts de IA, Receitas, Exercícios e Ethical Hacking. Uma categoria também pode ser criada sem campos adicionais. A criação é explícita; a aplicação não insere categorias automaticamente.

Uma subcategoria é opcional e pertence à categoria selecionada. Tags são adicionadas como valores separados; nomes equivalentes pela normalização Unicode são reutilizados, sem criar duplicatas. Um conteúdo aceita até 30 tags. As listas dos campos específicos também mantêm cada entrada como um valor independente.

Categorias e subcategorias criadas pelo diálogo ficam gravadas mesmo se o cadastro do conteúdo for cancelado depois. Tags novas, vínculos e conteúdo são gravados juntos somente ao salvar o conteúdo.

## Editar e cancelar

Use **Editar** no cartão de um conteúdo. A edição mantém o UUID e a data de cadastro e incrementa a revisão. Se a categoria ganhou uma definição de campos mais recente, a edição usa a versão original do conteúdo; não há conversão silenciosa de metadados.

**Cancelar** não grava alterações do conteúdo. Havendo mudanças no formulário, a aplicação pede confirmação antes de descartá-las. Os rascunhos existem somente na memória da página: não são uma gravação automática ou um backup. O aviso de saída do navegador é uma proteção adicional e depende do sistema; não é garantido no encerramento forçado ou em dispositivos móveis, conforme a documentação de [beforeunload](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event).

Em uma tentativa de gravação rejeitada, o formulário permanece disponível para correção. Uma resposta incerta do banco não é anunciada como sucesso. Confira os registros antes de repetir uma gravação cuja confirmação não chegou.

## Integridade da gravação

O worker recebe operações de domínio, sem aceitar SQL arbitrário. O repositório valida campos comuns, categoria e subcategoria ativas, versão dos metadados, tags e revisão esperada. As consultas usam parâmetros.

Uma transação grava o conteúdo, os vínculos de tags, o snapshot em `item_revisions` e o registro correspondente em `change_log`. Tags criadas nessa operação e seus registros de mudança fazem parte da mesma transação. A criação de categoria grava categoria, definição de campos e log em uma transação; a subcategoria também é registrada junto de seu log.

A edição compara a revisão carregada no formulário com a revisão atual no banco. Em um conflito, recusa a sobreposição e orienta abrir a versão atual. Datas de atualização não retrocedem em relação às datas já gravadas quando o relógio do dispositivo muda.

O histórico agora recebe snapshots nas gravações da biblioteca. O log continua local; esses registros não implementam sincronização, envio a serviços externos ou restauração de revisões pela interface.

## Atualizar a instalação

Sirva o novo `dist/` na mesma origem usada anteriormente. Use **Verificar atualização** e **Aplicar atualização** para carregar a nova versão. A biblioteca passa a ser a tela inicial; os registros da sonda continuam em **Diagnóstico**. A consulta `?view=lab` não altera a origem nem cria outro banco.

Os recursos essenciais do formulário, os componentes e o SQLite WASM fazem parte do cache da PWA. Aguarde **Pronto para uso offline** antes de testar a abertura sem rede. A validação em Android e iPad físicos continua pendente.

No computador que serve a aplicação, desligar apenas o Wi-Fi não impede o acesso a `localhost`. Para testar a abertura sem depender do servidor local, aguarde o preparo offline, pare o servidor com `Ctrl+C`, feche a aba e abra novamente a mesma URL. Cadastre ou edite um registro e repita a reabertura. Reinicie o servidor para receber novas versões depois.

## Limites desta entrega

A entrega `0.3.0` acrescentou cadastro, edição, listagem para escolher o conteúdo e criação de categorias/subcategorias durante o cadastro. A versão `0.4.0` acrescenta [backup e restauração](backup.md). Pesquisa global, exclusão, anexos em arquivo e sincronização continuam pendentes. A criação visual de definições de campos personalizadas e a alteração de definições existentes também são etapas futuras; há os quatro modelos e o formato sem campos adicionais.
