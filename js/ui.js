// UI bindings and helpers. Exposes initUIBindings(app) to wire DOM -> app interactions
function initUIBindings(app) {
    const $ = (id) => document.getElementById(id);
    $('addLayerBtn').onclick = () => $('newLayerModal').classList.remove('hidden');
    $('playBtn').onclick = () => app.start();
    $('stopBtn').onclick = () => app.stop();
    $('bpmInput').onchange = (e) => app.bpm = parseInt(e.target.value);
    $('addSheetBtn').onclick = () => app.addSheet();
    $('copySheetBtn').onclick = () => app.duplicateSheet();
    $('removeSheetBtn').onclick = () => { if(app.sheetCount>1) { app.layers.forEach(l=>l.sheets.splice(app.activeSheet,1)); app.sheetCount--; app.activeSheet=Math.max(0,app.activeSheet-1); app.updateView(); try{ app.autoSave(); }catch(e){} } };
    $('clearSheetBtn').onclick = () => { app.layers.find(x=>x.id===app.activeLayerId).sheets[app.activeSheet]=Array(16).fill(null).map(()=>[]); app.renderGrid(); try{ app.autoSave(); }catch(e){} };
    $('deleteLayerBtn').onclick = () => { if(app.layers.length>1){app.layers=app.layers.filter(l=>l.id!==app.activeLayerId); app.selectLayer(app.layers[0].id); try{ app.autoSave(); }catch(e){} } };
    $('saveBtn').onclick = () => app.saveProject && app.saveProject();
    $('loadInput').onchange = (e) => app.loadProject && app.loadProject(e.target.files[0]);
    $('exportBtn').onclick = () => {
        if(!app.dest) return;
        const r = new MediaRecorder(app.dest.stream); const c = [];
        r.ondataavailable = e => c.push(e.data);
        r.onstop = () => { const b=new Blob(c,{type:'audio/wav'}); const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download='novasynth.wav'; a.click(); };
        r.start(); app.activeSheet=0; app.currentStep=0; app.start();
        setTimeout(()=>{app.stop(); setTimeout(()=>r.stop(),500);}, (60/app.bpm*4*app.sheetCount)*1000);
    };

    $('masterVol').oninput = (e) => app.masterGain.gain.value = e.target.value;
    $('masterSidechain').oninput = (e) => app.sidechainAmount = parseFloat(e.target.value);

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
        app.isDraggingTimeline=true; 
        app.currentStep=getS(e); 
        if(app.isPlaying) {
            const secPerStep = 60.0 / app.bpm / 4;
            app.startTime = app.ac.currentTime - (app.currentStep * secPerStep) - (app.activeSheet * 16 * secPerStep);
        }
    };
    window.onmousemove = (e) => { 
        if(app.isDraggingTimeline){
            app.currentStep=getS(e);
            if(app.isPlaying) {
                const secPerStep = 60.0 / app.bpm / 4;
                app.startTime = app.ac.currentTime - (app.currentStep * secPerStep) - (app.activeSheet * 16 * secPerStep);
            }
        } 
    };
    window.onmouseup = () => app.isDraggingTimeline=false;
    window.onkeydown = (e) => { if(e.code==='Space'){e.preventDefault(); app.isPlaying?app.stop():app.start();} };

    // Params binding helper
    const bind = (id, k, chk=false) => {
        $(id).oninput = (e) => {
            const v = chk ? e.target.checked : parseFloat(e.target.value);
            const l = app.layers.find(x=>x.id===app.activeLayerId);
            l.params[k] = v;
            if(k==='delay') app.delayGain.gain.setTargetAtTime(v, app.ac.currentTime, 0.1);
            if(k==='reverb') app.reverbGain.gain.setTargetAtTime(v, app.ac.currentTime, 0.1);
            if(['attack','decay','sustain','release'].includes(k)) app.renderGrid();
        };
    };
    bind('paramWave','wave'); bind('paramDetune','detune'); bind('paramVol','vol');
    bind('paramAttack','attack'); bind('paramDecay','decay'); bind('paramSustain','sustain'); bind('paramRelease','release');
    bind('paramCutoff','cutoff'); bind('paramRes','res'); bind('paramDelay','delay'); bind('paramReverb','reverb');
    bind('paramLfoRate','lfoRate'); bind('paramLfoDepth','lfoDepth'); bind('paramGate','gate', true);

    // Provide showNoteSettings on App prototype to position the note properties popover at the right side
    // of the parameters panel. If no layer is selected, show a small message instead of inputs.
    app.showNoteSettings = function(targetEl) {
        const p = document.getElementById('noteSettings');
        if(!p) return;

    const nsMessage = document.getElementById('nsMessage');
    const fiRow = document.getElementById('nsFadeIn')?.closest('.ns-row');
    const foRow = document.getElementById('nsFadeOut')?.closest('.ns-row');

        // Dock to the right side of the parameters panel
        const params = document.getElementById('paramsPanel');
        if(!params) return;
        const pr = params.getBoundingClientRect();

        p.style.position = 'fixed';
        p.style.display = 'block';

        const pad = 8;
        const pWidth = p.offsetWidth || 160;
        let left = pr.right - pWidth - pad;
        left = Math.max(6, Math.min(window.innerWidth - pWidth - 6, left));

        const top = pr.top + pad;
        p.style.left = left + 'px';
        p.style.top = top + 'px';

        // If no layer is selected, show message and hide controls
        if(!app.activeLayerId) {
            if(nsMessage) nsMessage.style.display = 'block';
            if(fiRow) fiRow.style.display = 'none';
            if(foRow) foRow.style.display = 'none';
            return;
        }

        // Ensure controls are visible
        if(nsMessage) nsMessage.style.display = 'none';
        if(fiRow) fiRow.style.display = '';
        if(foRow) foRow.style.display = '';

        // Bind inputs to the currently selected note (if any)
        const n = app.selectedNote && app.selectedNote.note;
        const fi = document.getElementById('nsFadeIn');
        const fo = document.getElementById('nsFadeOut');
        if(n && fi && fo) {
            fi.value = n.fadeIn !== undefined ? n.fadeIn : 0;
            fo.value = n.fadeOut !== undefined ? n.fadeOut : 0;
            fi.oninput = (e) => { n.fadeIn = parseFloat(e.target.value); app.renderGrid(); };
            fo.oninput = (e) => { n.fadeOut = parseFloat(e.target.value); app.renderGrid(); };

                // Deleting a note is now done via right-click on the note itself
        }
    };
}
