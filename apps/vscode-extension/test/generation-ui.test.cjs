// Beginner guide: Checks that g en er at io n u i.t es t behavior stays correct as the project changes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('generation UI keeps playful progress, live deltas, and a working Stop control', () => {
  const provider = fs.readFileSync('src/core/ui/ChatViewProvider.ts', 'utf8');
  const webview = fs.readFileSync('media/main.js', 'utf8');
  const streaming = fs.readFileSync('src/core/utils/http.ts', 'utf8');

  assert.match(provider, /Wakey-wakey, lookin' 'round/);
  assert.match(provider, /onDelta: \(delta\) => events\.emit\(\{ type: 'ui\.delta'/);
  assert.match(webview, /streamText \+= message\.delta/);
  assert.match(webview, /buildActivityLog\(\)/);
  assert.match(webview, /vscode\.postMessage\(\{ type: 'stop' \}\)/);
  assert.match(webview, /els\.stop\.classList\.toggle\('hidden', !state\.busy\)/);
  assert.match(streaming, /VisibleModelTextStream/);
});

test('Deep Agents todos are mirrored and rendered while the extension is running', () => {
  const controller = fs.readFileSync('src/agent/runtime/AgentController.ts', 'utf8');
  const ui = fs.readFileSync('media/main.js', 'utf8');
  assert.match(controller, /event\.tool === 'write_todos'/);
  assert.match(controller, /syncDeepTodos\(event\.input, opts\.onTodosChanged\)/);
  assert.match(ui, /title\.textContent = 'Update Todos'/);
  assert.match(ui, /item\.status === 'in_progress'/);
});

test('sidebar keeps history in the header and exposes four compact modes', () => {
  const provider = fs.readFileSync('src/core/ui/ChatViewProvider.ts', 'utf8');
  const styles = fs.readFileSync('media/main.css', 'utf8');
  const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.match(provider, /header-actions/);
  assert.match(provider, /data-mode="lineSuggestion"/);
  assert.match(styles, /grid-template-columns:repeat\(4/);
  assert.equal(manifest.contributes.menus['view/title'], undefined);
});

test('the shared session is busy before extension state is posted', () => {
  const source = fs.readFileSync('src/core/ui/ChatViewProvider.ts', 'utf8');
  const start = source.indexOf('await this.session.run');
  const busyState = source.indexOf('await this.postState();', start);
  const progress = source.indexOf("events.emit({ type: 'ui.progress'", start);
  const controller = source.indexOf('return this.controller.run', start);

  assert.ok(start >= 0, 'expected the extension to start the shared session');
  assert.ok(busyState > start, 'expected busy state after AgentSession.run starts');
  assert.ok(progress > busyState, 'expected playful progress after publishing busy state');
  assert.ok(controller > progress, 'expected generation to start after the UI is ready');
});
