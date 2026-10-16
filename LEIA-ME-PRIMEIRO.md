# IMTV webcam mobile — pacote para Vercel

Este ZIP contém o aplicativo completo com identidade IMTV, fundo preto e fonte Mont incorporada. A versão exportada usa **Next.js + Turso/libSQL**; não depende de ChatGPT, Sites ou Cloudflare Workers.

**Importante:** só enviar o código à Vercel não configura o banco. Faça as etapas abaixo para o QR Code conectar celular e computador. O banco armazena apenas o pareamento; vídeo e áudio continuam diretos entre os aparelhos.

## 1. Extraia e prepare o banco

1. Extraia o ZIP e entre na pasta que contém `package.json`.
2. Instale o Node.js **24 LTS** no computador.
3. Crie um banco **libSQL** no Turso (`https://turso.tech`). Obtenha a URL `libsql://...` e um token de autenticação. Este adaptador é para libSQL; não escolha outro motor de banco.
4. Copie `.env.example` para `.env.local` e preencha:

```dotenv
TURSO_DATABASE_URL=libsql://SEU-BANCO.turso.io
TURSO_AUTH_TOKEN=SEU-TOKEN
```

5. Abra o terminal na pasta do projeto e execute:

```sh
npm ci
npm run db:setup
```

O segundo comando cria as tabelas e índices. Pode ser executado novamente sem apagar dados. Não envie `.env.local` para o GitHub. Não use o prefixo `NEXT_PUBLIC_` nessas variáveis.

## 2. Publique na Vercel pelo GitHub

1. Crie um repositório no GitHub e envie o conteúdo da pasta extraída. `package.json` deve ficar na raiz do repositório. Inclua também `.env.example` e `.gitignore`; não envie `node_modules`, `.next` ou `.env.local`.
2. Na Vercel, escolha **Add New → Project** e importe esse repositório.
3. Framework: **Next.js**. Node.js: **24.x**. Install Command: `npm ci`. Build Command: `npm run build:vercel`. Deixe **Output Directory** no padrão do Next.js, sem `dist`.
4. Em **Environment Variables**, configure `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN` para **Production**. Para testar Preview, use preferencialmente outro banco/token nesse ambiente.
5. Clique em **Deploy**. Se adicionou variáveis depois do primeiro deploy, faça **Redeploy**.
6. Use a URL HTTPS de **produção** no computador e no celular. Se a Vercel pedir login, confira **Deployment Protection** e permita acesso público à produção. O aplicativo não tem login próprio.

A Vercel importa o repositório, não este ZIP diretamente. Alternativamente, use a CLI abaixo.

## Alternativa: publicar pelo terminal

Com as dependências instaladas e o banco preparado:

```sh
npx vercel
npx vercel env add TURSO_DATABASE_URL production
npx vercel env add TURSO_AUTH_TOKEN production
npx vercel --prod
```

Siga os prompts da sua conta Vercel. Não coloque tokens em comandos que vão para o histórico; informe-os no prompt das variáveis.

## Conexão pelo Marketplace com prefixo IMTV

Se a Vercel informar que `TURSO_DATABASE_URL` já existe, use **IMTV** em Custom Prefix ao conectar o banco. O aplicativo e `db:setup` reconhecem os nomes gerados com esse prefixo, mantendo também compatibilidade com os nomes padrão.

Após conectar o banco no Marketplace, faça Redeploy. O build da Vercel prepara as tabelas automaticamente, sem apagar dados existentes.

A conexão IMTV tem prioridade sobre variáveis antigas preenchidas manualmente. URL e token devem vir da mesma conexão. Confira os nomes em Settings → Environment Variables; não compartilhe os valores de token.

## 3. Confira a transmissão

1. No computador: Receptor → Conectar meu celular.
2. No celular: leia o **novo QR Code da Vercel**, permita câmera/microfone e inicie em Equilibrado.
3. Use a mesma rede Wi-Fi e mantenha o app aberto. Convites do endereço antigo não são transferidos.
4. Confira imagem, FPS, áudio e Saída limpa. Depois teste a Fonte de navegador do OBS ou Desktop Capture no vMix.

O navegador fornece o acesso à câmera. O banco e a Vercel não recebem os frames. A internet é necessária para carregar o app e parear, mas a mídia conectada trafega pela rede local. Não há driver USB, APK/IPA, TURN ou transmissão entre redes diferentes nesta edição.

## Testar no computador antes de publicar

Com `.env.local` preenchido:

```sh
npm run dev
```

Abra `http://localhost:3000` no computador. Para acessar a câmera pelo celular, publique em HTTPS; um IP local em HTTP pode bloquear permissões de câmera.

Para testes totalmente locais de banco, você pode usar `TURSO_DATABASE_URL=file:local.db`, sem token. Execute `npm run db:setup` novamente. **Não use banco em arquivo na Vercel:** as funções não compartilham um disco persistente.

## Se algo falhar

- **QR não aparece / pareamento indisponível:** confirme as duas variáveis, execute `npm run db:setup` e faça Redeploy.
- **Erro ao criar tabelas:** confira URL/token e se o banco é libSQL.
- **Build com falha:** confira Node 24.x, Next.js e a pasta raiz que contém `package.json`.
- **Celular pede login da Vercel:** use a URL de produção e revise Deployment Protection.
- **Conecta, mas não chega vídeo:** confira mesma rede, VPN, firewall e isolamento de clientes.
- **Câmera indisponível:** abra em HTTPS no Safari/iPhone ou Chrome/Android e permita acesso.
- **Fonte antiga no app instalado:** feche e reabra; se necessário, atualize a página.

## O que está no pacote

- `app/`: interface, estilos e endpoints Next.js.
- `lib/`: captura, transmissão, qualidade, sinalização e adaptador libSQL.
- `public/`: logo IMTV, fontes Mont, ícone e PWA.
- `db/schema.sql`: instalação do banco novo.
- `scripts/setup-db.mjs`: preparação do banco.
- `tests/`: testes de câmera, conexão, segurança e adaptador de banco.
- `package-lock.json`: versões fixadas para `npm ci`.
- `vercel.json`, `.env.example` e configurações Next.js/TypeScript.

Não inclui conta Turso/Vercel, tokens, banco de produção, dados de usuários ou sessões ativas. O endereço atual não foi modificado. Verifique os limites e custos dos planos escolhidos conforme o uso; o pareamento faz consultas periódicas enquanto a sessão está aberta.

Os arquivos Mont e a logo são os fornecidos pelo proprietário do projeto. As permissões de uso desses materiais devem acompanhar o projeto quando ele for compartilhado com terceiros.

## Referências oficiais

- https://vercel.com/docs/frameworks/full-stack/nextjs
- https://vercel.com/docs/environment-variables
- https://vercel.com/docs/projects/deploy-from-cli
- https://docs.turso.tech/sdk/ts/reference
