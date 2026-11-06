"use strict";
/* ============================================================
   Componente reutilizable: panel de ajustes de tema
   - Lee/escribe el tema en localStorage (clave compartida)
   - Aplica las variables CSS a :root
   - Se abre con cualquier [data-open-theme] y se cierra con
     [data-close-sheet], el backdrop o Escape
   ============================================================ */
(function(){
  var LS_KEY = "embeddings-classifier-settings-v3";
  var S=[50,100,200,300,400,500,600,700,800,900,950];
  var L=[97,94,87,77,65,53,43,34,25,16,9];
  var F=[.3,.45,.65,.85,1,1,1,.95,.85,.75,.6];
  var P=[["Azul",222,85],["Índigo",252,70],["Violeta",275,65],["Rosa",330,75],["Rojo",4,75],["Naranja",24,90],["Verde",150,60],["Turquesa",176,70],["Salvia",140,14],["Grafito",220,8]];
  var th={h:220,s:8,mode:"auto"};
  var pal=[];
  var mq = window.matchMedia("(prefers-color-scheme:dark)");

  function $(s, r){ return (r||document).querySelector(s); }
  function $$(s, r){ return Array.prototype.slice.call((r||document).querySelectorAll(s)); }
  function resolvedMode(){ return th.mode==="auto" ? (mq.matches ? "dark" : "light") : th.mode; }
  function hex(h,s,l){s/=100;l/=100;var a=s*Math.min(l,1-l);
    var f=function(n){var k=(n+h/30)%12,c=l-a*Math.max(-1,Math.min(k-3,9-k,1));return Math.round(255*c).toString(16).padStart(2,"0")};
    return "#"+f(0)+f(8)+f(4)}
  function toHsl(x){var r=parseInt(x.substr(1,2),16)/255,g=parseInt(x.substr(3,2),16)/255,b=parseInt(x.substr(5,2),16)/255;
    var mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn,l=(mx+mn)/2,h=0,s=0;
    if(d){s=d/(1-Math.abs(2*l-1));
      if(mx===r)h=((g-b)/d)%6;else if(mx===g)h=(b-r)/d+2;else h=(r-g)/d+4;h*=60;if(h<0)h+=360}
    return {h:Math.round(h),s:Math.round(s*100)}}
  function lum(x){var c=[1,3,5].map(function(i){var v=parseInt(x.substr(i,2),16)/255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)});return .2126*c[0]+.7152*c[1]+.0722*c[2]}
  function ratio(a,b){var x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
  function grade(r){return r>=7?["AAA"," ok"]:r>=4.5?["AA"," ok"]:r>=3?["AA grande",""]:["No cumple",""]}
  function roles(){
    var d = resolvedMode()==="dark";
    return d
      ? {"--c-bg":pal[10],"--c-panel":pal[9],"--c-border":pal[8],"--c-muted":pal[4],"--c-text":pal[0],"--c-ctl":pal[4],"--c-ctl-t":pal[10]}
      : {"--c-bg":pal[0],"--c-panel":pal[1],"--c-border":pal[2],"--c-muted":pal[6],"--c-text":pal[10],"--c-ctl":pal[6],"--c-ctl-t":pal[0]};
  }
  function saveTheme(){
    try{
      var raw = localStorage.getItem(LS_KEY);
      var d = raw ? JSON.parse(raw) : {};
      d.theme = {h: th.h, s: th.s, mode: th.mode};
      localStorage.setItem(LS_KEY, JSON.stringify(d));
    }catch(e){}
  }
  function loadTheme(){
    try{
      var raw = localStorage.getItem(LS_KEY) || localStorage.getItem("embeddings-classifier-settings-v2");
      if(raw){
        var d = JSON.parse(raw);
        if(d.theme && typeof d.theme.h === "number"){
          th.h = d.theme.h; th.s = d.theme.s;
          th.mode = ["light","dark","auto"].includes(d.theme.mode) ? d.theme.mode : "light";
        }else if(["dark","light","auto"].includes(d.theme)){ th.mode = d.theme; }
      }
    }catch(e){}
  }
  function copyText(t, btn){
    var done=function(){ if(!btn) return; var o=btn.textContent; btn.textContent="Copiado"; setTimeout(function(){btn.textContent=o;},1200); };
    try{ navigator.clipboard.writeText(t).then(done, fallback); }catch(e){ fallback(); }
    function fallback(){ var a=document.createElement("textarea"); a.value=t; document.body.appendChild(a); a.select(); try{document.execCommand("copy"); done();}catch(e){} a.remove(); }
  }

  /* Inyecta la plantilla del componente en cada [data-theme-panel] */
  function injectTemplate(){
    var host = $("[data-theme-panel]");
    if(!host || host.querySelector("[data-sheet]")) return;
    var tpl = document.createElement("template");
    tpl.innerHTML =
      '<div class="sheet-backdrop" data-sheet-backdrop></div>' +
      '<section class="sheet" data-sheet aria-label="Ajustes de tema">' +
        '<div style="display:flex;justify-content:space-between;align-items:start;gap:10px;margin-bottom:14px">' +
          '<div><h2>Ajustes de tema</h2><p class="sub">Elige un tono y mira cómo cambia toda la página.</p></div>' +
          '<button class="btn-mini" data-close-sheet type="button" aria-label="Cerrar ajustes">✕</button>' +
        '</div>' +
        '<div class="grp"><div class="lbl">Color base</div><div class="row">' +
          '<input class="hexin" data-hex value="#2f6bff" maxlength="7" spellcheck="false" aria-label="Color base en hexadecimal">' +
          '<button class="btn-mini" data-rnd style="padding:8px 14px" type="button">Aleatorio</button>' +
        '</div></div>' +
        '<div class="grp"><label>Tono <span class="val" data-hv></span></label><input type="range" data-hue min="0" max="360" value="222"></div>' +
        '<div class="grp"><label>Saturación <span class="val" data-sv></span></label><input type="range" data-sat min="0" max="100" value="85"></div>' +
        '<div class="grp"><div class="lbl">Modo de la página</div><div class="seg" data-theme-seg>' +
          '<button type="button" data-theme-val="light" aria-pressed="true" aria-label="Claro" title="Claro"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg></button>' +
          '<button type="button" data-theme-val="dark" aria-pressed="false" aria-label="Oscuro" title="Oscuro"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg></button>' +
          '<button type="button" data-theme-val="auto" aria-pressed="false" aria-label="Automático" title="Automático"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/></svg></button>' +
        '</div><p class="hint" data-auto-hint hidden>Automático: sigue la preferencia del dispositivo (claro u oscuro).</p></div>' +
        '<div class="grp"><div class="lbl">Tonos rápidos</div><div class="tpresets" data-presets></div></div>' +
        '<div class="grp"><div class="lbl">Escala generada <span class="val">clic = copiar</span></div><div class="scale" data-scale></div><div class="steps" data-steps></div></div>' +
        '<div class="grp"><div class="lbl">Contraste (WCAG)</div><div class="checks" data-checks></div></div>' +
        '<button class="btn-main" data-copy type="button">Copiar variables CSS</button>' +
        '<button class="btn-ghost" data-reset type="button">Restablecer (Grafito)</button>' +
      '</section>';
    host.appendChild(tpl.content);
  }
  injectTemplate();

  /* Inicializa cada panel presente en la página */
  $$("[data-sheet]").forEach(function(sheet){
    var backdrop = $("[data-sheet-backdrop]", sheet.parentElement) || $("[data-sheet-backdrop]");
    var hv=$("[data-hv]",sheet), sv=$("[data-sv]",sheet), hue=$("[data-hue]",sheet), sat=$("[data-sat]",sheet),
        hexEl=$("[data-hex]",sheet), presets=$("[data-presets]",sheet), scale=$("[data-scale]",sheet),
        steps=$("[data-steps]",sheet), checks=$("[data-checks]",sheet), seg=$("[data-theme-seg]",sheet),
        autoHint=$("[data-auto-hint]",sheet), copyBtn=$("[data-copy]",sheet), resetBtn=$("[data-reset]",sheet),
        rndBtn=$("[data-rnd]",sheet), closeBtn=$("[data-close-sheet]",sheet);

    function render(){
      pal = S.map(function(_,i){ return hex(th.h, th.s*F[i], L[i]); });
      var r = roles(), root = document.documentElement;
      Object.keys(r).forEach(function(k){ root.style.setProperty(k, r[k]); });
      root.setAttribute("data-theme", resolvedMode());
      var meta = document.querySelector('meta[name="theme-color"]');
      if(!meta){ meta = document.createElement("meta"); meta.name = "theme-color"; document.head.appendChild(meta); }
      meta.setAttribute("content", r["--c-bg"]);
      if(hv) hv.textContent = th.h+"°";
      if(sv) sv.textContent = th.s+"%";
      if(hue) hue.value = th.h;
      if(sat) sat.value = th.s;
      if(hexEl) hexEl.value = pal[5];
      if(scale){
        scale.innerHTML = "";
        pal.forEach(function(c,i){
          var b = document.createElement("button"); b.type="button"; b.style.background=c;
          b.title = S[i]+" · "+c+" (clic para copiar)"; b.setAttribute("aria-label","Tono "+S[i]+": "+c);
          b.onclick = function(){ copyText(c); };
          scale.appendChild(b);
        });
      }
      if(steps) steps.innerHTML = S.map(function(n){ return "<span>"+n+"</span>"; }).join("");
      if(checks){
        var rows=[["Texto sobre fondo",r["--c-text"],r["--c-bg"]],["Texto secundario",r["--c-muted"],r["--c-bg"]],["Botón principal",r["--c-ctl-t"],r["--c-ctl"]]];
        checks.innerHTML = rows.map(function(x){ var q=ratio(x[1],x[2]), g=grade(q);
          return '<div><span>'+x[0]+'</span><span><span class="val">'+q.toFixed(1)+':1</span> <span class="badge'+g[1]+'">'+g[0]+'</span></span></div>';
        }).join("");
      }
      if(presets) $$("button", presets).forEach(function(b){ b.setAttribute("aria-pressed", String(+b.dataset.h===th.h && +b.dataset.s===th.s)); });
      if(seg) $$("button", seg).forEach(function(b){ b.setAttribute("aria-pressed", String(b.dataset.themeVal===th.mode)); });
      if(autoHint) autoHint.hidden = th.mode!=="auto";
    }

    if(presets){
      presets.innerHTML = P.map(function(p){ return '<button type="button" data-h="'+p[1]+'" data-s="'+p[2]+'" title="'+p[0]+'" aria-label="'+p[0]+'" style="background:'+hex(p[1],p[2],50)+'"></button>'; }).join("");
      presets.onclick = function(e){ var b=e.target.closest("button"); if(!b) return; th.h=+b.dataset.h; th.s=+b.dataset.s; render(); saveTheme(); };
    }
    if(hue) hue.oninput = function(){ th.h=+this.value; render(); saveTheme(); };
    if(sat) sat.oninput = function(){ th.s=+this.value; render(); saveTheme(); };
    if(hexEl) hexEl.onchange = function(){ var v=this.value.trim(); if(v[0]!=="#") v="#"+v;
      if(/^#[0-9a-f]{6}$/i.test(v)){ var c=toHsl(v); th.h=c.h; th.s=Math.min(100,c.s); } render(); saveTheme(); };
    if(rndBtn) rndBtn.onclick = function(){ th.h=Math.floor(Math.random()*360); th.s=20+Math.floor(Math.random()*75); render(); saveTheme(); };
    if(seg) seg.onclick = function(e){ var b=e.target.closest("button"); if(!b) return; th.mode=b.dataset.themeVal; render(); saveTheme(); };
    if(copyBtn) copyBtn.onclick = function(){
      var r=roles(), t=":root{\n"+S.map(function(n,i){ return "  --p-"+n+": "+pal[i]+";"; }).join("\n")+"\n"
        +Object.keys(r).map(function(k){ return "  "+k+": "+r[k]+";"; }).join("\n")+"\n}";
      copyText(t, copyBtn);
    };
    if(resetBtn) resetBtn.onclick = function(){ th.h=220; th.s=8; render(); saveTheme(); };

    function open(){ sheet.classList.add("open"); if(backdrop) backdrop.classList.add("open"); }
    function close(){ sheet.classList.remove("open"); if(backdrop) backdrop.classList.remove("open"); }
    $$("[data-open-theme]").forEach(function(b){ b.addEventListener("click", open); });
    if(closeBtn) closeBtn.addEventListener("click", close);
    if(backdrop) backdrop.addEventListener("click", close);
    document.addEventListener("keydown", function(e){
      if(e.key!=="Escape") return;
      /* Si hay un modal encima, el Escape lo atiende el modal. */
      if(document.querySelector(".modal-backdrop.open")) return;
      close();
    });

    loadTheme();
    render();
    if(mq.addEventListener) mq.addEventListener("change", function(){ if(th.mode==="auto") render(); });
  });
})();
