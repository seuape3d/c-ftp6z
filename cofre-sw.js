'use strict';
const CFG = /*CFG*/{"v":1,"versao":"9f18230c04619222","sal":"pvuVGldX7E/QE/6xwE4DSA==","iter":600000,"manifesto":"f0b267c4cabe07ced3b71f84","pasta":"cofre/"}/*FIM*/;
const VISITAS = /*VISITAS*/"https://pedidos.seuape3d.workers.dev"/*FIM*/;
const CODIGO = /*CODIGO*/"c-ftp6z"/*FIM*/;
const ESCOPO = new URL(self.registration.scope);
const BASE = ESCOPO.pathname;
const BD = 'cofre:' + BASE;
const enc = new TextEncoder();
let CHAVE = null;
let MAN = null;
let obtendo = null;

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

function normalizar(s) {
  return String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
    .replace(/[\s_.,;:/\\|+\u2010-\u2015-]+/g, '-').replace(/^-+|-+$/g, '');
}
function deBase64(b) { const s = atob(b); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }

function bd() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(BD, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('k');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function bdLer() {
  const db = await bd();
  return new Promise((res) => {
    const g = db.transaction('k').objectStore('k').get('chave');
    g.onsuccess = () => { db.close(); res(g.result || null); };
    g.onerror = () => { db.close(); res(null); };
  });
}
async function bdGravar(v) {
  const db = await bd();
  return new Promise((res, rej) => {
    let tx;
    try { tx = db.transaction('k', 'readwrite'); tx.objectStore('k').put(v, 'chave'); } catch (e) { db.close(); rej(e); return; }
    tx.oncomplete = () => { db.close(); res(); };
    tx.onerror = tx.onabort = () => { db.close(); rej(tx.error); };
  });
}
async function bdApagar() {
  const db = await bd();
  return new Promise((res) => {
    const tx = db.transaction('k', 'readwrite'); tx.objectStore('k').delete('chave');
    tx.oncomplete = tx.onerror = tx.onabort = () => { db.close(); res(); };
  });
}

async function deRegistro(r) {
  if (!r || r.versao !== CFG.versao) return null;
  if (r.chave && typeof CryptoKey !== 'undefined' && r.chave instanceof CryptoKey) return { chave: r.chave, bits: null };
  if (r.bits) { const bits = new Uint8Array(r.bits); return { chave: await crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['decrypt']), bits }; }
  return null;
}
function nosso(c) { return c.url.startsWith(ESCOPO.href); }
async function pedirAsPaginas() {
  const cs = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter(nosso);
  if (!cs.length) return null;
  return new Promise((res) => {
    let falta = cs.length;
    const fim = setTimeout(() => res(null), 2000);
    for (const c of cs) {
      const ch = new MessageChannel();
      ch.port1.onmessage = (ev) => {
        const d = ev.data;
        if (d && d.versao === CFG.versao && (d.chave || d.bits)) { clearTimeout(fim); res(d); }
        else if (--falta === 0) { clearTimeout(fim); res(null); }
      };
      try { c.postMessage({ tipo: 'pedir' }, [ch.port2]); } catch (e) { if (--falta === 0) { clearTimeout(fim); res(null); } }
    }
  });
}
async function obterChave() {
  if (CHAVE) return CHAVE;
  if (!obtendo) {
    obtendo = (async () => {
      try {
        const r = await bdLer(), k = await deRegistro(r);
        if (k) return k;
        if (r) await bdApagar();
      } catch (e) { }
      try { const k = await deRegistro(await pedirAsPaginas()); if (k) return k; } catch (e) { }
      return null;
    })().then((k) => {
      if (k && !CHAVE) CHAVE = k;
      return CHAVE;
    }).finally(() => { obtendo = null; });
  }
  return obtendo;
}
function enviarChave(c) {
  if (!CHAVE || !c) return;
  try { c.postMessage({ tipo: 'chave', versao: CFG.versao, chave: CHAVE.chave }); return; } catch (e) { }
  if (CHAVE.bits) try { c.postMessage({ tipo: 'chave', versao: CFG.versao, bits: CHAVE.bits }); } catch (e) { }
}
async function esquecer() {
  CHAVE = null; MAN = null;
  try { await bdApagar(); } catch (e) { }
  const cs = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter(nosso);
  cs.forEach((c) => { try { c.postMessage({ tipo: 'esquecer' }); } catch (e) { } });
}

