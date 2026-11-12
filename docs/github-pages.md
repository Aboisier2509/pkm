# Publicar o PKM no GitHub Pages pelo navegador

Este roteiro usa o site do GitHub e o Explorador de Arquivos do Windows. Você não precisa instalar Git nem GitHub Desktop. A pasta de envio e o arquivo de publicação já foram preparados no projeto.

O resultado será um endereço como `https://SEU-USUARIO.github.io/pkm/`, acessível no computador, Android e iPad. O GitHub Pages hospeda os arquivos do aplicativo. Seus conteúdos continuam no banco local de cada navegador; publicar o aplicativo não envia sua biblioteca ao GitHub. O endereço de um projeto segue o formato usuário + nome do repositório. [Como funciona o GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

## 1. Criar sua conta e o repositório

1. Abra [github.com](https://github.com/) e entre na sua conta. Se ainda não tiver uma, use **Sign up** e conclua o cadastro.
2. Abra [github.com/new](https://github.com/new).
3. Em **Repository name**, escreva `pkm`, em letras minúsculas.
4. Escolha **Public**.
5. Ative **Add README**.
6. Clique em **Create repository**.

Um repositório é a pasta do projeto dentro do GitHub. A opção pública permite usar GitHub Pages no plano gratuito. O código ficará visível para outras pessoas. Use a pasta preparada nas próximas etapas para enviar somente os arquivos do projeto. [Criar um repositório](https://docs.github.com/en/repositories/creating-and-managing-repositories/quickstart-for-repositories) e [disponibilidade do Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

Na página criada, confira o seletor de branch, acima da lista de arquivos: ele deve mostrar **main**. A configuração preparada publica essa branch. Se aparecer outro nome, ajuste essa situação antes de criar o arquivo de publicação.

## 2. Enviar a pasta preparada

1. No Explorador de Arquivos, abra:

   ```text
   C:\Users\Anderson\Desktop\PKM\github-upload
   ```

2. Entre nessa pasta. Você deverá encontrar pastas como `src`, `public`, `scripts`, `tests` e `docs`, além de arquivos como `package.json` e `index.html`.
3. No GitHub, na página principal do repositório `pkm`, clique em **Add file → Upload files**.
4. Volte à janela do Explorador aberta **dentro de `github-upload`** e pressione **Ctrl+A**.
5. Arraste os itens selecionados para a área de upload no GitHub. Arraste **o conteúdo da pasta**, mantendo as pastas internas; a pasta externa `github-upload` não deve ir junto.
6. Aguarde o carregamento. Confira se os caminhos enviados começam com `src/`, `public/` etc. O arquivo `package.json` deve ficar diretamente na raiz do repositório, sem `github-upload/` antes dele.
7. No campo da mensagem, escreva `Adicionar aplicativo PKM`.
8. Escolha **Commit directly to the main branch** e confirme em **Commit changes**. Se abrir uma janela de confirmação, mantenha a opção de gravar diretamente em `main` e confirme novamente.

O README inicial será substituído pelo README do projeto, o que é esperado. Não envie a pasta `PKM` inteira nem um arquivo ZIP. A pasta preparada exclui dependências, arquivos de testes executados e cópias pessoais do banco. A configuração de publicação será criada separadamente na etapa 4.

O GitHub aceita arrastar arquivos e pastas pelo navegador. O limite é de 100 arquivos por envio e 25 MiB por arquivo; a pasta preparada para esta versão cabe nesses limites. [Upload pelo navegador](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository).

Depois de concluir, volte à aba **Code**. Você deve ver `src`, `public`, `scripts`, `tests`, `docs` e `package.json` na página principal do repositório.

## 3. Ativar a publicação pelo GitHub Actions

1. Dentro do repositório, clique em **Settings**.
2. No menu lateral, clique em **Pages**.
3. Na área **Build and deployment**, localize **Source**.
4. Selecione **GitHub Actions**.

Mantenha essa escolha e siga para a etapa seguinte. Não precisa escolher um dos modelos sugeridos pelo GitHub: o projeto já tem sua configuração. [Configurar a origem de publicação](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

## 4. Criar o arquivo que publica o aplicativo

Esse arquivo diz ao GitHub como instalar as dependências, executar os testes automáticos do banco, gerar o aplicativo e publicar o resultado. Vamos copiar o arquivo preparado, sem editar o código.

1. No Explorador de Arquivos, abra a pasta:

   ```text
   C:\Users\Anderson\Desktop\PKM\.github\workflows
   ```

2. Abra `pages.yml` no **Bloco de Notas**. Se necessário, use o botão direito no arquivo e **Abrir com → Bloco de Notas**.
3. Pressione **Ctrl+A** e depois **Ctrl+C** para copiar todo o conteúdo.
4. No GitHub, volte à aba **Code** do repositório `pkm`.
5. Clique em **Add file → Create new file**.
6. No campo do nome, digite o caminho completo:

   ```text
   .github/workflows/pages.yml
   ```

7. Clique na área grande de edição, abaixo do nome, e pressione **Ctrl+V**. Mantenha os espaços e as quebras de linha do arquivo.
8. Clique em **Commit changes…**.
9. Escreva `Configurar publicação do PKM` e escolha **Commit directly to the main branch**.
10. Confirme em **Commit changes**.

O caminho precisa começar com o ponto de `.github`, e o arquivo precisa terminar em `.yml`. Essa pasta especial é onde o GitHub reconhece as automações. Você não precisa criar senha de aplicativo, token ou secret para essa publicação. [Criar uma automação pela interface do GitHub](https://docs.github.com/en/actions/get-started/quickstart).

## 5. Aguardar e abrir o endereço

1. Clique na aba **Actions** do repositório.
2. Escolha **Publicar PKM no GitHub Pages** e abra a execução que apareceu depois da última alteração.
3. Aguarde a conclusão. Um círculo amarelo indica que ainda está executando; um símbolo verde indica sucesso; um símbolo vermelho indica uma falha.
4. Quando concluir com sucesso, volte a **Settings → Pages**.
5. Abra o endereço mostrado pelo GitHub, semelhante a:

   ```text
   https://SEU-USUARIO.github.io/pkm/
   ```

Troque `SEU-USUARIO` pelo seu nome de usuário real. Use o endereço do **Pages**, que termina em `/pkm/`, para abrir o aplicativo. O endereço `github.com/SEU-USUARIO/pkm` abre os arquivos do projeto.

Se a execução ficar vermelha, abra-a e clique na etapa que falhou para ler a mensagem. Guarde o nome da etapa e a mensagem para corrigirmos. [Consultar as execuções](https://docs.github.com/en/actions/how-tos/monitor-workflows/view-workflow-run-history).

Se precisar repetir após uma correção, a aba **Actions** permite abrir **Publicar PKM no GitHub Pages** e usar **Run workflow**, escolhendo `main`. [Iniciar uma execução manualmente](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).

## 6. Testar no Android ou iPad

1. No aparelho, abra o endereço HTTPS publicado. No Android, comece pelo Chrome; no iPad, pelo Safari.
2. Espere aparecer **Pronto para uso offline**.
3. Salve um conteúdo de teste e espere a confirmação.
4. Feche a aba, desligue a conexão e abra novamente o **mesmo endereço**, no mesmo navegador. Confira se o conteúdo continua lá e se consegue cadastrar outro.
5. Teste também **Backup e restauração**: exporte o JSON, confira o arquivo no gerenciador de arquivos do aparelho e valide-o na tela de restauração.

O computador e o Python não precisam ficar ligados para acessar o site publicado. A primeira abertura do site precisa de conexão; as próximas podem funcionar offline depois de os arquivos estarem preparados.

A biblioteca do endereço publicado começa separada da biblioteca de `localhost`. Para levar seus registros atuais, exporte o backup JSON da versão local, transfira-o para o aparelho e restaure no aplicativo publicado. Cada navegador e dispositivo continua com sua própria base. [Guia de backup](backup.md).

Se o navegador oferecer **Instalar aplicativo** ou **Adicionar à tela de início**, você também poderá testar esse modo. Feche a outra aba antes de abrir o aplicativo instalado, pois o banco aceita um acesso por vez. Instalação, download e persistência ainda precisam ser conferidos no aparelho real; este roteiro não substitui essa validação.

## Atualizações futuras

Depois que o código atualizado for enviado para a branch `main`, o GitHub executará novamente os testes, a geração e a publicação. Esta pasta de envio é uma cópia preparada; editar os arquivos locais do projeto não atualiza o GitHub automaticamente.

No aplicativo aberto, use **Verificar atualização** e, quando oferecido, **Aplicar atualização**. Continue usando o mesmo endereço para acessar a mesma biblioteca local.
