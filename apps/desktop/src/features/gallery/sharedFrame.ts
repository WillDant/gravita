// One requestAnimationFrame loop for every canvas in the gallery: each canvas subscribes
// a draw callback; the loop runs only while someone listens.

type Draw = (t: number) => void;

const draws = new Set<Draw>();
let raf = 0;

function loop(t: number) {
  for (const draw of draws) draw(t);
  raf = draws.size ? requestAnimationFrame(loop) : 0;
}

/** Calls `draw` on every frame until the returned function is called. */
export function subscribeFrame(draw: Draw): () => void {
  draws.add(draw);
  if (!raf) raf = requestAnimationFrame(loop);
  return () => {
    draws.delete(draw);
    if (!draws.size && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
}
