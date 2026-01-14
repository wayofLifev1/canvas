import { getStroke } from 'https://esm.sh/perfect-freehand@1.2.0';
import { Vec, DraggableDock, LayerManager, SoundManager } from './engine.js';

class ProSketch {
    constructor() {
        this.canvas = document.getElementById('main-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.container = document.getElementById('canvas-container');
        
        // Modules
        this.layerManager = new LayerManager(this);
        this.dock = new DraggableDock();
        this.sound = new SoundManager(); 
        
        this.scaleFactor = 2.5; 
        this.camera = { x: 0, y: 0, zoom: 1, rotation: 0 }; // Added rotation
        
        this.activePointers = new Map();
        this.points = [];
        this.isDrawing = false;
        this.isGesture = false;
        
        // Color State (H: 0-360, S: 0-1, V: 0-1)
        this.colorState = { h: 240, s: 1, v: 1 }; 
        this.recentColors = ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff'];
        
        this.lastTapTime = 0;
        this.touchStartTime = 0;
        this.maxTapTime = 300; // Increased for touch forgiveness
        this.snapTimer = null;
        this.isSnapped = false;
        this.snapStartPos = null;

        this.settings = { tool: 'pen', color: '#6366f1', size: 10, opacity: 1.0, symmetry: 'none', isPicking: false };
        this.history = []; this.redoStack = [];
        this.gallery = [];
        this.brushLibrary = []; // New: for custom brushes
        this.prefs = { darkMode: false, autoSaveInterval: 30000, muteSounds: false, minZoom: 0.25, maxZoom: 10 }; // New: preferences

        // --- TOOLS CONFIG --- Expanded with more params
        this.tools = {
            pencil: { type: 'textured', opacity: 0.85, composite: 'source-over', sizeMod: 1.2, spacing: 1, scatter: 0, angle: 0 },
            pen: { thinning: 0.5, smoothing: 0.5, streamline: 0.5, start: { taper: 15, easing: (t) => t }, end: { taper: 20, easing: (t) => t }, opacity: 1, composite: 'source-over', sizeMod: 1.0, spacing: 1, scatter: 0, angle: 0 },
            brush: { thinning: 0.7, smoothing: 0.8, streamline: 0.4, start: { taper: 20, easing: (t) => t * (2 - t) }, end: { taper: 30, easing: (t) => t * (2 - t) }, opacity: 0.9, composite: 'source-over', sizeMod: 2.5, spacing: 1, scatter: 0, angle: 0 },
            marker: { thinning: -0.1, smoothing: 0.4, streamline: 0.5, start: { taper: 0 }, end: { taper: 0 }, opacity: 0.5, composite: 'multiply', sizeMod: 4.0, spacing: 1, scatter: 0, angle: 0 },
            neon: { thinning: 0.5, smoothing: 0.5, streamline: 0.5, opacity: 1.0, composite: 'screen', sizeMod: 1.5, glow: true, spacing: 1, scatter: 0, angle: 0 },
            airbrush: { type: 'particle', effect: 'spray', opacity: 0.35, sizeMod: 8.0, spacing: 1, scatter: 0, angle: 0 },
            eraser: { type: 'eraser', sizeMod: 3.0, composite: 'destination-out', thinning:0, smoothing: 0.5, streamline: 0.5, spacing: 1, scatter: 0, angle: 0 },
            bucket: { type: 'fill', tolerance: 0 },
            scissor: { type: 'scissor', sizeMod: 1.0, composite: 'source-over' },
            rect: { type: 'shape', shape: 'rect', fill: false },
            circle: { type: 'shape', shape: 'circle', fill: false },
            line: { type: 'shape', shape: 'line' },
            text: { type: 'text' },
            lasso: { type: 'lasso' }, // New
            smudge: { type: 'smudge' }, // New
            gradient: { type: 'gradient' } // New
        };

        this.init();
    }

    init() {
        this.loadPrefs(); // New: load preferences
        this.loadRecentColors(); // New: persist recent colors
        this.width = 2400; this.height = 1800;
        this.adjustCanvasForDevice(); // New: device detection
        this.canvas.width = this.width; this.canvas.height = this.height;
        this.container.style.width = this.width + 'px'; this.container.style.height = this.height + 'px';
        this.container.style.transformOrigin = '0 0';
        this.layerManager.init(this.width, this.height);
        this.pencilPattern = this.createTexture();
        this.bindEvents();
        this.resetView();
        this.loadState();
        this.loadGallery();
        this.injectUI(); 
        this.injectColorStyles(); 
        this.requestRender();
        this.autoSaveTimer = setInterval(() => this.saveState(), this.prefs.autoSaveInterval); // New: auto-save
        this.showTutorialIfFirstLoad(); // New: tutorial
        window.addEventListener('resize', this.handleResize.bind(this)); // New: for auto-scale
    }

    loadPrefs() {
        const saved = localStorage.getItem('prosketch-prefs');
        if (saved) this.prefs = { ...this.prefs, ...JSON.parse(saved) };
    }

    savePrefs() {
        localStorage.setItem('prosketch-prefs', JSON.stringify(this.prefs));
    }

    loadRecentColors() {
        const saved = localStorage.getItem('prosketch-recent-colors');
        if (saved) this.recentColors = JSON.parse(saved);
    }

    saveRecentColors() {
        localStorage.setItem('prosketch-recent-colors', JSON.stringify(this.recentColors));
    }

    adjustCanvasForDevice() {
        if (/Mobi|Android/i.test(navigator.userAgent)) {
            this.width = 1200; this.height = 900; // Scale down for mobile
        }
    }

    handleResize() {
        this.resetView();
    }

    bindEvents() {
        const vp = document.getElementById('viewport') || document.body; // Fallback
        vp.style.touchAction = 'none'; 
        vp.addEventListener('pointerdown', this.onDown.bind(this), {passive:false});
        window.addEventListener('pointermove', this.onMove.bind(this), {passive:false});
        window.addEventListener('pointerup', this.onUp.bind(this));
        window.addEventListener('pointercancel', this.onUp.bind(this));
        vp.addEventListener('wheel', this.onWheel.bind(this), {passive:false});
        this.bindShortcuts();
        this.canvas.addEventListener('contextmenu', this.onRightClick.bind(this)); // New: right-click menu
    }

    onRightClick(e) {
        e.preventDefault();
        // Show context menu for tool options, etc.
        this.showContextMenu(e.clientX, e.clientY);
    }

    showContextMenu(x, y) {
        // Implement menu (e.g., div with options)
        console.log('Context menu at', x, y);
    }

    getPressure(p, e) { 
        // New: support tilt
        const tilt = e.tiltX || 0;
        return (1 - Math.cos(p * Math.PI)) / 2 * (1 + Math.sin(tilt * Math.PI / 180)); 
    }

    onDown(e) {
        e.preventDefault();
        if (this.settings.tool === 'text') { this.promptText(this.toWorld(e.clientX, e.clientY).x, this.toWorld(e.clientX, e.clientY).y); return; }
        if (this.settings.isPicking) { this.runPicker(e); return; }
        if (this.settings.tool === 'bucket') { this.runBucket(e); return; }

        this.touchStartTime = Date.now();
        this.activePointers.set(e.pointerId, e);
        
        if (this.activePointers.size === 2) { this.prepareGesture(); return; }
        if (this.activePointers.size === 3) { this.prepareRotateGesture(); return; } // New: three-finger rotate
        
        if (!this.isGesture && e.button === 0) {
            this.isDrawing = true;
            const pos = this.toWorld(e.clientX, e.clientY);
            const p = this.getPressure(e.pressure || 0.5, e);
            this.points = [[pos.x, pos.y, p], [pos.x + 0.1, pos.y + 0.1, p]];
            this.isSnapped = false;
            this.snapStartPos = pos;
            
            const shapes = ['rect', 'circle', 'line', 'text', 'bucket', 'scissor', 'lasso', 'gradient'];
            if (!shapes.includes(this.settings.tool)) {
                this.snapTimer = setTimeout(() => this.triggerSnap(), 600);
            }
        }
    }

    onMove(e) {
        if (this.activePointers.has(e.pointerId)) this.activePointers.set(e.pointerId, e);
        if (this.activePointers.size === 2) {
            this.isGesture = true;
            this.handleGesture(); return;
        }
        if (this.activePointers.size === 3) {
            this.isGesture = true;
            this.handleRotateGesture(); return; // New
        }
        
        if (this.isDrawing && this.activePointers.size === 1) {
            const pos = this.toWorld(e.clientX, e.clientY);
            const tool = this.tools[this.settings.tool];

            if (tool.type === 'shape' || tool.type === 'lasso' || tool.type === 'gradient') {
                this.points[1] = [pos.x, pos.y, e.pressure||0.5];
                this.renderLive();
                return;
            }
            if (this.isSnapped) { 
                this.points[this.points.length-1] = [pos.x, pos.y, e.pressure||0.5]; 
                this.renderLive(); 
                return; 
            }
            if (this.snapTimer && Vec.dist(pos, this.snapStartPos) > 30) { 
                clearTimeout(this.snapTimer); this.snapTimer = null; 
            }

            let coalesced = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]; // Fallback polyfill
            coalesced.forEach(ce => { 
                const p = this.toWorld(ce.clientX, ce.clientY); 
                const rawP = ce.pressure || 0.5;
                this.points.push([p.x, p.y, this.getPressure(rawP, ce)]); 
            });
            this.stabilizePoints(); // New: stroke stabilization
            this.renderLive();
        }
    }

