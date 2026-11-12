# Testar no Android por USB

Este roteiro permite testar a biblioteca no Chrome de um Android físico, servindo o build do computador por USB. Não exige publicar o projeto, instalar Python no celular ou configurar certificados. É um procedimento de teste; a execução no aparelho só estará validada depois de realizar os casos abaixo.

O Chrome documenta o [encaminhamento de portas por USB](https://developer.chrome.com/docs/devtools/remote-debugging/local-server). O celular acessa `http://localhost:4173`, cuja origem local pode usar os recursos que exigem contexto seguro. A exceção para endereços locais está descrita em [Secure Contexts](https://w3c.github.io/webappsec-secure-contexts/#is-origin-trustworthy).

## Preparar o computador

No PowerShell, na pasta do projeto:

```powershell
cd C:\Users\Anderson\Desktop\PKM
npm.cmd run build
npm.cmd run preview
```

Deixe o terminal aberto. Confira se o endereço exibido é `http://localhost:4173`. Se a porta já estiver ocupada por uma prévia deste projeto, use a instância existente. Mantenha essa porta durante o teste. Não use `npm run dev` para comprovar funcionamento offline: o desenvolvimento não habilita o Service Worker.

## Preparar o celular

1. Use o Chrome em uma aba comum e um cabo USB que transfira dados.
2. Nas configurações do Android, procure **Número da versão** ou **Número de compilação**, geralmente em **Sobre o telefone**. Toque sete vezes para habilitar as opções do desenvolvedor. Em Samsung, normalmente fica em **Sobre o telefone → Informações do software**.
3. Abra **Opções do desenvolvedor** e habilite **Depuração USB**.
4. Conecte o celular ao computador, mantenha-o desbloqueado e aceite a autorização de depuração para este computador.

Os nomes dos menus variam conforme o fabricante. Consulte as instruções oficiais de [opções do desenvolvedor](https://developer.android.com/studio/debug/dev-options) e [depuração remota do Chrome](https://developer.chrome.com/docs/devtools/remote-debugging).

## Encaminhar a porta e abrir

No Chrome do computador:

1. Acesse `chrome://inspect/#devices`.
2. Marque **Discover USB devices** e confira se o modelo do celular aparece.
3. Abra **Port forwarding**.
4. Adicione uma linha com **Port = 4173** e **IP address and port = localhost:4173**.
5. Marque **Enable port forwarding** e confirme em **Done**.

No Chrome do celular, digite o endereço completo:

```text
http://localhost:4173
```

Aguarde **Biblioteca conectada** e **Pronto para uso offline**. O aparelho começa com sua própria base: os dados do computador não aparecem automaticamente.

Este encaminhamento usa o cabo, independentemente da configuração do Wi-Fi. Apenas abrir `http://IP-do-computador:4173` pela rede não fornece o mesmo contexto seguro. Para usar Wi-Fi sem USB, sirva `dist/` em HTTPS confiável no aparelho; esse é outro método de distribuição. Não é preciso habilitar flags que tratem endereços inseguros como seguros.

## Validar persistência, offline e backup

1. Cadastre um conteúdo com acentos, emoji, categoria, tags e campos específicos. Aguarde a confirmação, edite-o e confira o resultado.
2. Exporte um **backup JSON** e confirme que o arquivo foi salvo no celular.
3. Feche a aba e abra novamente a mesma URL. Confira o conteúdo salvo.
4. Depois da indicação **Pronto para uso offline**, desconecte o cabo USB, ative o modo avião e confirme que o Wi-Fi está desligado. Isso interrompe tanto a rede quanto o encaminhamento USB.
5. Feche a aba e abra outra na mesma URL, ainda sem cabo e sem rede. Confira o registro anterior, crie outro, feche e reabra novamente. Ambos devem permanecer. Uma página que ficou aberta durante a desconexão não comprova abertura offline.
6. Ainda offline, exporte outro backup JSON. Em **Backup e restauração**, selecione esse arquivo, valide a prévia e restaure em **Adicionar sem sobrescrever**. O mesmo arquivo não deve duplicar conteúdos.
7. Para conferir a recuperação dos dados do computador, transfira ao celular um JSON exportado no computador e importe-o. Nomes iguais com identificadores diferentes podem bloquear a adição; confira a prévia. **Substituir a base local** remove os dados atuais e exige confirmação. Preserve o backup do celular antes de usar esse modo.

O [guia de backup](backup.md) explica os modos de restauração e seus limites. O arquivo externo é necessário para recuperar dados após a limpeza do armazenamento do navegador; não há sincronização automática.

## Testar a instalação

Reconecte o USB para disponibilizar o servidor durante a preparação da instalação. No menu do Chrome do Android, procure **Instalar e criar atalho → Instalar**, **Instalar aplicativo** ou **Adicionar à tela inicial**, conforme o menu disponível. Veja a [ajuda oficial do Chrome](https://support.google.com/chrome/answer/9658361?hl=pt-BR&co=GENIE.Platform%3DAndroid).

Feche a aba anterior antes de abrir pelo ícone: o banco permite apenas um acesso ativo. Abra pelo ícone, aguarde a preparação offline e repita os testes sem cabo e sem rede. Registre separadamente o teste em aba e pelo ícone. A presença de um atalho não comprova a instalação completa da PWA nem o funcionamento offline. Se a opção de instalação não aparecer nesse método local, conclua primeiro o teste em aba; a instalação pode ser avaliada depois em uma origem HTTPS estável.

## Se o celular não aparecer

Confira a autorização na tela do celular, teste outro cabo de dados ou outra porta USB e mantenha o Chrome do celular aberto. No Windows, alguns aparelhos precisam do driver USB do fabricante. A documentação de [depuração remota](https://developer.chrome.com/docs/devtools/remote-debugging#troubleshooting) traz o diagnóstico desse caso.

Depois de concluir, você pode desativar a depuração USB. Para atualizar os arquivos do aplicativo mais tarde, reconecte o encaminhamento e use o servidor na mesma porta. O cache preparado permite testar offline, mas não recebe um novo build sem acesso ao servidor.

Registre modelo do celular, versão do Android, versão do Chrome, versão/build do aplicativo e resultados em aba e pelo ícone. **Diagnóstico → Baixar diagnóstico** fornece as informações técnicas do aplicativo; não substitui o backup JSON.
