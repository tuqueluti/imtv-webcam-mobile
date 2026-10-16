# Validação da exportação Vercel — 16/10/2026

- `npm install`: instalação completa; lockfile aponta para registry.npmjs.org.
- `npm test`: 53 testes aprovados.
- `npm run typecheck`: aprovado.
- `npm run build`: Next.js 16.3.4 compilado com sucesso para produção.
- Adaptador libSQL testado com banco libSQL real em memória, incluindo criação, limites, offer/answer, candidatos JSON, permissões, exclusão e inicialização repetida.
- Captura, controlador de transmissão, ajuste de qualidade, interface, CSS, logo e fontes preservados da versão publicada. A adaptação concentra-se no acesso ao banco, nas rotas e na configuração da hospedagem; o cabeçalho de IP foi ajustado para Vercel.

Não foi realizado deploy na conta Vercel do usuário nem conexão com banco Turso remoto. Não houve câmera física nem teste visual em navegador nesta exportação. As credenciais e o provisionamento do banco ficam com o proprietário, seguindo LEIA-ME-PRIMEIRO.md.

Os testes de câmera/WebRTC simulam o motor de mídia; não medem qualidade, FPS ou latência em aparelhos reais. O usuário confirmou o funcionamento da versão de origem antes da exportação.
