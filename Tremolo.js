/**
 * Length-sensitive Note Repeater Tail
 *
 * Logic Pro's MIDI Scripter calls `HandleMIDI` for every incoming event.
 * This script measures how long each note is held, then spawns a string of
 * decaying repeats after note-off. Longer notes produce longer tails. All
 * parameter labels remain sourced from `__PARAMS__` per user request.
 */

const __PARAMS__ = [
  "Numerator"
  , "Denominator"
  , "Quantity"
  , "Tail Decay"
  , "Gate"
  , "Pitch Decay"
  , "Pitch Decay Multiplier"
  , "High-pass (Hz)"
  , "Low-pass (Hz)"
  , "Delay (beats)"
  , "Attack"
  , "Hold"
  , "Decay"
  , "Sustain"
  , "Release"
  , "Voices"
];

// Beat-synced durations for envelope stages (quarter note = 1 beat).
var SYNC_DURATIONS = [
  ["1/64",   0.0625],
  ["1/32t",  0.0833333333],
  ["1/32",   0.125],
  ["1/16t",  0.1666666667],
  ["1/16",   0.25],
  ["1/16*",  0.375],
  ["1/8t",   0.3333333333],
  ["1/8",    0.5],
  ["1/8*",   0.75],
  ["1/4t",   0.6666666667],
  ["1/4",    1],
  ["1/4*",   1.5],
  ["1/2t",   1.3333333333],
  ["1/2",    2],
  ["1/2*",   3],
  ["1t",     2.6666666667],
  ["1",      4],
  ["1*",     6]
];

// Public flags consumed by the Scripter host
var NeedsTimingInfo = true;

// Cache the last known block start so we have timing even before beatPos is populated.
var lastBeatPos = -1;

/**
 * Parameter index helpers for readability when dereferencing __PARAMS__.
 * These are aliases only; the underlying array stays untouched.
 */
var PARAM_INDEX = {
  NUMERATOR: 0,
  DENOMINATOR: 1,
  QUANTITY: 2,
  DECAY: 3,
  GATE: 4,
  PITCH_DECAY: 5,
  PITCH_DECAY_MULTIPLIER: 6,
  HIGHPASS_HZ: 7,
  LOWPASS_HZ: 8,
  DELAY: 9,
  ATTACK: 10,
  HOLD: 11,
  ENV_DECAY: 12,
  SUSTAIN: 13,
  RELEASE: 14,
  VOICES: 15
};

// ---------------------
// UI parameters
// ---------------------

/**
 * Scripter parameter definitions exposed to the UI.
 * Each entry links a UI label (from __PARAMS__) with value ranges and defaults.
 */
var PluginParameters = [
  {
    name: __PARAMS__[PARAM_INDEX.NUMERATOR],
    type: "lin",
    minValue: 0,
    maxValue: 64,
    numberOfSteps: 64,
    defaultValue: 1
  }, {
    name: __PARAMS__[PARAM_INDEX.DENOMINATOR],
    type: "lin",
    minValue: 0,
    maxValue: 64,
    numberOfSteps: 64,
    defaultValue: 12
  }, {
    name: __PARAMS__[PARAM_INDEX.QUANTITY],
    type: "lin",
    minValue: 1,
    maxValue: 64,
    numberOfSteps: 63,
    defaultValue: 2
  }, {
    name: __PARAMS__[PARAM_INDEX.DECAY],
    type: "lin",
    minValue: 0,
    maxValue: 1,
    numberOfSteps: 100,
    defaultValue: 1
  }, {
    name: __PARAMS__[PARAM_INDEX.GATE],
    type: "lin",
    minValue: 0.05,
    maxValue: 1,
    numberOfSteps: 95,
    defaultValue: 0.5
  }, {
    name: __PARAMS__[PARAM_INDEX.PITCH_DECAY],
    type: "lin",
    minValue: 0,
    maxValue: 1,
    numberOfSteps: 1000,
    defaultValue: 0
  }, {
    name: __PARAMS__[PARAM_INDEX.PITCH_DECAY_MULTIPLIER],
    type: "lin",
    minValue: 1,
    maxValue: 60,
    numberOfSteps: 60,
    defaultValue: 1
  }, {
    name: __PARAMS__[PARAM_INDEX.HIGHPASS_HZ],
    type: "lin",
    minValue: 20,
    maxValue: 20000,
    numberOfSteps: 19980,
    defaultValue: 20
  }, {
    name: __PARAMS__[PARAM_INDEX.LOWPASS_HZ],
    type: "lin",
    minValue: 1,
    maxValue: 20000,
    numberOfSteps: 19999,
    defaultValue: 2000 // Default to 2000 -DMJ
  }, {
    name: __PARAMS__[PARAM_INDEX.DELAY],
    type: "lin",
    minValue: 0,
    maxValue: 1,
    numberOfSteps: 1000, // Make this divisible by three for a smoother effect.
    defaultValue: 0.083 // 1/12th
  }, {
    name: __PARAMS__[PARAM_INDEX.ATTACK],
    type: "menu",
    valueStrings: SYNC_DURATIONS.map(function (p) { return p[0]; }),
    defaultValue: 0
  }, {
    name: __PARAMS__[PARAM_INDEX.HOLD],
    type: "menu",
    valueStrings: SYNC_DURATIONS.map(function (p) { return p[0]; }),
    defaultValue: 0
  }, {
    name: __PARAMS__[PARAM_INDEX.ENV_DECAY],
    type: "menu",
    valueStrings: SYNC_DURATIONS.map(function (p) { return p[0]; }),
    defaultValue: 10 // 1/4
  }, {
    name: __PARAMS__[PARAM_INDEX.SUSTAIN],
    type: "lin",
    minValue: 0,
    maxValue: 1,
    numberOfSteps: 1000,
    defaultValue: 0.8
  }, {
    name: __PARAMS__[PARAM_INDEX.RELEASE],
    type: "menu",
    valueStrings: SYNC_DURATIONS.map(function (p) { return p[0]; }),
    defaultValue: 10 // 1/4
  }, {
    name: __PARAMS__[PARAM_INDEX.VOICES],
    type: "lin",
    minValue: 1,
    maxValue: 64,
    numberOfSteps: 63,
    defaultValue: 12
  }
];

