'use strict';

const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { existsSync, readFileSync, rmSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const port = 7177;
const debugPort = 9227;
const profile = path.join(root, '.browser-smoke-profile');
const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = chromeCandidates.find(existsSync);
if (!chromePath) throw new Error('Chrome/Edge не найден; установите CHROME_PATH');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check, message, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error('Таймаут: ' + message);
}

let server;
let chrome;
let ws;
(async () => {
  rmSync(profile, { recursive: true, force: true });
  const isWindows = process.platform === 'win32';
  const command = isWindows ? (process.env.ComSpec || 'cmd.exe') : 'npm';
  const args = isWindows
    ? ['/d', '/s', '/c', `npm run dev -- --host 127.0.0.1 --port ${port}`]
    : ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port)];
  server = spawn(command, args, { cwd: root, stdio: 'ignore' });
  await waitFor(async () => {
    try { return (await fetch(`http://127.0.0.1:${port}/`)).ok; } catch { return false; }
  }, 'локальный сервер');

  chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`, 'about:blank'
  ], { stdio: 'ignore' });
  await waitFor(async () => {
    try { return (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok; } catch { return false; }
  }, 'браузер');

  const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  const exceptions = [];
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
  };
  function cdp(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const response = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result.value;
  }

  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  await waitFor(() => evaluate('document.readyState === "complete" && typeof window.Anonymizer === "object"'), 'загрузка страницы', 30000);

  await evaluate('document.getElementById("btnTest").click(); document.getElementById("btnAnonymize").click()');
  await waitFor(() => evaluate('!document.getElementById("resultSection").classList.contains("hidden")'), 'результат тестового договора');
  const sample = await evaluate('({text:document.getElementById("cleanText").value,warn:document.getElementById("warnBox").textContent})');
  assert.ok(sample.text.includes('[ФИО-1]'));
  assert.ok(sample.text.includes('[ПАСПОРТ-РБ-1]'));
  assert.ok(sample.text.includes('2-1234/2025'));
  assert.ok(sample.warn.includes('Андреенко'));
  assert.ok(sample.warn.includes('Ковалёва'));

  async function runWithOnly(type, source) {
    const expression = `(()=>{const source=${JSON.stringify(source)};const input=document.getElementById('sourceText');input.value=source;input.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('chipsNone').click();document.querySelector('.chip[data-type="${type}"]').click();document.getElementById('btnAnonymize').click();return true})()`;
    await evaluate(expression);
    await delay(180);
    return evaluate('({text:document.getElementById("cleanText").value,badge:document.getElementById("matchCountBadge").textContent})');
  }

  const polis = await runWithOnly('polis', 'Полис ОСАГО серии ХХХ № 1234567890.');
  assert.equal(polis.badge, '1');
  assert.ok(polis.text.includes('[ПОЛИС-1]'));

  const doc = await runWithOnly('doc', 'Паспорт серия 45 06 № 123456. Водительское удостоверение 77 АА № 123456.');
  assert.equal(doc.badge, '1');
  assert.ok(doc.text.includes('45 06 № 123456'));
  assert.ok(doc.text.includes('[ДОКУМЕНТ-1]'));

  await evaluate(`(()=>{document.querySelector('[data-mode="reversible"]').click();document.getElementById('chipsDefault').click();const input=document.getElementById('sourceText');input.value='Гражданин Иванов Иван Иванович, ИНН 500100732259.';document.getElementById('btnAnonymize').click();window.__originalCreateObjectURL=URL.createObjectURL;URL.createObjectURL=function(blob){window.__mapBlob=blob;return window.__originalCreateObjectURL.call(URL,blob)};return true})()`);
  await delay(180);
  const restored = await evaluate(`(async()=>{document.getElementById('btnDownloadMap').click();const map=JSON.parse(await window.__mapBlob.text());const anonymized=document.getElementById('cleanText').value;return Anonymizer.restore(anonymized,map)})()`);
  assert.equal(restored, 'Гражданин Иванов Иван Иванович, ИНН 500100732259.');

  const uploadStatus = await evaluate(`(()=>{const file=new File(['Тестовый ИНН 7707083893'],'probe.txt',{type:'text/plain'});const transfer=new DataTransfer();transfer.items.add(file);document.getElementById('dropzone').dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));return document.getElementById('fileStatus').textContent})()`);
  assert.ok(uploadStatus.startsWith('Загрузка:'));
  await waitFor(() => evaluate('document.getElementById("sourceText").value.includes("7707083893")'), 'загрузка TXT');

  async function uploadFixture(name, mime) {
    const base64 = readFileSync(path.join(__dirname, 'fixtures', name)).toString('base64');
    await evaluate(`(()=>{document.getElementById('sourceText').value='';const bytes=Uint8Array.from(atob('${base64}'),c=>c.charCodeAt(0));const file=new File([bytes],'${name}',{type:'${mime}'});const transfer=new DataTransfer();transfer.items.add(file);document.getElementById('dropzone').dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));return true})()`);
    await waitFor(() => evaluate('document.getElementById("sourceText").value.includes("7707083893")'), 'загрузка ' + name, 30000);
  }
  await uploadFixture('probe.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  await uploadFixture('probe.pdf', 'application/pdf');

  await evaluate(`(()=>{window.__downloadBlob=null;const previous=URL.createObjectURL;URL.createObjectURL=function(blob){window.__downloadBlob=blob;return previous.call(URL,blob)};document.getElementById('btnDownloadTxt').click();return true})()`);
  await waitFor(() => evaluate('window.__downloadBlob != null'), 'скачивание TXT');
  const downloadedText = await evaluate('window.__downloadBlob.text()');
  assert.equal(downloadedText, await evaluate('document.getElementById("cleanText").value'));

  await evaluate('window.__downloadBlob=null;document.getElementById("btnDownloadDocx").click()');
  await waitFor(() => evaluate('window.__downloadBlob != null'), 'скачивание DOCX');
  const docxSignature = await evaluate('(async()=>{const bytes=new Uint8Array(await window.__downloadBlob.arrayBuffer());return String.fromCharCode(bytes[0],bytes[1])})()');
  assert.equal(docxSignature, 'PK');

  const siteLink = await evaluate('({href:document.querySelector(".site-link").getAttribute("href"),target:document.querySelector(".site-link").target,text:document.querySelector(".site-link").textContent.trim()})');
  assert.equal(siteLink.href, 'https://серко.рф/');
  assert.equal(siteLink.target, '_blank');
  assert.ok(siteLink.text.includes('serko.рф'));

  await evaluate('document.querySelector(\'.theme-btn[data-theme="dark"]\').click()');
  assert.equal(await evaluate('document.documentElement.dataset.theme'), 'dark');
  assert.deepEqual(exceptions, []);
  console.log('Browser smoke: 10 сценариев пройдено (договор, полис, документы, восстановление, TXT/DOCX/PDF, скачивание TXT/DOCX, тема).');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  function stopProcess(child) {
    if (!child || !child.pid) return;
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  }
  if (ws) ws.close();
  stopProcess(chrome);
  stopProcess(server);
  await delay(500);
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
