# IMTV webcam mobile

Aplicativo de câmera móvel para Android/iOS pelo navegador, com recepção no computador e saída para OBS/vMix.

**Comece pelo [LEIA-ME-PRIMEIRO.md](LEIA-ME-PRIMEIRO.md).** O pacote foi adaptado para **Vercel + Next.js + Turso/libSQL**. Configure o banco e as variáveis antes de usar o pareamento.

```sh
npm ci
npm run db:setup
npm run dev
```

Verificações:

```sh
npm test
npm run typecheck
npm run build
```

O aplicativo permanece sem login, com convites privados por sessão e mídia WebRTC direta. O adaptador de hospedagem foi separado da captura e da transmissão. A versão publicada anteriormente permanece no endereço original; este pacote não faz migração automática de sessões.
