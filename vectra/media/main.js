(function () {
  const vscode = acquireVsCodeApi();
  const saved = vscode.getState() || {};
  let mode = saved.mode || 'agent';
  let editingMessageId = saved.editingMessageId || '';
  let activityText = 'Analyzing…';
  let state = {
    messages: [], proposals: [], attachments: [], busy: false,
    provider: 'llamaCpp', model: '', localModelName: '', localModelRunning: false,
    visionEnabled: false, hasKey: true, isLocal: true, workspaceTrusted: true,
    deviceMode: 'auto', gpuInfo: ''
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    messages: $('messages'), attachments: $('attachments'),
    prompt: $('prompt'), send: $('sendButton'), stop: $('stopButton'), attach: $('attachButton'),
    clear: $('clearButton'), api: $('apiKeyButton'), local: $('localModelButton'), test: $('testButton'),
    settings: $('settingsButton'), dialog: $('settingsDialog'), runtime: $('runtimeInfo'),
    capability: $('capabilityInfo'), advanced: $('advancedSettingsButton'), support: $('supportButton'),
    deviceMode: $('deviceMode'), gpuInfo: $('gpuInfo')
  };

  document.querySelectorAll('.mode').forEach((control) => control.addEventListener('click', () => {
    mode = control.dataset.mode;
    persistComposerState();
    renderModes();
    updatePlaceholder();
  }));
  els.send.addEventListener('click', send);
  els.stop.addEventListener('click', () => vscode.postMessage({ type: 'stop' }));
  els.attach.addEventListener('click', () => vscode.postMessage({ type: 'attachFiles' }));
  els.clear.addEventListener('click', () => {
    cancelEditing(true);
    vscode.postMessage({ type: 'clearChat' });
  });
  els.api.addEventListener('click', () => vscode.postMessage({ type: 'setApiKey' }));
  els.local.addEventListener('click', () => vscode.postMessage({ type: 'selectLocalModel' }));
  els.test.addEventListener('click', () => vscode.postMessage({ type: 'testConnection' }));
  els.settings.addEventListener('click', () => {
    renderSettings();
    els.dialog.showModal();
  });
  els.advanced.addEventListener('click', () => vscode.postMessage({ type: 'openSettings' }));
  els.deviceMode.addEventListener('change', () => vscode.postMessage({ type: 'setDeviceMode', value: els.deviceMode.value }));
  els.support.addEventListener('click', () => vscode.postMessage({ type: 'supportDeveloper' }));
  els.prompt.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && editingMessageId) {
      event.preventDefault();
      cancelEditing(false);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      send();
    }
  });

  window.addEventListener('message', (event) => {
    const message = event.data || {};
    if (message.type === 'state') {
      state = { ...state, ...message };
      if (!state.busy) activityText = 'Analyzing…';
      if (editingMessageId && !state.messages.some((item) => item.id === editingMessageId)) {
        editingMessageId = '';
        persistComposerState();
      }
      renderAll();
    } else if (message.type === 'progress') {
      activityText = cleanActivity(message.message);
      renderMessages();
    } else if (message.type === 'error') {
      activityText = 'Error';
      renderMessages();
    }
  });

  function send() {
    const text = els.prompt.value.trim();
    if (!text || state.busy || !state.workspaceTrusted) return;
    activityText = 'Analyzing…';
    vscode.postMessage({
      type: 'send',
      text,
      mode,
      ...(editingMessageId ? { editMessageId: editingMessageId } : {})
    });
    editingMessageId = '';
    els.prompt.value = '';
    persistComposerState();
    renderComposer();
    updatePlaceholder();
  }

  /** Fill the composer and resend from this message when the user submits. */
  function beginEdit(message) {
    if (state.busy) return;
    editingMessageId = message.id;
    mode = message.mode || mode;
    els.prompt.value = message.content;
    persistComposerState();
    renderModes();
    renderComposer();
    updatePlaceholder();
    els.prompt.focus();
    els.prompt.setSelectionRange(els.prompt.value.length, els.prompt.value.length);
  }

  function cancelEditing(clearText) {
    editingMessageId = '';
    if (clearText) els.prompt.value = '';
    persistComposerState();
    renderComposer();
    updatePlaceholder();
  }

  function persistComposerState() {
    vscode.setState({ mode, editingMessageId });
  }

  function renderAll() {
    renderModes();
    renderConnections();
    renderMessages();
    renderAttachments();
    renderComposer();
    renderSettings();
    updatePlaceholder();
  }

  function renderModes() {
    document.querySelectorAll('.mode').forEach((control) => {
      control.classList.toggle('active', control.dataset.mode === mode);
    });
  }

  function renderConnections() {
    const provider = providerLabel(state.provider);
    els.api.textContent = state.isLocal ? 'API Key' : `API · ${shortName(state.model || provider, 18)}`;
    els.local.textContent = state.localModelName ? `Local · ${shortName(state.localModelName, 17)}` : 'Local Model';
    els.local.classList.toggle('active-connection', state.isLocal);
    els.api.classList.toggle('active-connection', !state.isLocal);
    els.api.classList.toggle('warning', !state.isLocal && !state.hasKey);
    els.test.disabled = state.busy;
  }

  function renderMessages() {
    els.messages.replaceChildren();
    if (!state.messages.length && !state.busy) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = '<div class="empty-title">Vectra</div><div>Ask about code, create or edit files, parse PDF/DOCX, attach images, or run approved tools in Agent mode.</div>';
      els.messages.appendChild(empty);
    }

    for (const message of state.messages) {
      const card = document.createElement('article');
      card.className = `message ${message.role}`;
      const header = document.createElement('div');
      header.className = 'message-header';
      const meta = document.createElement('div');
      meta.className = 'message-meta';
      meta.textContent = message.role === 'assistant' ? 'Vectra' : 'You';
      header.appendChild(meta);
      if (message.role === 'user') {
        const edit = button('Edit & resend', 'message-action', () => beginEdit(message));
        edit.disabled = state.busy;
        edit.title = 'Edit this prompt and resend from this point';
        header.appendChild(edit);
      }

      const content = document.createElement('div');
      content.className = 'message-content';
      content.textContent = message.content;
      card.append(header, content);
      if (message.attachments?.length) {
        const row = document.createElement('div');
        row.className = 'message-attachments';
        for (const attachment of message.attachments) {
          const chip = document.createElement('span');
          chip.className = 'attachment-readonly';
          chip.textContent = `${iconFor(attachment.kind)} ${attachment.name}`;
          row.appendChild(chip);
        }
        card.appendChild(row);
      }
      els.messages.appendChild(card);
    }

    if (state.busy) {
      const card = document.createElement('article');
      card.className = 'message assistant activity-message';
      const meta = document.createElement('div');
      meta.className = 'message-meta';
      meta.textContent = 'Vectra';
      const line = document.createElement('div');
      line.className = 'activity-line';
      line.innerHTML = '<span class="activity-spinner"></span><span></span>';
      line.lastElementChild.textContent = activityText;
      card.append(meta, line);
      els.messages.appendChild(card);
    }

    renderProposals(els.messages);
    requestAnimationFrame(() => { els.messages.scrollTop = els.messages.scrollHeight; });
  }

  function renderAttachments() {
    els.attachments.replaceChildren();
    for (const attachment of state.attachments || []) {
      const chip = document.createElement('div');
      chip.className = 'attachment-chip';
      const label = document.createElement('span');
      label.textContent = `${iconFor(attachment.kind)} ${attachment.name} · ${formatSize(attachment.size)}`;
      const remove = document.createElement('button');
      remove.textContent = '×';
      remove.title = 'Remove';
      remove.addEventListener('click', () => vscode.postMessage({ type: 'removeAttachment', id: attachment.id }));
      chip.append(label, remove);
      els.attachments.appendChild(chip);
    }
  }

  /** Proposal review lives inline in the main chat scroll — no separate scrollable panel. */
  function renderProposals(container) {
    if (!state.proposals.length) return;
    const wrap = document.createElement('div');
    wrap.className = 'proposals';
    const pending = state.proposals.filter((proposal) => proposal.status === 'pending');

    const header = document.createElement('div');
    header.className = 'proposal-section-header';
    const title = document.createElement('strong');
    title.textContent = 'Proposed changes';
    header.appendChild(title);
    if (pending.length > 1) {
      const actions = document.createElement('div');
      actions.className = 'proposal-batch-actions';
      actions.append(
        button('Accept all', 'primary small', () => vscode.postMessage({ type: 'acceptAll' })),
        button('Reject all', 'secondary small', () => vscode.postMessage({ type: 'rejectAll' }))
      );
      header.appendChild(actions);
    }
    wrap.appendChild(header);

    for (const proposal of state.proposals) {
      const card = document.createElement('article');
      card.className = `proposal ${proposal.status}`;
      const top = document.createElement('div');
      top.className = 'proposal-top';
      const filePath = document.createElement('div');
      filePath.className = 'proposal-path';
      filePath.textContent = proposal.path;
      const badge = document.createElement('span');
      badge.className = `badge ${proposal.kind}`;
      badge.textContent = `${proposal.kind} · ${proposal.status}`;
      top.append(filePath, badge);
      const reason = document.createElement('div');
      reason.className = 'proposal-reason';
      reason.textContent = proposal.reason || 'Vectra-proposed change';
      const actions = document.createElement('div');
      actions.className = 'proposal-actions';
      actions.appendChild(button('View diff', 'secondary', () => vscode.postMessage({ type: 'showDiff', id: proposal.id })));
      if (proposal.status === 'pending') {
        actions.append(
          button('Accept', 'primary', () => vscode.postMessage({ type: 'accept', id: proposal.id })),
          button('Reject', 'danger-outline', () => vscode.postMessage({ type: 'reject', id: proposal.id }))
        );
      } else if (proposal.status === 'accepted') {
        actions.appendChild(button('Undo', 'danger-outline', () => vscode.postMessage({ type: 'undo', id: proposal.id })));
      }
      card.append(top, reason, actions);
      wrap.appendChild(card);
    }
    if (!pending.length) {
      wrap.appendChild(button('Clear reviewed changes', 'secondary wide', () => vscode.postMessage({ type: 'clearCompleted' })));
    }
    container.appendChild(wrap);
  }

  function renderComposer() {
    els.prompt.disabled = state.busy || !state.workspaceTrusted;
    els.attach.disabled = state.busy || !state.workspaceTrusted;
    els.send.classList.toggle('hidden', state.busy);
    els.send.disabled = !state.workspaceTrusted;
    els.send.textContent = editingMessageId ? 'Resend' : 'Send';
    els.stop.classList.toggle('hidden', !state.busy);
  }

  function renderSettings() {
    if (!els.runtime) return;
    const status = state.provider === 'llamaCpp'
      ? (state.localModelRunning ? 'Ready' : 'Stopped')
      : (state.hasKey ? 'Configured' : 'API key required');
    els.runtime.replaceChildren(
      row('Status', status),
      row('Provider', providerLabel(state.provider)),
      row('Model', state.localModelName || state.model || 'Not selected'),
      row('Workspace', state.workspaceTrusted ? 'Trusted' : 'Restricted')
    );
    const vision = state.visionEnabled
      ? 'Vision enabled: images and visual PDF pages can be analyzed with the selected VLM/projector.'
      : 'Text/document mode: code, text files, extracted PDF text and Word documents are supported. Images, scans and visual PDF pages require a vision-capable GGUF with its matching mmproj.';
    els.capability.textContent = vision;
    els.deviceMode.value = state.deviceMode || 'auto';
    els.gpuInfo.textContent = state.gpuInfo || '';
    els.gpuInfo.classList.toggle('hidden', !state.gpuInfo);
  }

  function row(key, value) {
    const element = document.createElement('div');
    element.className = 'runtime-row';
    const label = document.createElement('span');
    label.textContent = key;
    const detail = document.createElement('strong');
    detail.textContent = value;
    element.append(label, detail);
    return element;
  }

  function updatePlaceholder() {
    if (editingMessageId) {
      els.prompt.placeholder = 'Edit this message, then choose Resend. Press Escape to cancel editing.';
      return;
    }
    els.prompt.placeholder = mode === 'agent'
      ? 'Tell Vectra what to build, edit, create, delete, run, or test…'
      : mode === 'ask'
        ? 'Ask about this repository or attach PDF, Word, code, or images…'
        : 'Ask Vectra to explain the exact selected code…';
  }

  function button(label, className, handler) {
    const element = document.createElement('button');
    element.className = className;
    element.textContent = label;
    element.addEventListener('click', handler);
    return element;
  }

  function providerLabel(provider) {
    return ({
      llamaCpp: 'Local llama.cpp', ollama: 'Ollama', openai: 'OpenAI',
      anthropic: 'Anthropic', gemini: 'Gemini', openaiCompatible: 'OpenAI-compatible'
    })[provider] || provider;
  }

  function shortName(value, length) {
    return String(value).length > length ? `${String(value).slice(0, length - 1)}…` : String(value);
  }

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  function iconFor(kind) {
    return kind === 'pdf' ? 'PDF' : kind === 'document' ? 'DOC' : kind === 'image' ? 'IMG' : kind === 'text' ? 'FILE' : 'BIN';
  }

  function cleanActivity(value) {
    const text = String(value || '').trim();
    if (!text || /agent step/i.test(text)) return 'Analyzing…';
    return text.length > 90 ? `${text.slice(0, 87)}…` : text;
  }

  renderModes();
  updatePlaceholder();
  vscode.postMessage({ type: 'ready' });
})();