async function baixar(id, conferir) {
  let r;
  try { r = await fetch(BASE + CFG.pasta + id + '.bin', { credentials: 'same-origin', cache: conferir ? 'no-cache' : 'default' }); }
  catch (e) { const er = new Error('sem conexão'); er.rede = true; throw er; }
  if (!r.ok) { const er = new Error('HTTP ' + r.status); er.status = r.status; throw er; }
  return r.arrayBuffer();
}
function decifrar(k, id, buf) {
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(buf, 0, 12), additionalData: enc.encode('cofre1:' + id), tagLength: 128 },
    k.chave, new Uint8Array(buf, 12));
}
function manifesto(k) {
  if (MAN && MAN.k === k) return MAN.p;
  const p = baixar(CFG.manifesto, true).then((buf) => decifrar(k, CFG.manifesto, buf)).then((claro) => JSON.parse(new TextDecoder().decode(claro)));
  MAN = { k, p, em: Date.now() };
  p.catch(() => { if (MAN && MAN.p === p) MAN = null; });
  return p;
}

async function abrir(senha, lembrar) {
  const base = await crypto.subtle.importKey('raw', enc.encode(normalizar(senha)), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: deBase64(CFG.sal), iterations: CFG.iter }, base, 256));
  const k = { chave: await crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['decrypt']), bits };
  let m;
  try { m = await manifesto(k); }
  catch (e) {
    if (e.status) return { ok: false, erro: 'rede', status: e.status };
    if (e.rede) return { ok: false, erro: 'rede' };
    return { ok: false, erro: 'senha' };
  }
  CHAVE = k;
  if (lembrar) {
    try { await bdGravar({ versao: CFG.versao, chave: k.chave, quando: Date.now() }); }
    catch (e) { try { await bdGravar({ versao: CFG.versao, bits, quando: Date.now() }); } catch (e2) { } }
  } else {
    try { await bdApagar(); } catch (e) { }
  }
  return { ok: true, inicio: m.inicio };
}

self.addEventListener('message', (e) => {
  const d = e.data || {}, porta = e.ports && e.ports[0];
  const responder = (m) => { try { (porta || e.source).postMessage(m); } catch (er) { } };
  if (d.tipo === 'abrir') {
    e.waitUntil(abrir(d.senha, !!d.lembrar).then(responder, (er) => responder({ ok: false, erro: 'falha', detalhe: String(er && er.message) })));
  } else if (d.tipo === 'estado') {
    e.waitUntil(obterChave().then(async (k) => {
      if (!k) return responder({ ok: false });
      try { const m = await manifesto(k); responder({ ok: true, inicio: m.inicio }); } catch (er) { responder({ ok: false }); }
    }));
  } else if (d.tipo === 'quero') {
    if (CHAVE) enviarChave(e.source);
    else e.waitUntil(obterChave().then(() => enviarChave(e.source)));
  } else if (d.tipo === 'sair') {
    e.waitUntil(esquecer().then(() => responder({ ok: true })));
  }
});

