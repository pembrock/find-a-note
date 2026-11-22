import { createPreviewServer } from './server.mjs';

const port = Number(process.env.PORT ?? 4173);
createPreviewServer().listen(port, '127.0.0.1', () => {
  console.log('http://127.0.0.1:' + port + '/find-a-note/');
});
