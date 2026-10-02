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
- Keyboard: arrows navigate, Shift+arrows grow the selection, Escape selects none, PageUp/PageDown turn pages, +/− zoom.
- ⚙ opens the score choice and the gesture thresholds: flick window, hold time, the distance over which a scrub's direction is judged, the scrub step, and how far across a scrub must move to turn.

Fixtures: Chopin, Mazurka op. 6 no. 1 (MEI sample encodings, MEI 5.1); Beethoven, Sonatina in G,
WoO Anh. 5 no. 1 (Breitkopf encoding, from mei-friend).
