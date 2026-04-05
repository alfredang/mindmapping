/**
 * history.js — Undo/redo system using command pattern with full state snapshots.
 */

const History = (() => {
  const undoStack = [];
  const redoStack = [];
  const MAX_HISTORY = 50;

  // Save a snapshot before a mutation
  function pushState(label = '') {
    const snapshot = MindMap.toJSON();
    undoStack.push({ label, snapshot });
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    // Any new action clears the redo stack
    redoStack.length = 0;
    updateButtons();
  }

  function undo() {
    if (undoStack.length === 0) return;
    // Save current state to redo
    redoStack.push({
      label: 'redo',
      snapshot: MindMap.toJSON(),
    });

    const entry = undoStack.pop();
    MindMap.fromJSON(entry.snapshot);
    Renderer.renderAll();
    Renderer.drawAllConnections();
    updateButtons();
    Utils.bus.emit('history:undo');
  }

  function redo() {
    if (redoStack.length === 0) return;
    // Save current state to undo
    undoStack.push({
      label: 'undo',
      snapshot: MindMap.toJSON(),
    });

    const entry = redoStack.pop();
    MindMap.fromJSON(entry.snapshot);
    Renderer.renderAll();
    Renderer.drawAllConnections();
    updateButtons();
    Utils.bus.emit('history:redo');
  }

  function canUndo() { return undoStack.length > 0; }
  function canRedo() { return redoStack.length > 0; }

  function updateButtons() {
    const undoBtn = document.getElementById('tool-undo');
    const redoBtn = document.getElementById('tool-redo');
    if (undoBtn) undoBtn.disabled = !canUndo();
    if (redoBtn) redoBtn.disabled = !canRedo();
  }

  function clear() {
    undoStack.length = 0;
    redoStack.length = 0;
    updateButtons();
  }

  return { pushState, undo, redo, canUndo, canRedo, clear, updateButtons };
})();
