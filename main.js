const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const { once } = require('events');
const { program } = require('commander');

// -h за замовчуванням зайнятий під help, тому help переносимо на --help
program
  .helpOption('--help', 'показати довідку')
  .requiredOption('-h, --host <address>', 'адреса сервера')
  .requiredOption('-p, --port <number>', 'порт сервера')
  .requiredOption('-c, --cache <path>', 'шлях до теки кешу');

program.parse();
const options = program.opts();

const host = options.host;
const port = Number(options.port);
const cacheDir = path.resolve(options.cache);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Помилка: порт має бути цілим числом від 1 до 65535');
  process.exit(1);
}

// Єдиний дозволений колбек: обробник запиту
const server = http.createServer(async (req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(`Сервер працює: ${req.method} ${req.url}\n`);
});

async function start() {
  await fs.mkdir(cacheDir, { recursive: true });
  server.listen(port, host);
  await once(server, 'listening'); // замість колбека в listen()
  console.log(`Сервер: http://${host}:${port}, кеш: ${cacheDir}`);
}

start().catch((err) => {
  console.error('Не вдалося запустити сервер:', err.message);
  process.exit(1);
});