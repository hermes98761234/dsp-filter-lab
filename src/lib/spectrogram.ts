import { fft } from './fft.ts'

export interface Spectrogram {
  /** Time columns x frequency bins, magnitudes in dB (power, re full scale), row-major by column. */
  data: Float32Array
  cols: number
  bins: number
  /** Duration covered, seconds. */
  duration: number
  fs: number
}

/** Short-time Fourier transform magnitude (Hann window), at most `maxCols` columns. */
export function spectrogram(x: ArrayLike<number>, fs: number, fftSize = 1024, maxCols = 700): Spectrogram {
  const bins = fftSize / 2 + 1
  const hopMin = fftSize / 4
  const hop = Math.max(hopMin, Math.floor((x.length - fftSize) / maxCols))
  const cols = Math.max(1, Math.min(maxCols, Math.floor((x.length - fftSize) / hop) + 1))
  const win = new Float64Array(fftSize)
  let wsum = 0
  for (let i = 0; i < fftSize; i++) {
    win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / fftSize)
    wsum += win[i]!
  }
  const data = new Float32Array(cols * bins)
  const re = new Float64Array(fftSize)
  const im = new Float64Array(fftSize)
  for (let c = 0; c < cols; c++) {
    const start = c * hop
    for (let i = 0; i < fftSize; i++) {
      re[i] = (x[start + i] ?? 0) * win[i]!
      im[i] = 0
    }
    fft(re, im)
    for (let k = 0; k < bins; k++) {
      const m = (2 * Math.hypot(re[k]!, im[k]!)) / wsum
      data[c * bins + k] = 20 * Math.log10(Math.max(m, 1e-9))
    }
  }
  return { data, cols, bins, duration: x.length / fs, fs }
}

/** Demo signal: logarithmic chirp plus two steady tones and a little noise, so filters have something to show. */
export function demoSignal(fs: number, seconds = 6): Float32Array {
  const n = Math.floor(fs * seconds)
  const out = new Float32Array(n)
  const f0 = 80
  const f1 = fs * 0.45
  const k = Math.log(f1 / f0) / seconds
  let seed = 12345
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 2 ** 32 - 0.5
  }
  for (let i = 0; i < n; i++) {
    const t = i / fs
    const chirp = Math.sin((2 * Math.PI * f0 * (Math.exp(k * t) - 1)) / k)
    out[i] = 0.45 * chirp + 0.15 * Math.sin(2 * Math.PI * 440 * t) + 0.1 * Math.sin(2 * Math.PI * 3000 * t) + 0.02 * rnd()
  }
  return out
}
