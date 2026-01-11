// modules.js

// --- HELPER: MATH VECTORS ---
export const Vec = {
    dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
    mid: (a, b) => ({x: (a.x + b.x)/2, y: (a.y + b.y)/2}),
    sub: (a, b) => ({x: a.x - b.x, y: a.y - b.y}),
    len: (v) => Math.hypot(v.x, v.y),
    angle: (a, b) => Math.atan2(b.y - a.y, b.x - a.x)
};

// --- CLASS: DRAGGABLE PENCIL CASE ---
export class DraggableDock {
    constructor() {
        this.container = document.getElementById('pencil-case-container');
        this.btn = document.getElementById('case-toggle');
        this.menu = document.getElementById('case-items');
        this.isOpen = false;
        this.isDragging = false;
        this.startX = 0; this.startY = 0;
        this.initialLeft = 0; this.initialTop = 0;
        this.startTime = 0;
        this.bindEvents();
    }

    bindEvents() {
        if(!this.btn) return; 
        this.btn.addEventListener('pointerdown', this.onDown.bind(this));
        window.addEventListener('pointermove', this.onMove.bind(this));
        window.addEventListener('pointerup', this.onUp.bind(this));
    }

    onDown(e) {
        e.preventDefault(); e.stopPropagation();
        this.isDragging = true;
        this.startX = e.clientX; this.startY = e.clientY;
        this.startTime = Date.now();
        const rect = this.container.getBoundingClientRect();
        this.initialLeft = rect.left; this.initialTop = rect.top;
        this.btn.style.cursor = 'grabbing';
    }

    onMove(e) {
        if (!this.isDragging) return;
        e.preventDefault();
        const dx = e.clientX - this.startX;
        const dy = e.clientY - this.startY;
        let newX = this.initialLeft + dx;
        let newY = this.initialTop + dy;
        const screenW = window.innerWidth; const screenH = window.innerHeight;
        const selfW = this.container.offsetWidth; const selfH = this.container.offsetHeight;
        newX = Math.max(0, Math.min(newX, screenW - selfW));
        newY = Math.max(0, Math.min(newY, screenH - selfH));
        this.container.style.left = `${newX}px`;
        this.container.style.top = `${newY}px`;
    }

    onUp(e) {
        if (!this.isDragging) return;
        this.isDragging = false;
        this.btn.style.cursor = 'move';
        const dist = Math.hypot(e.clientX - this.startX, e.clientY - this.startY);
        const time = Date.now() - this.startTime;
        if (dist < 10 && time < 500) { this.toggleMenu(); }
    }

    toggleMenu() {
        if (this.isDragging) return;
        this.isOpen = !this.isOpen;
        if (this.isOpen) {
            this.container.style.flexDirection = 'column'; 
            this.menu.style.marginBottom = '0px';
            this.menu.style.marginTop = '10px';
            this.menu.style.transformOrigin = 'top center';
            this.menu.classList.add('open');
            this.btn.innerHTML = '<span style="font-size:18px; color:#ef4444;">✕</span>';
        } else {
            this.menu.classList.remove('open');
            this.btn.textContent = '✏️';
        }
    }
}

// --- CLASS: LAYER MANAGER ---
export class LayerManager {
    constructor(app) {
        this.app = app;
        this.layers = [];
        this.layerIdCounter = 0;
        this.activeId = null;
    }
    init(w, h) {
        this.width = w; this.height = h;
        this.addLayer("Background");
    }
    addLayer(name) {
        this.layerIdCounter++;
        const cvs = document.createElement('canvas');
        cvs.width = this.width; cvs.height = this.height;
        const layer = { 
            id: this.layerIdCounter, 
            name: name || `Page ${this.layerIdCounter}`, 
            canvas: cvs, 
            ctx: cvs.getContext('2d', {willReadFrequently: true}), 
            visible: true, 
            opacity: 1, 
            blend: 'source-over',
            locked: false
        };
        this.layers.push(layer);
        this.activeId = layer.id;
        this.app.showToast(`Added ${layer.name} 📄`);
        this.app.requestRender();
        if (this.app.currentPanel === 'layers') this.app.refreshUI();
        return layer;
    }
    getActive() { return this.layers.find(l => l.id === this.activeId); }
    toggleVis(id) {
        const l = this.layers.find(x => x.id === id);
        if (l) { l.visible = !l.visible; this.app.requestRender(); }
    }
    setOpacity(id, val) {
        const l = this.layers.find(x => x.id === id);
        if (l) { l.opacity = val; this.app.requestRender(); }
    }
    setBlend(id, val) {
        const l = this.layers.find(x => x.id === id);
        if (l) { l.blend = val; this.app.requestRender(); }
    }
    renderListHTML() {
        return this.layers.slice().reverse().map(l => `
            <div class="layer-item ${l.id === this.activeId ? 'active' : ''}" onclick="app.layerManager.setActive(${l.id})">
                <div class="layer-vis ${l.visible?'':'off'}" onclick="event.stopPropagation(); app.layerManager.toggleVis(${l.id})">${l.visible ? '👀' : '🙈'}</div>
                <div style="flex:1; margin-left:10px;">
                    <div style="font-size:14px; font-weight:600;">${l.name}</div>
                    <div style="display:flex; align-items:center; gap:5px; margin-top:4px;">
                        <span style="font-size:10px; color:#666;">OP:</span>
                        <input type="range" min="0" max="1" step="0.1" value="${l.opacity}" 
                            onclick="event.stopPropagation()" 
                            oninput="app.layerManager.setOpacity(${l.id}, this.value)" style="width:60px;">
                        <span style="font-size:10px; color:#666;">${Math.round(l.opacity*100)}%</span>
                    </div>
                </div>
                 <div class="layer-vis" style="font-size:12px;" onclick="event.stopPropagation(); app.layerManager.cycleBlend(${l.id})">${l.blend === 'source-over' ? 'N' : 'M'}</div>
            </div>
        `).join('') + `<div class="btn-icon" onclick="app.layerManager.addLayer()" style="width:100%; margin-top:10px; background:#4ECDC4; color:white; font-size:16px; font-weight:bold;">+ Add Layer</div>`;
    }
    cycleBlend(id) {
        const l = this.layers.find(x => x.id === id);
        if(!l) return;
        const modes = ['source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten'];
        const curr = modes.indexOf(l.blend);
        l.blend = modes[(curr + 1) % modes.length];
        this.app.refreshUI();
        this.app.requestRender();
        this.app.showToast(`Blend: ${l.blend.toUpperCase()}`);
    }
    setActive(id) { this.activeId = id; this.app.refreshUI(); }
}