const GUARDA = '<script data-cofre>(function(){try{var B=' + JSON.stringify(BASE) + ',V=' + JSON.stringify(VISITAS) + ',K=' + JSON.stringify(CODIGO) + ',s=navigator.serviceWorker;if(!s)return;var k=null;' +
  's.addEventListener("message",function(e){var d=e.data||{};if(d.tipo==="chave")k=d;' +
  'else if(d.tipo==="pedir"&&e.ports&&e.ports[0])e.ports[0].postMessage(k);else if(d.tipo==="esquecer")k=null;});' +
  'if(s.startMessages)s.startMessages();s.ready.then(function(r){var w=s.controller||r.active;if(w)w.postMessage({tipo:"quero"});});' +
  'var X=/\\.(zip|rar|7z|tar|gz|bin|dwg|dxf|skp|rvt|ifc|docx?|xlsx?|pptx?|odt|ods)$/i;' +
  'document.addEventListener("click",function(e){if(e.defaultPrevented||e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;' +
  'var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(!a)return;var u=new URL(a.href,location.href);' +
  'if(u.origin!==location.origin||u.pathname.indexOf(B)!==0||!s.controller)return;if(!a.hasAttribute("download")&&!X.test(u.pathname))return;' +
  'e.preventDefault();var n=a.getAttribute("download")||decodeURIComponent(u.pathname.split("/").pop())||"arquivo",h=document.documentElement;' +
  'a.setAttribute("aria-busy","true");h.style.cursor="progress";' +
  'fetch(u.href).then(function(r){if(!r.ok)throw r.status;return r.blob();}).then(function(b){var o=URL.createObjectURL(b),t=document.createElement("a");' +
  't.href=o;t.download=n;t.style.display="none";document.body.appendChild(t);t.click();t.remove();setTimeout(function(){URL.revokeObjectURL(o);},60000);' +
  'var C=K||B.split("/").filter(Boolean).pop()||"";if(V&&/\\.zip$/i.test(u.pathname)&&/^[a-z0-9][a-z0-9-]{2,39}$/.test(C))try{fetch(V+"/v/"+C+".gif?t=zip",{mode:"no-cors",keepalive:true,credentials:"omit",referrerPolicy:"no-referrer",cache:"no-store"}).catch(function(){});}catch(e){}})' +
  '.catch(function(){location.href=u.href;}).then(function(){a.removeAttribute("aria-busy");h.style.cursor="";});});' +
  '}catch(e){}})();</script>';
