(() => {
  const LOCAL_CONFIG_KEY = 'vectra.local.config.v1';
  const state = {
    messages: [],
    attachments: [],
    busy: false,
    chatAbort: null,
    currentChatId: '',
    history: [],
    editingIndex: -1,
    provider: sessionStorage.getItem('vectra.provider') || 'openai',
    apiKey: sessionStorage.getItem('vectra.apiKey') || '',
    baseUrl: sessionStorage.getItem('vectra.baseUrl') || '',
    model: sessionStorage.getItem('vectra.model') || '',
    local: loadLocalConfig(),
    localStatus: { status: 'stopped', running: false, logs: [] },
    localBusy: false,
    detectedRuntimes: [],
    pendingDetectedModel: '',
    pendingDetectedBaseUrl: '',
    downloadDirectory: ''
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    messages: $('messages'), prompt: $('prompt'), send: $('send'), attach: $('attach'), fileInput: $('fileInput'), attachments: $('attachments'),
    model: $('model'), testConnection: $('testConnection'), localStatusPill: $('localStatusPill'),
    settings: $('settings'), dialog: $('settingsDialog'), settingsProvider: $('settingsProvider'), apiFields: $('apiFields'), localSettingsHint: $('localSettingsHint'),
    autoDetectFields: $('autoDetectFields'), detectedModelList: $('detectedModelList'), refreshDetectedModels: $('refreshDetectedModels'), addDetectedModelFolder: $('addDetectedModelFolder'),
    localRuntimeFields: $('localRuntimeFields'), downloadFields: $('downloadFields'),
    apiKey: $('apiKey'), saveSettings: $('saveSettings'), newChat: $('newChat'), dropZone: $('dropZone'),
    chatHistory: $('chatHistory'), refreshHistory: $('refreshHistory'),
    localDialogStatus: $('localDialogStatus'), localDialogStatusText: $('localDialogStatusText'), localDialogDetail: $('localDialogDetail'),
    localModelPath: $('localModelPath'), localMmprojPath: $('localMmprojPath'), localServerPath: $('localServerPath'), localPort: $('localPort'), localContext: $('localContext'),
    localGpuLayers: $('localGpuLayers'), localSplitMode: $('localSplitMode'), localTimeout: $('localTimeout'), localExtraArgs: $('localExtraArgs'), localCpuMoe: $('localCpuMoe'),
    localThreadProfile: $('localThreadProfile'), localThreads: $('localThreads'),
    localDevice: $('localDevice'), localGpuInfo: $('localGpuInfo'),
    localNoMmap: $('localNoMmap'), chooseLocalModel: $('chooseLocalModel'), chooseMmproj: $('chooseMmproj'), chooseLlamaServer: $('chooseLlamaServer'), startLocalModel: $('settingsTestConnection'),
    stopLocalModel: $('stopLocalModel'), localLogs: $('localLogs'), localModelSearch: $('localModelSearch'), searchLocalModels: $('searchLocalModels'), chooseModelFolder: $('chooseModelFolder'), localModelResults: $('localModelResults'),
    downloadModelHint: $('downloadModelHint'), downloadModelList: $('downloadModelList'),
    downloadModelSearch: $('downloadModelSearch'), searchDownloadModels: $('searchDownloadModels'), downloadModelProgress: $('downloadModelProgress'),
    stopDownloadModel: $('stopDownloadModel'), downloadDirectory: $('downloadDirectory'), chooseDownloadDirectory: $('chooseDownloadDirectory')
  };

  if (![...els.settingsProvider.options].some((option) => option.value === state.provider)) state.provider = 'openai';
  els.settingsProvider.value = state.provider;
  syncLocalFormFromState();
  syncModelSelect();
  updateProviderUi();
  refreshLocalStatus().catch(() => {});
  loadHistory().catch(() => {});
  if (state.provider === 'localAuto') loadModels().catch(() => {});

  els.newChat.addEventListener('click', newChat);
  els.refreshHistory.addEventListener('click', () => loadHistory().catch((error) => alert(error.message)));
  els.settings.addEventListener('click', openSettings);
  els.settingsProvider.addEventListener('change', () => {
    const value = els.settingsProvider.value;
    updateSettingsProviderUi();
    if (value === 'llamaCpp') {
      adoptActiveModelAsLocalPathIfNeeded();
      syncLocalFormFromState();
      void refreshLocalStatus().catch(() => {});
      void refreshGpuInfo().catch(() => {});
      void autoDiscoverLocalModels();
    } else if (value === 'localAuto') {
      void loadDetectedModelsForSettings();
    } else if (value === 'download') {
      void loadDownloadCatalog();
    } else {
      // state.apiKey/baseUrl/model are one flat slot shared across every
      // cloud/local provider (pre-existing app design) — previewing a
      // provider the session isn't actually using must not show whatever
      // another provider (often a local GGUF path/URL) left in there.
      els.apiKey.value = state.provider === value ? state.apiKey : '';
    }
  });
  els.refreshDetectedModels.addEventListener('click', () => void loadDetectedModelsForSettings());
  els.addDetectedModelFolder.addEventListener('click', async () => {
    await runLocalAction(els.addDetectedModelFolder, 'Choosing…', async () => {
      const selected = await api('/api/local/choose-model-directory', {});
      if (!selected.cancelled) await loadDetectedModelsForSettings();
    });
  });
  els.testConnection.addEventListener('click', testConnection);
  els.startLocalModel.addEventListener('click', testSettingsConnection);
  // For llamaCpp there is nothing to pick from a dropdown — the model comes
  // from the Local Model dialog. Intercept the open attempt (mousedown fires
  // before the native option list appears; Enter/Space open it from the
  // keyboard) and send the user there instead of showing an empty picker.
  els.model.addEventListener('mousedown', (event) => {
    if (state.provider !== 'llamaCpp') return;
    event.preventDefault();
    void openLocalDialog();
  });
  els.model.addEventListener('keydown', (event) => {
    if (state.provider !== 'llamaCpp') return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void openLocalDialog();
    }
  });
  els.model.addEventListener('change', () => {
    state.model = els.model.value;
    if (state.provider === 'localAuto') {
      const runtime = state.detectedRuntimes.find((item) => item.models?.includes(state.model));
      if (runtime) state.baseUrl = runtime.baseUrl;
    }
    persistSession();
  });
  els.attach.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', async () => { await addFiles([...els.fileInput.files]); els.fileInput.value = ''; });
  els.send.addEventListener('click', () => { if (state.busy) state.chatAbort?.abort(); else void send(); });
  els.prompt.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void send(); }
  });
  els.prompt.addEventListener('input', autoGrow);
  ['dragenter', 'dragover'].forEach((type) => els.dropZone.addEventListener(type, (event) => { event.preventDefault(); els.dropZone.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach((type) => els.dropZone.addEventListener(type, (event) => { event.preventDefault(); els.dropZone.classList.remove('dragging'); }));
  els.dropZone.addEventListener('drop', async (event) => { await addFiles([...event.dataTransfer.files]); });

  els.saveSettings.addEventListener('click', () => {
    const selectedSource = els.settingsProvider.value;
    if (selectedSource === 'download') { els.dialog.close(); return; }
    const providerChanged = state.provider !== selectedSource;
    state.provider = selectedSource;
    if (!['llamaCpp', 'localAuto'].includes(state.provider)) {
      state.apiKey = els.apiKey.value.trim();
      state.baseUrl = '';
      if (providerChanged) state.model = '';
    } else if (state.provider === 'localAuto') {
      state.apiKey = '';
      state.model = state.pendingDetectedModel || state.model;
      state.baseUrl = state.pendingDetectedBaseUrl || state.baseUrl;
    } else if (state.provider === 'llamaCpp') {
      syncLocalStateFromForm();
    }
    persistSession();
    updateProviderUi();
    syncModelSelect();
    if (state.provider === 'llamaCpp') {
      void refreshLocalStatus().catch((error) => setLocalInlineError(error.message));
    }
    els.dialog.close();
    // Populates the model dropdown from the newly saved key/endpoint right
    // away, since the topbar no longer has a separate "Model" button to
    // trigger this manually (that slot is now Test Connection).
    if (state.provider !== 'llamaCpp') void loadModels().catch(() => {});
  });

  els.chooseLocalModel.addEventListener('click', async () => {
    await runLocalAction(els.chooseLocalModel, 'Choosing…', async () => {
      const data = await api('/api/local/choose-model', {});
      if (!data.cancelled) {
        state.local.modelPath = data.modelPath || '';
        state.local.mmprojPath = data.mmprojPath || '';
        saveLocalConfig();
        syncLocalFormFromState();
        renderLocalStatus();
        await startLocalModel();
      }
    });
  });
  els.chooseMmproj.addEventListener('click', async () => {
    await runLocalAction(els.chooseMmproj, 'Choosing…', async () => {
      const data = await api('/api/local/choose-mmproj', {});
      if (!data.cancelled) {
        state.local.mmprojPath = data.mmprojPath || '';
        saveLocalConfig(); syncLocalFormFromState();
      }
    });
  });
  els.searchLocalModels.addEventListener('click', async () => {
    await runLocalAction(els.searchLocalModels, 'Searching…', async () => {
      const data = await api('/api/local/search-models', { query: els.localModelSearch.value.trim(), limit: 1000 });
      renderLocalModelResults(data.models || []);
    });
  });
  els.chooseModelFolder.addEventListener('click', async () => {
    await runLocalAction(els.chooseModelFolder, 'Choosing…', async () => {
      const selected = await api('/api/local/choose-model-directory', {});
      if (selected.cancelled) return;
      const data = await api('/api/local/search-models', { query: els.localModelSearch.value.trim(), limit: 1000 });
      renderLocalModelResults(data.models || []);
    });
  });
  els.chooseDownloadDirectory.addEventListener('click', () => void chooseDownloadFolder());
  els.stopDownloadModel.addEventListener('click', () => activeDownloadController?.abort());
  els.searchDownloadModels.addEventListener('click', async () => {
    await runLocalAction(els.searchDownloadModels, 'Searching…', async () => {
      const query = els.downloadModelSearch.value.trim();
      if (!query) { renderDownloadCandidates([], 'Type something to search Hugging Face for.'); return; }
      const data = await api('/api/local/models/search', { query });
      renderHfSearchResults(data.results || []);
    });
  });
  els.chooseLlamaServer.addEventListener('click', async () => {
    await runLocalAction(els.chooseLlamaServer, 'Choosing…', async () => {
      const data = await api('/api/local/choose-server', {});
      if (!data.cancelled) {
        state.local.serverPath = data.serverPath || '';
        saveLocalConfig(); syncLocalFormFromState();
      }
    });
  });
  els.stopLocalModel.addEventListener('click', stopLocalModel);
  for (const input of [els.localModelPath, els.localMmprojPath, els.localServerPath, els.localPort, els.localContext, els.localGpuLayers, els.localSplitMode, els.localTimeout, els.localExtraArgs, els.localCpuMoe, els.localNoMmap, els.localDevice]) {
    input.addEventListener('change', syncLocalStateFromForm);
  }
  els.localDevice.addEventListener('change', () => refreshGpuInfo().catch(() => {}));

  setInterval(() => {
    if (state.provider === 'llamaCpp' || els.dialog.open || ['starting', 'ready'].includes(state.localStatus.status)) void refreshLocalStatus().catch(() => {});
  }, 2500);

  function newChat() {
    if (state.busy) return;
    state.currentChatId = '';
    state.messages = [];
    state.attachments = [];
    state.editingIndex = -1;
    els.prompt.value = '';
    els.prompt.placeholder = 'Message Vectra';
    autoGrow();
    render();
    renderHistory();
  }

  async function loadHistory() {
    const data = await request('/api/chats');
    state.history = data.chats || [];
    renderHistory();
  }

  async function openChat(id) {
    if (state.busy || id === state.currentChatId) return;
    const chat = await request(`/api/chats/${encodeURIComponent(id)}`);
    state.currentChatId = chat.id;
    state.messages = Array.isArray(chat.messages) ? chat.messages : [];
    state.attachments = [];
    state.editingIndex = -1;
    if (chat.provider) state.provider = chat.provider;
    if (chat.model) state.model = chat.model;
    persistSession();
    syncModelSelect();
    updateProviderUi();
    render();
    renderHistory();
  }

  async function deleteChat(id) {
    if (state.busy || !confirm('Delete this local chat permanently?')) return;
    await request(`/api/chats/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (state.currentChatId === id) newChat();
    await loadHistory();
  }

  function renderHistory() {
    els.chatHistory.replaceChildren();
    for (const chat of state.history) {
      const row = document.createElement('div');
      row.className = `history-item${chat.id === state.currentChatId ? ' active' : ''}`;
      const open = document.createElement('button');
      open.className = 'history-open';
      open.title = chat.title;
      open.textContent = chat.title || 'New chat';
      open.addEventListener('click', () => openChat(chat.id).catch((error) => alert(error.message)));
      const remove = document.createElement('button');
      remove.className = 'history-delete';
      remove.title = 'Delete chat';
      remove.textContent = '×';
      remove.addEventListener('click', () => deleteChat(chat.id).catch((error) => alert(error.message)));
      row.append(open, remove);
      els.chatHistory.appendChild(row);
    }
    if (!state.history.length) {
      const empty = document.createElement('div');
      empty.className = 'history-empty';
      empty.textContent = 'Your local chats will appear here.';
      els.chatHistory.appendChild(empty);
    }
  }

  async function persistChat() {
    const cleanMessages = state.messages.filter((message) => !message.pending).map(({ role, content, artifacts, createdAt }) => ({ role, content, artifacts: artifacts || [], createdAt }));
    const payload = { provider: state.provider, model: state.model, messages: cleanMessages };
    const saved = state.currentChatId
      ? await request(`/api/chats/${encodeURIComponent(state.currentChatId)}`, { method: 'PUT', body: payload })
      : await request('/api/chats', { method: 'POST', body: payload });
    state.currentChatId = saved.id;
    await loadHistory();
  }

  function openSettings() {
    syncSettingsFromState();
    updateSettingsProviderUi();
    if (!els.dialog.open) els.dialog.showModal();
    if (state.provider === 'localAuto') void loadDetectedModelsForSettings();
    if (state.provider === 'llamaCpp') void autoDiscoverLocalModels();
  }
  /** Opens the unified settings dialog pre-focused on local llama.cpp — used wherever the old separate Local Model dialog used to open. */
  async function openLocalDialog() {
    els.settingsProvider.value = 'llamaCpp';
    adoptActiveModelAsLocalPathIfNeeded();
    syncLocalFormFromState();
    updateSettingsProviderUi();
    if (!els.dialog.open) els.dialog.showModal();
    void autoDiscoverLocalModels();
    await refreshLocalStatus().catch((error) => setLocalInlineError(error.message));
    await refreshGpuInfo().catch(() => {});
  }

  /**
   * A model can already be active as a full filesystem path in state.model
   * (e.g. reported back by an OpenAI-compatible/llama.cpp endpoint the user
   * pointed at directly, or a local server started outside this dialog's own
   * Choose GGUF/Download flow) without ever having been written into
   * state.local.modelPath. Left alone, the local section then looks blank
   * for a model that is in fact running — adopt it once so the GGUF path
   * field isn't empty for no reason.
   */
  function adoptActiveModelAsLocalPathIfNeeded() {
    if (state.local.modelPath || !/[\\/]/.test(state.model || '')) return;
    state.local.modelPath = state.model;
    saveLocalConfig();
  }

  /** Lists every GGUF file already on this computer (with its full path) the moment the local section is shown, instead of waiting on a manual "Search computer" click — an empty query matches everything /api/local/search-models can find. */
  async function autoDiscoverLocalModels() {
    try {
      const data = await api('/api/local/search-models', { query: '', limit: 1000 });
      renderLocalModelResults(data.models || []);
    } catch {
      // Non-fatal: the manual search box and Choose GGUF picker still work.
    }
  }

  /** Only probes hardware when the user is actually looking at the local runtime dialog. */
  async function refreshGpuInfo() {
    if (els.localDevice.value === 'cpu') { els.localGpuInfo.textContent = '—'; return; }
    const response = await fetch('/api/local/gpu-info', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not detect GPUs.');
    const gpus = data.gpus || [];
    els.localGpuInfo.textContent = gpus.length
      ? `${gpus.length} GPU${gpus.length > 1 ? 's' : ''}: ${gpus.map((gpu) => gpu.name).join(', ')}`
      : 'No GPU detected — will use CPU.';
  }
  function syncSettingsFromState() {
    els.settingsProvider.value = state.provider;
    els.apiKey.value = state.apiKey;
  }
  function updateSettingsProviderUi() {
    const value = els.settingsProvider.value;
    const apiProvider = ['openai', 'anthropic', 'gemini'].includes(value);
    els.apiFields.hidden = !apiProvider;
    els.autoDetectFields.hidden = value !== 'localAuto';
    els.localRuntimeFields.hidden = value !== 'llamaCpp';
    els.downloadFields.hidden = value !== 'download';
    els.saveSettings.hidden = false;
    if (value === 'llamaCpp') renderLocalStatus();
    else setSettingsConnectionResult('stopped', 'Not tested');
  }
  function persistSession() {
    sessionStorage.setItem('vectra.provider', state.provider);
    sessionStorage.setItem('vectra.apiKey', state.apiKey);
    sessionStorage.setItem('vectra.baseUrl', state.baseUrl);
    sessionStorage.setItem('vectra.model', state.model);
  }
  function applyProviderDefaults() {
    if (state.provider === 'llamaCpp') {
      const status = state.localStatus;
      state.baseUrl = status.baseUrl || state.baseUrl || 'http://127.0.0.1:8080/v1';
      state.model = status.modelId || (status.status === 'ready' ? state.model : '');
    } else if (state.baseUrl === 'http://127.0.0.1:8080/v1') {
      state.baseUrl = '';
      state.model = '';
    }
    persistSession();
  }
  function updateProviderUi() {
    const local = state.provider === 'llamaCpp';
    els.localStatusPill.hidden = !local;
    renderLocalStatus();
  }

  async function testConnection() {
    if (state.provider === 'llamaCpp' && !(state.localStatus.running && state.localStatus.status === 'ready') && state.local.modelPath) {
      if (!confirm(`The selected model is not running. Start ${fileName(state.local.modelPath)} now?`)) return;
      await startLocalModel();
      if (!(state.localStatus.running && state.localStatus.status === 'ready')) return;
    }
    const previous = els.testConnection.textContent;
    els.testConnection.textContent = 'Testing…';
    els.testConnection.disabled = true;
    try {
      const data = await api('/api/test-connection', {
        provider: state.provider,
        apiKey: state.apiKey,
        baseUrl: state.baseUrl,
        model: state.model
      });
      alert(data.message);
    } catch (error) {
      alert(error.message);
    } finally {
      els.testConnection.textContent = previous;
      els.testConnection.disabled = false;
    }
  }

  async function testSettingsConnection() {
    const source = els.settingsProvider.value;
    const previous = els.startLocalModel.textContent;
    els.startLocalModel.disabled = true;
    els.startLocalModel.textContent = 'Testing…';
    setSettingsConnectionResult('testing', 'Testing…');
    try {
      if (source === 'download') {
        setSettingsConnectionResult('error', 'Not connected', 'Choose and download a model first.');
        return;
      }
      if (source === 'llamaCpp') {
        syncLocalStateFromForm();
        const runningSelectedModel = state.localStatus.running && state.localStatus.status === 'ready' &&
          (!state.localStatus.modelPath || state.localStatus.modelPath === state.local.modelPath);
        if (!runningSelectedModel) await startLocalModel();
        if (!(state.localStatus.running && state.localStatus.status === 'ready')) {
          setSettingsConnectionResult('error', 'Not connected', state.localStatus.lastError || 'The selected local model could not be started.');
          return;
        }
        const data = await api('/api/test-connection', {
          provider: 'llamaCpp', apiKey: '', baseUrl: state.localStatus.baseUrl || '', model: state.localStatus.modelId || ''
        });
        setSettingsConnectionResult(data.ok ? 'ready' : 'error', data.ok ? 'Connected' : 'Not connected', data.message);
        return;
      }
      if (source === 'localAuto') {
        const data = await api('/api/test-connection', { provider: 'localAuto', apiKey: '', baseUrl: '', model: state.pendingDetectedModel || '' });
        setSettingsConnectionResult(data.ok ? 'ready' : 'error', data.ok ? 'Connected' : 'Not connected', data.message);
        return;
      }
      const data = await api('/api/test-connection', {
        provider: source,
        apiKey: els.apiKey.value.trim(),
        baseUrl: '',
        model: ''
      });
      setSettingsConnectionResult(data.ok ? 'ready' : 'error', data.ok ? 'Connected' : 'Not connected', data.message);
    } catch (error) {
      setSettingsConnectionResult('error', 'Not connected', error.message);
    } finally {
      els.startLocalModel.disabled = false;
      els.startLocalModel.textContent = previous;
    }
  }

  function setSettingsConnectionResult(status, label, detail = '') {
    els.localDialogStatus.dataset.status = status;
    els.localDialogStatusText.dataset.status = status;
    els.localDialogStatusText.textContent = label;
    els.localDialogStatusText.title = detail || label;
  }

  async function loadModels() {
    if (state.provider === 'llamaCpp' && !(state.localStatus.running && state.localStatus.status === 'ready')) {
      await openLocalDialog();
      return;
    }
    const previous = els.model.disabled;
    els.model.disabled = true;
    try {
      const data = await api('/api/models', { provider: state.provider, apiKey: state.apiKey, baseUrl: state.baseUrl });
      state.detectedRuntimes = data.runtimes || [];
      if (state.provider === 'localAuto' && !(data.models || []).length) throw new Error('No local model server was detected. Start Ollama, LM Studio, llama.cpp, vLLM, or another OpenAI-compatible runtime, then try again.');
      populateModels(data.models || []);
      if (state.provider === 'localAuto') {
        const runtime = state.detectedRuntimes.find((item) => item.models?.includes(state.model)) || state.detectedRuntimes[0];
        if (runtime) { state.baseUrl = runtime.baseUrl; persistSession(); }
      }
    } catch (error) {
      alert(error.message);
      if (state.provider === 'llamaCpp') await openLocalDialog();
      else if (state.provider !== 'localAuto') openSettings();
    } finally {
      els.model.disabled = previous;
    }
  }

  async function loadDetectedModelsForSettings() {
    els.detectedModelList.hidden = false;
    els.detectedModelList.textContent = 'Scanning local runtimes and GGUF model folders…';
    els.refreshDetectedModels.disabled = true;
    try {
      const data = await api('/api/local/discover', {}).catch(() => ({ runtimes: [], gguf: [], ollama: [] }));
      state.detectedRuntimes = data.runtimes || [];
      els.detectedModelList.replaceChildren();
      const runtimeChoices = state.detectedRuntimes.flatMap((runtime) =>
        (runtime.models || []).map((model) => ({ model, runtime }))
      );
      const fileChoices = (data.gguf || []).map((item) => item.id);
      const runningNames = new Set(runtimeChoices.map((item) => item.model));
      const offlineOllama = (data.ollama || []).filter((item) => !runningNames.has(item.id));
      if (!runtimeChoices.length && !fileChoices.length && !offlineOllama.length) {
        els.detectedModelList.textContent = 'No local models found. Start a local runtime, add a model folder under llama.cpp, or download a model.';
        return;
      }
      for (const { model, runtime } of runtimeChoices) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `model-result${model === (state.pendingDetectedModel || state.model) ? ' selected' : ''}`;
        button.textContent = `${model} — ${runtime.name}`;
        button.addEventListener('click', () => {
          state.pendingDetectedModel = model;
          state.pendingDetectedBaseUrl = runtime.baseUrl;
          els.detectedModelList.querySelectorAll('button').forEach((item) => item.classList.toggle('selected', item === button));
        });
        els.detectedModelList.appendChild(button);
      }
      for (const modelPath of fileChoices) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `model-result${state.local.modelPath === modelPath ? ' selected' : ''}`;
        button.textContent = `${fileName(modelPath)} — GGUF on this PC`;
        button.title = modelPath;
        button.addEventListener('click', () => {
          state.local.modelPath = modelPath;
          state.local.mmprojPath = '';
          saveLocalConfig();
          syncLocalFormFromState();
          els.settingsProvider.value = 'llamaCpp';
          updateSettingsProviderUi();
          void autoDiscoverLocalModels();
          void startLocalModel();
        });
        els.detectedModelList.appendChild(button);
      }
      for (const model of offlineOllama) {
        const item = document.createElement('div');
        item.className = 'model-result disabled';
        item.textContent = `${model.label} — Ollama installed (server not running)`;
        item.title = 'Start Ollama to use this installed model.';
        els.detectedModelList.appendChild(item);
      }
    } catch (error) {
      els.detectedModelList.textContent = error.message;
    } finally {
      els.refreshDetectedModels.disabled = false;
    }
  }

  function populateModels(models) {
    els.model.replaceChildren(new Option('Select model', ''));
    for (const id of models) els.model.appendChild(new Option(id, id));
    if (state.model && ![...els.model.options].some((option) => option.value === state.model)) els.model.appendChild(new Option(state.model, state.model));
    if (!state.model && models[0]) state.model = models[0];
    els.model.value = state.model;
    persistSession();
  }

  async function startLocalModel() {
    if (state.localBusy) return;
    syncLocalStateFromForm();
    if (!state.local.modelPath) { setLocalInlineError('Choose a .gguf model first.'); return; }
    state.localBusy = true;
    state.localStatus = { ...state.localStatus, status: 'starting', lastError: '' };
    renderLocalStatus();
    els.startLocalModel.disabled = true;
    els.startLocalModel.textContent = 'Loading model…';
    try {
      let data;
      try {
        data = await api('/api/local/start', state.local);
      } catch (error) {
        if (error.code !== 'LLAMA_SERVER_MISSING' || !confirm(`${error.message}\n\nDownload and install llama.cpp automatically now?`)) throw error;
        await installLlamaCpp();
        els.startLocalModel.textContent = 'Loading model…';
        data = await api('/api/local/start', state.local);
      }
      state.localStatus = data;
      state.provider = 'llamaCpp';
      if (data.port) state.local.port = data.port;
      state.baseUrl = data.baseUrl || `http://127.0.0.1:${state.local.port}/v1`;
      state.model = data.modelId || state.model || fileName(state.local.modelPath);
      persistSession(); saveLocalConfig(); syncLocalFormFromState(); updateProviderUi();
      await loadModels();
    } catch (error) {
      setLocalInlineError(error.message);
      await refreshLocalStatus().catch(() => {});
    } finally {
      state.localBusy = false;
      els.startLocalModel.disabled = false;
      els.startLocalModel.textContent = 'Test';
      renderLocalStatus();
    }
  }

  /** Downloads the llama.cpp build matching this machine (CPU or CUDA) and verifies it runs, mirroring the VS Code extension's "Install llama.cpp automatically" prompt. Only runs once per machine: the resolved path is saved into the local config, so every later start finds it immediately. */
  async function installLlamaCpp() {
    els.startLocalModel.disabled = true;
    els.startLocalModel.textContent = 'Installing llama.cpp…';
    try {
      const data = await streamProgressRequest('/api/local/llama-cpp/install', {}, (event) => {
        if (typeof event.bytesDone !== 'number') return;
        els.startLocalModel.textContent = `Installing llama.cpp: ${progressText(event.bytesDone, event.totalBytes)}`;
      });
      state.local.serverPath = data.serverPath;
      saveLocalConfig();
      syncLocalFormFromState();
      setLocalInlineError(data.fellBackToCpu
        ? `Installed llama.cpp (${data.name}). The CUDA build did not run on this machine, so the CPU build was installed instead.`
        : `Installed llama.cpp (${data.name}). Starting the model…`);
    } catch (error) {
      setLocalInlineError(`Could not install llama.cpp automatically: ${error.message}`);
      throw error;
    } finally {
      els.startLocalModel.disabled = false;
      els.startLocalModel.textContent = 'Test';
    }
  }

  async function stopLocalModel() {
    if (state.localBusy) return;
    state.localBusy = true; renderLocalStatus();
    try {
      state.localStatus = await api('/api/local/stop', {});
      if (state.provider === 'llamaCpp') { state.model = ''; syncModelSelect(); persistSession(); }
    } catch (error) { setLocalInlineError(error.message); }
    finally { state.localBusy = false; renderLocalStatus(); }
  }

  async function refreshLocalStatus() {
    const response = await fetch('/api/local/status', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not read local runtime status.');
    state.localStatus = data;
    if (data.modelPath && !state.local.modelPath) state.local.modelPath = data.modelPath;
    if (data.mmprojPath && !state.local.mmprojPath) state.local.mmprojPath = data.mmprojPath;
    if (data.serverPath && !state.local.serverPath) state.local.serverPath = data.serverPath;
    if (data.port) state.local.port = data.port;
    if (state.provider === 'llamaCpp' && data.status === 'ready' && data.running) {
      const modelChanged = data.modelId && state.model !== data.modelId;
      state.baseUrl = data.baseUrl || state.baseUrl;
      if (data.modelId) state.model = data.modelId;
      persistSession();
      if (modelChanged) syncModelSelect();
    }
    syncLocalFormFromState(false);
    renderLocalStatus();
    return data;
  }

  function renderLocalStatus() {
    const status = state.localStatus.status || 'stopped';
    const labels = { ready: 'Ready', starting: 'Loading…', stopping: 'Stopping…', stopped: 'Stopped', error: 'Error' };
    const label = labels[status] || status;
    els.localStatusPill.textContent = label;
    els.localStatusPill.dataset.status = status;
    if (els.settingsProvider.value === 'llamaCpp') setSettingsConnectionResult(status, label, state.localStatus.lastError || '');
    let detail = 'Choose a GGUF model to begin.';
    if (status === 'ready') detail = `${state.localStatus.modelId || fileName(state.localStatus.modelPath)} · ${state.localStatus.baseUrl || ''}`;
    else if (status === 'starting') detail = `Loading ${fileName(state.local.modelPath) || 'local model'}… Large models can take several minutes.`;
    else if (status === 'error') detail = state.localStatus.lastError || 'llama.cpp failed to start.';
    else if (state.local.modelPath) detail = fileName(state.local.modelPath);
    els.localDialogDetail.textContent = detail;
    els.localLogs.textContent = (state.localStatus.logs || []).join('\n').trim() || 'No logs yet.';
    els.localLogs.scrollTop = els.localLogs.scrollHeight;
    els.stopLocalModel.disabled = state.localBusy || !state.localStatus.running;
  }

  function setLocalInlineError(message) {
    state.localStatus = { ...state.localStatus, status: 'error', lastError: message };
    renderLocalStatus();
  }

  function syncLocalStateFromForm() {
    const modelPath = els.localModelPath.value.trim();
    const modelChanged = modelPath !== state.local.modelPath;
    if (modelChanged) els.localMmprojPath.value = '';
    state.local = {
      ...state.local,
      modelPath,
      mmprojPath: modelChanged ? '' : els.localMmprojPath.value.trim(),
      serverPath: els.localServerPath.value.trim(),
      port: Number(els.localPort.value || 8080),
      contextSize: Number(els.localContext.value || 16384),
      gpuLayers: els.localGpuLayers.value.trim() || 'auto',
      splitMode: els.localSplitMode.value,
      device: els.localDevice.value,
      timeoutSeconds: Number(els.localTimeout.value || 3600),
      extraArgs: els.localExtraArgs.value.trim(),
      cpuMoe: els.localCpuMoe.checked,
      noMmap: els.localNoMmap.checked,
      threadProfile: els.localThreadProfile.value,
      threads: Number(els.localThreads.value || 0)
    };
    saveLocalConfig();
  }

  function syncLocalFormFromState(overwriteFocused = true) {
    const set = (element, value) => { if (overwriteFocused || document.activeElement !== element) element.value = value ?? ''; };
    set(els.localModelPath, state.local.modelPath || '');
    set(els.localMmprojPath, state.local.mmprojPath || '');
    set(els.localServerPath, state.local.serverPath || '');
    set(els.localPort, state.local.port || 8080);
    set(els.localContext, state.local.contextSize || 16384);
    set(els.localGpuLayers, state.local.gpuLayers || 'auto');
    set(els.localSplitMode, state.local.splitMode || 'layer');
    set(els.localDevice, state.local.device || 'auto');
    set(els.localTimeout, state.local.timeoutSeconds || 3600);
    set(els.localExtraArgs, state.local.extraArgs || '');
    els.localCpuMoe.checked = Boolean(state.local.cpuMoe);
    els.localNoMmap.checked = Boolean(state.local.noMmap);
    set(els.localThreadProfile, state.local.threadProfile || 'auto');
    set(els.localThreads, state.local.threads || 0);
  }

  async function addFiles(files) {
    const allowed = files.slice(0, Math.max(0, 8 - state.attachments.length));
    let currentBytes = state.attachments.reduce((sum, file) => sum + file.size, 0);
    for (const file of allowed) {
      if (file.size > 40 * 1024 * 1024) { alert(`${file.name} is larger than 40 MB and was skipped.`); continue; }
      if (currentBytes + file.size > 90 * 1024 * 1024) { alert('Attachment total is limited to 90 MB per message.'); break; }
      const textLike = isTextLike(file);
      const mime = file.type || mimeFromName(file.name);
      const documentLike = /\.(doc|docx|pptx|xlsx|rtf)$/i.test(file.name) || /msword|wordprocessingml|spreadsheetml|presentationml|rtf/.test(mime);
      const kind = textLike ? 'text' : mime === 'application/pdf' ? 'pdf' : documentLike ? 'document' : mime.startsWith('image/') ? 'image' : 'binary';
      const item = { name: file.name, mime, size: file.size, kind, text: '', base64: '', parseStatus: textLike ? 'ready' : 'pending' };
      if (textLike) item.text = await file.text();
      else item.base64 = await toBase64(file);
      state.attachments.push(item); renderAttachments();
      if (kind === 'pdf' || kind === 'document') {
        try {
          const parsed = await api('/api/attachments/inspect', { provider: state.provider, attachment: item });
          item.text = parsed.text || '';
          item.kind = parsed.kind || item.kind;
          item.parseStatus = parsed.parsedCharacters > 0 ? `parsed ${parsed.parsedCharacters.toLocaleString()} chars` : (parsed.visualPages > 0 ? `${parsed.visualPages} visual page(s)` : 'no embedded text');
        } catch (error) { item.parseStatus = `parse error: ${error.message}`; }
      } else if (kind === 'image') item.parseStatus = 'vision input';
      else if (kind === 'binary') item.parseStatus = 'binary';
      currentBytes += file.size; renderAttachments();
    }
  }

  async function send(overrideText) {
    const text = (typeof overrideText === 'string' ? overrideText : els.prompt.value).trim();
    if ((!text && !state.attachments.length) || state.busy) return;
    if (state.provider === 'llamaCpp') {
      const local = await refreshLocalStatus().catch(() => state.localStatus);
      if (!(local.running && local.status === 'ready')) { await openLocalDialog(); return; }
      state.baseUrl = local.baseUrl;
      state.model = local.modelId || state.model;
      persistSession();
    }
    if (!state.model) { if (state.provider === 'llamaCpp') await openLocalDialog(); else if (state.provider === 'localAuto') await loadModels(); else openSettings(); return; }
    if (!['llamaCpp', 'openaiCompatible', 'localAuto'].includes(state.provider) && !state.apiKey) { openSettings(); return; }

    if (state.editingIndex >= 0) state.messages.splice(state.editingIndex);
    state.editingIndex = -1;
    state.messages.push({ role: 'user', content: text || 'Please analyze the attached files.', createdAt: Date.now() });
    const payloadAttachments = state.attachments;
    state.attachments = [];
    els.prompt.value = ''; autoGrow(); renderAttachments();
    els.prompt.placeholder = 'Message Vectra';
    state.busy = true;
    state.chatAbort = new AbortController();
    // Toddler-speak on purpose (matches the VS Code extension's live step
    // log): the words still name the real phase — analyzing, parsing,
    // generating, producing — just dressed up as something fun to watch.
    // The log itself is driven by real server progress/subagent events, not
    // a canned timer, so it reflects what the agent is actually doing.
    const initialStep = payloadAttachments.length ? "Lookin' at the file-friends…" : "Snoopy-snoopin' at errythin'…";
    const placeholder = { role: 'assistant', content: '', pending: true, activityLog: [{ text: initialStep }], artifacts: [], createdAt: Date.now() };
    state.messages.push(placeholder); render();
    await persistChat().catch((error) => console.warn('Could not save chat history:', error));
    const activeSubagentRoles = [];

    try {
      const data = await streamChat({
        provider: state.provider,
        apiKey: state.apiKey,
        baseUrl: state.baseUrl,
        model: state.model,
        agentHarness: 'deepagents',
        conversationId: state.currentChatId,
        messages: state.messages.filter((message) => !message.pending),
        attachments: payloadAttachments
      }, state.chatAbort.signal, (text) => {
        // Real streamed output replaces the "Generating…" activity line the
        // moment the first token arrives, so a slow local model still shows
        // visible progress instead of one long silent wait.
        placeholder.content = text;
        render();
      }, (event) => {
        if (!placeholder.pending) return;
        if (event.type === 'progress') pushWebActivityStep(placeholder, activeSubagentRoles, event.message);
        else if (event.type === 'subagent') handleWebSubagentEvent(placeholder, activeSubagentRoles, event.subagent || {});
        render();
      });
      placeholder.content = data.text;
      placeholder.artifacts = data.artifacts || [];
      placeholder.pending = false;
    } catch (error) {
      placeholder.content = error.name === 'AbortError' ? 'Generation stopped. Edit or resend your message whenever you are ready.' : `Error: ${error.message}`;
      placeholder.pending = false;
    } finally {
      state.busy = false; state.chatAbort = null; render();
      await persistChat().catch((error) => console.warn('Could not save chat history:', error));
    }
  }

  function pushWebActivityStep(placeholder, activeRoles, text) {
    if (typeof text !== 'string' || !text) return;
    const role = activeRoles[activeRoles.length - 1];
    const last = placeholder.activityLog[placeholder.activityLog.length - 1];
    if (last && last.text === text && last.role === role) return;
    placeholder.activityLog.push({ text, role });
  }

  /** Tracks which role subagent (if any) is currently active so subsequent
   * progress lines land inside its collapsible group until it finishes. */
  function handleWebSubagentEvent(placeholder, activeRoles, subagent) {
    const role = subagent.role || 'general-purpose';
    if (subagent.event === 'started') {
      activeRoles.push(role);
      placeholder.activityLog.push({ text: `${webRoleLabel(role)}…`, role });
    } else {
      const index = activeRoles.lastIndexOf(role);
      if (index !== -1) activeRoles.splice(index, 1);
    }
  }

  function webRoleLabel(role) {
    const known = {
      planner: 'Planner', researcher: 'Researcher', coder: 'Coder', tester: 'Tester',
      reviewer: 'Reviewer', security: 'Security', documentation: 'Documentation'
    };
    return known[role] || (role.charAt(0).toUpperCase() + role.slice(1));
  }

  function renderLocalModelResults(models) {
    els.localModelResults.replaceChildren();
    els.localModelResults.hidden = false;
    if (!models.length) {
      els.localModelResults.textContent = 'No GGUF models were found in common model folders.';
      return;
    }
    for (const path of models) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'model-result';
      button.textContent = path;
      button.title = path;
      button.addEventListener('click', () => {
        state.local.modelPath = path;
        state.local.mmprojPath = '';
        saveLocalConfig();
        syncLocalFormFromState();
        els.localModelResults.hidden = true;
        void startLocalModel();
      });
      els.localModelResults.appendChild(button);
    }
  }

  /** Hardware-aware shortlist first (same catalog/recommend logic as the VS Code extension's Download Model flow), Hugging Face search as a fallback. Loaded once per settings-dialog open — cheap and cached server-side. */
  let downloadCatalogLoaded = false;
  let activeDownloadController = null;
  async function loadDownloadCatalog() {
    if (downloadCatalogLoaded) return;
    els.downloadModelHint.textContent = 'Loading recommendations for your hardware…';
    try {
      const data = await api('/api/local/models/catalog', {});
      const recommended = data.recommended || [];
      els.downloadModelHint.textContent = recommended.length
        ? 'Recommended for your hardware:'
        : 'No curated model fits your detected hardware — search Hugging Face instead.';
      renderDownloadCandidates(recommended);
      downloadCatalogLoaded = true;
    } catch (error) {
      els.downloadModelHint.textContent = error.message;
    }
  }

  function renderDownloadCandidates(entries, emptyText) {
    els.downloadModelList.replaceChildren();
    els.downloadModelList.hidden = false;
    if (!entries.length) {
      els.downloadModelList.textContent = emptyText || 'Nothing to show yet.';
      return;
    }
    for (const entry of entries) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'model-result';
      const sizeText = entry.sizeBytes ? formatSize(entry.sizeBytes) : 'unknown size';
      const kindText = entry.kind === 'vlm' ? ' · vision' : '';
      button.textContent = `${entry.label}  —  ${sizeText}${kindText}`;
      button.title = entry.label;
      button.addEventListener('click', () => void downloadModel(entry));
      els.downloadModelList.appendChild(button);
    }
  }

  function renderHfSearchResults(results) {
    els.downloadModelList.replaceChildren();
    els.downloadModelList.hidden = false;
    if (!results.length) {
      els.downloadModelList.textContent = 'No Hugging Face GGUF results found.';
      return;
    }
    for (const result of results) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'model-result';
      button.textContent = `${result.label}  —  ${result.downloads.toLocaleString()} downloads`;
      button.title = result.id;
      button.addEventListener('click', async () => {
        els.downloadModelProgress.hidden = false;
        els.downloadModelProgress.textContent = `Resolving ${result.id}…`;
        try {
          const resolved = await api('/api/local/models/resolve', { repoId: result.id });
          await downloadModel({ id: result.id, label: `${result.id} (${resolved.filename})`, ...resolved });
        } catch (error) {
          els.downloadModelProgress.textContent = `${error.message} Opening the Hugging Face page instead…`;
          window.open(`https://huggingface.co/${result.id}`, '_blank', 'noopener');
        }
      });
      els.downloadModelList.appendChild(button);
    }
  }

  async function downloadModel(entry) {
    if (!state.downloadDirectory && !(await chooseDownloadFolder())) return;
    const sizeText = entry.sizeBytes ? ` (${formatSize(entry.sizeBytes)})` : '';
    if (!confirm(`Download ${entry.label}${sizeText}?\n\nFolder: ${state.downloadDirectory}\n\nThe download will only begin after you confirm.`)) return;
    els.downloadModelProgress.hidden = false;
    els.downloadModelProgress.textContent = `Downloading ${entry.label}… this can take a while for multi-GB models.`;
    els.downloadModelList.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    const controller = new AbortController();
    activeDownloadController = controller;
    els.stopDownloadModel.hidden = false;
    els.stopDownloadModel.disabled = false;
    try {
      const data = await streamProgressRequest('/api/local/models/download', {
        downloadUrl: entry.downloadUrl,
        filename: entry.filename,
        mmprojUrl: entry.mmprojUrl,
        mmprojFilename: entry.mmprojFilename
      }, (event) => {
        if (typeof event.bytesDone !== 'number') return;
        const part = event.phase === 'mmproj' ? 'vision projector' : 'model';
        els.downloadModelProgress.textContent = `Downloading ${entry.label} — ${part}: ${progressText(event.bytesDone, event.totalBytes)}`;
      }, controller.signal);
      state.local.modelPath = data.modelPath;
      state.local.mmprojPath = data.mmprojPath || '';
      saveLocalConfig();
      syncLocalFormFromState();
      els.downloadModelProgress.textContent = 'Download complete. The model is selected and ready to start.';
      els.settingsProvider.value = 'llamaCpp';
      updateSettingsProviderUi();
      void autoDiscoverLocalModels();
    } catch (error) {
      els.downloadModelProgress.textContent = error.name === 'AbortError' ? 'Download stopped.' : `Download failed: ${error.message}`;
    } finally {
      els.downloadModelList.querySelectorAll('button').forEach((button) => { button.disabled = false; });
      els.stopDownloadModel.hidden = true;
      activeDownloadController = null;
    }
  }

  async function chooseDownloadFolder() {
    const previous = els.chooseDownloadDirectory.textContent;
    els.chooseDownloadDirectory.disabled = true;
    els.chooseDownloadDirectory.textContent = 'Choosing…';
    try {
      const data = await api('/api/local/choose-download-directory', {});
      if (data.cancelled) return false;
      state.downloadDirectory = data.directory || '';
      els.downloadDirectory.value = state.downloadDirectory;
      return Boolean(state.downloadDirectory);
    } catch (error) {
      alert(error.message);
      return false;
    } finally {
      els.chooseDownloadDirectory.disabled = false;
      els.chooseDownloadDirectory.textContent = previous;
    }
  }

  function editMessage(index) {
    if (state.busy) return;
    const message = state.messages[index];
    if (!message || message.role !== 'user') return;
    state.editingIndex = index;
    els.prompt.value = message.content;
    els.prompt.placeholder = 'Edit your message, then send';
    autoGrow();
    els.prompt.focus();
    render();
  }

  async function resendMessage(index) {
    if (state.busy) return;
    const message = state.messages[index];
    if (!message || message.role !== 'user') return;
    state.editingIndex = index;
    await send(message.content);
  }

  function render() {
    els.messages.replaceChildren();
    if (!state.messages.length) {
      const welcome = document.createElement('div'); welcome.className = 'welcome';
      welcome.innerHTML = '<img class="hero-mark" src="/VectraLogo.png" alt="Vectra logo" /><h1>How can Vectra help?</h1><p>Chat, analyze code and documents, or run a local GGUF model with llama.cpp.</p>';
      els.messages.appendChild(welcome);
    } else {
      state.messages.forEach((message, index) => {
        const wrap = document.createElement('article'); wrap.className = `web-message ${message.role}${message.pending ? ' pending' : ''}`;
        const avatar = document.createElement('div'); avatar.className = `avatar ${message.role === 'assistant' ? 'vectra-avatar' : 'user-avatar'}`;
        if (message.role === 'assistant') {
          const logo = document.createElement('img');
          logo.src = '/VectraLogo.png';
          logo.alt = 'Vectra';
          avatar.appendChild(logo);
        } else {
          avatar.textContent = 'Y';
        }
        const body = document.createElement('div'); body.className = 'web-message-body';
        const name = document.createElement('div'); name.className = 'web-message-name'; name.textContent = message.role === 'assistant' ? 'Vectra' : 'You';
        const content = document.createElement('div'); content.className = 'web-message-content';
        if (message.pending && !message.content) {
          content.appendChild(buildWebActivityLog(message.activityLog));
        } else if (message.role === 'assistant') {
          renderMarkdownInto(content, message.content);
          if (message.pending) { const cursor = document.createElement('span'); cursor.className = 'stream-cursor'; content.appendChild(cursor); }
        } else {
          content.textContent = message.content;
        }
        body.append(name, content);
        if (message.role === 'user' && !message.pending) {
          const actions = document.createElement('div'); actions.className = 'message-actions';
          const edit = document.createElement('button'); edit.textContent = state.editingIndex === index ? 'Editing' : 'Edit'; edit.disabled = state.busy; edit.addEventListener('click', () => editMessage(index));
          const resend = document.createElement('button'); resend.textContent = 'Resend'; resend.disabled = state.busy; resend.addEventListener('click', () => void resendMessage(index));
          actions.append(edit, resend); body.appendChild(actions);
        }
        if (message.artifacts?.length) { const row=document.createElement('div'); row.className='artifact-row'; for (const artifact of message.artifacts) { const a=document.createElement('a'); a.className='artifact-download'; a.download=artifact.name; a.href=`data:${artifact.mime};base64,${artifact.base64}`; a.textContent=`Download ${artifact.name}`; row.appendChild(a); } body.appendChild(row); }
        wrap.append(avatar, body); els.messages.appendChild(wrap);
      });
      requestAnimationFrame(() => { els.messages.scrollTop = els.messages.scrollHeight; });
    }
    els.send.disabled = false;
    els.send.textContent = state.busy ? '■' : '↑';
    els.send.title = state.busy ? 'Stop generating' : 'Send';
    renderAttachments();
  }

  /**
   * Mirrors the VS Code extension's step log: earlier phases get a check,
   * the newest gets a spinner. Consecutive entries sharing the same
   * subagent role (planner/researcher/coder/tester/reviewer/security/
   * documentation) collapse into one collapsible group instead of flat
   * lines, same idiom as the extension's activity log.
   */
  function buildWebActivityLog(steps) {
    const log = document.createElement('div'); log.className = 'web-activity-log';
    const list = steps && steps.length ? steps : [{ text: "Wakin' up…" }];
    let index = 0;
    while (index < list.length) {
      const role = list[index].role;
      let end = index + 1;
      if (role) while (end < list.length && list[end].role === role) end++;
      const group = list.slice(index, end);
      const isLastGroup = end === list.length;
      if (role) log.appendChild(buildWebActivityGroup(role, group, isLastGroup));
      else group.forEach((step, i) => log.appendChild(webActivityStepRow(step.text, isLastGroup && i === group.length - 1)));
      index = end;
    }
    return log;
  }

  function buildWebActivityGroup(role, steps, isLastGroup) {
    const details = document.createElement('details'); details.className = 'web-activity-group'; details.open = isLastGroup;
    const summary = document.createElement('summary'); summary.textContent = webRoleLabel(role);
    details.appendChild(summary);
    steps.forEach((step, i) => details.appendChild(webActivityStepRow(step.text, isLastGroup && i === steps.length - 1)));
    return details;
  }

  function webActivityStepRow(text, isActive) {
    const row = document.createElement('div'); row.className = `web-activity-step${isActive ? '' : ' done'}`;
    const icon = document.createElement('span');
    if (isActive) { icon.className = 'web-spinner'; }
    else { icon.className = 'web-activity-check'; icon.textContent = '✓'; }
    const label = document.createElement('span'); label.textContent = text;
    row.append(icon, label);
    return row;
  }

  function renderAttachments() {
    els.attachments.replaceChildren();
    state.attachments.forEach((file, index) => {
      const chip = document.createElement('div'); chip.className = 'attachment-chip';
      const label = document.createElement('span'); label.textContent = `${file.name} · ${formatSize(file.size)}${file.parseStatus ? ` · ${file.parseStatus}` : ''}`;
      const remove = document.createElement('button'); remove.textContent = '×'; remove.title = 'Remove';
      remove.addEventListener('click', () => { state.attachments.splice(index, 1); renderAttachments(); });
      chip.append(label, remove); els.attachments.appendChild(chip);
    });
  }

  function syncModelSelect() {
    const placeholder = state.provider === 'llamaCpp' && !state.model ? 'Configure local model…' : 'Select model';
    els.model.replaceChildren(new Option(state.model || placeholder, state.model || ''));
    els.model.value = state.model || '';
  }
  function autoGrow() { els.prompt.style.height = 'auto'; els.prompt.style.height = `${Math.min(180, Math.max(28, els.prompt.scrollHeight))}px`; }
  function isTextLike(file) { return file.type.startsWith('text/') || /\.(txt|md|json|jsonl|ya?ml|xml|csv|tsv|js|mjs|cjs|ts|tsx|jsx|py|java|c|cc|cpp|h|hpp|cs|go|rs|rb|php|swift|kt|kts|sql|sh|bash|zsh|ps1|html?|css|scss|less|vue|svelte|toml|ini|cfg|conf|log|tex)$/i.test(file.name); }
  function mimeFromName(name) { if (/\.docx$/i.test(name)) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; if (/\.pptx$/i.test(name)) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'; if (/\.xlsx$/i.test(name)) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; if (/\.rtf$/i.test(name)) return 'application/rtf'; if (/\.doc$/i.test(name)) return 'application/msword'; if (/\.pdf$/i.test(name)) return 'application/pdf'; if (/\.png$/i.test(name)) return 'image/png'; if (/\.jpe?g$/i.test(name)) return 'image/jpeg'; if (/\.webp$/i.test(name)) return 'image/webp'; if (/\.gif$/i.test(name)) return 'image/gif'; if (/\.bmp$/i.test(name)) return 'image/bmp'; if (/\.svg$/i.test(name)) return 'image/svg+xml'; return 'application/octet-stream'; }
  function toBase64(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); }); }
  function formatSize(size) { if (size < 1024) return `${size} B`; if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`; return `${(size / 1024 / 1024).toFixed(1)} MB`; }
  function fileName(path) { return String(path || '').split(/[\\/]/).pop() || ''; }

  function loadLocalConfig() {
    const defaults = { modelPath: '', mmprojPath: '', serverPath: '', port: 8080, contextSize: 16384, gpuLayers: 'auto', splitMode: 'layer', device: 'auto', timeoutSeconds: 3600, extraArgs: '', cpuMoe: false, noMmap: false };
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(LOCAL_CONFIG_KEY) || '{}') }; }
    catch { return defaults; }
  }
  function saveLocalConfig() { localStorage.setItem(LOCAL_CONFIG_KEY, JSON.stringify(state.local)); }
  async function request(path, options = {}) {
    const init = { method: options.method || 'GET', headers: {}, signal: options.signal };
    if (options.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    const response = await fetch(path, init);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `Request failed: HTTP ${response.status}`);
      error.code = data.code;
      throw error;
    }
    return data;
  }
  async function api(path, body) {
    return request(path, { method: 'POST', body: body || {} });
  }

  /**
   * `/api/chat` responds as an SSE stream: `{delta}` events append text as
   * the model produces it, `{replace}` swaps in a corrected full answer (the
   * rare false-attachment-refusal retry), and `{done}` carries the final
   * artifacts. Consuming it this way — rather than waiting for one JSON body
   * — is what makes a slow local generation show visible progress.
   */
  async function streamChat(body, signal, onDelta, onProgress) {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal
    });
    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Request failed: HTTP ${response.status}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const result = { text: '', artifacts: [], attachments: [] };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let event;
        try { event = JSON.parse(payload); } catch { continue; }
        if (event.error) throw new Error(event.error);
        if (typeof event.progress === 'string') onProgress?.({ type: 'progress', message: event.progress });
        if (event.subagent) onProgress?.({ type: 'subagent', subagent: event.subagent });
        if (typeof event.delta === 'string') { result.text += event.delta; onDelta?.(result.text); }
        if (typeof event.replace === 'string') { result.text = event.replace; onDelta?.(result.text); }
        if (event.done) { result.artifacts = event.artifacts || []; result.attachments = event.attachments || []; }
      }
    }
    return result;
  }

  /**
   * Same SSE contract as streamChat() but for a long-running download: the
   * server sends {bytesDone,totalBytes} progress events instead of text
   * deltas, and a final event carrying whatever the operation returns
   * (modelPath/mmprojPath, or serverPath for a llama.cpp install).
   */
  async function streamProgressRequest(url, body, onProgress, signal) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal
    });
    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Request failed: HTTP ${response.status}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let event;
        try { event = JSON.parse(payload); } catch { continue; }
        if (event.error) throw new Error(event.error);
        if (event.done) result = event;
        else onProgress?.(event);
      }
    }
    if (!result) throw new Error('The server closed the connection before finishing.');
    return result;
  }

  function progressText(bytesDone, totalBytes) {
    if (!totalBytes) return formatSize(bytesDone);
    const percent = Math.min(100, Math.floor((bytesDone / totalBytes) * 100));
    return `${percent}% (${formatSize(bytesDone)} / ${formatSize(totalBytes)})`;
  }

  /**
   * Small dependency-free markdown-lite renderer (no CDN dependency, keeps
   * the page self-contained): fenced code with a copy button, inline code,
   * bold/italic, headings, lists, and links.
   */
  function renderMarkdownInto(container, text) {
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    let i = 0;
    let listEl = null;
    const closeList = () => { listEl = null; };

    while (i < lines.length) {
      const line = lines[i];

      const fence = line.match(/^```\s*([\w+-]*)\s*$/);
      if (fence) {
        closeList();
        const lang = fence[1] || '';
        const codeLines = [];
        i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) { codeLines.push(lines[i]); i++; }
        i++;
        container.appendChild(buildCodeBlock(codeLines.join('\n'), lang));
        continue;
      }

      if (!line.trim()) { closeList(); i++; continue; }

      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        closeList();
        const h = document.createElement('div');
        h.className = 'md-heading';
        applyInline(h, heading[2]);
        container.appendChild(h);
        i++; continue;
      }

      const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
      const unordered = !ordered && line.match(/^\s*[-*]\s+(.*)$/);
      if (ordered || unordered) {
        const tag = ordered ? 'ol' : 'ul';
        if (!listEl || listEl.tagName.toLowerCase() !== tag) {
          listEl = document.createElement(tag);
          listEl.className = 'md-list';
          container.appendChild(listEl);
        }
        const li = document.createElement('li');
        applyInline(li, (ordered || unordered)[1]);
        listEl.appendChild(li);
        i++; continue;
      }
      closeList();

      const paraLines = [line];
      i++;
      while (
        i < lines.length && lines[i].trim() &&
        !/^```/.test(lines[i]) && !/^#{1,6}\s+/.test(lines[i]) && !/^\s*(\d+[.)]|[-*])\s+/.test(lines[i])
      ) {
        paraLines.push(lines[i]); i++;
      }
      const p = document.createElement('div');
      p.className = 'md-paragraph';
      applyInline(p, paraLines.join('\n'));
      container.appendChild(p);
    }
  }

  function applyInline(el, raw) {
    const text = String(raw);
    const tokenRe = /(`[^`\n]+`)|(\[[^\]]+\]\(\S+\))|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(\n)/g;
    let lastIndex = 0;
    let match;
    while ((match = tokenRe.exec(text))) {
      if (match.index > lastIndex) el.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      const token = match[0];
      if (token === '\n') {
        el.appendChild(document.createElement('br'));
      } else if (token[0] === '`') {
        const code = document.createElement('code');
        code.className = 'md-inline-code';
        code.textContent = token.slice(1, -1);
        el.appendChild(code);
      } else if (token[0] === '[') {
        const linkMatch = token.match(/^\[([^\]]+)\]\((\S+)\)$/);
        if (linkMatch) el.appendChild(buildLink(linkMatch[1], linkMatch[2]));
        else el.appendChild(document.createTextNode(token));
      } else if (token.startsWith('**') || token.startsWith('__')) {
        const strong = document.createElement('strong');
        strong.textContent = token.slice(2, -2);
        el.appendChild(strong);
      } else {
        const em = document.createElement('em');
        em.textContent = token.slice(1, -1);
        el.appendChild(em);
      }
      lastIndex = tokenRe.lastIndex;
    }
    if (lastIndex < text.length) el.appendChild(document.createTextNode(text.slice(lastIndex)));
  }

  function buildLink(label, url) {
    const safeUrl = /^https?:\/\//i.test(url) ? url : '';
    const span = document.createElement('span');
    if (safeUrl) {
      span.className = 'md-link';
      span.title = safeUrl;
      span.addEventListener('click', () => window.open(safeUrl, '_blank', 'noopener,noreferrer'));
    } else {
      span.className = 'md-inline-code';
    }
    span.textContent = label;
    return span;
  }

  function buildCodeBlock(code, lang) {
    const wrap = document.createElement('div');
    wrap.className = 'md-code-block';
    const bar = document.createElement('div');
    bar.className = 'md-code-bar';
    const label = document.createElement('span');
    label.className = 'md-code-lang';
    label.textContent = lang || 'text';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'md-copy-button';
    copy.textContent = 'Copy';
    copy.addEventListener('click', () => {
      copyToClipboard(code);
      copy.textContent = 'Copied';
      setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
    });
    bar.append(label, copy);
    const pre = document.createElement('pre');
    const codeEl = document.createElement('code');
    codeEl.textContent = code;
    pre.appendChild(codeEl);
    wrap.append(bar, pre);
    return wrap;
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* clipboard unavailable */ }
    document.body.removeChild(ta);
  }
  async function runLocalAction(button, label, action) {
    const old = button.textContent; button.disabled = true; button.textContent = label;
    try { await action(); } catch (error) { setLocalInlineError(error.message); }
    finally { button.disabled = false; button.textContent = old; }
  }

  render();
})();