    stabilizePoints() {
        // New: average last 5 points for smoothness
        if (this.points.length > 5) {
            const last = this.points.slice(-5);
            const avgX = last.reduce((sum, p) => sum + p[0], 0) / 5;
            const avgY = last.reduce((sum, p) => sum + p[1], 0) / 5;
            const avgP = last.reduce((sum, p) => sum + p[2], 0) / 5;
            this.points[this.points.length - 1] = [avgX, avgY, avgP];
        }
    }

    onUp(e) {
        const duration = Date.now() - this.touchStartTime;
        if (this.activePointers.size === 2 && duration < this.maxTapTime && !this.isGesture) { this.undo(); this.activePointers.delete(e.pointerId); return; }
        if (this.activePointers.size === 3 && duration < this.maxTapTime) { this.redo(); this.activePointers.delete(e.pointerId); return; }
        this.activePointers.delete(e.pointerId);
        clearTimeout(this.snapTimer);
        if (this.isGesture && this.activePointers.size < 2) { this.isGesture = false; }
        if (this.activePointers.size === 0) {
            this.isGesture = false;
            if (this.isDrawing) { this.isDrawing = false; this.commitStroke(); this.points = []; this.requestRender(); }
        }
        if (this.activePointers.size === 0) this.activePointers.clear(); // Cleanup
    }
    
    triggerSnap() {
        if (!this.isDrawing) return;
        this.isSnapped = true;
        if (!this.prefs.muteSounds) this.sound.play('pop'); 
        this.showToast("Straight Line! 📏");
        const start = this.points[0]; const end = this.points[this.points.length-1];
        this.points = [start, this.snapToAngle(start, end)]; // New: angle snapping
        this.renderLive();
        if (navigator.vibrate) navigator.vibrate(20);
    }

    snapToAngle(start, end) {
        // New: snap to 15° increments
        const dx = end[0] - start[0];
        const dy = end[1] - start[1];
        const angle = Math.atan2(dy, dx);
        const snappedAngle = Math.round(angle / (Math.PI / 12)) * (Math.PI / 12);
        const dist = Math.hypot(dx, dy);
        return [start[0] + Math.cos(snappedAngle) * dist, start[1] + Math.sin(snappedAngle) * dist, end[2]];
    }

    renderLive() {
        this.composeLayers();
        if (this.settings.tool === 'scissor' || this.settings.tool === 'lasso') { this.drawScissorPath(this.ctx, this.points); return; }
        const toolCfg = this.tools[this.settings.tool];
        if (toolCfg.type === 'shape' && this.points.length >= 2) {
            this.drawGeometricShape(this.ctx, this.points[0], this.points[1], toolCfg.shape, this.settings.color, this.settings.size, this.settings.opacity, toolCfg.fill);
            return;
        }
        if (toolCfg.type === 'gradient' && this.points.length >= 2) {
            this.drawGradient(this.ctx, this.points[0], this.points[1]);
            return;
        }
        const size = (this.settings.size * toolCfg.sizeMod) * (this.scaleFactor * 0.6); 
        this.drawSymmetry(this.ctx, this.points, size, this.settings.color, toolCfg, this.settings.opacity, this.settings.symmetry);
    }

    drawSymmetry(ctx, points, size, color, cfg, opacity = 1, symmetry = 'none') {
        const render = (pts) => {
            if (cfg.type === 'textured') {
                this.drawTexturedStroke(ctx, pts, size, color, 'pencil', opacity);
            } else if (cfg.type === 'particle') {
                this.drawParticles(ctx, pts, size, color, cfg.effect, opacity);
            } else if (cfg.type === 'smudge') {
                this.smudgeStroke(ctx, pts, size); // New
            } else {
                this.drawStroke(ctx, pts, size, color, cfg, opacity);
            }
        };
        render(points);
        const w = this.width, h = this.height;
        if (symmetry === 'x' || symmetry === 'quad') render(points.map(p => [w - p[0], p[1], p[2]]));
        if (symmetry === 'y' || symmetry === 'quad') render(points.map(p => [p[0], h - p[1], p[2]]));
        if (symmetry === 'quad') render(points.map(p => [w - p[0], h - p[1], p[2]]));
        if (symmetry === 'radial') this.drawRadialSymmetry(ctx, points, size, color, cfg, opacity); // New
    }

    drawRadialSymmetry(ctx, points, size, color, cfg, opacity) {
        // New: 8-way radial
        for (let i = 0; i < 8; i++) {
            const angle = (i * 45) * Math.PI / 180;
            const rotated = points.map(p => this.rotatePoint(p, angle, this.width / 2, this.height / 2));
            this.drawStroke(ctx, rotated, size, color, cfg, opacity);
        }
    }

    rotatePoint(point, angle, cx, cy) {
        const x = point[0] - cx;
        const y = point[1] - cy;
        return [
            cx + x * Math.cos(angle) - y * Math.sin(angle),
            cy + x * Math.sin(angle) + y * Math.cos(angle),
            point[2]
        ];
    }

