/**
 * renderer.js — Renders mind map nodes as DOM elements, draws SVG connections,
 * handles drag-and-drop, inline text editing, and canvas pan/zoom.
 */

const Renderer = (() => {
  // DOM references
  let viewport, world, nodesLayer, connectionsLayer;

  // Pan & zoom state
  let pan = { x: 0, y: 0 };
  let scale = 1;
  const MIN_SCALE = 0.15;
  const MAX_SCALE = 3;

  // Drag state
  let isDragging = false;
  let isPanning = false;
  let dragNodeId = null;
  let dragStart = { x: 0, y: 0 };
  let dragNodeStart = { x: 0, y: 0 };
  let panStart = { x: 0, y: 0 };
  let panStartMouse = { x: 0, y: 0 };

  // Track rendered node elements
  const nodeElements = {};

  // Currently selected node
  let selectedNodeId = null;

  // Editing state
  let editingNodeId = null;

  function init() {
    viewport = document.getElementById('canvas-viewport');
    world = document.getElementById('canvas-world');
    nodesLayer = document.getElementById('nodes-layer');
    connectionsLayer = document.getElementById('connections-layer');

    setupPanZoom();
    setupEventListeners();
  }

  // ===== PAN & ZOOM =====

  function setupPanZoom() {
    // Mouse wheel zoom
    viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.08 : 0.08;
      const newScale = Utils.clamp(scale + delta * scale, MIN_SCALE, MAX_SCALE);

      // Zoom toward cursor
      const rect = viewport.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      pan.x = mouseX - (mouseX - pan.x) * (newScale / scale);
      pan.y = mouseY - (mouseY - pan.y) * (newScale / scale);
      scale = newScale;

      applyTransform();
      Utils.bus.emit('zoom:changed', scale);
    }, { passive: false });

    // Pan via mouse drag on empty canvas
    viewport.addEventListener('mousedown', (e) => {
      if (e.target !== viewport && e.target !== world &&
          e.target !== connectionsLayer && e.target !== nodesLayer) return;
      if (e.button !== 0) return;

      isPanning = true;
      panStart = { x: pan.x, y: pan.y };
      panStartMouse = { x: e.clientX, y: e.clientY };
      viewport.classList.add('grabbing');
      e.preventDefault();
    });

    // Touch support for mobile
    let lastTouchDist = 0;
    let lastTouchCenter = { x: 0, y: 0 };

    viewport.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        if (e.target === viewport || e.target === world ||
            e.target === connectionsLayer || e.target === nodesLayer) {
          isPanning = true;
          panStart = { x: pan.x, y: pan.y };
          panStartMouse = { x: touch.clientX, y: touch.clientY };
        }
      } else if (e.touches.length === 2) {
        // Pinch to zoom
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lastTouchDist = Math.hypot(dx, dy);
        lastTouchCenter = {
          x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
          y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        };
      }
    }, { passive: true });

    viewport.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1 && isPanning) {
        const touch = e.touches[0];
        pan.x = panStart.x + (touch.clientX - panStartMouse.x);
        pan.y = panStart.y + (touch.clientY - panStartMouse.y);
        applyTransform();
      } else if (e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const center = {
          x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
          y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        };

        const ratio = dist / lastTouchDist;
        const newScale = Utils.clamp(scale * ratio, MIN_SCALE, MAX_SCALE);

        const rect = viewport.getBoundingClientRect();
        const mx = center.x - rect.left;
        const my = center.y - rect.top;
        pan.x = mx - (mx - pan.x) * (newScale / scale);
        pan.y = my - (my - pan.y) * (newScale / scale);
        scale = newScale;

        lastTouchDist = dist;
        lastTouchCenter = center;
        applyTransform();
        Utils.bus.emit('zoom:changed', scale);
      }
    }, { passive: false });

    viewport.addEventListener('touchend', () => {
      isPanning = false;
    });
  }

  function setupEventListeners() {
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    // Click on empty canvas deselects
    viewport.addEventListener('click', (e) => {
      if (e.target === viewport || e.target === world ||
          e.target === connectionsLayer || e.target === nodesLayer) {
        selectNode(null);
        closeAllPickers();
      }
    });
  }

  function onMouseMove(e) {
    if (isPanning) {
      pan.x = panStart.x + (e.clientX - panStartMouse.x);
      pan.y = panStart.y + (e.clientY - panStartMouse.y);
      applyTransform();
      return;
    }

    if (isDragging && dragNodeId) {
      const dx = (e.clientX - dragStart.x) / scale;
      const dy = (e.clientY - dragStart.y) / scale;
      const newX = dragNodeStart.x + dx;
      const newY = dragNodeStart.y + dy;

      // Update DOM position immediately for responsiveness
      const el = nodeElements[dragNodeId];
      if (el) {
        el.style.left = newX + 'px';
        el.style.top = newY + 'px';
      }

      // Update connections
      const node = MindMap.getNode(dragNodeId);
      if (node) {
        node.x = newX;
        node.y = newY;
        redrawConnectionsForNode(dragNodeId);
      }
    }
  }

  function onMouseUp(e) {
    if (isPanning) {
      isPanning = false;
      viewport.classList.remove('grabbing');
      return;
    }

    if (isDragging && dragNodeId) {
      const el = nodeElements[dragNodeId];
      if (el) el.classList.remove('dragging');
      viewport.classList.remove('node-dragging');

      const node = MindMap.getNode(dragNodeId);
      if (node) {
        // Emit move event for history & sync
        Utils.bus.emit('node:dragEnd', {
          id: dragNodeId,
          fromX: dragNodeStart.x,
          fromY: dragNodeStart.y,
          toX: node.x,
          toY: node.y,
        });
      }

      isDragging = false;
      dragNodeId = null;
    }
  }

  function applyTransform() {
    world.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${scale})`;
    Utils.bus.emit('viewport:changed', { pan, scale });
  }

  // ===== RENDER ALL =====

  function renderAll() {
    // Clear existing
    nodesLayer.innerHTML = '';
    connectionsLayer.innerHTML = '';
    Object.keys(nodeElements).forEach(k => delete nodeElements[k]);

    const allNodes = MindMap.getAllNodes();
    const rootId = MindMap.getRootId();

    // Render nodes (root first, then depth-first)
    if (rootId && allNodes[rootId]) {
      renderNodeRecursive(rootId, allNodes);
    }

    // Draw connections after a frame so DOM has laid out and offsetWidth is available
    requestAnimationFrame(() => {
      drawAllConnections();
    });
  }

  function renderNodeRecursive(nodeId, allNodes) {
    const node = allNodes[nodeId];
    if (!node) return;

    renderNode(node);

    if (!node.collapsed) {
      node.children.forEach(childId => {
        renderNodeRecursive(childId, allNodes);
      });
    }
  }

  // ===== RENDER SINGLE NODE =====

  function renderNode(node) {
    // Remove existing element if any
    if (nodeElements[node.id]) {
      nodeElements[node.id].remove();
    }

    const el = document.createElement('div');
    el.className = 'mm-node';
    el.dataset.nodeId = node.id;
    el.style.left = node.x + 'px';
    el.style.top = node.y + 'px';
    el.style.borderColor = node.color;

    // Shape class
    if (node.shape && node.shape !== 'rounded') {
      el.classList.add('shape-' + node.shape);
    }

    // Root styling
    if (!node.parentId) {
      el.classList.add('root-node');
      el.style.background = node.color + '22';
    }

    // Selected state
    if (node.id === selectedNodeId) {
      el.classList.add('selected');
    }

    // Collapsed state
    if (node.collapsed) {
      el.classList.add('collapsed');
    }

    // Emoji
    if (node.emoji) {
      const emojiSpan = document.createElement('span');
      emojiSpan.className = 'node-emoji';
      emojiSpan.textContent = node.emoji;
      el.appendChild(emojiSpan);
    }

    // Text
    const textSpan = document.createElement('span');
    textSpan.className = 'node-text';
    textSpan.textContent = node.text;
    el.appendChild(textSpan);

    // Collapse button (only if has children)
    if (node.children.length > 0) {
      const collapseBtn = document.createElement('button');
      collapseBtn.className = 'collapse-btn';
      const count = MindMap.getDescendantCount(node.id);
      collapseBtn.textContent = node.collapsed ? `+${count}` : '−';
      collapseBtn.title = node.collapsed ? `Expand (${count} nodes)` : 'Collapse';
      collapseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        MindMap.toggleCollapse(node.id);
        MindMap.autoLayout();
        renderAll();
      });
      el.appendChild(collapseBtn);
    }

    // Event: click to select
    el.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('collapse-btn')) return;
      if (editingNodeId === node.id) return;

      e.stopPropagation();
      selectNode(node.id);

      // Start drag
      isDragging = true;
      dragNodeId = node.id;
      dragStart = { x: e.clientX, y: e.clientY };
      dragNodeStart = { x: node.x, y: node.y };
      el.classList.add('dragging');
      viewport.classList.add('node-dragging');
    });

    // Event: double-click to edit text
    el.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startEditing(node.id);
    });

    // Touch support for drag
    el.addEventListener('touchstart', (e) => {
      if (e.target.classList.contains('collapse-btn')) return;
      if (editingNodeId === node.id) return;
      e.stopPropagation();
      selectNode(node.id);

      const touch = e.touches[0];
      isDragging = true;
      dragNodeId = node.id;
      dragStart = { x: touch.clientX, y: touch.clientY };
      dragNodeStart = { x: node.x, y: node.y };
      el.classList.add('dragging');
    }, { passive: true });

    el.addEventListener('touchmove', (e) => {
      if (!isDragging || dragNodeId !== node.id) return;
      e.preventDefault();
      const touch = e.touches[0];
      const dx = (touch.clientX - dragStart.x) / scale;
      const dy = (touch.clientY - dragStart.y) / scale;
      const newX = dragNodeStart.x + dx;
      const newY = dragNodeStart.y + dy;

      el.style.left = newX + 'px';
      el.style.top = newY + 'px';
      node.x = newX;
      node.y = newY;
      redrawConnectionsForNode(node.id);
    }, { passive: false });

    el.addEventListener('touchend', () => {
      if (isDragging && dragNodeId === node.id) {
        el.classList.remove('dragging');
        Utils.bus.emit('node:dragEnd', {
          id: node.id,
          fromX: dragNodeStart.x,
          fromY: dragNodeStart.y,
          toX: node.x,
          toY: node.y,
        });
        isDragging = false;
        dragNodeId = null;
      }
    });

    nodesLayer.appendChild(el);
    nodeElements[node.id] = el;
  }

  // ===== INLINE TEXT EDITING =====

  function startEditing(nodeId) {
    if (editingNodeId) stopEditing(editingNodeId);

    const el = nodeElements[nodeId];
    if (!el) return;

    editingNodeId = nodeId;
    const textSpan = el.querySelector('.node-text');
    const node = MindMap.getNode(nodeId);
    const oldText = node.text;

    textSpan.contentEditable = 'true';
    textSpan.focus();

    // Select all text
    const range = document.createRange();
    range.selectNodeContents(textSpan);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    function onBlur() {
      commitEdit(nodeId, textSpan, oldText);
      cleanup();
    }

    function onKeyDown(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        textSpan.blur();
      } else if (e.key === 'Escape') {
        textSpan.textContent = oldText;
        textSpan.blur();
      }
      e.stopPropagation(); // prevent keyboard shortcuts during editing
    }

    function cleanup() {
      textSpan.removeEventListener('blur', onBlur);
      textSpan.removeEventListener('keydown', onKeyDown);
      textSpan.contentEditable = 'false';
      editingNodeId = null;
    }

    textSpan.addEventListener('blur', onBlur);
    textSpan.addEventListener('keydown', onKeyDown);
  }

  function commitEdit(nodeId, textSpan, oldText) {
    const newText = textSpan.textContent.trim() || 'Untitled';
    if (newText !== oldText) {
      MindMap.updateNode(nodeId, { text: newText });
      Utils.bus.emit('node:textEdited', { id: nodeId, oldText, newText });
    }
  }

  function stopEditing(nodeId) {
    const el = nodeElements[nodeId];
    if (!el) return;
    const textSpan = el.querySelector('.node-text');
    if (textSpan) {
      textSpan.contentEditable = 'false';
      textSpan.blur();
    }
    editingNodeId = null;
  }

  // ===== SELECTION =====

  function selectNode(nodeId) {
    // Deselect previous
    if (selectedNodeId && nodeElements[selectedNodeId]) {
      nodeElements[selectedNodeId].classList.remove('selected');
    }

    selectedNodeId = nodeId;

    // Select new
    if (nodeId && nodeElements[nodeId]) {
      nodeElements[nodeId].classList.add('selected');
    }

    Utils.bus.emit('selection:changed', nodeId);
  }

  function getSelectedNodeId() { return selectedNodeId; }

  // ===== SVG CONNECTIONS =====

  function drawAllConnections() {
    connectionsLayer.innerHTML = '';

    // Add SVG defs for arrow markers
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `
      <marker id="arrowhead" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto" markerUnits="userSpaceOnUse">
        <polygon points="0 0, 10 4, 0 8" fill="var(--connection-color)" />
      </marker>
    `;
    connectionsLayer.appendChild(defs);

    const allNodes = MindMap.getAllNodes();

    Object.values(allNodes).forEach(node => {
      if (!node.children || node.collapsed) return;
      node.children.forEach(childId => {
        const child = allNodes[childId];
        if (child) {
          drawConnection(node, child);
        }
      });
    });
  }

  function drawConnection(parent, child) {
    const SVG_NS = 'http://www.w3.org/2000/svg';

    const pEl = nodeElements[parent.id];
    const cEl = nodeElements[child.id];
    const pw = pEl ? pEl.offsetWidth : MindMap.NODE_WIDTH;
    const ph = pEl ? pEl.offsetHeight : MindMap.NODE_HEIGHT;
    const ch = cEl ? cEl.offsetHeight : MindMap.NODE_HEIGHT;

    const x1 = parent.x + pw;
    const y1 = parent.y + ph / 2;
    const x2 = child.x;
    const y2 = child.y + ch / 2;

    // Use CSS variable for connection color (white in dark mode, dark in light)
    // Draw the curved path
    const path = document.createElementNS(SVG_NS, 'path');
    path.id = `conn-${parent.id}-${child.id}`;

    const cx = (x1 + x2) / 2;
    path.setAttribute('d', `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-linecap', 'round');

    // Highlight if selected
    if (child.id === selectedNodeId || parent.id === selectedNodeId) {
      path.classList.add('highlight');
    }

    connectionsLayer.appendChild(path);

    // Draw arrowhead as a small triangle at the end
    const arrowSize = 8;
    const ax = x2 - arrowSize;
    const ay1 = y2 - arrowSize * 0.6;
    const ay2 = y2 + arrowSize * 0.6;

    const arrow = document.createElementNS(SVG_NS, 'polygon');
    arrow.id = `arrow-${parent.id}-${child.id}`;
    arrow.setAttribute('points', `${x2},${y2} ${ax},${ay1} ${ax},${ay2}`);
    arrow.setAttribute('class', 'arrow-marker');
    connectionsLayer.appendChild(arrow);
  }

  function redrawConnectionsForNode() {
    drawAllConnections();
  }

  // ===== VIEW CONTROLS =====

  function zoomTo(newScale) {
    const rect = viewport.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;

    newScale = Utils.clamp(newScale, MIN_SCALE, MAX_SCALE);
    pan.x = cx - (cx - pan.x) * (newScale / scale);
    pan.y = cy - (cy - pan.y) * (newScale / scale);
    scale = newScale;
    applyTransform();
    Utils.bus.emit('zoom:changed', scale);
  }

  function zoomIn() { zoomTo(scale * 1.2); }
  function zoomOut() { zoomTo(scale / 1.2); }

  function fitView() {
    const allNodes = MindMap.getAllNodes();
    const nodeList = Object.values(allNodes);
    if (nodeList.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodeList.forEach(n => {
      const el = nodeElements[n.id];
      const w = el ? el.offsetWidth : MindMap.NODE_WIDTH;
      const h = el ? el.offsetHeight : MindMap.NODE_HEIGHT;
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + w);
      maxY = Math.max(maxY, n.y + h);
    });

    const padding = 80;
    const rect = viewport.getBoundingClientRect();
    const contentW = maxX - minX + padding * 2;
    const contentH = maxY - minY + padding * 2;

    scale = Math.min(
      rect.width / contentW,
      rect.height / contentH,
      1.5
    );
    scale = Utils.clamp(scale, MIN_SCALE, MAX_SCALE);

    pan.x = (rect.width - contentW * scale) / 2 - minX * scale + padding * scale;
    pan.y = (rect.height - contentH * scale) / 2 - minY * scale + padding * scale;

    applyTransform();
    Utils.bus.emit('zoom:changed', scale);
  }

  function centerOnNode(nodeId) {
    const node = MindMap.getNode(nodeId);
    if (!node) return;

    const rect = viewport.getBoundingClientRect();
    const el = nodeElements[nodeId];
    const w = el ? el.offsetWidth : MindMap.NODE_WIDTH;
    const h = el ? el.offsetHeight : MindMap.NODE_HEIGHT;

    pan.x = rect.width / 2 - (node.x + w / 2) * scale;
    pan.y = rect.height / 2 - (node.y + h / 2) * scale;
    applyTransform();
  }

  // ===== UPDATE SINGLE NODE DOM =====

  function updateNodeElement(nodeId) {
    const node = MindMap.getNode(nodeId);
    if (!node) return;
    renderNode(node);
    drawAllConnections();
  }

  // ===== SEARCH HIGHLIGHTING =====

  function highlightSearchResults(matchIds) {
    Object.values(nodeElements).forEach(el => {
      el.classList.remove('search-match', 'search-dimmed');
    });

    if (!matchIds || matchIds.length === 0) return;

    const matchSet = new Set(matchIds);
    Object.entries(nodeElements).forEach(([id, el]) => {
      if (matchSet.has(id)) {
        el.classList.add('search-match');
      } else {
        el.classList.add('search-dimmed');
      }
    });
  }

  function clearSearchHighlight() {
    Object.values(nodeElements).forEach(el => {
      el.classList.remove('search-match', 'search-dimmed');
    });
  }

  // ===== Remote user selection indicator =====

  function setRemoteSelection(nodeId, show) {
    const el = nodeElements[nodeId];
    if (!el) return;
    if (show) {
      el.classList.add('remote-selected');
    } else {
      el.classList.remove('remote-selected');
    }
  }

  // ===== Getters =====

  function getScale() { return scale; }
  function getPan() { return { ...pan }; }
  function getNodeElement(id) { return nodeElements[id]; }
  function isEditing() { return editingNodeId !== null; }

  // Close any open color/shape pickers
  function closeAllPickers() {
    document.getElementById('color-palette')?.classList.add('hidden');
    document.getElementById('shape-palette')?.classList.add('hidden');
  }

  return {
    init,
    renderAll,
    renderNode,
    updateNodeElement,
    drawAllConnections,
    selectNode,
    getSelectedNodeId,
    startEditing,
    zoomIn,
    zoomOut,
    zoomTo,
    fitView,
    centerOnNode,
    highlightSearchResults,
    clearSearchHighlight,
    setRemoteSelection,
    getScale,
    getPan,
    getNodeElement,
    isEditing,
    applyTransform,
    closeAllPickers,
  };
})();
