// Zero-asset audio: synthesizes SFX + an ambient space pad via Web Audio.
// Swap to sample playback later by replacing the play*() bodies with
// HTMLAudio or Phaser's sound manager — call sites in the scenes don't change.
//
// Browser autoplay rules: the AudioContext must be resumed from a user
// gesture. The Title scene's Launch button calls Audio.unlock() on click.

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.musicNodes = null;
    this.unlocked = false;
    this.muted = false;
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
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.35;
    this.musicGain.connect(this.master);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.4;
    this.sfxGain.connect(this.master);
  }

  _ensureCtx() {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(this.ctx.destination);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.22;
    this.musicGain.connect(this.master);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.8;
    this.sfxGain.connect(this.master);

    return this.ctx;
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
      this.master.gain.linearRampToValueAtTime(this.muted ? 0 : 0.9, now + 0.15);
    }
  }

  toggleMute() { this.setMuted(!this.muted); return this.muted; }

  // ---------- BGM: ambient space piece in A minor ----------
  //
  // Structure:
  //   • low drone on A1 throughout (space floor)
  //   • 3-voice sustained pad that re-tunes each chord (8s per chord)
  //   • 16th-note arpeggio on the chord tones (soft triangle)
  //   • sparse lead melody from A-minor pentatonic, with a delay tail
  //   • slow LFO on the pad's lowpass filter keeps the tone moving
  // Chord progression (8s each, ~32s loop):
  //   Am  →  F  →  C  →  Em    (i  VI  III  v)

  startMusic() {
    const ctx = this._ensureCtx();
    if (!ctx || this.musicNodes) return;

    // --- bus: pad filter -> musicGain, lead delay -> musicGain ---
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 900;
    padFilter.Q.value = 0.7;
    padFilter.connect(this.musicGain);

    const filterLfo = ctx.createOscillator();
    const filterLfoGain = ctx.createGain();
    filterLfo.frequency.value = 0.07;
    filterLfoGain.gain.value = 450;
    filterLfo.connect(filterLfoGain).connect(padFilter.frequency);
    filterLfo.start();

    // feedback delay for the lead — cheap "space reverb"
    const leadBus = ctx.createGain();
    leadBus.gain.value = 1;
    const delay = ctx.createDelay(1.2);
    delay.delayTime.value = 0.42;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.45;
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    leadBus.connect(this.musicGain);
    leadBus.connect(delay);
    delay.connect(feedback).connect(delay);
    delay.connect(wet).connect(this.musicGain);

    // --- persistent voices ---
    const mkVoice = (type, freq, detune, level, dest) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detune;
      g.gain.value = level;
      o.connect(g).connect(dest);
      o.start();
      return { o, g };
    };

    // low drone: A1 + fifth for weight
    const drone1 = mkVoice('sine', 55.00, 0, 0.32, padFilter);         // A1
    const drone2 = mkVoice('sine', 82.41, -4, 0.14, padFilter);        // E2

    // three pad voices that will be retuned each chord change
    const padVoices = [
      mkVoice('sine',     220.00, -6, 0.14, padFilter),   // root
      mkVoice('triangle', 261.63,  4, 0.10, padFilter),   // 3rd
      mkVoice('sine',     329.63, -3, 0.08, padFilter),   // 5th
    ];

    // chord progression: triads in Hz (root, 3rd, 5th), ~one chord every 8s
    //   Am = A3 C4 E4  |  F = F3 A3 C4  |  C = C4 E4 G4  |  Em = E3 G3 B3
    const progression = [
      [220.00, 261.63, 329.63], // Am
      [174.61, 220.00, 261.63], // F
      [261.63, 329.63, 391.99], // C
      [164.81, 196.00, 246.94], // Em
    ];

    // pentatonic pool for the lead (A minor pentatonic across 2 octaves)
    const pentatonic = [220.00, 261.63, 293.66, 329.63, 391.99, 440.00, 523.25, 587.33, 659.25];

    const BAR_SEC = 8;       // 8 seconds per chord
    const STEP_SEC = 0.5;    // arpeggio step (eighth note at 120bpm feel but sparse)
    let chordIndex = 0;
    let step = 0;

    // --- scheduler: retunes pad, triggers arp, occasionally triggers lead ---
    const changeChord = () => {
      const [r, t, f] = progression[chordIndex % progression.length];
      const now = ctx.currentTime;
      // gentle glide between chords so changes feel like breathing
      padVoices[0].o.frequency.cancelScheduledValues(now);
      padVoices[1].o.frequency.cancelScheduledValues(now);
      padVoices[2].o.frequency.cancelScheduledValues(now);
      padVoices[0].o.frequency.linearRampToValueAtTime(r, now + 1.5);
      padVoices[1].o.frequency.linearRampToValueAtTime(t, now + 1.5);
      padVoices[2].o.frequency.linearRampToValueAtTime(f, now + 1.5);
    };

    const arpNote = (freq) => {
      // soft plucked triangle, short decay
      const now = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.09, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
      o.connect(g).connect(this.musicGain);
      o.start(now);
      o.stop(now + 0.6);
    };

    const leadNote = (freq) => {
      const now = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const f = ctx.createBiquadFilter();
      o.type = 'sine';
      o.frequency.value = freq;
      f.type = 'lowpass';
      f.frequency.value = 2200;
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.13, now + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 1.0);
      o.connect(f).connect(g).connect(leadBus);
      o.start(now);
      o.stop(now + 1.1);
    };

    // kick off the first chord immediately (no 1.5s initial ramp)
    const [r0, t0, f0] = progression[0];
    padVoices[0].o.frequency.value = r0;
    padVoices[1].o.frequency.value = t0;
    padVoices[2].o.frequency.value = f0;

    const stepTimer = setInterval(() => {
      const chord = progression[chordIndex % progression.length];
      const stepsPerBar = Math.round(BAR_SEC / STEP_SEC); // 16
      // arpeggio pattern: root, 5th, 3rd, 5th — gentle rocking motion
      const pattern = [chord[0], chord[2], chord[1], chord[2]];
      // play arp every other step (sparser)
      if (step % 2 === 0) arpNote(pattern[(step / 2) % pattern.length] * 2);
      // sparse lead every ~8 steps, occasionally
      if (step % 8 === 4 && Math.random() < 0.55) {
        leadNote(pentatonic[Math.floor(Math.random() * pentatonic.length)]);
      }
      step++;
      if (step >= stepsPerBar) {
        step = 0;
        chordIndex++;
        changeChord();
      }
    }, STEP_SEC * 1000);

    this.musicNodes = {
      padFilter, filterLfo, delay, feedback, wet, leadBus,
      drone1, drone2, padVoices, stepTimer,
    };
  }

  stopMusic() {
    if (!this.musicNodes) return;
    const { ctx } = this;
    const now = ctx.currentTime;
    const m = this.musicNodes;
    clearInterval(m.stepTimer);
    const voices = [m.drone1, m.drone2, ...m.padVoices];
    for (const n of voices) {
      n.g.gain.cancelScheduledValues(now);
      n.g.gain.linearRampToValueAtTime(0, now + 0.4);
      n.o.stop(now + 0.45);
    }
    m.filterLfo.stop(now + 0.45);
    setTimeout(() => {
      try { m.padFilter.disconnect(); } catch {}
      try { m.delay.disconnect(); } catch {}
      try { m.feedback.disconnect(); } catch {}
      try { m.wet.disconnect(); } catch {}
      try { m.leadBus.disconnect(); } catch {}
    }, 500);
    this.musicNodes = null;
  }

  // ---------- SFX helpers ----------

  _envTone({ freq = 440, dur = 0.15, type = 'sine', peak = 0.4, attack = 0.005, freqEnd = null, filter = null }) {
    const ctx = this._ensureCtx();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 0.01), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let out = g;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter.type || 'lowpass';
      f.frequency.value = filter.freq || 2000;
      f.Q.value = filter.Q || 1;
      g.connect(f);
      out = f;
    }
    osc.connect(g);
    out.connect(this.sfxGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  _noiseBurst({ dur = 0.2, peak = 0.35, filterFreq = 1200, filterType = 'bandpass', Q = 2 }) {
    const ctx = this._ensureCtx();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = filterFreq;
    f.Q.value = Q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.sfxGain);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // ---------- SFX API ----------

  playUiClick() {
    this._envTone({ freq: 900, freqEnd: 1400, dur: 0.08, type: 'square', peak: 0.18 });
  }

  playPickup() {
    // two-note chime
    this._envTone({ freq: 880, freqEnd: 1320, dur: 0.12, type: 'triangle', peak: 0.22 });
    setTimeout(() => this._envTone({ freq: 1320, freqEnd: 1760, dur: 0.1, type: 'triangle', peak: 0.18 }), 40);
  }

  playShatter() {
    this._noiseBurst({ dur: 0.35, peak: 0.4, filterFreq: 900, filterType: 'lowpass', Q: 0.7 });
    this._envTone({ freq: 180, freqEnd: 60, dur: 0.25, type: 'square', peak: 0.18 });
  }

  playLaserTick() {
    // very short, used while laser hits
    this._envTone({ freq: 1600, freqEnd: 1200, dur: 0.04, type: 'sawtooth', peak: 0.08,
      filter: { type: 'bandpass', freq: 2200, Q: 3 } });
  }

  playBoostStart() {
    this._noiseBurst({ dur: 0.25, peak: 0.25, filterFreq: 1600, filterType: 'highpass', Q: 0.8 });
  }

  playLowFuel() {
    this._envTone({ freq: 660, freqEnd: 440, dur: 0.18, type: 'square', peak: 0.22 });
  }

  playDeath() {
    this._envTone({ freq: 420, freqEnd: 60, dur: 0.8, type: 'sawtooth', peak: 0.35,
      filter: { type: 'lowpass', freq: 1200, Q: 1 } });
    this._noiseBurst({ dur: 0.6, peak: 0.3, filterFreq: 600, filterType: 'lowpass', Q: 0.7 });
  }

  playLaunch() {
    this._envTone({ freq: 220, freqEnd: 880, dur: 0.35, type: 'sawtooth', peak: 0.25,
      filter: { type: 'lowpass', freq: 2000 } });
  }
}

export const Audio = new AudioEngine();
