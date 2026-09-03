// Beginner guide: Checks that l oc al m od el p ic ke r.t es t behavior stays correct as the project changes.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const os = require('node:os');

// The local-model picker is pure UI orchestration, so it is exercised against a
// minimal `vscode` stub. This covers the failure the rewrite was for -- a picker
// that never appears, or appears and then strands its promise.

const pickers = [];
const store = { localModelDirectory: '', localModelPath: '', ollamaBaseUrl: 'http://127.0.0.1:11434' };
let chosenFolder = os.tmpdir();

const vscodeStub = {
  QuickPickItemKind: { Separator: -1 },
  ProgressLocation: { Notification: 15, Window: 10 },
  ConfigurationTarget: { Global: 1 },
  Uri: { file: (fsPath) => ({ fsPath }) },
  window: {
    createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} }),
    createQuickPick: () => {
      const pick = {
        items: [], activeItems: [], selectedItems: [],
        busy: false, title: '', placeholder: '', ignoreFocusOut: false,
        shown: 0, disposed: false, _hide: [], _accept: [],
        onDidHide(fn) { pick._hide.push(fn); return { dispose() {} }; },
        onDidAccept(fn) { pick._accept.push(fn); return { dispose() {} }; },
        show() { pick.shown++; },
        hide() { pick._hide.forEach((fn) => fn()); },
        dispose() { pick.disposed = true; }
      };
      pickers.push(pick);
      return pick;
    },
    showOpenDialog: async () => [{ fsPath: chosenFolder }],
    showErrorMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showInformationMessage: async () => undefined,
    showQuickPick: async () => undefined,
    withProgress: async (_options, run) => run({ report() {} }, { onCancellationRequested() {} })
  },
  workspace: {
    isTrusted: true,
    getConfiguration: () => ({
      get: (key, fallback) => (store[key] === undefined ? fallback : store[key]),
      update: async (key, value) => { store[key] = value; }
    })
  },
  commands: { executeCommand: async () => undefined },
  env: { openExternal: async () => true }
};

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return request === 'vscode' ? 'vscode' : originalResolve.call(this, request, ...rest);
};
require.cache.vscode = { id: 'vscode', filename: 'vscode', loaded: true, exports: vscodeStub };

const { LlamaCppRuntime } = require('../build/runtime/llama/LlamaCppRuntime.js');

const settle = () => new Promise((resolve) => setTimeout(resolve, 250));

test('the picker is visible with its actions before any scanning starts', async () => {
  const runtime = new LlamaCppRuntime();
  const promise = runtime.chooseLocalModel();
  const pick = pickers.at(-1);

  assert.equal(pick.shown, 1, 'the picker must be shown synchronously, not after the scan');
  // Without this the picker vanishes the moment focus returns to the webview
  // that launched it, which is what made the button look dead.
  assert.equal(pick.ignoreFocusOut, true);
  assert.equal(pick.busy, true);
  assert.deepEqual(
    pick.items.map((item) => item.action),
    ['browseFile', 'chooseFolder', 'scanEverywhere'],
    'every action must already be selectable while detection is still running'
  );

  pick.hide();
  assert.equal(await promise, undefined);
  assert.equal(pick.disposed, true, 'hiding must dispose the picker');
});

test('a second request re-reveals the running picker instead of stacking another', async () => {
  const runtime = new LlamaCppRuntime();
  const first = runtime.chooseLocalModel();
  const opened = pickers.length;
  const second = runtime.chooseLocalModel();

  assert.equal(pickers.length, opened, 'a second click must not create a second picker');
  assert.equal(pickers.at(-1).shown, 2, 'it must re-reveal the existing one');

  pickers.at(-1).hide();
  assert.deepEqual(await Promise.all([first, second]), [undefined, undefined]);
});

test('choosing a model folder saves it and reopens the picker without deadlocking', async () => {
  const runtime = new LlamaCppRuntime();
  chosenFolder = os.tmpdir();
  store.localModelDirectory = '';

  const promise = runtime.chooseLocalModel();
  const outer = pickers.at(-1);
  const opened = pickers.length;

  outer.selectedItems = [outer.items.find((item) => item.action === 'chooseFolder')];
  outer._accept.forEach((fn) => fn());
  await settle();

  // Releasing the re-entrancy guard before running the sub-flow is what keeps
  // this from awaiting its own promise forever.
  assert.ok(pickers.length > opened, 'choosing a folder must reopen the picker');
  assert.equal(store.localModelDirectory, chosenFolder, 'the folder must be persisted as the default');

  pickers.at(-1).hide();
  const result = await Promise.race([promise, new Promise((_r, reject) => setTimeout(() => reject(new Error('deadlocked')), 5_000))]);
  assert.equal(result, undefined);
  assert.equal(outer.disposed, true, 'the outer picker must not be left undisposed');
});
