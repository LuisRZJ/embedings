"use strict";
/* ============================================================
   Arranque temprano de navegacion (head, sin defer).
   Lee el origen persistido por navegacion.js ANTES del primer
   paint para que:
   - el clip circular tenga el origen correcto (VT o velo)
   - el velo ya arranque cubriendo (fallback file:// / sin VT)
     sin parpadeo, via html.nav-covering

   No borra la clave: lo hace navegacion.js al revelar.
   ============================================================ */
(function () {
  try {
    var raw = sessionStorage.getItem("navegacion-transicion");
    if (!raw) return;
    var p;
    try { p = JSON.parse(raw); } catch (e) { p = null; }
    if (!p) return;
    var r = document.documentElement;
    if (typeof p.x === "number") r.style.setProperty("--nav-x", Math.round(p.x) + "px");
    if (typeof p.y === "number") r.style.setProperty("--nav-y", Math.round(p.y) + "px");
    var isFile = window.location.protocol === "file:";
    var hasVT = typeof document.startViewTransition === "function";
    /* Solo el respaldo necesita velo cubriendo desde el paint. */
    if (isFile || !hasVT) {
      r.classList.add("nav-covering");
      /* Si navegacion.js no llega (404/cache), no dejar el velo colgado. */
      setTimeout(function () {
        if (!window.__navRevealed) {
          document.documentElement.classList.remove("nav-covering");
          var v = document.querySelector(".nav-veil");
          if (v) { v.classList.remove("cover", "reveal"); v.style.visibility = "hidden"; }
        }
      }, 3000);
    }
  } catch (e) { }
})();
