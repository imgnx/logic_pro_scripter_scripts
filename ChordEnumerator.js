/*
Logic Pro — Scripter
"Measure Chord Logger (lowest-note root)"

What it does:
- While the transport plays, it accumulates all NOTE-ON pitches that occur
  during the current bar (measure).
- When the bar changes, it logs ONE line to Trace for the completed bar:
    Bar N: <root-based chord name>  | bass=<lowest pitch> | PCs=<pitch classes>
- Root is the LOWEST MIDI note that happened in the bar (your rule).
- Always outputs something, even for “weird” note sets (fallback shows PC set).

Place on MIDI FX of the instrument track that receives the MIDI region.
Open Scripter and use the bottom console (Trace output).
*/

var NeedsTimingInfo = true;

var PluginParameters = [
    {
        name: "Pitch Class Style",
        type: "menu",
        valueStrings: ["Sharps", "Flats"],
        defaultValue: 0
    },
    {
        name: "Log Empty Bars",
        type: "menu",
        valueStrings: ["No", "Yes"],
        defaultValue: 0
    },
    {
        name: "Include Notes List",
        type: "menu",
        valueStrings: ["No", "Yes"],
        defaultValue: 1
    }
];

var NAMES_SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
var NAMES_FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

function pcName(pc) {
    pc = ((pc % 12) + 12) % 12;
    return (GetParameter("Pitch Class Style") === 0) ? NAMES_SHARPS[pc] : NAMES_FLATS[pc];
}

function uniqSorted(arr) {
    var m = {};
    for (var i = 0; i < arr.length; i++) m[arr[i]] = true;
    var out = [];
    for (var k in m) out.push(parseInt(k, 10));
    out.sort(function (a, b) { return a - b; });
    return out;
}

function pcsFromPitches(pitches) {
    var set = {};
    for (var i = 0; i < pitches.length; i++) set[pitches[i] % 12] = true;
    var pcs = [];
    for (var k in set) pcs.push(parseInt(k, 10));
    pcs.sort(function (a, b) { return a - b; });
    return pcs;
}

function intervalsFromRootPC(pcs, rootPC) {
    // Return unique sorted intervals (0..11) relative to rootPC, excluding 0 optionally later
    var ints = [];
    for (var i = 0; i < pcs.length; i++) {
        var d = (pcs[i] - rootPC + 12) % 12;
        ints.push(d);
    }
    return uniqSorted(ints);
}

function has(ints, v) {
    for (var i = 0; i < ints.length; i++) if (ints[i] === v) return true;
    return false;
}

