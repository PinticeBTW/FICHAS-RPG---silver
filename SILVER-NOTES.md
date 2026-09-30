# 07 — Notas do Silver

O menu do mestre inclui **07 — Notas**, depois do Caderno. Abre as notas existentes das páginas do antigo quadro, com pesquisa, criação de páginas, título editável, fixação e editor amplo no estilo terminal amarelo. **08 — Visão geral** substitui a entrada Quadro; consultar PLAYER-OVERVIEW.md.

Usa os campos GM_NOTE_PAGES e GM_NOTES existentes. Editar o texto preserva stickies e desenhos da página. O Caderno continua separado. Jogadores não recebem o novo menu e o parâmetro view=notes não lhes abre a vista do Silver.

Removidos painel, botão, agenda, temporizador e reprodução sonora dos lembretes. Dados antigos de GM_REMINDERS foram preservados, sem serem ativados ou alterados. Mensagens de envio de imagens, antes associadas ao painel dos lembretes, passam a aparecer diretamente no quadro.

## Verificação

- Build TypeScript/Vite e ESLint dos três componentes passaram.
- Navegador com contas fictícias: 08 só para mestre; acesso direto de jogador mantém a ficha.
- Nota existente editada, guardada e relida no quadro e após recarregar; sticky preservado.
- Lembrete antigo vencido permaneceu sem triggeredAt; sem painel ou botão Lembretes.
- Vista de notas verificada em desktop e 390 px, sem overflow horizontal.
- Testes usaram o servidor isolado 5188/9188; não alteraram dados reais. Realtime não implementado na fixture.

Backup: `D:/GHOST GRID/backups/before-silver-notes-20260929-235504`.
