# Backup e restauração

O backup cria uma cópia externa da biblioteca. Exporte o arquivo e guarde-o fora dos dados do navegador, por exemplo em uma pasta do computador, pendrive ou armazenamento pessoal. Abrir a mesma URL em outro navegador continua usando outra base local; para levar os dados até ele, transfira o arquivo e restaure-o.

## Exportar

1. Abra **Backup e restauração** na biblioteca.
2. Escolha **Exportar backup JSON**.
3. Confira se o navegador concluiu o download e guarde o arquivo em um local seguro.

O JSON inclui conteúdos, categorias, todas as versões de campos das categorias, subcategorias, tags, vínculos, favoritos, notas, datas, UUIDs, revisões, histórico de alterações e registros do laboratório. Inclui também metadados de anexos; arquivos binários de anexos ainda não são gerenciados pelo aplicativo. O arquivo contém informações pessoais em texto, sem criptografia.

**Exportar banco SQLite** fornece uma cópia portátil do banco para inspeção e uso com ferramentas SQLite. A restauração pela interface aceita o backup JSON do aplicativo; não aceita arquivos `.sqlite3`.

O download é solicitado ao navegador. O aplicativo não consegue confirmar que o usuário guardou o arquivo em outro dispositivo ou que o download terminou. Backup não é sincronização automática e não é criado a cada salvamento.

## Restaurar

1. Abra **Backup e restauração** no navegador de destino.
2. Selecione o arquivo em **Arquivo de backup JSON** e clique em **Validar arquivo**.
3. Confira a data, as quantidades, as duplicidades e os conflitos apresentados.
4. Escolha o modo e clique em **Restaurar backup**.

**Adicionar sem sobrescrever** mantém os registros locais e adiciona os ausentes. Registros idênticos são ignorados sem duplicação. Se um identificador já existir com outros dados ou houver colisão de uma chave única, a adição inteira é bloqueada. A aplicação não escolhe silenciosamente qual versão manter.

Por exemplo, uma categoria chamada “Receitas” criada separadamente em dois navegadores terá identificadores diferentes. Apesar do nome igual, isso gera um conflito ao adicionar as bases. O mesmo vale para nomes de tags equivalentes após normalização. Esta versão não unifica nomes nem oferece mesclagem manual por conteúdo; você pode manter a base atual ou substituir a base inteira com confirmação.

**Substituir a base local** troca todos os registros locais pelos registros do arquivo. Esse modo exige confirmação explícita e digitar `RESTAURAR`. Antes, exporte a biblioteca atual se quiser conservar informações que só existem nela. A substituição preserva os identificadores e as revisões do backup, inclusive o histórico.

A seleção e a validação do arquivo não alteram os dados. A gravação final ocorre em uma transação: uma falha impede confirmação e desfaz as alterações. Se a base mudar depois da prévia, é necessário validar novamente.

## Formato e limites

- Formato JSON do PKM, versão **1**, para o esquema do banco **2**.
- Limite de arquivo: **50 MiB**.
- Verificação SHA-256 para detectar alteração acidental do arquivo; não é assinatura digital nem autenticação da origem.
- Validação de tabelas, colunas, valores, metadados e relacionamentos em uma base temporária com estrutura criada pelo aplicativo. Nenhum SQL é executado a partir do arquivo.
- A estrutura de migrações vem do aplicativo; o arquivo não substitui as migrações de confiança.
- Na adição, os identificadores globais e os dados dos registros do histórico são preservados; o cursor local `change_log.sequence` dos registros adicionados é reatribuído para continuar a sequência da base de destino. Na substituição, a sequência do arquivo é preservada.
- O recurso funciona offline após os arquivos da aplicação estarem preparados para uso offline.

Não edite manualmente o JSON exportado. Um arquivo de versão futura ou incompatível é recusado sem alterar a biblioteca.

## Testar sem arriscar sua biblioteca principal

Exporte um backup, abra o aplicativo em outro navegador ou perfil e restaure ali. Confira um conteúdo, seus campos específicos, tags e notas. Exporte novamente no destino para comparar os registros. Restaure o mesmo arquivo novamente no modo de adição para verificar que não cria duplicatas.

Os testes automatizados usam Chrome e Edge locais, incluindo contextos isolados e falha de escrita simulada. Isso não substitui testes físicos em Android e iPadOS, que continuam pendentes. O comportamento de download e escolha de arquivos nesses dispositivos também precisa de validação física.

## Validação desta entrega

Em 11 de novembro de 2026, a versão `0.4.0`, build `0.4.0+3ed0925422faf9fc`, passou na verificação de tipos, no build e em **126 testes**, sem retries: 66 de banco/validação e 30 em cada navegador. Os novos casos são 11 testes de integração do backup e 7 cenários em cada navegador. A exportação SQLite foi reaberta em outra conexão e conferida com `integrity_check` e `foreign_key_check`. Veja os [resultados completos](test-results.md).
