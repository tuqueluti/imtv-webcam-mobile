// IMTV webcam mobile 2.0. Pages, invitations and API responses are never cached.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => new Response('<!doctype html><html lang="pt-BR"><meta name="viewport" content="width=device-width,initial-scale=1"><title>IMTV webcam mobile offline</title><body style="background:#000000;color:#f5f5f5;font:16px system-ui;padding:40px"><h1>Você está offline.</h1><p>Conecte-se à internet para abrir o IMTV webcam mobile e fazer o pareamento.</p><button onclick="location.reload()">Tentar novamente</button></body></html>', {headers:{'Content-Type':'text/html; charset=utf-8'}})));
  }
});
