# Validação da persistência offline

## Quando considerar a fase aprovada

A fase 1 só pode ser aprovada em uma plataforma depois de comprovar a recuperação dos valores exatos após uma nova inicialização, inclusive offline, sem recriar os registros. Os testes de integridade, rollback e falhas também precisam de evidência.

Uma execução bem-sucedida no Windows não aprova Android ou iPadOS. Testes automatizados de navegador complementam, mas não substituem, o teste em hardware físico. Registre cada combinação de sistema, navegador e modo de execução separadamente em [Resultados](test-results.md).

## Preparação

1. Gere o build com `npm run build`.
2. No Windows local, execute `npm run preview` e abra `http://localhost:4173/?view=lab` para testar a sonda. A tela inicial sem a consulta é a biblioteca na versão `0.4.0`.
3. Em Android, é possível usar `localhost` por [encaminhamento USB do Chrome](android-testing.md). Para acesso pela rede em Android ou iPad, use uma origem HTTPS com certificado confiável nos dispositivos.
4. Use um perfil comum de teste e registros sem dados pessoais. Não use navegação privada como evidência de retenção após encerramento.
5. Registre a origem completa, as versões e os diagnósticos antes de gravar.
6. Aguarde a preparação offline confirmada pela aplicação. Não basta abrir a página uma vez ou instalar o ícone.

Mantenha a mesma origem e o mesmo contexto durante toda a sequência. Registre de forma separada os testes em aba e em PWA instalada. Uma troca de porta, navegador ou perfil pode mudar a base examinada.

## Evidências obrigatórias por execução

| Campo | Preenchimento |
| --- | --- |
| Data e responsável | Data, hora, fuso e identificador de quem testou |
| Hardware | Fabricante/modelo e se é dispositivo físico |
| Sistema operacional | Nome e versão completa |
| Navegador | Nome e versão completa |
| Modo | Aba ou aplicativo instalado |
| Origem | Protocolo, host e porta |
| Aplicativo | Versão e identificação do build |
| SQLite | Versão reportada pelo binário |
| Persistência | VFS reportado, suporte observado e resultado de `persist()` |
| Armazenamento | Estimativas de uso e cota, ou API indisponível |
| Recursos offline | Estado de preparação confirmado antes de desconectar |
| Sonda | UUID, texto de teste e data UTC gravados |
| Verificações | Resultado de integridade, rollback e disponibilidade de FTS5 |
| Resultado | Aprovado, reprovado ou pendente, com evidência e motivo |

Use um texto público de teste, por exemplo: `Persistência local — ação, café, programação, iPad 🧠`. Não inclua dados pessoais em relatórios, capturas ou logs.

## Casos de teste

### P01 — Criar, inserir e consultar

Abra a aplicação com conexão, inicialize a base e grave o texto de teste. Aguarde a confirmação de gravação. Consulte a lista e confira UUID, texto completo e data. A aplicação precisa indicar SQLite real, OPFS e o VFS selecionado.

**Passa:** existe exatamente o registro confirmado, com o texto intacto. Uma indicação de API disponível, sem gravação real, não passa.

### P02 — Fechar e reabrir a conexão

Use o controle de fechar o banco e depois abra-o novamente, sem recriar os dados. Consulte o mesmo UUID.

**Passa:** o registro reaparece com conteúdo e data iguais. O fechamento libera os recursos; não apaga a base.

### P03 — Encerramento real e inicialização fria

Depois de uma gravação confirmada, feche a página ou a PWA. Encerre a instância pelo mecanismo normal do sistema e inicie uma nova. Consulte o registro anterior. Repita encerrando o aplicativo pelo gerenciador de tarefas/aplicativos depois da confirmação do `COMMIT`.

**Passa:** a nova instância recupera o mesmo registro sem semear dados ou restaurar uma lista apenas mantida na memória da interface. Registre separadamente encerramento normal e forçado.

O fechamento forçado durante uma transação é um teste adicional de recuperação: operações sem confirmação não podem ser tratadas como gravações garantidas. Após reabrir, verifique integridade e estado real antes de concluir o resultado.

### P04 — Abrir e gravar sem rede

Após a preparação inicial, ative modo avião ou remova o acesso de rede do dispositivo. Feche e inicie a aplicação novamente. Consulte o registro de P01, grave um segundo texto, confirme a gravação e repita encerramento/reabertura ainda offline.

