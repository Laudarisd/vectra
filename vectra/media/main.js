(function () {
  const vscode = acquireVsCodeApi();
  const saved = vscode.getState() || {};
  let mode = saved.mode || 'agent';
  let editingMessageId = saved.editingMessageId || '';
  let activityText = 'Analyzing…';
  let streamId = '';
  let streamText = '';
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
      streamId = '';
      streamText = '';
      if (editingMessageId && !state.messages.some((item) => item.id === editingMessageId)) {
        editingMessageId = '';
        persistComposerState();
      }
      renderAll();
    } else if (message.type === 'progress') {
      activityText = cleanActivity(message.message);
      renderMessages();
    } else if (message.type === 'chatDelta') {
      if (message.id !== streamId) {
        streamId = message.id;
        streamText = '';
      }
      streamText += message.delta || '';
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
      if (message.role === 'assistant') {
        renderMarkdownInto(content, message.content);
      } else {
        content.textContent = message.content;
      }
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
      if (streamText) {
        // A conversational (Ask) reply streams live; tool/agent steps still
        // only report progress text, since partial tool-call JSON isn't
        // meaningful to show mid-generation.
        const content = document.createElement('div');
        content.className = 'message-content';
        renderMarkdownInto(content, streamText);
        const cursor = document.createElement('span');
        cursor.className = 'stream-cursor';
        content.appendChild(cursor);
        card.append(meta, content);
      } else {
        const line = document.createElement('div');
        line.className = 'activity-line';
        line.innerHTML = '<span class="activity-spinner"></span><span></span>';
        line.lastElementChild.textContent = activityText;
        card.append(meta, line);
      }
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

  /**
   * Small dependency-free markdown-lite renderer. The VS Code webview CSP
   * forbids remote scripts, so this stays hand-rolled instead of vendoring a
   * markdown/highlight library — it covers what model output actually uses:
   * fenced code, inline code, bold/italic, headings, lists, and links.
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
      span.addEventListener('click', () => vscode.postMessage({ type: 'openExternal', value: safeUrl }));
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
