import { getStroke } from 'https://esm.sh/perfect-freehand@1.2.0';
import { Vec, DraggableDock, LayerManager } from './modules.js';
// --- CLASS: MAIN APP ---
class ProSketch {
    constructor() {
        this.canvas = document.getElementById('main-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.container = document.getElementById('canvas-container');
        this.layerManager = new LayerManager(this);
        
        this.dock = new DraggableDock();
        this.scaleFactor = 2.5; 
        
        this.camera = { x: 0, y: 0, zoom: 1 };
        this.activePointers = new Map();
        this.points = [];
        this.isDrawing = false;
        this.isGesture = false;
        this.colorState = { h: 240, s: 1, v: 1 }; 
        // Tap Gesture Variables
        this.lastTapTime = 0;
        this.touchStartTime = 0;
        this.maxTapTime = 250; 
        
        this.snapTimer = null;
        this.isSnapped = false;
        this.snapStartPos = null;

        this.settings = { tool: 'pen', color: '#6366f1', size: 10, opacity: 1.0, symmetry: 'none', isPicking: false };
        this.history = []; this.redoStack = [];
        this.gallery = [];

        // --- TOOLS CONFIG ---
        this.tools = {
            pencil: { thinning: 0.7, smoothing: 0.6, streamline: 0.5, start: { taper: 40, easing: (t) => t }, end: { taper: 40, easing: (t) => t }, opacity: 0.85, composite: 'source-over', texture: true, sizeMod: 1.2 },
            pen: { thinning: 0.5, smoothing: 0.5, streamline: 0.5, start: { taper: 15 * this.scaleFactor, easing: (t) => t }, end: { taper: 20 * this.scaleFactor, easing: (t) => t }, opacity: 1, composite: 'source-over', sizeMod: 1.0 },
            brush: { thinning: 0.7, smoothing: 0.8, streamline: 0.4, start: { taper: 20 * this.scaleFactor, easing: (t) => t * (2 - t) }, end: { taper: 30 * this.scaleFactor, easing: (t) => t * (2 - t) }, opacity: 0.9, composite: 'source-over', sizeMod: 2.5 },
            marker: { thinning: -0.1, smoothing: 0.4, streamline: 0.5, start: { taper: 0, easing: (t) => t }, end: { taper: 0, easing: (t) => t }, opacity: 0.6, composite: 'multiply', sizeMod: 4.0 },
            airbrush: { type: 'particle',effect: 'spray', thinning: 0, smoothing: 0.8, streamline: 0.6, start: { taper: 0 }, end: { taper: 0 }, opacity: 0.35, composite: 'source-over', sizeMod: 8.0 },
            calligraphy: { thinning: 0.9, smoothing: 0.5, streamline: 0.6, start: { taper: 0 }, end: { taper: 0 }, opacity: 1, composite: 'source-over', sizeMod: 1.8 },
            neon: { thinning: 0.5, smoothing: 0.5, streamline: 0.5, opacity: 1.0, composite: 'screen', sizeMod: 1.5, glow: true },
            eraser: { type: 'eraser', sizeMod: 3.0, composite: 'destination-out', thinning:0, smoothing: 0.5, streamline: 0.5 },
            bucket: { type: 'fill' },
            scissor: { type: 'scissor', sizeMod: 1.0, composite: 'source-over' },
            rect: { type: 'shape', shape: 'rect' },
            circle: { type: 'shape', shape: 'circle' },
            line: { type: 'shape', shape: 'line' },
            text: { type: 'text' }
        };

        this.init();
    }

    init() {
        this.width = 2400; this.height = 1800;
        this.canvas.width = this.width; this.canvas.height = this.height;
        this.container.style.width = this.width + 'px'; this.container.style.height = this.height + 'px';
        this.layerManager.init(this.width, this.height);
        this.pencilPattern = this.createTexture();
        this.bindEvents();
        this.resetView();
        this.loadState();
        this.loadGallery();
        this.injectUI(); 
        this.requestRender();
    }

    injectUI() {
        const caseItems = document.getElementById('case-items');
        const tools = [
            { id: 't-bucket', icon: '🪣', tool: 'bucket' },
            { id: 't-scissor', icon: '✂️', tool: 'scissor' },
            { id: 't-rect', icon: '⬜', tool: 'rect' },
            { id: 't-circle', icon: '⭕', tool: 'circle' },
            { id: 't-line', icon: '📏', tool: 'line' },
            { id: 't-text', icon: 'T', tool: 'text' }
        ];

        tools.forEach(t => {
            if (!document.getElementById(t.id)) {
                const div = document.createElement('div');
                div.className = 'case-tool'; 
                div.id = t.id; 
                div.onclick = () => app.setTool(t.tool); 
                div.textContent = t.icon;
                caseItems.appendChild(div);
            }
        });

        const topBarRight = document.querySelector('.top-bar > div:last-child');
        if (!document.getElementById('btn-clear-layer')) {
            const div = document.createElement('div');
            div.className = 'btn-icon'; div.id = 'btn-clear-layer'; div.title = "Clear Layer"; div.onclick = () => app.clearLayer(); div.textContent = '🗑️'; div.style.color = '#ef4444';
            topBarRight.insertBefore(div, topBarRight.firstChild);
        }
    }

        bindEvents() {
        const vp = document.getElementById('viewport');
        
        // --- NEW: Palm Rejection / No Scroll ---
        vp.style.touchAction = 'none'; 
        
        vp.addEventListener('pointerdown', this.onDown.bind(this), {passive:false});
        window.addEventListener('pointermove', this.onMove.bind(this), {passive:false});
        window.addEventListener('pointerup', this.onUp.bind(this));
        window.addEventListener('pointercancel', this.onUp.bind(this));
        vp.addEventListener('wheel', this.onWheel.bind(this), {passive:false});
        this.bindShortcuts();
    }

    bindShortcuts() {
        window.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redo(); }
            if (e.key === '[') { this.updateSettings('size', Math.max(1, this.settings.size - 2)); this.showToast(`Size: ${this.settings.size}`); document.getElementById('size-slider').value = this.settings.size; }
            if (e.key === ']') { this.updateSettings('size', Math.min(100, this.settings.size + 2)); this.showToast(`Size: ${this.settings.size}`); document.getElementById('size-slider').value = this.settings.size; }
        });
    }

    onDown(e) {
        e.preventDefault();
        
        // Handle Text Tool Click
        if (this.settings.tool === 'text') {
            const pos = this.toWorld(e.clientX, e.clientY);
            this.promptText(pos.x, pos.y);
            return;
        }

        if (this.settings.isPicking) {
             const pos = this.toWorld(e.clientX, e.clientY);
             const pixel = this.ctx.getImageData(pos.x, pos.y, 1, 1).data;
             const hex = "#" + ((1 << 24) + (pixel[0] << 16) + (pixel[1] << 8) + pixel[2]).toString(16).slice(1);
             this.setColor(hex);
             this.showToast(`Copied Color! 🎨`);
             this.settings.isPicking = false; 
             this.canvas.style.cursor = 'crosshair';
             return; 
        }

        if (this.settings.tool === 'bucket') {
            const pos = this.toWorld(e.clientX, e.clientY);
            const layer = this.layerManager.getActive();
            if (layer && layer.visible) {
                this.performFloodFill(layer, Math.floor(pos.x), Math.floor(pos.y), this.settings.color);
            }
            return;
        }

        this.touchStartTime = Date.now();
        this.activePointers.set(e.pointerId, e);
        
        // --- MULTI-TOUCH GESTURE DETECTION START ---
        if (this.activePointers.size === 2) { this.startGesture(); return; }
        if (this.activePointers.size === 3) {
            // 3 Finger Tap check on Up
            return;
        }
        
        if (!this.isGesture && e.button === 0) {
            this.isDrawing = true;
            const pos = this.toWorld(e.clientX, e.clientY);
            this.points = [[pos.x, pos.y, e.pressure || 0.5]]; 
            this.isSnapped = false;
            this.snapStartPos = pos;
            
            // Only trigger snap for freehand tools
            const shapes = ['rect', 'circle', 'line', 'text', 'bucket', 'scissor'];
            if (!shapes.includes(this.settings.tool)) {
                this.snapTimer = setTimeout(() => this.triggerSnap(), 600);
            }
        }
    }

    onMove(e) {
        if (this.activePointers.has(e.pointerId)) this.activePointers.set(e.pointerId, e);
        if (this.isGesture && this.activePointers.size === 2) { this.handleGesture(); return; }
        
        if (this.isDrawing && this.activePointers.size === 1) {
            const pos = this.toWorld(e.clientX, e.clientY);
            
            // Shape tools logic (Live Preview)
            const tool = this.tools[this.settings.tool];
            if (tool.type === 'shape') {
                // Update the end point for the shape
                this.points[1] = [pos.x, pos.y, e.pressure||0.5];
                this.renderLive();
                return;
            }

            // Normal Drawing
            if (this.isSnapped) { this.points[this.points.length-1] = [pos.x, pos.y, e.pressure||0.5]; this.renderLive(); return; }
            if (this.snapTimer && Vec.dist(pos, this.snapStartPos) > 30) { clearTimeout(this.snapTimer); this.snapTimer = null; }
            if (e.getCoalescedEvents) { e.getCoalescedEvents().forEach(ce => { const p = this.toWorld(ce.clientX, ce.clientY); this.points.push([p.x, p.y, ce.pressure || 0.5]); }); } 
            else { this.points.push([pos.x, pos.y, e.pressure || 0.5]); }
            this.renderLive();
        }
    }

    onUp(e) {
        const duration = Date.now() - this.touchStartTime;
        
        // --- SMART GESTURES (Tap detection) ---
        if (this.activePointers.size === 2 && duration < this.maxTapTime && !this.isGesture) {
            this.undo(); // 2 Finger Tap
            this.activePointers.delete(e.pointerId);
            return;
        }
        if (this.activePointers.size === 3 && duration < this.maxTapTime) {
            this.redo(); // 3 Finger Tap
            this.activePointers.delete(e.pointerId);
            return;
        }

        this.activePointers.delete(e.pointerId);
        clearTimeout(this.snapTimer);
        
        if (this.isGesture && this.activePointers.size < 2) { this.isGesture = false; }
        
        if (this.activePointers.size === 0) {
            this.isGesture = false;
            if (this.isDrawing) { 
                this.isDrawing = false; 
                this.commitStroke(); 
                this.points = []; 
                this.requestRender(); 
            }
        }
    }

    triggerSnap() {
        if (!this.isDrawing) return;
        this.isSnapped = true;
        this.showToast("Straight Line! 📏");
        const start = this.points[0];
        const end = this.points[this.points.length-1];
        this.points = [start, end]; 
        this.renderLive();
        if (navigator.vibrate) navigator.vibrate(20);
    }

    renderLive() {
        this.composeLayers();
        
        if (this.settings.tool === 'scissor') {
            this.drawScissorPath(this.ctx, this.points);
            return;
        }

        const toolCfg = this.tools[this.settings.tool];
        
        // Handle Shape Preview
        if (toolCfg.type === 'shape' && this.points.length >= 2) {
            this.drawGeometricShape(this.ctx, this.points[0], this.points[1], toolCfg.shape, this.settings.color, this.settings.size, this.settings.opacity);
            return;
        }

        const size = (this.settings.size * toolCfg.sizeMod) * (this.scaleFactor * 0.6); 
        this.drawSymmetry(this.ctx, this.points, size, this.settings.color, toolCfg, this.settings.opacity, this.settings.symmetry);
    }

    drawScissorPath(ctx, points) {
        if (points.length < 2) return;
        ctx.save();
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2 / this.camera.zoom;
        ctx.setLineDash([10, 10]);
        ctx.beginPath();
        ctx.moveTo(points[0][0], points[0][1]);
        for(let i=1; i<points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
        ctx.stroke();
        
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.3)';
        ctx.beginPath();
        ctx.moveTo(points[points.length-1][0], points[points.length-1][1]);
        ctx.lineTo(points[0][0], points[0][1]);
        ctx.stroke();
        ctx.restore();
    }

    drawGeometricShape(ctx, start, end, type, color, size, opacity) {
        ctx.save();
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = size * this.scaleFactor * 0.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = opacity;
        
        const w = end[0] - start[0];
        const h = end[1] - start[1];

        if (type === 'line') {
            ctx.moveTo(start[0], start[1]);
            ctx.lineTo(end[0], end[1]);
        } else if (type === 'rect') {
            ctx.rect(start[0], start[1], w, h);
        } else if (type === 'circle') {
            const radius = Math.hypot(w, h) / 2;
            const cx = start[0] + w/2;
            const cy = start[1] + h/2;
            ctx.ellipse(cx, cy, Math.abs(w/2), Math.abs(h/2), 0, 0, Math.PI*2);
        }
        ctx.stroke();
        ctx.restore();
    }

    promptText(x, y) {
        const text = prompt("Enter text:", "");
        if (text) {
            this.addTextToLayer(x, y, text, this.settings.color, this.settings.size * 5);
        }
    }

    addTextToLayer(x, y, text, color, size) {
        const layer = this.layerManager.getActive();
        layer.ctx.save();
        layer.ctx.font = `bold ${size}px sans-serif`;
        layer.ctx.fillStyle = color;
        layer.ctx.fillText(text, x, y);
        layer.ctx.restore();
        
        this.history.push({ type: 'text', layerId: layer.id, x, y, text, color, size });
        this.requestRender();
    }

    commitStroke() {
        const layer = this.layerManager.getActive();
        if (!layer || !layer.visible) return;

        if (this.settings.tool === 'scissor') {
            this.performScissorCut(layer, this.points);
            return;
        }

        const toolCfg = this.tools[this.settings.tool];
        
        if (toolCfg.type === 'shape') {
             if (this.points.length >= 2) {
                 this.drawGeometricShape(layer.ctx, this.points[0], this.points[1], toolCfg.shape, this.settings.color, this.settings.size, this.settings.opacity);
                 this.history.push({ 
                     type: 'shape', 
                     layerId: layer.id, 
                     shape: toolCfg.shape, 
                     start: this.points[0], 
                     end: this.points[1], 
                     color: this.settings.color, 
                     size: this.settings.size, 
                     opacity: this.settings.opacity 
                 });
             }
        } else {
            // Standard Brush
            const size = (this.settings.size * toolCfg.sizeMod) * (this.scaleFactor * 0.6); 
            this.drawSymmetry(layer.ctx, this.points, size, this.settings.color, toolCfg, this.settings.opacity, this.settings.symmetry);
            
            this.history.push({ 
                type: 'stroke',
                layerId: layer.id, 
                points: [...this.points], 
                color: this.settings.color, 
                size, 
                opacity: this.settings.opacity,
                symmetry: this.settings.symmetry,
                config: {...toolCfg} 
            });
        }
        
        this.redoStack = []; 
        this.saveState(); 
    }

    performScissorCut(layer, points) {
        if (points.length < 3) return;

        layer.ctx.save();
        layer.ctx.beginPath();
        layer.ctx.moveTo(points[0][0], points[0][1]);
        for(let i=1; i<points.length; i++) layer.ctx.lineTo(points[i][0], points[i][1]);
        layer.ctx.closePath();
        
        layer.ctx.globalCompositeOperation = 'destination-in';
        layer.ctx.fillStyle = 'black'; 
        layer.ctx.fill();
        layer.ctx.restore();
        
        this.history.push({
            type: 'scissor',
            layerId: layer.id,
            points: [...points]
        });
        
        this.redoStack = [];
        this.saveState();
        this.showToast("Cut Background! ✂️");
        this.requestRender();
    }


    clearLayer() {
        const layer = this.layerManager.getActive();
        if(!layer) return;
        this.history.push({ type: 'clear', layerId: layer.id });
        layer.ctx.clearRect(0,0,this.width, this.height);
        this.requestRender();
        this.showToast("Cleared! 🗑️");
        this.redoStack = [];
    }

        undo() { 
        if(!this.history.length) { this.showToast('Nothing to Undo'); return; }
        
        const action = this.history.pop();
        this.redoStack.push(action); 
        
        // PASS THE LAYER ID SO WE ONLY REBUILD THAT ONE LAYER
        this.rebuildLayers(action.layerId); 
        
        this.showToast('Undo ↩️'); 
    }

    redo() { 
        if(!this.redoStack.length) { this.showToast('Nothing to Redo'); return; }
        
        const action = this.redoStack.pop();
        this.history.push(action); 
        
        // PASS THE LAYER ID SO WE ONLY REBUILD THAT ONE LAYER
        this.rebuildLayers(action.layerId); 
        
        this.showToast('Redo ↪️');
    }
    rebuildLayers(specificLayerId = null) {
        // 1. Determine which layers to clear (Optimization)
        let layersToUpdate = [];
        if (specificLayerId) {
            const l = this.layerManager.layers.find(x => x.id === specificLayerId);
            if (l) layersToUpdate.push(l);
        } else {
            // If no ID provided, rebuild EVERYTHING (fallback)
            layersToUpdate = this.layerManager.layers;
        }

        // 2. Clear ONLY the target layers
        layersToUpdate.forEach(l => l.ctx.clearRect(0, 0, this.width, this.height));

        // 3. Replay History (Skip actions that aren't for our target layer)
        this.history.forEach(act => { 
            // OPTIMIZATION: If we are only updating Layer X, skip actions for Layer Y
            if (specificLayerId && act.layerId !== specificLayerId) return;

            const l = this.layerManager.layers.find(x => x.id === act.layerId); 
            if(!l) return;

            if (act.type === 'stroke') {
                this.drawSymmetry(l.ctx, act.points, act.size, act.color, act.config, act.opacity, act.symmetry); 
            } else if (act.type === 'shape') {
                this.drawGeometricShape(l.ctx, act.start, act.end, act.shape, act.color, act.size, act.opacity);
            } else if (act.type === 'text') {
                l.ctx.save();
                l.ctx.font = `bold ${act.size}px sans-serif`;
                l.ctx.fillStyle = act.color;
                l.ctx.fillText(act.text, act.x, act.y);
                l.ctx.restore();
            } else if (act.type === 'clear') {
                l.ctx.clearRect(0,0,this.width, this.height);
            } else if (act.type === 'fill') {
                this.runFloodFillAlgorithm(l.ctx, act.x, act.y, act.color);
            } else if (act.type === 'filter') {
                 this.applyFilter(act.filterType, l, true);
            } else if (act.type === 'scissor') {
                l.ctx.save();
                l.ctx.beginPath();
                l.ctx.moveTo(act.points[0][0], act.points[0][1]);
                for(let i=1; i<act.points.length; i++) l.ctx.lineTo(act.points[i][0], act.points[i][1]);
                l.ctx.closePath();
                l.ctx.globalCompositeOperation = 'destination-in';
                l.ctx.fillStyle = 'black';
                l.ctx.fill();
                l.ctx.restore();
            }
        });
        
        // 4. Update the screen
        this.requestRender();
    }


    performFloodFill(layer, x, y, color) {
        this.showToast("Filling... ⏳");
        setTimeout(() => {
            this.runFloodFillAlgorithm(layer.ctx, x, y, color);
            this.requestRender();
            this.history.push({ type: 'fill', layerId: layer.id, x: x, y: y, color: color });
            this.redoStack = [];
            this.saveState();
            this.showToast("Filled! 🪣");
        }, 10);
    }

    runFloodFillAlgorithm(ctx, startX, startY, fillColorHex) {
        const w = this.width; const h = this.height;
        const imageData = ctx.getImageData(0, 0, w, h);
        const data = imageData.data;
        const r = parseInt(fillColorHex.slice(1,3), 16);
        const g = parseInt(fillColorHex.slice(3,5), 16);
        const b = parseInt(fillColorHex.slice(5,7), 16);
        const a = 255;
        const startIdx = (startY * w + startX) * 4;
        const startR = data[startIdx], startG = data[startIdx+1], startB = data[startIdx+2], startA = data[startIdx+3];
        if (startR === r && startG === g && startB === b && startA === a) return;
        const stack = [[startX, startY]];
        while (stack.length) {
            const [cx, cy] = stack.pop();
            const idx = (cy * w + cx) * 4;
            if (cx < 0 || cx >= w || cy < 0 || cy >= h) continue;
            if (data[idx] === startR && data[idx+1] === startG && data[idx+2] === startB && data[idx+3] === startA) {
                data[idx] = r; data[idx+1] = g; data[idx+2] = b; data[idx+3] = a;
                stack.push([cx+1, cy]); stack.push([cx-1, cy]); stack.push([cx, cy+1]); stack.push([cx, cy-1]);
            }
        }
        ctx.putImageData(imageData, 0, 0);
    }

    // --- FILTERS ---
    triggerFilter(type) {
        const layer = this.layerManager.getActive();
        if(!layer) return;
        this.applyFilter(type, layer);
        this.history.push({ type: 'filter', layerId: layer.id, filterType: type });
        this.redoStack = [];
        this.showToast(`Applied ${type} ✨`);
    }

    applyFilter(type, layer, isReplay = false) {
        const imgData = layer.ctx.getImageData(0,0, this.width, this.height);
        const data = imgData.data;
        for(let i=0; i<data.length; i+=4) {
            const r = data[i], g = data[i+1], b = data[i+2];
            if (type === 'grayscale') {
                const v = 0.3*r + 0.59*g + 0.11*b;
                data[i] = data[i+1] = data[i+2] = v;
            } else if (type === 'invert') {
                data[i] = 255-r; data[i+1] = 255-g; data[i+2] = 255-b;
            } else if (type === 'sepia') {
                data[i] = (r * .393) + (g *.769) + (b * .189);
                data[i+1] = (r * .349) + (g *.686) + (b * .168);
                data[i+2] = (r * .272) + (g *.534) + (b * .131);
            }
        }
        layer.ctx.putImageData(imgData, 0, 0);
        if(!isReplay) this.requestRender();
    }

    saveState() {
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(() => {
            try {
                const data = this.canvas.toDataURL('image/png', 0.5); 
                localStorage.setItem('prosketch-kids', data);
            } catch (e) { console.warn("Auto-save skipped"); }
        }, 1000);
    }

    loadState() {
        const data = localStorage.getItem('prosketch-kids');
        if (data) {
            const img = new Image();
            img.onload = () => { 
                const layer = this.layerManager.layers[0]; 
                layer.ctx.clearRect(0, 0, this.width, this.height);
                layer.ctx.drawImage(img, 0, 0); 
                this.requestRender(); 
                this.showToast('Welcome Back! 👋'); 
            };
            img.src = data;
        }
    }
        handleUpload(input) {
        const file = input.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const newLayer = this.layerManager.addLayer('Imported Image');
                const scale = Math.min(this.width / img.width, this.height / img.height);
                const w = img.width * scale;
                const h = img.height * scale;
                const x = (this.width - w) / 2;
                const y = (this.height - h) / 2;
                newLayer.ctx.drawImage(img, x, y, w, h);
                this.requestRender();
                this.showToast('Image Imported! 📷');
                input.value = ''; 
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

                saveToGallery() {
        try {
            // --- FIX 1: Create a temporary canvas for the Thumbnail ---
            const thumbCanvas = document.createElement('canvas');
            const w = 300, h = 225;
            thumbCanvas.width = w; thumbCanvas.height = h;
            const tCtx = thumbCanvas.getContext('2d');

            // 1. FILL WHITE FIRST (Fixes Black Background)
            tCtx.fillStyle = '#ffffff';
            tCtx.fillRect(0, 0, w, h);

            // 2. Draw the art on top
            tCtx.drawImage(this.canvas, 0, 0, w, h);
            const thumbData = thumbCanvas.toDataURL('image/jpeg', 0.8);

            // --- FIX 2: Save a "Workable" version (Resized to max 800px to save space) ---
            const workCanvas = document.createElement('canvas');
            const scale = Math.min(800 / this.width, 800 / this.height);
            workCanvas.width = this.width * scale; 
            workCanvas.height = this.height * scale;
            const wCtx = workCanvas.getContext('2d');
            
            // Fill white here too
            wCtx.fillStyle = '#ffffff';
            wCtx.fillRect(0, 0, workCanvas.width, workCanvas.height);
            wCtx.drawImage(this.canvas, 0, 0, workCanvas.width, workCanvas.height);
            const fullData = workCanvas.toDataURL('image/jpeg', 0.8);

            // 3. Create Item
            const artItem = { 
                id: Date.now(), 
                date: new Date().toLocaleDateString(), 
                thumb: thumbData, 
                full: fullData // Now we save the bigger version!
            };

            this.gallery.unshift(artItem);
            // Keep only last 6 items to prevent crashing the storage
            if(this.gallery.length > 6) this.gallery.pop(); 
            
            localStorage.setItem('prosketch-gallery', JSON.stringify(this.gallery));
            this.showToast('Saved to Gallery! 📸');

        } catch(e) { 
            console.error(e);
            this.showToast('Storage Full! Delete old art. 📂'); 
        }
    }

    loadGallery() {
        try { const g = localStorage.getItem('prosketch-gallery'); if(g) this.gallery = JSON.parse(g); } catch(e) {}
    }

    deleteFromGallery(id) {
        this.gallery = this.gallery.filter(item => item.id !== id);
        localStorage.setItem('prosketch-gallery', JSON.stringify(this.gallery));
        this.refreshGalleryModal(); 
    }

    loadFromGallery(id) {
    const item = this.gallery.find(x => x.id === id);
    if (!item) return;
        loadFromGallery(id) {
        const item = this.gallery.find(x => x.id === id);
        if (!item) return;

        this.showToast("Loading Art... ⏳");

        const img = new Image();
        img.onload = () => {
            // 1. Create a New Layer for this art
            const newLayer = this.layerManager.addLayer('Loaded Art');
            
            // 2. Draw the image (Stretched to fit canvas)
            newLayer.ctx.drawImage(img, 0, 0, this.width, this.height);
            
            // 3. Update Screen
            this.requestRender();
            this.toggleGalleryModal(false); // Close the gallery
            this.showToast('Art Loaded to Edit! 🎨');
        };
        // Use full version if available, otherwise thumbnail
        img.src = item.full || item.thumb;
    }

    toggleGalleryModal(forceState) {
        const modal = document.getElementById('gallery-modal');
        const isOpen = modal.classList.contains('active');
        if (forceState === false || isOpen) {
            modal.classList.remove('active');
        } else {
            this.refreshGalleryModal();
            modal.classList.add('active');
        }
    }
    toggleTemplateModal(force) {
        const el = document.getElementById('template-modal');
        if (force === false || el.style.display === 'block') {
            el.style.display = 'none';
        } else {
            el.style.display = 'block';
        }
    }
    loadTemplate(type) {
        this.toggleTemplateModal(false);
        const guideLayer = this.layerManager.addLayer('Guide');
        const ctx = guideLayer.ctx;
        const w = this.width;
        const h = this.height;
        const cx = w / 2;
        const cy = h / 2;

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const isColoring = type.startsWith('color');
        
        if (isColoring) {
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 15;
            ctx.setLineDash([]); 
        } else {
            ctx.strokeStyle = '#94a3b8'; 
            ctx.lineWidth = 10;
            ctx.setLineDash([25, 30]);
        }

        ctx.beginPath();
        if (type === 'line-h') {
            for(let i=1; i<5; i++) {
                const y = (h/5)*i;
                ctx.moveTo(200, y); ctx.lineTo(w-200, y);
            }
        } 
        else if (type === 'line-z') {
            const step = 200;
            ctx.moveTo(100, cy);
            for(let x=100; x<w-100; x+=step) {
                ctx.lineTo(x + step/2, cy - 300);
                ctx.lineTo(x + step, cy + 300);
            }
        }
        else if (type === 'line-w') {
            ctx.moveTo(100, cy);
            for(let x=100; x<w-100; x+=400) {
                ctx.bezierCurveTo(x+100, cy-400, x+300, cy+400, x+400, cy);
            }
        }
        else if (type === 'line-l') {
            ctx.moveTo(100, cy);
            for(let x=100; x<w-200; x+=300) {
                 ctx.arc(x+150, cy, 100, Math.PI, 0);
                 ctx.arc(x+300, cy, 100, Math.PI, 0, true);
            }
        }
        else if (type === 'shape-circle') { ctx.arc(cx, cy, 500, 0, Math.PI*2); }
        else if (type === 'shape-rect') { ctx.rect(cx-500, cy-400, 1000, 800); }
        else if (type === 'shape-tri') { 
            ctx.moveTo(cx, cy-500); 
            ctx.lineTo(cx+500, cy+400); 
            ctx.lineTo(cx-500, cy+400); 
            ctx.closePath(); 
        }
        else if (type === 'shape-star') {
            for(let i=0; i<5; i++) {
                ctx.lineTo(Math.cos((18+i*72)/180*Math.PI)*500 + cx, -Math.sin((18+i*72)/180*Math.PI)*500 + cy);
                ctx.lineTo(Math.cos((54+i*72)/180*Math.PI)*200 + cx, -Math.sin((54+i*72)/180*Math.PI)*200 + cy);
            }
            ctx.closePath();
        }
        else if (type === 'color-sun') {
            ctx.arc(cx, cy, 250, 0, Math.PI*2); 
            for(let i=0; i<8; i++) {
                const angle = (i * 45) * Math.PI / 180;
                ctx.moveTo(cx + Math.cos(angle)*300, cy + Math.sin(angle)*300);
                ctx.lineTo(cx + Math.cos(angle)*500, cy + Math.sin(angle)*500);
            }
        }
        else if (type === 'color-flower') {
             ctx.arc(cx, cy, 100, 0, Math.PI*2);
             for(let i=0; i<6; i++) {
                 const angle = (i * 60) * Math.PI/180;
                 const px = cx + Math.cos(angle)*100;
                 const py = cy + Math.sin(angle)*100;
                 ctx.moveTo(px, py);
                 ctx.arc(cx + Math.cos(angle)*250, cy + Math.sin(angle)*250, 150, 0, Math.PI*2);
             }
        }
        else if (type === 'color-fish') {
            ctx.ellipse(cx, cy, 400, 200, 0, 0, Math.PI*2);
            ctx.moveTo(cx-200, cy-100); 
            ctx.lineTo(cx-500, cy-200);
            ctx.lineTo(cx-500, cy+200);
            ctx.lineTo(cx-200, cy+100); 
            ctx.moveTo(cx+200, cy-50); ctx.arc(cx+200, cy-50, 20, 0, Math.PI*2);
        }

        ctx.stroke();
        this.requestRender();
        this.showToast(isColoring ? "Ready to Color! 🖍️" : "Trace the lines! ✏️");
        if (!isColoring) {
            const drawLayer = this.layerManager.addLayer('Practice Layer');
            this.layerManager.setActive(drawLayer.id);
            guideLayer.opacity = 0.6;
        } 
        if (this.currentPanel === 'layers') this.refreshUI();
    }

    refreshGalleryModal() {
        const grid = document.getElementById('gallery-grid');
        if (this.gallery.length === 0) {
            grid.innerHTML = `<div style="text-align:center; color:#999; grid-column:1/-1;">No saved art yet! 🎨</div>`;
            return;
        }
        grid.innerHTML = this.gallery.map(item => `
            <div class="gallery-card">
                <img src="${item.thumb}" onclick="app.loadFromGallery(${item.id})">
                <div class="gallery-actions">
                    <span>${item.date}</span>
                    <div style="display:flex; gap:10px;">
                        <span onclick="app.downloadFromGallery(${item.id})" style="color:#6366f1; cursor:pointer;" title="Download PNG">⬇️</span>
                        <span onclick="app.deleteFromGallery(${item.id})" style="color:#ef4444; cursor:pointer;" title="Delete">🗑️</span>
                    </div>
                </div>
            </div>
        `).join('');
    }

    download(format = 'png') {
        const link = document.createElement('a');
        const ext = format === 'jpeg' ? 'jpg' : 'png';
        const type = format === 'jpeg' ? 'image/jpeg' : 'image/png';
        link.download = `MyArt-${Date.now()}.${ext}`;
        const c = document.createElement('canvas');
        c.width = this.width; c.height = this.height;
        const ctx = c.getContext('2d');
        if (format === 'jpeg') {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0,0,c.width,c.height);
        }
        ctx.drawImage(this.canvas, 0, 0);
        link.href = c.toDataURL(type, 0.9);
        link.click();
        this.showToast(`Saving ${ext.toUpperCase()}... 💾`);
    }

    // REPLACE THIS FUNCTION IN app.js
drawReversePicker(canvasId, hue = 0) {
    const cvs = document.getElementById(canvasId);
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    const w = cvs.width; const h = cvs.height;
    
    // FIX: Define imgData once and use it correctly
    const imgData = ctx.createImageData(w, h);
    const data = imgData.data; // Corrected variable reference
    
    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) {
            const s = 1 - (x / w); const v = y / h; const rgb = this.hsvToRgb(hue, s, v);
            const index = (y * w + x) * 4;
            data[index] = rgb[0]; data[index+1] = rgb[1]; data[index+2] = rgb[2]; data[index+3] = 255;
        }
    }
    ctx.putImageData(imgData, 0, 0);
}

    pickCustomColor(e) {
        const rect = e.target.getBoundingClientRect();
        const x = e.clientX - rect.left; const y = e.clientY - rect.top;
        const ctx = e.target.getContext('2d');
        if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return;
        const p = ctx.getImageData(x, y, 1, 1).data;
        const hex = "#" + ((1 << 24) + (p[0] << 16) + (p[1] << 8) + p[2]).toString(16).slice(1);
        this.setColor(hex);
        this.showToast('Color Selected!');
    }

    hsvToRgb(h, s, v) {
        let r, g, b; let i = Math.floor(h * 6); let f = h * 6 - i; let p = v * (1 - s); let q = v * (1 - f * s); let t = v * (1 - (1 - f) * s);
        switch (i % 6) {
            case 0: r = v, g = t, b = p; break; case 1: r = q, g = v, b = p; break; case 2: r = p, g = v, b = t; break;
            case 3: r = p, g = q, b = v; break; case 4: r = t, g = p, b = v; break; case 5: r = v, g = p, b = q; break;
        }
        return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    }
        // --- ADVANCED COLOR STUDIO LOGIC ---

    toggleColorStudio(show) {
        const modal = document.getElementById('color-studio-modal');
        if (show) {
            modal.classList.add('active');
            // Slight delay to ensure modal is visible before drawing logic runs
            setTimeout(() => this.initColorStudio(), 50); 
        } else {
            modal.classList.remove('active');
        }
    }

    initColorStudio() {
        this.hueCanvas = document.getElementById('cs-hue-canvas');
        this.sbCanvas = document.getElementById('cs-sb-canvas');
        this.sbCtx = this.sbCanvas.getContext('2d');
        this.hueCtx = this.hueCanvas.getContext('2d');

        // Render Static Hue Strip
        const grad = this.hueCtx.createLinearGradient(0, 0, this.hueCanvas.width, 0);
        grad.addColorStop(0, "red"); grad.addColorStop(0.17, "yellow"); grad.addColorStop(0.33, "lime");
        grad.addColorStop(0.5, "cyan"); grad.addColorStop(0.66, "blue"); grad.addColorStop(0.83, "magenta"); grad.addColorStop(1, "red");
        this.hueCtx.fillStyle = grad;
        this.hueCtx.fillRect(0, 0, this.hueCanvas.width, this.hueCanvas.height);

        // Bind Events
        this.bindColorEvents(this.hueCanvas, 'hue');
        this.bindColorEvents(this.sbCanvas, 'sb');

        // Initial Render
        this.updateColorStudioUI();
    }

    bindColorEvents(canvas, type) {
        const handle = (e) => {
            e.preventDefault();
            const rect = canvas.getBoundingClientRect();
            let x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
            let y = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
            
            // Clamp values
            x = Math.max(0, Math.min(x, rect.width));
            y = Math.max(0, Math.min(y, rect.height));

            if (type === 'hue') {
                this.colorState.h = (x / rect.width) * 360;
            } else {
                this.colorState.s = x / rect.width;
                this.colorState.v = 1 - (y / rect.height);
            }
            this.updateColorStudioUI();
            this.applyColorFromState();
        };

        canvas.onmousedown = (e) => { handle(e); document.onmousemove = handle; document.onmouseup = () => { document.onmousemove = null; }; };
        canvas.ontouchstart = (e) => { handle(e); canvas.ontouchmove = handle; };
    }

    updateColorStudioUI() {
        const w = this.sbCanvas.width;
        const h = this.sbCanvas.height;

        // 1. Redraw Saturation/Brightness Box based on current Hue
        this.sbCtx.clearRect(0, 0, w, h);
        
        // Horizontal Gradient (White -> Hue)
        const g1 = this.sbCtx.createLinearGradient(0, 0, w, 0);
        g1.addColorStop(0, "#fff");
        g1.addColorStop(1, `hsl(${this.colorState.h}, 100%, 50%)`);
        this.sbCtx.fillStyle = g1; this.sbCtx.fillRect(0,0,w,h);

        // Vertical Gradient (Transparent -> Black)
        const g2 = this.sbCtx.createLinearGradient(0, 0, 0, h);
        g2.addColorStop(0, "transparent");
        g2.addColorStop(1, "#000");
        this.sbCtx.fillStyle = g2; this.sbCtx.fillRect(0,0,w,h);

        // 2. Update Cursors
        const hueX = (this.colorState.h / 360) * this.hueCanvas.offsetWidth;
        document.getElementById('cs-hue-cursor').style.left = hueX + 'px';

        const sbX = this.colorState.s * this.sbCanvas.offsetWidth;
        const sbY = (1 - this.colorState.v) * this.sbCanvas.offsetHeight;
        document.getElementById('cs-sb-cursor').style.left = sbX + 'px';
        document.getElementById('cs-sb-cursor').style.top = sbY + 'px';

        // 3. Update Preview
        const rgb = this.hsvToRgb(this.colorState.h / 360, this.colorState.s, this.colorState.v);
        const hex = this.rgbToHex(rgb[0], rgb[1], rgb[2]);
        document.getElementById('cs-preview').style.background = hex;
        document.getElementById('cs-hex-input').value = hex;
    }

    applyColorFromState() {
        const rgb = this.hsvToRgb(this.colorState.h / 360, this.colorState.s, this.colorState.v);
        const hex = this.rgbToHex(rgb[0], rgb[1], rgb[2]);
        this.settings.color = hex;
        document.getElementById('curr-color').style.background = hex;
    }

    rgbToHex(r, g, b) {
        return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    }

            // 1. UPDATED: The Router that decides which engine to use
    drawSymmetry(ctx, points, size, color, cfg, opacity = 1, symmetry = 'none') {
        // Helper to run the correct renderer
        const render = (pts) => {
            const tool = this.settings.tool;
            
            if (['pencil', 'marker', 'neon'].includes(tool)) {
                this.drawTexturedStroke(ctx, pts, size, color, tool, opacity);
            } 
            // B. The "Particle" Engine (New additions)
            else if (cfg.type === 'particle') {
                this.drawParticles(ctx, pts, size, color, cfg.effect, opacity);
            } 
                      else {
                this.drawStroke(ctx, pts, size, color, cfg, opacity);
            }
        };

        // Draw Main
        render(points);

        // Handle Symmetry
        const w = this.width, h = this.height;
        if (symmetry === 'x' || symmetry === 'quad') render(points.map(p => [w - p[0], p[1], p[2]]));
        if (symmetry === 'y' || symmetry === 'quad') render(points.map(p => [p[0], h - p[1], p[2]]));
        if (symmetry === 'quad') render(points.map(p => [w - p[0], h - p[1], p[2]]));
    }

    drawTexturedStroke(ctx, points, baseSize, color, tool, opacity) {
        if (points.length < 2) return;
        
        ctx.save();
        
        // Setup Composites
        if (tool === 'eraser') ctx.globalCompositeOperation = 'destination-out';
        else if (tool === 'marker') {
            ctx.globalCompositeOperation = 'multiply'; 
            ctx.globalAlpha = 0.05 * opacity; 
        }
        else if (tool === 'neon') {
            ctx.globalCompositeOperation = 'screen';
            ctx.shadowBlur = baseSize * 1.5;
            ctx.shadowColor = color;
            ctx.fillStyle = '#ffffff'; 
            ctx.globalAlpha = 0.5 * opacity;
        } 
        else { 
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = opacity;
        }

        if (tool !== 'neon') ctx.fillStyle = color;

        // SKIP OPTIMIZATION: On huge lines, skip pixels to save speed
        const skip = points.length > 100 ? 2 : 1; 

        for (let i = 1; i < points.length; i += skip) {
            const p1 = points[i-skip];
            const p2 = points[i];
            
            const dist = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
            if (dist < 1) continue; 

            // DENSITY CONTROL:
            // Lower number = Steps are closer together = More density
            // Pencil was 5, now 3 (Closer steps)
            const stepSize = tool === 'pencil' ? 3 : 3; 
            const steps = Math.ceil(dist / stepSize); 

            // Taper Math
            const pressure1 = p1[2] || 0.5;
            const pressure2 = p2[2] || 0.5;
            let w1, w2;
            
            if (tool === 'marker') {
                w1 = baseSize * (0.8 + pressure1 * 0.2);
                w2 = baseSize * (0.8 + pressure2 * 0.2);
            } else {
                w1 = baseSize * (0.2 + pressure1 * 0.8);
                w2 = baseSize * (0.2 + pressure2 * 0.8);
            }

            const xDiff = p2[0] - p1[0];
            const yDiff = p2[1] - p1[1];
            const wDiff = w2 - w1;

            for (let j = 0; j < steps; j++) {
                const t = j / steps;
                const x = p1[0] + (xDiff * t);
                const y = p1[1] + (yDiff * t);
                const w = w1 + (wDiff * t);

                ctx.beginPath();
                
                if (tool === 'pencil') {
                    
                    for(let d=0; d<3; d++) { // <--- Change 2 to 3 for even MORE density
                        const angle = Math.random() * 6.28;
                        // Scatter them within the brush width
                        const offset = Math.random() * (w/2); 
                        const px = x + Math.cos(angle)*offset;
                        const py = y + Math.sin(angle)*offset;
                        
                        // 1.5 size is crisp. Change to 2 for bolder pencil.
                        ctx.fillRect(px, py, 1.5, 1.5); 
                    }
                } 
                else if (tool === 'neon') {
                    ctx.arc(x, y, w / 4, 0, 6.28);
                    ctx.fill();
                } 
                else {
                    ctx.arc(x, y, w / 2, 0, 6.28);
                    ctx.fill();
                }
            }
        }
        ctx.restore();
    }


    // 3. EXISTING: Particle Engine (Spray/Chalk)
    drawParticles(ctx, points, size, color, effect, opacity) {
        if (points.length < 2) return;
        ctx.save();
        ctx.fillStyle = color;
        ctx.globalAlpha = opacity;
        for (let i = 1; i < points.length; i++) {
            const p1 = points[i-1]; const p2 = points[i];
            const dist = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
            const step = effect === 'spray' ? Math.max(size/3, 4) : 2; 
            const steps = Math.ceil(dist / step);
            for (let j = 0; j < steps; j++) {
                const t = j / steps;
                const x = p1[0] + (p2[0] - p1[0]) * t;
                const y = p1[1] + (p2[1] - p1[1]) * t;
                if (effect === 'spray') {
                    const sprayRad = size * 2.5; 
                    for (let k = 0; k < 8; k++) {
                        const angle = Math.random() * Math.PI * 2;
                        const r = Math.random() * Math.random() * sprayRad;
                        ctx.fillRect(x + Math.cos(angle)*r, y + Math.sin(angle)*r, 1.5, 1.5);
                    }
                } else if (effect === 'chalk') {
                    for (let k = 0; k < 3; k++) {
                        const angle = Math.random() * Math.PI * 2;
                        const r = Math.random() * (size / 2);
                        const grain = 1 + Math.random() * 2;
                        ctx.fillRect(x + Math.cos(angle)*r, y + Math.sin(angle)*r, grain, grain);
                    }
                }
            }
        }
        ctx.restore();
    }

    // 4. EXISTING: Vector Engine (Pen/Brush)
    drawStroke(ctx, points, size, color, cfg, opacity = 1) {
        if (points.length < 2) return;
        const options = { size: size, thinning: cfg.thinning, smoothing: cfg.smoothing, streamline: cfg.streamline, start: cfg.start, end: cfg.end, simulatePressure: points[0].length < 3 || points[0][2] === 0.5 };
        const outline = getStroke(points, options);
        const path = new Path2D(this.getSvgPath(outline));
        ctx.save();
        ctx.globalCompositeOperation = cfg.composite;
        ctx.globalAlpha = opacity * (cfg.opacity || 1);
        ctx.fillStyle = color;
        ctx.fill(path);
        ctx.restore();
    }


    getSvgPath(stroke) {
        if (!stroke.length) return "";
        const d = stroke.reduce((acc, [x0, y0], i, arr) => { const [x1, y1] = arr[(i + 1) % arr.length]; acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2); return acc; }, ["M", ...stroke[0], "Q"]);
        d.push("Z"); return d.join(" ");
    }
    createTexture() {
        const c = document.createElement('canvas'); c.width=32; c.height=32; const x = c.getContext('2d');
        for(let i=0; i<300; i++) { x.fillStyle=`rgba(0,0,0,${Math.random()*0.15})`; x.fillRect(Math.random()*32, Math.random()*32, 1, 1); }
        return this.ctx.createPattern(c, 'repeat');
    }

    startGesture() {
        this.isGesture = true; this.isDrawing = false;
        const pts = Array.from(this.activePointers.values());
        this.gestStart = { dist: Vec.dist({x:pts[0].clientX, y:pts[0].clientY}, {x:pts[1].clientX, y:pts[1].clientY}), center: Vec.mid({x:pts[0].clientX, y:pts[0].clientY}, {x:pts[1].clientX, y:pts[1].clientY}), zoom: this.camera.zoom, cam: { ...this.camera } };
    }
    handleGesture() {
        const pts = Array.from(this.activePointers.values());
        const dist = Vec.dist({x:pts[0].clientX, y:pts[0].clientY}, {x:pts[1].clientX, y:pts[1].clientY});
        const center = Vec.mid({x:pts[0].clientX, y:pts[0].clientY}, {x:pts[1].clientX, y:pts[1].clientY});
        const scale = dist / this.gestStart.dist;
        this.camera.zoom = Math.max(0.1, Math.min(5, this.gestStart.zoom * scale));
        const dx = center.x - this.gestStart.center.x;
        const dy = center.y - this.gestStart.center.y;
        this.camera.x = this.gestStart.cam.x + dx;
        this.camera.y = this.gestStart.cam.y + dy;
        this.updateCamera();
    }
    updateCamera() { this.container.style.transform = `translate(${this.camera.x}px, ${this.camera.y}px) scale(${this.camera.zoom})`; }
    toWorld(x, y) { const rect = this.canvas.getBoundingClientRect(); return { x: (x - rect.left) * (this.width / rect.width), y: (y - rect.top) * (this.height / rect.height) }; }
    resetView() { const vp = document.getElementById('viewport'); const scale = Math.min(vp.clientWidth/this.width, vp.clientHeight/this.height) * 0.85; this.camera = { x: (vp.clientWidth - this.width*scale)/2, y: (vp.clientHeight - this.height*scale)/2, zoom: scale }; this.updateCamera(); }
    onWheel(e) { if (e.ctrlKey) { e.preventDefault(); this.camera.zoom = Math.max(0.1, Math.min(5, this.camera.zoom - e.deltaY * 0.002)); this.updateCamera(); } else { this.camera.x -= e.deltaX; this.camera.y -= e.deltaY; this.updateCamera(); } }

    setTool(t) {
        this.settings.tool = t;
        document.querySelectorAll('.case-tool').forEach(e => e.classList.remove('active')); 
        const el = document.getElementById('t-'+t);
        if(el) el.classList.add('active');
        
        const messages = { 
            pen: "Magic Marker!", pencil: "Sharp Pencil!", scissor: "Draw to cut! ✂️", bucket: "Fill it up!",
            rect: "Rectangle Tool", circle: "Circle Tool", line: "Line Tool", text: "Click to add Text"
        };
        this.showToast(messages[t] || "Let's draw!");
    }
        setColor(c) { 
        this.settings.color = c; 
        document.getElementById('curr-color').style.background = c;
        
        // If it's a hex code, try to parse it to update the Studio UI state
        if(c.startsWith('#') && c.length === 7) {
            const r = parseInt(c.slice(1,3), 16) / 255;
            const g = parseInt(c.slice(3,5), 16) / 255;
            const b = parseInt(c.slice(5,7), 16) / 255;
            
            // Simple RGB to HSV approximation for UI sync
            const max = Math.max(r, g, b), min = Math.min(r, g, b);
            let h, s, v = max;
            const d = max - min;
            s = max === 0 ? 0 : d / max;
            if(max === min) h = 0;
            else {
                switch(max) {
                    case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                    case g: h = (b - r) / d + 2; break;
                    case b: h = (r - g) / d + 4; break;
                }
                h /= 6;
            }
            this.colorState = { h: h*360, s: s, v: v };
        }
    }

    togglePicker() {
        this.settings.isPicking = !this.settings.isPicking;
        this.canvas.style.cursor = this.settings.isPicking ? 'url(https://api.iconify.design/mdi:eyedropper.svg?height=24) 0 24, auto' : 'crosshair';
        this.showToast(this.settings.isPicking ? 'Touch color to copy!' : 'Stopped copying');
    }

    updateSettings(k, v) { if(k === 'opacity') v = v/100; this.settings[k] = Number(v); }

    showToast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2000); }
    
    toggleProps(mode) {
        const p = document.getElementById('main-panel');
        const title = document.getElementById('panel-title');
        const content = document.getElementById('panel-content');

        if (!mode || (this.currentPanel === mode && p.classList.contains('active'))) { 
            p.classList.remove('active'); 
            this.currentPanel = null; 
            return; 
        }
        
        this.currentPanel = mode; 
        p.classList.add('active');
        
        if (mode === 'layers') {
            title.textContent = 'My Pages'; 
            content.innerHTML = this.layerManager.renderListHTML();
        } else if (mode === 'settings') {
            title.textContent = 'Studio Options';
            
            content.innerHTML = `
                <div style="margin-bottom:20px; border-bottom:2px solid #f1f5f9; padding-bottom:15px;">
                     <div style="font-size:14px; font-weight:600; color:#888; margin-bottom:8px;">FILTERS 🪄</div>
                     <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                        <button onclick="app.triggerFilter('grayscale')" class="btn-filter">BW</button>
                        <button onclick="app.triggerFilter('sepia')" class="btn-filter">Sepia</button>
                        <button onclick="app.triggerFilter('invert')" class="btn-filter">Invert</button>
                        <button onclick="app.saveToGallery()" style="grid-column:1/-1; margin-top:10px; padding:10px; background:#6366f1; color:white; border:none; border-radius:10px; font-weight:bold;">Save to Gallery</button>
                     </div>
                </div>

                <div style="margin-bottom:20px;">
                    <div style="font-size:14px; font-weight:600; color:#888; margin-bottom:8px;">CUSTOM COLOR 🎨</div>
                    <canvas id="custom-picker-cvs" width="200" height="150" 
                            style="border-radius:8px; border:2px solid #e2e8f0; cursor:crosshair;"
                            onclick="app.pickCustomColor(event)"></canvas>
                    <input type="range" min="0" max="1" step="0.01" style="width:100%; margin-top:5px;" 
                           oninput="app.drawReversePicker('custom-picker-cvs', Number(this.value))">
                </div>
                
                <div style="margin-bottom:20px;">
                    <div style="font-size:14px; font-weight:600; color:#888; margin-bottom:8px;">SYMMETRY</div>
                    <select onchange="app.setSymmetry(this.value)" style="width:100%; padding:10px; border-radius:12px; background:white; border:2px solid #eee; font-family:'Fredoka'; font-size:16px;">
                        <option value="none">Off</option><option value="x">Horizontal (X)</option><option value="y">Vertical (Y)</option><option value="quad">Quad (XY)</option>
                    </select>
                </div>

                <div class="layer-item" onclick="app.resetView()" style="margin-top:20px; font-weight:bold; color:#6366f1;">🔍 Fit to Screen</div>
                <div class="layer-item" onclick="app.layerManager.init(2400,1800); app.history=[]; app.redoStack=[]; app.requestRender();" style="color:var(--danger); font-weight:bold;">🗑️ Erase Everything</div>
            `;
            setTimeout(() => this.drawReversePicker('custom-picker-cvs', 0), 100);
        }
    }
    refreshUI() { if(this.currentPanel === 'layers') document.getElementById('panel-content').innerHTML = this.layerManager.renderListHTML(); }
    setSymmetry(val) { document.getElementById('sym-guide-x').style.display = (val === 'x' || val === 'quad') ? 'block' : 'none'; document.getElementById('sym-guide-y').style.display = (val === 'y' || val === 'quad') ? 'block' : 'none'; this.settings.symmetry = val; }
    requestRender() { requestAnimationFrame(() => this.composeLayers()); }
    composeLayers() { this.ctx.clearRect(0,0,this.width,this.height); this.layerManager.layers.forEach(l => { if(l.visible) { this.ctx.globalAlpha = l.opacity; this.ctx.globalCompositeOperation = l.blend; this.ctx.drawImage(l.canvas, 0, 0); } }); this.ctx.globalAlpha = 1; this.ctx.globalCompositeOperation = 'source-over'; }
}
window.app = new ProSketch();