/*
Build a "root-based" chord label from pitch-class intervals.

This is NOT a full jazz chord parser. It’s deliberately:
- stable
- explainable
- always returns something

It chooses:
- triad quality if possible (maj/min/dim/aug/sus2/sus4)
- then adds common extensions/alterations as suffix tokens.
*/
function chordNameFromLowestRoot(pitches) {
    if (!pitches || pitches.length === 0) return "(no notes)";

    pitches = uniqSorted(pitches);
    var bass = pitches[0];
    var rootPC = bass % 12;

    var pcs = pcsFromPitches(pitches);
    var ints = intervalsFromRootPC(pcs, rootPC); // includes 0

    // determine "triad-ish" quality
    var quality = "";
    var has3 = has(ints, 3);
    var has4 = has(ints, 4);
    var has5 = has(ints, 5);
    var has2 = has(ints, 2);
    var has6 = has(ints, 6);
    var has7 = has(ints, 7);
    var has8 = has(ints, 8);

    if (has4 && has7) quality = "";       // major
    else if (has3 && has7) quality = "m"; // minor
    else if (has3 && has6) quality = "dim";
    else if (has4 && has8) quality = "aug";
    else if (has2 && has7) quality = "sus2";
    else if (has5 && has7) quality = "sus4";
    else quality = ""; // unknown triad; we'll still add interval tokens

    // extensions / colors
    var suffix = "";

    // 7ths
    if (has(ints, 10)) suffix += "7";       // b7
    else if (has(ints, 11)) suffix += "maj7";

    // 6
    if (has(ints, 9) && suffix.indexOf("7") === -1) {
        // if it has a 6 and no 7, call it 6-ish
        suffix += (suffix ? "" : "6");
        if (!suffix) suffix = "6";
        else if (suffix === "maj7") suffix += "(add6)";
    }

    // 9 / add9
    if (has(ints, 2)) {
        if (suffix === "" && (quality === "" || quality === "m" || quality === "dim" || quality === "aug" || quality.indexOf("sus") === 0)) {
            // if it's a triad-ish chord, add9 is clearer than 9
            suffix += (suffix ? "" : "");
            suffix += (suffix && suffix !== "6") ? "(add9)" : "add9";
        } else {
            suffix += "9";
        }
    }

    // 11 / add11
    if (has(ints, 5)) {
        // sus4 already implies 11-ish; still label add11 for non-sus shapes
        if (quality !== "sus4") suffix += (suffix ? "" : "") + "add11";
    }

    // 13 / add13 (13 = 9)
    if (has(ints, 9)) {
        // treat as 13 if there is a 7 already
        if (has(ints, 10) || has(ints, 11)) suffix += "13";
    }

    // alterations: b5/#5, b9/#9, #11
    if (has(ints, 6) && quality !== "dim") suffix += "b5";
    if (has(ints, 8) && quality !== "aug") suffix += "#5";
    if (has(ints, 1)) suffix += "b9";
    if (has(ints, 3) && quality === "") suffix += "#9"; // if no clear minor triad, 3 can be #9 color

    if (has(ints, 6) && has(ints, 10)) {
        // could be m7b5-ish; leave as tokens unless triad was recognized as dim
    }

    var name = pcName(rootPC) + quality + suffix;

    // Fallback: if we basically couldn’t say anything meaningful, show interval set.
    // (Still uses root = lowest note.)
    var meaningful = (quality !== "" || suffix !== "" || (pcs.length === 1));
    if (!meaningful) {
        var tokens = [];
        for (var i = 0; i < ints.length; i++) {
            if (ints[i] === 0) continue;
            tokens.push(ints[i]);
        }
        name = pcName(rootPC) + " (" + tokens.join(",") + ")";
    }

    return { name: name, bass: bass, pcs: pcs, pitches: pitches, intervals: ints };
}

// ---- Measure accumulation ----
var currentBar = null;
var barPitches = [];     // pitches seen in this bar (note-on)
var lastPlayed = false;

function flushBar(barNumber) {
    var logEmpty = (GetParameter("Log Empty Bars") === 1);
    if (barPitches.length === 0) {
        if (logEmpty) Trace("Bar " + barNumber + ": (no notes)");
        return;
    }

    var info = chordNameFromLowestRoot(barPitches);
    var pcsNames = info.pcs.map(function (pc) { return pcName(pc); }).join("-");
    var msg = "Bar " + barNumber + ": " + info.name +
        "  | bass=" + info.bass +
        "  | PCs=" + pcsNames;

    if (GetParameter("Include Notes List") === 1) {
        msg += "  | notes=" + info.pitches.join(",");
    }

    Trace(msg);
    Trace("          semitones=" + info.intervals.join(","));
}

function HandleMIDI(event) {
    // We accumulate NoteOn pitches only; NoteOff isn’t needed for bar-summary.
    if (event instanceof NoteOn) {
        barPitches.push(event.pitch);
    }
    event.send();
}

function ProcessMIDI() {
    var t = GetTimingInfo();

    // reset on stop/start
    if (!t.playing && lastPlayed) {
        currentBar = null;
        barPitches = [];
    }
    lastPlayed = t.playing;

    if (!t.playing) return;

    // Logic reports bar position as 1-based in many contexts; here we derive it
    // from blockStartBeat and meter. We'll compute a stable bar index using
    // current time signature.
    var num = t.meterNumerator || 4;
    var den = t.meterDenominator || 4;

    // "Beats" in TimingInfo are quarter-note beats.
    // Beats per bar in quarter-note units:
    var beatsPerBar = num * (4 / den);

    // barIndex 0-based
    var barIndex = Math.floor(t.blockStartBeat / beatsPerBar);

    if (currentBar === null) {
        currentBar = barIndex;
    }

    if (barIndex !== currentBar) {
        // One or more bars advanced; flush each.
        while (currentBar < barIndex) {
            flushBar(currentBar + 1); // log bar as 1-based
            currentBar++;
            barPitches = [];
        }
    }
}
