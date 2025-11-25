/* Application core. Relies on helper files loaded earlier:
    - js/constants.js (NOTES, DRUMS, FREQS)
    - js/audio-fx.js (createReverbImpulse)
    - js/visualizer.js (createVisualizer)
    - js/ui.js (initUIBindings)
*/

class App {
    constructor() {
        this.ac = new (window.AudioContext || window.webkitAudioContext)();

        // Master Chain
        this.limiter = this.ac.createDynamicsCompressor();
        this.limiter.threshold.value = -0.5; this.limiter.ratio.value = 20;
        this.limiter.attack.value = 0.002; this.limiter.release.value = 0.1;

        this.masterGain = this.ac.createGain();
        this.masterGain.gain.value = 0.8;

        this.sidechainBus = this.ac.createGain();
        this.drumBus = this.ac.createGain();

        this.sidechainBus.connect(this.masterGain);
        this.drumBus.connect(this.masterGain);
        this.masterGain.connect(this.limiter);
        // Create a small chorus send path and connect limiter to destination
        this.chorusDelay1 = this.ac.createDelay(); this.chorusDelay2 = this.ac.createDelay();
        this.chorusDelay1.delayTime.value = 0.015; this.chorusDelay2.delayTime.value = 0.022;
        this.chorusSendGain = this.ac.createGain(); this.chorusSendGain.gain.value = 0.5;
        this.chorusGain = this.ac.createGain(); this.chorusGain.gain.value = 0; // off by default

        this.limiter.connect(this.ac.destination);
        // Send a portion to chorus delays (wet) which feed destination when chorusGain > 0
        this.limiter.connect(this.chorusSendGain);
        this.chorusSendGain.connect(this.chorusDelay1);
        this.chorusSendGain.connect(this.chorusDelay2);
        this.chorusDelay1.connect(this.chorusGain);
        this.chorusDelay2.connect(this.chorusGain);
        this.chorusGain.connect(this.ac.destination);

        // LFOs to modulate chorus delay times
        this.chorusLfo1 = this.ac.createOscillator(); this.chorusLfo1.type = 'sine'; this.chorusLfo1.frequency.value = 0.2;
        this.chorusLfo1Gain = this.ac.createGain(); this.chorusLfo1Gain.gain.value = 0.004;
        this.chorusLfo1.connect(this.chorusLfo1Gain); this.chorusLfo1Gain.connect(this.chorusDelay1.delayTime);
        this.chorusLfo1.start();
        this.chorusLfo2 = this.ac.createOscillator(); this.chorusLfo2.type = 'sine'; this.chorusLfo2.frequency.value = 0.15;
        this.chorusLfo2Gain = this.ac.createGain(); this.chorusLfo2Gain.gain.value = 0.006;
        this.chorusLfo2.connect(this.chorusLfo2Gain); this.chorusLfo2Gain.connect(this.chorusDelay2.delayTime);
        this.chorusLfo2.start();

        // Global FX
        this.delayNode = this.ac.createDelay();
        this.delayNode.delayTime.value = 0.375; 
        this.delayFeedback = this.ac.createGain();
        this.delayFeedback.gain.value = 0.4;
        this.delayNode.connect(this.delayFeedback);
        this.delayFeedback.connect(this.delayNode);
        this.delayGain = this.ac.createGain();
        this.delayGain.gain.value = 0;
        this.delayNode.connect(this.delayGain);
        this.delayGain.connect(this.masterGain);

        this.reverbNode = this.ac.createConvolver();
        // use helper from audio-fx.js
        this.reverbNode.buffer = createReverbImpulse(this.ac, 2.5);
        this.reverbGain = this.ac.createGain();
        this.reverbGain.gain.value = 0;
        this.reverbNode.connect(this.reverbGain);
        this.reverbGain.connect(this.masterGain);

        this.analyser = this.ac.createAnalyser();
        this.analyser.fftSize = 256;
        this.masterGain.connect(this.analyser);

        this.dest = this.ac.createMediaStreamDestination();
        this.limiter.connect(this.dest);

        // Master FX state
        this.masterPreset = 'off';
        this.autoEvolve = false;

        // State
        this.layers = [];
        this.activeLayerId = null;
        this.activeSheet = 0;
        this.sheetCount = 1;
        this.bpm = 124;
        this.isPlaying = false;
        this.currentStep = 0;
        this.nextNoteTime = 0;
        this.startTime = 0; // Absolute Start time of playback
        this.timerId = null;
        this.isDraggingTimeline = false;
        this.sidechainAmount = 0.5;

        this.selectedNote = null;
        this.dragState = null; 
        this.activeScaleName = 'off';
        this.activeScaleSet = null; // Set of pitch classes
        this.chordMode = false;
        this._baseCutoffs = new Map();

        // Wire UI and visualizer via helper modules
        initUIBindings(this);
        createVisualizer(this);

        this.createLayer('synth', 'Neon Lead');
        this.createLayer('bass', 'Cyber Bass');
        this.createLayer('drums', '80s Kit');
        this.selectLayer(this.layers[0].id);

        this.animLoop();
    }

