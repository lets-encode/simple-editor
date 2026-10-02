# Gesture spike

Throwaway prototype for trying out the touch navigation and selection gestures over a
Verovio-rendered score. It is not the editor's architecture.

```
npm install
npm run dev
```

Open the "Network" address Vite prints on a phone or tablet on the same network.

- Tap: select an element; tap empty space to select none.
- Swipe ← → ↑ ↓: move to the neighbouring element, as mei-friend's arrow keys do. Navigation stays on the current page.
- Drag: select everything inside the box. Swipes then grow that selection, and tapping a selected element removes it.
- Keyboard: arrows navigate, Shift+arrows grow the selection, Escape selects none, PageUp/PageDown turn pages, +/− zoom.
- ⚙ opens the score choice and the gesture thresholds, including the two ways of telling a swipe from a drag.

Fixtures: Chopin, Mazurka op. 6 no. 1 (MEI sample encodings, MEI 5.1); Beethoven, Sonatina in G,
WoO Anh. 5 no. 1 (Breitkopf encoding, from mei-friend).
