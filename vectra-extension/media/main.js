(function () {
  const vscode = acquireVsCodeApi();
  const saved = vscode.getState() || {};
  let mode = saved.mode || 'agent';
  let editingMessageId = saved.editingMessageId || '';
  // A running log of step entries for the current request, oldest first. The
  // last entry is "in progress" (spinner); everything before it is "done"
  // (checkmark) — this is what makes file-by-file progress visible instead
  // of one line that keeps getting silently overwritten. Each entry is
  // { text, role? } -- role is set while a Deep Agents role subagent
  // (planner/researcher/coder/tester/reviewer/security/documentation) is
  // active, so consecutive same-role entries can render nested under one
  // collapsible group instead of a flat line.
  let activitySteps = [];
  let activeSubagentRoles = [];
  let streamId = '';
  let streamText = '';
  let state = {
    messages: [], proposals: [], todos: [], plan: null, attachments: [], busy: false,
    provider: 'llamaCpp', model: '', localModelName: '', localModelRunning: false,
    visionEnabled: false, hasKey: true, isLocal: true, workspaceTrusted: true,
    deviceMode: 'auto', gpuInfo: '', theme: 'auto'
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    messages: $('messages'), attachments: $('attachments'),
    prompt: $('prompt'), send: $('sendButton'), stop: $('stopButton'), attach: $('attachButton'),
    clear: $('clearButton'), api: $('apiKeyButton'), local: $('localModelButton'), test: $('testButton'),
    download: $('downloadModelButton'),
    settings: $('settingsButton'), dialog: $('settingsDialog'), runtime: $('runtimeInfo'),
    capability: $('capabilityInfo'), advanced: $('advancedSettingsButton'), support: $('supportButton'),
    deviceMode: $('deviceMode'), gpuInfo: $('gpuInfo'), themeMode: $('themeMode')
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
  els.download.addEventListener('click', () => vscode.postMessage({ type: 'downloadModel' }));
  els.settings.addEventListener('click', () => {
    renderSettings();
    els.dialog.showModal();
  });
  els.advanced.addEventListener('click', () => vscode.postMessage({ type: 'openSettings' }));
  els.deviceMode.addEventListener('change', () => vscode.postMessage({ type: 'setDeviceMode', value: els.deviceMode.value }));
  els.themeMode.addEventListener('change', () => vscode.postMessage({ type: 'setTheme', value: els.themeMode.value }));
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
      const wasBusy = state.busy;
      state = { ...state, ...message };
      document.body.dataset.theme = state.theme === 'grayWhite' ? 'grayWhite' : '';
      // A fresh run starts a fresh step log; a finished run clears it so the
      // next busy period starts empty instead of showing stale steps.
      if (!state.busy || (state.busy && !wasBusy)) { activitySteps = []; activeSubagentRoles = []; }
      streamId = '';
      streamText = '';
      if (editingMessageId && !state.messages.some((item) => item.id === editingMessageId)) {
        editingMessageId = '';
        persistComposerState();
      }
      renderAll();
    } else if (message.type === 'progress') {
      pushActivityStep(cleanActivity(message.message));
      renderMessages();
    } else if (message.type === 'chatDelta') {
      if (message.id !== streamId) {
        streamId = message.id;
        streamText = '';
      }
      streamText += message.delta || '';
      renderMessages();
    } else if (message.type === 'todoUpdate') {
      state.todos = message.todos || [];
      renderMessages();
    } else if (message.type === 'planUpdate') {
      state.plan = message.plan || null;
      renderMessages();
    } else if (message.type === 'subagentUpdate') {
      handleSubagentEvent(message.subagent || {});
      renderMessages();
    } else if (message.type === 'error') {
      pushActivityStep("Uh-oh, somethin' went sideways…");
      renderMessages();
    }
  });

  function pushActivityStep(text) {
    const role = activeSubagentRoles[activeSubagentRoles.length - 1];
    const last = activitySteps[activitySteps.length - 1];
    if (last && last.text === text && last.role === role) return;
    activitySteps.push({ text, role });
  }

  /** Tracks which role subagent (if any) is currently active so subsequent
   * progress lines land inside its collapsible group until it finishes. */
  function handleSubagentEvent(subagent) {
    const role = subagent.role || 'general-purpose';
    if (subagent.event === 'started') {
      activeSubagentRoles.push(role);
      activitySteps.push({ text: `${roleLabel(role)}…`, role });
    } else {
      const index = activeSubagentRoles.lastIndexOf(role);
      if (index !== -1) activeSubagentRoles.splice(index, 1);
    }
  }

  function roleLabel(role) {
    const known = {
      planner: 'Planner', researcher: 'Researcher', coder: 'Coder', tester: 'Tester',
      reviewer: 'Reviewer', security: 'Security', documentation: 'Documentation'
    };
    return known[role] || (role.charAt(0).toUpperCase() + role.slice(1));
  }

  function send() {
    const text = els.prompt.value.trim();
    if (!text || state.busy || !state.workspaceTrusted) return;
    activitySteps = [];
    activeSubagentRoles = [];
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
    els.download.disabled = state.busy;
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
        card.append(meta, buildActivityLog());
      }
      els.messages.appendChild(card);
    }

    renderPlan(els.messages);
    renderTodos(els.messages);
    renderProposals(els.messages);
    requestAnimationFrame(() => { els.messages.scrollTop = els.messages.scrollHeight; });
  }

  /** A proposed plan renders as an inline reviewable card, same idiom as a proposal, clickable even while state.busy (the run is suspended waiting on it). */
  function renderPlan(container) {
    if (!state.plan) return;
    const card = document.createElement('article');
    card.className = `proposal plan ${state.plan.status}`;
    const top = document.createElement('div');
    top.className = 'proposal-top';
    const title = document.createElement('div');
    title.className = 'proposal-path';
    title.textContent = 'Proposed plan';
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = state.plan.status;
    top.append(title, badge);
    const reason = document.createElement('div');
    reason.className = 'proposal-reason';
    reason.textContent = state.plan.reason || '';
    const steps = document.createElement('ol');
    steps.className = 'plan-steps';
    for (const step of state.plan.steps || []) {
      const li = document.createElement('li');
      li.textContent = step.text;
      steps.appendChild(li);
    }
    card.append(top);
    if (state.plan.reason) card.append(reason);
    card.append(steps);
    if (state.plan.status === 'pending') {
      const actions = document.createElement('div');
      actions.className = 'proposal-actions';
      actions.append(
        button('Approve', 'primary', () => vscode.postMessage({ type: 'approvePlan' })),
        button('Reject', 'danger-outline', () => vscode.postMessage({ type: 'rejectPlan' }))
      );
      card.append(actions);
    }
    container.appendChild(card);
  }

  /** A live checklist for multi-step tasks. Shown whenever the agent has set one, independent of busy/idle. */
  function renderTodos(container) {
    if (!state.todos || !state.todos.length) return;
    const wrap = document.createElement('div');
    wrap.className = 'todo-panel';
    const title = document.createElement('div');
    title.className = 'todo-title';
    title.textContent = 'Update Todos';
    wrap.appendChild(title);
    for (const item of state.todos) {
      const row = document.createElement('div');
      row.className = `todo-item ${item.status}`;
      const icon = document.createElement('span');
      if (item.status === 'completed') {
        icon.className = 'activity-check';
        icon.textContent = '✓';
      } else if (item.status === 'in_progress') {
        icon.className = 'activity-spinner';
      } else {
        icon.className = 'todo-bullet';
      }
      const label = document.createElement('span');
      label.textContent = item.content;
      row.append(icon, label);
      wrap.appendChild(row);
    }
    container.appendChild(wrap);
  }

  /**
   * Renders the current run's step history: earlier steps get a checkmark
   * and dim, the newest step gets the spinner. Older steps beyond
   * MAX_VISIBLE_STEPS collapse into a single "N more steps" line so a long
   * multi-file agent run doesn't flood the sidebar.
   */
  function buildActivityLog() {
    const MAX_VISIBLE_STEPS = 6;
    const log = document.createElement('div');
    log.className = 'activity-log';
    const steps = activitySteps.length ? activitySteps : [{ text: "Wakin' up…" }];
    const overflow = Math.max(0, steps.length - MAX_VISIBLE_STEPS);
    if (overflow > 0) {
      log.appendChild(activityStepRow(`${overflow} more step${overflow === 1 ? '' : 's'} done`, 'done', '…'));
    }
    const visible = steps.slice(-MAX_VISIBLE_STEPS);
    // Consecutive steps sharing the same subagent role collapse into one
    // group instead of flat lines, so a delegated task reads as one entry
    // the user can expand rather than interleaving with the main flow.
    let index = 0;
    while (index < visible.length) {
      const role = visible[index].role;
      let end = index + 1;
      if (role) while (end < visible.length && visible[end].role === role) end++;
      const group = visible.slice(index, end);
      const isLastGroup = end === visible.length;
      if (role) {
        log.appendChild(buildActivityGroup(role, group, isLastGroup));
      } else {
        group.forEach((step, i) => {
          const isLast = isLastGroup && i === group.length - 1;
          log.appendChild(activityStepRow(step.text, isLast ? 'active' : 'done', isLast ? null : '✓'));
        });
      }
      index = end;
    }
    return log;
  }

  function buildActivityGroup(role, steps, isLastGroup) {
    const details = document.createElement('details');
    details.className = 'activity-group';
    details.open = isLastGroup;
    const summary = document.createElement('summary');
    summary.textContent = roleLabel(role);
    details.appendChild(summary);
    steps.forEach((step, i) => {
      const isLast = isLastGroup && i === steps.length - 1;
      details.appendChild(activityStepRow(step.text, isLast ? 'active' : 'done', isLast ? null : '✓'));
    });
    return details;
  }

  function activityStepRow(text, status, checkGlyph) {
    const row = document.createElement('div');
    row.className = `activity-step ${status}`;
    const icon = document.createElement('span');
    if (checkGlyph) {
      icon.className = 'activity-check';
      icon.textContent = checkGlyph;
    } else {
      icon.className = 'activity-spinner';
    }
    const label = document.createElement('span');
    label.textContent = text;
    row.append(icon, label);
    return row;
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
    els.themeMode.value = state.theme === 'grayWhite' ? 'grayWhite' : 'auto';
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
    if (!text || /agent step/i.test(text)) return "Snoopy-snoopin' at errythin'…";
    return text.length > 90 ? `${text.slice(0, 87)}…` : text;
  }

  renderModes();
  updatePlaceholder();
  vscode.postMessage({ type: 'ready' });
})();
