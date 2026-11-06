"use strict";
/* ============================================================
   Componente reutilizable: navegacion con transicion moderna
   ============================================================
   Sin HTML necesario: intercepta clics en <a href="...html">
   internos y aplica:

   - Si hay View Transitions API y no es file://:
     persiste el origen en sessionStorage, luego
     document.startViewTransition(() => location = url)
     con clip-path circular desde el clic. La pagina destino
     lee el origen en <head> (navegacion-boot.js) antes del
     primer paint, asi el clip no salta del punto de clic
     al centro.

   - Si no: velo circular del color del tema (CSS clip-path)
     que cubre, navega y revela. El origen se persiste en
     sessionStorage; en destino, navegacion-boot.js marca
     html.nav-covering para cubrir ANTES del primer paint
     (sin parpadeo) y aqui se revela en circulo.

   No intercepta: enlaces externos, target=_blank, download,
   #anclas, clic medio / Ctrl / Cmd / Shift / Alt, ni cuando
   hay prefers-reduced-motion. En bfcache (back/forward) el
   velo se oculta.

   Uso:
     <link href="componentes/navegacion/navegacion.css">
     <script src="componentes/navegacion/navegacion-boot.js"></script>
     <div class="nav-veil" aria-hidden="true"></div>
     <script src="componentes/navegacion/navegacion.js"></script>
   ============================================================ */
(function () {
  var STORAGE_KEY = "navegacion-transicion";
  var veil = null;
  var veilTimer = null;

  function reducedMotion() {
    return !!(window.matchMedia
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function supportsViewTransition() {
    return (
      window.location.protocol !== "file:"
      && typeof document.startViewTransition === "function"
    );
  }

  /* Enlaces internos a paginas .html del proyecto. */
  function internalTarget(a) {
    if (!a) return null;
    if (a.target === "_blank") return null;
    if (a.hasAttribute("download")) return null;
    var href = a.getAttribute("href");
    if (!href) return null;
    href = href.trim();
    if (!href || href[0] === "#") return null;
    if (/^([a-z][a-z0-9+.-]*:)?\/\//i.test(href)) return null; // http(s):// o //
    if (/^(mailto|tel|data|javascript):/i.test(href)) return null;
    if (/\.html($|[?#])/i.test(href)) return href;
    return null;
  }

  function getVeil() {
    if (veil && veil.isConnected) return veil;
    veil = document.querySelector(".nav-veil");
    if (!veil) {
      veil = document.createElement("div");
      veil.className = "nav-veil";
      veil.setAttribute("aria-hidden", "true");
      veil.innerHTML = '<span class="nav-veil-icon"><svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#161616"/><g fill="#8f8f8a"><circle cx="19" cy="22" r="5"/><circle cx="28" cy="36" r="5"/><circle cx="18" cy="47" r="5"/></g><g fill="#f4f4f1"><circle cx="46" cy="24" r="5"/><circle cx="41" cy="40" r="5"/><circle cx="50" cy="49" r="5"/></g></svg></span>';
      document.body.appendChild(veil);
    }
    return veil;
  }

  function setOrigin(x, y) {
    var root = document.documentElement;
    root.style.setProperty("--nav-x", Math.round(x) + "px");
    root.style.setProperty("--nav-y", Math.round(y) + "px");
  }

  function persistOrigin(x, y) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ x: x, y: y }));
    } catch (e) { }
  }

  function clearVeil() {
    if (!veil) return;
    veil.classList.remove("cover", "reveal");
    veil.style.visibility = "hidden";
    window.__navRevealed = true;
    document.documentElement.classList.remove("nav-covering");
  }

  /* Revela el velo que ya cubre (fallback).
     html.nav-covering ya lo dejo cubierto sin transicion. */
  function revealSoon() {
    var el = getVeil();
    /* Forzar reflow para registrar el estado cubriendo. */
    void el.offsetWidth;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        document.documentElement.classList.remove("nav-covering");
        el.classList.remove("cover");
        el.classList.add("reveal");
        veilTimer = setTimeout(clearVeil, 460);
        el.addEventListener("transitionend", function done() {
          el.removeEventListener("transitionend", done);
          clearVeil();
        }, { once: true });
      });
    });
  }

  /* Entrada: lee el origen persistido (ya aplicado en <head>). */
  function incoming() {
    window.__navRevealed = true;
    var raw;
    try {
      raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) sessionStorage.removeItem(STORAGE_KEY);
    } catch (e) { }
    var hadCover = document.documentElement.classList.contains("nav-covering");
    if (!raw) {
      document.documentElement.classList.remove("nav-covering");
      return;
    }
    var pos;
    try { pos = JSON.parse(raw); } catch (e) { pos = null; }
    if (!pos || reducedMotion()) {
      document.documentElement.classList.remove("nav-covering");
      clearVeil();
      return;
    }
    var x = typeof pos.x === "number" ? pos.x : window.innerWidth / 2;
    var y = typeof pos.y === "number" ? pos.y : window.innerHeight / 2;
    setOrigin(x, y);
    /* Con VT, el snapshot sirve de cubierta: sin velo. */
    if (supportsViewTransition()) {
      document.documentElement.classList.remove("nav-covering");
      clearVeil();
      return;
    }
    /* Respaldo: velo ya cubre desde el paint (nav-covering).
       Si el boot no marco (p. ej. scripts reordenados), al menos
       cubrir aqui antes de revelar. */
    var el = getVeil();
    if (!hadCover) {
      el.classList.add("cover");
      el.style.visibility = "visible";
      void el.offsetWidth;
    }
    revealSoon();
  }

  function fallbackNavigate(href, x, y) {
    var el = getVeil();
    setOrigin(x, y);
    persistOrigin(x, y);
    el.classList.remove("reveal");
    el.classList.add("cover");
    el.style.visibility = "visible";
    setTimeout(function () {
      window.location.href = href;
    }, 450);
  }

  document.addEventListener("click", function (e) {
    if (reducedMotion()) return;
    if (e.defaultPrevented) return;
    /* Clic medio o con modificadores: comportamiento nativo. */
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    var href = a && internalTarget(a);
    if (!href) return;
    /* Punto de origen: clic o centro del enlace (teclado). */
    var x = e.clientX, y = e.clientY;
    if (!x && !y) {
      var r = a.getBoundingClientRect();
      x = r.left + r.width / 2;
      y = r.top + r.height / 2;
      if (!x && !y) { x = window.innerWidth / 2; y = window.innerHeight / 2; }
    }
    setOrigin(x, y);
    if (supportsViewTransition()) {
      e.preventDefault();
      /* Para que el clip tenga el origen correcto en la pagina
         destino (vars no persisten entre documentos). */
      persistOrigin(x, y);
      var url = a.href;
      try {
        document.startViewTransition(function () {
          window.location.href = url;
        });
      } catch (err) {
        fallbackNavigate(url, x, y);
      }
    } else {
      e.preventDefault();
      fallbackNavigate(a.href, x, y);
    }
  });

  /* Volver/adelante (bfcache): sin velo colgado. */
  window.addEventListener("pageshow", function (e) {
    if (e.persisted) {
      if (veilTimer) clearTimeout(veilTimer);
      document.documentElement.classList.remove("nav-covering");
      clearVeil();
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", incoming);
  } else {
    incoming();
  }
})();
