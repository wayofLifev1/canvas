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
        this.camera = { x: 0, y: 0, zoom: 1 };
        
        this.activePointers = new Map();
        this.points = [];
        this.isDrawing = false;
        this.isGesture = false;
        
        // Color State (H: 0-360, S: 0-1, V: 0-1)
        this.colorState = { h: 240, s: 1, v: 1 }; 
        this.recentColors = ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff'];
        
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
            pencil: { type: 'textured', opacity: 0.85, composite: 'source-over', sizeMod: 1.2 },
            pen: { thinning: 0.5, smoothing: 0.5, streamline: 0.5, start: { taper: 15, easing: (t) => t }, end: { taper: 20, easing: (t) => t }, opacity: 1, composite: 'source-over', sizeMod: 1.0 },
            brush: { thinning: 0.7, smoothing: 0.8, streamline: 0.4, start: { taper: 20, easing: (t) => t * (2 - t) }, end: { taper: 30, easing: (t) => t * (2 - t) }, opacity: 0.9, composite: 'source-over', sizeMod: 2.5 },
            marker: { thinning: -0.1, smoothing: 0.4, streamline: 0.5, start: { taper: 0 }, end: { taper: 0 }, opacity: 0.5, composite: 'multiply', sizeMod: 4.0 },
            neon: { thinning: 0.5, smoothing: 0.5, streamline: 0.5, opacity: 1.0, composite: 'screen', sizeMod: 1.5, glow: true },
            airbrush: { type: 'particle', effect: 'spray', opacity: 0.35, sizeMod: 8.0 },
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
        this.injectColorStyles(); // Add styles for new picker
        this.requestRender();
    }

    bindEvents() {
        const vp = document.getElementById('viewport');
        vp.style.touchAction = 'none'; 
        vp.addEventListener('pointerdown', this.onDown.bind(this), {passive:false});
        window.addEventListener('pointermove', this.onMove.bind(this), {passive:false});
        window.addEventListener('pointerup', this.onUp.bind(this));
        window.addEventListener('pointercancel', this.onUp.bind(this));
        vp.addEventListener('wheel', this.onWheel.bind(this), {passive:false});
        this.bindShortcuts();
    }

    getPressure(p) { return (1 - Math.cos(p * Math.PI)) / 2; }

    onDown(e) {
        e.preventDefault();
        if (this.settings.tool === 'text') { this.promptText(this.toWorld(e.clientX, e.clientY).x, this.toWorld(e.clientX, e.clientY).y); return; }
        if (this.settings.isPicking) { this.runPicker(e); return; }
        if (this.settings.tool === 'bucket') { this.runBucket(e); return; }

        this.touchStartTime = Date.now();
        this.activePointers.set(e.pointerId, e);
        
        if (this.activePointers.size === 2) { this.startGesture(); return; }
        
        if (!this.isGesture && e.button === 0) {
            this.isDrawing = true;
            const pos = this.toWorld(e.clientX, e.clientY);
            const p = e.pressure || 0.5;
            this.points = [[pos.x, pos.y, p], [pos.x + 0.1, pos.y + 0.1, p]];
            this.isSnapped = false;
            this.snapStartPos = pos;
            
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
            const tool = this.tools[this.settings.tool];

            if (tool.type === 'shape') {
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

            if (e.getCoalescedEvents) { 
                e.getCoalescedEvents().forEach(ce => { 
                    const p = this.toWorld(ce.clientX, ce.clientY); 
                    const rawP = ce.pressure || 0.5;
                    this.points.push([p.x, p.y, this.getPressure(rawP)]); 
                }); 
            } else { 
                const rawP = e.pressure || 0.5;
                this.points.push([pos.x, pos.y, this.getPressure(rawP)]); 
            }
            this.renderLive();
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
    }
    
    triggerSnap() {
        if (!this.isDrawing) return;
        this.isSnapped = true;
        this.sound.play('pop'); 
        this.showToast("Straight Line! 📏");
        const start = this.points[0]; const end = this.points[this.points.length-1];
        this.points = [start, end]; this.renderLive();
        if (navigator.vibrate) navigator.vibrate(20);
    }

    renderLive() {
        this.composeLayers();
        if (this.settings.tool === 'scissor') { this.drawScissorPath(this.ctx, this.points); return; }
        const toolCfg = this.tools[this.settings.tool];
        if (toolCfg.type === 'shape' && this.points.length >= 2) {
            this.drawGeometricShape(this.ctx, this.points[0], this.points[1], toolCfg.shape, this.settings.color, this.settings.size, this.settings.opacity);
            return;
        }
        const size = (this.settings.size * toolCfg.sizeMod) * (this.scaleFactor * 0.6); 
        this.drawSymmetry(this.ctx, this.points, size, this.settings.color, toolCfg, this.settings.opacity, this.settings.symmetry);
    }

    drawSymmetry(ctx, points, size, color, cfg, opacity = 1, symmetry = 'none') {
        const render = (pts) => {
            if (this.settings.tool === 'pencil') {
                this.drawTexturedStroke(ctx, pts, size, color, 'pencil', opacity);
            } else if (cfg.type === 'particle') {
                this.drawParticles(ctx, pts, size, color, cfg.effect, opacity);
            } else {
                this.drawStroke(ctx, pts, size, color, cfg, opacity);
            }
        };
        render(points);
        const w = this.width, h = this.height;
        if (symmetry === 'x' || symmetry === 'quad') render(points.map(p => [w - p[0], p[1], p[2]]));
        if (symmetry === 'y' || symmetry === 'quad') render(points.map(p => [p[0], h - p[1], p[2]]));
        if (symmetry === 'quad') render(points.map(p => [w - p[0], h - p[1], p[2]]));
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
        const path = new Path2D(this.getSvgPath(outline));
        ctx.save();
        ctx.globalCompositeOperation = cfg.composite || 'source-over'; ctx.globalAlpha = opacity * (cfg.opacity || 1);
        if (cfg.glow) { ctx.shadowBlur = size * 1.5; ctx.shadowColor = color; ctx.fillStyle = '#ffffff'; ctx.fill(path); } 
        else { ctx.fillStyle = color; ctx.fill(path); }
        ctx.restore();
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

    createTexture() {
        const c = document.createElement('canvas'); c.width=64; c.height=64; 
        const x = c.getContext('2d');
        for(let i=0; i<500; i++) { x.fillStyle=`rgba(0,0,0,${Math.random()*0.2})`; x.fillRect(Math.random()*64, Math.random()*64, 2, 2); }
        return this.ctx.createPattern(c, 'repeat');
    }

    getSvgPath(stroke) {
        if (!stroke.length) return "";
        const d = stroke.reduce((acc, [x0, y0], i, arr) => { const [x1, y1] = arr[(i + 1) % arr.length]; acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2); return acc; }, ["M", ...stroke[0], "Q"]);
        d.push("Z"); return d.join(" ");
    }

        commitStroke() {
        // 1. Try to get the active layer
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

        const toolCfg = this.tools[this.settings.tool];
           if (toolCfg.type === 'shape') {
             if (this.points.length >= 2) {
                 this.drawGeometricShape(layer.ctx, this.points[0], this.points[1], toolCfg.shape, this.settings.color, this.settings.size, this.settings.opacity);
                 this.history.push({ 
                     type: 'shape', layerId: layer.id, shape: toolCfg.shape, 
                     start: this.points[0], end: this.points[1], 
                     color: this.settings.color, size: this.settings.size, opacity: this.settings.opacity 
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
        this.saveState(); 
    }

    undo() { 
        if(!this.history.length) { this.showToast('Nothing to Undo'); return; }
        const action = this.history.pop();
        this.sound.play('undo'); 
        this.redoStack.push(action); 
        this.rebuildLayers(action.layerId); 
        this.showToast('Undo ↩️'); 
    }

    redo() { 
        if(!this.redoStack.length) { this.showToast('Nothing to Redo'); return; }
        const action = this.redoStack.pop();
        this.sound.play('undo'); 
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
                if(act.config.type === 'textured' || (this.settings.tool === 'pencil' && act.config.texture)) { 
                     this.drawTexturedStroke(l.ctx, act.points, act.size, act.color, 'pencil', act.opacity);
                } else {
                     this.drawSymmetry(l.ctx, act.points, act.size, act.color, act.config, act.opacity, act.symmetry); 
                }
            }
            else if (act.type === 'shape') this.drawGeometricShape(l.ctx, act.start, act.end, act.shape, act.color, act.size, act.opacity);
            else if (act.type === 'text') this.addTextToCtx(l.ctx, act.x, act.y, act.text, act.color, act.size);
            else if (act.type === 'clear') l.ctx.clearRect(0,0,this.width, this.height);
            else if (act.type === 'fill') this.runFloodFillAlgorithm(l.ctx, act.x, act.y, act.color);
            else if (act.type === 'filter') this.applyFilter(act.filterType, l, true);
            else if (act.type === 'scissor') this.applyScissor(l.ctx, act.points);
            else if (act.type === 'image') l.ctx.drawImage(act.img, act.x, act.y, act.w, act.h);
        });
        this.requestRender();
    }

    drawGeometricShape(ctx, start, end, type, color, size, opacity) {
        ctx.save(); ctx.beginPath(); ctx.strokeStyle = color;
        ctx.lineWidth = size * this.scaleFactor * 0.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha = opacity;
        const w = end[0] - start[0]; const h = end[1] - start[1];
        if (type === 'line') { ctx.moveTo(start[0], start[1]); ctx.lineTo(end[0], end[1]); } 
        else if (type === 'rect') { ctx.rect(start[0], start[1], w, h); } 
        else if (type === 'circle') { const cx = start[0] + w/2; const cy = start[1] + h/2; ctx.ellipse(cx, cy, Math.abs(w/2), Math.abs(h/2), 0, 0, Math.PI*2); }
        ctx.stroke(); ctx.restore();
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
        this.sound.play('trash'); 
        this.history.push({ type: 'scissor', layerId: layer.id, points: [...points] });
        this.redoStack = []; this.saveState(); this.showToast("Cut Background! ✂️"); this.requestRender();
    }
    
    applyScissor(ctx, points) {
        ctx.save(); ctx.beginPath(); ctx.moveTo(points[0][0], points[0][1]);
        for(let i=1; i<points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
        ctx.closePath(); ctx.globalCompositeOperation = 'destination-in'; ctx.fillStyle = 'black'; ctx.fill(); ctx.restore();
    }

    promptText(x, y) {
        const text = prompt("Enter text:", "");
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
        if (!caseItems) return; // FIX: Prevents crash if element is missing

        const tools = [
            { id: 't-bucket', icon: '🪣', tool: 'bucket' }, { id: 't-scissor', icon: '✂️', tool: 'scissor' },
            { id: 't-rect', icon: '⬜', tool: 'rect' }, { id: 't-circle', icon: '⭕', tool: 'circle' },
            { id: 't-line', icon: '📏', tool: 'line' }, { id: 't-text', icon: 'T', tool: 'text' }
        ];
        tools.forEach(t => {
            if (!document.getElementById(t.id)) {
                const div = document.createElement('div'); div.className = 'case-tool'; div.id = t.id; div.onclick = () => this.setTool(t.tool); div.textContent = t.icon; caseItems.appendChild(div);
            }
        });
        const topBarRight = document.querySelector('.top-bar > div:last-child');
        if (topBarRight && !document.getElementById('btn-clear-layer')) {
            const div = document.createElement('div'); div.className = 'btn-icon'; div.id = 'btn-clear-layer'; div.title = "Clear Layer"; div.onclick = () => this.clearLayer(); div.textContent = '🗑️'; div.style.color = '#ef4444'; topBarRight.insertBefore(div, topBarRight.firstChild);
        }
    }

    injectColorStyles() {
        if(document.getElementById('cs-styles')) return;
        const css = `
        .cs-modal-overlay { position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:9999; display:none; justify-content:center; align-items:center; backdrop-filter:blur(2px); }
        .cs-container { display:flex; flex-direction:column; align-items:center; gap:15px; width:100%; padding:5px; }
        .cs-sb-wrapper { position:relative; width:220px; height:220px; border-radius:12px; overflow:hidden; box-shadow:0 4px 10px rgba(0,0,0,0.1); touch-action:none; background: #fff; cursor: crosshair; }
        .cs-hue-wrapper { position:relative; width:220px; height:30px; border-radius:15px; margin-top:5px; touch-action:none; cursor: ew-resize; }
        .cs-cursor { position:absolute; width:16px; height:16px; border:2px solid white; border-radius:50%; box-shadow:0 0 3px rgba(0,0,0,0.5); transform:translate(-50%, -50%); pointer-events:none; z-index: 10; }
        .cs-slider-thumb { position:absolute; top:50%; width:16px; height:24px; background:white; border-radius:8px; border:1px solid #ccc; box-shadow:0 2px 4px rgba(0,0,0,0.2); transform:translate(-50%, -50%); pointer-events:none; z-index: 10; }
        .cs-hex-row { display:flex; gap:10px; align-items:center; width:220px; justify-content:space-between; margin-top: 5px; }
        .cs-hex-input { background:#f3f4f6; border:1px solid #e5e7eb; padding:8px 12px; border-radius:8px; font-family:monospace; font-size:14px; color:#444; width:100px; text-align:center; }
        .cs-swatch-grid { display:flex; gap:8px; width:220px; flex-wrap:wrap; margin-top:10px; min-height: 30px;}
        .cs-swatch { width:30px; height:30px; border-radius:50%; border:2px solid white; box-shadow:0 2px 4px rgba(0,0,0,0.1); cursor:pointer; transition: transform 0.1s; }
        .cs-swatch:active { transform: scale(0.9); }
        `;
        const s = document.createElement('style'); s.id = 'cs-styles'; s.innerHTML = css; document.head.appendChild(s);
    }

    setTool(t) {
        this.settings.tool = t;
        document.querySelectorAll('.case-tool').forEach(e => e.classList.remove('active')); 
        const el = document.getElementById('t-'+t); if(el) el.classList.add('active');
        this.sound.play('click'); 
        this.showToast(t.toUpperCase() + " Selected");
    }

setColor(c) { 
    this.settings.color = c; 
    document.getElementById('curr-color').style.background = c; 
    if (c.startsWith('#')) {
        const hex = c.replace('#', '');
        const r = parseInt(hex.substring(0,2), 16) / 255;
        const g = parseInt(hex.substring(2,4), 16) / 255;
        const b = parseInt(hex.substring(4,6), 16) / 255;
        
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h, s, v = max;
        const d = max - min;
        s = max === 0 ? 0 : d / max;
        if (max === min) h = 0;
        else {
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }
        this.colorState = { h: h * 360, s: s, v: v };
    }

    if(!this.recentColors.includes(c)) {
        this.recentColors.unshift(c);
        if(this.recentColors.length > 7) this.recentColors.pop();
    }
}
    updateSettings(k, v) { if(k === 'opacity') v = v/100; this.settings[k] = Number(v); }

    runPicker(e) {
        const pos = this.toWorld(e.clientX, e.clientY);
        const pixel = this.ctx.getImageData(pos.x, pos.y, 1, 1).data;
        const hex = "#" + ((1 << 24) + (pixel[0] << 16) + (pixel[1] << 8) + pixel[2]).toString(16).slice(1);
        this.setColor(hex); this.showToast(`Copied Color! 🎨`); this.settings.isPicking = false; 
    }

    runBucket(e) {
        const pos = this.toWorld(e.clientX, e.clientY);
        const layer = this.layerManager.getActive();
        if (layer && layer.visible) {
            this.showToast("Filling... ⏳");
            this.sound.play('pop'); 
            setTimeout(() => {
                this.runFloodFillAlgorithm(layer.ctx, Math.floor(pos.x), Math.floor(pos.y), this.settings.color);
                this.history.push({ type: 'fill', layerId: layer.id, x: Math.floor(pos.x), y: Math.floor(pos.y), color: this.settings.color });
                this.requestRender(); this.saveState(); this.showToast("Filled! 🪣");
            }, 10);
        }
    }
    
    runFloodFillAlgorithm(ctx, startX, startY, fillColorHex) {
        const w = this.width; const h = this.height;
        const imageData = ctx.getImageData(0, 0, w, h); const data = imageData.data;
        const r = parseInt(fillColorHex.slice(1,3), 16); const g = parseInt(fillColorHex.slice(3,5), 16); const b = parseInt(fillColorHex.slice(5,7), 16); const a = 255;
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

    startGesture() {
        this.isGesture = true; this.isDrawing = false;
        const pts = Array.from(this.activePointers.values());
        const p1 = {x:pts[0].clientX, y:pts[0].clientY}; const p2 = {x:pts[1].clientX, y:pts[1].clientY};
        this.gestStart = { dist: Vec.dist(p1, p2), center: Vec.mid(p1, p2), zoom: this.camera.zoom, cam: { ...this.camera } };
    }

    handleGesture() {
        const pts = Array.from(this.activePointers.values());
        const p1 = {x:pts[0].clientX, y:pts[0].clientY}; const p2 = {x:pts[1].clientX, y:pts[1].clientY};
        const dist = Vec.dist(p1, p2); const center = Vec.mid(p1, p2); const scale = dist / this.gestStart.dist;
        this.camera.zoom = Math.max(0.1, Math.min(5, this.gestStart.zoom * scale));
        const dx = center.x - this.gestStart.center.x; const dy = center.y - this.gestStart.center.y;
        this.camera.x = this.gestStart.cam.x + dx; this.camera.y = this.gestStart.cam.y + dy;
        this.updateCamera();
    }

    updateCamera() { this.container.style.transform = `translate(${this.camera.x}px, ${this.camera.y}px) scale(${this.camera.zoom})`; }
    toWorld(x, y) { const rect = this.canvas.getBoundingClientRect(); return { x: (x - rect.left) * (this.width / rect.width), y: (y - rect.top) * (this.height / rect.height) }; }
    resetView() { const vp = document.getElementById('viewport'); const scale = Math.min(vp.clientWidth/this.width, vp.clientHeight/this.height) * 0.85; this.camera = { x: (vp.clientWidth - this.width*scale)/2, y: (vp.clientHeight - this.height*scale)/2, zoom: scale }; this.updateCamera(); }
    onWheel(e) { if (e.ctrlKey) { e.preventDefault(); this.camera.zoom = Math.max(0.1, Math.min(5, this.camera.zoom - e.deltaY * 0.002)); this.updateCamera(); } else { this.camera.x -= e.deltaX; this.camera.y -= e.deltaY; this.updateCamera(); } }

    saveState() {
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(() => {
            try { const data = this.canvas.toDataURL('image/png', 0.5); localStorage.setItem('prosketch-kids', data); } catch (e) {}
        }, 1000);
    }
    loadState() {
        const data = localStorage.getItem('prosketch-kids');
        if (data) {
            const img = new Image(); img.onload = () => { const layer = this.layerManager.layers[0]; layer.ctx.clearRect(0, 0, this.width, this.height); layer.ctx.drawImage(img, 0, 0); this.requestRender(); };
            img.src = data;
        }
    }
    showToast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2000); }
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
        const content = document.getElementById('panel-content');
        if (!content || !this.currentPanel) return;

        if (this.currentPanel === 'layers') {
            const layersHTML = this.layerManager.layers.slice().reverse().map(layer => {
                const isActive = layer.id === this.layerManager.activeId ? 'active' : '';
                const canDelete = this.layerManager.layers.length > 1;
                
                return `
                <div class="layer-item ${isActive}" style="display:flex; flex-direction:column; gap:5px; padding:10px; border:2px solid ${isActive ? '#6366f1' : '#f1f5f9'}; border-radius:12px; margin-bottom:8px; background:white;">
                    
                    <div style="display:flex; align-items:center; justify-content:space-between; width:100%; gap: 10px;">
                        <div onclick="app.toggleLayerVis('${layer.id}')" style="cursor:pointer; font-size:18px; width:30px; display:flex; align-items:center; justify-content:center;">
                            ${layer.visible ? '👁️' : '🔒'}
                        </div>
                        
                        <div onclick="app.setLayerActive('${layer.id}')" style="flex:1; font-weight:bold; cursor:pointer; color:#334155; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                            ${layer.name}
                        </div>

                        <div onclick="${canDelete ? `app.deleteLayer('${layer.id}')` : ''}" 
                             style="cursor:${canDelete ? 'pointer' : 'not-allowed'}; color:${canDelete ? '#ef4444' : '#cbd5e1'}; font-size:18px; padding:5px; flex-shrink:0; width:30px; text-align:center;">
                            🗑️
                        </div>
                    </div>

                    <div style="display:flex; align-items:center; gap:10px; margin-top:5px;">
                        <span style="font-size:10px; font-weight:bold; color:#94a3b8;">OPACITY</span>
                        <input type="range" min="0" max="100" value="${layer.opacity * 100}" 
                            oninput="app.setLayerOpacity('${layer.id}', this.value)" 
                            onpointerdown="event.stopPropagation()"
                            style="flex:1; height:4px; accent-color:#6366f1;">
                        <span style="font-size:10px; color:#64748b; width:25px; text-align:right;">${Math.round(layer.opacity * 100)}%</span>
                    </div>
                </div>`;
            }).join('');

            content.innerHTML = layersHTML + `
                <div onclick="app.createNewLayer()" class="layer-item" style="justify-content:center; border:2px dashed #cbd5e1; color:#64748b; cursor:pointer; margin-top:10px; padding:10px; text-align:center; border-radius:12px;">
                    + New Layer
                </div>
            `;

        } else if (this.currentPanel === 'settings') {
            content.innerHTML = `
                <div style="margin-bottom:20px;">
                     <div style="font-size:14px; font-weight:600; color:#888;">FILTERS 🪄</div>
                     <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:10px;">
                        <button onclick="app.triggerFilter('grayscale')" class="btn-filter">BW</button>
                        <button onclick="app.triggerFilter('sepia')" class="btn-filter">Sepia</button>
                        <button onclick="app.triggerFilter('invert')" class="btn-filter">Invert</button>
                     </div>
                </div>
                <div class="layer-item" onclick="app.resetView()" style="font-weight:bold; color:#6366f1; cursor:pointer; padding:10px;">🔍 Fit to Screen</div>
                <div class="layer-item" onclick="app.fullReset()" style="color:#ef4444; font-weight:bold; cursor:pointer; padding:10px;">🗑️ Clear All</div>
            `;
        }
    }

    applyFilter(type, layer, isReplay=false) {
        const imgData = layer.ctx.getImageData(0,0, this.width, this.height); const data = imgData.data;
        for(let i=0; i<data.length; i+=4) {
            const r = data[i], g = data[i+1], b = data[i+2];
            if (type === 'grayscale') { const v = 0.3*r + 0.59*g + 0.11*b; data[i]=data[i+1]=data[i+2]=v; }
            else if (type === 'invert') { data[i]=255-r; data[i+1]=255-g; data[i+2]=255-b; }
            else if (type === 'sepia') { data[i] = (r * .393) + (g *.769) + (b * .189); data[i+1] = (r * .349) + (g *.686) + (b * .168); data[i+2] = (r * .272) + (g *.534) + (b * .131); }
        }
        layer.ctx.putImageData(imgData, 0, 0);
    }

    toggleGalleryModal(show) { document.getElementById('gallery-modal').style.display = show ? 'flex' : 'none'; if(show) this.refreshGalleryModal(); }
    toggleTemplateModal(show) { document.getElementById('template-modal').style.display = show === false ? 'none' : 'flex'; }
    toggleColorStudio(show) { 
    const modal = document.getElementById('color-studio-modal');
    modal.style.display = show ? 'flex' : 'none'; 
     if(show && !document.getElementById('cs-sb-canvas')) {
        this.initColorStudio(); 
    }
}
    bindShortcuts() {
        window.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
            if (e.key === '[') { this.updateSettings('size', Math.max(1, this.settings.size - 2)); this.showToast(`Size: ${this.settings.size}`); }
            if (e.key === ']') { this.updateSettings('size', Math.min(100, this.settings.size + 2)); this.showToast(`Size: ${this.settings.size}`); }
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
            this.gallery.unshift(artItem); if(this.gallery.length > 6) this.gallery.pop();
            localStorage.setItem('prosketch-gallery', JSON.stringify(this.gallery)); this.showToast('Saved to Gallery! 📸'); 
            this.sound.play('pop'); 
            this.refreshGalleryModal();
        } catch(e) { this.showToast('Storage Full! 📂'); }
    }
    loadGallery() { try { const g = localStorage.getItem('prosketch-gallery'); if(g) this.gallery = JSON.parse(g); } catch(e) {} }
    deleteFromGallery(id) { 
        this.gallery = this.gallery.filter(item => item.id !== id); 
        localStorage.setItem('prosketch-gallery', JSON.stringify(this.gallery)); 
        this.sound.play('trash'); 
        this.refreshGalleryModal(); 
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
            <div class="gallery-card"><img src="${item.thumb}" onclick="app.loadFromGallery(${item.id})"><div class="gallery-actions"><span>${item.date}</span><div style="display:flex; gap:10px;"><span onclick="app.downloadFromGallery(${item.id})" style="color:#6366f1; cursor:pointer;" title="Download PNG">⬇️</span><span onclick="app.deleteFromGallery(${item.id})" style="color:#ef4444; cursor:pointer;" title="Delete">🗑️</span></div></div></div>`).join('');
    }
    loadTemplate(type) {
        this.toggleTemplateModal(false);
        const guideLayer = this.layerManager.addLayer('Guide'); 
        this.layerManager.setActive(guideLayer.id);
        const ctx = guideLayer.ctx;
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
                this.layerManager.setActive(newLayer.id); 
                
                // FIXED: Removed duplicate 'const scale' line
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
            this.sound.play('trash'); 
            this.requestRender(); 
        } 
    }
     
        const modal = document.getElementById('color-studio-modal');
        modal.className = 'cs-modal-overlay'; // Ensure class is applied
        
        modal.innerHTML = `
            <div style="pointer-events: auto; background:white; padding:20px; border-radius:24px; box-shadow:0 10px 40px rgba(0,0,0,0.2); width:320px; display:flex; flex-direction:column; align-items:center;">
                <div style="width:100%; display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                    <h3 style="margin:0; font-size:18px; color:#333;">Color Studio 🎨</h3>
                    <button onclick="app.toggleColorStudio(false)" style="background:none; border:none; font-size:24px; cursor:pointer; color:#666;">&times;</button>
                </div>
                
                <div class="cs-container">
                    <div class="cs-sb-wrapper" id="cs-sb-box">
                        <canvas id="cs-sb-canvas" width="220" height="220" style="width:220px; height:220px; display:block;"></canvas>
                        <div id="cs-sb-cursor" class="cs-cursor"></div>
                    </div>
                    
                    <div class="cs-hue-wrapper" id="cs-hue-rail">
                        <canvas id="cs-hue-canvas" width="220" height="30" style="width:220px; height:30px; display:block; border-radius:15px;"></canvas>
                        <div id="cs-hue-thumb" class="cs-slider-thumb"></div>
                    </div>
                    
                    <div class="cs-hex-row">
                        <div id="cs-preview" style="width:40px; height:40px; border-radius:10px; background:${this.settings.color}; box-shadow:inset 0 0 0 1px rgba(0,0,0,0.1);"></div>
                        <div style="display:flex; flex-direction:column; gap:2px;">
                            <span style="font-size:10px; color:#888; font-weight:600;">HEX CODE</span>
                            <input id="cs-hex-input" class="cs-hex-input" value="${this.settings.color}" maxlength="7" spellcheck="false">
                        </div>
                        <button onclick="app.toggleColorStudio(false)" style="background:#6366f1; color:white; border:none; padding:8px 16px; border-radius:8px; font-weight:bold; cursor:pointer;">Done</button>
                    </div>

                    <div class="cs-swatch-grid" id="cs-recent-grid"></div>
                </div>
            </div>
        `;

        // --- DRAWING LOGIC ---
        setTimeout(() => { // Small delay ensures DOM elements exist
            const sbCanvas = document.getElementById('cs-sb-canvas');
            const hueCanvas = document.getElementById('cs-hue-canvas');
            if(!sbCanvas || !hueCanvas) return;

            const sbCtx = sbCanvas.getContext('2d');
            const hueCtx = hueCanvas.getContext('2d');

            // 1. Draw Static Hue Rail
            const hueGrad = hueCtx.createLinearGradient(0, 0, hueCanvas.width, 0);
            for(let i=0; i<=360; i+=60) hueGrad.addColorStop(i/360, `hsl(${i}, 100%, 50%)`);
            hueCtx.fillStyle = hueGrad; 
            hueCtx.fillRect(0,0, hueCanvas.width, hueCanvas.height);

            const renderSwatches = () => {
                const grid = document.getElementById('cs-recent-grid');
                if(grid) grid.innerHTML = this.recentColors.map(c => `<div class="cs-swatch" style="background:${c}" onclick="app.setColor('${c}', false); app.toggleColorStudio(false);"></div>`).join('');
            };

            const updateUI = () => {
                // Draw S/B Box
                sbCtx.clearRect(0,0,220,220);
                sbCtx.fillStyle = `hsl(${this.colorState.h}, 100%, 50%)`;
                sbCtx.fillRect(0, 0, 220, 220);
                
                const whiteGrad = sbCtx.createLinearGradient(0,0,220,0);
                whiteGrad.addColorStop(0, 'white'); whiteGrad.addColorStop(1, 'rgba(255,255,255,0)');
                sbCtx.fillStyle = whiteGrad; sbCtx.fillRect(0,0,220,220);
                
                const blackGrad = sbCtx.createLinearGradient(0,0,0,220);
                blackGrad.addColorStop(0, 'transparent'); blackGrad.addColorStop(1, 'black');
                sbCtx.fillStyle = blackGrad; sbCtx.fillRect(0,0,220,220);
                
                // Position Cursors
                const hueX = Math.min(220, Math.max(0, (this.colorState.h / 360) * 220));
                const sbX = Math.min(220, Math.max(0, this.colorState.s * 220));
                const sbY = Math.min(220, Math.max(0, (1 - this.colorState.v) * 220));
                
                const hueThumb = document.getElementById('cs-hue-thumb');
                const sbCursor = document.getElementById('cs-sb-cursor');
                
                if(hueThumb) hueThumb.style.left = hueX + 'px';
                if(sbCursor) { sbCursor.style.left = sbX + 'px'; sbCursor.style.top = sbY + 'px'; }
                
                const hex = this.hsvToHex(this.colorState.h, this.colorState.s, this.colorState.v);
                const preview = document.getElementById('cs-preview');
                const input = document.getElementById('cs-hex-input');
                
                if(preview) preview.style.background = hex;
                if(input && document.activeElement !== input) input.value = hex;
                
                this.setColor(hex, false); 
            };

            // Event Handlers
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
            sbBox.onpointerdown = (e) => { 
                sbBox.setPointerCapture(e.pointerId); 
                handleSB(e); 
                sbBox.onpointermove = handleSB; 
            };
            sbBox.onpointerup = (e) => { 
                sbBox.onpointermove = null; 
                if(!this.recentColors.includes(this.settings.color)) {
                   this.recentColors.unshift(this.settings.color);
                   if(this.recentColors.length > 7) this.recentColors.pop();
                   renderSwatches();
                }
            };
            
            const hueRail = document.getElementById('cs-hue-rail');
            hueRail.onpointerdown = (e) => { hueRail.setPointerCapture(e.pointerId); handleHue(e); hueRail.onpointermove = handleHue; };
            hueRail.onpointerup = () => { hueRail.onpointermove = null; };
            
            const hexInput = document.getElementById('cs-hex-input');
            hexInput.onchange = (e) => { this.setColor(e.target.value, true); updateUI(); };

            renderSwatches();
            updateUI();
        }, 50);
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
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }
                // --- TEMPLATE: Helper Functions for Layer UI ---

    createNewLayer() {
        const newLayer = this.layerManager.addLayer(`Layer ${this.layerManager.layers.length + 1}`);
        this.layerManager.setActive(newLayer.id);
        this.refreshUI();
        this.showToast("Layer Added 📄");
    }

    deleteLayer(id) {
        if (this.layerManager.layers.length <= 1) {
            this.showToast("Cannot delete last layer!");
            return;
        }
        const index = this.layerManager.layers.findIndex(l => l.id === id);
        if (index > -1) {
            this.layerManager.layers.splice(index, 1);
            if (this.layerManager.activeId === id) {
                this.layerManager.activeId = this.layerManager.layers[0].id;
            }
            this.sound.play('trash');
            this.refreshUI(); 
            this.requestRender(); 
        }
    }

    setLayerOpacity(id, val) {
    const layer = this.layerManager.layers.find(l => l.id === id);
    if (layer) {
        layer.opacity = parseInt(val) / 100;
        this.requestRender(); 
     const textSpan = document.querySelector(`input[oninput*="${id}"]`).nextElementSibling;
        if(textSpan) textSpan.textContent = Math.round(layer.opacity * 100) + '%';
    }
    }

    setLayerActive(id) {
        this.layerManager.setActive(id);
        this.refreshUI();
    }

    toggleLayerVis(id) {
        const layer = this.layerManager.layers.find(l => l.id === id);
        if (layer) {
            layer.visible = !layer.visible;
            this.requestRender();
            this.refreshUI();
        }
    }
}
window.app = new ProSketch();