    drawTexturedStroke(ctx, points, baseSize, color, tool, opacity) {
        if (points.length < 2) return;
        ctx.save();
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = opacity; ctx.fillStyle = color;
        const skip = points.length > 100 ? 2 : 1; 
        for (let i = 1; i < points.length; i += skip) {
            const p1 = points[i-skip]; const p2 = points[i];
            const dist = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
            if (dist < 1) continue; 
            const steps = Math.ceil(dist / 3); 
            const pressure1 = p1[2] || 0.5; const pressure2 = p2[2] || 0.5;
            const w1 = baseSize * (0.2 + pressure1 * 0.8); const w2 = baseSize * (0.2 + pressure2 * 0.8);
            const xDiff = p2[0] - p1[0]; const yDiff = p2[1] - p1[1]; const wDiff = w2 - w1;
            for (let j = 0; j < steps; j++) {
                const t = j / steps; const x = p1[0] + (xDiff * t); const y = p1[1] + (yDiff * t); const w = w1 + (wDiff * t);
                for(let d=0; d<3; d++) { 
                    const angle = Math.random() * 6.28; const offset = Math.random() * (w/2); 
                    ctx.beginPath(); ctx.rect(x + Math.cos(angle)*offset, y + Math.sin(angle)*offset, 1.5, 1.5); ctx.fill();
                } 
            }
        }
        ctx.restore();
    }

    drawStroke(ctx, points, size, color, cfg, opacity = 1) {
        if (points.length < 2) return;
        const options = { 
            size: size, thinning: cfg.thinning, smoothing: cfg.smoothing, 
            streamline: cfg.streamline, start: cfg.start, end: cfg.end, 
            simulatePressure: points[0].length < 3 || points[0][2] === 0.5 
        };
        const outline = getStroke(points, options);
        const path = new Path2D(this.getSvgPath(outline, false)); // New: optional close
        ctx.save();
        ctx.globalCompositeOperation = cfg.composite || 'source-over'; ctx.globalAlpha = opacity * (cfg.opacity || 1);
        if (cfg.glow) { ctx.shadowBlur = size * 1.5; ctx.shadowColor = color; ctx.fillStyle = '#ffffff'; ctx.fill(path); } 
        else { ctx.fillStyle = color; ctx.fill(path); }
        ctx.restore();
    }

