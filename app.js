import { createServer } from './src/app.js';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 58235);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error('PORT non valida');
}
createServer().listen(port, host, () => {
  console.log('Andrew in ascolto su http://' + host + ':' + port);
  if (host !== '127.0.0.1' && host !== '::1') {
    console.warn('ATTENZIONE: esposto sulla rete. Utilizzare HTTPS tramite reverse proxy.');
  }
});
