// Zero-asset audio: synthesizes SFX, continuous engine/laser loops and a
// sequenced soundtrack via Web Audio. Swap to sample playback later by
// replacing the play*() bodies — call sites in the scenes don't change.
//
// Signal flow:
//   voices ─┬─> sfxGain ───┐
//           └─> reverbIn   ├─> master ─> compressor ─> destination
//   music ──┬─> musicGain ─┤
//           └─> reverbIn   │
//   reverbIn ─> convolver ─┘
//
// Browser autoplay rules: the AudioContext must be resumed from a user
// gesture. The Title scene's Launch button calls Audio.unlock() on click.

const MASTER_LEVEL = 0.9;
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

// A-minor pentatonic ladder (semitones above E5) for the pickup chime —
// each chained pickup climbs one rung so streaks sound like a run.
const PICKUP_LADDER = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24, 27];

// ---------- soundtrack data ----------
// 92 bpm, 16 steps per bar, two 4-bar sections (A then B) looping.
const BPM = 92;
const SECTION_A = [
  { chord: [57, 60, 64], bass: 45 }, // Am
  { chord: [53, 57, 60], bass: 41 }, // F
  { chord: [55, 60, 64], bass: 48 }, // C
  { chord: [55, 59, 62], bass: 43 }, // G
];
const SECTION_B = [
  { chord: [53, 57, 60], bass: 41 }, // F
  { chord: [55, 59, 62], bass: 43 }, // G
  { chord: [55, 59, 64], bass: 40 }, // Em
  { chord: [57, 60, 64], bass: 45 }, // Am
];
const PROGRESSION = [...SECTION_A, ...SECTION_B];
// index into [root, 3rd, 5th, root+12] per 16th step
const ARP_PATTERN = [0, 1, 2, 3, 2, 1, 0, 1, 0, 2, 3, 2, 1, 2, 3, 1];
const BASS_STEPS = { 0: 0, 6: 0, 8: 12, 11: 0, 14: 7 };
// melody phrases: [step, midi, lengthInSteps]; one per bar of the 8-bar loop,
// null bars rest so the lead breathes
const LEAD_PHRASES = [
  null,
  [[0, 76, 4], [4, 74, 2], [6, 72, 2], [8, 69, 6]],
  [[2, 72, 2], [4, 76, 2], [6, 79, 4], [12, 76, 4]],
  [[0, 74, 3], [4, 71, 2], [8, 67, 4], [12, 69, 4]],
  null,
  [[0, 72, 2], [2, 74, 2], [4, 76, 6], [12, 79, 4]],
  [[0, 81, 4], [6, 79, 2], [8, 76, 4], [12, 74, 4]],
  [[0, 76, 6], [8, 72, 2], [10, 71, 2], [12, 69, 4]],
];

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.reverbIn = null;
    this.musicNodes = null;
    this.loops = null;
    this.unlocked = false;
    this.muted = false;
    this.musicIntensity = 0.5;
    this._noiseBuf = null;
    this._pickupStreak = 0;
    this._lastPickupAt = -1;
    this._loadPrefs();
  }

  _loadPrefs() {
    try {
      const m = localStorage.getItem('oredrift.muted');
      this.muted = m === '1';
    } catch {}
  }

  _savePrefs() {
    try { localStorage.setItem('oredrift.muted', this.muted ? '1' : '0'); } catch {}
  }

  // Adopt Phaser's shared AudioContext so Phaser keeps owning unlock &
  // pause-on-blur behavior. Falls back to a private context for tests.
  attachToPhaser(scene) {
    if (this.ctx) return this.ctx;
    const mgr = scene.sound;
    if (mgr && mgr.context) {
      this._initFromContext(mgr.context);
      return this.ctx;
    }
    return this._ensureCtx();
  }

  _initFromContext(ctx) {
    this.ctx = ctx;

    // gentle bus compressor glues layers together and keeps stacked
    // explosions from clipping
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    comp.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER_LEVEL;
    this.master.connect(comp);

    // shared "space" reverb — generated impulse, so still zero assets
    const convolver = ctx.createConvolver();
    convolver.buffer = this._makeImpulse(2.8, 3.2);
    this.reverbIn = ctx.createGain();
    this.reverbIn.gain.value = 1;
    const reverbOut = ctx.createGain();
    reverbOut.gain.value = 0.8;
    this.reverbIn.connect(convolver).connect(reverbOut).connect(this.master);

    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.3;
    this.musicGain.connect(this.master);
    const musicSend = ctx.createGain();
    musicSend.gain.value = 0.35;
    this.musicGain.connect(musicSend).connect(this.reverbIn);

    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.value = 0.55;
    this.sfxGain.connect(this.master);
  }

  _ensureCtx() {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    this._initFromContext(new Ctx());
    return this.ctx;
  }

  _makeImpulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  // one shared 2s white-noise buffer; sources start at random offsets
  _noise() {
    if (!this._noiseBuf) {
      const len = this.ctx.sampleRate * 2;
      this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this._noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    return src;
  }

  unlock() {
    const ctx = this._ensureCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    this.unlocked = true;
  }

  setMuted(muted) {
    this.muted = !!muted;
    this._savePrefs();
    if (this.master) {
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(this.master.gain.value, now);
      this.master.gain.linearRampToValueAtTime(this.muted ? 0 : MASTER_LEVEL, now + 0.15);
    }
  }

  toggleMute() { this.setMuted(!this.muted); return this.muted; }

  // ---------- routing helpers ----------

  // Connect a voice's last node to the SFX bus (optionally panned) and
  // send a little of it to the reverb. Returns nothing; node lifetime is
  // governed by the source's stop() time.
  _route(node, { verb = 0.15, pan = 0, dest = null } = {}) {
    const ctx = this.ctx;
    let out = node;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      out.connect(p);
      out = p;
    }
    out.connect(dest || this.sfxGain);
    if (verb > 0) {
      const s = ctx.createGain();
      s.gain.value = verb;
      out.connect(s).connect(this.reverbIn);
    }
  }

  _env(param, t0, peak, attack, dur) {
    param.setValueAtTime(0.0001, t0);
    param.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + attack);
    param.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }

  _tone({ freq = 440, freqEnd = null, dur = 0.15, type = 'sine', peak = 0.3, attack = 0.005,
    filter = null, when = 0, detune = 0, verb = 0.15, pan = 0, dest = null }) {
    const ctx = this._ensureCtx();
    if (!ctx) return;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.detune.value = detune;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), t0 + dur);
    this._env(g.gain, t0, peak, attack, dur);
    let last = osc;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter.type || 'lowpass';
      f.frequency.setValueAtTime(filter.freq || 2000, t0);
      if (filter.freqEnd) f.frequency.exponentialRampToValueAtTime(filter.freqEnd, t0 + dur);
      f.Q.value = filter.Q ?? 1;
      last.connect(f);
      last = f;
    }
    last.connect(g);
    this._route(g, { verb, pan, dest });
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  _noiseHit({ dur = 0.2, peak = 0.3, attack = 0.005, type = 'bandpass', freq = 1200, freqEnd = null,
    Q = 1, when = 0, verb = 0.15, pan = 0, dest = null }) {
    const ctx = this._ensureCtx();
    if (!ctx) return;
    const t0 = ctx.currentTime + when;
    const src = this._noise();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    f.Q.value = Q;
    const g = ctx.createGain();
    this._env(g.gain, t0, peak, attack, dur);
    src.connect(f).connect(g);
    this._route(g, { verb, pan, dest });
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + dur + 0.05);
  }

  // ---------- continuous loops (engine + mining laser) ----------

  _ensureLoops() {
    if (this.loops || !this._ensureCtx()) return this.loops;
    const ctx = this.ctx;

    // engine: filtered noise "air" + low sine rumble
    const engNoise = this._noise();
    const engFilter = ctx.createBiquadFilter();
    engFilter.type = 'lowpass';
    engFilter.frequency.value = 380;
    engFilter.Q.value = 0.8;
    const engGain = ctx.createGain();
    engGain.gain.value = 0;
    engNoise.connect(engFilter).connect(engGain).connect(this.sfxGain);
    const rumble = ctx.createOscillator();
    rumble.type = 'sine';
    rumble.frequency.value = 52;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0;
    rumble.connect(rumbleGain).connect(this.sfxGain);
    engNoise.start();
    rumble.start();

    // laser: two detuned saws through a wobbling bandpass — a warbling
    // cutting-beam buzz rather than a static tone
    const lzA = ctx.createOscillator();
    const lzB = ctx.createOscillator();
    lzA.type = 'sawtooth';
    lzB.type = 'sawtooth';
    lzA.frequency.value = 196;
    lzB.frequency.value = 196;
    lzB.detune.value = 14;
    const lzFilter = ctx.createBiquadFilter();
    lzFilter.type = 'bandpass';
    lzFilter.frequency.value = 1500;
    lzFilter.Q.value = 3;
    const lzLfo = ctx.createOscillator();
    lzLfo.frequency.value = 9;
    const lzLfoGain = ctx.createGain();
    lzLfoGain.gain.value = 500;
    lzLfo.connect(lzLfoGain).connect(lzFilter.frequency);
    const lzGain = ctx.createGain();
    lzGain.gain.value = 0;
    lzA.connect(lzFilter);
    lzB.connect(lzFilter);
    lzFilter.connect(lzGain);
    this._route(lzGain, { verb: 0.1 });
    lzA.start();
    lzB.start();
    lzLfo.start();

    this.loops = { engFilter, engGain, rumble, rumbleGain, lzA, lzB, lzFilter, lzGain };
    return this.loops;
  }

  // Called every frame by GameScene; only state changes schedule ramps.
  setEngine(active, boosting = false) {
    const state = active ? (boosting ? 2 : 1) : 0;
    if (state === this._engineState) return;
    this._engineState = state;
    const l = this._ensureLoops();
    if (!l) return;
    const now = this.ctx.currentTime;
    const on = active ? 1 : 0;
    l.engGain.gain.setTargetAtTime(on * (boosting ? 0.16 : 0.045), now, 0.12);
    l.engFilter.frequency.setTargetAtTime(boosting ? 1500 : 380, now, 0.15);
    l.rumbleGain.gain.setTargetAtTime(on * (boosting ? 0.09 : 0.04), now, 0.12);
    l.rumble.frequency.setTargetAtTime(boosting ? 74 : 52, now, 0.2);
  }

  setLaser(active) {
    active = !!active;
    if (active === this._laserWasActive) return;
    const l = this._ensureLoops();
    if (!l) return;
    const now = this.ctx.currentTime;
    l.lzGain.gain.setTargetAtTime(active ? 0.05 : 0, now, active ? 0.02 : 0.06);
    if (active && !this._laserWasActive) {
      // small pitch drop on lock-on so each new target "clicks in"
      l.lzA.frequency.setValueAtTime(260, now);
      l.lzB.frequency.setValueAtTime(260, now);
      l.lzA.frequency.setTargetAtTime(196, now, 0.05);
      l.lzB.frequency.setTargetAtTime(196, now, 0.05);
    }
    this._laserWasActive = active;
  }

  stopLoops() {
    if (!this.loops) return;
    this.setEngine(false);
    this.setLaser(false);
  }

  // ---------- music ----------

  setMusicIntensity(v) { this.musicIntensity = Math.max(0, Math.min(1, v)); }

  startMusic() {
    const ctx = this._ensureCtx();
    if (!ctx || this.musicNodes) return;

    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0, ctx.currentTime);
    bus.gain.linearRampToValueAtTime(1, ctx.currentTime + 1.5);
    bus.connect(this.musicGain);

    // pad filter with a slow sweep keeps sustained chords moving
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 1100;
    padFilter.Q.value = 0.6;
    padFilter.connect(bus);
    const padLfo = ctx.createOscillator();
    padLfo.frequency.value = 0.06;
    const padLfoGain = ctx.createGain();
    padLfoGain.gain.value = 500;
    padLfo.connect(padLfoGain).connect(padFilter.frequency);
    padLfo.start();

    // dotted-eighth feedback delay for arp + lead
    const s16 = 60 / BPM / 4;
    const echoBus = ctx.createGain();
    echoBus.connect(bus);
    const delay = ctx.createDelay(2);
    delay.delayTime.value = s16 * 3;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.38;
    const fbFilter = ctx.createBiquadFilter();
    fbFilter.type = 'lowpass';
    fbFilter.frequency.value = 2400;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    echoBus.connect(delay);
    delay.connect(fbFilter).connect(feedback).connect(delay);
    delay.connect(wet).connect(bus);

    const drumBus = ctx.createGain();
    drumBus.gain.value = 0.9;
    drumBus.connect(bus);

    const nodes = { bus, padFilter, padLfo, echoBus, delay, feedback, fbFilter, wet, drumBus };
    let step = 0;
    let bar = 0;
    let nextTime = ctx.currentTime + 0.12;

    const scheduleStep = (t) => {
      const slot = PROGRESSION[bar % PROGRESSION.length];
      const loopBar = bar % PROGRESSION.length;
      const intensity = this.musicIntensity;
      const barDur = s16 * 16;

      if (step === 0) this._musicPad(slot.chord, t, barDur, padFilter);

      const bassOff = BASS_STEPS[step];
      if (bassOff !== undefined) {
        const len = step === 0 ? s16 * 5 : s16 * 2;
        this._musicBass(midi(slot.bass + bassOff), t, len, bus);
      }

      // arp: 8ths normally, 16ths when the action heats up
      const arpEvery = intensity > 0.75 ? 1 : 2;
      if (step % arpEvery === 0) {
        const tones = [...slot.chord, slot.chord[0] + 12];
        const n = tones[ARP_PATTERN[step]] + 12;
        const accent = step % 4 === 0 ? 1 : 0.7;
        this._musicArp(midi(n), t, s16 * 1.6, echoBus, accent);
      }

      // lead melody sits out the very first loop so the track builds
      if (bar >= PROGRESSION.length) {
        const phrase = LEAD_PHRASES[loopBar];
        if (phrase) {
          for (const [st, note, len] of phrase) {
            if (st === step) this._musicLead(midi(note), t, len * s16, echoBus);
          }
        }
      }

      // drums enter after 4 bars; denser with intensity
      if (bar >= 4) {
        if (step === 0 || step === 8 || (intensity > 0.75 && step === 10)) this._musicKick(t, drumBus);
        if (intensity >= 0.5 && (step === 4 || step === 12)) this._musicSnare(t, drumBus);
        const hatOn = intensity > 0.75 ? step % 2 === 0 : step % 4 === 2;
        if (hatOn) this._musicHat(t, drumBus, step % 4 === 2 ? 1 : 0.6);
      }
    };

    nodes.timer = setInterval(() => {
      const now = ctx.currentTime;
      // after a stall (background tab) jump ahead instead of firing a burst
      if (nextTime < now - 0.05) nextTime = now + 0.05;
      while (nextTime < now + 0.2) {
        scheduleStep(nextTime);
        nextTime += s16;
        step++;
        if (step >= 16) { step = 0; bar++; }
      }
    }, 30);

    this.musicNodes = nodes;
  }

  stopMusic() {
    if (!this.musicNodes) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const m = this.musicNodes;
    clearInterval(m.timer);
    m.bus.gain.cancelScheduledValues(now);
    m.bus.gain.setValueAtTime(m.bus.gain.value, now);
    m.bus.gain.linearRampToValueAtTime(0, now + 0.8);
    m.padLfo.stop(now + 0.9);
    setTimeout(() => {
      for (const k of ['bus', 'padFilter', 'echoBus', 'delay', 'feedback', 'fbFilter', 'wet', 'drumBus']) {
        try { m[k].disconnect(); } catch {}
      }
    }, 1000);
    this.musicNodes = null;
  }

  _musicPad(chord, t, barDur, dest) {
    // each chord gets fresh detuned-saw voices with slow attack/release
    // that overlap the next chord, so changes swell instead of cut
    const ctx = this.ctx;
    const end = t + barDur;
    for (const n of chord) {
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sawtooth';
        o.frequency.value = midi(n);
        o.detune.value = det;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.022, t + 1.1);
        g.gain.setValueAtTime(0.022, end);
        g.gain.exponentialRampToValueAtTime(0.0001, end + 1.4);
        o.connect(g).connect(dest);
        o.start(t);
        o.stop(end + 1.5);
      }
    }
  }

  _musicBass(freq, t, len, dest) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = 'sine';
    o2.type = 'triangle';
    o.frequency.value = freq;
    o2.frequency.value = freq;
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(220, t + len);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(f);
    o2.connect(f);
    f.connect(g).connect(dest);
    o.start(t); o2.start(t);
    o.stop(t + len + 0.05); o2.stop(t + len + 0.05);
  }

  _musicArp(freq, t, len, dest, accent = 1) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = freq;
    f.type = 'lowpass';
    f.Q.value = 4;
    f.frequency.setValueAtTime(2600 * accent, t);
    f.frequency.exponentialRampToValueAtTime(500, t + len);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.032 * accent, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(f).connect(g).connect(dest);
    o.start(t);
    o.stop(t + len + 0.05);
  }

  _musicLead(freq, t, len, dest) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const vib = ctx.createOscillator();
    const vibGain = ctx.createGain();
    const g = ctx.createGain();
    o.type = 'triangle';
    o2.type = 'sine';
    o.frequency.value = freq;
    o2.frequency.value = freq * 2;
    vib.frequency.value = 5.2;
    vibGain.gain.value = 7; // cents
    vib.connect(vibGain);
    vibGain.connect(o.detune);
    vibGain.connect(o2.detune);
    const o2g = ctx.createGain();
    o2g.gain.value = 0.25;
    const hold = Math.max(len, 0.25);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.04);
    g.gain.setValueAtTime(0.07, t + hold * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + hold + 0.35);
    o.connect(g);
    o2.connect(o2g).connect(g);
    g.connect(dest);
    for (const n of [o, o2, vib]) { n.start(t); n.stop(t + hold + 0.4); }
  }

  _musicKick(t, dest) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.42, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + 0.35);
  }

  _musicSnare(t, dest) {
    const ctx = this.ctx;
    const src = this._noise();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1900;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.11, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + 0.2);
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.07, t + 0.003);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(og).connect(dest);
    o.start(t);
    o.stop(t + 0.12);
  }

  _musicHat(t, dest, level = 1) {
    const ctx = this.ctx;
    const src = this._noise();
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05 * level, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + 0.06);
  }

  // ---------- SFX API ----------
  // Positional calls accept { pan, vol } computed by the scene from the
  // source's offset to the player.

  playUiClick() {
    this._tone({ freq: 1250, freqEnd: 900, dur: 0.06, type: 'sine', peak: 0.16, verb: 0.08 });
    this._tone({ freq: 2500, dur: 0.025, type: 'triangle', peak: 0.05, verb: 0 });
  }

  playPickup() {
    const ctx = this._ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    // death clouds can deliver dozens of chunks per frame — one chime per 35ms
    if (now - this._lastPickupAt < 0.035) return;
    this._pickupStreak = now - this._lastPickupAt < 0.4
      ? Math.min(this._pickupStreak + 1, PICKUP_LADDER.length - 1)
      : 0;
    this._lastPickupAt = now;
    const f = midi(76 + PICKUP_LADDER[this._pickupStreak]);
    this._tone({ freq: f, dur: 0.22, type: 'sine', peak: 0.13, verb: 0.25 });
    this._tone({ freq: f * 2, dur: 0.08, type: 'triangle', peak: 0.04, verb: 0.2 });
  }

  playPurchase() {
    [76, 83, 88].forEach((n, i) => {
      this._tone({ freq: midi(n), dur: 0.35, type: 'triangle', peak: 0.12, when: i * 0.07, verb: 0.35 });
      this._tone({ freq: midi(n + 12), dur: 0.2, type: 'sine', peak: 0.05, when: i * 0.07, verb: 0.35 });
    });
  }

  playShatter({ size = 0.5, pan = 0, vol = 1 } = {}) {
    const v = Math.max(0.05, vol);
    // body thump — bigger rocks go deeper
    this._tone({ freq: 130 - size * 60, freqEnd: 38, dur: 0.22 + size * 0.2, type: 'sine',
      peak: 0.32 * v, pan, verb: 0.12 });
    // crunch: noise sweeping down through a lowpass
    this._noiseHit({ dur: 0.28 + size * 0.25, peak: 0.32 * v, type: 'lowpass',
      freq: 2600, freqEnd: 260, Q: 0.7, pan, verb: 0.2 });
    // grit layer
    this._noiseHit({ dur: 0.1, peak: 0.12 * v, type: 'bandpass', freq: 3400, Q: 1.4, pan, verb: 0.1 });
    // scattered pebble clicks
    const pebbles = 3 + Math.round(size * 3);
    for (let i = 0; i < pebbles; i++) {
      this._noiseHit({ dur: 0.03, peak: 0.08 * v, type: 'bandpass', freq: 1500 + Math.random() * 3000,
        Q: 3, when: 0.03 + Math.random() * 0.2, pan: pan + (Math.random() - 0.5) * 0.3, verb: 0.15 });
    }
  }

  playCrystalShatter({ pan = 0, vol = 1 } = {}) {
    const v = Math.max(0.05, vol);
    this.playShatter({ size: 0.3, pan, vol: v * 0.6 });
    // inharmonic glassy partials, slightly staggered
    const base = 1300 + Math.random() * 300;
    [1, 2.76, 5.4, 8.93].forEach((r, i) => {
      this._tone({ freq: base * r, dur: 1.1 - i * 0.2, type: 'sine', peak: (0.09 - i * 0.015) * v,
        when: i * 0.025, pan, verb: 0.5 });
    });
    this._noiseHit({ dur: 0.18, peak: 0.1 * v, type: 'highpass', freq: 6000, Q: 0.7, pan, verb: 0.4 });
  }

  playLaserTick() {
    this._noiseHit({ dur: 0.03, peak: 0.04, type: 'bandpass', freq: 2500 + Math.random() * 1500, Q: 4, verb: 0 });
  }

  playBoostStart() {
    this._noiseHit({ dur: 0.5, peak: 0.24, attack: 0.04, type: 'bandpass', freq: 400, freqEnd: 2800, Q: 0.9, verb: 0.2 });
    this._tone({ freq: 90, freqEnd: 170, dur: 0.35, type: 'sine', peak: 0.12, verb: 0.05 });
  }

  playLowFuel() {
    this._tone({ freq: 880, dur: 0.09, type: 'triangle', peak: 0.13, verb: 0.15 });
    this._tone({ freq: 659, dur: 0.12, type: 'triangle', peak: 0.12, when: 0.1, verb: 0.15 });
  }

  playDeath() {
    this._tone({ freq: 440, freqEnd: 50, dur: 1.2, type: 'sawtooth', peak: 0.22,
      filter: { type: 'lowpass', freq: 2200, freqEnd: 200, Q: 2 }, verb: 0.3 });
    this._noiseHit({ dur: 1.0, peak: 0.25, type: 'lowpass', freq: 1200, freqEnd: 120, Q: 0.7, verb: 0.3 });
    // falling "power-down" figure
    [69, 65, 62, 57].forEach((n, i) => {
      this._tone({ freq: midi(n), dur: 0.5, type: 'triangle', peak: 0.09, when: 0.25 + i * 0.16, verb: 0.55 });
    });
  }

  playExplosion({ pan = 0, vol = 1 } = {}) {
    const v = Math.max(0.05, vol);
    this._tone({ freq: 85, freqEnd: 28, dur: 0.9, type: 'sine', peak: 0.5 * v, pan, verb: 0.2 });
    this._tone({ freq: 210, freqEnd: 40, dur: 0.6, type: 'sawtooth', peak: 0.3 * v,
      filter: { type: 'lowpass', freq: 900, Q: 1.2 }, pan, verb: 0.3 });
    this._noiseHit({ dur: 1.0, peak: 0.45 * v, type: 'lowpass', freq: 2200, freqEnd: 140, Q: 0.7, pan, verb: 0.35 });
    this._noiseHit({ dur: 0.25, peak: 0.22 * v, type: 'bandpass', freq: 2800, Q: 1.5, pan, verb: 0.2 });
    for (let i = 0; i < 6; i++) {
      this._noiseHit({ dur: 0.04, peak: 0.1 * v, type: 'bandpass', freq: 1200 + Math.random() * 2500, Q: 2,
        when: 0.08 + Math.random() * 0.45, pan: pan + (Math.random() - 0.5) * 0.5, verb: 0.3 });
    }
  }

  playLaunch() {
    this._noiseHit({ dur: 0.8, peak: 0.2, attack: 0.1, type: 'bandpass', freq: 300, freqEnd: 3200, Q: 1, verb: 0.3 });
    this._tone({ freq: 110, freqEnd: 440, dur: 0.6, type: 'sawtooth', peak: 0.16,
      filter: { type: 'lowpass', freq: 600, freqEnd: 3000 }, verb: 0.3 });
    [69, 72, 76, 81].forEach((n, i) => {
      this._tone({ freq: midi(n), dur: 0.6, type: 'triangle', peak: 0.08, when: 0.15 + i * 0.07, verb: 0.45 });
    });
  }

  playMotherIncoming() {
    // warning horn: detuned saws swelling through an opening filter, twice
    for (let k = 0; k < 2; k++) {
      const when = k * 0.85;
      [55, 55.6, 82.4].forEach((f) => {
        this._tone({ freq: f * 2, dur: 0.8, type: 'sawtooth', peak: 0.1, attack: 0.25, when,
          filter: { type: 'lowpass', freq: 300, freqEnd: 1600, Q: 4 }, verb: 0.5 });
      });
    }
    this._tone({ freq: 70, freqEnd: 35, dur: 1.4, type: 'sine', peak: 0.35, verb: 0.3 });
  }
}

export const Audio = new AudioEngine();