    getSvgPath(stroke, close = true) {
        if (!stroke.length) return "";
        const d = stroke.reduce((acc, [x0, y0], i, arr) => { const [x1, y1] = arr[(i + 1) % arr.length]; acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2); return acc; }, ["M", ...stroke[0], "Q"]);
        if (close) d.push("Z"); 
        return d.join(" ");
    }

    drawParticles(ctx, points, size, color, effect, opacity) {
        if (points.length < 2) return;
        ctx.save(); ctx.fillStyle = color; ctx.globalAlpha = opacity;
        for (let i = 1; i < points.length; i++) {
            const p1 = points[i-1]; const p2 = points[i];
            const step = effect === 'spray' ? Math.max(size/3, 4) : 2; 
            const dist = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]); const steps = Math.ceil(dist / step);
            for (let j = 0; j < steps; j++) {
                const t = j / steps; const x = p1[0] + (p2[0] - p1[0]) * t; const y = p1[1] + (p2[1] - p1[1]) * t;
                if (effect === 'spray') {
                    const sprayRad = size * 2.5; 
                    for (let k = 0; k < 8; k++) {
                        const angle = Math.random() * Math.PI * 2; const r = Math.random() * Math.random() * sprayRad;
                        ctx.fillRect(x + Math.cos(angle)*r, y + Math.sin(angle)*r, 1.5, 1.5);
                    }
                }
            }
        }
        ctx.restore();
    }

    smudgeStroke(ctx, points, size) {
        // New: basic smudge - blend pixels
        points.forEach(p => {
            const imgData = ctx.getImageData(p[0] - size/2, p[1] - size/2, size, size);
            // Blend logic (average colors, etc.)
            ctx.putImageData(this.blendData(imgData), p[0] - size/2, p[1] - size/2);
        });
    }

    blendData(imgData) {
        // Implement blending
        return imgData; // Placeholder
    }

    createTexture() {
        const c = document.createElement('canvas'); c.width=64; c.height=64; 
        const x = c.getContext('2d');
        for(let i=0; i<500; i++) { x.fillStyle=`rgba(0,0,0,${Math.random()*0.2})`; x.fillRect(Math.random()*64, Math.random()*64, 2, 2); }
        return this.ctx.createPattern(c, 'repeat');
    }

    commitStroke() {
        let layer = this.layerManager.getActive();
        
        if (!layer || !layer.visible) {
            const firstVisible = this.layerManager.layers.find(l => l.visible);
            if (firstVisible) {
                this.layerManager.setActive(firstVisible.id);
                layer = firstVisible;
                this.showToast("Layer Auto-Selected 📄");
            } else {
                this.showToast("No Visible Layers! 🚫");
                return;
            }
        }

        if (this.settings.tool === 'scissor') { this.performScissorCut(layer, this.points); return; }
        if (this.settings.tool === 'lasso') { this.performLasso(layer, this.points); return; } // New

        const toolCfg = this.tools[this.settings.tool];
        
        if (toolCfg.type === 'shape') {
             if (this.points.length >= 2) {
                 this.drawGeometricShape(layer.ctx, this.points[0], this.points[1], toolCfg.shape, this.settings.color, this.settings.size, this.settings.opacity, toolCfg.fill);
                 this.history.push({ 
                     type: 'shape', layerId: layer.id, shape: toolCfg.shape, 
                     start: this.points[0], end: this.points[1], 
                     color: this.settings.color, size: this.settings.size, opacity: this.settings.opacity, fill: toolCfg.fill
                 });
             }
        } else if (toolCfg.type === 'gradient') {
            if (this.points.length >= 2) {
                this.drawGradient(layer.ctx, this.points[0], this.points[1]);
                this.history.push({
                    type: 'gradient', layerId: layer.id,
                    start: this.points[0], end: this.points[1]
                });
            }
        } else {
            const size = (this.settings.size * toolCfg.sizeMod) * (this.scaleFactor * 0.6); 
            this.drawSymmetry(layer.ctx, this.points, size, this.settings.color, toolCfg, this.settings.opacity, this.settings.symmetry);
            
            this.history.push({ 
                type: 'stroke', layerId: layer.id, 
                points: [...this.points], color: this.settings.color, 
                size, opacity: this.settings.opacity, symmetry: this.settings.symmetry,
                config: {...toolCfg} 
            });
        }
        this.redoStack = []; 
        this.trimHistory(); // New: limit history
        this.saveState(); 
    }

    trimHistory() {
        if (this.history.length > 50) this.history.shift();
    }

    undo() { 
        if(!this.history.length) { this.showToast('Nothing to Undo'); return; }
        const action = this.history.pop();
        if (!this.prefs.muteSounds) this.sound.play('undo'); 
        this.redoStack.push(action); 
        this.rebuildLayers(action.layerId); // Incremental possible, but keep for now
        this.showToast('Undo ↩️'); 
    }

    redo() { 
        if(!this.redoStack.length) { this.showToast('Nothing to Redo'); return; }
        const action = this.redoStack.pop();
        if (!this.prefs.muteSounds) this.sound.play('undo'); 
        this.history.push(action); 
        this.rebuildLayers(action.layerId); 
        this.showToast('Redo ↪️');
    }

    rebuildLayers(targetId = null) {
        let layersToUpdate = targetId ? this.layerManager.layers.filter(l => l.id === targetId) : this.layerManager.layers;
        layersToUpdate.forEach(l => l.ctx.clearRect(0, 0, this.width, this.height));

        this.history.forEach(act => { 
            if (targetId && act.layerId !== targetId) return;
            const l = this.layerManager.layers.find(x => x.id === act.layerId); 
            if(!l) return;

            if (act.type === 'stroke') {
                this.drawSymmetry(l.ctx, act.points, act.size, act.color, act.config, act.opacity, act.symmetry); 
            }
            else if (act.type === 'shape') this.drawGeometricShape(l.ctx, act.start, act.end, act.shape, act.color, act.size, act.opacity, act.fill);
            else if (act.type === 'text') this.addTextToCtx(l.ctx, act.x, act.y, act.text, act.color, act.size);
            else if (act.type === 'clear') l.ctx.clearRect(0,0,this.width, this.height);
            else if (act.type === 'fill') this.runFloodFillAlgorithm(l.ctx, act.x, act.y, act.color, act.tolerance); // Added tolerance
            else if (act.type === 'filter') this.applyFilter(act.filterType, l, true, act.intensity); // Added intensity
            else if (act.type === 'scissor') this.applyScissor(l.ctx, act.points);
            else if (act.type === 'image') l.ctx.drawImage(act.img, act.x, act.y, act.w, act.h);
            else if (act.type === 'gradient') this.drawGradient(l.ctx, act.start, act.end);
            else if (act.type === 'lasso') this.applyLasso(l, act.points); // New
        });
        this.requestRender();
    }

    drawGeometricShape(ctx, start, end, type, color, size, opacity, fill = false) {
        ctx.save(); ctx.beginPath(); ctx.strokeStyle = color; ctx.fillStyle = color;
        ctx.lineWidth = size * this.scaleFactor * 0.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha = opacity;
        const w = end[0] - start[0]; const h = end[1] - start[1];
        if (type === 'line') { ctx.moveTo(start[0], start[1]); ctx.lineTo(end[0], end[1]); } 
        else if (type === 'rect') { ctx.rect(start[0], start[1], w, h); } 
        else if (type === 'circle') { const cx = start[0] + w/2; const cy = start[1] + h/2; ctx.ellipse(cx, cy, Math.abs(w/2), Math.abs(h/2), 0, 0, Math.PI*2); }
        if (fill) ctx.fill();
        ctx.stroke(); ctx.restore();
    }

    drawGradient(ctx, start, end) {
        // New: simple linear gradient
        const grad = ctx.createLinearGradient(start[0], start[1], end[0], end[1]);
        grad.addColorStop(0, this.settings.color);
        grad.addColorStop(1, '#ffffff'); // Placeholder secondary color
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, this.width, this.height); // Fill whole or selected area
    }

    drawScissorPath(ctx, points) {
        if (points.length < 2) return;
        ctx.save(); ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2 / this.camera.zoom; ctx.setLineDash([10, 10]);
        ctx.beginPath(); ctx.moveTo(points[0][0], points[0][1]);
        for(let i=1; i<points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
        ctx.stroke(); ctx.restore();
    }

    performScissorCut(layer, points) {
        if (points.length < 3) return;
        this.applyScissor(layer.ctx, points);
        if (!this.prefs.muteSounds) this.sound.play('trash'); 
        this.history.push({ type: 'scissor', layerId: layer.id, points: [...points] });
        this.redoStack = []; this.saveState(); this.showToast("Cut Background! ✂️"); this.requestRender();
    }
    
    applyScissor(ctx, points) {
        ctx.save(); ctx.beginPath(); ctx.moveTo(points[0][0], points[0][1]);
        for(let i=1; i<points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
        ctx.closePath(); ctx.globalCompositeOperation = 'destination-in'; ctx.fillStyle = 'black'; ctx.fill(); ctx.restore();
    }

    performLasso(layer, points) {
        // New: select and move/copy
        this.applyLasso(layer, points);
        this.history.push({ type: 'lasso', layerId: layer.id, points: [...points] });
        this.requestRender();
    }

    applyLasso(layer, points) {
        // Placeholder: clip and copy to new layer or transform
    }

    promptText(x, y) {
        const text = prompt("Enter text (max 100 chars):", "").slice(0, 100);
        if (text) {
            const layer = this.layerManager.getActive(); const size = this.settings.size * 5;
            this.addTextToCtx(layer.ctx, x, y, text, this.settings.color, size);
            this.history.push({ type: 'text', layerId: layer.id, x, y, text, color: this.settings.color, size });
            this.requestRender();
        }
    }
    
    addTextToCtx(ctx, x, y, text, color, size) {
        ctx.save(); ctx.font = `bold ${size}px sans-serif`; ctx.fillStyle = color; ctx.fillText(text, x, y); ctx.restore();
    }

    injectUI() {
        const caseItems = document.getElementById('case-items');
        const tools = [
            { id: 't-bucket', icon: '🪣', tool: 'bucket' }, { id: 't-scissor', icon: '✂️', tool: 'scissor' },
            { id: 't-rect', icon: '⬜', tool: 'rect' }, { id: 't-circle', icon: '⭕', tool: 'circle' },
            { id: 't-line', icon: '📏', tool: 'line' }, { id: 't-text', icon: 'T', tool: 'text' },
            { id: 't-lasso', icon: '🔗', tool: 'lasso' }, // New
            { id: 't-smudge', icon: '🖐️', tool: 'smudge' }, // New
            { id: 't-gradient', icon: '🌈', tool: 'gradient' } // New
        ];
        tools.forEach(t => {
            if (!document.getElementById(t.id)) {
                const div = document.createElement('div'); div.className = 'case-tool'; div.id = t.id; div.onclick = () => this.setTool(t.tool); div.textContent = t.icon; caseItems.appendChild(div);
            }
        });
        const topBarRight = document.querySelector('.top-bar > div:last-child');
        if (!document.getElementById('btn-clear-layer')) {
            const div = document.createElement('div'); div.className = 'btn-icon'; div.id = 'btn-clear-layer'; div.title = "Clear Layer"; div.onclick = () => this.clearLayer(); div.textContent = '🗑️'; div.style.color = '#ef4444'; topBarRight.insertBefore(div, topBarRight.firstChild);
        }
        // New: add undo/redo buttons
        const undoBtn = document.createElement('div'); undoBtn.className = 'btn-icon'; undoBtn.onclick = () => this.undo(); undoBtn.textContent = '↩️'; topBarRight.appendChild(undoBtn);
        const redoBtn = document.createElement('div'); redoBtn.className = 'btn-icon'; redoBtn.onclick = () => this.redo(); redoBtn.textContent = '↪️'; topBarRight.appendChild(redoBtn);
    }
    
    injectColorStyles() {
        if(document.getElementById('cs-styles')) return;
        const css = `
        .cs-container { display:flex; flex-direction:column; align-items:center; gap:15px; width:100%; padding:10px; }
        .cs-sb-wrapper { position:relative; width:220px; height:220px; border-radius:12px; overflow:hidden; box-shadow:0 4px 10px rgba(0,0,0,0.1); touch-action:none; }
        .cs-hue-wrapper { position:relative; width:220px; height:30px; border-radius:15px; margin-top:5px; touch-action:none; }
        .cs-cursor { position:absolute; width:14px; height:14px; border:2px solid white; border-radius:50%; box-shadow:0 0 2px rgba(0,0,0,0.5); transform:translate(-50%, -50%); pointer-events:none; }
        .cs-slider-thumb { position:absolute; top:50%; width:14px; height:24px; background:white; border-radius:8px; border:1px solid #ccc; box-shadow:0 2px 4px rgba(0,0,0,0.2); transform:translate(-50%, -50%); pointer-events:none; }
        .cs-hex-row { display:flex; gap:10px; align-items:center; width:220px; justify-content:space-between; }
        .cs-hex-input { background:#f3f4f6; border:none; padding:8px 12px; border-radius:8px; font-family:monospace; font-size:14px; color:#444; width:100px; text-align:center; }
        .cs-swatch-grid { display:flex; gap:8px; width:220px; flex-wrap:wrap; margin-top:5px; }
        .cs-swatch { width:30px; height:30px; border-radius:50%; border:2px solid white; box-shadow:0 2px 4px rgba(0,0,0,0.1); cursor:pointer; }
        `;
        const s = document.createElement('style'); s.id = 'cs-styles'; s.innerHTML = css; document.head.appendChild(s);
    }

    setTool(t) {
        this.settings.tool = t;
        document.querySelectorAll('.case-tool').forEach(e => e.classList.remove('active')); 
        const el = document.getElementById('t-'+t); if(el) el.classList.add('active');
        if (!this.prefs.muteSounds) this.sound.play('click'); 
        this.showToast(t.toUpperCase() + " Selected");
    }

    setColor(c) { 
        try {
            // Validate hex
            if (!/^#[0-9A-F]{6}$/i.test(c)) throw new Error('Invalid hex');
            this.settings.color = c; 
            document.getElementById('curr-color').style.background = c; 
            if(!this.recentColors.includes(c)) {
                this.recentColors.unshift(c);
                if(this.recentColors.length > 7) this.recentColors.pop();
                this.saveRecentColors();
            }
            this.colorState = this.hexToHsv(c);
        } catch (e) {
            this.showToast('Invalid color!');
        }
    }
    
    updateSettings(k, v) { if(k === 'opacity') v = v/100; this.settings[k] = Number(v); }

    runPicker(e) {
        const pos = this.toWorld(e.clientX, e.clientY);
        const pixel = this.ctx.getImageData(pos.x - 1, pos.y - 1, 3, 3).data; // New: average 3x3
        let r = 0, g = 0, b = 0;
        for (let i = 0; i < pixel.length; i += 4) {
            r += pixel[i]; g += pixel[i+1]; b += pixel[i+2];
        }
        r /= 9; g /= 9; b /= 9;
        const hex = "#" + ((1 << 24) + (Math.round(r) << 16) + (Math.round(g) << 8) + Math.round(b)).toString(16).slice(1);
        this.setColor(hex); this.showToast(`Copied Color! 🎨`); this.settings.isPicking = false; 
    }

    runBucket(e) {
        const pos = this.toWorld(e.clientX, e.clientY);
        const layer = this.layerManager.getActive();
        if (layer && layer.visible) {
            this.showToast("Filling... ⏳");
            if (!this.prefs.muteSounds) this.sound.play('pop'); 
            setTimeout(() => {
                this.runFloodFillAlgorithm(layer.ctx, Math.floor(pos.x), Math.floor(pos.y), this.settings.color, this.tools.bucket.tolerance);
                this.history.push({ type: 'fill', layerId: layer.id, x: Math.floor(pos.x), y: Math.floor(pos.y), color: this.settings.color, tolerance: this.tools.bucket.tolerance });
                this.requestRender(); this.saveState(); this.showToast("Filled! 🪣");
            }, 10);
        }
    }
    
    runFloodFillAlgorithm(ctx, startX, startY, fillColorHex, tolerance = 0) {
        const w = this.width; const h = this.height;
        const imageData = ctx.getImageData(0, 0, w, h); const data = imageData.data;
        const r = parseInt(fillColorHex.slice(1,3), 16); const g = parseInt(fillColorHex.slice(3,5), 16); const b = parseInt(fillColorHex.slice(5,7), 16); const a = 255;
        const startIdx = (startY * w + startX) * 4;
        const startR = data[startIdx], startG = data[startIdx+1], startB = data[startIdx+2], startA = data[startIdx+3];
        if (Math.abs(startR - r) <= tolerance && Math.abs(startG - g) <= tolerance && Math.abs(startB - b) <= tolerance && startA === a) return;
        const stack = [[startX, startY]];
        while (stack.length) {
            const [cx, cy] = stack.pop();
            const idx = (cy * w + cx) * 4;
            if (cx < 0 || cx >= w || cy < 0 || cy >= h) continue;
            if (Math.abs(data[idx] - startR) <= tolerance && Math.abs(data[idx+1] - startG) <= tolerance && Math.abs(data[idx+2] - startB) <= tolerance && data[idx+3] === startA) {
                data[idx] = r; data[idx+1] = g; data[idx+2] = b; data[idx+3] = a;
                stack.push([cx+1, cy]); stack.push([cx-1, cy]); stack.push([cx, cy+1]); stack.push([cx, cy-1]);
            }
        }
        ctx.putImageData(imageData, 0, 0);
    }

    prepareGesture() {
        this.isDrawing = false;
        const pts = Array.from(this.activePointers.values());
        const p1 = {x:pts[0].clientX, y:pts[0].clientY}; const p2 = {x:pts[1].clientX, y:pts[1].clientY};
        this.gestStart = { dist: Vec.dist(p1, p2), center: Vec.mid(p1, p2), zoom: this.camera.zoom, cam: { ...this.camera } };
    }

    handleGesture() {
        const pts = Array.from(this.activePointers.values());
        const p1 = {x:pts[0].clientX, y:pts[0].clientY}; const p2 = {x:pts[1].clientX, y:pts[1].clientY};
        const dist = Vec.dist(p1, p2); const center = Vec.mid(p1, p2); const scale = dist / this.gestStart.dist;
        this.camera.zoom = Math.max(this.prefs.minZoom, Math.min(this.prefs.maxZoom, this.gestStart.zoom * scale));
        const dx = center.x - this.gestStart.center.x; const dy = center.y - this.gestStart.center.y;
        this.camera.x = this.gestStart.cam.x + dx; this.camera.y = this.gestStart.cam.y + dy;
        this.updateCamera();
    }

    prepareRotateGesture() {
        // New
        const pts = Array.from(this.activePointers.values());
        this.rotateStart = { angle: this.getAngleFromPoints(pts), rotation: this.camera.rotation };
    }

    handleRotateGesture() {
        // New
        const pts = Array.from(this.activePointers.values());
        const angle = this.getAngleFromPoints(pts);
        this.camera.rotation = this.rotateStart.rotation + (angle - this.rotateStart.angle);
        this.updateCamera();
    }

    getAngleFromPoints(pts) {
        // Calculate average angle
        return Math.atan2(pts[1].clientY - pts[0].clientY, pts[1].clientX - pts[0].clientX);
    }

    updateCamera() { 
        this.container.style.transform = `translate(${this.camera.x}px, \( {this.camera.y}px) rotate( \){this.camera.rotation}deg) scale(${this.camera.zoom})`; 
    }

    toWorld(x, y) { 
        const rect = this.canvas.getBoundingClientRect(); // Cache if perf issue
        return { x: (x - rect.left) * (this.width / rect.width), y: (y - rect.top) * (this.height / rect.height) }; 
    }

    resetView() { 
        const vp = document.getElementById('viewport') || { clientWidth: window.innerWidth, clientHeight: window.innerHeight };
        const scale = Math.min(vp.clientWidth/this.width, vp.clientHeight/this.height) * 0.85; 
        this.camera = { x: (vp.clientWidth - this.width*scale)/2, y: (vp.clientHeight - this.height*scale)/2, zoom: scale, rotation: 0 }; 
        this.updateCamera(); 
    }

    onWheel(e) { 
        if (e.ctrlKey) { 
            e.preventDefault(); 
            const zoomDelta = -e.deltaY * 0.002;
            const oldZoom = this.camera.zoom;
            this.camera.zoom = Math.max(this.prefs.minZoom, Math.min(this.prefs.maxZoom, this.camera.zoom + zoomDelta));
            // New: zoom to cursor
            const rect = this.canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            this.camera.x -= mx * (this.camera.zoom - oldZoom);
            this.camera.y -= my * (this.camera.zoom - oldZoom);
            this.updateCamera(); 
        } else { 
            this.camera.x -= e.deltaX; this.camera.y -= e.deltaY; this.updateCamera(); 
        } 
    }

    saveState() {
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(() => {
            try { 
                // New: save layers as JSON for editable
                const layersData = this.layerManager.layers.map(l => l.canvas.toDataURL());
                localStorage.setItem('prosketch-layers', JSON.stringify(layersData)); 
                const data = this.canvas.toDataURL('image/png', 0.5); localStorage.setItem('prosketch-kids', data); 
            } catch (e) {}
        }, 1000);
    }

    loadState() {
        const data = localStorage.getItem('prosketch-kids');
        const layersData = localStorage.getItem('prosketch-layers');
        if (layersData) {
            const parsed = JSON.parse(layersData);
            parsed.forEach((src, i) => {
                if (this.layerManager.layers[i]) {
                    const img = new Image(); img.onload = () => { this.layerManager.layers[i].ctx.drawImage(img, 0, 0); this.requestRender(); };
                    img.src = src;
                }
            });
        } else if (data) {
            const img = new Image(); img.onload = () => { const layer = this.layerManager.layers[0]; layer.ctx.clearRect(0, 0, this.width, this.height); layer.ctx.drawImage(img, 0, 0); this.requestRender(); };
            img.src = data;
        }
        this.colorState = this.hexToHsv(this.settings.color); // Sync
    }

    showToast(msg) { 
        const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2000); 
    }

    requestRender() { requestAnimationFrame(() => this.composeLayers()); }

    composeLayers() { 
        this.ctx.clearRect(0,0,this.width,this.height); 
        this.layerManager.layers.forEach(l => { if(l.visible) { this.ctx.globalAlpha = l.opacity; this.ctx.globalCompositeOperation = l.blend; this.ctx.drawImage(l.canvas, 0, 0); } }); 
        this.ctx.globalAlpha = 1; this.ctx.globalCompositeOperation = 'source-over'; 
    }
    
    toggleProps(mode) {
        const p = document.getElementById('main-panel');
        if (!mode || (this.currentPanel === mode && p.classList.contains('active'))) { p.classList.remove('active'); this.currentPanel = null; return; }
        this.currentPanel = mode; p.classList.add('active');
        document.getElementById('panel-title').textContent = mode === 'layers' ? 'My Pages' : 'Studio Options';
        this.refreshUI();
    }

    fullReset() {
        this.layerManager.init(2400, 1800);
        this.history = []; this.redoStack = []; this.points = [];
        this.requestRender();
    }

    refreshUI() {
        const content = document.getElementById('panel-content'); if(!content || !this.currentPanel) return;
        if(this.currentPanel === 'layers') { content.innerHTML = this.layerManager.renderListHTML(); } 
        else if(this.currentPanel === 'settings') {
            content.innerHTML = `
                <div style="margin-bottom:20px;">
                     <div style="font-size:14px; font-weight:600; color:#888;">FILTERS 🪄</div>
                     <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:10px;">
                        <button onclick="app.triggerFilter('grayscale')" class="btn-filter">BW</button>
                        <button onclick="app.triggerFilter('sepia')" class="btn-filter">Sepia</button>
                        <button onclick="app.triggerFilter('invert')" class="btn-filter">Invert</button>
                        <button onclick="app.triggerFilter('blur')" class="btn-filter">Blur</button> <!-- New -->
                     </div>
                </div>
                <div class="layer-item" onclick="app.resetView()" style="font-weight:bold; color:#6366f1;">🔍 Fit to Screen</div>
                <div class="layer-item" onclick="app.fullReset()" style="color:var(--danger); font-weight:bold;">🗑️ Clear All</div>
                <div class="layer-item" onclick="app.toggleDarkMode()" style="font-weight:bold;">🌙 Dark Mode</div> <!-- New -->
            `;
        }
    }

    toggleDarkMode() {
        this.prefs.darkMode = !this.prefs.darkMode;
        document.body.classList.toggle('dark-mode', this.prefs.darkMode);
        this.savePrefs();
    }

    triggerFilter(type) {
        const layer = this.layerManager.getActive(); if(!layer) return;
        this.applyFilter(type, layer, 1); // Intensity
        this.history.push({ type: 'filter', layerId: layer.id, filterType: type, intensity: 1 }); this.requestRender();
    }

    applyFilter(type, layer, isReplay=false, intensity = 1) {
        const imgData = layer.ctx.getImageData(0,0, this.width, this.height); const data = imgData.data;
        // Use worker for large
        const worker = new Worker('data:application/javascript,' + encodeURIComponent(`
            self.onmessage = function(e) {
                const data = e.data.data;
                const type = e.data.type;
                const intensity = e.data.intensity;
                for(let i=0; i<data.length; i+=4) {
                    const r = data[i], g = data[i+1], b = data[i+2];
                    if (type === 'grayscale') { const v = 0.3*r + 0.59*g + 0.11*b; data[i]=data[i+1]=data[i+2]=v; }
                    else if (type === 'invert') { data[i]=255-r; data[i+1]=255-g; data[i+2]=255-b; }
                    else if (type === 'sepia') { data[i] = (r * .393) + (g *.769) + (b * .189); data[i+1] = (r * .349) + (g *.686) + (b * .168); data[i+2] = (r * .272) + (g *.534) + (b * .131); }
                    else if (type === 'blur') { /* Simple blur placeholder */ }
                    // Clamp
                    data[i] = Math.min(255, Math.max(0, data[i])); // etc.
                }
                self.postMessage({data});
            };
        `));
        worker.onmessage = (e) => {
            imgData.data.set(e.data.data);
            layer.ctx.putImageData(imgData, 0, 0);
        };
        worker.postMessage({data: new Uint8ClampedArray(data.buffer), type, intensity});
    }

    toggleGalleryModal(show) { document.getElementById('gallery-modal').style.display = show ? 'flex' : 'none'; if(show) this.refreshGalleryModal(); }
    toggleTemplateModal(show) { document.getElementById('template-modal').style.display = show === false ? 'none' : 'flex'; }
    toggleColorStudio(show) { 
        document.getElementById('color-studio-modal').style.display = show ? 'flex' : 'none'; 
        if(show) this.initColorStudio(); 
    }
    
    bindShortcuts() {
        window.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
            if (e.key === '[') { this.updateSettings('size', Math.max(1, this.settings.size - 2)); this.showToast(`Size: ${this.settings.size}`); }
            if (e.key === ']') { this.updateSettings('size', Math.min(100, this.settings.size + 2)); this.showToast(`Size: ${this.settings.size}`); }
            if (e.key === 'b') this.setTool('brush');
            if (e.key === 'e') this.setTool('eraser');
            // More shortcuts
        });
    }

    saveToGallery() {
        try {
            const thumbCanvas = document.createElement('canvas'); const w = 300, h = 225; thumbCanvas.width = w; thumbCanvas.height = h;
            const tCtx = thumbCanvas.getContext('2d'); tCtx.fillStyle = '#ffffff'; tCtx.fillRect(0, 0, w, h); tCtx.drawImage(this.canvas, 0, 0, w, h);
            const thumbData = thumbCanvas.toDataURL('image/jpeg', 0.8);
            
            const workCanvas = document.createElement('canvas'); const scale = Math.min(800 / this.width, 800 / this.height);
            workCanvas.width = this.width * scale; workCanvas.height = this.height * scale;
            const wCtx = workCanvas.getContext('2d'); wCtx.fillStyle = '#ffffff'; wCtx.fillRect(0, 0, workCanvas.width, workCanvas.height); wCtx.drawImage(this.canvas, 0, 0, workCanvas.width, workCanvas.height);
            const fullData = workCanvas.toDataURL('image/jpeg', 0.8);

            const artItem = { id: Date.now(), date: new Date().toLocaleDateString(), thumb: thumbData, full: fullData };
            this.gallery.unshift(artItem); // No limit, add pagination in UI
            localStorage.setItem('prosketch-gallery', JSON.stringify(this.gallery)); this.showToast('Saved to Gallery! 📸'); 
            if (!this.prefs.muteSounds) this.sound.play('pop'); 
            this.refreshGalleryModal();
        } catch(e) { this.showToast('Storage Full! 📂'); }
    }

    loadGallery() { try { const g = localStorage.getItem('prosketch-gallery'); if(g) this.gallery = JSON.parse(g); } catch(e) {} }

    deleteFromGallery(id) { 
        if (confirm('Delete this art?')) {
            this.gallery = this.gallery.filter(item => item.id !== id); 
            localStorage.setItem('prosketch-gallery', JSON.stringify(this.gallery)); 
            if (!this.prefs.muteSounds) this.sound.play('trash'); 
            this.refreshGalleryModal(); 
        }
    }

    loadFromGallery(id) {
        const item = this.gallery.find(x => x.id === id); if (!item) return; this.showToast("Loading Art... ⏳");
        const img = new Image(); img.onload = () => { const newLayer = this.layerManager.addLayer('Loaded Art'); newLayer.ctx.drawImage(img, 0, 0, this.width, this.height); this.requestRender(); this.toggleGalleryModal(false); this.showToast('Art Loaded! 🎨'); };
        img.src = item.full || item.thumb;
    }

    downloadFromGallery(id) {
        const item = this.gallery.find(x => x.id === id); if (!item) return;
        const link = document.createElement('a'); link.download = `Art-${id}.jpg`; link.href = item.full || item.thumb; 
        document.body.appendChild(link); link.click(); document.body.removeChild(link);
    }

    refreshGalleryModal() {
        const grid = document.getElementById('gallery-grid'); if (!grid) return;
        if (this.gallery.length === 0) { grid.innerHTML = `<div style="text-align:center; color:#999; grid-column:1/-1;">No saved art yet! 🎨</div>`; return; }
        grid.innerHTML = this.gallery.map(item => `
            <div class="gallery-card"><img src="\( {item.thumb}" onclick="app.loadFromGallery( \){item.id})"><div class="gallery-actions"><span>\( {item.date}</span><div style="display:flex; gap:10px;"><span onclick="app.downloadFromGallery( \){item.id})" style="color:#6366f1; cursor:pointer;" title="Download PNG">⬇️</span><span onclick="app.deleteFromGallery(${item.id})" style="color:#ef4444; cursor:pointer;" title="Delete">🗑️</span></div></div></div>`).join('');
    }

    loadTemplate(type) {
        this.toggleTemplateModal(false);
        const guideLayer = this.layerManager.addLayer('Guide'); const ctx = guideLayer.ctx;
        const w = this.width; const h = this.height; const cx = w / 2; const cy = h / 2;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round'; const isColoring = type.startsWith('color');
        if (isColoring) { ctx.strokeStyle = '#000000'; ctx.lineWidth = 15; ctx.setLineDash([]); } else { ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 10; ctx.setLineDash([25, 30]); }
        ctx.beginPath();
        if (type === 'line-h') { for(let i=1; i<5; i++) { const y = (h/5)*i; ctx.moveTo(200, y); ctx.lineTo(w-200, y); } } 
        else if (type === 'line-z') { const step = 200; ctx.moveTo(100, cy); for(let x=100; x<w-100; x+=step) { ctx.lineTo(x + step/2, cy - 300); ctx.lineTo(x + step, cy + 300); } }
        else if (type === 'shape-circle') { ctx.arc(cx, cy, 500, 0, Math.PI*2); }
        else if (type === 'color-sun') { ctx.arc(cx, cy, 250, 0, Math.PI*2); for(let i=0; i<8; i++) { const angle = (i * 45) * Math.PI / 180; ctx.moveTo(cx + Math.cos(angle)*300, cy + Math.sin(angle)*300); ctx.lineTo(cx + Math.cos(angle)*500, cy + Math.sin(angle)*500); } }
        ctx.stroke(); this.requestRender(); this.showToast(isColoring ? "Ready to Color! 🖍️" : "Trace the lines! ✏️");
        if (!isColoring) { const drawLayer = this.layerManager.addLayer('Practice Layer'); this.layerManager.setActive(drawLayer.id); guideLayer.opacity = 0.6; } 
    }

    handleUpload(input) {
        const file = input.files[0]; if (!file) return; const reader = new FileReader();
        reader.onload = (e) => { 
            const img = new Image(); 
            img.onload = () => { 
                const newLayer = this.layerManager.addLayer('Imported Image'); 
                const scale = Math.min(this.width / img.width, this.height / img.height); 
                const w = img.width * scale; const h = img.height * scale; 
                const x = (this.width - w) / 2; const y = (this.height - h) / 2; 
                newLayer.ctx.drawImage(img, x, y, w, h); 
                this.history.push({ type: 'image', layerId: newLayer.id, img: img, x:x, y:y, w:w, h:h });
                this.redoStack = [];
                this.requestRender(); this.showToast('Image Imported! 📷'); input.value = ''; 
            }; 
            img.src = e.target.result; 
        }; 
        reader.readAsDataURL(file);
    }

    clearLayer() { 
        const layer = this.layerManager.getActive(); 
        if(layer) { 
            layer.ctx.clearRect(0,0,this.width,this.height); 
            this.history.push({type:'clear', layerId:layer.id}); 
            if (!this.prefs.muteSounds) this.sound.play('trash'); 
            this.requestRender(); 
        } 
    }

    deleteLayer(id) {
        if (this.layerManager.layers.length <= 1) { this.showToast('Cannot delete the last layer!'); return; }
        this.history = this.history.filter(act => act.layerId !== id);
        this.redoStack = this.redoStack.filter(act => act.layerId !== id);
        this.layerManager.layers = this.layerManager.layers.filter(l => l.id !== id);
        if (this.layerManager.activeLayer === id) {
            this.layerManager.activeLayer = this.layerManager.layers[this.layerManager.layers.length - 1]?.id;
        }
        this.rebuildLayers();
        this.refreshUI();
        this.requestRender();
        this.saveState();
        this.showToast('Layer Deleted 🗑️');
    }

    initColorStudio() {
        const modal = document.getElementById('color-studio-modal');
        modal.innerHTML = `
            <div style="pointer-events: auto; background:white; padding:20px; border-radius:24px; box-shadow:0 10px 40px rgba(0,0,0,0.2); width:320px; display:flex; flex-direction:column; align-items:center;">
                <div style="width:100%; display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <h3 style="margin:0; color:#333;">Color Studio</h3>
                    <button onclick="app.toggleColorStudio(false)" style="background:none; border:none; font-size:20px; cursor:pointer;">✕</button>
                </div>
                <div class="cs-container">
                    <div class="cs-sb-wrapper" id="cs-sb-box">
                        <canvas id="cs-sb-canvas" width="220" height="220"></canvas>
                        <div id="cs-sb-cursor" class="cs-cursor"></div>
                    </div>
                    <div class="cs-hue-wrapper" id="cs-hue-rail">
                        <canvas id="cs-hue-canvas" width="220" height="30" style="border-radius:15px;"></canvas>
                        <div id="cs-hue-thumb" class="cs-slider-thumb"></div>
                    </div>
                    <div class="cs-hex-row">
                        <input id="cs-hex-input" class="cs-hex-input" value="${this.settings.color}" maxlength="7" spellcheck="false">
                        <div id="cs-preview" style="width:40px; height:40px; border-radius:10px; background:${this.settings.color}; box-shadow:inset 0 0 0 1px rgba(0,0,0,0.1);"></div>
                    </div>
                    <div class="cs-swatch-grid" id="cs-recent-grid"></div>
                </div>
            </div>
        `;
        
        const sbCanvas = document.getElementById('cs-sb-canvas');
        const hueCanvas = document.getElementById('cs-hue-canvas');
        const sbCtx = sbCanvas.getContext('2d');
        const hueCtx = hueCanvas.getContext('2d');
        
        const hueGrad = hueCtx.createLinearGradient(0, 0, hueCanvas.width, 0);
        for(let i=0; i<=360; i+=60) hueGrad.addColorStop(i/360, `hsl(${i}, 100%, 50%)`);
        hueCtx.fillStyle = hueGrad; hueCtx.fillRect(0,0, hueCanvas.width, hueCanvas.height);
        
        const renderSwatches = () => {
            const grid = document.getElementById('cs-recent-grid');
            grid.innerHTML = this.recentColors.map(c => `<div class="cs-swatch" style="background:\( {c}" onclick="app.setColor(' \){c}'); app.toggleColorStudio(false);"></div>`).join('');
        };
        renderSwatches();

        this.colorState = this.hexToHsv(this.settings.color);

        const updateUI = () => {
            sbCtx.fillStyle = `hsl(${this.colorState.h}, 100%, 50%)`;
            sbCtx.fillRect(0, 0, 220, 220);
            const whiteGrad = sbCtx.createLinearGradient(0,0,220,0);
            whiteGrad.addColorStop(0, 'white'); whiteGrad.addColorStop(1, 'rgba(255,255,255,0)');
            sbCtx.fillStyle = whiteGrad; sbCtx.fillRect(0,0,220,220);
            const blackGrad = sbCtx.createLinearGradient(0,0,0,220);
            blackGrad.addColorStop(0, 'transparent'); blackGrad.addColorStop(1, 'black');
            sbCtx.fillStyle = blackGrad; sbCtx.fillRect(0,0,220,220);
            
            const hueX = (this.colorState.h / 360) * 220;
            const sbX = this.colorState.s * 220;
            const sbY = (1 - this.colorState.v) * 220;
            
            document.getElementById('cs-hue-thumb').style.left = hueX + 'px';
            document.getElementById('cs-sb-cursor').style.left = sbX + 'px';
            document.getElementById('cs-sb-cursor').style.top = sbY + 'px';
            
            const hex = this.hsvToHex(this.colorState.h, this.colorState.s, this.colorState.v);
            document.getElementById('cs-preview').style.background = hex;
            document.getElementById('cs-hex-input').value = hex;
            this.setColor(hex);
        };
        
        const handleSB = (e) => {
            const rect = sbCanvas.getBoundingClientRect();
            let x = Math.max(0, Math.min(220, e.clientX - rect.left));
            let y = Math.max(0, Math.min(220, e.clientY - rect.top));
            this.colorState.s = x / 220;
            this.colorState.v = 1 - (y / 220);
            updateUI();
        };
        
        const handleHue = (e) => {
            const rect = hueCanvas.getBoundingClientRect();
            let x = Math.max(0, Math.min(220, e.clientX - rect.left));
            this.colorState.h = (x / 220) * 360;
            updateUI();
        };

        const sbBox = document.getElementById('cs-sb-box');
        sbBox.onpointerdown = (e) => { sbBox.setPointerCapture(e.pointerId); handleSB(e); sbBox.onpointermove = handleSB; };
        sbBox.onpointerup = () => { sbBox.onpointermove = null; };
        
        const hueRail = document.getElementById('cs-hue-rail');
        hueRail.onpointerdown = (e) => { hueRail.setPointerCapture(e.pointerId); handleHue(e); hueRail.onpointermove = handleHue; };
        hueRail.onpointerup = () => { hueRail.onpointermove = null; };
        
        document.getElementById('cs-hex-input').onchange = (e) => {
            this.setColor(e.target.value); updateUI(); 
        };

        updateUI();
    }

    hsvToHex(h, s, v) {
        let r, g, b, i, f, p, q, t;
        h = h / 360; i = Math.floor(h * 6); f = h * 6 - i;
        p = v * (1 - s); q = v * (1 - f * s); t = v * (1 - (1 - f) * s);
        switch (i % 6) {
            case 0: r = v; g = t; b = p; break;
            case 1: r = q; g = v; b = p; break;
            case 2: r = p; g = v; b = t; break;
            case 3: r = p; g = q; b = v; break;
            case 4: r = t; g = p; b = v; break;
            case 5: r = v; g = p; b = q; break;
        }
        const toHex = x => { const val = Math.round(x * 255).toString(16); return val.length === 1 ? '0' + val : val; };
        return `#\( {toHex(r)} \){toHex(g)}${toHex(b)}`;
    }

    hexToHsv(hex) {
        let r = parseInt(hex.slice(1, 3), 16) / 255;
        let g = parseInt(hex.slice(3, 5), 16) / 255;
        let b = parseInt(hex.slice(5, 7), 16) / 255;
        let max = Math.max(r, g, b), min = Math.min(r, g, b);
        let delta = max - min;
        let h = 0, s = max === 0 ? 0 : delta / max, v = max;
        if (delta === 0) return { h: 0, s: 0, v };
        if (max === r) h = (g - b) / delta + (g < b ? 6 : 0);
        else if (max === g) h = (b - r) / delta + 2;
        else h = (r - g) / delta + 4;
        h *= 60;
        return { h, s, v };
    }

    showTutorialIfFirstLoad() {
        if (!localStorage.getItem('prosketch-first-load')) {
            alert('Welcome to ProSketch! Tutorial...');
            localStorage.setItem('prosketch-first-load', 'true');
        }
    }
}
window.app = new ProSketch();
