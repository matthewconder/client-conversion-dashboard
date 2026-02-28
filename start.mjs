import { createServer } from 'vite';

const server = await createServer({
  root: '/Users/matthew_conder/Claude Projects/core-shift-dashboard',
  configFile: '/Users/matthew_conder/Claude Projects/core-shift-dashboard/vite.config.js',
  server: { host: true, port: 5173 }
});
await server.listen();
server.printUrls();
