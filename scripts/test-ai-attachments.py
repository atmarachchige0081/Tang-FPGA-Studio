#!/usr/bin/env python3
"""Exercise AI file/image composition in real Chromium with a simulated provider.

Requires studio/node_modules, Python Playwright and /usr/bin/chromium.
No authentication, native job execution or hardware programming is performed.
Screenshots and the disposable source fixture are written under ignored build/.
"""
import asyncio,json,socket,subprocess,time,urllib.request
from pathlib import Path
from playwright.async_api import async_playwright
root=Path(__file__).resolve().parents[1];out=root/'build/ai-attachments';out.mkdir(parents=True,exist_ok=True)
source=out/'attachment-example.sv';source.write_text('module top(input logic clk, output logic led);\n  assign led = clk;\nendmodule\n')
with socket.socket() as listener:
 listener.bind(('127.0.0.1',0));port=listener.getsockname()[1]
url=f'http://127.0.0.1:{port}'
server=subprocess.Popen(['node','node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',str(port),'--strictPort'],cwd=root/'studio',stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
async def run():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--disable-dev-shm-usage'])
  page=await browser.new_page(viewport={'width':1440,'height':1000});errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto(url);await page.locator('.brand-mark').wait_for()
  await page.evaluate('''async()=>{const {bridge}=await import('/src/lib/bridge.ts');bridge.aiTurnStart=async(threadId,prompt,context)=>{window.attachmentRequest={threadId,prompt,context};const turnId='attachment-preview';setTimeout(()=>{for(const detail of [{method:'item/agentMessage/delta',params:{threadId,turnId,itemId:'answer',delta:'Attachments received by the browser test transport.'}},{method:'turn/completed',params:{threadId,turn:{id:turnId,status:'completed'}}}])window.dispatchEvent(new CustomEvent('fpga-ai-demo',{detail:{...detail,timestamp:new Date().toISOString()}}));},100);return {turn:{id:turnId,status:'inProgress'}};};}''')
  await page.keyboard.press('Control+Shift+A');await page.get_by_role('button',name='Connect agent',exact=True).click();await page.get_by_role('button',name='Sign in with ChatGPT',exact=True).click()
  await page.get_by_role('textbox',name='Ask AI about this project').wait_for()
  upload=page.get_by_label('Attach images or text files')
  await upload.set_input_files([str(root/'docs/images/studio-main-light.png'),str(source)])
  await page.get_by_role('button',name='Remove attachment attachment-example.sv').wait_for()
  assert await page.get_by_alt_text('Attachment: studio-main-light.png').evaluate('(img)=>img.complete && img.naturalWidth>0')
  await page.get_by_role('button',name='Remove attachment attachment-example.sv').click()
  await page.get_by_role('textbox',name='Ask AI about this project').evaluate('''e=>{const transfer=new DataTransfer();transfer.items.add(new File(['module top; endmodule'],'pasted.sv',{type:'text/plain'}));e.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));}''')
  await page.get_by_role('button',name='Remove attachment pasted.sv').wait_for()
  await upload.set_input_files({'name':'unsupported.pdf','mimeType':'application/pdf','buffer':b'%PDF-test'})
  await page.get_by_role('alert').filter(has_text='not supported').wait_for()
  assert await page.get_by_role('button',name='Remove attachment pasted.sv').count()==1
  await page.get_by_role('textbox',name='Ask AI about this project').fill('Explain this screenshot and attached source')
  for theme in ['light','dark']:
   await page.evaluate('''async theme=>{const {useWorkbench}=await import('/src/store/workbench.ts');useWorkbench.getState().setTheme(theme);}''',theme)
   await page.screenshot(path=str(out/f'composer-{theme}.png'))
  await page.set_viewport_size({'width':1000,'height':850})
  send=page.get_by_role('button',name='Send',exact=True)
  bounds=await send.bounding_box()
  assert bounds and bounds['y']+bounds['height']<=850,bounds
  await page.screenshot(path=str(out/'composer-narrow.png'))
  await page.set_viewport_size({'width':1440,'height':1000})
  await page.get_by_role('button',name='Send',exact=True).click();await page.wait_for_function('window.attachmentRequest !== undefined')
  details=await page.evaluate('window.attachmentRequest.context.attachments.map(a=>({name:a.name,kind:a.kind,data:a.dataUrl?.startsWith("data:image/png;base64,")??a.text.includes("module top")}))')
  assert details==[{'name':'studio-main-light.png','kind':'image','data':True},{'name':'pasted.sv','kind':'text','data':True}],details
  await page.get_by_label('Sent attachments').wait_for();assert await page.get_by_label('Files to send').count()==0
  await page.screenshot(path=str(out/'sent-attachments.png'))
  assert not errors,errors
  print(json.dumps({'passed':True,'scope':'Real AI panel, chooser/paste, removal, validation, preview and captured transport; simulated provider, no authenticated model inference or native execution','attachments':details,'screenshots':str(out)}))
  await browser.close()
try:
 for _ in range(100):
  try:urllib.request.urlopen(url,timeout=1);break
  except Exception:time.sleep(.2)
 asyncio.run(run())
finally:server.terminate();server.wait(timeout=10)
