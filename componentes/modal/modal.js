"use strict";
/* ============================================================
   Componente reutilizable: modal (backdrop + diálogo)
   ============================================================
   Expone window.Modal y, por compatibilidad, openModal/closeModal.

   Modal.open(sel, {focus})      — añade .open (focus opcional)
   Modal.close(sel)             — quita .open
   Modal.isOpen(sel)            — boolean
   Modal.closeAll()             — cierra todos los modales abiertos
   Modal.attach(sel, {onCancel})— registra qué hacer en backdrop/Escape

   El clic en el backdrop (target === backdrop) y la tecla Escape
   se atienden de forma centralizada: si el modal tiene onCancel lo
   invocan (y él decide cerrar), si no cierran directamente.
   Solo actúa sobre modales con .open; si hay varios, Escape cierra
   el último (el de arriba).

   Los modales nacen con `hidden` en el HTML para que nunca queden
   visibles en flujo si el CSS externo falla o aún está cargando.
   open() lo retira, close()/closeAll() lo reponen. ============================================================ */
(function () {
  function resolve(sel) {
    if (!sel) return null;
    if (typeof sel === "string") return document.querySelector(sel);
    if (sel instanceof Element) return sel;
    return null;
  }

  function open(sel, opts) {
    var el = resolve(sel);
    if (!el) return;
    el.hidden = false;
    el.classList.add("open");
    if (opts && opts.focus) {
      var f = typeof opts.focus === "string"
        ? el.querySelector(opts.focus)
        : opts.focus;
      if (f && typeof f.focus === "function") f.focus();
    }
  }

  function close(sel) {
    var el = resolve(sel);
    if (!el) return;
    el.classList.remove("open");
    el.hidden = true;
  }

  function isOpen(sel) {
    var el = resolve(sel);
    return !!(el && !el.hidden && el.classList.contains("open"));
  }

  function closeAll() {
    var list = document.querySelectorAll(".modal-backdrop.open");
    for (var i = 0; i < list.length; i++) {
      list[i].classList.remove("open");
      list[i].hidden = true;
    }
  }

  function requestClose(el) {
    if (!el) return;
    var opts = el._modalOpts || null;
    if (opts && typeof opts.onCancel === "function") {
      opts.onCancel();
    } else {
      close(el);
    }
  }

  function attach(sel, opts) {
    var el = resolve(sel);
    if (!el) return;
    /* No pisar un onCancel ya registrado con un attach() sin opciones
       (p. ej. el auto-cableado de wireExisting tras Modal.attach). */
    if (opts) {
      el._modalOpts = opts;
    } else if (!el._modalOpts) {
      el._modalOpts = {};
    }
    /* Backdrop: un solo listener por modal, registrado una vez. */
    if (!el._modalWired) {
      el._modalWired = true;
      el.addEventListener("click", function (e) {
        if (e.target === el) requestClose(el);
      });
    }
  }

  /* Auto-cablea modales presentes al cargar para que Escape/backdrop
     funcionen aunque no se haya llamado a attach antes de abrirlos. */
  function wireExisting() {
    var list = document.querySelectorAll(".modal-backdrop");
    for (var i = 0; i < list.length; i++) attach(list[i]);
  }

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    var open = document.querySelectorAll(".modal-backdrop.open");
    if (!open.length) return;
    requestClose(open[open.length - 1]);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireExisting);
  } else {
    wireExisting();
  }

  window.Modal = {
    open: open,
    close: close,
    isOpen: isOpen,
    closeAll: closeAll,
    attach: attach
  };

  /* Compatibilidad con la API anterior de zona-pruebas.html */
  window.openModal = open;
  window.closeModal = close;
})();
