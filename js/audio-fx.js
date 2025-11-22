// Audio helper utilities
function createReverbImpulse(ac, duration) {
    const r = ac.sampleRate;
    const len = r * duration;
    const buff = ac.createBuffer(2, len, r);
    for(let i=0; i<len; i++) {
        const dec = Math.pow(1 - i/len, 3);
        buff.getChannelData(0)[i] = (Math.random()*2-1)*dec;
        buff.getChannelData(1)[i] = (Math.random()*2-1)*dec;
    }
    return buff;
}
