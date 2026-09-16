const fs = require('fs');
const path = require('path');

// 44.1kHz mono WAV
const sampleRate = 44100;
const duration = 0.5; // Exactly 0.5 seconds
const numSamples = Math.floor(sampleRate * duration);
const buffer = Buffer.alloc(44 + numSamples * 2);

// RIFF header
buffer.write('RIFF', 0);
buffer.writeUInt32LE(36 + numSamples * 2, 4);
buffer.write('WAVE', 8);
buffer.write('fmt ', 12);
buffer.writeUInt32LE(16, 16);
buffer.writeUInt16LE(1, 20); // PCM
buffer.writeUInt16LE(1, 22); // Mono
buffer.writeUInt32LE(sampleRate, 24);
buffer.writeUInt32LE(sampleRate * 2, 28);
buffer.writeUInt16LE(2, 32);
buffer.writeUInt16LE(16, 34);
buffer.write('data', 36);
buffer.writeUInt32LE(numSamples * 2, 40);

// Two crisp ring pulses:
// Pulse 1: 0 to 0.20s
// Silence: 0.20 to 0.25s
// Pulse 2: 0.25 to 0.50s
for (let i = 0; i < numSamples; i++) {
  const t = i / sampleRate;
  let sample = 0;

  if (t < 0.20) {
    // Pulse 1: 853 Hz + 960 Hz (urgent dual phone ring)
    const env = Math.min(t / 0.015, 1) * Math.min((0.20 - t) / 0.025, 1);
    const wave = 0.55 * Math.sin(2 * Math.PI * 853 * t) + 0.45 * Math.sin(2 * Math.PI * 960 * t);
    sample = wave * env;
  } else if (t >= 0.25 && t <= 0.50) {
    // Pulse 2: slightly higher 960 Hz + 1175 Hz for strong attention-grabbing ring
    const tRel = t - 0.25;
    const env = Math.min(tRel / 0.015, 1) * Math.min((0.50 - t) / 0.035, 1);
    const wave = 0.55 * Math.sin(2 * Math.PI * 960 * t) + 0.45 * Math.sin(2 * Math.PI * 1175 * t);
    sample = wave * env;
  }

  const intSample = Math.max(-32768, Math.min(32767, Math.floor(sample * 31000)));
  buffer.writeInt16LE(intSample, 44 + i * 2);
}

const soundsDir = path.join(__dirname, '..', 'public', 'sounds');
if (!fs.existsSync(soundsDir)) {
  fs.mkdirSync(soundsDir, { recursive: true });
}
const outPath = path.join(soundsDir, 'mic-alert.wav');
fs.writeFileSync(outPath, buffer);
console.log('WAV successfully generated at:', outPath, 'Bytes:', buffer.length);
