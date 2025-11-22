// Visualizer that draws waveform using the app.analyser node
function createVisualizer(app) {
    const cvs = document.getElementById('scope');
    if(!cvs) return;
    const ctx = cvs.getContext('2d');
    const data = new Uint8Array(app.analyser.frequencyBinCount);
    const draw = () => {
        requestAnimationFrame(draw);
        app.analyser.getByteTimeDomainData(data);
        ctx.fillStyle = '#000'; ctx.fillRect(0,0,cvs.width,cvs.height);
        ctx.lineWidth = 2; ctx.strokeStyle = '#d946ef'; ctx.beginPath();
        const slice = cvs.width * 1.0 / data.length;
        let x = 0;
        for(let i=0; i<data.length; i++) {
            const v = data[i]/128.0; const y = v * cvs.height/2;
            if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y); x += slice;
        }
        ctx.lineTo(cvs.width, cvs.height/2); ctx.stroke();
    };
    draw();
}
