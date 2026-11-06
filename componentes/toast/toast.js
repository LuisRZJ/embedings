"use strict";
/* ============================================================
   Componente reutilizable: notificaciones toast
   ============================================================
   Expone window.Toast y, por compatibilidad, showToast().

   Toast.show(msg, detail, type) — type: "ok" | "error" (defecto)
   showToast(msg, detail, type)  — alias idéntico (firma original
     de zona-pruebas.html, sin cambios en los call sites).

   Comportamiento idéntico al original:
   - icono "✓" si type === "ok", "!" en cualquier otro caso
   - msg/detail se asignan con textContent (sin inyección HTML)
   - botón "Cerrar" descarta; auto-descarta a los 6500 ms
   - caída animada con .in (requestAnimationFrame + 220 ms)

   El contenedor se reutiliza si existe ([data-toast-root], .toasts
   o #toasts) y, si no existe, se crea uno y se añade al <body>.
   Así una página sin contenedor (p. ej. index.html) puede usar
   showToast sin marcar nada en el HTML.
   ============================================================ */
(function () {
  function root() {
    var box = document.querySelector("[data-toast-root]")
      || document.querySelector(".toasts")
      || document.getElementById("toasts");
    if (box) {
      box.classList.add("toasts");
      if (!box.hasAttribute("role")) box.setAttribute("role", "status");
      if (!box.hasAttribute("aria-live")) box.setAttribute("aria-live", "polite");
      return box;
    }
    box = document.createElement("div");
    box.className = "toasts";
    box.setAttribute("role", "status");
    box.setAttribute("aria-live", "polite");
    document.body.appendChild(box);
    return box;
  }

  function show(msg, detail, type) {
    var kind = type === "ok" ? "ok" : "error";
    var box = root();
    if (!box) return;
    var t = document.createElement("div");
    t.className = "toast" + (kind === "ok" ? " ok" : "");
    t.innerHTML = '<span class="ic">'
      + (kind === "ok" ? "✓" : "!")
      + '</span><span class="msg"><b></b><span class="detail"></span></span>'
      + '<button class="x" type="button" aria-label="Cerrar">✕</button>';
    t.querySelector("b").textContent = msg;
    t.querySelector(".detail").textContent = detail || "";
    var dismiss = function () {
      t.classList.remove("in");
      setTimeout(function () { t.remove(); }, 220);
    };
    t.querySelector(".x").addEventListener("click", dismiss);
    box.appendChild(t);
    requestAnimationFrame(function () { t.classList.add("in"); });
    setTimeout(dismiss, 6500);
  }

  window.Toast = { show: show };
  window.showToast = show;
})();
