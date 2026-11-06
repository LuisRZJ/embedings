"use strict";
/* ============================================================
   Componente reutilizable: colapsable (acordeon)
   ============================================================
   Expone window.Collapsible.

   Collapsible.set(toggle, body, collapsed, labels?)
   Collapsible.toggle(toggle, body, labels?) -> collapsed (bool)
   Collapsible.isCollapsed(toggle) -> bool

   toggle/body: selector ("#id") o elemento.
   labels: {expandLabel, collapseLabel, expandTitle, collapseTitle}
     La etiqueta indica la accion disponible:
     - Colapsado (collapsed=true)  -> expandLabel / expandTitle
     - Expandido (collapsed=false) -> collapseLabel / collapseTitle
     Si no se pasa titulo, se usa la etiqueta como titulo.
     Si no se pasan etiquetas, no se tocan titulo/aria-label.

   Sincroniza en cada cambio (identico a la implementacion original):
   - toggle[aria-expanded] = String(!collapsed)
   - body.classList "closed" si collapsed
   - body.inert presente si collapsed, ausente si no
   - toggle title + aria-label segun labels (sin tocarlos si faltan)

   El estado de negocio (p. ej. categories[i].collapsed +
   saveSettings) lo mantiene la pagina; este componente solo
   aplica el estado al DOM.
   ============================================================ */
(function () {
  function resolve(sel) {
    if (!sel) return null;
    if (typeof sel === "string") return document.querySelector(sel);
    if (sel instanceof Element) return sel;
    return null;
  }

  function set(toggleSel, bodySel, collapsed, labels) {
    var toggle = resolve(toggleSel);
    var body = resolve(bodySel);
    if (!toggle || !body) return Boolean(collapsed);
    collapsed = Boolean(collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    body.classList.toggle("closed", collapsed);
    if (collapsed) {
      body.setAttribute("inert", "");
    } else {
      body.removeAttribute("inert");
    }
    if (labels) {
      var label = collapsed ? labels.expandLabel : labels.collapseLabel;
      var title = collapsed
        ? (labels.expandTitle ?? labels.expandLabel)
        : (labels.collapseTitle ?? labels.collapseLabel);
      if (label) {
        toggle.title = title;
        toggle.setAttribute("aria-label", label);
      }
    }
    return collapsed;
  }

  function isCollapsed(toggleSel) {
    var toggle = resolve(toggleSel);
    if (!toggle) return false;
    return toggle.getAttribute("aria-expanded") !== "true";
  }

  function toggle(toggleSel, bodySel, labels) {
    return set(toggleSel, bodySel, !isCollapsed(toggleSel), labels);
  }

  window.Collapsible = {
    set: set,
    toggle: toggle,
    isCollapsed: isCollapsed
  };
})();
