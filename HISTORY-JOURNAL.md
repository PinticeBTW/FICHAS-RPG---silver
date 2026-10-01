# História — editor visual

A História mantém a folha de escrita, a lista de páginas, Passado / Durante a campanha e etiquetas. A barra compacta acrescenta títulos, negrito, itálico, sublinhado, listas, listas numeradas, tarefas, desfazer/refazer. «Inserir» disponibiliza caixas de texto, tabelas, separadores e código. As tabelas têm ações para acrescentar ou remover linhas e colunas. Não existe ferramenta de imagens, carregamento de ficheiros, mapa ou cartões de personagens.

## Preservação e formato

O editor usa Tiptap 3.31.4 / ProseMirror com dependências fixadas. O corpo continua na coluna de texto existente, num envelope `ghostgrid:history-document:v1` com JSON validado. Apenas nós, marcas, atributos e protocolos permitidos são aceites; não se guarda HTML executável. A apresentação usa o esquema do editor, sem `dangerouslySetInnerHTML`.

Markdown antigo é convertido em memória para apresentação. Sintaxe desconhecida, HTML e referências antigas a imagens permanecem texto literal, sem carregamentos externos. Abrir uma página ou mudar entre escrita e leitura não altera o corpo no servidor. Só uma edição de conteúdo introduz o novo formato; a versão anterior é conservada pelo mecanismo existente de revisões. Resumos, datas, imagens antigas e metadados continuam preservados em «Conteúdo anterior». Período e etiquetas não obrigam a converter o corpo.

Textos inválidos ou com formato futuro são conservados e apresentados sem interpretação. O limite total permanece 500000 caracteres, incluindo o envelope. O editor recusa alterações que excedam esse limite; não trunca conteúdo. O carregamento do editor é separado do início da aplicação.

## Apagar definitivamente

«Apagar página» substitui a ação de arquivar na página ativa. A confirmação explica que a página e todas as versões anteriores serão eliminadas. «Cancelar» recebe foco, Escape cancela e Tab fica dentro da confirmação. O servidor valida utilizador, personagem, universo e revisão antes de remover a página, revisões, posições e relações que a referenciam. Fontes anexadas continuam geridas pelo arquivo original e não podem ser apagadas nesta API. Páginas antigas já arquivadas continuam acessíveis para restaurar ou apagar.

A fila termina as gravações anteriores antes de apagar, bloqueia novas edições à página e só remove conteúdo local após confirmação válida. Falhas conservam o texto local e repetem a mesma revisão e UUID. Um recibo privado sem texto permite repetir um pedido cuja resposta se perdeu. Um gatilho rejeita recriações atrasadas do mesmo ID, evitando que uma gravação antiga ressuscite a página. O acesso privado existente mantém-se, incluindo a impossibilidade de o mestre apagar histórias pessoais de jogadores.

Migração aditiva: `supabase/migrations/20261001110206_history_documents_delete_v1.sql`, criada com a CLI do projeto. A migração não apaga dados durante a instalação. **Ainda não aplicada à produção.** É necessária para ativar os dois novos RPCs; publicar apenas o frontend não ativa a eliminação.

## Verificação

- TypeScript, build e ESLint dos ficheiros alterados.
- 49 testes passaram, incluindo PostgreSQL isolado: permissões, isolamento, versões, períodos, gravações, eliminação, repetição após perda de resposta, recusa de ressurreição e preservação das restantes páginas.
- Contratos de documentos: Markdown antigo, sintaxe desconhecida, tabelas, tarefas, caixas, links perigosos, limites e validação no esquema real de ProseMirror.
- CUA com conta fictícia e PostgreSQL isolado: folha vazia sem gravação, títulos, escrita, caixa, tabela preenchida, tarefa marcada, etiquetas, período, recarregamento, troca de páginas, leitura, confirmação/cancelamento, falha de rede e repetição. Verificação a 390 px sem transbordo horizontal.
- A eliminação definitiva foi exercitada nos testes SQL/fila. No navegador verificou-se a confirmação e o cancelamento, sem apagar páginas reais.
- Scripts de navegador adaptados ao editor visual; verificados sintaticamente. Não executados automaticamente nesta sessão; a UI foi verificada através de CUA.
- Pré-visualização fictícia: `output/history-documents/editor-visual.png`.

A versão para publicação inclui a correção do aviso: um RPC de apagar em falta já não é apresentado como uma falha da História inteira. Como PGRST202 confirma que o pedido não foi executado, a fila desbloqueia a escrita e não repete essa eliminação durante gravações posteriores. Falhas de rede ou respostas perdidas continuam a conservar o pedido original para repetição segura.

Ativação na produção pendente: o conector, a CLI e a conta do Chrome disponíveis apenas dão acesso ao ALTARA (`tbbgwjmmaiclkhssimhf`), enquanto as fichas usam `zrmqfrppygtpgstihrcj`. Foi pedido acesso à conta com RPGSILVERFICHA. Não foi alterada a base ALTARA nem apagado conteúdo real. O editor e a recuperação de escrita foram verificados na página local real, com o título e corpo preservados.
