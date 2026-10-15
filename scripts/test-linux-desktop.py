#!/usr/bin/env python3
"""Exercise a packaged Tauri/WebKit app through WebDriver and real native IPC.

Run under xvfb-run -a dbus-run-session. Requires tauri-driver, WebKitWebDriver,
PowerShell 7, scrot and the pinned OSS CAD Suite. Does not program physical hardware.
"""
import argparse
import http.client
import json
import os
from pathlib import Path
import socket
import signal
import shutil
import subprocess
import tempfile
import time
import urllib.request
import uuid


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('application')
    parser.add_argument('--output', default='build/linux-evidence')
    parser.add_argument('--ui-only', action='store_true', help='Check packaged UI/resources without repeating FPGA implementations')
    args = parser.parse_args()
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    checks = []
    port, native_port = free_port(), free_port()
    while native_port == port:
        native_port = free_port()
    base = f'http://127.0.0.1:{port}'

    def request(method, route, payload=None):
        data = None if payload is None else json.dumps(payload).encode()
        req = urllib.request.Request(base + route, data=data, method=method,
                                     headers={'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=600) as response:
                value = json.load(response)['value']
        except urllib.error.HTTPError as error:
            raise AssertionError(f'WebDriver {method} {route}: {error.code} {error.read().decode()}') from error
        if isinstance(value, dict) and 'error' in value:
            raise AssertionError(value)
        return value

    def passed(name, detail=None):
        checks.append({'check': name, 'status': 'passed', 'detail': detail})
        print(f'PASS: {name}', flush=True)
        (output / 'results.json').write_text(json.dumps(checks, indent=2))

    with tempfile.TemporaryDirectory(prefix='tang-linux-desktop-') as temporary:
        env = dict(os.environ)
        env.setdefault('LIBGL_ALWAYS_SOFTWARE', '1')
        env.setdefault('WEBKIT_DISABLE_DMABUF_RENDERER', '1')
        env.pop('FPGA_STUDIO_WORKSPACE', None)
        env['XDG_DATA_HOME'] = temporary + '/data'
        env['XDG_CONFIG_HOME'] = temporary + '/config'
        env['XDG_CACHE_HOME'] = temporary + '/cache'
        # Avoid changing HOME: a caller's explicit toolchain path remains usable.
        with (output / 'webdriver.log').open('w') as log:
            driver = subprocess.Popen(['tauri-driver', '--port', str(port), '--native-port', str(native_port)], env=env, stdout=log, stderr=log, start_new_session=True)
            session = None
            try:
                for _ in range(100):
                    try:
                        request('GET', '/status')
                        break
                    except OSError:
                        if driver.poll() is not None:
                            raise RuntimeError('tauri-driver exited; inspect webdriver.log')
                        time.sleep(.2)
                session = request('POST', '/session', {'capabilities': {'alwaysMatch': {'tauri:options': {'application': str(Path(args.application).resolve())}}}})['sessionId']
                prefix = f'/session/{session}'
                request('POST', prefix + '/timeouts', {'script': 600000, 'pageLoad': 60000})

                def js(script, arguments=None, asynchronous=False):
                    for attempt in range(3):
                        try:
                            return request('POST', prefix + ('/execute/async' if asynchronous else '/execute/sync'), {'script': script, 'args': arguments or []})
                        except (http.client.RemoteDisconnected, ConnectionResetError):
                            # Only retry side-effect-free reads.
                            if not script.startswith('return ') or attempt == 2:
                                raise
                            time.sleep(.2)

                def invoke(command, arguments=None):
                    # Browser-side token guard starts each native operation once.
                    call_id = uuid.uuid4().hex
                    for attempt in range(3):
                        try:
                            js('''if (window.__evidenceIPCId === arguments[2]) return;
                              window.__evidenceIPC = null;
                              window.__evidenceIPCId = arguments[2];
                              window.__TAURI_INTERNALS__.invoke(arguments[0], arguments[1]).then(
                                value => window.__evidenceIPC = {ok:true,value},
                                error => window.__evidenceIPC = {ok:false,error:String(error)});''', [command, arguments or {}, call_id])
                            break
                        except (http.client.RemoteDisconnected, ConnectionResetError):
                            # The browser-side token guard makes delivery retry
                            # safe: the native operation still starts exactly once.
                            if attempt == 2:
                                raise
                            time.sleep(.2)
                    deadline = time.monotonic() + 600
                    result = None
                    while time.monotonic() < deadline:
                        result = js('return window.__evidenceIPCId === arguments[0] ? window.__evidenceIPC : null', [call_id])
                        if result is not None:
                            break
                        time.sleep(.2)
                    assert result is not None, f'Native IPC timed out: {command}'
                    assert result['ok'], (command, result)
                    return result.get('value')

                for _ in range(100):
                    if js('return !!document.querySelector(".brand-mark") && !!window.__TAURI_INTERNALS__'):
                        break
                    time.sleep(.2)
                assert js('return document.body.innerText.includes("FPGA Studio")')
                document_url = js('return window.location.href')
                assert not document_url.startswith(('http://localhost:', 'http://127.0.0.1:')), document_url
                js("Array.from(document.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === 'Close release notes')?.click()")
                passed('Packaged React UI rendered inside native WebKit; no Vite server', {'url': document_url})
                snapshot = invoke('workspace_snapshot')
                root = snapshot['root']
                assert root.startswith(temporary), root
                assert Path(root, 'fpga.ps1').is_file()
                passed('Installed resources seeded a writable per-user workspace', root)
                assert len(invoke('list_boards', {'root': root})) >= 7
                assert len(invoke('list_hdl_patterns', {'root': root})) >= 50
                assert all(p['valid'] for p in invoke('list_plugins', {'root': root}))
                passed('Bundled boards, HDL patterns and plugins loaded')
                created = invoke('create_project', {'root': root, 'name': 'Linux evidence', 'location': '', 'templateId': 'uart_terminal', 'displayName': 'Linux evidence', 'boardId': 'tang_primer_20k'})
                project = created['projectPath']
                parameters = {'root': root, 'project': project}
                path = project + '/rtl/top.sv'
                original = invoke('read_text_file', {'root': root, 'path': path})
                modified = original + '\n// Native Linux save evidence\n'
                invoke('write_text_file', {'root': root, 'path': path, 'content': modified})
                assert invoke('read_text_file', {'root': root, 'path': path}) == modified
                index = invoke('read_hdl_index', parameters)
                assert index['modules']
                assert invoke('search_project_text', {**parameters, 'query': 'Native Linux save evidence'})
                assert invoke('read_git_status', parameters)['available']
                passed('Project creation with spaces, native save/read, HDL indexing, search and Git discovery')
                if not args.ui_only:
                    for action in ['lint', 'sim', 'build']:
                        result = invoke('run_fpga_command', {**parameters, 'action': action, 'jobId': 'linux-evidence-' + action})
                        assert result['success'], result
                        passed(f'Native IPC runner: {action}', {'exitCode': result['exitCode'], 'durationMs': result['durationMs']})
                    summary = invoke('read_build_summary', parameters)
                    assert summary['bitstreamBytes'] > 1024 and summary['timingMet'], summary
                    (output / 'build-summary.json').write_text(json.dumps(summary, indent=2))
                    shutil.copyfile(Path(root, project, 'build/timing.json'), output / 'timing.json')
                    shutil.copyfile(Path(root, project, 'build/top.fs'), output / 'top.fs')
                    passed('Measured bitstream and timing loaded into app reports', summary)
                    waveform = invoke('read_waveform', parameters)
                    assert waveform['signals']
                    netlist = invoke('read_netlist', parameters)
                    assert netlist['nodes'] and netlist['totalCells'] > 0
                    graph = invoke('read_design_graph', parameters)
                    assert graph['nodes'] and graph['timingPaths']
                    invoke('read_verification_summary', parameters)
                    invoke('read_optimization_summary', parameters)
                    passed('Waveform, netlist, traceability, verification and design-health native APIs')
                    analyzer = invoke('read_analyzer_workspace', parameters)
                    config = analyzer['config']
                    assert config['channels'], 'No synthesized probe available'
                    config['channels'] = config['channels'][:1]
                    config['sampleDepth'] = 64
                    config['preTriggerSamples'] = 32
                    config['trigger'] = {'combinator': 'and', 'clauses': [{'channelId': config['channels'][0]['id'], 'operation': 'compare', 'value': '0'}]}
                    invoke('save_analyzer_config', {**parameters, 'config': config})
                    assert invoke('prepare_analyzer', parameters)['generated']
                    result = invoke('run_fpga_command', {**parameters, 'action': 'analyzer-build', 'jobId': 'linux-evidence-analyzer'})
                    assert result['success'], result
                    assert Path(root, project, 'build/analyzer/top.fs').stat().st_size > 1024
                    shutil.copyfile(Path(root, project, 'build/analyzer/timing.json'), output / 'analyzer-timing.json')
                    shutil.copyfile(Path(root, project, 'build/analyzer/top.fs'), output / 'analyzer-top.fs')
                    passed('Native logic-analyzer configuration, generation and instrumented bitstream build (no upload)')
                    baseline = invoke('record_design_snapshot', {**parameters, 'kind': 'baseline', 'experimentId': None})
                    experiment = invoke('prepare_optimization_experiment', {**parameters, 'recommendationId': 'placement-seed'})
                    result = invoke('run_fpga_command', {**parameters, 'action': 'experiment', 'jobId': 'linux-evidence-experiment'})
                    assert result['success'], result
                    finished = invoke('finish_optimization_experiment', {**parameters, 'experimentId': experiment['id'], 'success': True})
                    assert finished['status'] == 'complete'
                    comparison = invoke('compare_design_snapshots', {**parameters, 'baselineId': baseline['id'], 'candidateId': finished['resultSnapshotId']})
                    assert comparison
                    (output / 'experiment-comparison.json').write_text(json.dumps(comparison, indent=2))
                    shutil.copyfile(Path(root, project, 'build/experiment/timing.json'), output / 'experiment-timing.json')
                    passed('Native optimization experiment, measured snapshots and comparison')
                    console = invoke('create_project', {'root': root, 'name': 'Console 60K evidence', 'location': '', 'templateId': 'console_led_button', 'displayName': 'Console 60K evidence', 'boardId': 'tang_console_60k'})
                    console_parameters = {'root': root, 'project': console['projectPath']}
                    for action in ['lint', 'sim']:
                        result = invoke('run_fpga_command', {**console_parameters, 'action': action, 'jobId': 'linux-console-' + action})
                        assert result['success'], result
                    # No proprietary EDA/license is supplied in CI; require a clear failure
                    # after verified synthesis and vendor-project generation.
                    result = invoke('run_fpga_command', {**console_parameters, 'action': 'build', 'jobId': 'linux-console-vendor'})
                    vendor = Path(root, console['projectPath'], 'build/gowin')
                    assert 'GW5AT-60B' in (vendor / 'studio.gprj').read_text()
                    assert (vendor / 'build.tcl').is_file()
                    if not os.environ.get('GOWIN_EDA_ROOT'):
                        assert not result['success'], result
                        passed('Console 60K lint, simulation, Yosys synthesis and Gowin project generation; vendor implementation requires Gowin EDA')
                    else:
                        assert result['success'], result
                        passed('Console 60K Linux Gowin EDA implementation')
                    assert isinstance(invoke('list_serial_devices'), list)
                    passed('Native serial enumeration (no physical UART asserted)')
                    provider = invoke('ai_provider_status')
                    passed('AI provider status API', {'state': provider.get('state')})
                # Re-open the generated project via IPC and refresh to show real evidence in UI.
                invoke('open_project', parameters)
                # Await a new document: the old Console project tree can remain
                # briefly visible while reload is queued by WebKit.
                previous_document = js('return performance.timeOrigin')
                try:
                    js('window.location.reload()')
                except (http.client.RemoteDisconnected, ConnectionResetError):
                    # Navigation may replace the WebKit document before its
                    # HTTP response returns. Verify the new document below;
                    # never infer successful navigation from lost transport.
                    pass
                reloaded = False
                for _ in range(150):
                    reloaded = js('return performance.timeOrigin !== arguments[0] && !!document.querySelector(".brand-mark")', [previous_document])
                    if reloaded:
                        break
                    time.sleep(.2)
                assert reloaded, 'Packaged UI did not reload into a new document'
                for _ in range(150):
                    opened = js("const file = Array.from(document.querySelectorAll('button.tree-row')).find(b => b.title === arguments[0]); if (file) file.click(); return !!file;", [path])
                    if opened:
                        break
                    time.sleep(.2)
                assert opened, 'Generated project source was not listed in Explorer'
                for _ in range(150):
                    if js("return document.querySelector('.monaco-editor .view-lines')?.textContent.includes('module') ?? false"):
                        break
                    time.sleep(.2)
                assert js("return document.querySelector('.monaco-editor .view-lines')?.textContent.includes('module') ?? false"), 'Packaged Monaco editor did not render source offline'
                passed('Packaged Monaco editor opened actual RTL source offline')
                subprocess.run(['scrot', '--overwrite', str(output / 'native-desktop.png')], check=True)
                passed('Native desktop screenshot captured')
                js("Array.from(document.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === 'Open hardware manager')?.click()")
                for _ in range(100):
                    if js('return document.body.innerText.includes("Linux USB and serial access")'):
                        break
                    time.sleep(.1)
                assert js('return document.body.innerText.includes("Linux USB and serial access")')
                subprocess.run(['scrot', '--overwrite', str(output / 'native-linux-hardware.png')], check=True)
                passed('Native Linux hardware guidance screenshot captured')
            except Exception:
                if session:
                    try:
                        (output / 'failure-dom.json').write_text(json.dumps(js('return {text:document.body.innerText, html:document.documentElement.outerHTML}'), indent=2))
                        subprocess.run(['scrot', '--overwrite', str(output / 'failure.png')], check=False)
                    except Exception:
                        pass
                raise
            finally:
                if session:
                    try:
                        request('DELETE', f'/session/{session}')
                    except Exception:
                        pass
                # Stop only this test's driver and desktop children before
                # deleting XDG data, including after a lost DELETE response.
                try:
                    os.killpg(driver.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    driver.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(driver.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    driver.wait()
    print(f'Native desktop evidence saved to {output}', flush=True)


if __name__ == '__main__':
    main()
