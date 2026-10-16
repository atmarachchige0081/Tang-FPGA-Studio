#!/usr/bin/env python3
"""Exercise a packaged Tauri/WebKit app through WebDriver and real native IPC.

Run under xvfb-run -a dbus-run-session. Requires tauri-driver, WebKitWebDriver,
PowerShell 7, scrot and the pinned OSS CAD Suite. Does not program physical hardware.
"""
import argparse
import base64
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
    parser.add_argument('--ai-fixture', action='store_true', help='Exercise native AI protocol with scripts/fixtures/codex on PATH; never use a real provider')
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
        # Isolate application data without hiding the caller's installed tools.
        # fpga.ps1 otherwise discovers them through XDG_DATA_HOME, which changes below.
        data_home = Path(env.get('XDG_DATA_HOME') or Path.home() / '.local/share')
        env.setdefault('OSS_CAD_SUITE_ROOT', str(data_home / 'tang-fpga-studio/toolchains/2026-07-26/oss-cad-suite'))
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

                def screenshot(name):
                    # The viewport capture needs no window manager or X focus.
                    encoded = request('GET', prefix + '/screenshot')
                    (output / name).write_bytes(base64.b64decode(encoded, validate=True))

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
                assert js("return !document.querySelector('.release-dialog')"), 'Release notes opened automatically'
                passed('Startup has no automatic release-notes dialog')
                passed('Packaged React UI rendered inside native WebKit; no Vite server', {'url': document_url})
                snapshot = invoke('workspace_snapshot')
                root = snapshot['root']
                assert root.startswith(temporary), root
                assert Path(root, 'fpga.ps1').is_file()
                passed('Installed resources seeded a writable per-user workspace', root)
                recognized = invoke('recognize_project_folder', {'folder': str(Path(root, 'projects/03_uart_terminal'))})
                assert len(recognized) == 1 and 'fpga.config.psd1' in recognized[0]['identification']
                js("window.dispatchEvent(new Event('fpga-studio:open-project'))")
                for _ in range(100):
                    if js("return !!document.querySelector('#project-folder')"):
                        break
                    time.sleep(.1)
                element = request('POST', prefix + '/element', {'using': 'css selector', 'value': '#project-folder'})['element-6066-11e4-a52e-4f735466cecf']
                request('POST', prefix + '/element/' + element + '/value', {'text': str(Path(root, 'projects/03_uart_terminal'))})
                js("Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Find projects').click()")
                for _ in range(100):
                    if js("return !!document.querySelector('.recognized-project')"):
                        break
                    time.sleep(.1)
                assert js("return !!document.querySelector('.recognized-project')"), 'Selected folder was not recognized in the UI'
                js("Array.from(document.querySelectorAll('.open-project-dialog button')).find(b => b.textContent.trim() === 'Open project').click()")
                for _ in range(100):
                    if js("return !document.querySelector('.open-project-dialog')"):
                        break
                    time.sleep(.1)
                assert js("return !document.querySelector('.open-project-dialog')"), 'Recognized project did not open'
                assert invoke('workspace_snapshot')['projectPath'].endswith('03_uart_terminal')
                passed('Native folder recognition and existing-project dialog opened a real configured project')
                if args.ai_fixture:
                    status = invoke('ai_connect', {'root': root, 'project': 'projects/03_uart_terminal'})
                    assert status['version'].startswith('codex-fixture'), 'Refusing to test against a real AI provider'
                    assert invoke('ai_connect', {'root': root, 'project': 'projects/03_uart_terminal'})['connected']
                    passed('Native provider reconnect is idempotent without locking the registry (local fixture)')
                    answer = invoke('ai_inline_completion', {'project': 'projects/03_uart_terminal', 'path': 'projects/03_uart_terminal/rtl/top.sv', 'prefix': 'module top; ', 'suffix': ' endmodule'})
                    assert answer == 'assign led = counter[23];', answer
                    assert invoke('ai_account_read', {'refresh': False})['fixtureToolRefused'] is True
                    passed('Native isolated inline stream returned code while refusing fixture hardware tool access')
                    final_only = invoke('ai_inline_completion', {'project':'projects/03_uart_terminal','path':'projects/03_uart_terminal/rtl/top.sv','prefix':'// FINAL_ONLY_FIXTURE','suffix':''})
                    assert final_only == 'assign led = counter[23];', final_only
                    passed('Native inline completion accepted a final message without delta notifications')
                    thread = invoke('ai_thread_start', {'model': None})['thread']['id']
                    turn = invoke('ai_turn_start', {'threadId': thread, 'prompt': 'fixture only', 'context': {}, 'model': None, 'effort': None})['turn']['id']
                    assert invoke('ai_turn_steer', {'threadId': thread, 'turnId': turn, 'prompt': 'Use Dock pins'})['turnId'] == turn
                    passed('Native steering used the expected running turn (local fixture)')
                    assert any(event.get('requestId') == 222 for event in invoke('ai_pending_requests'))
                    invoke('ai_respond_approval', {'requestId': 222, 'decision': 'allowOnce', 'dirtyPaths': []})
                    assert invoke('ai_account_read', {'refresh': False})['fixtureCommandApproved'] is True
                    passed('Native command approval completed through the App Server protocol without executing a command (local fixture)')
                    invoke('ai_disconnect')
                assert len(invoke('list_boards', {'root': root})) >= 7
                assert len(invoke('list_hdl_patterns', {'root': root})) >= 50
                assert all(p['valid'] for p in invoke('list_plugins', {'root': root}))
                passed('Bundled boards, HDL patterns and plugins loaded')
                created = invoke('create_project', {'root': root, 'name': 'UART terminal', 'location': '', 'templateId': 'uart_terminal', 'displayName': 'UART terminal', 'boardId': 'tang_primer_20k'})
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
                invoke('poll_project_changes',parameters)
                def press(*values):
                    actions = [{'type': 'keyDown', 'value': key} for key in values] + [{'type': 'keyUp', 'value': key} for key in reversed(values)]
                    request('POST', prefix + '/actions', {'actions': [{'type': 'key', 'id': 'workbench-keyboard', 'actions': actions}]})
                def drag(selector, dx, dy):
                    rect = js("const r=document.querySelector(arguments[0]).getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}", [selector])
                    request('POST', prefix + '/actions', {'actions':[{'type':'pointer','id':'panel-mouse','parameters':{'pointerType':'mouse'},'actions':[{'type':'pointerMove','duration':0,**rect},{'type':'pointerDown','button':0},{'type':'pointerMove','duration':300,'x':rect['x']+dx,'y':rect['y']+dy},{'type':'pointerUp','button':0}]}]})
                # General product screenshots, before test commands or file edits.
                screenshot('native-overview-dark.png')
                press('\ue009','\ue008','l')
                time.sleep(.3)
                screenshot('native-overview-light.png')
                press('\ue009','\ue008','l')
                old_height = js("return document.querySelector('.bottom-dock').getBoundingClientRect().height")
                drag('.resize-bottom',0,-90)
                new_height = js("return document.querySelector('.bottom-dock').getBoundingClientRect().height")
                assert new_height > old_height + 60, (old_height,new_height)
                old_width = js("return document.querySelector('.sidebar').getBoundingClientRect().width")
                drag('.resize-sidebar',60,0)
                assert js("return document.querySelector('.sidebar').getBoundingClientRect().width") > old_width+30
                passed('Real pointer drags resized the bottom dock and Explorer; layout dimensions persisted')
                press('\ue009','\ue008','a')  # Ctrl+Shift+A
                for _ in range(80):
                    if js("return !!document.querySelector('.ai-panel')"): break
                    time.sleep(.1)
                before_assistant = js("return document.querySelector('.ai-panel').getBoundingClientRect().width")
                drag('.resize-assistant',-70,0)
                after_assistant = js("return document.querySelector('.ai-panel').getBoundingClientRect().width")
                assert after_assistant > before_assistant+25, (before_assistant,after_assistant)
                assert js("return JSON.parse(localStorage.getItem('fpga-studio.layout')).assistant") >= 430
                screenshot('native-resized-panels.png')
                js("document.querySelector('[aria-label=\"Close AI Assistant\"]').click()")
                passed('Assistant pointer resizing preserved usable controls and saved its width')
                js("Array.from(document.querySelectorAll('.dock-tabs button')).find(b => b.textContent === 'Terminal').click()")
                for _ in range(100):
                    if js("return document.querySelector('.terminal-toolbar > span')?.textContent === 'Shell'"):
                        break
                    time.sleep(.1)
                assert js("return document.querySelector('.terminal-toolbar > span')?.textContent === 'Shell'"), 'Native PTY did not open'
                def shell_type(text):
                    js("document.querySelector('.terminal-host .xterm-helper-textarea').focus()")
                    element = request('POST',prefix+'/element',{'using':'css selector','value':'.terminal-host .xterm-helper-textarea'})
                    element_id = element['element-6066-11e4-a52e-4f735466cecf']
                    request('POST',prefix+'/element/'+element_id+'/value',{'text':text})
                    press('\ue007')
                shell_type("printf 'PTY_%s\\n' 'LIVE_OK'")
                terminal_state = None
                for _ in range(100):
                    terminal_state = invoke('terminal_open',{**parameters,'cols':80,'rows':12})
                    if 'PTY_LIVE_OK' in terminal_state['data']: break
                    time.sleep(.1)
                assert terminal_state and 'PTY_LIVE_OK' in terminal_state['data'], 'Typed terminal command did not reach the shell'
                passed('Native xterm keyboard input executed a real Bash command through the PTY')
                shell_type("sleep 10")
                time.sleep(.3)
                js("Array.from(document.querySelectorAll('.terminal-toolbar button')).find(b => b.textContent.includes('Interrupt')).click()")
                shell_type("printf 'INT_%s\\n' 'OK'")
                interrupted = False
                for _ in range(50):
                    if 'INT_OK' in invoke('terminal_open',{**parameters,'cols':80,'rows':12})['data']:
                        interrupted = True; break
                    time.sleep(.1)
                assert interrupted, 'Interrupt did not return control to the shell'
                passed('Terminal interrupt stopped a running child command and subsequent input still worked')
                # A shell edit has no Codex file-change notification. The closed assistant must not prevent refresh.
                shell_type("printf '\\n// EXTERNAL_%s\\n' 'SYNC_OK' >> rtl/top.sv")
                js("Array.from(document.querySelectorAll('.dock-tabs button')).find(b => b.textContent === 'Output').click()")
                for _ in range(80):
                    if js("return document.querySelector('.external-update-label')?.textContent === 'Updated from disk'"): break
                    time.sleep(.1)
                assert js("return document.querySelector('.external-update-label')?.textContent === 'Updated from disk'"), 'External shell edit did not update the clean editor'
                assert 'EXTERNAL_SYNC_OK' in invoke('read_text_file',{'root':root,'path':path})
                js("document.querySelector('.monaco-editor textarea').focus()")
                press('\ue009','\ue010')
                for _ in range(80):
                    if js("return document.querySelector('.view-lines')?.textContent.replaceAll(String.fromCharCode(160),' ').includes('EXTERNAL_SYNC_OK') ?? false"): break
                    time.sleep(.1)
                assert js("return document.querySelector('.view-lines')?.textContent.replaceAll(String.fromCharCode(160),' ').includes('EXTERNAL_SYNC_OK') ?? false"), 'Disk edit was not visible in Monaco'
                passed('Shell edits became visible in Monaco while the AI panel was closed')
                # Provider-independent journal must cover an existing unopened file and a new file.
                journal = invoke('poll_project_changes',parameters)
                change = next(item for item in journal['changes'] if item['path']==path)
                assert 'EXTERNAL_SYNC_OK' not in change['before'] and 'EXTERNAL_SYNC_OK' in change['after']
                assert change['hunks'] and change['hunks'][0]['newStart'] > 0
                js("Array.from(document.querySelectorAll('.dock-tabs button')).find(b => b.textContent === 'Terminal').click()")
                for _ in range(80):
                    if js("return document.querySelector('.terminal-toolbar > span')?.textContent === 'Shell'"): break
                    time.sleep(.1)
                shell_type("printf '\\n// UNOPENED_%s\\n' 'EDIT' >> rtl/uart_tx.sv")
                shell_type("printf 'module native_review_new; endmodule\\n' > rtl/native_review_new.sv")
                for _ in range(80):
                    pending = invoke('poll_project_changes',parameters)['changes']
                    if any(item['path'].endswith('native_review_new.sv') for item in pending): break
                    time.sleep(.1)
                assert any(item['path'].endswith('uart_tx.sv') and 'UNOPENED_EDIT' in item['after'] for item in pending)
                assert any(item['path'].endswith('native_review_new.sv') and item['kind']=='added' for item in pending)
                js("Array.from(document.querySelectorAll('.dock-tabs button')).find(b => b.textContent === 'Output').click()")
                for _ in range(80):
                    if js("return !!document.querySelector('.review-file-button')"): break
                    time.sleep(.1)
                assert js("return !!document.querySelector('.review-file-button')"), 'Changed source had no visible review action'
                js("document.querySelector('.review-file-button').click()")
                for _ in range(120):
                    if js("return !!document.querySelector('.change-review .monaco-diff-editor')"): break
                    time.sleep(.1)
                assert js("return !!document.querySelector('.change-review .monaco-diff-editor')"), 'Native before/after diff did not render'
                for _ in range(80):
                    if js("return document.querySelector('.change-review').textContent.replaceAll(String.fromCharCode(160),' ').includes('EXTERNAL_SYNC_OK')"): break
                    time.sleep(.1)
                assert js("return document.querySelector('.change-review').textContent.replaceAll(String.fromCharCode(160),' ').includes('EXTERNAL_SYNC_OK')"), 'Changed lines were not visible in the diff'
                for _ in range(80):
                    if js("return document.querySelector('.change-review nav').textContent.includes('native_review_new.sv')"): break
                    time.sleep(.1)
                assert js("return document.querySelector('.change-review nav').textContent.includes('native_review_new.sv')")
                for _ in range(80):
                    if js("return !!document.querySelector('.change-review .line-insert')"): break
                    time.sleep(.1)
                assert js("return !!document.querySelector('.change-review .line-insert')"), 'Native diff did not highlight inserted lines'
                screenshot('native-file-diff-dark.png')
                press('\ue009','\ue008','l')
                time.sleep(.3)
                screenshot('native-file-diff-light.png')
                press('\ue009','\ue008','l')
                disk_before_review = invoke('read_text_file',{'root':root,'path':path})
                js("Array.from(document.querySelectorAll('.change-review footer button')).find(b => b.textContent.includes('Mark file reviewed')).click()")
                for _ in range(80):
                    pending=invoke('poll_project_changes',parameters)['changes']
                    if not any(item['path']==path for item in pending): break
                    time.sleep(.1)
                assert not any(item['path']==path for item in pending), 'Review acknowledgement did not clear the displayed file'
                assert invoke('read_text_file',{'root':root,'path':path}) == disk_before_review, 'Review modified the source file'
                js("document.querySelector('[aria-label=\"Close change review\"]').click()")
                js("document.querySelector('.monaco-editor textarea').focus()")
                press('\ue009','\ue010')
                passed('Native file journal tracked unopened and added files; before/after review rendered in both themes without source writes')
                # Preserve unsaved user input while a subsequent external edit lands.
                press('\ue007')
                press('x')
                disk = invoke('read_text_file',{'root':root,'path':path})
                invoke('write_text_file',{'root':root,'path':path,'content':disk+'\n// conflict fixture\n'})
                for _ in range(80):
                    if js("return document.querySelector('.external-file-notice')?.textContent.includes('unsaved edits') ?? false"): break
                    time.sleep(.1)
                assert js("return document.querySelector('.external-file-notice')?.textContent.includes('unsaved edits') ?? false"), 'Unsaved edit conflict was not preserved'
                assert js("return Array.from(document.querySelectorAll('.editor-tabs button')).some(b => b.querySelector('.dirty-dot'))")
                screenshot('native-live-edit-conflict.png')
                js("Array.from(document.querySelectorAll('.external-file-notice button')).find(b => b.textContent === 'Load disk version').click()")
                passed('Concurrent external edits preserved the dirty buffer and offered explicit conflict resolution')
                js("Array.from(document.querySelectorAll('.dock-tabs button')).find(b => b.textContent === 'Terminal').click()")
                for _ in range(80):
                    if js("return document.querySelector('.terminal-toolbar > span')?.textContent === 'Shell'"): break
                    time.sleep(.1)
                assert invoke('terminal_open',{**parameters,'cols':80,'rows':12})['id'] == terminal_state['id'], 'Switching tabs restarted the shell'
                screenshot('native-terminal.png')
                invoke('terminal_close',{'id':terminal_state['id']})
                js("Array.from(document.querySelectorAll('.dock-tabs button')).find(b => b.textContent === 'Output').click()")
                passed('Terminal remount retained the same session without replaying commands')
                assert js("return document.querySelector('.inline-toggle')?.getAttribute('aria-pressed') === 'false'"), 'Inline suggestions must be opt-in'
                if args.ai_fixture:
                    js("document.querySelector('.inline-toggle').click()")
                    for _ in range(30):
                        if js("return document.querySelector('.inline-toggle')?.getAttribute('aria-pressed') === 'true'"):
                            break
                        time.sleep(.1)
                    assert js("return document.querySelector('.inline-toggle')?.getAttribute('aria-pressed') === 'true'")
                    passed('Inline AI control is opt-in and usable beside the native Monaco editor; no authenticated generation asserted')
                else:
                    passed('Inline AI control stays off; no real provider or account is invoked')
                if args.ai_fixture:
                    status = invoke('ai_connect', parameters)
                    assert status['version'].startswith('codex-fixture')
                    def press(*values):
                        actions = [{'type': 'keyDown', 'value': key} for key in values] + [{'type': 'keyUp', 'value': key} for key in reversed(values)]
                        request('POST', prefix + '/actions', {'actions': [{'type': 'key', 'id': 'fixture-keyboard', 'actions': actions}]})
                    js("document.querySelector('.monaco-editor textarea').focus()")
                    press('\ue009', '\ue010')  # Ctrl+End
                    press('\ue007')  # Enter
                    press('\ue00a', '\\')  # Alt+Backslash: request ghost text
                    for _ in range(150):
                        if js("return document.querySelector('.monaco-editor .view-lines')?.textContent.replaceAll(String.fromCharCode(160), ' ').includes('assign led = counter[23];') ?? false"):
                            break
                        time.sleep(.2)
                    assert js("return document.querySelector('.monaco-editor .view-lines')?.textContent.replaceAll(String.fromCharCode(160), ' ').includes('assign led = counter[23];') ?? false"), 'Native inline ghost text did not render'
                    screenshot('native-inline-ghost-fixture.png')
                    before = invoke('read_text_file', {'root': root, 'path': path})
                    assert 'assign led = counter[23];' not in before, 'Fixture code must not be saved before acceptance'
                    press('\ue004')  # Tab accepts the suggestion
                    press('\ue009', 's')  # Explicitly save the accepted editor buffer
                    accepted = False
                    for _ in range(100):
                        accepted = 'assign led = counter[23];' in invoke('read_text_file', {'root': root, 'path': path})
                        if accepted:
                            break
                        time.sleep(.1)
                    assert accepted, 'Tab did not insert the suggestion into the editor buffer'
                    assert js("return !Array.from(document.querySelectorAll('.runtime-notice')).some(node => node.textContent.includes('Canceled'))"), 'Normal editor cancellation was shown as an application error'
                    passed('Native Monaco displayed fixture ghost text; Tab accepted it and only explicit Save persisted it')
                    invoke('ai_disconnect')
                assert not js("return Array.from(document.querySelectorAll('.runtime-notice')).some(node => node.textContent.includes('TextModel got disposed'))"), 'Diff review disposal raised a runtime error'
                screenshot('native-desktop.png')
                passed('Native desktop screenshot captured')
                js("Array.from(document.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === 'Open hardware manager')?.click()")
                for _ in range(100):
                    if js('return document.body.innerText.includes("Linux USB and serial access")'):
                        break
                    time.sleep(.1)
                assert js('return document.body.innerText.includes("Linux USB and serial access")')
                screenshot('native-linux-hardware.png')
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
