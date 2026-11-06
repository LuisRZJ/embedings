"use strict";
/* ============================================================
   Componente reutilizable: desplegable de modelos (autocomplete)
   ============================================================
   Expone window.ModelSelect.

   - Detecta .model-field[data-model-type] o inputs
     [data-model-type] sueltos (les inyecta lista + boton).
   - Lista automaticamente desde OpenRouter:
       embeddings -> GET /api/v1/models?output_modalities=embeddings&endpoints=/api/v1/embeddings&limit=1000&sort=most-popular
       chat       -> GET /api/v1/models?output_modalities=text&endpoints=/api/v1/chat/completions&limit=1000&sort=most-popular
     Sin API key (catalogo publico). Una peticion por tipo,
     cacheada en memoria. Sin resultados/errores, el campo
     sigue siendo de escritura libre.
   - Filtra en cliente al escribir (substring en id + nombre,
     sin acentos, insensible a mayusculas), max 50 en DOM.
   - Teclado: flechas, Enter, Escape, Tab. Raton: clic.
     Al elegir dispara input + change (la pagina guarda).
   ============================================================ */
(function () {
  var API = "https://openrouter.ai/api/v1/models";
  var MAX_ITEMS = 50;
  var cache = {}; /* type -> {status, list, promise} */

  var URLS = {
    embeddings: API + "?output_modalities=embeddings&endpoints=%2Fapi%2Fv1%2Fembeddings&limit=1000&sort=most-popular",
    chat: API + "?output_modalities=text&endpoints=%2Fapi%2Fv1%2Fchat%2Fcompletions&limit=1000&sort=most-popular"
  };

  /* Listas fijas de Google (sin peticion masiva a OpenRouter). */
  var FIXED = {
    gembeddings: [
      { id: "gemini-embedding-001", name: "Gemini Embedding" },
      { id: "gemini-embedding-2", name: "Gemini Embedding 2" }
    ],
    gchat: [
      { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash-Lite" },
      { id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash-Lite" }
    ]
  };

  function norm(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function resolve(sel) {
    if (!sel) return null;
    if (typeof sel === "string") return document.querySelector(sel);
    return sel instanceof Element ? sel : null;
  }

  function getCache(type) {
    if (!cache[type]) cache[type] = { status: "idle", list: null, promise: null };
    return cache[type];
  }

  function loadList(type) {
    var c = getCache(type);
    if (FIXED[type]) {
      c.status = "ready";
      c.list = FIXED[type];
      return Promise.resolve(c.list);
    }
    if (c.status === "ready") return Promise.resolve(c.list);
    if (c.promise) return c.promise;
    c.status = "loading";
    c.promise = fetch(URLS[type])
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (json) {
        var data = Array.isArray(json && json.data) ? json.data : [];
        c.list = data
          .filter(function (m) { return m && typeof m.id === "string" && m.id; })
          .map(function (m) { return { id: m.id, name: m.name || m.id }; });
        c.status = "ready";
        return c.list;
      })
      .catch(function (err) {
        c.status = "error";
        c.promise = null;
        /* Deja el campo libre: no se bloquea el guardado. */
        if (window.console && console.warn) {
          console.warn("[model-select] no se pudo cargar " + type + ": " + (err && err.message));
        }
        throw err;
      });
    return c.promise;
  }

  /* Escapa para innerHTML al resaltar la coincidencia. */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m];
    });
  }

  function highlight(text, query) {
    if (!query) return esc(text);
    var hay = norm(text);
    var idx = hay.indexOf(query);
    if (idx < 0) return esc(text);
    /* Remarca sobre el texto original por indice normalizado. */
    var out = "";
    var plain = String(text);
    var qlen = query.length;
    /* La longitud normalizada coincide salvo acentos compuestos;
       resaltado aproximado es suficiente y seguro. */
    out += esc(plain.slice(0, idx));
    out += "<mark>" + esc(plain.slice(idx, idx + qlen)) + "</mark>";
    out += esc(plain.slice(idx + qlen));
    return out;
  }

  function filterList(list, query) {
    var q = norm(query.trim());
    if (!q) return list;
    return list.filter(function (m) {
      return norm(m.id).indexOf(q) !== -1 || norm(m.name).indexOf(q) !== -1;
    });
  }

  function mount(input) {
    var type = input.getAttribute("data-model-type");
    if (!type || (type !== "embeddings" && type !== "chat" && type !== "gembeddings" && type !== "gchat")) return;
    if (input._modelMounted) return;
    input._modelMounted = true;

    /* Si el tipo cambia (p. ej. Zona pasa de OpenRouter a Google),
       el observador de abajo actualiza `type` y la lista. */
    if (!input._modelType) input._modelType = type;

    /* Localiza/crea lista + boton sin romper el HTML de la pagina. */
    var field = input.closest(".model-field");
    var list, toggle;
    var listId = input.id ? input.id + "-list" : "model-list-" + type;
    if (!field) {
      field = document.createElement("div");
      field.className = "model-field";
      field.setAttribute("data-model-type", type);
      input.parentNode.insertBefore(field, input);
      field.appendChild(input);
    }
    list = field.querySelector(".model-list");
    if (!list) {
      list = document.createElement("div");
      list.className = "model-list";
      list.id = listId;
      list.setAttribute("role", "listbox");
      list.setAttribute("aria-label", type === "embeddings" ? "Modelos de embeddings" : "Modelos de chat");
      list.hidden = true;
      field.appendChild(list);
    } else {
      list.id = list.id || listId;
    }
    toggle = field.querySelector(".model-toggle");
    if (!toggle) {
      toggle = document.createElement("button");
      toggle.className = "model-toggle";
      toggle.type = "button";
      toggle.tabIndex = -1;
      toggle.setAttribute("aria-label", "Ver modelos");
      toggle.setAttribute("aria-expanded", "false");
      toggle.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
      field.appendChild(toggle);
    }
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", list.id);
    input.setAttribute("aria-autocomplete", "list");

    var activeIndex = -1;
    var currentItems = [];

    function setExpanded(open) {
      list.hidden = !open;
      input.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-expanded", String(open));
    }

    function close() {
      setExpanded(false);
      activeIndex = -1;
      input.removeAttribute("aria-activedescendant");
    }

    function markActive(i) {
      var nodes = list.querySelectorAll(".model-item[data-id]");
      for (var k = 0; k < nodes.length; k++) nodes[k].classList.toggle("active", k === i);
      activeIndex = i;
      if (nodes[i]) {
        input.setAttribute("aria-activedescendant", nodes[i].id);
        if (nodes[i].scrollIntoView) nodes[i].scrollIntoView({ block: "nearest" });
      } else {
        input.removeAttribute("aria-activedescendant");
      }
    }

    function render(items, query, total) {
      list.innerHTML = "";
      currentItems = items;
      var html = "";
      if (total != null && query) {
        html += '<div class="model-count">' + items.length + " de " + total + " modelos</div>";
      }
      for (var i = 0; i < items.length; i++) {
        var m = items[i];
        var optId = list.id + "-opt-" + i;
        html += '<div class="model-item" role="option" id="' + optId
          + '" data-id="' + esc(m.id) + '" aria-selected="false">'
          + '<span class="mid">' + highlight(m.id, norm(query)) + "</span>"
          + (m.name && m.name !== m.id ? '<span class="mname">' + esc(m.name) + "</span>" : "")
          + "</div>";
      }
      if (!items.length) {
        html += '<div class="model-note" role="option" aria-disabled="true">Sin resultados para "' + esc(query) + '"</div>';
      }
      /* Siempre se puede usar un texto libre (modelos personalizados). */
      var trimmed = String(query || "").trim();
      var exact = items.some(function (m) { return m.id === trimmed; });
      if (trimmed && !exact && !items.length) {
        html += '<div class="model-item model-custom" role="option" data-id="' + esc(trimmed) + '" aria-selected="false"><span class="mid">Usar "' + esc(trimmed) + '"</span></div>';
      } else if (trimmed && !exact && items.length) {
        html += '<div class="model-item model-custom" role="option" data-id="' + esc(trimmed) + '" aria-selected="false"><span class="mid">Usar "' + esc(trimmed) + '"</span></div>';
      }
      list.innerHTML = html;
      /* Clic sin perder el foco del input. */
      var nodes = list.querySelectorAll(".model-item[data-id]");
      for (var j = 0; j < nodes.length; j++) {
        (function (node) {
          node.addEventListener("mousedown", function (e) { e.preventDefault(); select(node.getAttribute("data-id")); });
          node.addEventListener("mouseenter", function () {
            var idx = Array.prototype.indexOf.call(nodes, node);
            if (idx !== -1) markActive(idx);
          });
        })(nodes[j]);
      }
      activeIndex = -1;
      if (nodes.length) markActive(0);
    }

    function renderState(message) {
      list.innerHTML = '<div class="model-note" role="option" aria-disabled="true">' + esc(message) + "</div>";
      currentItems = [];
      activeIndex = -1;
    }

    function select(value) {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      close();
      input.focus();
    }

    function openWith(query) {
      var q = query == null ? input.value : query;
      setExpanded(true);
      var c = getCache(type);
      if (c.status === "ready") {
        var all = c.list;
        var filtered = filterList(all, q);
        render(filtered.slice(0, MAX_ITEMS), q, all.length);
      } else if (c.status === "loading") {
        renderState("Cargando modelos…");
        loadList(type).then(function () { openWith(q); }, function () { openWith(q); });
      } else {
        renderState("Cargando modelos…");
        loadList(type).then(function () { openWith(q); }, function () {
          renderState("No se pudieron cargar modelos. Escribe el ID manualmente.");
        });
      }
    }

    var debounce = null;
    input.addEventListener("input", function () {
      clearTimeout(debounce);
      debounce = setTimeout(function () {
        if (document.activeElement === input) openWith(input.value);
      }, 80);
    });
    /* Solo abre al escribir o con el boton/teclado: no en cada foco,
       para no desplegar Cargando al tabular. */
    toggle.addEventListener("click", function () {
      if (list.hidden) openWith(input.value);
      else close();
      input.focus();
    });
    input.addEventListener("keydown", function (e) {
      var nodes = list.querySelectorAll(".model-item[data-id]");
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (list.hidden) { openWith(input.value); return; }
        if (nodes.length) markActive(Math.min(activeIndex + 1, nodes.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (nodes.length) markActive(Math.max(activeIndex - 1, 0));
      } else if (e.key === "Enter") {
        if (!list.hidden && activeIndex >= 0 && nodes[activeIndex]) {
          e.preventDefault();
          select(nodes[activeIndex].getAttribute("data-id"));
        }
      } else if (e.key === "Escape") {
        close();
      } else if (e.key === "Tab") {
        close();
      }
    });
    document.addEventListener("click", function (e) {
      if (!field.contains(e.target)) close();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !list.hidden) {
        if (document.querySelector(".modal-backdrop.open")) return; /* el modal manda */
        close();
      }
    });
    /* Si la pagina cambia data-model-type (Zona pasa de OpenRouter
       a Google segun el proveedor principal), se usa la nueva lista. */
    if (window.MutationObserver) {
      var mo = new MutationObserver(function () {
        var next = input.getAttribute("data-model-type");
        if (next && next !== input._modelType) {
          input._modelType = next;
          type = next;
          if (field) field.setAttribute("data-model-type", next);
          close();
        }
      });
      mo.observe(input, { attributes: true, attributeFilter: ["data-model-type"] });
    }
  }

  function init() {
    var inputs = document.querySelectorAll("input[data-model-type]");
    for (var i = 0; i < inputs.length; i++) mount(inputs[i]);
  }

  window.ModelSelect = {
    init: init,
    _cache: cache
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
