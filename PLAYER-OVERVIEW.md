# 08 — Visão geral dos jogadores

O Silver tem 07 — Notas e 08 — Visão geral. A vista antiga `?view=board` abre a visão geral. A entrada Quadro e os botões para fixar fichas no quadro saíram da interface; as notas e os desenhos armazenados foram preservados.

A grelha consulta as fichas autorizadas dos jogadores, incluindo as suas personagens adicionais. Exclui o mestre e os NPCs do mestre. Cada cartão mostra Vida, PS, PE, Defesa, Bloqueio e Karma, com ligação para abrir a ficha. Não permite editar valores nem cria fichas ao consultar.

Reutiliza as leituras e subscrições existentes das fichas. Mantém os últimos valores durante uma atualização, informa sobre falhas e ignora respostas mais antigas que a versão já recebida. Desmontar a vista cancela as subscrições. As permissões de base de dados existentes continuam a ser a autoridade; esconder a vista de jogadores é uma proteção adicional da interface.

Valores vazios aparecem como travessão; zero, valores negativos e bónus acima do máximo continuam visíveis. Apenas a largura das barras fica limitada a 0–100%.

## Verificação local

- Build, TypeScript, ESLint dos ficheiros alterados e `node --test tests/player-overview.test.mjs` passaram.
- Navegador: grelha, personagem adicional, exclusão de NPC do mestre, falha e recuperação de leitura, notas preservadas e acesso direto de jogador.
- Layout a 390 px sem excesso de largura. Fixture isolada: `node tests/player-overview-serve.mjs` (5177/9180), sem encaminhar pedidos para serviços reais.
- Conta Silver: oito fichas reais, notas existentes e ligação para a ficha de Ayin confirmadas por leitura. Não foram alterados valores reais. Eventos realtime reais e reconexão não foram provocados neste teste.

Esta alteração foi preparada localmente; não houve publicação nem migração da base de dados.
