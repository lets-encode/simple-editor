<p align="center">
  <img src="simple-editor.svg" alt="simple editor" width="384" height="76">
</p>

<p align="center"><em>a simple editor that hides the MEI</em></p>

# simple-editor

> **"simple editor" is a working title.** It names the idea, not a product.

> **This is an experimental prototype.** It is a throwaway spike for trying out ideas on real
> phones. It is not the editor, its code is not the editor's architecture, and it will
> be rewritten. Expect rough edges, and do not use it for real work at this point!

The aim is a simple graphical editor for the [Let's Encode!](https://lets-encode.mdw.ac.at/)
project: a way to view and correct music encodings ([MEI](https://music-encoding.org/)) directly
on the rendered score, without ever having to read or write XML. It is for corrections and
small-scale note entry, inside the Let's Encode crowd-encoding workflow and standalone. People
using it need no knowledge of MEI, yet what it writes must be valid, well-made MEI.

**It is phone-first and touch-first.** Every design decision starts from fingers on a phone screen.
We hope to support tablets and desktops (with mouse and keyboard) as well, but they come later and
are not designed for yet. The prototype does open on a tablet or desktop, and has keyboard
shortcuts, but it has been tried and tuned on phones only.

The prototype lives in [`spike/`](spike/). It is built with [Vite](https://vite.dev/), vanilla
JavaScript and [Verovio](https://www.verovio.org/) 6.3.

## Try it

The prototype is published at <https://lets-encode.github.io/simple-editor/>. Open it on a phone. Once loaded online, it can be added to the home screen and then runs **offline**: a service
worker keeps the whole app and its example scores. Your edits are kept in the browser, per score,
and the cog menu (⚙) can revert a score to its original.

To run it locally:

```
cd spike
npm install
npm run dev
```

and open the "Network" address Vite prints on a phone on the same network.

## One finger navigates and selects, two fingers edit

The central idea is a clean split, so that nobody edits by accident while finding their way around:

- **One finger never changes the score.** It moves around and chooses what to work on.
  - **Tap** an element to select it; tap empty space to select nothing.
  - **Flick** (← → ↑ ↓) to move to the neighbouring element: along the layer, then, going up or
    down, through the chord, the layer, the staff and the system.
  - **Slide slowly** (scrub) to walk one element per step of travel; sliding back walks back, and
    the slide can turn onto the other axis.
  - **Press and hold, then drag** to select everything inside a box. Flicks and scrubs then grow
    the selection by musical time, and boxes add to it, also across pages.
  - Navigation and selections carry on across page turns; edge chevrons show how much of the
    selection lies on earlier and later pages.
- **Two fingers edit the selection** in the active mode (Note, by default).
  - **Flick or slide ← →:** shorter or longer notes.
  - **Flick or slide ↑ ↓:** the pitch up or down by a step; a fast, long flick jumps an octave.
  - **Hold one finger and slide the other sideways:** ♭ (the left finger moves out), ♯ (the right
    finger moves out), or ♮ (either finger moves in).
  - **Hold one finger and tap with another:** add dots, cycling none, one, two.
  - Sliding back undoes the slide's changes exactly; nothing is final until the fingers lift.

The same editing steps are also available as buttons in the control bar, and from the keyboard (a
stop-gap for desktop testing, not a designed desktop experience).

## What the prototype shows so far

Proofs of concept, each tried on real phones:

- Touch navigation and selection over a Verovio-rendered score, as above, including across pages.
- Editing note duration, pitch and accidentals (also dots) by two-finger gestures and by buttons.
- **The MEI document stays the truth.** Edits change the MEI's DOM; Verovio only draws it. Edits
  follow each file's own habits in how accidentals and attributes are written.
- **Quick feedback on slow phones:** edits show at once as "ghost" notes while the page reloads in
  the background, which makes low-end phones usable.
- A **facsimile sheet**: the page image the encoding came from, following the selection, with
  highlighted zones; tapping a zone selects its measure.
- An **entry pane** for entering notes: slide on its staff to choose a pitch, lift to enter it, and
  move on through the bar; empty bars show slots to enter into.
- Offline use as an installable web app, and edits kept in the browser.

Not yet built: entering rests and chords, ties, beams, slurs and other kinds of element, and
checks on bar lengths. Corrections come first; the full design is still being worked out.

## Example scores

The scores in [`fixtures/`](fixtures/) keep their own licences, listed in
[`fixtures/README.md`](fixtures/README.md): a Chopin mazurka and a Beethoven sonatina, and encodings
from Let's Encode test campaigns that come with their facsimile scans. The campaign encodings are
tests in progress and are neither correct nor authoritative.

## Licence

[GNU Affero General Public License 3.0](LICENSE) for the code.
