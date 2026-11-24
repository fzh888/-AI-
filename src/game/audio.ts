import type { SfxName } from './types';

type Ctor = typeof AudioContext;

/**
 * 每次播放给一点点随机偏移：同一个音效连着响（连锁破块、连环撞击）时不至于像复读机。
 * 只用 ±3%~6%，听感上仍然是同一个音色，不会跑调。
 */
function vary(base: number, spread = 0.06): number {
  return base * (1 + (Math.random() - 0.5) * spread);
}

/**
 * 纯 Web Audio 合成音效，无需任何音频素材文件。
 * BGM 挂载位已预留：调用 setBgm(url) 即可接入背景音乐（默认为空、不出声）。
 */
export class SoundKit {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;
  private bgm: HTMLAudioElement | null = null;

  constructor(muted = false) {
    this.muted = muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.ctx.currentTime, 0.01);
    }
    if (this.bgm) this.bgm.muted = muted;
  }

  /** 预留：后续提供 BGM 文件后，传入 URL 即可播放 */
  setBgm(url: string | null): void {
    if (typeof window === 'undefined') return;
    if (this.bgm) {
      this.bgm.pause();
      this.bgm = null;
    }
    if (!url) return;
    const audio = new Audio(url);
    audio.loop = true;
    audio.volume = 0.35;
    audio.muted = this.muted;
    void audio.play().catch(() => undefined);
    this.bgm = audio;
  }

  unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AC: Ctor | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  play(name: SfxName, power = 1): void {
    if (this.muted) return;
    this.unlock();
    const ctx = this.ctx;
    if (!ctx) return;
    switch (name) {
      case 'pull':
        this.noise(0.06, 'highpass', 900, 0.05 + power * 0.03);
        break;
      case 'launch': {
        // 力度越大：起音更高、气声更足、尾音更长，轻拉与满拉一听就能分辨
        const k = Math.max(0, Math.min(1, power));
        this.tone(500 + k * 240, 0.18 + k * 0.08, 'sawtooth', 0.1 + k * 0.11, 110 + k * 60);
        this.noise(0.1 + k * 0.12, 'bandpass', 900 + k * 900, 0.04 + k * 0.07);
        break;
      }
      case 'bonk':
        this.tone(240, 0.1, 'square', 0.16, 130);
        this.noise(0.08, 'bandpass', 700, 0.08);
        break;
      case 'wood':
        this.noise(0.18, 'bandpass', vary(1300), vary(0.18, 0.16));
        this.tone(vary(320, 0.08), 0.08, 'triangle', 0.06, vary(180, 0.08));
        break;
      case 'stone':
        this.noise(0.24, 'lowpass', vary(520, 0.1), vary(0.2, 0.16));
        this.tone(vary(110, 0.08), 0.16, 'sine', 0.14, vary(60, 0.08));
        break;
      case 'glass':
        // 冰玻璃：脆、亮，一串高频碎片声
        this.noise(0.22, 'highpass', vary(2600, 0.12), vary(0.2, 0.16));
        this.tone(vary(1680, 0.07), 0.1, 'triangle', 0.1, vary(2400, 0.07));
        window.setTimeout(() => this.tone(vary(2200, 0.07), 0.08, 'triangle', 0.07, vary(3000, 0.07)), 70);
        break;
      case 'metal':
        // 铁皮：金属敲击 + 长一点的低频余震
        this.tone(vary(520, 0.05), 0.14, 'square', 0.1, vary(380, 0.05));
        this.noise(0.2, 'bandpass', vary(3200, 0.1), vary(0.14, 0.16));
        this.tone(vary(96, 0.06), 0.22, 'sine', 0.12, vary(62, 0.06));
        break;
      case 'hitWood':
        // 撞木头：闷闷的一记"咚"，带一点木腔共鸣
        this.noise(0.07, 'bandpass', vary(1100 + power * 700, 0.1), vary(0.05 + power * 0.1, 0.16));
        this.tone(vary(230 + power * 90, 0.08), 0.06, 'triangle', vary(0.05 + power * 0.06, 0.16), vary(150, 0.08));
        break;
      case 'hitStone':
        // 撞石头：更低沉、更干，几乎没有余韵
        this.noise(0.08, 'lowpass', vary(460 + power * 260, 0.1), vary(0.06 + power * 0.11, 0.16));
        this.tone(vary(96 + power * 40, 0.08), 0.09, 'sine', vary(0.06 + power * 0.06, 0.16), vary(58, 0.08));
        break;
      case 'hitGlass':
        // 撞玻璃：脆响，但比"碎掉"短得多
        this.noise(0.06, 'highpass', vary(2800, 0.12), vary(0.05 + power * 0.09, 0.16));
        this.tone(vary(1900, 0.07), 0.05, 'triangle', vary(0.04 + power * 0.05, 0.16), vary(2400, 0.07));
        break;
      case 'hitMetal':
        // 撞铁皮：金属"当"的一声
        this.tone(vary(430 + power * 180, 0.06), 0.1, 'square', vary(0.04 + power * 0.06, 0.16), vary(320, 0.06));
        this.noise(0.08, 'bandpass', vary(2600, 0.1), vary(0.04 + power * 0.08, 0.16));
        break;
      case 'collapse': {
        // 建筑倒塌：一串参差的碎响 + 一层低频闷雷，越长越像"整栋塌了"
        const heavy = 0.35 + power * 0.45;
        this.noise(heavy, 'lowpass', 320, 0.24);
        this.tone(72, heavy, 'sine', 0.2, 38);
        for (let i = 0; i < 4; i += 1) {
          const at = 60 + i * 90 + Math.random() * 60;
          window.setTimeout(() => {
            this.noise(0.13, 'bandpass', 700 + Math.random() * 900, 0.1);
            if (i % 2 === 0) this.tone(150 + Math.random() * 90, 0.08, 'triangle', 0.06, 90);
          }, at);
        }
        break;
      }
      case 'chain': {
        // 连锁上台阶：一路往上爬的金色小叮
        const k = Math.max(0, Math.min(1, power));
        this.tone(700 + k * 500, 0.1, 'triangle', 0.1, 1100 + k * 700);
        window.setTimeout(() => this.tone(1040 + k * 620, 0.12, 'triangle', 0.08), 70);
        break;
      }
      case 'star':
        this.tone(1046, 0.1, 'triangle', 0.12, 1568);
        break;
      case 'booster':
        this.tone(320, 0.18, 'triangle', 0.14, 880);
        break;
      case 'boom':
        // 低频冲击 → 主体 → 闷响的长尾（三层错开，"轰"才有厚度）
        this.noise(0.12, 'highpass', vary(1400, 0.12), 0.14);
        this.noise(0.35, 'lowpass', vary(800, 0.1), 0.26);
        this.tone(vary(180, 0.06), 0.32, 'sine', 0.2, vary(45, 0.06));
        this.tone(vary(64, 0.08), 0.5, 'sine', 0.14, 32);
        break;
      case 'win':
        this.tone(523, 0.12, 'triangle', 0.14);
        window.setTimeout(() => this.tone(659, 0.12, 'triangle', 0.14), 110);
        window.setTimeout(() => this.tone(784, 0.12, 'triangle', 0.14), 220);
        window.setTimeout(() => this.tone(1046, 0.22, 'triangle', 0.16), 330);
        break;
      case 'lose':
        this.tone(392, 0.16, 'sine', 0.14);
        window.setTimeout(() => this.tone(294, 0.16, 'sine', 0.14), 150);
        window.setTimeout(() => this.tone(196, 0.3, 'sine', 0.16), 300);
        break;
      case 'click':
        this.tone(720, 0.05, 'square', 0.1);
        break;
      case 'fuse':
        // 引信：短促的"咝" + 一点点高频抖动，提示"要炸了"
        this.noise(0.12, 'highpass', 3200, 0.1 + power * 0.06);
        this.tone(1400, 0.06, 'triangle', 0.05, 2100);
        break;
      case 'spring': {
        // 弹簧板：低沉的"嘣"，带一点上扬的金属余韵，撞得越狠越亮
        const k = Math.max(0, Math.min(1, power));
        this.tone(180 + k * 90, 0.22 + k * 0.06, 'triangle', 0.2 + k * 0.08, 520 + k * 260);
        this.tone(760 + k * 240, 0.12, 'sine', 0.08, 320);
        this.noise(0.1, 'bandpass', 1600 + k * 900, 0.05 + k * 0.04);
        break;
      }
      case 'oink':
        this.tone(300, 0.07, 'square', 0.12, 240);
        window.setTimeout(() => this.tone(260, 0.07, 'square', 0.1, 200), 90);
        break;
      default:
        break;
    }
  }

  private tone(
    from: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    to?: number,
  ): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, now);
    if (to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), now + dur);
    env.gain.setValueAtTime(gain, now);
    env.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(env);
    env.connect(master);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  private noise(
    dur: number,
    filterType: BiquadFilterType,
    freq: number,
    gain: number,
  ): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    const length = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, Math.max(1, length), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, now);
    env.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(filter);
    filter.connect(env);
    env.connect(master);
    src.start(now);
    src.stop(now + dur);
  }
}
