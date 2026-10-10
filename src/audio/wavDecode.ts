/** Decode PCM WAV (16/24/32-bit int or 32-bit float) to interleaved Float32 mono/stereo. */
export function decodeWavPcm(bytes: Uint8Array): {
  sampleRate: number;
  channels: number;
  frames: Float32Array[];
} {
  if (bytes.byteLength < 44) throw new Error("WAV 过短");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readAscii(view, 0, 4) !== "RIFF" || readAscii(view, 8, 4) !== "WAVE") {
    throw new Error("不是 WAV");
  }

  let offset = 12;
  let audioFormat = 1;
  let channels = 1;
  let sampleRate = 44100;
  let bitsPerSample = 16;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= view.byteLength) {
    const id = readAscii(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt " && size >= 16) {
      audioFormat = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (id === "data") {
      dataOffset = body;
      dataSize = size;
      break;
    }
    offset = body + size + (size % 2);
  }

  if (dataOffset < 0) throw new Error("WAV 缺少 data 块");
  if (audioFormat !== 1 && audioFormat !== 3) {
    throw new Error(`不支持的 WAV 格式 ${audioFormat}`);
  }

  const frameCount = Math.floor(dataSize / (channels * (bitsPerSample / 8)));
  const frames: Float32Array[] = Array.from({ length: channels }, () => new Float32Array(frameCount));
  let cursor = dataOffset;

  for (let i = 0; i < frameCount; i += 1) {
    for (let ch = 0; ch < channels; ch += 1) {
      let sample = 0;
      if (audioFormat === 3 && bitsPerSample === 32) {
        sample = view.getFloat32(cursor, true);
        cursor += 4;
      } else if (bitsPerSample === 16) {
        sample = view.getInt16(cursor, true) / 32768;
        cursor += 2;
      } else if (bitsPerSample === 24) {
        const b0 = view.getUint8(cursor);
        const b1 = view.getUint8(cursor + 1);
        const b2 = view.getUint8(cursor + 2);
        cursor += 3;
        let v = (b2 << 16) | (b1 << 8) | b0;
        if (v & 0x800000) v |= ~0xffffff;
        sample = v / 8388608;
      } else if (bitsPerSample === 32 && audioFormat === 1) {
        sample = view.getInt32(cursor, true) / 2147483648;
        cursor += 4;
      } else {
        throw new Error(`不支持的位深 ${bitsPerSample}`);
      }
      frames[ch][i] = sample;
    }
  }

  return { sampleRate, channels, frames };
}

function readAscii(view: DataView, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(view.getUint8(offset + i));
  return out;
}

export function resampleToStereo(
  frames: Float32Array[],
  sourceRate: number,
  targetRate: number,
): { left: Float32Array; right: Float32Array } {
  const srcLen = frames[0]?.length ?? 0;
  if (srcLen === 0) return { left: new Float32Array(0), right: new Float32Array(0) };
  const ratio = sourceRate / targetRate;
  const outLen = Math.max(1, Math.round(srcLen / ratio));
  const left = new Float32Array(outLen);
  const right = new Float32Array(outLen);
  const leftSrc = frames[0];
  const rightSrc = frames[1] ?? frames[0];
  for (let i = 0; i < outLen; i += 1) {
    const srcPos = i * ratio;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(srcLen - 1, i0 + 1);
    const t = srcPos - i0;
    left[i] = leftSrc[i0] * (1 - t) + leftSrc[i1] * t;
    right[i] = rightSrc[i0] * (1 - t) + rightSrc[i1] * t;
  }
  return { left, right };
}