    applyMasterPreset(key) {
        this.masterPreset = key || 'off';
        if(key === 'dreamy') { this.reverbGain.gain.setTargetAtTime(0.7, this.ac.currentTime, 0.1); this.chorusGain.gain.setTargetAtTime(0.45, this.ac.currentTime, 0.1); }
        else if(key === 'lush') { this.reverbGain.gain.setTargetAtTime(0.85, this.ac.currentTime, 0.1); this.chorusGain.gain.setTargetAtTime(0.6, this.ac.currentTime, 0.1); }
        else if(key === 'tight') { this.reverbGain.gain.setTargetAtTime(0.2, this.ac.currentTime, 0.1); this.chorusGain.gain.setTargetAtTime(0.12, this.ac.currentTime, 0.1); }
        else { this.reverbGain.gain.setTargetAtTime(0.0, this.ac.currentTime, 0.1); this.chorusGain.gain.setTargetAtTime(0.0, this.ac.currentTime, 0.1); }
        try { localStorage.setItem('novasynth_masterPreset', this.masterPreset); } catch(e){}
        try { this.showToast(`Master FX: ${this.masterPreset}`); } catch(e){}
    }

    // Scale / Preset / Chord helpers
    static PITCH_CLASSES() { return ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']; }

    static SCALE_PATTERNS() {
        return {
            'C_major': { root: 'C', intervals: [0,2,4,5,7,9,11] },
            'A_minor': { root: 'A', intervals: [0,2,3,5,7,8,10] },
            'Dorian': { root: 'A', intervals: [0,2,3,5,7,9,10] },
            'Lydian': { root: 'C', intervals: [0,2,4,6,7,9,11] },
            'Pentatonic': { root: 'C', intervals: [0,2,4,7,9] }
        };
    }

    buildScaleSet(scaleKey) {
        if(!scaleKey || scaleKey === 'off') return null;
        const p = App.SCALE_PATTERNS()[scaleKey];
        if(!p) return null;
        const pc = App.PITCH_CLASSES();
        const rootIndex = pc.indexOf(p.root);
        if(rootIndex === -1) return null;
        const set = new Set();
        p.intervals.forEach(iv => {
            const idx = (rootIndex + iv) % 12;
            set.add(pc[idx]);
        });
        return set;
    }

    setScale(scaleKey) {
        // Normalize input
        const key = scaleKey || 'off';
        this.activeScaleName = key;
        this.activeScaleSet = this.buildScaleSet(key);
        // UI indicator
        try {
            const el = document.getElementById('scaleIndicator');
            if(el) el.textContent = key === 'off' ? 'Scale: Off' : `Scale: ${key.replace('_',' ')}`;
        } catch(e) {}
        try { this.showToast(key === 'off' ? 'Scale: Off' : `Scale: ${key.replace('_',' ')}`); } catch(e) {}
    }

    getPitchClass(note) {
        // note like 'A#4' or 'C4' -> return 'A#' or 'C'
        return note.length > 2 && note[1] === '#' ? note.slice(0,2) : note.slice(0,1);
    }

    snapToScale(note) {
        if(!this.activeScaleSet) return note;
        const idx = NOTES.indexOf(note);
        if(idx === -1) return note;
        // search outward for nearest note in scale
        for(let d=0; d<=NOTES.length; d++){
            const hi = idx - d;
            const lo = idx + d;
            if(hi >= 0) {
                if(this.activeScaleSet.has(this.getPitchClass(NOTES[hi]))) return NOTES[hi];
            }
            if(lo < NOTES.length) {
                if(this.activeScaleSet.has(this.getPitchClass(NOTES[lo]))) return NOTES[lo];
            }
        }
        return note;
    }

    // Build a simple triad (root, third, fifth) based on scale intervals (major/minor by checking scale pattern)
    buildTriad(rootNote) {
        // Find root index in NOTES
        const rootIdx = NOTES.indexOf(rootNote);
        if(rootIdx === -1) return [rootNote];
        // To keep it simple, pick notes at offsets: +4 semitones (major third) and +7 semitones (perfect fifth)
        const chrom = App.PITCH_CLASSES();
        const rootPc = this.getPitchClass(rootNote);
        const rootPcIdx = chrom.indexOf(rootPc);
        if(rootPcIdx === -1) return [rootNote];
        const thirdPc = chrom[(rootPcIdx + 4) % 12];
        const fifthPc = chrom[(rootPcIdx + 7) % 12];
        // Find nearest notes in NOTES with those pitch classes near the same octave as root
        const third = NOTES.find((n, i) => this.getPitchClass(n) === thirdPc && Math.abs(i - rootIdx) <= 4) || NOTES.find(n => this.getPitchClass(n) === thirdPc) || rootNote;
        const fifth = NOTES.find((n, i) => this.getPitchClass(n) === fifthPc && Math.abs(i - rootIdx) <= 6) || NOTES.find(n => this.getPitchClass(n) === fifthPc) || rootNote;
        return [rootNote, third, fifth];
    }

    // Preset bank
    PRESET_BANK() {
        return {
            'dream_pad': { wave: 'sawtooth', detune: 12, vol: 0.6, attack: 0.5, decay: 0.6, sustain: 0.85, release: 1.6, cutoff: 1200, res: 2, delay: 0.25, reverb: 0.6, lfoRate: 0.1, lfoDepth: 40, gate: false },
            'shimmer_pad': { wave: 'sawtooth', detune: 18, vol: 0.55, attack: 0.8, decay: 0.8, sustain: 0.9, release: 2.2, cutoff: 1500, res: 1.5, delay: 0.2, reverb: 0.75, lfoRate: 0.05, lfoDepth: 30, gate: false },
            'soft_lead': { wave: 'sine', detune: 0, vol: 0.6, attack: 0.02, decay: 0.2, sustain: 0.6, release: 0.6, cutoff: 2500, res: 3, delay: 0, reverb: 0.25, lfoRate: 3, lfoDepth: 0, gate: false },
            'evolving_texture': { wave: 'triangle', detune: 6, vol: 0.5, attack: 0.4, decay: 0.6, sustain: 0.8, release: 1.8, cutoff: 1000, res: 2, delay: 0.3, reverb: 0.7, lfoRate: 0.2, lfoDepth: 80, gate: false },
            'dream_bass': { wave: 'square', detune: 0, vol: 0.8, attack: 0.02, decay: 0.1, sustain: 0.8, release: 0.4, cutoff: 800, res: 4, delay: 0, reverb: 0.05, lfoRate: 0, lfoDepth: 0, gate: false }
        };
    }

    applyPreset(presetKey, layerId=null) {
        const presets = this.PRESET_BANK();
        const p = presets[presetKey];
        if(!p) return;
        const lid = layerId || this.activeLayerId;
        const layer = this.layers.find(l => l.id === lid);
        if(!layer) return;
        layer.params = Object.assign({}, layer.params, p);
        this.renderGrid();
        try { this.autoSave(); } catch(e) {}
        this.showToast('Preset applied');
    }

    playNote(layer, freq, time, durationSteps, noteData, gainScale=1) {
        if(layer.muted) return;
        if(this.layers.some(l => l.solo) && !layer.solo) return;

        const t = time;
        const d = durationSteps * (60 / this.bpm / 4);
        const p = layer.params;

        const osc1 = this.ac.createOscillator();
        const osc2 = this.ac.createOscillator();
        osc1.type = p.wave; osc2.type = p.wave;
        osc1.frequency.setValueAtTime(freq, t); osc2.frequency.setValueAtTime(freq, t);
        osc1.detune.value = -p.detune; osc2.detune.value = p.detune;

        const lfo = this.ac.createOscillator();
        lfo.frequency.value = p.lfoRate;
        const lfoDepth = this.ac.createGain();
        lfoDepth.gain.value = p.lfoDepth;
        lfo.connect(lfoDepth);

        const filter = this.ac.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(p.cutoff, t);
        filter.Q.value = p.res;
        lfoDepth.connect(filter.frequency);

        const amp = this.ac.createGain();
        
        // Override ADSR if note specific fades exist
        const noteAtk = noteData && noteData.fadeIn > 0 ? (d * noteData.fadeIn) : Math.max(0.005, p.attack);
        const noteRel = noteData && noteData.fadeOut > 0 ? (d * noteData.fadeOut) : p.release;
        
        // Scale per-voice volume to avoid clipping when many notes trigger together
        const voiceVol = p.vol * 0.5 * gainScale;

        amp.gain.setValueAtTime(0, t);
        amp.gain.linearRampToValueAtTime(voiceVol, t + noteAtk);
        amp.gain.exponentialRampToValueAtTime(Math.max(0.001, voiceVol * p.sustain), t + noteAtk + p.decay);

        const stopTime = t + d;
        amp.gain.setValueAtTime(Math.max(0.001, voiceVol * p.sustain), stopTime);
        amp.gain.exponentialRampToValueAtTime(0.001, stopTime + noteRel);

        if(p.gate) {
            const gateGain = this.ac.createGain();
            const stepTime = (60/this.bpm/4);
            const steps = durationSteps;
            for(let i=0; i<steps; i++) {
                const st = t + (i * stepTime);
                gateGain.gain.setValueAtTime(0, st);
                gateGain.gain.linearRampToValueAtTime(1, st + 0.01);
                gateGain.gain.setValueAtTime(1, st + (stepTime * 0.5));
                gateGain.gain.linearRampToValueAtTime(0, st + (stepTime * 0.5) + 0.01);
            }
            amp.connect(gateGain); gateGain.connect(layer.gainNode);
        } else {
            amp.connect(layer.gainNode);
        }

        osc1.connect(filter); osc2.connect(filter); filter.connect(amp);

        if(p.delay > 0) { const s=this.ac.createGain(); s.gain.value=p.delay; amp.connect(s); s.connect(this.delayNode); }
        if(p.reverb > 0) { const s=this.ac.createGain(); s.gain.value=p.reverb; amp.connect(s); s.connect(this.reverbNode); }

        osc1.start(t); osc2.start(t); lfo.start(t);
        const kill = stopTime + noteRel + 0.1;
        osc1.stop(kill); osc2.stop(kill); lfo.stop(kill);
    }

    playDrum(layer, type, time, gainScale=1) {
        if(layer.muted) return;
        if(this.layers.some(l => l.solo) && !layer.solo) return;

        const t = time;
        const gain = this.ac.createGain();
        gain.connect(layer.gainNode);

        if(type === "Kick") {
            this.triggerSidechain(t);
            const osc = this.ac.createOscillator();
            osc.frequency.setValueAtTime(150, t);
            osc.frequency.exponentialRampToValueAtTime(40, t + 0.4);
            gain.gain.setValueAtTime(0.8 * gainScale, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
            osc.connect(gain); osc.start(t); osc.stop(t+0.5);
        } else if(type === "Snare") {
            if(layer.params.reverb>0) { const s=this.ac.createGain(); s.gain.value=layer.params.reverb; gain.connect(s); s.connect(this.reverbNode); }
            const b = this.ac.createBuffer(1, this.ac.sampleRate*0.5, this.ac.sampleRate);
            const d = b.getChannelData(0);
            for(let i=0; i<d.length; i++) d[i]=Math.random()*2-1;
            const n = this.ac.createBufferSource(); n.buffer=b;
            const f = this.ac.createBiquadFilter(); f.type="lowpass"; f.frequency.value=3000;
            gain.gain.setValueAtTime(0.6 * gainScale, t); gain.gain.exponentialRampToValueAtTime(0.001, t+0.25);
            n.connect(f); f.connect(gain); n.start(t);
        } else {
            const o = this.ac.createOscillator(); o.type="square";
            const f = this.ac.createBiquadFilter(); f.type="highpass"; f.frequency.value=7000;
            o.connect(f); f.connect(gain); o.frequency.value=800;
            gain.gain.setValueAtTime(0.2 * gainScale, t); gain.gain.exponentialRampToValueAtTime(0.001, t+0.05);
            o.start(t); o.stop(t+0.1);
        }
    }

    triggerSidechain(time) {
        this.sidechainBus.gain.cancelScheduledValues(time);
        this.sidechainBus.gain.setValueAtTime(1, time);
        this.sidechainBus.gain.linearRampToValueAtTime(1 - this.sidechainAmount, time + 0.005);
        this.sidechainBus.gain.exponentialRampToValueAtTime(1, time + 0.4); 
    }

    createLayer(type, name, existingData=null) {
        const id = existingData ? existingData.id : Math.random().toString(36).substr(2, 9);
        const gainNode = this.ac.createGain();
        if(type === 'drums') gainNode.connect(this.drumBus);
        else gainNode.connect(this.sidechainBus);

        const newLayer = {
            id, name: name || type.toUpperCase(), type,
            muted: false, solo: false, gainNode,
            params: existingData ? existingData.params : {
                wave: type === 'drums' ? 'square' : 'sawtooth', detune: type === 'synth' ? 5 : 0,
                vol: 0.7, attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.3,
                cutoff: type === 'bass' ? 600 : 3000, res: 5,
                delay: type === 'synth' ? 0.2 : 0, reverb: type === 'synth' ? 0.2 : 0,
                lfoRate: 1, lfoDepth: 0, gate: false
            },
            sheets: existingData ? existingData.sheets : []
        };
        if(!existingData) for(let i=0; i<this.sheetCount; i++) newLayer.sheets.push(this.createEmptySheet());
        this.layers.push(newLayer);
        this.renderLayerList();
        if(!existingData) { this.selectLayer(id); document.getElementById('newLayerModal').classList.add('hidden'); try{ this.autoSave(); }catch(e){} }
    }
    createEmptySheet() { return Array(16).fill(null).map(() => []); }

    addSheet() { this.sheetCount++; this.layers.forEach(l => l.sheets.push(this.createEmptySheet())); this.activeSheet = this.sheetCount - 1; this.updateView(); try{ this.autoSave(); }catch(e){} }
    duplicateSheet() { this.sheetCount++; this.layers.forEach(l => { const clone = JSON.parse(JSON.stringify(l.sheets[this.activeSheet])); l.sheets.push(clone); }); this.activeSheet = this.sheetCount - 1; this.updateView(); try{ this.autoSave(); }catch(e){} }

    updateView() { this.renderSheetSelector(); this.renderGrid(); }

    renderSheetSelector() {
        const container = document.getElementById('sheetSelector');
        if(!container) return;
        container.innerHTML = '';
        for(let i=0;i<this.sheetCount;i++){
            const btn = document.createElement('button');
            btn.className = `w-6 h-6 rounded text-[10px] ${i===this.activeSheet? 'bg-fuchsia-600 text-white':'text-slate-400 hover:bg-slate-800'}`;
            btn.innerText = (i+1).toString();
            btn.onclick = () => { this.activeSheet = i; this.updateView(); };
            container.appendChild(btn);
        }
    }

    renderLayerList() {
        const el = document.getElementById('layerList'); el.innerHTML = '';
        this.layers.forEach(l => {
            const div = document.createElement('div');
            div.className = `layer-item p-3 flex justify-between items-center cursor-pointer ${l.id === this.activeLayerId ? 'selected' : 'text-slate-500'}`;
            div.onclick = () => this.selectLayer(l.id);
            div.ondblclick = (e) => { e.stopPropagation(); const n=prompt("Rename", l.name); if(n){l.name=n; this.renderLayerList(); this.selectLayer(l.id);} };
            div.innerHTML = `
                <div class="flex items-center gap-3 select-none"><div class="w-1 h-full ${l.id===this.activeLayerId ? 'bg-fuchsia-500':''}"></div><div class="font-bold text-xs w-20 truncate ${l.id===this.activeLayerId ? 'text-white':''}">${l.name}</div></div>
                <div class="flex gap-1"><div class="btn-icon btn-solo ${l.solo?'active':''}" onclick="app.toggleSolo('${l.id}', event)">S</div><div class="btn-icon btn-mute ${l.muted?'active':''}" onclick="app.toggleMute('${l.id}', event)">M</div></div>`;
            el.appendChild(div);
        });
    }

    selectLayer(id) {
        this.activeLayerId = id;
        const l = this.layers.find(l => l.id === id);
        document.getElementById('activeLayerInfo').textContent = `${l.name} // ${l.type.toUpperCase()}`;
        const set = (id, v) => { const el = document.getElementById(id); if(el.type === 'checkbox') el.checked = v; else el.value = v; };
        const p = l.params;
        set('paramWave', p.wave); set('paramDetune', p.detune); set('paramVol', p.vol);
        set('paramAttack', p.attack); set('paramDecay', p.decay); set('paramSustain', p.sustain);
        set('paramRelease', p.release); set('paramCutoff', p.cutoff); set('paramRes', p.res);
        set('paramDelay', p.delay); set('paramReverb', p.reverb);
        set('paramLfoRate', p.lfoRate); set('paramLfoDepth', p.lfoDepth); set('paramGate', p.gate);
        this.renderLayerList(); this.renderGrid();
    }

    renderGrid() {
        const head = document.getElementById('timelineHeader');
        const body = document.getElementById('gridScrollArea');
        const l = this.layers.find(x=>x.id===this.activeLayerId);
        const sheet = l.sheets[this.activeSheet];
        const rows = l.type === 'drums' ? DRUMS : NOTES;
        
        head.innerHTML = '';
        for(let i=0; i<16; i++) {
            const d = document.createElement('div'); d.className = 'time-step'; d.innerText = i+1; head.appendChild(d);
        }

        body.innerHTML = '';
        rows.forEach(rowVal => {
            const row = document.createElement('div'); row.className = 'track-row';
            const lbl = document.createElement('div'); lbl.className = `row-header ${rowVal.includes('#')?'black-key':''}`;
            lbl.innerText = rowVal; lbl.onmousedown = () => this.previewNote(rowVal);
            row.appendChild(lbl);

            const cells = document.createElement('div'); cells.className = 'grid-cells';
            
            for(let i=0; i<16; i++) {
                const c = document.createElement('div'); c.className = 'grid-cell';
                c.onmousedown = (e) => {
                    if(e.target === c) this.handleGridClick(rowVal, i, e.shiftKey);
                };
                cells.appendChild(c);
            }

            for(let i=0; i<16; i++) {
                const n = sheet[i].find(x=>x.value===rowVal);
                if(n) {
                    const nb = document.createElement('div');
                    nb.className = `note-block type-${l.type}`;
                    if(this.selectedNote && this.selectedNote.note === n) nb.classList.add('selected');
                    
                    nb.style.left = `${(i/16)*100}%`;
                    nb.style.width = `calc(${(n.duration/16)*100}% - 2px)`;
                    nb.innerText = l.type==='drums'?'':rowVal;
                    
                    if (l.type !== 'drums') {
                        // Default fades to layer params if note doesn't have them
                        const inPct = (n.fadeIn !== undefined ? n.fadeIn : 0) * 100;
                        const outPct = (n.fadeOut !== undefined ? n.fadeOut : 0) * 100;
                        nb.style.clipPath = `polygon(0% 100%, ${Math.min(50, inPct)}% 0%, ${100-Math.min(50, outPct)}% 0%, 100% 100%)`;
                    }

                    nb.onmousedown = (e) => { e.stopPropagation(); this.handleNoteClick(e, n, i, rowVal, l); };
                    // Right-click to delete a note
                    nb.oncontextmenu = (e) => {
                        e.preventDefault(); e.stopPropagation();
                        const sArr = l.sheets[this.activeSheet][i];
                        const idx = sArr.indexOf(n);
                        if(idx > -1) sArr.splice(idx,1);
                        if(this.selectedNote && this.selectedNote.note === n) { this.selectedNote = null; document.getElementById('noteSettings').style.display = 'none'; }
                        this.renderGrid();
                        try { this.autoSave(); } catch(e) {}
                    };
                    cells.appendChild(nb);
                }
            }
            row.appendChild(cells);
            body.appendChild(row);
        });
    }

    handleNoteClick(e, note, step, rowVal, layer) {
        if(this.selectedNote && this.selectedNote.note === note) {
            // keep selected
        } else {
            this.selectedNote = { note, step, rowVal, layer };
            this.showNoteSettings(e.target);
            this.renderGrid();
        }
        this.initDrag(e, note, step, rowVal, layer);
    }

    showNoteSettings(targetEl) {
        const p = document.getElementById('noteSettings');
        const rect = targetEl.getBoundingClientRect();
        p.style.display = 'block';
        p.style.left = Math.min(window.innerWidth - 150, rect.left) + 'px';
        p.style.top = (rect.bottom + 5) + 'px';

        // Bind inputs
        const n = this.selectedNote.note;
        const fi = document.getElementById('nsFadeIn');
        const fo = document.getElementById('nsFadeOut');
        
        fi.value = n.fadeIn !== undefined ? n.fadeIn : 0;
        fo.value = n.fadeOut !== undefined ? n.fadeOut : 0;

        fi.oninput = (e) => { n.fadeIn = parseFloat(e.target.value); this.renderGrid(); };
        fo.oninput = (e) => { n.fadeOut = parseFloat(e.target.value); this.renderGrid(); };
        
          // Note deletion is handled by right-clicking a note in the grid (context menu).
    }

    initDrag(e, note, startStep, startRow, layer) {
        this.dragState = {
            note: note,
            startX: e.clientX,
            startY: e.clientY,
            originalStep: startStep,
            originalRow: startRow,
            sheet: layer.sheets[this.activeSheet],
            layer: layer,
            rows: layer.type === 'drums' ? DRUMS : NOTES,
            moved: false
        };

        const moveHandler = (ev) => {
            if(!this.dragState) return;
            const dx = ev.clientX - this.dragState.startX;
            const dy = ev.clientY - this.dragState.startY;
            if(Math.abs(dx) > 5 || Math.abs(dy) > 5) {
                this.dragState.moved = true;
                document.getElementById('noteSettings').style.display = 'none';
            }
            document.body.style.cursor = 'grabbing';
        };

        const upHandler = (ev) => {
            document.body.style.cursor = 'default';
            window.removeEventListener('mousemove', moveHandler);
            window.removeEventListener('mouseup', upHandler);

            if(!this.dragState) return;

            if(this.dragState.moved) {
                const gridRect = document.querySelector('.grid-cells').getBoundingClientRect();
                const cellW = gridRect.width / 16;
                const cellH = 30; 
                const dx = ev.clientX - this.dragState.startX;
                const dy = ev.clientY - this.dragState.startY;
                const stepDelta = Math.round(dx / cellW);
                const rowDelta = Math.round(dy / cellH);

                const oldRowIdx = this.dragState.rows.indexOf(this.dragState.originalRow);
                let newRowIdx = oldRowIdx + rowDelta;
                let newStep = this.dragState.originalStep + stepDelta;

                if(newRowIdx < 0) newRowIdx = 0;
                if(newRowIdx >= this.dragState.rows.length) newRowIdx = this.dragState.rows.length - 1;
                if(newStep < 0) newStep = 0;
                if(newStep > 15) newStep = 15;

                const newRowVal = this.dragState.rows[newRowIdx];
                const oldStepArr = this.dragState.sheet[this.dragState.originalStep];
                
                const idx = oldStepArr.indexOf(this.dragState.note);
                if(idx > -1) oldStepArr.splice(idx, 1);
                // Snap to active scale if set
                const snappedRowVal = this.snapToScale(newRowVal);
                this.dragState.note.value = snappedRowVal;
                const destArr = this.dragState.sheet[newStep];
                const dup = destArr.find(x => x.value === this.dragState.note.value);
                if(!dup) {
                    destArr.push(this.dragState.note);
                    this.selectedNote = { note: this.dragState.note, step: newStep, rowVal: snappedRowVal, layer: this.dragState.layer };
                } else {
                    // If a note with same pitch already exists at target, select that note instead
                    this.selectedNote = { note: dup, step: newStep, rowVal: snappedRowVal, layer: this.dragState.layer };
                }
                
                this.previewNote(snappedRowVal);
                this.renderGrid();
                try { this.autoSave(); } catch(e) {}
            }
            this.dragState = null;
        };

        window.addEventListener('mousemove', moveHandler);
        window.addEventListener('mouseup', upHandler);
    }

    handleGridClick(val, step, shift) {
        this.selectedNote = null;
        document.getElementById('noteSettings').style.display = 'none';

        const l = this.layers.find(x=>x.id===this.activeLayerId);
        const s = l.sheets[this.activeSheet];
        
        if(shift && step>0) {
            for(let i=step-1; i>=0; i--) {
                const n = s[i].find(x=>x.value===val);
                if(n) { n.duration = (step-i)+1; this.renderGrid(); return; }
            }
        }
        // Snap to current scale if enabled
        val = this.snapToScale(val);

        if(this.chordMode && l.type !== 'drums') {
            const notes = this.buildTriad(val);
            let addedAny = false;
            notes.forEach(noteVal => {
                const exists = s[step].find(x => x.value === noteVal);
                if(!exists) {
                    const nn = { value: noteVal, duration: 1, fadeIn: 0, fadeOut: 0 };
                    s[step].push(nn);
                    addedAny = true;
                }
            });
            if(addedAny) {
                this.previewNote(notes[0]);
                this.renderGrid();
                try { this.autoSave(); } catch(e) {}
            } else {
                const existing = s[step].find(x => x.value === notes[0]);
                if(existing) this.selectedNote = { note: existing, step: step, rowVal: notes[0], layer: l };
                this.renderGrid();
            }
            return;
        }

        // Prevent placing another note with the same pitch in the same cell
        const existing = s[step].find(x => x.value === val);
        if(existing) {
            this.selectedNote = { note: existing, step: step, rowVal: val, layer: l };
            this.renderGrid();
            return;
        }

        const n = {value:val, duration:1, fadeIn:0, fadeOut:0};
        s[step].push(n);
        this.previewNote(val);
        this.renderGrid();
        try { this.autoSave(); } catch(e) {}
    }

    previewNote(val) {
        this.ac.resume();
        const l = this.layers.find(x=>x.id===this.activeLayerId);
        if(l.type==='drums') this.playDrum(l, val, this.ac.currentTime, 1);
        else this.playNote(l, FREQS[val], this.ac.currentTime, 0.5, null, 1);
    }

    toggleMute(id, e){e.stopPropagation();const l=this.layers.find(x=>x.id===id);l.muted=!l.muted;this.renderLayerList();}
    toggleSolo(id, e){e.stopPropagation();const l=this.layers.find(x=>x.id===id);l.solo=!l.solo;this.renderLayerList();}
    
    start() {
        if(this.isPlaying) return;
        this.ac.resume();
        this.isPlaying = true;
        this.startTime = this.ac.currentTime - (this.currentStep * (60.0/this.bpm/4)) - (this.activeSheet * 16 * (60.0/this.bpm/4));
        this.nextNoteTime = this.ac.currentTime; 
        this.scheduler();
        document.getElementById('playBtn').classList.add('text-green-400','bg-slate-800');
    }
    stop() {
        this.isPlaying = false; clearTimeout(this.timerId);
        document.getElementById('playBtn').classList.remove('text-green-400','bg-slate-800');
    }

    scheduler() {
        const lookahead = 0.1;
        while(this.nextNoteTime < this.ac.currentTime + lookahead) {
            this.scheduleStep(this.currentStep, this.nextNoteTime);
            this.nextNoteTime += 0.25 * (60.0/this.bpm);
            this.currentStep++;
            if(this.currentStep>=16) {
                this.currentStep=0;
                this.activeSheet=(this.activeSheet+1)%this.sheetCount;
                requestAnimationFrame(()=>this.updateView());
            }
        }
        if(this.isPlaying) this.timerId = setTimeout(()=>this.scheduler(), 25);
    }

    scheduleStep(s, t) {
        this.layers.forEach(l => {
            // Normalize per-step polyphony to avoid loud spikes when multiple notes play
            const stepNotes = l.sheets[this.activeSheet][s];
            const polyCount = stepNotes.length || 1;
            // Use sqrt normalization so perceived loudness is smoother
            const gainScale = 1 / Math.sqrt(Math.max(1, polyCount));
            stepNotes.forEach(n => {
                if(l.type==='drums') this.playDrum(l, n.value, t, gainScale);
                else this.playNote(l, FREQS[n.value], t, n.duration, n, gainScale);
            });
        });
    }

    animLoop() {
        requestAnimationFrame(() => {
            this.animLoop();
            
            const c = document.getElementById('playheadCursor');
            const r = document.getElementById('sequencerArea').getBoundingClientRect();
            if(!r.width) return;
            const w = (r.width-80)/16;
            
            let x = 80;
            
            if(this.isPlaying) {
                const secPerBeat = 60.0 / this.bpm;
                const secPerStep = secPerBeat / 4;
                const loopDur = secPerStep * 16 * this.sheetCount;
                const currentSongTime = this.ac.currentTime - this.startTime;
                
                const posInSheet = (currentSongTime % (secPerStep * 16)) / (secPerStep * 16);
                x += posInSheet * (r.width-80);
            } else {
                x += this.currentStep * w;
            }

            c.style.display = 'block';
            c.style.transform = `translateX(${x}px)`;

            // Auto-evolve: slowly modulate layer cutoff values for movement
            if(this.autoEvolve) {
                const t = this.ac.currentTime;
                this.layers.forEach(l => {
                    const p = l.params;
                    // store base value once
                    if(!this._baseCutoffs.has(l.id)) this._baseCutoffs.set(l.id, p.cutoff || 1000);
                    const base = this._baseCutoffs.get(l.id);
                    const rate = Math.max(0.02, p.lfoRate || 0.1);
                    const depth = Math.max(10, p.lfoDepth || 50);
                    const target = base + Math.sin(t * rate) * depth;
                    p.cutoff = Math.max(50, Math.min(10000, target));
                });
                // re-render grid to reflect any visual changes
                this.renderGrid();
            }
        });
    }

    initUI() {
        const $ = (id) => document.getElementById(id);
        $('addLayerBtn').onclick = () => $('newLayerModal').classList.remove('hidden');
        $('playBtn').onclick = () => this.start();
        $('stopBtn').onclick = () => this.stop();
        $('bpmInput').onchange = (e) => this.bpm = parseInt(e.target.value);
        $('addSheetBtn').onclick = () => this.addSheet();
        $('copySheetBtn').onclick = () => this.duplicateSheet();
        $('removeSheetBtn').onclick = () => { if(this.sheetCount>1) { this.layers.forEach(l=>l.sheets.splice(this.activeSheet,1)); this.sheetCount--; this.activeSheet=Math.max(0,this.activeSheet-1); this.updateView(); } };
        $('clearSheetBtn').onclick = () => { this.layers.find(x=>x.id===this.activeLayerId).sheets[this.activeSheet]=Array(16).fill(null).map(()=>[]); this.renderGrid(); };
        $('deleteLayerBtn').onclick = () => { if(this.layers.length>1){this.layers=this.layers.filter(l=>l.id!==this.activeLayerId); this.selectLayer(this.layers[0].id);} };
        $('saveBtn').onclick = () => this.saveProject();
        $('loadInput').onchange = (e) => this.loadProject(e.target.files[0]);
        $('exportBtn').onclick = () => {
            const r = new MediaRecorder(this.dest.stream); const c = [];
            r.ondataavailable = e => c.push(e.data);
            r.onstop = () => { const b=new Blob(c,{type:'audio/wav'}); const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download='novasynth.wav'; a.click(); };
            r.start(); this.activeSheet=0; this.currentStep=0; this.start();
            setTimeout(()=>{this.stop(); setTimeout(()=>r.stop(),500);}, (60/this.bpm*4*this.sheetCount)*1000);
        };

        $('masterVol').oninput = (e) => this.masterGain.gain.value = e.target.value;
        $('masterSidechain').oninput = (e) => this.sidechainAmount = parseFloat(e.target.value);

        // Tooltip
        const tt = $('tooltip');
        document.querySelectorAll('[data-tip], .knob-group, .flex[data-tip]').forEach(el => {
            el.addEventListener('mouseenter', (e) => {
                const text = el.getAttribute('data-tip') || el.querySelector('.knob-group')?.getAttribute('data-tip') || el.closest('[data-tip]')?.getAttribute('data-tip');
                if(text) {
                    tt.textContent = text; tt.style.opacity = 1;
                    const r = el.getBoundingClientRect();
                    tt.style.left = r.left + 'px'; tt.style.top = (r.bottom + 5) + 'px';
                }
            });
            el.addEventListener('mouseleave', () => tt.style.opacity = 0);
        });

        // Timeline Scrubbing
        const head = $('timelineHeader');
        const getS = (e) => { const r=head.getBoundingClientRect(); return Math.max(0,Math.min(15, Math.floor((e.clientX-r.left-80)/((r.width-80)/16)))); };
        head.onmousedown = (e) => { 
            this.isDraggingTimeline=true; 
            this.currentStep=getS(e); 
            if(this.isPlaying) {
                const secPerStep = 60.0 / this.bpm / 4;
                this.startTime = this.ac.currentTime - (this.currentStep * secPerStep) - (this.activeSheet * 16 * secPerStep);
            }
        };
        window.onmousemove = (e) => { 
            if(this.isDraggingTimeline){
                this.currentStep=getS(e);
                if(this.isPlaying) {
                    const secPerStep = 60.0 / this.bpm / 4;
                    this.startTime = this.ac.currentTime - (this.currentStep * secPerStep) - (this.activeSheet * 16 * secPerStep);
                }
            } 
        };
        window.onmouseup = () => this.isDraggingTimeline=false;
        window.onkeydown = (e) => { if(e.code==='Space'){e.preventDefault(); this.isPlaying?this.stop():this.start();} };

        // Params
        const bind = (id, k, chk=false) => {
            $(id).oninput = (e) => {
                const v = chk ? e.target.checked : parseFloat(e.target.value);
                const l = this.layers.find(x=>x.id===this.activeLayerId);
                l.params[k] = v;
                if(k==='delay') this.delayGain.gain.setTargetAtTime(v, this.ac.currentTime, 0.1);
                if(k==='reverb') this.reverbGain.gain.setTargetAtTime(v, this.ac.currentTime, 0.1);
                if(['attack','decay','sustain','release'].includes(k)) this.renderGrid();
            };
        };
        bind('paramWave','wave'); bind('paramDetune','detune'); bind('paramVol','vol');
        bind('paramAttack','attack'); bind('paramDecay','decay'); bind('paramSustain','sustain'); bind('paramRelease','release');
        bind('paramCutoff','cutoff'); bind('paramRes','res'); bind('paramDelay','delay'); bind('paramReverb','reverb');
        bind('paramLfoRate','lfoRate'); bind('paramLfoDepth','lfoDepth'); bind('paramGate','gate', true);
    }

    // Save project to a JSON file (downloads to user's machine)
    saveProject() {
        const data = {
            version: 1,
            bpm: this.bpm,
            sheetCount: this.sheetCount,
            activeSheet: this.activeSheet,
            activeLayerId: this.activeLayerId,
            activeScaleName: this.activeScaleName,
            masterPreset: this.masterPreset,
            autoEvolve: this.autoEvolve,
            layers: this.layers.map(l => ({ id: l.id, name: l.name, type: l.type, params: l.params, sheets: l.sheets }))
        };

        const str = JSON.stringify(data, null, 2);
        const blob = new Blob([str], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'novasynth-project.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        // Also persist to localStorage as a quick-save backup
        try { this.autoSave(); } catch (e) { /* ignore */ }
        this.showToast('Project downloaded');
    }

    showToast(msg, duration=1600) {
        const t = document.getElementById('toast');
        if(!t) return;
        t.textContent = msg;
        t.classList.remove('hidden');
        t.style.opacity = '1';
        clearTimeout(this._toastTimeout);
        this._toastTimeout = setTimeout(() => { t.classList.add('hidden'); t.style.opacity = ''; }, duration);
    }

    // Save a serialized copy into localStorage for quick autosave/restore
    autoSave() {
        try {
            const data = {
                version: 1,
                bpm: this.bpm,
                sheetCount: this.sheetCount,
                activeSheet: this.activeSheet,
                activeLayerId: this.activeLayerId,
                activeScaleName: this.activeScaleName,
                masterPreset: this.masterPreset,
                autoEvolve: this.autoEvolve,
                layers: this.layers.map(l => ({ id: l.id, name: l.name, type: l.type, params: l.params, sheets: l.sheets }))
            };
            localStorage.setItem('novasynth_autosave', JSON.stringify(data));
            localStorage.setItem('novasynth_autosave_time', Date.now().toString());
        } catch (e) {
            // ignore storage errors (e.g., quota)
        }
    }

    // Load a project from a File, JSON string, or plain object
    loadProject(input) {
        if(!input) return;
        if(typeof input === 'string') {
            try { const obj = JSON.parse(input); this._applyProject(obj); } catch(e) { alert('Invalid project JSON'); }
            return;
        }

        if(input instanceof File) {
            const reader = new FileReader();
            reader.onload = (e) => {
                try { const obj = JSON.parse(e.target.result); this._applyProject(obj); }
                catch(err) { alert('Failed to load project: invalid JSON'); }
            };
            reader.readAsText(input);
            return;
        }

        if(typeof input === 'object') {
            this._applyProject(input);
        }
    }

    _applyProject(data) {
        if(!data || !Array.isArray(data.layers)) { alert('Invalid project data'); return; }

        // Stop playback while loading
        this.stop();

        // Basic metadata
        this.bpm = data.bpm || this.bpm;
        this.sheetCount = data.sheetCount || (data.layers[0] && data.layers[0].sheets ? data.layers[0].sheets.length : this.sheetCount);
        this.activeSheet = Math.min(Math.max(0, data.activeSheet || 0), Math.max(0, this.sheetCount - 1));

        // Recreate layers (createLayer will construct audio nodes)
        this.layers = [];
        data.layers.forEach(ld => {
            // Ensure sheets length matches sheetCount
            if(!ld.sheets || !Array.isArray(ld.sheets)) ld.sheets = Array(this.sheetCount).fill(null).map(() => []);
            // If sheets length mismatches, try to normalize
            if(ld.sheets.length < this.sheetCount) {
                while(ld.sheets.length < this.sheetCount) ld.sheets.push(Array(16).fill(null).map(()=>[]));
            }
            this.createLayer(ld.type, ld.name, ld);
        });

        this.activeLayerId = data.activeLayerId || (this.layers[0] && this.layers[0].id) || null;
        // restore scale and master preset and autoEvolve
        if(data.activeScaleName) this.setScale(data.activeScaleName);
        if(data.masterPreset) this.applyMasterPreset(data.masterPreset);
        this.autoEvolve = !!data.autoEvolve;
        this.renderLayerList();
        if(this.activeLayerId) this.selectLayer(this.activeLayerId);
        else if(this.layers[0]) this.selectLayer(this.layers[0].id);
        this.updateView();
        try { this.showToast('Project loaded'); } catch(e) {}
    }
}

// Expose global app instance
const app = new App();
