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
    detectedRuntimes: []
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    messages: $('messages'), prompt: $('prompt'), send: $('send'), attach: $('attach'), fileInput: $('fileInput'), attachments: $('attachments'),
    provider: $('provider'), model: $('model'), modelAction: $('modelAction'), localStatusPill: $('localStatusPill'),
    settings: $('settings'), dialog: $('settingsDialog'), settingsProvider: $('settingsProvider'), apiFields: $('apiFields'), localSettingsHint: $('localSettingsHint'),
    apiKey: $('apiKey'), baseUrl: $('baseUrl'), modelId: $('modelId'), saveSettings: $('saveSettings'), newChat: $('newChat'), dropZone: $('dropZone'),
    chatHistory: $('chatHistory'), refreshHistory: $('refreshHistory'),
    localDialog: $('localDialog'), localDialogStatus: $('localDialogStatus'), localDialogStatusText: $('localDialogStatusText'), localDialogDetail: $('localDialogDetail'),
    localModelPath: $('localModelPath'), localMmprojPath: $('localMmprojPath'), localServerPath: $('localServerPath'), localPort: $('localPort'), localContext: $('localContext'),
    localGpuLayers: $('localGpuLayers'), localSplitMode: $('localSplitMode'), localTimeout: $('localTimeout'), localExtraArgs: $('localExtraArgs'), localCpuMoe: $('localCpuMoe'),
    localDevice: $('localDevice'), localGpuInfo: $('localGpuInfo'),
    localNoMmap: $('localNoMmap'), chooseLocalModel: $('chooseLocalModel'), chooseMmproj: $('chooseMmproj'), chooseLlamaServer: $('chooseLlamaServer'), startLocalModel: $('startLocalModel'),
    stopLocalModel: $('stopLocalModel'), localLogs: $('localLogs'), localModelSearch: $('localModelSearch'), searchLocalModels: $('searchLocalModels'), localModelResults: $('localModelResults')
  };

  els.provider.value = state.provider;
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
  els.settingsProvider.addEventListener('change', updateSettingsProviderUi);
  els.provider.addEventListener('change', async () => {
    state.provider = els.provider.value;
    sessionStorage.setItem('vectra.provider', state.provider);
    applyProviderDefaults();
    syncSettingsFromState();
    syncModelSelect();
    updateProviderUi();
    if (state.provider === 'llamaCpp') await refreshLocalStatus().catch(() => {});
    if (state.provider === 'localAuto') await loadModels();
  });
  els.modelAction.addEventListener('click', async () => {
    if (state.provider === 'llamaCpp') await openLocalDialog();
    else await loadModels();
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

  els.saveSettings.addEventListener('click', (event) => {
    event.preventDefault();
    state.provider = els.settingsProvider.value;
    if (!['llamaCpp', 'localAuto'].includes(state.provider)) {
      state.apiKey = els.apiKey.value.trim();
      state.baseUrl = els.baseUrl.value.trim();
      state.model = els.modelId.value.trim();
    } else if (state.provider === 'localAuto') {
      state.apiKey = '';
      state.baseUrl = '';
      state.model = '';
    }
    persistSession();
    els.provider.value = state.provider;
    updateProviderUi();
    syncModelSelect();
    els.dialog.close();
    if (state.provider === 'llamaCpp') void openLocalDialog();
    if (state.provider === 'localAuto') void loadModels();
  });

  els.chooseLocalModel.addEventListener('click', async () => {
    await runLocalAction(els.chooseLocalModel, 'Choosing…', async () => {
      const data = await api('/api/local/choose-model', {});
      if (!data.cancelled) {
        state.local.modelPath = data.modelPath || '';
        if (data.mmprojPath) state.local.mmprojPath = data.mmprojPath;
        saveLocalConfig();
        syncLocalFormFromState();
        renderLocalStatus();
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
      const data = await api('/api/local/search-models', { query: els.localModelSearch.value.trim(), limit: 200 });
      renderLocalModelResults(data.models || []);
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
  els.startLocalModel.addEventListener('click', startLocalModel);
  els.stopLocalModel.addEventListener('click', stopLocalModel);
  for (const input of [els.localModelPath, els.localMmprojPath, els.localServerPath, els.localPort, els.localContext, els.localGpuLayers, els.localSplitMode, els.localTimeout, els.localExtraArgs, els.localCpuMoe, els.localNoMmap, els.localDevice]) {
    input.addEventListener('change', syncLocalStateFromForm);
  }
  els.localDevice.addEventListener('change', () => refreshGpuInfo().catch(() => {}));

  setInterval(() => {
    if (state.provider === 'llamaCpp' || els.localDialog.open || ['starting', 'ready'].includes(state.localStatus.status)) void refreshLocalStatus().catch(() => {});
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
    els.provider.value = state.provider;
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

  function openSettings() { syncSettingsFromState(); updateSettingsProviderUi(); els.dialog.showModal(); }
  async function openLocalDialog() {
    syncLocalFormFromState();
    if (!els.localDialog.open) els.localDialog.showModal();
    await refreshLocalStatus().catch((error) => setLocalInlineError(error.message));
    await refreshGpuInfo().catch(() => {});
  }

  /** Only probes hardware when the user is actually looking at the local runtime dialog. */
  async function refreshGpuInfo() {
    if (els.localDevice.value === 'cpu') { els.localGpuInfo.textContent = '—'; return; }
    const response = await fetch('\api\local\gpu-info', { cache: 'no-store' });
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
    els.baseUrl.value = state.baseUrl;
    els.modelId.value = state.model;
  }
  function updateSettingsProviderUi() {
    const local = ['llamaCpp', 'localAuto'].includes(els.settingsProvider.value);
    els.apiFields.hidden = local;
    els.localSettingsHint.hidden = !local;
    els.saveSettings.textContent = els.settingsProvider.value === 'llamaCpp' ? 'Open Local Model' : 'Use settings';
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
    els.modelAction.textContent = local ? 'Model' : 'Model';
    renderLocalStatus();
  }

  async function loadModels() {
    if (state.provider === 'llamaCpp' && !(state.localStatus.running && state.localStatus.status === 'ready')) {
      await openLocalDialog();
      return;
    }
    const previous = els.modelAction.textContent;
    els.modelAction.textContent = 'Loading…'; els.modelAction.disabled = true;
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
      els.modelAction.textContent = previous; els.modelAction.disabled = false;
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
      const data = await api('/api/local/start', state.local);
      state.localStatus = data;
      state.provider = 'llamaCpp';
      if (data.port) state.local.port = data.port;
      state.baseUrl = data.baseUrl || `http://127.0.0.1:${state.local.port}/v1`;
      state.model = data.modelId || state.model || fileName(state.local.modelPath);
      els.provider.value = 'llamaCpp';
      persistSession(); saveLocalConfig(); syncLocalFormFromState(); updateProviderUi();
      await loadModels();
    } catch (error) {
      setLocalInlineError(error.message);
      await refreshLocalStatus().catch(() => {});
    } finally {
      state.localBusy = false;
      els.startLocalModel.disabled = false;
      els.startLocalModel.textContent = 'Start model';
      renderLocalStatus();
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
    els.localDialogStatus.dataset.status = status;
    els.localDialogStatusText.textContent = label;
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
    state.local = {
      ...state.local,
      modelPath: els.localModelPath.value.trim(),
      mmprojPath: els.localMmprojPath.value.trim(),
      serverPath: els.localServerPath.value.trim(),
      port: Number(els.localPort.value || 8080),
      contextSize: Number(els.localContext.value || 16384),
      gpuLayers: els.localGpuLayers.value.trim() || 'auto',
      splitMode: els.localSplitMode.value,
      device: els.localDevice.value,
      timeoutSeconds: Number(els.localTimeout.value || 600),
      extraArgs: els.localExtraArgs.value.trim(),
      cpuMoe: els.localCpuMoe.checked,
      noMmap: els.localNoMmap.checked
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
    set(els.localTimeout, state.local.timeoutSeconds || 600);
    set(els.localExtraArgs, state.local.extraArgs || '');
    els.localCpuMoe.checked = Boolean(state.local.cpuMoe);
    els.localNoMmap.checked = Boolean(state.local.noMmap);
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
    const stages = payloadAttachments.length ? ['Analyzing files…','Parsing documents…','Generating…','Producing…'] : ['Analyzing…','Generating…','Producing…'];
    const placeholder = { role: 'assistant', content: '', pending: true, activity: stages[0], artifacts: [], createdAt: Date.now() };
    state.messages.push(placeholder); render();
    await persistChat().catch((error) => console.warn('Could not save chat history:', error));
    let stageIndex = 0; const activityTimer = setInterval(() => { if (!placeholder.pending) return; stageIndex = Math.min(stageIndex + 1, stages.length - 1); placeholder.activity = stages[stageIndex]; render(); }, 1200);

    try {
      const data = await request('/api/chat', { method: 'POST', signal: state.chatAbort.signal, body: {
        provider: state.provider,
        apiKey: state.apiKey,
        baseUrl: state.baseUrl,
        model: state.model,
        messages: state.messages.filter((message) => !message.pending),
        attachments: payloadAttachments
      } });
      placeholder.content = data.text;
      placeholder.artifacts = data.artifacts || [];
      placeholder.pending = false;
    } catch (error) {
      placeholder.content = error.name === 'AbortError' ? 'Generation stopped. Edit or resend your message whenever you are ready.' : `Error: ${error.message}`;
      placeholder.pending = false;
    } finally {
      clearInterval(activityTimer); state.busy = false; state.chatAbort = null; render();
      await persistChat().catch((error) => console.warn('Could not save chat history:', error));
    }
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
        saveLocalConfig();
        syncLocalFormFromState();
        els.localModelResults.hidden = true;
      });
      els.localModelResults.appendChild(button);
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
      welcome.innerHTML = '<div class="hero-mark">V</div><h1>How can Vectra help?</h1><p>Chat, analyze code and documents, or run a local GGUF model with llama.cpp.</p>';
      els.messages.appendChild(welcome);
    } else {
      state.messages.forEach((message, index) => {
        const wrap = document.createElement('article'); wrap.className = `web-message ${message.role}${message.pending ? ' pending' : ''}`;
        const avatar = document.createElement('div'); avatar.className = 'avatar'; avatar.textContent = message.role === 'assistant' ? 'V' : 'Y';
        const body = document.createElement('div'); body.className = 'web-message-body';
        const name = document.createElement('div'); name.className = 'web-message-name'; name.textContent = message.role === 'assistant' ? 'Vectra' : 'You';
        const content = document.createElement('div'); content.className = 'web-message-content';
        if (message.pending) { const line=document.createElement('div'); line.className='web-activity'; line.innerHTML='<span class="web-spinner"></span><span></span>'; line.lastElementChild.textContent=message.activity||'Generating…'; content.appendChild(line); } else content.textContent = message.content;
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
    els.model.replaceChildren(new Option(state.model || 'Select model', state.model || ''));
    els.model.value = state.model || '';
  }
  function autoGrow() { els.prompt.style.height = 'auto'; els.prompt.style.height = `${Math.min(180, Math.max(28, els.prompt.scrollHeight))}px`; }
  function isTextLike(file) { return file.type.startsWith('text/') || /\.(txt|md|json|jsonl|ya?ml|xml|csv|tsv|js|mjs|cjs|ts|tsx|jsx|py|java|c|cc|cpp|h|hpp|cs|go|rs|rb|php|swift|kt|kts|sql|sh|bash|zsh|ps1|html?|css|scss|less|vue|svelte|toml|ini|cfg|conf|log|tex)$/i.test(file.name); }
  function mimeFromName(name) { if (/\.docx$/i.test(name)) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; if (/\.pptx$/i.test(name)) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'; if (/\.xlsx$/i.test(name)) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; if (/\.rtf$/i.test(name)) return 'application/rtf'; if (/\.doc$/i.test(name)) return 'application/msword'; if (/\.pdf$/i.test(name)) return 'application/pdf'; if (/\.png$/i.test(name)) return 'image/png'; if (/\.jpe?g$/i.test(name)) return 'image/jpeg'; if (/\.webp$/i.test(name)) return 'image/webp'; if (/\.gif$/i.test(name)) return 'image/gif'; if (/\.bmp$/i.test(name)) return 'image/bmp'; if (/\.svg$/i.test(name)) return 'image/svg+xml'; return 'application/octet-stream'; }
  function toBase64(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); }); }
  function formatSize(size) { if (size < 1024) return `${size} B`; if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`; return `${(size / 1024 / 1024).toFixed(1)} MB`; }
  function fileName(path) { return String(path || '').split(/[\\/]/).pop() || ''; }

  function loadLocalConfig() {
    const defaults = { modelPath: '', mmprojPath: '', serverPath: '', port: 8080, contextSize: 16384, gpuLayers: 'auto', splitMode: 'layer', device: 'auto', timeoutSeconds: 600, extraArgs: '', cpuMoe: false, noMmap: false };
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
    if (!response.ok) throw new Error(data.error || `Request failed: HTTP ${response.status}`);
    return data;
  }
  async function api(path, body) {
    return request(path, { method: 'POST', body: body || {} });
  }
  async function runLocalAction(button, label, action) {
    const old = button.textContent; button.disabled = true; button.textContent = label;
    try { await action(); } catch (error) { setLocalInlineError(error.message); }
    finally { button.disabled = false; button.textContent = old; }
  }

  render();
})();
