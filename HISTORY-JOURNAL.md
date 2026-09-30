# História — documentos simples

A História abre diretamente uma folha para escrever, com uma lista compacta de páginas. Não apresenta cartões, tipos de entidade, seleção de personagens, mapa ou relações. Uma página tem título, texto, período (Passado / Durante a campanha / sem período) e etiquetas livres. A formatação Markdown e a leitura são opcionais. A pesquisa e outras formas de recuperação ficam para uma etapa posterior.

Abrir uma folha vazia não cria dados no servidor. A primeira alteração cria uma nota privada; a gravação automática reutiliza a fila versionada existente. Falhas e conflitos conservam o texto e permitem repetir a gravação ou exportar o rascunho. Sair com alterações pendentes continua a exigir guardar ou exportar.

## Conteúdo e acesso existentes

Não há migração nem eliminação de dados. As entradas anteriores aparecem como páginas, sem mostrar o tipo. O texto, resumo, imagem, data, estado canónico, fontes e etiquetas continuam intactos; resumo, imagem e data estão em Conteúdo anterior. As relações e posições permanecem guardadas e não são modificadas pela escrita. Versões anteriores, arquivo/restauro e exportação estão nas opções secundárias. Conteúdo ligado a uma fonte continua apenas legível aqui.

O armazenamento privado continua ligado ao arquivo autorizado existente. Sem parâmetros explícitos, abre o último arquivo autorizado desta sessão, ou o da ficha da própria conta, ou o primeiro arquivo autorizado. A preferência de navegação guarda apenas o ID por utilizador em sessionStorage; esse ID tem de corresponder à lista atual devolvida pelo servidor. Uma ligação explícita sem acesso nunca abre outro arquivo como alternativa. A autorização do servidor e a ligação imutável das gravações não mudam. Não há fusão de arquivos privados nem acesso do mestre às histórias privadas de jogadores.

O arquivo geral do mestre mantém o contexto por universo. Mudanças de contexto ocultam o arquivo anterior sem descartar a fila por guardar.

## Organização compatível

O período usa os marcadores de tags existentes `lorelink:period:v1:past` e `lorelink:period:v1:campaign`, ocultos nas etiquetas visíveis. Sem marcador não se infere nem grava uma classificação. O limite é de 30 etiquetas incluindo o período, com até 60 caracteres por etiqueta. Acrescentar um período a 30 etiquetas recusa a alteração sem truncar dados.

## Verificação desta alteração

- TypeScript, ESLint dos componentes alterados e build de produção.
- 35 testes de PostgreSQL isolado, permissões, gravações, isolamento, revisões e períodos passaram.
- Verificação manual no Chrome com dados sintéticos e PostgreSQL isolado: entrada direta sem seletor, duas páginas, escrita contínua, Passado / Durante a campanha, etiquetas, gravação e recarregamento, troca de páginas, falha de gravação e repetição sem perda, leitura e navegação a 390 px sem transbordo horizontal.
- Página real verificada apenas em leitura: os textos anteriores continuam disponíveis; a navegação direta volta ao mesmo arquivo autorizado.
- Os scripts de navegador foram atualizados para o fluxo de documentos e para testar preservação do conteúdo e grafo anteriores. Foram verificados sintaticamente, mas não executados nesta sessão; a verificação de UI foi manual com CUA.
- Evidência ilustrativa com dados sintéticos em `output/history-documents/exemplo.jpg`.

Alteração local. Sem commit, publicação ou alterações em dados reais nesta tarefa.
