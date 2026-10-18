#!/usr/bin/env python3
"""Real analyzer configuration and cold editor navigation regression.

Requires Python Playwright and /usr/bin/chromium; run after studio/npm ci.
Persistence is simulated. Never builds, uploads, flashes or captures hardware.
"""
import asyncio
import json
import re
from pathlib import Path
import socket
import subprocess
import time
import urllib.request

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'build/maintenance-twenty'
OUTPUT.mkdir(parents=True, exist_ok=True)
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
URL = f'http://127.0.0.1:{port}'


async def run():
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True)
        try:
            page = await browser.new_page(viewport={'width': 1440, 'height': 900})
            errors = []
            page.on('pageerror', lambda error: errors.append(error.stack))
            await page.goto(URL)
            await page.wait_for_function("document.querySelector('.brand-mark') !== null")
            await page.evaluate("""async () => {
                const {bridge} = await import('/src/lib/bridge.ts');
                const {useWorkbench} = await import('/src/store/workbench.ts');
                window.testWorkbench=useWorkbench;
                const base=await bridge.analyzerWorkspace('Browser preview','.');
                base.config={...base.config,channels:[{id:0,signal:'a',width:1,radix:'binary'},{id:1,signal:'b',width:1,radix:'binary'},{id:2,signal:'bus',width:8,radix:'hex'}],trigger:{combinator:'and',clauses:[{channelId:1,operation:'rising',value:'0'}]}};
                base.signals=base.config.channels.map(c=>({id:c.signal,name:c.signal,hierarchy:c.signal,width:c.width,kind:'wire',observable:true}));
                bridge.analyzerWorkspace=async()=>base;
                bridge.saveAnalyzerConfig=(_r,_p,config)=>new Promise(resolve=>{window.savedConfig=config;window.finishSave=()=>resolve({...base,config});});
                useWorkbench.getState().setView('analyzer');
            }""")
            await page.get_by_text('Observable hierarchy',exact=True).wait_for()
            await page.locator('.signal-list button').first.click()
            assert await page.locator('.trigger-row select').first.input_value()=='0'
            await page.get_by_role('button',name='Save probes',exact=True).click()
            await page.wait_for_function('window.savedConfig !== undefined')
            assert await page.evaluate('window.savedConfig.channels.find(c=>c.id===window.savedConfig.trigger.clauses[0].channelId).signal')=='b'
            assert await page.get_by_label('Clock port',exact=True).is_disabled()
            await page.get_by_label('Clock port',exact=True).scroll_into_view_if_needed()
            await page.screenshot(path=str(OUTPUT/'analyzer-saving.png'))
            await page.evaluate('window.finishSave()')
            await page.get_by_role('button',name='Save probes',exact=True).wait_for()
            assert await page.get_by_label('Clock port',exact=True).is_enabled()
            await page.screenshot(path=str(OUTPUT/'analyzer-config.png'))
            await page.evaluate("window.testWorkbench.getState().setView('traceability')")
            source = page.locator('.mapping-rows button:not([disabled])').first
            await source.wait_for()
            requested_line = int(re.search(r'line\s+(\d+)', await source.inner_text()).group(1))
            await source.click()
            await page.locator('.monaco-editor .view-lines').first.wait_for()
            await page.wait_for_function('(line) => window.testWorkbench.getState().editorCursor?.line === line && window.testWorkbench.getState().navigation === null', arg=requested_line, timeout=10000)
            await page.screenshot(path=str(OUTPUT/'traceability-source.png'))
            assert not errors,errors
            result={'status':'passed','browserErrors':errors,'sourceLineReached':requested_line,'scope':'Real analyzer/editor/source navigation; simulated configuration persistence only; no hardware or authenticated AI'}
            (OUTPUT/'result.json').write_text(json.dumps(result,indent=2))
            print(json.dumps(result))
        except Exception:
            await page.screenshot(path=str(OUTPUT / 'debug.png'))
            raise
        finally:
            await browser.close()


with (OUTPUT / 'server.log').open('w') as log:
    server = subprocess.Popen(['node', 'node_modules/vite/bin/vite.js', '--host', '127.0.0.1',
                               '--port', str(port), '--strictPort'], cwd=ROOT / 'studio', stdout=log, stderr=log)
    try:
        for _ in range(100):
            if server.poll() is not None:
                raise RuntimeError('Vite exited')
            try:
                urllib.request.urlopen(URL, timeout=1).close()
                break
            except OSError:
                time.sleep(.2)
        else:
            raise RuntimeError('Vite did not become ready')
        asyncio.run(run())
    finally:
        server.terminate()
        server.wait(timeout=10)
