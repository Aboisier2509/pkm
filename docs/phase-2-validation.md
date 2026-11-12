# Validação da fase 2

Versão da aplicação: `0.2.0`. Versão do esquema: `2`. Build validado: `0.2.0+c0dbe53fb999bee3`. Execução em 10 de novembro de 2026: **70 testes passaram**, sem retries, em aproximadamente 2 minutos e 30 segundos. As evidências históricas da fase 1 estão em [Resultados](test-results.md).

| Grupo | Resultado | Ambiente |
| --- | --- | --- |
| SQL, migrações e integridade relacional | 19 passaram | SQLite WASM oficial `3.54.1`, pacote `3.54.1-build1`, em memória no Node 24.14.1 |
| Validação de domínio e metadados | 21 passaram | Node, sem navegador ou servidor |
| Persistência, upgrade e aplicação offline | 15 passaram | Chrome instalado, canal `chrome`, headless, perfil isolado |
| Persistência, upgrade e aplicação offline | 15 passaram | Edge instalado, canal `msedge`, headless, perfil isolado |
| TypeScript e build | Passaram | `npm run build`, com `tsc --noEmit` e Vite 8.3.7 |

Foram utilizados o Windows disponível (build 26300), Chrome `156.0.8078.80` e Edge `157.0.4341.42`. O build contém 12 arquivos estáticos, cerca de 1,42 MB antes de compressão. As verificações no navegador confirmaram `opfs-sahpool`, esquema `2`, dez tabelas de biblioteca/infraestrutura e duas migrações registradas, além da tabela histórica preservada.

## Evidências de preservação

A fixture de navegador cria uma base OPFS com o DDL histórico independente da fase 1, o mesmo nome lógico e o mesmo diretório do pool. A versão atual migra essa base e recupera o UUID, o texto com acentos/emoji e a data original. Uma nova página sem rede recupera novamente o registro e passa em `PRAGMA integrity_check` e `foreign_key_check`. Esse cenário passou no Chrome e no Edge.

Uma segunda execução injeta uma única falha nativa de escrita OPFS durante a abertura/migração. A aplicação apresenta erro e não anuncia sucesso; removida a simulação, a abertura migra a base e recupera o registro legado. O teste usa somente sua base isolada, sem preencher o disco ou acessar o perfil pessoal.

Nos testes SQL, uma colisão tardia com uma tabela preexistente reverte os objetos já criados, o ledger e a versão, preservando os registros antigos e o objeto em conflito. Outros casos recusam versão futura, checksum divergente, lacunas de histórico, definições SQL alteradas e chaves estrangeiras incoerentes. A reabertura do esquema atual não reescreve dados nem o histórico.

## Constraints e validações

Os testes exercitam FKs compostas de categoria/subcategoria e categoria/versão, duplicatas de tags e nomes, status, favorito, UUID, datas UTC inválidas e ordem temporal, revisões, JSON não objeto, definições imutáveis, caminhos/hash/tamanho dos anexos e `base_revision < revision`. As tabelas de histórico continuam vazias até uma escrita explícita: a modelagem não simula sincronização ou geração automática de revisões.

Os validadores foram testados com Unicode, limites de comprimento, nomes normalizados em português, URLs HTTP/HTTPS, campos de metadados obrigatórios e desconhecidos, listas e opções, versões não suportadas, números não finitos, ciclos, getters, propriedades ocultas e chaves perigosas. A interface continua exibindo textos como texto literal.

## Correção encontrada durante a integração

A primeira execução de navegador detectou chamadas a dois campos de diagnóstico que ainda não estavam presentes no template. Isso interrompia a atualização da lista após abrir o banco. O template foi corrigido, e o estado “Conectado” passou a ser publicado depois de concluir a consulta e o diagnóstico. A suíte completa foi repetida sobre o build identificado acima, com os 70 resultados aprovados. A execução inicial foi interrompida após identificar a causa; não foi tratada como aprovação.

## Escopo verificável

- Base nova e atualização da base da sonda, com preservação de UUID, texto e data.
- Migrações atômicas, checksums e compatibilidade das definições SQL instaladas.
- Relacionamentos, índices e constraints do [modelo](database-model.md).
- Validação de campos comuns e metadados, com versões de definição e presets sem seed automático.
- Persistência OPFS, inicialização offline, atualização controlada e falhas de escrita na aplicação existente.

## Reproduzir

```powershell
npm run test:unit
npm run build
npm exec -- playwright test
```

O projeto `unit` não inicia navegador. A configuração `playwright.unit.config.ts` também dispensa o servidor. Os testes SQL usam o binário oficial SQLite WASM em memória; os testes de navegador usam OPFS real.

O servidor de automação usa a porta 4183 e uma cópia descartável `.test-dist/`, preservando a prévia pessoal da porta 4173 e seus arquivos. O teste que simula uma atualização altera somente a cópia. Todos os perfis são isolados. A fixture histórica é compilada apenas na memória do processo de testes e servida por rotas de teste; o aplicativo distribuído não inclui uma API de SQL arbitrário.

## Atualização manual da sua instalação

1. Use o novo `dist/` na mesma origem do teste anterior.
2. Verifique e aplique a atualização pelo aplicativo.
3. Confira `v2 · 10 tabelas da biblioteca` e `2 registradas · chaves estrangeiras ativas` no diagnóstico.
4. Confira que o registro anterior continua com o mesmo UUID e texto.
5. Execute a verificação de integridade, feche/reabra e repita sem rede após o preparo dos recursos.

O sistema não converte os registros de teste em itens de conhecimento e não exige limpar os dados existentes. Se encontrar versão ou estrutura incompatível, interrompe a abertura e apresenta o erro, preservando os arquivos para inspeção.

## Limites

Android, iPadOS e instalação da PWA pelo sistema continuam exigindo testes físicos. Falta de espaço e falha durante a migração são simuladas pela automação, sem esgotar o disco. Histórico e log possuem estruturas e constraints; a geração automática de revisões, edição de conteúdos e sincronização serão implementadas nas fases correspondentes.
