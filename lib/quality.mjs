// A slow outer loop complements WebRTC's congestion controller; it never sets a
// minimum bitrate or lies about the effective resolution. Hysteresis avoids flapping.
export class AdaptiveQuality {
  constructor({ fps = 30, bitrate = 12 } = {}) {
    this.fps = fps; this.bitrate = bitrate; this.level = 0; this.bad = 0; this.good = 0;
    this.scales = [1, 1.5, 2, 3];
  }
  get scale() { return this.scales[this.level]; }
  sample(stats) {
    if (stats.fps == null || stats.mbps == null) return null;
    const slow = stats.fps < this.fps * 0.72;
    const sparse = stats.width && stats.height && stats.mbps * 1e6 / (stats.width * stats.height * Math.max(1, stats.fps)) < 0.045;
    const limited = stats.quality === 'cpu' || slow || stats.lossPercent > 5 || (stats.quality === 'bandwidth' && sparse);
    this.bad = limited ? this.bad + 1 : 0;
    this.good = !limited && stats.fps >= this.fps * 0.9 && (!stats.quality || stats.quality === 'none') && !(stats.lossPercent > 1) ? this.good + 1 : 0;
    if (this.bad >= 3 && this.level < this.scales.length - 1) {
      this.level++; this.bad = this.good = 0;
      return { scale: this.scale, reason: 'Ajuste automático: reduzindo a resolução de envio para preservar a fluidez.' };
    }
    const headroom = stats.availableMbps == null || stats.availableMbps > stats.mbps * 1.6;
    if (this.good >= 20 && this.level > 0 && headroom) {
      this.level--; this.bad = this.good = 0;
      return { scale: this.scale, reason: 'Conexão estável: recuperando gradualmente o detalhe da imagem.' };
    }
    return null;
  }
}