const GUARDA_BYTES = enc.encode(GUARDA);
function acharTag(b, nome) {
  const n = Math.min(b.length, 65536), alvo = '<' + nome;
  for (let i = 0; i < n - alvo.length; i++) {
    if (b[i] !== 60) continue;
    let ok = true;
    for (let j = 1; j < alvo.length; j++) { const c = b[i + j] | 0x20; if (c !== alvo.charCodeAt(j)) { ok = false; break; } }
    if (!ok) continue;
    const prox = b[i + alvo.length];
    if (prox !== 62 && prox !== 32 && prox !== 9 && prox !== 10 && prox !== 13) continue;
    for (let j = i + alvo.length; j < n; j++) if (b[j] === 62) return j + 1;
  }
  return -1;
}
function injetarGuarda(buf) {
  const b = new Uint8Array(buf);
  let p = acharTag(b, 'head');
  if (p < 0) p = acharTag(b, 'html');
  if (p < 0) p = acharTag(b, '!doctype');
  if (p < 0) p = 0;
  const out = new Uint8Array(b.length + GUARDA_BYTES.length);
  out.set(b.subarray(0, p), 0); out.set(GUARDA_BYTES, p); out.set(b.subarray(p), p + GUARDA_BYTES.length);
  return out;
}
async function faixa(k, ids, bloco, ini, fim) {
  const a = Math.floor(ini / bloco), z = Math.floor(fim / bloco);
  const partes = await Promise.all(ids.slice(a, z + 1).map(async (id) => new Uint8Array(await decifrar(k, id, await baixar(id)))));
  const out = new Uint8Array(fim - ini + 1);
  let pos = 0;
  partes.forEach((p, i) => {
    const base = (a + i) * bloco, de = Math.max(ini - base, 0), ate = Math.min(fim - base + 1, p.length);
    out.set(p.subarray(de, ate), pos); pos += ate - de;
  });
  return out;
}
function pagina(status, titulo, texto) {
  const h = '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + titulo + '</title><body style="font:17px/1.5 system-ui,sans-serif;background:#f6f3ee;color:#24211d;padding:40px 16px;max-width:560px;margin:auto">' +
    '<h1 style="font-size:26px">' + titulo + '</h1><p>' + texto + '</p><p><a href="' + BASE + '">Voltar ao início</a></p></body></html>';
  return new Response(h, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}
async function entregar(k, m, ent, req, status, injetar) {
  const [tipo, tam, ids] = ent;
  const h = new Headers({ 'content-type': tipo, 'accept-ranges': 'bytes' });
  const html = /^text\/html/.test(tipo);
  const pedido = !html && status === 200 ? req.headers.get('range') : null;
  if (pedido) {
    const r = /^bytes=(\d*)-(\d*)$/.exec(pedido.trim());
    if (r && (r[1] || r[2])) {
      let ini, fim;
      if (r[1] === '') { ini = Math.max(tam - Number(r[2]), 0); fim = tam - 1; }
      else { ini = Number(r[1]); fim = r[2] === '' ? tam - 1 : Math.min(Number(r[2]), tam - 1); }
      if (ini > fim || ini >= tam) return new Response(null, { status: 416, headers: { 'content-range': 'bytes */' + tam } });
      h.set('content-range', 'bytes ' + ini + '-' + fim + '/' + tam);
      h.set('content-length', String(fim - ini + 1));
      return new Response(req.method === 'HEAD' ? null : await faixa(k, ids, m.bloco, ini, fim), { status: 206, headers: h });
    }
  }
  if (req.method === 'HEAD') { h.set('content-length', String(tam)); return new Response(null, { status, headers: h }); }
  if (ids.length <= 1) {
    let corpo = ids.length ? await decifrar(k, ids[0], await baixar(ids[0])) : new ArrayBuffer(0);
    if (html && injetar) corpo = injetarGuarda(corpo);
    h.set('content-length', String(corpo.byteLength));
    return new Response(corpo, { status, headers: h });
  }
  h.set('content-length', String(tam));
  let i = 0, prox = baixar(ids[0]);
  const fluxo = new ReadableStream({
    async pull(ctrl) {
      try {
        const id = ids[i], buf = await prox;
        i++;
        prox = i < ids.length ? baixar(ids[i]) : null;
        if (prox) prox.catch(() => {});
        ctrl.enqueue(new Uint8Array(await decifrar(k, id, buf)));
        if (i >= ids.length) ctrl.close();
      } catch (e) { ctrl.error(e); }
    },
  });
  return new Response(fluxo, { status, headers: h });
}
function paraEntrada(url, rel) {
  return Response.redirect(BASE + '?volta=' + encodeURIComponent(url.pathname.slice(BASE.length) + url.search), 302);
}
async function servir(req, url, rel) {
  const nav = req.mode === 'navigate';
  const raiz = rel === '' || rel === 'index.html';
  if (nav && raiz && url.searchParams.has('sair')) { await esquecer(); return fetch(req); }
  const k = await obterChave();
  if (!k) {
    if (raiz) return fetch(req);
    if (nav) return paraEntrada(url, rel);
    return new Response('Entrega protegida: digite a senha na página de entrada.', { status: 401, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  if (nav && MAN && Date.now() - MAN.em > 60000) MAN = null;
  let m;
  try { m = await manifesto(k); }
  catch (e) {
    if (e.rede) return pagina(503, 'Sem conexão', 'Não consegui baixar o projeto agora. Confira a internet e recarregue a página.');
    await esquecer();
    if (e.status === 404) self.registration.update().catch(() => {});
    if (raiz) return fetch(req);
    if (nav) return paraEntrada(url, rel);
    return new Response(null, { status: 401 });
  }
  let cam = rel;
  if (cam === '' || cam.endsWith('/')) cam += 'index.html';
  const ent = m.arquivos[cam];
  try {
    if (ent) return await entregar(k, m, ent, req, 200, true);
    if (rel === '' && m.inicio) return Response.redirect(BASE + m.inicio.split('/').map(encodeURIComponent).join('/'), 302);
    if (!cam.endsWith('/index.html') && m.arquivos[cam + '/index.html']) return Response.redirect(url.pathname + '/' + url.search, 301);
    if (m.arquivos['404.html']) return await entregar(k, m, m.arquivos['404.html'], req, 404, true);
    return pagina(404, 'Página não encontrada', 'Este endereço não existe nesta entrega.');
  } catch (e) {
    if (e.rede) return pagina(503, 'Sem conexão', 'Não consegui baixar este arquivo agora. Confira a internet e recarregue a página.');
    if (e.status === 404) {
      await esquecer();
      self.registration.update().catch(() => {});
      if (nav) return paraEntrada(url, rel);
    }
    return new Response('Não foi possível abrir este arquivo (' + (e.status ? 'HTTP ' + e.status : e.name || 'erro') + ').', { status: 502, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' && req.method !== 'HEAD') return;
  const url = new URL(req.url);
  if (url.origin !== ESCOPO.origin || !url.pathname.startsWith(BASE)) return;
  let rel;
  try { rel = decodeURIComponent(url.pathname.slice(BASE.length)); } catch (er) { return; }
  if (rel === 'cofre-sw.js' || rel.startsWith(CFG.pasta)) return;
  e.respondWith(servir(req, url, rel.normalize('NFC')));
});
