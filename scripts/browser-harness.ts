/** Local, synthetic SDK host for browser validation. Never reads real HOME
 * or CLI config, never sends a message/model request, and is not a release asset. */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialProvider } from '../src/service/auth/config.js';
import { ArgoClient } from '../src/service/argocd/client.js';
import { RefreshCoordinator } from '../src/service/auth/refresh.js';
import { createService } from '../src/service/runtime/server.js';
import { syntheticConfig } from '../tests/helpers.js';
import { rawApplication } from '../tests/application-fixtures.js';
import { rawPod, rawTree, rawEvent, deploymentRef, podRef } from '../tests/resource-fixtures.js';
import { deployment, rawComparison } from '../tests/manifest-fixtures.js';
import { rawAppSet, rawCluster, rawProject, rawRepository } from '../tests/management-fixtures.js';
import { logPacket, lastPacket } from '../tests/log-fixtures.js';
import { hostReady } from '../tests/host-fixtures.js';
import { english, chinese } from '../src/panel/locales.js';
import { translations } from '../src/shared/locales/generated.js';
import { overrides } from '../src/shared/locales/overrides.js';

let argoReads = 0; let rpcCalls = 0; let logReads = 0;
function demoTree() {
  const base = rawTree();
  const replicaSet = { ...deploymentRef, kind: 'ReplicaSet', name: 'demo-7f4b', uid: 'replica-a' };
  const healthy = { ...deploymentRef, name: 'healthy-service', uid: 'healthy-deploy' };
  return { nodes: [...base.nodes.map((node) => node.uid === podRef.uid ? { ...node, parentRefs: [replicaSet] } : node),
    { ...replicaSet, parentRefs: [deploymentRef], health: { status: 'Degraded' } }, { ...healthy, health: { status: 'Healthy' } },
    { ...podRef, name: 'healthy-service-pod', uid: 'healthy-pod', parentRefs: [healthy], health: { status: 'Healthy' } }],
    orphanedNodes: [{ group: '', version: 'v1', kind: 'ConfigMap', namespace: 'production', name: 'unowned-config', uid: 'orphan-config', health: { status: 'Unknown' } }] };
}
function demoApplication(index: number) {
  const app = rawApplication(index ? `demo-${String(index + 1).padStart(2, '0')}` : 'demo');
  app.spec.project = index % 2 ? 'services' : 'platform'; app.spec.destination.namespace = index % 2 ? 'staging' : 'production';
  if (index % 3) { app.status.sync.status = 'Synced'; app.status.health.status = 'Healthy'; app.status.conditions = []; }
  return app;
}
const upstream = createServer((req, res) => {
  argoReads++; const url = new URL(req.url!, 'http://localhost'); res.setHeader('content-type', 'application/json');
  if (req.method !== 'GET') { res.writeHead(405); res.end('{}'); return; }
  if (url.pathname.endsWith('/logs')) { logReads++; res.end(logPacket('synthetic log <img src=x>') + lastPacket); return; }
  let value: unknown;
  if (url.pathname === '/api/v1/applications') value = { items: Array.from({ length: 36 }, (_, index) => demoApplication(index)) };
  else if (/^\/api\/v1\/applications\/demo(?:-\d+)?$/.test(url.pathname)) value = demoApplication(url.pathname.endsWith('/demo') ? 0 : Number(url.pathname.split('-').at(-1)) - 1);
  else if (url.pathname.endsWith('/resource-tree')) value = demoTree();
  else if (url.pathname.endsWith('/resource')) value = { manifest: JSON.stringify(rawPod()) };
  else if (url.pathname.endsWith('/managed-resources')) value = { items: [rawComparison()] };
  else if (url.pathname.endsWith('/manifests')) value = { manifests: [JSON.stringify(deployment())] };
  else if (url.pathname.endsWith('/events')) value = { items: [rawEvent()] };
  else if (url.pathname.endsWith('/syncwindows')) value = { canSync: false, windows: [], activeWindows: [], assignedWindows: [] };
  else if (url.pathname === '/api/v1/projects') value = { items: [rawProject()] };
  else if (url.pathname === '/api/v1/projects/platform') value = rawProject();
  else if (url.pathname === '/api/v1/repositories') value = { items: [rawRepository()] };
  else if (url.pathname === '/api/v1/clusters') value = { items: [rawCluster()] };
  else if (url.pathname === '/api/v1/applicationsets') value = { items: [rawAppSet()] };
  else if (url.pathname === '/api/v1/applicationsets/set-a') value = rawAppSet();
  else if (url.pathname === '/api/version') value = { Version: 'v3.1.8' };
  else { res.statusCode = 404; value = {}; }
  res.end(JSON.stringify(value));
});
await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
const scratch = join(tmpdir(), 'opencode'); await mkdir(scratch, { recursive: true }); const directory = await mkdtemp(join(scratch, 'argocd-browser-'));
const configPath = join(directory, 'config'); await writeFile(configPath, JSON.stringify(syntheticConfig(`http://127.0.0.1:${(upstream.address() as AddressInfo).port}`)));
async function service() {
  const api = new ArgoClient(new CredentialProvider({ configPath }), new RefreshCoordinator(async () => { throw new Error('Synthetic host cannot run CLI.'); }), true);
  const current = createService({ token: 'synthetic-browser-host', client: async () => api });
  await new Promise<void>((resolve) => current.server.listen(0, '127.0.0.1', resolve)); return current;
}
let current = await service(); let closing = false;
async function shutdown() {
  if (closing) return; closing = true; server.close(); server.closeAllConnections(); await current.close();
  await new Promise<void>((resolve) => { upstream.close(() => resolve()); upstream.closeAllConnections(); }); await rm(directory, { recursive: true, force: true });
}
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic Argo Observer Harness</title><link rel="stylesheet" href="/panel/style.css"><style>#harness{padding:8px;font:12px system-ui;color:var(--oc-fg)}#root{max-width:1180px}#composer{box-sizing:border-box;width:100%;height:48px}#harness button{margin:4px}#mirror{font-size:11px;max-height:100px;overflow:auto;white-space:pre-wrap}</style><section id="harness"><strong>合成 SDK 宿主 · 非真实 OpenChamber / Argo</strong><button id="theme">切换主题</button><button id="restart">模拟 Service 重启</button><button id="session">切换聊天会话</button><button id="narrow">窄屏 360px</button><button id="wide">宽屏 1180px</button><p id="host-status">compose=0; model/send=0</p><textarea id="composer" aria-label="合成聊天输入框" placeholder="Only explicit compose confirmation writes here"></textarea></section><main id="root"></main><script>
const themes=${JSON.stringify([hostReady('light'), hostReady('dark')])};let context=themes[0],dark=false,composed=0,unsafe=0,last='none';const storage=new Map();
const frame=document.querySelector('#root');const envelope={channel:'openchamber.sdk',v:1};const send=m=>frame.contentWindow.postMessage({...envelope,...m},'*');
frame.addEventListener('load',()=>send({type:'ready',payload:context}));
window.addEventListener('message',async e=>{const m=e.data;if(e.source!==frame.contentWindow||!m)return;if(m.type==='harness-state'){document.querySelector('#mirror').textContent=m.text;return;}if(m.type==='harness-layout'){let out=document.querySelector('#layout-state');if(!out){out=document.createElement('p');out.id='layout-state';document.querySelector('#harness').append(out);}out.textContent=m.text;return;}if(m.channel!==envelope.channel)return;if(m.type==='hello'){send({type:'ready',payload:context});return;}if(!m.id||m.type==='result')return;
let payload;last=m.type;try{if(m.type==='service-request'){const r=await fetch('http://127.0.0.1:43187/rpc',{method:'POST',credentials:'omit',headers:{'content-type':'application/json'},body:JSON.stringify(m.payload)});payload=await r.json();last+=' HTTP '+r.status;}
else if(m.type==='storage'){const p=m.payload;if(p.op==='get')payload=storage.has(p.key)?{storage:true,op:'get',found:true,value:storage.get(p.key)}:{storage:true,op:'get',found:false};else if(p.op==='set'){storage.set(p.key,p.value);payload={storage:true,op:'set'};}else payload={storage:true,op:p.op,keys:[]};}
else if(m.type==='compose'){composed++;const box=document.querySelector('#composer');box.value+=(box.value?'\\n':'')+m.payload.text;}
else if(m.type==='clipboard-write'){}else if(m.type==='resize'){}else{unsafe++;throw Error('No other actions supported');}
send({type:'result',id:m.id,ok:true,...(payload?{payload}: {})});}catch(_){last+=' failed';send({type:'result',id:m.id,ok:false,error:'Synthetic host rejected action',code:'HOST_REJECTED'});}document.querySelector('#host-status').textContent='compose='+composed+'; model/send='+unsafe+'; last='+last;});
document.querySelector('#theme').onclick=()=>{dark=!dark;const old=context;context={...themes[dark?1:0],session:old.session,locale:old.locale};send({type:'ready',payload:context});};
document.querySelector('#session').onclick=()=>{context={...context,session:{id:'synthetic-chat-b',title:'Second synthetic chat',busy:false}};send({type:'session',payload:{session:context.session}});};
document.querySelector('#restart').onclick=async()=>{await fetch('http://127.0.0.1:43187/restart',{method:'POST',credentials:'omit'});document.querySelector('#host-status').textContent='Service restarted; next response must invalidate old UI';};
document.querySelector('#narrow').onclick=()=>{frame.style.width='360px';frame.style.maxWidth='360px';};document.querySelector('#wide').onclick=()=>{frame.style.width='1180px';frame.style.maxWidth='none';};
for(const [id,label] of [['contexts','测试：加载 contexts'],['applications','测试：查询应用'],['detail','测试：打开应用详情'],['summary','测试：摘要视图'],['diagnostic','测试：Diagnostic'],['apps-tab','测试：Applications'],['collapse','测试：收起列表'],['expand','测试：展开列表'],['resize','测试：调整宽度'],['filter','测试：筛选 Project'],['scroll','测试：滚动列表'],['layout','测试：布局数据'],['preview','测试：生成预览'],['confirm','测试：确认追加'],['theme-debug','测试：主题数据'],['language-en','Test: host English'],['language-zh-CN','Test: host Simplified Chinese'],['language-fr','Test: host French'],['language-zh-TW','Test: host Traditional Chinese'],['language-ar','Test: host Arabic'],['language-he','Test: host Hebrew'],['language-ja','Test: host Japanese'],['language-unknown','Test: host unknown language']]){const button=document.createElement('button');button.textContent=label;button.onclick=()=>{if(id.startsWith('language-')){context={...context,locale:id.slice(9)};send({type:'ready',payload:context});}else frame.contentWindow.postMessage({type:'harness-action',id},'*');};document.querySelector('#harness').append(button);}
for(const [id,label] of [['resources','Test: resources tab'],['resource-node','Test: select Pod'],['resource-events','Test: resource events'],['resource-logs','Test: resource logs'],['resource-manifest','Test: Live manifest'],['resource-layout','Test: resource geometry'],['resource-back','Test: resource back']]){const button=document.createElement('button');button.textContent=label;button.onclick=()=>frame.contentWindow.postMessage({type:'harness-action',id},'*');document.querySelector('#harness').append(button);}
</script><script defer src="/panel/main.js"></script></html>`;
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url!, 'http://127.0.0.1').pathname;
    res.setHeader('Cache-Control', 'no-store');
    // Synthetic-only harness: browser-panel previews may use a rewritten
    // document origin. No browser cookies/real credentials are accepted.
    res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'content-type'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (path === '/harness.js') { res.setHeader('content-type', 'application/javascript'); res.end(html.match(/<script>([\s\S]*?)<\/script>/)![1]); return; }
    if (path === '/panel/frame.html') { res.setHeader('content-type', 'text/html'); res.end((await readFile(new URL('../panel/index.html', import.meta.url), 'utf8')).replace('href="style.css"', `href="/panel/style.css?build=${Date.now()}"`).replace('</body>', '<script src="/frame-controls.js"></script></body>')); return; }
    if (path === '/frame-controls.js') { res.setHeader('content-type', 'application/javascript'); res.end(`
