class PCMCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.samples = []; this.offset = 0; this.frame = new Int16Array(4000); this.used = 0;
    this.port.onmessage = (event) => { if (event.data === 'flush') { this.flush(); this.port.postMessage({type:'flushed'}); } };
  }
  flush() { if (this.used) { const frame = this.frame.slice(0, this.used); this.port.postMessage(frame, [frame.buffer]); this.used = 0; } }
  process(inputs) {
    const input = inputs[0]; if (!input || !input.length) return true;
    const length = input[0].length;
    for (let i = 0; i < length; i++) { let value = 0; for (const channel of input) value += channel[i] || 0; this.samples.push(value / input.length); }
    const ratio = sampleRate / 16000;
    while (this.offset + 1 < this.samples.length) {
      const i = Math.floor(this.offset), fraction = this.offset - i;
      const value = Math.max(-1, Math.min(1, this.samples[i] * (1 - fraction) + this.samples[i + 1] * fraction));
      this.frame[this.used++] = Math.round(value * (value < 0 ? 32768 : 32767)); this.offset += ratio;
      if (this.used === this.frame.length) this.flush();
    }
    const consumed = Math.min(Math.floor(this.offset), this.samples.length - 1); this.samples.splice(0, consumed); this.offset -= consumed;
    return true;
  }
}
registerProcessor('pcm-capture', PCMCapture);
