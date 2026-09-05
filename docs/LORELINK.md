# História / Lorelink — histórias dos jogadores

A História é primeiro um espaço pessoal para cada jogador escrever e organizar a história de cada personagem. Integra o site existente em `/app/history`. A produção usa o Supabase do RPG, sem fallback de conteúdo em memória ou localStorage.

## Fluxo

Ao abrir História na própria ficha RPG, a personagem selecionada acompanha a navegação. Ao entrar diretamente, o jogador escolhe entre as suas personagens, com os nomes das fichas e o universo autorizado. «Trocar personagem» regressa à escolha. Ter várias personagens não exige várias contas nem a promoção para GM.

- «Criar» e duplo clique criam fichas privadas. Tipos: Personagem, Evento, Local, Organização, Objeto e Nota.
- Mapa React Flow 12.11.6 e lista pesquisável usam as mesmas entidades. Bolhas por tipo, retratos, relações com nome e direção, pesquisa, filtros, foco, zoom, arrasto e enquadramento.
- Clicar numa bolha ou numa ficha abre «Ler»: texto formatado, resumo, etiquetas e relações navegáveis. «Expandir leitura» dá espaço ao texto longo; «Editar» regressa ao editor Markdown existente. Fichas novas abrem logo para escrever. Alternar os modos conserva o texto por guardar, incluindo quando há falhas.
- O editor mantém secções sugeridas, etiquetas, imagem privada e data/período ficcional independente das datas de gravação. O seletor Rascunho/Canónico foi retirado. O campo antigo conserva o valor na persistência para compatibilidade, sem alterações aos dados existentes.
- As bolhas têm pelo menos 12 pontos de ligação, aumentando até 32 conforme o número de relações. As linhas escolhem pontos voltados para a outra bolha e os nomes afastam-se quando se sobrepõem. Relações paralelas e em sentidos opostos usam curvas distintas. Nomes longos ficam limitados a duas linhas no mapa, com texto completo ao passar o rato ou abrir a relação. O foco de teclado realça a linha, sem desenhar um retângulo sobre as bolhas.
- Autosave de 750 ms, fila ordenada, UUIDs idempotentes, revisão esperada e confirmação por entidade, personagem e universo. Uma falha preserva o texto e permite repetir. «Guardado» exige confirmação do servidor.
- Retirar do mapa conserva a ficha. Arquivar exige confirmação e permite recuperar. A interface mostra as últimas 30 revisões. Exportação JSON confirma os dados no servidor e identifica a personagem; o rascunho não confirmado é identificado separadamente.
- Trocar de personagem resolve primeiro as alterações pendentes. Pedidos anteriores não seguem a seleção nova. Mudanças externas de autoridade ocultam os dados anteriores e permitem exportar o rascunho antes de sair.

As histórias pessoais ficam privadas nesta versão. A partilha pessoal fica para uma fase seguinte.

## Autoridade e dados

A migração v2 acrescenta `character_id` às entidades, mapas, posições e relações existentes. Reutiliza `net_identity_links.id` e o vínculo à ficha RPG, sem duplicar personagens ou importar lore. A coleção é separada por autor + personagem + universo. Mapas e posições continuam independentes do conteúdo.

Os RPCs v2 usam `auth.uid()`, o perfil no servidor e `current_user_controls_net_identity_link`, verificando também a propriedade real da ficha. O universo vem de `net_identity_os_assignments.primary_os_id`. IDs, `created_by` ou papéis enviados pelo cliente não concedem acesso. As linhas de autoridade ficam bloqueadas durante as operações.

A autoria não depende de acesso a VEIL Search ou da identidade global ativa em THE NET. A personagem tem de possuir vínculo e universo configurados pelo sistema existente; não se inventa uma atribuição para fichas sem configuração.

Tabelas e histórico mantêm RLS e nenhum acesso direto do cliente. Os helpers privados não são expostos. Restrições compostas garantem que mapas, posições e extremos pertencem à mesma coleção. Pesquisa, exportação, revisões e imagens seguem a mesma autorização. Outras contas e o GM não recebem histórias pessoais através das APIs; o administrador da base conserva os seus acessos administrativos normais.

`character_id = NULL` mantém o lore legado do GM. As operações v1 foram adaptadas para excluir conteúdo pessoal em leitura, gravação e histórico. Fontes existentes conservam os IDs, textos e permissões originais. Uma relação revelada exige ambos os extremos autorizados.

Imagens reutilizam o bucket privado `rpg-media`, otimizador e descritores existentes, com políticas restritivas no namespace `lorelink-entity`. URLs assinados duram 60 segundos e podem funcionar até expirar. Imagens antigas ficam retidas para revisões. Apagar uma personagem no fluxo existente conserva o UUID nos registos pessoais; sem identidade válida, o acesso é recusado. Não converte dados privados em lore do GM nem bloqueia a eliminação existente.