const root=document.querySelector('#root');const report=()=>parent.postMessage({type:'harness-state',text:root.innerText.slice(0,10000)},'*');new MutationObserver(report).observe(root,{childList:true,subtree:true});
function themeDebug(){const trigger=root.querySelector('.oc-sdk-trigger');const result={};if(!trigger)return result;result.token=getComputedStyle(trigger).getPropertyValue('--oc-elevated');result.rules=[];for(const sheet of document.styleSheets){try{for(const rule of sheet.cssRules){if(rule.selectorText&&trigger.matches(rule.selectorText)&&rule.style.backgroundColor)result.rules.push({selector:rule.selectorText,value:rule.style.backgroundColor})}}catch(_){}}return result;}
const catalogs=${JSON.stringify({ en: english, 'zh-CN': chinese, ...translations })},overrides=${JSON.stringify(overrides)};const translate=key=>overrides[document.documentElement.lang]?.[key]??catalogs[document.documentElement.lang]?.[key]??(document.documentElement.lang==='zh-CN'?key:catalogs.en[key]??key);
window.addEventListener('message',event=>{if(event.source!==parent||event.data?.type!=='harness-action')return;const labels={contexts:'加载 contexts',applications:'重新查询应用',summary:'Summary',diagnostic:'Diagnostic','apps-tab':'Applications',collapse:'收起应用列表',expand:'展开应用列表',preview:'生成脱敏摘要预览（不查询 Argo）',confirm:'确认：追加此预览到当前聊天输入框'};const id=event.data.id;
if(id==='resource-layout'){const columns=root.querySelector('.resource-columns'),sidebar=columns?.querySelector('.application-sidebar'),row=columns?.querySelector('[role="treeitem"]');parent.postMessage({type:'harness-layout',text:JSON.stringify({documentWidth:document.documentElement.scrollWidth,iframeWidth:innerWidth,resourceWidth:columns?.getBoundingClientRect().width,listWidth:sidebar?.getBoundingClientRect().width,rowHeight:row?.getBoundingClientRect().height,visibleNodes:columns?.querySelectorAll('[role="treeitem"]').length,detailOpen:columns?.dataset.detailOpen,resourceSelected:columns?.querySelector('[aria-selected="true"]')?.getAttribute('aria-label')})},'*');return;}
if(id==='resource-node'){root.querySelector('.resource-tree [data-kind="Pod"][data-namespace="team-a"]')?.click();report();return;}
if(id==='resource-events'||id==='resource-logs'||id==='resource-manifest'){const label=id==='resource-events'?'资源事件':id==='resource-logs'?'日志':'Manifest';[...root.querySelectorAll('.resource-columns [role="tab"]')].find(node=>node.textContent===translate(label))?.click();report();return;}
if(id==='resource-back'){[...root.querySelectorAll('.resource-columns button')].find(node=>node.textContent===translate('展开资源列表'))?.click();report();return;}
if(id==='resources'){[...root.querySelectorAll('button')].find(node=>node.textContent===translate('资源 / 事件 / 日志'))?.click();report();return;}
if(id==='layout'){const list=root.querySelector('.application-list-scroll'),sidebar=root.querySelector('.application-sidebar'),columns=root.querySelector('.application-columns'),trigger=root.querySelector('.oc-sdk-trigger'),styles=getComputedStyle(document.documentElement);parent.postMessage({type:'harness-layout',text:JSON.stringify({locale:document.documentElement.lang,direction:document.documentElement.dir,sidebarLeft:sidebar?.getBoundingClientRect().left,viewport:root.clientWidth,documentWidth:document.documentElement.scrollWidth,iframeWidth:innerWidth,sidebarWidth:sidebar?.getBoundingClientRect().width,listHeight:list?.clientHeight,listScrollHeight:list?.scrollHeight,listScrollTop:list?.scrollTop,listCollapsed:columns?.dataset.listCollapsed,detailOpen:columns?.dataset.detailOpen,statusCount:root.querySelector('.application-status-line')?.children.length,filterExpanded:root.querySelector('.application-filters')?.open,elevated:styles.getPropertyValue('--surface-elevated'),alias:styles.getPropertyValue('--oc-elevated'),triggerColor:trigger?getComputedStyle(trigger).color:'',triggerBackground:trigger?getComputedStyle(trigger).backgroundColor:''})},'*');return;}
if(id==='theme-debug'){parent.postMessage({type:'harness-layout',text:JSON.stringify(themeDebug())},'*');return;}
if(id==='resize'){root.querySelector('[role="separator"]')?.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));report();return;}
if(id==='scroll'){const list=root.querySelector('.application-list-scroll');if(list)list.scrollTop+=250;report();return;}
if(id==='filter'){const field=[...root.querySelectorAll('.oc-sdk-select')].find(node=>node.querySelector('.oc-sdk-field-label')?.textContent==='Project');field?.querySelector('button')?.click();[...document.querySelectorAll('.oc-sdk-popup [role="option"]')].find(node=>node.textContent==='platform')?.click();report();return;}
const button=id==='detail'?root.querySelector('[aria-label="'+translate('Argo CD 应用')+'"] [role="option"]'):[...root.querySelectorAll('button')].find(button=>button.textContent===translate(labels[id]));button?.click();report();});`); return; }
    if (path === '/shutdown' && req.method === 'POST') { res.end('stopping'); void shutdown(); return; }
    if (path === '/restart' && req.method === 'POST') { await current.close(); current = await service(); res.end('restarted'); return; }
    if (path === '/rpc' && req.method === 'POST') {
      rpcCalls++;
      let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 30000) throw new Error('Too large'); }
      const input = JSON.parse(body) as { method: string; path: string; query?: Record<string, string>; body?: string };
      if (!/^\/(?:v1\/[a-z-]+|health)$/.test(input.path) || !['GET', 'POST', 'DELETE'].includes(input.method)) throw new Error('Forbidden synthetic proxy path');
      const url = `http://127.0.0.1:${(current.server.address() as AddressInfo).port}${input.path}${input.query ? '?' + new URLSearchParams(input.query) : ''}`;
      const result = await fetch(url, { method: input.method, headers: { authorization: 'Bearer synthetic-browser-host', 'content-type': 'application/json' }, ...(input.body !== undefined ? { body: input.body } : {}) });
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status: result.status, body: await result.text() })); return;
    }
    if (path === '/stats') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ argoReads, rpcCalls, logReads })); return; }
    if (['/panel/main.js', '/panel/style.css', '/panel/argocd.svg'].includes(path)) { res.setHeader('content-type', path.endsWith('.js') ? 'application/javascript' : path.endsWith('.svg') ? 'image/svg+xml' : 'text/css'); res.end(await readFile(new URL('..' + path, import.meta.url))); return; }
    if (path === '/') { res.setHeader('content-type', 'text/html'); res.end(html.replace('<main id="root"></main>', '<pre id="mirror" aria-label="合成子框架可见状态"></pre><iframe id="root" title="合成 SDK 扩展框架" src="/panel/frame.html" style="display:block;width:100%;height:1100px;border:0"></iframe>').replace(/<script>[\s\S]*?<\/script>/, '<script src="http://127.0.0.1:43187/harness.js"></script>').replace('<script defer src="/panel/main.js"></script>', '')); return; }
    res.writeHead(404); res.end();
  } catch { res.writeHead(500); res.end('Synthetic harness request failed.'); }
});
await new Promise<void>((resolve) => server.listen(43187, '127.0.0.1', resolve));
process.once('SIGTERM', () => { void shutdown(); }); process.once('SIGINT', () => { void shutdown(); });
console.log('Synthetic browser harness: http://127.0.0.1:43187 (no real CLI or Argo access)');
