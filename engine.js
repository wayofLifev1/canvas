// ==========================================
// ENGINE: HELPERS & SYSTEMS
// ==========================================

export const Vec = {
    dist: (a, b) => Math.hypot(b.x - a.x, b.y - a.y),
    mid: (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),
    sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y }),
    add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y })
};

export class DraggableDock {
    constructor() {
        this.el = document.getElementById('pencil-case-container');
        this.toggle = document.getElementById('case-toggle');
        this.items = document.getElementById('case-items');
        this.isDragging = false;
        this.isOpen = false;
        this.offset = { x: 0, y: 0 };
        
        this.toggle.onpointerdown = this.onDown.bind(this);
        window.addEventListener('pointermove', this.onMove.bind(this));
        window.addEventListener('pointerup', this.onUp.bind(this));
        
        this.toggle.onclick = (e) => {
            if(!this.hasDragged) {
                this.isOpen = !this.isOpen;
                this.items.classList.toggle('open', this.isOpen);
            }
        };
    }

    onDown(e) {
        this.isDragging = true; this.hasDragged = false;
        this.startX = e.clientX; this.startY = e.clientY;
        const rect = this.el.getBoundingClientRect();
        this.offset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        this.el.setPointerCapture(e.pointerId);
    }
    onMove(e) {
        if (!this.isDragging) return;
        const dist = Math.hypot(e.clientX - this.startX, e.clientY - this.startY);
        if(dist > 5) this.hasDragged = true;
        this.el.style.left = (e.clientX - this.offset.x) + 'px';
        this.el.style.top = (e.clientY - this.offset.y) + 'px';
    }
    onUp(e) { this.isDragging = false; }
}

export class LayerManager {
    constructor(app) {
        this.app = app; this.layers = []; this.activeId = null; this.layerCounter = 1;
    }
    init(w, h) { this.layers = []; this.layerCounter = 1; this.addLayer('Background'); }
    addLayer(name = `Layer ${this.layerCounter}`) {
        const c = document.createElement('canvas'); c.width = this.app.width; c.height = this.app.height;
        const ctx = c.getContext('2d');
        const layer = { id: Date.now() + Math.random(), name: name, canvas: c, ctx: ctx, visible: true, opacity: 1.0, blend: 'source-over' };
        this.layers.push(layer); this.activeId = layer.id; this.layerCounter++;
        this.app.requestRender(); this.app.refreshUI(); return layer;
    }
    getActive() { return this.layers.find(l => l.id === this.activeId) || this.layers[0]; }
    setActive(id) { this.activeId = id; this.app.refreshUI(); }
    toggleVis(id) { const l = this.layers.find(x => x.id === id); if(l) { l.visible = !l.visible; this.app.requestRender(); this.app.refreshUI(); } }
    renderListHTML() {
        return `
            <div style="margin-bottom:15px; display:flex; justify-content:space-between; align-items:center;">
                <h4 style="margin:0; color:#64748b;">Layers (${this.layers.length})</h4>
                <button onclick="app.layerManager.addLayer()" style="padding:5px 10px; background:var(--primary); color:white; border:none; border-radius:8px; cursor:pointer;">+ New</button>
            </div>
            <div style="display:flex; flex-direction:column-reverse;">
                ${this.layers.map(l => `
                    <div class="layer-item ${l.id === this.activeId ? 'active' : ''}" onclick="app.layerManager.setActive(${l.id})">
                        <span class="layer-vis" onclick="event.stopPropagation(); app.layerManager.toggleVis(${l.id})">${l.visible ? '👁️' : '🚫'}</span>
                        <span style="flex:1; font-weight:600; color:#334155;">${l.name}</span>
                        ${l.id === this.activeId ? '✏️' : ''}
                    </div>`).join('')}
            </div>`;
    }
}

// --- NEW: SOUND MANAGER ---
export class SoundManager {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.bgm = new Audio('https://cdn.pixabay.com/audio/2022/01/18/audio_d0a13f69d2.mp3'); // Calm lofi placeholder
        this.bgm.loop = true;
        this.bgm.volume = 0.3; // 30% volume
        this.isPlaying = false;
        
        // 1. Handle App Switching (Visibility API)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                // User switched apps -> Pause
                if(this.isPlaying) this.bgm.pause();
            } else {
                // User came back -> Resume (only if it was supposed to be playing)
                if(this.isPlaying) this.bgm.play().catch(e => console.log("Waiting for interaction"));
            }
        });

        // 2. Unlock Audio on first interaction (Browser Policy)
        const unlock = () => {
            if (this.ctx.state === 'suspended') this.ctx.resume();
            this.bgm.play().then(() => {
                this.isPlaying = true;
            }).catch(e => {});
            window.removeEventListener('pointerdown', unlock);
            window.removeEventListener('keydown', unlock);
        };
        window.addEventListener('pointerdown', unlock);
        window.addEventListener('keydown', unlock);
    }

    // Synthesize simple SFX so user doesn't need to download files
    play(type) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain);
        gain.connect(this.ctx.destination);

        const now = this.ctx.currentTime;
        
        if (type === 'click') {
            osc.frequency.setValueAtTime(800, now);
            osc.frequency.exponentialRampToValueAtTime(300, now + 0.1);
            gain.gain.setValueAtTime(0.3, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
            osc.start(now); osc.stop(now + 0.1);
        } 
        else if (type === 'undo') {
            osc.frequency.setValueAtTime(300, now);
            osc.frequency.linearRampToValueAtTime(600, now + 0.15);
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.linearRampToValueAtTime(0.01, now + 0.15);
            osc.type = 'triangle';
            osc.start(now); osc.stop(now + 0.15);
        }
        else if (type === 'pop') {
            osc.frequency.setValueAtTime(600, now);
            gain.gain.setValueAtTime(0.3, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
            osc.start(now); osc.stop(now + 0.08);
        }
        else if (type === 'trash') {
            osc.frequency.setValueAtTime(100, now);
            osc.frequency.linearRampToValueAtTime(50, now + 0.2);
            gain.gain.setValueAtTime(0.3, now);
            gain.gain.linearRampToValueAtTime(0.01, now + 0.2);
            osc.type = 'sawtooth';
            osc.start(now); osc.stop(now + 0.2);
        }
    }
}
