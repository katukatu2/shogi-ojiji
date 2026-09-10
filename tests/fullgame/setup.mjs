import { createStaticServer } from '../../scripts/serve-static.mjs';

export default async function setup() {
  // 同じプロセスで管理し、Windowsの外部コマンドによる子プロセス停止に依存しない。
  const server = createStaticServer({ isolated: true });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(5182, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  return () => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}
