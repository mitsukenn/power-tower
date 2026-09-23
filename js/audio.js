'use strict';

// ============================================================
//  サウンド：WebAudio で効果音と BGM をその場で鳴らす（音声ファイル不要）
// ============================================================
const Sound = (() => {
  let ctx = null, master = null, bgmTimer = null, muted = false;

  // ブラウザは最初のタップまで音を出せないので、必要になった時に作る
  function ensure() {
    if (!ctx) {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain();
        master.gain.value = muted ? 0 : 1;
        master.connect(ctx.destination);
      } catch (e) { return null; }
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, ms = 90, type = 'square', vol = 0.05, at = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + ms / 1000);
  }

  // 効果音
  const sfx = {
    jump: () => tone(440, 60, 'triangle'),
    hit: () => { tone(660, 80); tone(880, 120, 'square', 0.05, 0.06); },
    potion: () => tone(780, 120, 'sine', 0.08),
    double: () => [660, 880, 1320].forEach((f, i) => tone(f, 120, 'sine', 0.07, i * 0.07)),
    bomb: () => { tone(120, 300, 'sawtooth', 0.08); tone(80, 400, 'square', 0.05, 0.05); },
    poison: () => [400, 300, 200].forEach((f, i) => tone(f, 140, 'triangle', 0.06, i * 0.08)),
    lose: () => tone(160, 400, 'sawtooth'),
    win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 140, 'square', 0.05, i * 0.11)),
    evolve: () => [523, 784, 1047, 1568].forEach((f, i) => tone(f, 160, 'triangle', 0.07, i * 0.08)),
    click: () => tone(900, 40, 'square', 0.03),
    undo: () => [700, 500].forEach((f, i) => tone(f, 80, 'triangle', 0.05, i * 0.06)),
  };

  // BGM：明るいチップチューン風のループ（ベース＋アルペジオ）
  const BPM = 132, STEP = 60 / BPM / 2;         // 8分音符
  const chords = [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]]; // C Am F G
  const melody = [72, 0, 76, 0, 79, 76, 74, 0, 72, 0, 69, 72, 74, 0, 71, 0];
  const midi = n => 440 * Math.pow(2, (n - 69) / 12);
  let step = 0, nextTime = 0;

  function scheduleBgm() {
    while (nextTime < ctx.currentTime + 0.2) {
      const chord = chords[Math.floor(step / 8) % chords.length];
      const at = nextTime - ctx.currentTime;
      if (step % 2 === 0) tone(midi(chord[0] - 12), STEP * 1900, 'triangle', 0.05, at);   // ベース
      tone(midi(chord[step % 3] + 12), STEP * 700, 'square', 0.012, at);                    // アルペジオ
      const m = melody[step % melody.length];
      if (m && Math.floor(step / 16) % 2 === 1) tone(midi(m), STEP * 1500, 'square', 0.02, at); // 2周に1回メロディ
      nextTime += STEP;
      step++;
    }
  }

  function startBgm() {
    if (bgmTimer || !ensure()) return;
    nextTime = ctx.currentTime + 0.05;
    bgmTimer = setInterval(scheduleBgm, 60);
  }

  function setMuted(m) {
    muted = m;
    if (master) master.gain.value = m ? 0 : 1;
  }

  return { sfx, startBgm, setMuted, isMuted: () => muted };
})();