// ---------------------
// State
// ---------------------

/**
 * Tracks currently held notes so their lengths can be measured at note-off.
 * Key format: "pitch:channel" ensures per-channel separation.
 * @type {Object.<string,{on: NoteOn, startBeat: number}>}
 */
var activeNotes = {};

/**
 * Builds a stable lookup key for a MIDI event's pitch+channel pair.
 * @param {NoteOn|NoteOff} ev - Incoming MIDI event.
 * @returns {string} unique key representing the note slot.
 */
function noteKey(ev) {
  return ev.pitch + ":" + ev.channel;
}

function param(idx) {
  return GetParameter(idx);
}

/**
 * Logic Pro calls this once per processing block when NeedsTimingInfo is true.
 * We capture blockStartBeat as a fallback for live-played notes whose beatPos
 * may arrive undefined on the first block.
 */
function ProcessMIDI() {
  var info = GetTimingInfo();
  if (info && typeof info.blockStartBeat === "number") {
    lastBeatPos = info.blockStartBeat;
  }
}

// ---------------------
// Core logic
// ---------------------

/**
 * Entry point called by Scripter for every MIDI event.
 * - NoteOn: cache a clone with timing so we can measure duration later.
 * - NoteOff: compute held length and schedule the decaying tail repeats.
 * - Everything else: pass through untouched.
 * @param {NoteOn|NoteOff|ControlChange|PitchBend|PolyPressure|ChannelPressure|ProgramChange} event
 */
function HandleMIDI(event) {
  if (event instanceof NoteOn) {
    // Store a clone so velocity/pitch/beatPos remain even after host reuse.
    var key = noteKey(event);
    var startBeat = Number.isFinite(event.beatPos)
      ? event.beatPos
      : lastBeatPos;
    activeNotes[key] = {
      on: new NoteOn(event),
      startBeat: startBeat
    };

    event.send();
    return;
  }

  if (event instanceof NoteOff) {
    var offKey = noteKey(event);
    var info = activeNotes[offKey];

    if (info) {
      var startBeat = info.startBeat;
      var endBeat = Number.isFinite(event.beatPos)
        ? event.beatPos
        : lastBeatPos;
      var lengthBeats = Math.max(0, endBeat - startBeat);

      createTailRepeats(info.on, lengthBeats, endBeat);
      delete activeNotes[offKey];
    }

    event.send();
    return;
  }

  // Non-note events pass through untouched.
  event.send();
}

/**
 * Generate and schedule the decaying note tail after a key is released.
 * Tail duration scales with how long the note was held.
 * @param {NoteOn} srcNoteOn - Original note-on clone (preserves velocity/pitch).
 * @param {number} lengthBeats - Duration the note was held, in beats.
 * @param {number} releaseBeat - Beat position of the note-off event.
 */
