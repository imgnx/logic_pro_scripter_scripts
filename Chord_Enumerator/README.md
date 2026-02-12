---
title: Chord Enumerator
...

Chord Enumerator (Logic Pro Scripter)
=====================================

Bar-level chord logger that labels the chord formed by **all notes played within each measure**, using the **lowest note as the root**. Designed for Logic Pro’s Scripter MIDI FX.

What it does
------------

- Watches incoming MIDI while the transport is playing.
- Collects every note-on within the current bar (measure).
- On the bar boundary, prints a single summary line to the Trace panel:
  `Bar N: <chord> | bass=<lowest MIDI pitch> | PCs=<pitch classes> | notes=<pitches>`
- Always returns a label, even for unconventional pitch sets (falls back to interval tokens).

Why it’s handy
--------------

- Quick chord transcription of performances or MIDI files.
- Highlights slash-chord/bass-note context by forcing the lowest note as the root.
- Survives odd meters and meter changes mid-song.
- Optional raw note list for auditing voicings.

Installation
------------

1) In Logic Pro, add **Scripter** as a MIDI FX on the target instrument track.
2) Open the Scripter UI, choose **Open in Script Editor**, and paste the contents of `ChordEnumerator.js`.
3) Click **Run**.

Parameters
----------

- **Pitch Class Style**: `Sharps` | `Flats` — controls pitch-class names in the log.
- **Log Empty Bars**: `Yes` | `No` — whether to emit `Bar N: (no notes)` for silent measures.
- **Include Notes List**: `Yes` | `No` — append the raw MIDI note numbers seen in the bar.

Output details
--------------

- **Chord name**: Built from the lowest note as root; infers simple qualities (maj/min/dim/aug/sus) and common extensions/alterations. Falls back to an interval set if the shape is ambiguous.
- **bass**: The numeric MIDI pitch of the bar’s lowest note.
- **PCs**: Unique pitch classes in ascending order, respecting the selected naming style.
- **notes** (optional): Unique MIDI pitches seen in the bar.
- An extra line prints the interval set in semitones relative to the bass: `semitones=0,4,7,...`.

Usage tips
----------

- Start playback anywhere; the script initializes to the current bar and respects meter changes.
- Works best when placed on the instrument track that receives the MIDI region (not on auxes).
- For dense passages, keep `Include Notes List` on to cross-check voicings.

Limitations
-----------

- Not a full jazz parser; prioritizes stability and readability over exhaustive chord naming.
- Uses lowest note as root by design; inversions or upper-structure analyses are not shown.
- Note-offs are ignored; held notes across bars are treated as belonging to each bar they sound in.

File inventory
--------------

- `ChordEnumerator.js` — the Logic Scripter source.
