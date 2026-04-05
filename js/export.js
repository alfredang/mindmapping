/**
 * export.js — Export mind map as PNG or JSON, import from JSON.
 */

const Export = (() => {

  // ===== Export as PNG =====
  function exportPNG() {
    const world = document.getElementById('canvas-world');
    if (!world) return;

    Utils.showToast('Generating image...');

    // Temporarily reset transform for clean capture
    const original = world.style.transform;
    const allNodes = MindMap.getAllNodes();
    const nodeList = Object.values(allNodes);

    if (nodeList.length === 0) {
      Utils.showToast('Nothing to export');
      return;
    }

    // Calculate bounds
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodeList.forEach(n => {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + 280);
      maxY = Math.max(maxY, n.y + 60);
    });

    const padding = 60;
    const width = maxX - minX + padding * 2;
    const height = maxY - minY + padding * 2;

    // Set transform to show all content
    world.style.transform = `translate(${-minX + padding}px, ${-minY + padding}px) scale(1)`;

    if (typeof html2canvas !== 'undefined') {
      html2canvas(world, {
        backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim(),
        width: width,
        height: height,
        x: 0,
        y: 0,
        scale: 2,
        useCORS: true,
        logging: false,
      }).then(canvas => {
        // Restore transform
        world.style.transform = original;

        // Download
        const link = document.createElement('a');
        link.download = 'mindmap.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
        Utils.showToast('PNG exported!');
      }).catch(err => {
        world.style.transform = original;
        console.error('PNG export failed:', err);
        Utils.showToast('Export failed');
      });
    } else {
      world.style.transform = original;
      Utils.showToast('html2canvas library not loaded');
    }
  }

  // ===== Export as JSON =====
  function exportJSON() {
    const data = MindMap.toJSON();
    data.exportedAt = new Date().toISOString();
    data.appVersion = '1.0';

    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.download = 'mindmap.json';
    link.href = url;
    link.click();

    URL.revokeObjectURL(url);
    Utils.showToast('JSON exported!');
  }

  // ===== Import from JSON =====
  function importJSON() {
    const input = document.getElementById('import-file-input');
    input.value = ''; // reset

    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const data = JSON.parse(evt.target.result);
          if (!data.nodes || !data.rootId) {
            Utils.showToast('Invalid mind map file');
            return;
          }

          History.pushState('import');
          MindMap.fromJSON(data);
          Renderer.renderAll();
          Renderer.fitView();

          // Sync to Firebase if connected
          if (Collaboration.getRoomId()) {
            Collaboration.syncAllNodes();
          }

          Utils.showToast('Mind map imported!');
        } catch (err) {
          console.error('Import failed:', err);
          Utils.showToast('Failed to import — invalid JSON');
        }
      };
      reader.readAsText(file);
    };

    input.click();
  }

  return { exportPNG, exportJSON, importJSON };
})();
