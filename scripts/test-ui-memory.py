#!/usr/bin/env python3
"""Measure retained frontend heap while repeatedly mounting AI and terminal panels.

Requires Python Playwright, Chromium and studio/node_modules. Uses Vite/demo
provider and PTY; this is not native Windows/WebView2 or real Codex RAM usage.
Explicit DevTools GC measures retained objects; it is not an app GC setting.
"""
import argparse, asyncio, json, socket, subprocess, time, urllib.request
from pathlib import Path
from playwright.async_api import async_playwright
parser=argparse.ArgumentParser()
parser.add_argument('--panel',choices=['both','ai','terminal'],default='both')
parser.add_argument('--cycles',type=int,default=40)
parser.add_argument('--production',action='store_true')
parser.add_argument('--direct',action='store_true',help='Toggle React state directly in development to isolate automation selector retention')
parser.add_argument('--assert-stable',action='store_true',help='Fail on retained node/listener growth in a direct-state lifecycle run')
OPTIONS=parser.parse_args()
if not 1 <= OPTIONS.cycles <= 200:parser.error("--cycles must be between 1 and 200")
ROOT=Path(__file__).resolve().parents[1]
OUTPUT=ROOT/'build/lifecycle-memory';OUTPUT.mkdir(parents=True,exist_ok=True)
with socket.socket() as listener:
 listener.bind(('127.0.0.1',0));PORT=listener.getsockname()[1]
URL=f'http://127.0.0.1:{PORT}'

async def run():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--disable-dev-shm-usage'])
  try:
   page=await browser.new_page(viewport={'width':1440,'height':1000});errors=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   await page.goto(URL);await page.locator('.brand-mark').wait_for()
   await page.keyboard.press('Control+Shift+A')
   await page.get_by_role('button',name='Connect agent',exact=True).click()
   await page.get_by_role('button',name='Sign in with ChatGPT',exact=True).click()
   await page.get_by_role('textbox',name='Ask AI about this project').wait_for()
   await page.get_by_role('button',name='Close AI Assistant',exact=True).click()
   if not OPTIONS.production:
    await page.evaluate('''async()=>{const {bridge}=await import('/src/lib/bridge.ts');bridge.terminalOpen=async()=>({id:'memory-terminal',sequence:1,data:'',exited:false});}''')
   cdp=await page.context.new_cdp_session(page)
   await cdp.send('Performance.enable')
   browser_cdp=await browser.new_browser_cdp_session()
   async def cycle():
    if OPTIONS.direct:
     if OPTIONS.production:raise ValueError('--direct uses development modules')
     await page.evaluate('''async panel=>{const {useWorkbench}=await import('/src/store/workbench.ts');const frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));if(panel!=='terminal'){useWorkbench.getState().setAiPanelOpen(true);await frame();useWorkbench.getState().setAiPanelOpen(false);await frame();}if(panel!=='ai'){useWorkbench.getState().setBottomPanel('terminal');await frame();useWorkbench.getState().setBottomPanel('output');await frame();}}''',OPTIONS.panel)
     return
    if OPTIONS.panel in ('both','ai'):
     await page.keyboard.press('Control+Shift+A')
     await page.get_by_role('textbox',name='Ask AI about this project').wait_for()
     await page.get_by_role('button',name='Close AI Assistant',exact=True).click()
    if OPTIONS.panel in ('both','terminal'):
     await page.locator('.dock-tabs button').filter(has_text='Terminal').click()
     await page.locator('.terminal-host .xterm-screen').wait_for()
     await page.locator('.dock-tabs button').filter(has_text='Output').click()
   async def sample(cycles):
    # Let disposal timers/animation frames finish before measuring retained nodes.
    await page.wait_for_timeout(300)
    await cdp.send('HeapProfiler.collectGarbage')
    await page.wait_for_timeout(100)
    await cdp.send('HeapProfiler.collectGarbage')
    metrics={x['name']:x['value'] for x in (await cdp.send('Performance.getMetrics'))['metrics']}
    dom=await cdp.send('Memory.getDOMCounters')
    processes=(await browser_cdp.send('SystemInfo.getProcessInfo'))['processInfo']
    pss=0
    for process in processes:
     try:
      for line in Path(f"/proc/{process['id']}/smaps_rollup").read_text().splitlines():
       if line.startswith('Pss:'):pss+=int(line.split()[1]);break
     except (OSError,ValueError):pass
    return {'cycles':cycles,'jsHeapUsedBytes':int(metrics['JSHeapUsedSize']),'documents':dom['documents'],'nodes':dom['nodes'],'listeners':dom['jsEventListeners'],'chromiumPssKiB':pss,'taskDurationSeconds':metrics.get('TaskDuration')}
   for _ in range(5):await cycle()
   samples=[await sample(0)]
   for start in range(0,OPTIONS.cycles,10):
    count=min(10,OPTIONS.cycles-start)
    for _ in range(count):await cycle()
    samples.append(await sample(start+count))
   assert not errors,errors
   report={'scope':('Production' if OPTIONS.production else 'Vite development')+' frontend in Chromium; demo provider and browser terminal only, forced GC between samples; excludes native Studio/Codex/WebView2 memory','panel':OPTIONS.panel,'directStateToggle':OPTIONS.direct,'samples':samples,'heapGrowthBytes':samples[-1]['jsHeapUsedBytes']-samples[0]['jsHeapUsedBytes'],'errors':errors}
   (OUTPUT/f'result-{OPTIONS.panel}-{"production" if OPTIONS.production else "development"}.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
   if OPTIONS.assert_stable:
    assert OPTIONS.direct,'Use --direct to avoid selector instrumentation retention'
    assert samples[-1]['listeners']-samples[0]['listeners']<=4,'Listeners retained across repeated mounts'
    assert samples[-1]['nodes']-samples[0]['nodes']<=20,'DOM nodes retained across repeated mounts'
  finally:await browser.close()

with (OUTPUT/'server.log').open('w') as log:
 server=subprocess.Popen(['node','node_modules/vite/bin/vite.js',*(['preview'] if OPTIONS.production else []),'--host','127.0.0.1','--port',str(PORT),'--strictPort'],cwd=ROOT/'studio',stdout=log,stderr=log)
 try:
  for _ in range(100):
   try:urllib.request.urlopen(URL,timeout=1).close();break
   except OSError:time.sleep(.2)
  else:raise RuntimeError('Vite did not become ready')
  asyncio.run(run())
 finally:server.terminate();server.wait(timeout=10)
