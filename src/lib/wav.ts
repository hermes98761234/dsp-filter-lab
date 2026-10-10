/** Encode channels as a RIFF/WAVE file: 16-bit PCM (clipped, TPDF-free rounding) or 32-bit float. */
export function encodeWav(channels: Float32Array[], sampleRate: number, bits: 16 | 32 = 16): Uint8Array {
  const nch = channels.length
  const len = channels[0]?.length ?? 0
  const bytes = bits / 8
  const dataSize = len * nch * bytes
  const buf = new ArrayBuffer(44 + dataSize)
  const v = new DataView(buf)
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i))
  }
  str(0, 'RIFF')
  v.setUint32(4, 36 + dataSize, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, bits === 32 ? 3 : 1, true)
  v.setUint16(22, nch, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * nch * bytes, true)
  v.setUint16(32, nch * bytes, true)
  v.setUint16(34, bits, true)
  str(36, 'data')
  v.setUint32(40, dataSize, true)
  let o = 44
  for (let i = 0; i < len; i++) {
    for (let ch = 0; ch < nch; ch++) {
      const x = channels[ch]![i]!
      if (bits === 32) v.setFloat32(o, x, true)
      else v.setInt16(o, Math.round(Math.max(-1, Math.min(1, x)) * 32767), true)
      o += bytes
    }
  }
  return new Uint8Array(buf)
}