## Ativação e reversão

- `supabase/migrations/20260905013709_lorelink_v1.sql`: já aplicada manualmente pelo utilizador no RPG `zrmqfrppygtpgstihrcj`. Não repetir.
- `supabase/migrations/20260905115239_lorelink_player_stories_v2.sql`: extensão aditiva para jogadores, testada isoladamente. As capturas posteriores do utilizador mostram a autoria pessoal ativa e conteúdo guardado; não repetir para esta atualização visual.
- `supabase/lorelink-player-stories-v2.verify.sql`: verificação opcional só de leitura, sem contas ou lore. Não substitui testes autenticados.
- `supabase/lorelink-player-stories-v2.rollback.sql`: revoga RPCs pessoais sem apagar conteúdo. Conserva as proteções contra acessos pela v1. Não repor o SQL v1 original sobre a v2 nem limpar `character_id`. Reativação após revisão: devolver EXECUTE desses RPCs v2 a `authenticated`.

Não executar `supabase db push`: há outras migrações preexistentes no checkout. O conector Supabase do Codex pertence à app ALTARA e não foi alterado ou usado. O utilizador aplica o SQL no painel separado do RPG. A atualização de leitura e ligações não precisa de SQL, migração nem alteração de permissões; não executou SQL numa base existente.

## Testar

O checkout é `D:\GHOST GRID\RPGSILVER-veil-search-push`. O script entregue `Iniciar-Historia-Dev.ps1` lê em memória o ambiente já existente em `D:\GHOST GRID\RPGSILVER`, valida o Supabase do RPG e serve este checkout na porta 5173. Não copia nem imprime chaves. Depois da ativação, entrar normalmente e abrir `/app/history`.

Testes: `npm run test:lorelink`, `npm run test:lorelink:browser:players`, `npm run test:lorelink:browser` e `npm run test:lorelink:browser:reading`. Os testes de browser exigem primeiro `npm run dev:lorelink:isolated`, noutro terminal, e devem correr um de cada vez porque partilham a base isolada.

O servidor isolado usa o mesmo site na porta 5176, HTTP de teste na 9179 e PGlite em disco. Executa o SQL real das migrações e o helper de propriedade existente. Perfis, schema legado, autenticação/JWT e HTTP são fixtures: não é Supabase Auth/PostgREST remoto real. Não comunica com a base real; `/__test` só existe nesse servidor. Conta `player@example.test` / `test-only`: três personagens sintéticas, duas VEIL e uma ALTARA. Conta `gm@example.test` / `test-only`: fluxo legado.

Cobertura: texto e reload, ligações, posições, pesquisa/filtros/foco, retirar do mapa, falhas e repetições, revisões, arquivo, exportação, trocas de personagem/universo, mudança externa de autoridade, acessos diretos, jogadores/GM/terceiros/anónimo, privacidade de imagens e reversão recuperável. O browser verifica também ecrãs estreitos, posição da câmara e Markdown seguro.

As capturas do utilizador mostram histórias reais já criadas. A verificação automatizada desta atualização usa contas sintéticas no ambiente isolado, incluindo 13 bolhas e 15 relações, leitura longa, troca leitura/edição, erro de gravação, ligações por pontos superiores/inferiores e ecrã móvel. Não altera as histórias de pintice. Os testes isolados não provam a configuração completa da base real.

## Limites e preservação

Partilha pessoal, menções `@`, cronologia visual, colaboração, gestão de vários mapas e IA ficam para depois. Não há organização automática dos nós. O encaminhamento das linhas é visual e adapta-se às posições; não grava pontos de ligação nem altera entidades/relações. Mapas muito densos ainda podem ter cruzamentos; foco, pesquisa e zoom ajudam a explorar. Conflitos conservam o rascunho e exigem comparação; não há fusão automática. Fechar à força o browser pode perder texto não guardado/exportado. A recuperação administrativa de personagens apagadas e limpeza de imagens órfãs não têm interface.

A entrega inclui backups e reversão de ficheiros com hashes. A reversão da adaptação para jogadores é separada da reversão integral; nenhuma executa SQL ou modifica o Git. O lint dos ficheiros tocados passa; o lint global contém problemas anteriores e a build mantém avisos de bundles grandes.

Este commit conserva a implementação de VEIL Search já existente no branch de base. As alterações locais anteriores de permissões/compatibilidade do Search e o respetivo teste são trabalho separado e não fazem parte da entrega da História.

As migrações são aplicadas manualmente pelo utilizador. Esta implementação não altera a app ALTARA nem utiliza o respetivo conector Supabase.
