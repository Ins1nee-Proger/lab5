const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const { once } = require('events');
const { program } = require('commander');
const superagent = require('superagent');
const { buffer } = require('stream/consumers');

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
const SOURCE_HEADER = 'X-Image-Source'; // значення: cache або http.cat

function send(res, status, text, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    ...extraHeaders,
  });
  res.end(text + '\n');
}

// Дозволяємо лише три цифри 100-599, тому ім'я файлу не може містити "../"
function parseCode(req) {
  const { pathname } = new URL(req.url, 'http://localhost');
  const match = /^\/([1-5]\d\d)$/.exec(pathname);
  return match ? match[1] : null;
}

function filePath(code) {
  return path.join(cacheDir, `${code}.jpg`);
}

// Спершу пишемо у тимчасовий файл, потім перейменовуємо
async function saveToCache(code, data) {
  const target = filePath(code);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

async function handleGet(code, res) {
  // 1. шукаємо в кеші
  try {
    const data = await fs.readFile(filePath(code));
    res.writeHead(200, { 'Content-Type': 'image/jpeg', [SOURCE_HEADER]: 'cache' });
    res.end(data);
    return;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err; // інша помилка диска піде в 500
  }

  // 2. у кеші немає, питаємо http.cat
  let data;
  try {
    const response = await superagent
      .get(`https://http.cat/${code}`)
      .buffer(true)
      .parse(superagent.parse.image);
    data = response.body;
  } catch (err) {
    send(res, 404, `Картинку для коду ${code} не знайдено`);
    return;
  }

  // 3. спершу зберігаємо в кеш, потім віддаємо
  await saveToCache(code, data);
  res.writeHead(200, { 'Content-Type': 'image/jpeg', [SOURCE_HEADER]: 'http.cat' });
  res.end(data);
}
async function handlePut(code, req, res) {
  // тіло запиту надходить потоком; buffer() збирає його цілком і повертає проміс
  const data = await buffer(req);
  if (data.length === 0) {
    send(res, 400, 'Тіло запиту порожнє: передайте картинку');
    return;
  }
  await saveToCache(code, data); // створює файл або замінює наявний
  send(res, 201, `Картинку для коду ${code} збережено`);
}

// Єдиний дозволений колбек: обробник запиту
const server = http.createServer(async (req, res) => {
  try {
    if (!['GET', 'PUT', 'DELETE'].includes(req.method)) {
      send(res, 405, 'Метод не підтримується', { Allow: 'GET, PUT, DELETE' });
      return;
    }

    const code = parseCode(req);
    if (!code) {
      send(res, 404, 'Невірний шлях: очікується /<код стану>, наприклад /404');
      return;
    }

    if (req.method === 'GET') {
      await handleGet(code, res);
    } else if (req.method === 'PUT') {
      await handlePut(code, req, res);
    } else {
      send(res, 405, 'Цей метод ще не реалізований', { Allow: 'GET, PUT' });
    }
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      send(res, 500, 'Внутрішня помилка сервера');
    } else {
      res.end();
    }
  }
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