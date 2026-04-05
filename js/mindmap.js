/**
 * mindmap.js — Pure data model for the mind map tree.
 * Stores nodes as a flat map. Provides CRUD operations and auto-layout.
 */

const MindMap = (() => {
  // Flat map of all nodes: { [id]: Node }
  let nodes = {};
  let rootId = null;

  // Layout constants
  const H_SPACING = 180;  // horizontal gap between parent right edge and child left edge
  const V_GAP = 18;       // vertical gap between siblings
  const NODE_HEIGHT = 44;  // estimated default node height
  const NODE_WIDTH = 160;  // estimated default node width

  // ===== Node Factory =====
  function createNodeData(text, parentId = null, extras = {}) {
    const id = Utils.generateId();
    return {
      id,
      parentId,
      text,
      x: 0,
      y: 0,
      color: extras.color || '#6366f1',
      shape: extras.shape || 'rounded',
      emoji: extras.emoji || null,
      collapsed: false,
      children: [],
      createdBy: extras.createdBy || 'local',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  // ===== CRUD Operations =====

  function addNode(text, parentId, extras = {}) {
    const node = createNodeData(text, parentId, extras);

    if (!parentId) {
      // Root node
      rootId = node.id;
    } else {
      // Add as child of parent
      const parent = nodes[parentId];
      if (parent) {
        parent.children.push(node.id);
        parent.updatedAt = Date.now();
      }
    }

    nodes[node.id] = node;
    Utils.bus.emit('node:added', node);
    return node;
  }

  function addSibling(referenceId, text, extras = {}) {
    const ref = nodes[referenceId];
    if (!ref || !ref.parentId) return null; // can't add sibling to root

    const parent = nodes[ref.parentId];
    const node = createNodeData(text, ref.parentId, extras);
    nodes[node.id] = node;

    // Insert right after the reference node
    const idx = parent.children.indexOf(referenceId);
    parent.children.splice(idx + 1, 0, node.id);
    parent.updatedAt = Date.now();

    Utils.bus.emit('node:added', node);
    return node;
  }

  function deleteNode(nodeId) {
    const node = nodes[nodeId];
    if (!node) return;
    if (nodeId === rootId) return; // don't delete root

    // Recursively collect all descendant IDs
    const toDelete = [];
    function collect(id) {
      toDelete.push(id);
      const n = nodes[id];
      if (n && n.children) {
        n.children.forEach(collect);
      }
    }
    collect(nodeId);

    // Remove from parent's children array
    const parent = nodes[node.parentId];
    if (parent) {
      parent.children = parent.children.filter(cid => cid !== nodeId);
      parent.updatedAt = Date.now();
    }

    // Delete all collected nodes
    toDelete.forEach(id => {
      const deleted = nodes[id];
      delete nodes[id];
      Utils.bus.emit('node:deleted', { id, node: deleted });
    });

    return toDelete;
  }

  function updateNode(nodeId, updates) {
    const node = nodes[nodeId];
    if (!node) return;
    Object.assign(node, updates, { updatedAt: Date.now() });
    Utils.bus.emit('node:updated', node);
    return node;
  }

  function moveNode(nodeId, x, y) {
    const node = nodes[nodeId];
    if (!node) return;
    node.x = x;
    node.y = y;
    node.updatedAt = Date.now();
    Utils.bus.emit('node:moved', node);
    return node;
  }

  function toggleCollapse(nodeId) {
    const node = nodes[nodeId];
    if (!node || node.children.length === 0) return;
    node.collapsed = !node.collapsed;
    node.updatedAt = Date.now();
    Utils.bus.emit('node:updated', node);
    return node;
  }

  // ===== Queries =====

  function getNode(id) { return nodes[id]; }
  function getRoot() { return nodes[rootId]; }
  function getRootId() { return rootId; }
  function getAllNodes() { return nodes; }

  function getChildren(nodeId) {
    const node = nodes[nodeId];
    if (!node) return [];
    return node.children.map(cid => nodes[cid]).filter(Boolean);
  }

  function getVisibleChildren(nodeId) {
    const node = nodes[nodeId];
    if (!node || node.collapsed) return [];
    return node.children.map(cid => nodes[cid]).filter(Boolean);
  }

  function getDescendantCount(nodeId) {
    const node = nodes[nodeId];
    if (!node) return 0;
    let count = 0;
    function walk(id) {
      const n = nodes[id];
      if (!n) return;
      count += n.children.length;
      n.children.forEach(walk);
    }
    walk(nodeId);
    return count;
  }

  // ===== Auto Layout (layered tree, left-to-right) =====

  function autoLayout() {
    if (!rootId || !nodes[rootId]) return;

    const root = nodes[rootId];
    // Place root at left-center of viewport
    const viewH = window.innerHeight;
    root.x = 100;
    root.y = viewH / 2;

    // Recursively layout children
    layoutSubtree(rootId, root.x + NODE_WIDTH + H_SPACING / 2);

    Utils.bus.emit('tree:layoutChanged');
  }

  function layoutSubtree(parentId, startX) {
    const parent = nodes[parentId];
    if (!parent) return;

    const visibleChildren = getVisibleChildren(parentId);
    if (visibleChildren.length === 0) return;

    // First, compute subtree heights bottom-up
    const heights = {};
    function computeHeight(nodeId) {
      const node = nodes[nodeId];
      if (!node) return NODE_HEIGHT;
      const children = getVisibleChildren(nodeId);
      if (children.length === 0) {
        heights[nodeId] = NODE_HEIGHT;
        return NODE_HEIGHT;
      }
      let total = 0;
      children.forEach(child => {
        total += computeHeight(child.id);
      });
      total += (children.length - 1) * V_GAP;
      heights[nodeId] = Math.max(total, NODE_HEIGHT);
      return heights[nodeId];
    }

    // Compute heights for each child subtree
    let totalHeight = 0;
    visibleChildren.forEach(child => {
      computeHeight(child.id);
      totalHeight += heights[child.id];
    });
    totalHeight += (visibleChildren.length - 1) * V_GAP;

    // Position children vertically centered around parent
    const parentCenterY = parent.y + NODE_HEIGHT / 2;
    let yOffset = parentCenterY - totalHeight / 2;

    visibleChildren.forEach(child => {
      const subtreeH = heights[child.id];
      child.x = startX;
      child.y = yOffset + subtreeH / 2 - NODE_HEIGHT / 2;
      child.updatedAt = Date.now();
      yOffset += subtreeH + V_GAP;

      // Recurse into children
      layoutSubtree(child.id, startX + NODE_WIDTH + H_SPACING);
    });
  }

  // ===== Serialization =====

  function toJSON() {
    return {
      rootId,
      nodes: Utils.deepClone(nodes),
    };
  }

  function fromJSON(data) {
    nodes = data.nodes || {};
    rootId = data.rootId || null;
    Utils.bus.emit('tree:layoutChanged');
  }

  // Set a single node from external data (for Firebase sync).
  // Firebase strips empty arrays, so we must ensure children is always an array.
  function setNode(id, nodeData) {
    nodeData.children = nodeData.children || [];
    nodeData.collapsed = nodeData.collapsed || false;
    nodeData.emoji = nodeData.emoji || null;
    nodes[id] = nodeData;
    if (!nodeData.parentId) rootId = id;
  }

  function removeNode(id) {
    delete nodes[id];
  }

  function clear() {
    nodes = {};
    rootId = null;
  }

  // ===== Starter Data =====

  function createStarterMap() {
    clear();
    const root = addNode('My Mind Map', null, { color: '#6366f1' });

    const idea1 = addNode('Ideas', root.id, { color: '#8b5cf6', emoji: '💡' });
    addNode('Brainstorm topics', idea1.id, { color: '#8b5cf6' });
    addNode('Research trends', idea1.id, { color: '#8b5cf6' });

    const tasks = addNode('Tasks', root.id, { color: '#22c55e', emoji: '✅' });
    addNode('Create outline', tasks.id, { color: '#22c55e' });
    addNode('Set deadlines', tasks.id, { color: '#22c55e' });

    const resources = addNode('Resources', root.id, { color: '#f97316', emoji: '📚' });
    addNode('Documentation', resources.id, { color: '#f97316' });
    addNode('References', resources.id, { color: '#f97316' });

    autoLayout();
    return root;
  }

  return {
    addNode,
    addSibling,
    deleteNode,
    updateNode,
    moveNode,
    toggleCollapse,
    getNode,
    getRoot,
    getRootId,
    getAllNodes,
    getChildren,
    getVisibleChildren,
    getDescendantCount,
    autoLayout,
    toJSON,
    fromJSON,
    setNode,
    removeNode,
    clear,
    createStarterMap,
    // Expose constants for renderer
    NODE_HEIGHT,
    NODE_WIDTH,
    H_SPACING,
  };
})();