**Passa:** tanto o registro anterior quanto o novo são recuperados exatamente, e os recursos essenciais não exigem CDN ou acesso ao servidor. Apenas desconectar uma página que já estava aberta não comprova uma inicialização offline.

### P05 — Integridade e rollback

Execute a verificação de integridade e o teste de rollback. O teste de rollback deve provocar uma falha no meio de uma transação e conferir que as inserções parciais de teste não permaneceram.

**Passa:** `PRAGMA integrity_check` retorna `ok`, o rollback é comprovado e os registros anteriores não se alteram. Confira também o resultado do teste mínimo de FTS5 no binário carregado; indisponibilidade deve ser registrada, sem supor suporte.

### P06 — Outra aba ou instância ativa

Com o banco aberto, abra outra aba na mesma origem/contexto. Tente usar a base. Depois feche/libere a primeira instância e repita a abertura na segunda.

**Passa:** há aviso compreensível de acesso ocupado, sem base substituta em memória e sem falsa indicação de banco vazio. Após liberar os recursos, a segunda instância consegue abrir a base original.

### P07 — Atualizar arquivos preservando o banco

Grave e registre uma sonda. Prepare uma segunda versão do build na mesma origem. Verifique a atualização, mantenha-a aguardando e só depois aplique-a pelo controle da aplicação. Consulte o UUID anterior e repita uma inicialização offline.

**Passa:** não há recarga inesperada durante operação, a nova versão é identificável e os registros sobrevivem. A troca do cache da interface não apaga arquivos do banco.

### P08 — Armazenamento indisponível e falta de espaço

Verifique o comportamento quando a inicialização de OPFS falha e quando uma escrita é rejeitada por falta de espaço. Use um perfil descartável ou mecanismos controlados de teste; não preencha o armazenamento de uso pessoal deliberadamente.

Se o erro for injetado ou simulado por automação, rotule o resultado como **simulação**. Esse teste valida o tratamento da aplicação, mas não comprova o comportamento físico de cota em cada navegador.

**Passa:** o erro é apresentado, nenhum sucesso falso aparece, os dados anteriores permanecem acessíveis quando tecnicamente possível e não existe fallback silencioso para outro armazenamento. Indique o que foi verificado em ambiente real e o que continua pendente.

### P09 — Texto e validação

Tente gravar texto vazio, ultrapasse o limite permitido e use aspas, trechos SQL e marcações HTML como texto de teste. Consulte os registros válidos.

**Passa:** entradas inválidas são rejeitadas antes da confirmação, entradas válidas permanecem texto literal e nenhuma marcação é executada. Os valores não devem ser incluídos em logs.

## Matriz de plataformas físicas

Todas as linhas começam pendentes. Marque apenas o que tiver sido executado e documentado.

| Plataforma | Navegador/contexto | P01–P09 | Estado inicial |
| --- | --- | --- | --- |
| Windows 10, desktop ou notebook | Chrome, aba e instalado | Pendente | Pendente |
| Windows 10, desktop ou notebook | Edge, aba e instalado | Pendente | Pendente |
| Windows 11, desktop ou notebook | Chrome, aba e instalado | Pendente | Pendente |
| Windows 11, desktop ou notebook | Edge, aba e instalado | Pendente | Pendente |
| Android, smartphone físico | Chrome, aba | Pendente | Pendente |
| Android, smartphone físico | PWA instalada | Pendente | Pendente |
| Android, tablet físico | Chrome, aba e instalado | Pendente | Pendente |
| iPadOS 17+, iPad físico | Safari, aba | Pendente | Pendente |
| iPadOS 17+, iPad físico | PWA pela Tela de Início | Pendente | Pendente |
| iPadOS 16.4, se fizer parte do público real | Safari e Tela de Início, separados | Pendente | Exploratória; sem garantia |

Adicione as versões efetivamente usadas, sem supor que o resultado de uma versão valha para todas as outras. Nos dispositivos de toque, registre orientação, legibilidade, acesso aos controles e teclado em tela.

## Encerramento da fase

Para cada resultado, anexe a evidência ou descreva os passos reproduzíveis. Uma falha deve conservar seu registro mesmo após correção, com o reteste identificado. Casos sem equipamento, sem HTTPS confiável ou sem execução real permanecem pendentes.

A decisão de avançar para a modelagem completa deve se basear nesses resultados e nas limitações restantes. Não interprete a concessão de armazenamento persistente como garantia de conservação permanente: uma futura fase de backup continua necessária.

