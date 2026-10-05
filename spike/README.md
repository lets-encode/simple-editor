# Gesture spike

Throwaway prototype for trying out the touch navigation and selection gestures over a
Verovio-rendered score. It is not the editor's architecture.

```
npm install
npm run dev
```

Open the "Network" address Vite prints on a phone or tablet on the same network.

- Tap: select an element; tap empty space to select none.
- Flick ← → ↑ ↓: move one step to the neighbouring element, as mei-friend's arrow keys do. Navigation stays on the current page.
- Slow slide (scrub, like the Android space bar), horizontal or vertical: walk one element per step of finger travel; sliding back walks back. Turning mid-scrub continues along the other axis from where you are.
- Press and hold still, then drag: select everything inside the box. Flicks and scrubs then grow that selection (never below its size at the start of the gesture), and tapping a selected element removes it.
- Two fingers edit the selection in the active mode, which is Note by default. A flick ← → makes the duration longer or shorter by one step; a flick ↑ ↓ moves the pitch one diatonic step within the key; a fast, long flick ↑ ↓ jumps an octave. A slow two-finger slide scrubs along the axis it started on, and sliding back restores earlier values. Edits change the MEI DOM, which Verovio then reloads; the HUD shows how long that takes, with the count, median and 90th percentile since the score was loaded. ⚙ shows the same with the median per phase, and can reset them.
- The Note level of the control bar has the same four steps as buttons.
- Showing edits (⚙): *Real* reloads Verovio after every step. *Ghost* draws the new note at once, in pink over the faded original, and reloads when you pause. *Auto* (the default) uses ghosts while the median of recent reloads is above a threshold (150 ms). By default only the page on screen is reloaded, with Verovio's `select()`, keeping the full layout's line breaks; ⚙ can switch to reloading the whole file for comparison.
- Keyboard: arrows navigate, Shift+arrows grow the selection, Alt+arrows step duration and pitch (Alt+Shift+↑/↓ an octave), Escape selects none, PageUp/PageDown turn pages, +/− zoom.
- ⚙ opens the score choice and the gesture thresholds: flick window, hold time, the distance over which a scrub's direction is judged, the scrub step, how far across a scrub must move to turn, the two-finger scrub step, and the octave flick's length and speed.

Fixtures: Chopin, Mazurka op. 6 no. 1 (MEI sample encodings, MEI 5.1); Beethoven, Sonatina in G,
WoO Anh. 5 no. 1 (Breitkopf encoding, from mei-friend).
