/**
 * ui.js — Toolbar interactions, theme toggle, keyboard shortcuts,
 * search/filter, minimap, zoom controls, emoji picker.
 */

const UI = (() => {
  // ===== Theme Toggle =====

  function initTheme() {
    const saved = localStorage.getItem('mindflow-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeIcon(saved);

    document.getElementById('btn-theme').addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('mindflow-theme', next);
      updateThemeIcon(next);
    });
  }

  function updateThemeIcon(theme) {
    const moon = document.getElementById('theme-icon-moon');
    const sun = document.getElementById('theme-icon-sun');
    if (theme === 'dark') {
      moon.classList.remove('hidden');
      sun.classList.add('hidden');
    } else {
      moon.classList.add('hidden');
      sun.classList.remove('hidden');
    }
  }

  // ===== Toolbar Buttons =====

  function initToolbar() {
    // Add child
    document.getElementById('tool-add-child').addEventListener('click', () => {
      addChildToSelected();
    });

    // Add sibling
    document.getElementById('tool-add-sibling').addEventListener('click', () => {
      addSiblingToSelected();
    });

    // Delete node
    document.getElementById('tool-delete').addEventListener('click', () => {
      deleteSelected();
    });

    // Undo / Redo
    document.getElementById('tool-undo').addEventListener('click', () => History.undo());
    document.getElementById('tool-redo').addEventListener('click', () => History.redo());

    // Zoom
    document.getElementById('tool-zoom-in').addEventListener('click', () => Renderer.zoomIn());
    document.getElementById('tool-zoom-out').addEventListener('click', () => Renderer.zoomOut());
    document.getElementById('tool-fit').addEventListener('click', () => Renderer.fitView());

    // Auto layout
    document.getElementById('tool-layout').addEventListener('click', () => {
      History.pushState('auto-layout');
      MindMap.autoLayout();
      Renderer.renderAll();
      syncAllIfConnected();
    });

    // Color picker
    initColorPicker();

    // Shape picker
    initShapePicker();

    // Emoji picker
    initEmojiPicker();

    // Export dropdown
    initExportDropdown();

    // Share button
    document.getElementById('btn-share').addEventListener('click', showShareModal);

    // Search
    document.getElementById('btn-search').addEventListener('click', toggleSearch);
  }

  // ===== Node Operations =====

  function addChildToSelected() {
    const selectedId = Renderer.getSelectedNodeId();
    const parentId = selectedId || MindMap.getRootId();
    if (!parentId) return;

    History.pushState('add-child');
    const node = MindMap.addNode('New Node', parentId);
    MindMap.autoLayout();
    Renderer.renderAll();
    Renderer.selectNode(node.id);
    Renderer.centerOnNode(node.id);
    Renderer.startEditing(node.id);
    syncNodeAndParent(node.id);
  }

  function addSiblingToSelected() {
    const selectedId = Renderer.getSelectedNodeId();
    if (!selectedId) return;

    const selected = MindMap.getNode(selectedId);
    if (!selected || !selected.parentId) return; // can't add sibling to root

    History.pushState('add-sibling');
    const node = MindMap.addSibling(selectedId, 'New Node');
    if (!node) return;
    MindMap.autoLayout();
    Renderer.renderAll();
    Renderer.selectNode(node.id);
    Renderer.centerOnNode(node.id);
    Renderer.startEditing(node.id);
    syncNodeAndParent(node.id);
  }

  function deleteSelected() {
    const selectedId = Renderer.getSelectedNodeId();
    if (!selectedId) return;
    if (selectedId === MindMap.getRootId()) {
      Utils.showToast('Cannot delete root node');
      return;
    }

    History.pushState('delete-node');
    const node = MindMap.getNode(selectedId);
    const parentId = node?.parentId;
    const deletedIds = MindMap.deleteNode(selectedId);
    MindMap.autoLayout();
    Renderer.selectNode(parentId);
    Renderer.renderAll();

    // Sync deletions
    if (deletedIds) {
      deletedIds.forEach(id => Collaboration.syncNodeDelete(id));
    }
    if (parentId) Collaboration.syncNode(parentId);
  }

  function syncNodeAndParent(nodeId) {
    const node = MindMap.getNode(nodeId);
    Collaboration.syncNode(nodeId);
    if (node && node.parentId) {
      Collaboration.syncNode(node.parentId);
    }
  }

  function syncAllIfConnected() {
    if (Collaboration.getIsConnected() && Collaboration.getRoomId()) {
      Collaboration.syncAllNodes();
    }
  }

  // ===== Color Picker =====

  function initColorPicker() {
    const btn = document.getElementById('tool-color');
    const palette = document.getElementById('color-palette');

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      palette.classList.toggle('hidden');
      document.getElementById('shape-palette').classList.add('hidden');
    });

    palette.querySelectorAll('.color-swatch').forEach(swatch => {
      swatch.addEventListener('click', (e) => {
        e.stopPropagation();
        const color = swatch.dataset.color;
        const selectedId = Renderer.getSelectedNodeId();
        if (selectedId) {
          History.pushState('change-color');
          MindMap.updateNode(selectedId, { color });
          Renderer.renderAll();
          Collaboration.syncNode(selectedId);
        }
        palette.classList.add('hidden');
      });
    });
  }

  // ===== Shape Picker =====

  function initShapePicker() {
    const btn = document.getElementById('tool-shape');
    const palette = document.getElementById('shape-palette');

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      palette.classList.toggle('hidden');
      document.getElementById('color-palette').classList.add('hidden');
    });

    palette.querySelectorAll('.shape-option').forEach(option => {
      option.addEventListener('click', (e) => {
        e.stopPropagation();
        const shape = option.dataset.shape;
        const selectedId = Renderer.getSelectedNodeId();
        if (selectedId) {
          History.pushState('change-shape');
          MindMap.updateNode(selectedId, { shape });
          Renderer.renderAll();
          Collaboration.syncNode(selectedId);
        }
        palette.classList.add('hidden');
      });
    });
  }

  // ===== Emoji Picker =====

  function initEmojiPicker() {
    const btn = document.getElementById('tool-emoji');
    const modal = document.getElementById('emoji-modal');
    const grid = document.getElementById('emoji-grid');

    const emojis = [
      '💡', '🎯', '🚀', '⭐', '🔥', '💎', '🎨', '📝',
      '✅', '❌', '⚠️', '💬', '📌', '🔗', '📊', '📈',
      '🧩', '🛠️', '💻', '🌐', '📱', '🎵', '📚', '🔑',
      '❤️', '👍', '👎', '🤔', '😊', '🎉', '⚡', '🌟',
      '🏆', '🎪', '🔒', '🔓', '📋', '🗂️', '📁', '🗑️',
      '🧠', '💪', '👁️', '🎲', '🌈', '☀️', '🌙', '⏰',
    ];

    // Build grid
    emojis.forEach(emoji => {
      const btn = document.createElement('button');
      btn.textContent = emoji;
      btn.addEventListener('click', () => {
        const selectedId = Renderer.getSelectedNodeId();
        if (selectedId) {
          History.pushState('set-emoji');
          const node = MindMap.getNode(selectedId);
          // Toggle: if same emoji, remove it
          const newEmoji = node.emoji === emoji ? null : emoji;
          MindMap.updateNode(selectedId, { emoji: newEmoji });
          Renderer.renderAll();
          Collaboration.syncNode(selectedId);
        }
        closeModal(modal);
      });
      grid.appendChild(btn);
    });

    btn.addEventListener('click', () => openModal(modal));

    // Close modal events
    modal.querySelector('.modal-backdrop').addEventListener('click', () => closeModal(modal));
    modal.querySelector('.modal-close').addEventListener('click', () => closeModal(modal));
  }

  // ===== Export Dropdown =====

  function initExportDropdown() {
    const dropdown = document.getElementById('export-dropdown');
    const btn = document.getElementById('btn-export');

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('open');
    });

    // Close on outside click
    document.addEventListener('click', () => {
      dropdown.classList.remove('open');
    });

    document.getElementById('btn-export-png').addEventListener('click', () => {
      Export.exportPNG();
      dropdown.classList.remove('open');
    });

    document.getElementById('btn-export-json').addEventListener('click', () => {
      Export.exportJSON();
      dropdown.classList.remove('open');
    });

    document.getElementById('btn-import-json').addEventListener('click', () => {
      Export.importJSON();
      dropdown.classList.remove('open');
    });
  }

  // ===== Keyboard Shortcuts =====

  function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Skip if editing text
      if (Renderer.isEditing()) return;
      // Skip if in modal/search input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      const key = e.key;
      const ctrl = e.ctrlKey || e.metaKey;

      if (key === 'Enter') {
        e.preventDefault();
        addChildToSelected();
      } else if (key === 'Tab') {
        e.preventDefault();
        addSiblingToSelected();
      } else if (key === 'Delete' || key === 'Backspace') {
        e.preventDefault();
        deleteSelected();
      } else if (ctrl && key === 'z') {
        e.preventDefault();
        History.undo();
      } else if (ctrl && (key === 'y' || (e.shiftKey && key === 'z'))) {
        e.preventDefault();
        History.redo();
      } else if (ctrl && key === 'f') {
        e.preventDefault();
        toggleSearch();
      } else if (key === 'F2') {
        e.preventDefault();
        const selectedId = Renderer.getSelectedNodeId();
        if (selectedId) Renderer.startEditing(selectedId);
      } else if (key === 'Escape') {
        closeSearch();
        Renderer.selectNode(null);
        Renderer.closeAllPickers();
      } else if (key === '+' || key === '=') {
        if (ctrl) { e.preventDefault(); Renderer.zoomIn(); }
      } else if (key === '-') {
        if (ctrl) { e.preventDefault(); Renderer.zoomOut(); }
      } else if (key === '0' && ctrl) {
        e.preventDefault();
        Renderer.fitView();
      }
    });
  }

  // ===== Search =====

  let searchOpen = false;

  function initSearch() {
    const overlay = document.getElementById('search-overlay');
    const input = document.getElementById('search-input');
    const closeBtn = document.getElementById('search-close');
    const resultsDiv = document.getElementById('search-results');
    const countSpan = document.getElementById('search-count');

    input.addEventListener('input', Utils.debounce(() => {
      const query = input.value.trim().toLowerCase();
      if (!query) {
        resultsDiv.innerHTML = '';
        countSpan.textContent = '';
        Renderer.clearSearchHighlight();
        return;
      }

      const allNodes = MindMap.getAllNodes();
      const matches = Object.values(allNodes).filter(n =>
        n.text.toLowerCase().includes(query)
      );

      countSpan.textContent = `${matches.length} found`;
      Renderer.highlightSearchResults(matches.map(n => n.id));

      resultsDiv.innerHTML = '';
      matches.forEach(node => {
        const item = document.createElement('div');
        item.className = 'search-result-item';
        item.textContent = (node.emoji ? node.emoji + ' ' : '') + node.text;
        item.addEventListener('click', () => {
          Renderer.selectNode(node.id);
          Renderer.centerOnNode(node.id);
        });
        resultsDiv.appendChild(item);
      });
    }, 200));

    closeBtn.addEventListener('click', closeSearch);

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeSearch();
    });
  }

  function toggleSearch() {
    const overlay = document.getElementById('search-overlay');
    if (searchOpen) {
      closeSearch();
    } else {
      overlay.classList.remove('hidden');
      searchOpen = true;
      document.getElementById('search-input').focus();
    }
  }

  function closeSearch() {
    const overlay = document.getElementById('search-overlay');
    overlay.classList.add('hidden');
    searchOpen = false;
    document.getElementById('search-input').value = '';
    document.getElementById('search-results').innerHTML = '';
    document.getElementById('search-count').textContent = '';
    Renderer.clearSearchHighlight();
  }

  // ===== Minimap =====

  function initMinimap() {
    const canvas = document.getElementById('minimap-canvas');
    const ctx = canvas.getContext('2d');
    const minimapEl = document.getElementById('minimap');
    const viewportRect = document.getElementById('minimap-viewport-rect');

    function draw() {
      const allNodes = MindMap.getAllNodes();
      const nodeList = Object.values(allNodes);
      if (nodeList.length === 0) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      // Compute bounds
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      nodeList.forEach(n => {
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + MindMap.NODE_WIDTH);
        maxY = Math.max(maxY, n.y + MindMap.NODE_HEIGHT);
      });

      const pad = 40;
      const contentW = maxX - minX + pad * 2;
      const contentH = maxY - minY + pad * 2;
      const scaleX = canvas.width / contentW;
      const scaleY = canvas.height / contentH;
      const s = Math.min(scaleX, scaleY);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw connections
      ctx.strokeStyle = 'var(--connection-color)';
      ctx.lineWidth = 0.5;
      nodeList.forEach(node => {
        if (node.collapsed) return;
        node.children.forEach(childId => {
          const child = allNodes[childId];
          if (!child) return;
          ctx.beginPath();
          ctx.moveTo((node.x - minX + pad + MindMap.NODE_WIDTH) * s, (node.y - minY + pad + MindMap.NODE_HEIGHT / 2) * s);
          ctx.lineTo((child.x - minX + pad) * s, (child.y - minY + pad + MindMap.NODE_HEIGHT / 2) * s);
          ctx.stroke();
        });
      });

      // Draw nodes
      nodeList.forEach(n => {
        const nx = (n.x - minX + pad) * s;
        const ny = (n.y - minY + pad) * s;
        const nw = MindMap.NODE_WIDTH * s;
        const nh = MindMap.NODE_HEIGHT * s;

        ctx.fillStyle = n.color || '#6366f1';
        ctx.globalAlpha = n.id === Renderer.getSelectedNodeId() ? 1 : 0.6;
        ctx.beginPath();
        ctx.roundRect(nx, ny, Math.max(nw, 2), Math.max(nh, 2), 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;

      // Draw viewport rectangle
      const viewportEl = document.getElementById('canvas-viewport');
      const viewRect = viewportEl.getBoundingClientRect();
      const pan = Renderer.getPan();
      const zoom = Renderer.getScale();

      const vx = (-pan.x / zoom - minX + pad) * s;
      const vy = (-pan.y / zoom - minY + pad) * s;
      const vw = (viewRect.width / zoom) * s;
      const vh = (viewRect.height / zoom) * s;

      viewportRect.style.left = Math.max(0, vx) + 'px';
      viewportRect.style.top = Math.max(0, vy) + 'px';
      viewportRect.style.width = Math.min(vw, canvas.width) + 'px';
      viewportRect.style.height = Math.min(vh, canvas.height) + 'px';
    }

    // Click minimap to navigate
    minimapEl.addEventListener('click', (e) => {
      // TODO: calculate world position from click and pan there
    });

    // Redraw on changes
    Utils.bus.on('viewport:changed', Utils.throttle(draw, 100));
    Utils.bus.on('tree:layoutChanged', draw);
    Utils.bus.on('node:added', draw);
    Utils.bus.on('node:deleted', draw);
    Utils.bus.on('node:moved', Utils.throttle(draw, 100));
    Utils.bus.on('selection:changed', draw);

    // Initial draw after a tick
    requestAnimationFrame(draw);
  }

  // ===== Zoom Level Display =====

  function initZoomDisplay() {
    Utils.bus.on('zoom:changed', (scale) => {
      document.getElementById('zoom-level').textContent = Math.round(scale * 100) + '%';
    });
  }

  // ===== Modal Helpers =====

  function openModal(modal) {
    modal.classList.remove('hidden');
  }

  function closeModal(modal) {
    modal.classList.add('hidden');
  }

  // ===== Share Modal =====

  function showShareModal() {
    const modal = document.getElementById('share-modal');
    const roomId = Collaboration.getRoomId();

    if (!roomId) {
      Utils.showToast('No active collaboration session');
      return;
    }

    const roomUrl = window.location.origin + window.location.pathname + '?room=' + roomId;

    document.getElementById('share-room-code').value = roomId;
    document.getElementById('share-link').value = roomUrl;

    // Generate QR code
    const qrDiv = document.getElementById('qr-code');
    qrDiv.innerHTML = '';
    if (typeof QRCode !== 'undefined') {
      new QRCode(qrDiv, {
        text: roomUrl,
        width: 160,
        height: 160,
        colorDark: '#1a1a2e',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M,
      });
    }

    // Copy buttons
    document.getElementById('btn-copy-code').onclick = () => {
      navigator.clipboard.writeText(roomId).then(() => Utils.showToast('Room code copied!'));
    };
    document.getElementById('btn-copy-link').onclick = () => {
      navigator.clipboard.writeText(roomUrl).then(() => Utils.showToast('Link copied!'));
    };

    openModal(modal);

    // Close events
    modal.querySelector('.modal-backdrop').addEventListener('click', () => closeModal(modal));
    modal.querySelector('.modal-close').addEventListener('click', () => closeModal(modal));
  }

  // ===== Initialize All UI =====

  function init() {
    initTheme();
    initToolbar();
    initKeyboardShortcuts();
    initSearch();
    initMinimap();
    initZoomDisplay();
  }

  return { init, showShareModal, addChildToSelected, addSiblingToSelected, deleteSelected };
})();
