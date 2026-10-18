#!/usr/bin/env python3
"""Real React/xterm regression with simulated PTY I/O; no shell/hardware commands.

Requires Python Playwright and /usr/bin/chromium. Run after npm ci in studio.
"""
import asyncio
import json
from pathlib import Path
import socket
import subprocess
import time
import urllib.request

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'build/terminal-safety'
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
                window.testWorkbench = useWorkbench;
                window.shellCalls = []; window.shellWrites = []; window.shellCloses = [];
                bridge.onTerminalEvent = async () => () => {};
                bridge.terminalOpen = async () => ({id:'test-shell', sequence:1, data:'Terminal lifecycle check\\r\\n', exited:false});
                bridge.terminalResize = async (...args) => window.shellCalls.push(args);
                bridge.terminalWrite = async (_id, data) => window.shellWrites.push(data);
                bridge.terminalClose = async (id) => window.shellCloses.push(id);
                useWorkbench.getState().setBottomPanel('terminal');
            }""")
            await page.locator('.xterm-screen').wait_for()
            for cycle in range(25):
                await page.set_viewport_size({'width': 1100 + (cycle % 3) * 100, 'height': 700 + (cycle % 4) * 40})
                await page.evaluate("window.testWorkbench.getState().setBottomPanel('output')")
                await page.evaluate("window.testWorkbench.getState().setBottomPanel('terminal')")
            await page.locator('.terminal-toolbar').get_by_text('Shell', exact=True).wait_for()
            await page.locator('.xterm-helper-textarea').focus()
            await page.keyboard.type('probe')
            await page.wait_for_function("window.shellWrites.join('') === 'probe'")
            page.once('dialog', lambda dialog: dialog.dismiss())
            await page.get_by_role('button', name='Restart', exact=True).click()
            assert await page.evaluate('window.shellCloses.length') == 0, 'Cancel closed the shell'
            await page.wait_for_timeout(500)  # Allow pending viewport callbacks to execute.
            await page.screenshot(path=str(OUTPUT / 'terminal.png'))
            resizes = await page.evaluate('window.shellCalls.length')
            assert resizes > 0, 'No terminal resize calls executed'
            assert not errors, errors
            result = {'status': 'passed', 'cycles': 25, 'errors': errors, 'resizes': resizes,
                      'inputForwarded': True, 'restartCancelPreservedShell': True,
                      'scope': 'Real React/xterm with simulated PTY I/O; no native shell or hardware commands'}
            (OUTPUT / 'result.json').write_text(json.dumps(result, indent=2))
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
