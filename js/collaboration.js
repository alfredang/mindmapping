/**
 * collaboration.js — Firebase Realtime Database integration for room-based
 * real-time collaboration and user presence.
 *
 * ========================================================================
 * FIREBASE SETUP INSTRUCTIONS:
 * 1. Go to https://console.firebase.google.com
 * 2. Create a new project (or use existing)
 * 3. Enable Realtime Database (NOT Firestore)
 * 4. Set database rules to allow read/write (for development):
 *    { "rules": { ".read": true, ".write": true } }
 * 5. Copy your Firebase config and paste it below
 * ========================================================================
 */

const Collaboration = (() => {
  // ===== PASTE YOUR FIREBASE CONFIG HERE =====
  const FIREBASE_CONFIG = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
    projectId: "YOUR_PROJECT",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID",
  };
  // ============================================

  let db = null;
  let roomRef = null;
  let roomId = null;
  let userId = null;
  let userName = 'User';
  let userColor = '#6366f1';
  let isConnected = false;
  let isOnline = false;
  let listeners = [];

  // Assigned colors for presence
  const PRESENCE_COLORS = [
    '#6366f1', '#ec4899', '#22c55e', '#f97316', '#06b6d4',
    '#eab308', '#8b5cf6', '#ef4444', '#14b8a6', '#f43f5e',
  ];

  // ===== Initialization =====

  function init() {
    userId = Utils.generateId(12);
    userName = 'User ' + userId.slice(0, 4);
    userColor = PRESENCE_COLORS[Math.floor(Math.random() * PRESENCE_COLORS.length)];

    // Check if Firebase is configured (not placeholder values)
    if (FIREBASE_CONFIG.apiKey === 'YOUR_API_KEY') {
      console.log('[Collaboration] Firebase not configured — running in offline mode.');
      console.log('[Collaboration] See collaboration.js for setup instructions.');
      return false;
    }

    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(FIREBASE_CONFIG);
      }
      db = firebase.database();
      isConnected = true;

      // Monitor connection state
      db.ref('.info/connected').on('value', (snap) => {
        isOnline = snap.val() === true;
        Utils.bus.emit('collab:connectionChanged', isOnline);
      });

      return true;
    } catch (err) {
      console.error('[Collaboration] Firebase init failed:', err);
      return false;
    }
  }

  // ===== Room Management =====

  function createRoom(mapName) {
    if (!db) return null;
    roomId = Utils.generateRoomCode();
    roomRef = db.ref('rooms/' + roomId);

    // Set room metadata
    roomRef.child('meta').set({
      name: mapName || 'Untitled Mind Map',
      createdAt: firebase.database.ServerValue.TIMESTAMP,
      createdBy: userId,
    });

    // Push initial mind map state
    const allNodes = MindMap.getAllNodes();
    Object.values(allNodes).forEach(node => {
      roomRef.child('nodes/' + node.id).set(node);
    });

    // Setup presence and listeners
    setupPresence();
    setupListeners();

    Utils.bus.emit('collab:roomCreated', roomId);
    return roomId;
  }

  function joinRoom(code) {
    if (!db) return Promise.reject(new Error('Firebase not connected'));
    roomId = code.toUpperCase();
    roomRef = db.ref('rooms/' + roomId);

    return roomRef.child('meta').once('value').then(snap => {
      if (!snap.exists()) {
        throw new Error('Room not found');
      }

      // Load existing mind map data
      return roomRef.child('nodes').once('value');
    }).then(snap => {
      const nodesData = snap.val();
      if (nodesData) {
        MindMap.clear();
        Object.entries(nodesData).forEach(([id, node]) => {
          MindMap.setNode(id, node);
        });
      }

      setupPresence();
      setupListeners();
      Utils.bus.emit('collab:roomJoined', roomId);
      return roomId;
    });
  }

  // ===== Presence =====

  function setupPresence() {
    if (!roomRef) return;

    const presenceRef = roomRef.child('presence/' + userId);
    presenceRef.set({
      name: userName,
      color: userColor,
      online: true,
      lastSeen: firebase.database.ServerValue.TIMESTAMP,
      selectedNodeId: null,
    });

    // Auto-remove on disconnect
    presenceRef.onDisconnect().remove();

    // Listen for presence changes
    const presenceListRef = roomRef.child('presence');
    const onPresence = presenceListRef.on('value', (snap) => {
      const presenceData = snap.val() || {};
      const onlineUsers = Object.values(presenceData).filter(u => u.online);
      Utils.bus.emit('collab:presenceChanged', {
        users: presenceData,
        onlineCount: onlineUsers.length,
      });

      // Show remote selections
      Object.entries(presenceData).forEach(([uid, user]) => {
        if (uid !== userId && user.selectedNodeId) {
          Renderer.setRemoteSelection(user.selectedNodeId, true);
        }
      });
    });

    listeners.push(() => presenceListRef.off('value', onPresence));
  }

  function updateSelectedNode(nodeId) {
    if (!roomRef) return;
    roomRef.child('presence/' + userId + '/selectedNodeId').set(nodeId);
  }

  // ===== Real-time Sync =====

  function setupListeners() {
    if (!roomRef) return;

    const nodesRef = roomRef.child('nodes');

    // Node added
    const onAdded = nodesRef.on('child_added', (snap) => {
      const nodeData = snap.val();
      if (!nodeData) return;
      const existing = MindMap.getNode(nodeData.id);
      if (!existing) {
        MindMap.setNode(nodeData.id, nodeData);
        // If parent exists, ensure child is in parent's children array
        if (nodeData.parentId) {
          const parent = MindMap.getNode(nodeData.parentId);
          if (parent && !parent.children.includes(nodeData.id)) {
            parent.children.push(nodeData.id);
          }
        }
        Utils.bus.emit('collab:nodeAdded', nodeData);
      }
    });

    // Node changed
    const onChanged = nodesRef.on('child_changed', (snap) => {
      const nodeData = snap.val();
      if (!nodeData) return;
      MindMap.setNode(nodeData.id, nodeData);
      Utils.bus.emit('collab:nodeChanged', nodeData);
    });

    // Node removed
    const onRemoved = nodesRef.on('child_removed', (snap) => {
      const nodeData = snap.val();
      if (!nodeData) return;
      MindMap.removeNode(nodeData.id);
      Utils.bus.emit('collab:nodeRemoved', nodeData);
    });

    listeners.push(() => nodesRef.off('child_added', onAdded));
    listeners.push(() => nodesRef.off('child_changed', onChanged));
    listeners.push(() => nodesRef.off('child_removed', onRemoved));
  }

  // ===== Push Changes to Firebase =====

  function syncNode(nodeId) {
    if (!roomRef) return;
    const node = MindMap.getNode(nodeId);
    if (node) {
      roomRef.child('nodes/' + nodeId).set(node);
    }
  }

  function syncNodeDelete(nodeId) {
    if (!roomRef) return;
    roomRef.child('nodes/' + nodeId).remove();
  }

  function syncAllNodes() {
    if (!roomRef) return;
    const allNodes = MindMap.getAllNodes();
    const updates = {};
    Object.values(allNodes).forEach(node => {
      updates['nodes/' + node.id] = node;
    });
    roomRef.update(updates);
  }

  // ===== Disconnect =====

  function disconnect() {
    listeners.forEach(unsub => unsub());
    listeners = [];
    if (roomRef && userId) {
      roomRef.child('presence/' + userId).remove();
    }
    roomRef = null;
    roomId = null;
  }

  // ===== Getters =====

  function getRoomId() { return roomId; }
  function getUserId() { return userId; }
  function isFirebaseConfigured() { return FIREBASE_CONFIG.apiKey !== 'YOUR_API_KEY'; }
  function getIsConnected() { return isConnected; }

  return {
    init,
    createRoom,
    joinRoom,
    disconnect,
    syncNode,
    syncNodeDelete,
    syncAllNodes,
    updateSelectedNode,
    getRoomId,
    getUserId,
    isFirebaseConfigured,
    getIsConnected,
  };
})();
