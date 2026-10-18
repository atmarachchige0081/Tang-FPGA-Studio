"""Real Monaco completion regression after another editor/diff is disposed.

Requires Python Playwright, Chromium, Node and installed studio dependencies.
Run with --production to exercise an isolated production bundle, not the app's dist.
"""
import argparse
import asyncio
import json
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from playwright.async_api import async_playwright


async def exercise(url, output):
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(executable_path=shutil.which('chromium'), headless=True)
        try:
            for kind in ['editor', 'diff']:
                page = await browser.new_page(viewport={'width': 1100, 'height': 800})
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
                await page.goto(url)
                await page.wait_for_function('window.fixtureReady === true')
                try:
                    for cycle in range(10):
                        await page.evaluate('(kind) => window.cycle(kind)', kind)
                        await page.locator('.suggest-widget.visible .monaco-list-row').filter(has_text='ready_value').first.wait_for(timeout=10000)
                        if cycle == 9:
                            await page.screenshot(path=str(output / (kind + '.png')))
                        await page.keyboard.press('Tab')
                        assert await page.evaluate('window.editorValue()') == 'ready_value'
                        assert not errors, errors
                    print(f'PASS: {kind} disposal followed by working suggestions, 10 cycles', flush=True)
                except Exception:
                    print(json.dumps({'kind': kind, 'browserErrors': errors}), flush=True)
                    await page.screenshot(path=str(output / (kind + '-failure.png')))
                    raise
                finally:
                    await page.close()
        finally:
            await browser.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--production', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    studio = root / 'studio'
    output = root / 'build/monaco-lifecycle' / ('production' if args.production else 'development')
    output.mkdir(parents=True, exist_ok=True)
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    with tempfile.TemporaryDirectory(prefix='.monaco-regression-', dir=studio) as temporary:
        config = Path(temporary) / 'vite.config.mjs'
        config.write_text('export default ' + json.dumps({'root': str(studio), 'cacheDir': str(output / 'cache'), 'build': {
            'outDir': str(output / 'bundle'), 'emptyOutDir': True,
            'rolldownOptions': {'input': str(studio / 'tests/monaco-lifecycle.html')}}}))
        if args.production:
            subprocess.run(['node', 'node_modules/vite/bin/vite.js', 'build', '--config', str(config)], cwd=studio, check=True)
            command = [sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1', '--directory', str(output / 'bundle')]
        else:
            command = ['node', 'node_modules/vite/bin/vite.js', '--config', str(config), '--host', '127.0.0.1', '--port', str(port), '--strictPort', '--force']
        with (output / 'server.log').open('w') as log:
            server = subprocess.Popen(command, cwd=studio, stdout=log, stderr=log)
            try:
                url = f'http://127.0.0.1:{port}/tests/monaco-lifecycle.html'
                for _ in range(100):
                    if server.poll() is not None:
                        raise RuntimeError('Regression server exited; see ' + str(output / 'server.log'))
                    try:
                        urllib.request.urlopen(url, timeout=1).close()
                        break
                    except OSError:
                        time.sleep(.2)
                asyncio.run(exercise(url, output))
            finally:
                server.terminate()
                server.wait(timeout=10)


if __name__ == '__main__':
    main()
