/**
 * app.js — Entry point. Initializes all modules, handles view switching,
 * wires up event listeners between modules, manages local auto-save.
 */

const App = (() => {
  let currentRoomId = null;
  let isOfflineMode = false;

  // ===== Initialization =====

  function init() {
    // Initialize collaboration (checks Firebase config)
    const firebaseReady = Collaboration.init();

    // Initialize renderer
    Renderer.init();

    // Initialize UI (toolbar, theme, keyboard shortcuts, search, minimap)
    UI.init();

    // Wire up cross-module events
    wireEvents();

    // Check URL for room parameter
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');

    if (roomParam) {
      // Auto-join room from URL
      joinRoom(roomParam);
    } else {
      // Show landing screen
      showLanding();
    }

    // Setup landing screen buttons
    setupLandingButtons();

    // Auto-save timer
    setupAutoSave();
  }

  // ===== View Switching =====

  function showLanding() {
    document.getElementById('landing-screen').classList.add('active');
    document.getElementById('workspace-screen').classList.remove('active');
  }

  function showWorkspace() {
    document.getElementById('landing-screen').classList.remove('active');
    document.getElementById('workspace-screen').classList.add('active');
  }

  // ===== Landing Buttons =====

  function setupLandingButtons() {
    // Create new mind map
    document.getElementById('btn-create').addEventListener('click', () => {
      const name = document.getElementById('new-map-name').value.trim() || 'Untitled Mind Map';
      createNewMap(name);
    });

    // Join room
    document.getElementById('btn-join').addEventListener('click', () => {
      const code = document.getElementById('join-room-code').value.trim();
      if (!code) {
        Utils.showToast('Please enter a room code');
        return;
      }
      joinRoom(code);
    });

    // Join on Enter key
    document.getElementById('join-room-code').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        document.getElementById('btn-join').click();
      }
    });

    document.getElementById('new-map-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        document.getElementById('btn-create').click();
      }
    });

    // Offline mode
    document.getElementById('btn-offline').addEventListener('click', () => {
      isOfflineMode = true;
      startOffline();
    });

    // Home button
    document.getElementById('btn-home').addEventListener('click', () => {
      if (Collaboration.getRoomId()) {
        Collaboration.disconnect();
      }
      currentRoomId = null;
      // Clear URL params
      window.history.replaceState({}, '', window.location.pathname);
      showLanding();
    });
  }

  // ===== Create New Map =====

  function createNewMap(name) {
    // Create starter mind map
    MindMap.createStarterMap();
    document.getElementById('map-name').textContent = name;

    showWorkspace();
    Renderer.renderAll();
    Renderer.fitView();

    // Try to create a collaborative room
    if (Collaboration.getIsConnected()) {
      currentRoomId = Collaboration.createRoom(name);
      if (currentRoomId) {
        updateRoomUI(currentRoomId);
        // Update URL
        const url = new URL(window.location);
        url.searchParams.set('room', currentRoomId);
        window.history.replaceState({}, '', url);
        Utils.showToast('Room created: ' + currentRoomId);
      }
    } else {
      // Firebase not configured — offline mode
      isOfflineMode = true;
      document.getElementById('room-badge').classList.add('hidden');
      document.getElementById('collab-status').classList.add('hidden');
      Utils.showToast('Working offline — Firebase not configured');
    }

    History.clear();
  }

  // ===== Join Room =====

  function joinRoom(code) {
    if (!Collaboration.getIsConnected()) {
      Utils.showToast('Cannot join — Firebase not configured');
      // Fall back to offline with starter
      startOffline();
      return;
    }

    Utils.showToast('Joining room...');

    Collaboration.joinRoom(code).then(roomId => {
      currentRoomId = roomId;
      showWorkspace();

      // Get room name from meta
      const rootNode = MindMap.getRoot();
      document.getElementById('map-name').textContent = rootNode ? rootNode.text : 'Mind Map';

      updateRoomUI(roomId);
      Renderer.renderAll();
      Renderer.fitView();
      History.clear();

      // Update URL
      const url = new URL(window.location);
      url.searchParams.set('room', roomId);
      window.history.replaceState({}, '', url);

      Utils.showToast('Joined room: ' + roomId);
    }).catch(err => {
      console.error('Join failed:', err);
      Utils.showToast('Failed to join: ' + err.message);
    });
  }

  // ===== Start Offline =====

  function startOffline() {
    // Try to load from localStorage
    const saved = localStorage.getItem('mindflow-local-save');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        MindMap.fromJSON(data);
      } catch (e) {
        MindMap.createStarterMap();
      }
    } else {
      MindMap.createStarterMap();
    }

    document.getElementById('map-name').textContent = 'My Mind Map (Offline)';
    document.getElementById('room-badge').classList.add('hidden');
    document.getElementById('collab-status').classList.add('hidden');

    showWorkspace();
    Renderer.renderAll();
    Renderer.fitView();
    History.clear();
  }

  // ===== Room UI Updates =====

  function updateRoomUI(roomId) {
    const badge = document.getElementById('room-badge');
    badge.textContent = 'Room: ' + roomId;
    badge.classList.remove('hidden');

    const collabStatus = document.getElementById('collab-status');
    collabStatus.classList.remove('hidden');
  }

  // ===== Cross-Module Event Wiring =====

  function wireEvents() {
    // When a node is added/updated/moved locally, sync to Firebase
    Utils.bus.on('node:added', (node) => {
      if (currentRoomId) Collaboration.syncNode(node.id);
    });

    Utils.bus.on('node:updated', (node) => {
      if (currentRoomId) Collaboration.syncNode(node.id);
    });

    Utils.bus.on('node:moved', Utils.throttle((node) => {
      if (currentRoomId) Collaboration.syncNode(node.id);
    }, 200));

    // When text is edited, push history and sync
    Utils.bus.on('node:textEdited', ({ id, oldText, newText }) => {
      if (currentRoomId) Collaboration.syncNode(id);
    });

    // When node is drag-ended, push history
    Utils.bus.on('node:dragEnd', ({ id, fromX, fromY, toX, toY }) => {
      if (fromX !== toX || fromY !== toY) {
        History.pushState('move-node');
      }
    });

    // Selection changes → update presence
    Utils.bus.on('selection:changed', (nodeId) => {
      if (currentRoomId) Collaboration.updateSelectedNode(nodeId);
    });

    // Remote collaboration events → re-render
    Utils.bus.on('collab:nodeAdded', () => {
      Renderer.renderAll();
    });

    Utils.bus.on('collab:nodeChanged', () => {
      Renderer.renderAll();
    });

    Utils.bus.on('collab:nodeRemoved', () => {
      Renderer.renderAll();
    });

    // Presence updates
    Utils.bus.on('collab:presenceChanged', ({ users, onlineCount }) => {
      document.getElementById('online-count').textContent = onlineCount + ' online';
    });

    // Connection status
    Utils.bus.on('collab:connectionChanged', (online) => {
      const dot = document.querySelector('.status-dot');
      if (dot) {
        dot.style.background = online ? 'var(--success)' : 'var(--danger)';
      }
    });
  }

  // ===== Auto-Save (localStorage) =====

  function setupAutoSave() {
    const save = Utils.debounce(() => {
      try {
        const data = MindMap.toJSON();
        localStorage.setItem('mindflow-local-save', JSON.stringify(data));
      } catch (e) {
        // localStorage might be full; ignore
      }
    }, 2000);

    Utils.bus.on('node:added', save);
    Utils.bus.on('node:updated', save);
    Utils.bus.on('node:deleted', save);
    Utils.bus.on('node:moved', save);
    Utils.bus.on('tree:layoutChanged', save);
  }

  return { init };
})();

// ===== Boot =====
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