function createTailRepeats(srcNoteOn, lengthBeats, releaseBeat) {
  var numerator = param(PARAM_INDEX.NUMERATOR);
  var denominator = param(PARAM_INDEX.DENOMINATOR);
  var quantity = Math.max(1, Math.round(param(PARAM_INDEX.QUANTITY)));
  var velDecay = param(PARAM_INDEX.DECAY);
  var gateFrac = param(PARAM_INDEX.GATE);
  var pitchDecay = param(PARAM_INDEX.PITCH_DECAY);
  var pitchDecayMultiplier = param(PARAM_INDEX.PITCH_DECAY_MULTIPLIER);
  var transposeStep = pitchDecay * pitchDecayMultiplier;
  var hpHz = param(PARAM_INDEX.HIGHPASS_HZ);
  var lpHz = param(PARAM_INDEX.LOWPASS_HZ);
  var delayBeats = param(PARAM_INDEX.DELAY);
  var envA = envDurationFromMenu(PARAM_INDEX.ATTACK);
  var envH = envDurationFromMenu(PARAM_INDEX.HOLD);
  var envD = envDurationFromMenu(PARAM_INDEX.ENV_DECAY);
  var envS = param(PARAM_INDEX.SUSTAIN);
  var envR = envDurationFromMenu(PARAM_INDEX.RELEASE);
  var voices = Math.max(1, Math.round(param(PARAM_INDEX.VOICES)));

  // keep bounds sane
  if (lpHz < hpHz) {
    var tmp = lpHz; lpHz = hpHz; hpHz = tmp;
  }

  // Convert user-entered fraction to beat spacing (e.g., 1/4 = quarter note).
  var spacing = (denominator !== 0) ? numerator / denominator : 0;

  if (spacing <= 0) return;

  // Fixed repeat count set by Quantity, capped by max voices to avoid overload.
  var repeats = Math.min(quantity, voices);

  var gateBeats = spacing * gateFrac;
  if (gateBeats <= 0) gateBeats = spacing * 0.5;

  var baseVel = srcNoteOn.velocity;
  var totalSpan = spacing * Math.max(0, repeats - 1) + envR; // span used for envelope

  for (var i = 0; i < repeats; i++) {
    var beatTime = releaseBeat + delayBeats + spacing * i;

    // Schedule note-on clone with decayed velocity and stepped pitch.
    var on = new NoteOn(srcNoteOn);
    var tailEnv = (velDecay > 0) ? Math.pow(velDecay, i) : 1.0;
    var adsrEnv = envelopeAtTime(i * spacing, envA, envH, envD, envS, envR, totalSpan);
    var vel = Math.round(baseVel * tailEnv * adsrEnv);
    if (vel < 1) vel = 1;
    if (vel > 127) vel = 127;
    on.velocity = vel;

    // Optional pitch stepping per repeat for shimmer / gamelan-ish effect.
    on.pitch = clamp(on.pitch + transposeStep * i, 0, 127);

    var hz = midiPitchToHz(on.pitch);
    if (hz < hpHz || hz > lpHz) continue; // skip outside pass band

    on.sendAtBeat(beatTime);

    // Corresponding note-off with gate-relative length.
    var off = new NoteOff(on);
    off.sendAtBeat(beatTime + gateBeats);
  }
}

// ---------------------
// Helpers
// ---------------------

function envDurationFromMenu(idx) {
  var selection = Math.round(param(idx));
  var safeIdx = clamp(selection, 0, SYNC_DURATIONS.length - 1);
  return SYNC_DURATIONS[safeIdx][1];
}

function midiPitchToHz(pitch) {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

function envelopeAtTime(t, a, h, d, s, r, total) {
  // Basic AHDSR, times in beats, sustain as level 0..1.
  var attackEnd = a;
  var holdEnd = attackEnd + h;
  var decayEnd = holdEnd + d;
  var releaseStart = Math.max(decayEnd, total - r);

  if (t <= 0) return (a > 0) ? 0 : 1;
  if (t < attackEnd && a > 0) return t / a;
  if (t < holdEnd) return 1;
  if (t < decayEnd && d > 0) {
    var k = (t - holdEnd) / d;
    return 1 + k * (s - 1); // linear decay toward sustain
  }
  if (t < releaseStart) return s;

  // Release segment
  var relTime = t - releaseStart;
  if (r <= 0) return 0;
  var kRel = 1 - Math.min(1, relTime / r);
  return s * kRel;
}

/**
 * Clamp a numeric value into the provided [min,max] range.
 * @param {number} val - Value to clamp.
 * @param {number} min - Lower bound.
 * @param {number} max - Upper bound.
 * @returns {number} constrained value.
 */
function clamp(val, min, max) {
  if (val < min) return min;
  if (val > max) return max;
  return val;
}
