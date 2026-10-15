"""Review production UI layout with a demo provider, not real authentication.

Requires Python Playwright and /usr/bin/chromium. First build studio/dist and
serve it locally on port 1420. Saves screenshots under build/agent-reliability/.
"""
import asyncio, json
from pathlib import Path
from playwright.async_api import async_playwright

async def main():
 async with async_playwright() as p:
  browser = await p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--disable-dev-shm-usage'])
  context = await browser.new_context(viewport={'width':1440,'height':1000}, device_scale_factor=1)
  await context.route('**/*', lambda route: route.continue_() if route.request.url.startswith('http://127.0.0.1:1420') else route.abort())
  page = await context.new_page()
  await page.goto('http://127.0.0.1:1420')
  await page.get_by_role('heading', name='Current project').wait_for()
  assert await page.locator('.release-dialog').count() == 0
  output=Path('build/agent-reliability/screenshots')
  output.mkdir(parents=True, exist_ok=True)
  await page.screenshot(path=str(output/'retro-welcome-dark.png'))
  await page.get_by_role('button',name='Toggle color theme',exact=True).click()
  await page.screenshot(path=str(output/'retro-welcome-light.png'))
  await page.get_by_role('button',name='Open project…',exact=True).click()
  await page.get_by_label('Project folder').fill('C:/FPGA/My UART Project')
  await page.get_by_role('button',name='Find projects',exact=True).click()
  await page.locator('.recognized-project').wait_for()
  await page.screenshot(path=str(output/'retro-open-project-layout.png'))
  await page.get_by_role('button',name='Close open project',exact=True).click()
  await page.set_viewport_size({'width':1280,'height':800})
  await page.get_by_role('button',name='Toggle color theme',exact=True).click()
  await page.keyboard.press('Control+Shift+A')
  await page.get_by_role('button',name='Connect agent',exact=True).click()
  await page.get_by_role('button',name='Sign in with ChatGPT',exact=True).click()
  await page.get_by_role('textbox',name='Ask AI about this project').wait_for()
  await page.evaluate('''window.dispatchEvent(new CustomEvent('fpga-ai-demo', {detail: {
   method:'item/commandExecution/requestApproval', requestId:44,
   params:{command:'yosys -p "read_verilog rtl/top.sv; synth_gowin -top top"\\n' + 'long diagnostic output\\n'.repeat(100), cwd:'C:/FPGA/My UART Project', reason:'Run synthesis for this project.'}, timestamp:new Date().toISOString()
  }}))''')
  allow=page.get_by_role('button',name='Allow once',exact=True)
  await allow.wait_for()
  bounds=await allow.bounding_box()
  assert bounds and bounds['y']+bounds['height'] <=800, bounds
  await page.screenshot(path=str(output/'retro-approval-layout-laptop.png'))
  await allow.click()
  await page.get_by_role('button',name='Allow once',exact=True).wait_for(state='detached')
  await page.get_by_role('button',name='Close AI Assistant',exact=True).click()
  await page.get_by_role('button',name='Edit source',exact=True).click()
  first=page.get_by_role('button',name='Open first HDL source',exact=True)
  if await first.count(): await first.click()
  await page.locator('.monaco-editor .view-lines').wait_for()
  await page.get_by_role('button',name='AI suggestions off',exact=True).click()
  await page.screenshot(path=str(output/'retro-editor-layout-laptop.png'))
  await browser.close()
  print(json.dumps({'status':'passed','scope':'Production frontend layout fixtures in Chromium; demo provider only, no real authentication or hardware','screenshots':[x.name for x in output.glob('*.png')],'approvalButtonBounds':bounds},indent=2))
asyncio.run(main())
