"use strict";
/* ============================================================
   Componente: Sincronización y Respaldo de Perfil con GitHub
   Soporte dual: Modo Vercel (seguro con contraseña) y Modo Local.
   Incluye respaldo automático con acumulación (debounce) y notificación visual.
   ============================================================ */
(function (global) {
  var LS_KEY = "embeddings-classifier-settings-v3";
  var SS_PASS_KEY = "gh-auth-session-pass";
  var BACKUP_FILE_PATH = "backup/clasificador-data.json";
  var DEFAULT_BRANCH = "main";

  function utf8ToBase64(str) {
    return window.btoa(unescape(encodeURIComponent(str)));
  }

  function base64ToUtf8(b64) {
    return decodeURIComponent(escape(window.atob(b64.replace(/\s/g, ""))));
  }

  function cleanRepo(str) {
    if (!str) return "";
    return str.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/^\/+|\/+$/g, "");
  }

  /* Píldora visual de cuenta regresiva (inyectada en DOM si no existe) */
  function ensurePill() {
    var pill = document.getElementById("syncCountdownPill");
    if (!pill) {
      pill = document.createElement("div");
      pill.id = "syncCountdownPill";
      pill.className = "sync-countdown-pill hidden";
      pill.setAttribute("aria-live", "polite");
      pill.innerHTML = '<span class="pill-icon">☁</span><span class="pill-text"></span>';
      document.body.appendChild(pill);
    }
    return pill;
  }

  /* API GitHub directa para modo local */
  var GitHub = {
    async getUser(token) {
      var res = await fetch("https://api.github.com/user", {
        headers: {
          "Authorization": "Bearer " + token,
          "Accept": "application/vnd.github+json"
        }
      });
      if (!res.ok) {
        var err = await res.json().catch(function () { return {}; });
        throw new Error(err.message || ("Error " + res.status + " de autenticación en GitHub"));
      }
      return await res.json();
    },

    async getFile(token, repo, branch, path) {
      var filePath = path || BACKUP_FILE_PATH;
      var url = "https://api.github.com/repos/" + repo + "/contents/" + filePath + "?ref=" + encodeURIComponent(branch || DEFAULT_BRANCH);
      var res = await fetch(url, {
        headers: {
          "Authorization": "Bearer " + token,
          "Accept": "application/vnd.github+json"
        }
      });
      if (res.status === 404) return null;
      if (!res.ok) {
        var err = await res.json().catch(function () { return {}; });
        throw new Error(err.message || ("Error " + res.status + " al consultar repositorio"));
      }
      var data = await res.json();
      var text = base64ToUtf8(data.content || "");
      var content = JSON.parse(text);
      return { sha: data.sha, content: content };
    },

    async putFile(token, repo, branch, path, payload, sha, message) {
      var filePath = path || BACKUP_FILE_PATH;
      var url = "https://api.github.com/repos/" + repo + "/contents/" + filePath;
      var body = {
        message: message || "Respaldo clasificador semántico",
        content: utf8ToBase64(JSON.stringify(payload, null, 2)),
        branch: branch || DEFAULT_BRANCH
      };
      if (sha) body.sha = sha;

      var res = await fetch(url, {
        method: "PUT",
        headers: {
          "Authorization": "Bearer " + token,
          "Accept": "application/vnd.github+json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        var err = await res.json().catch(function () { return {}; });
        throw new Error(err.message || ("Error " + res.status + " al guardar archivo en GitHub"));
      }
      var resData = await res.json();
      return resData.content ? resData.content.sha : null;
    }
  };

  /* API Proxy Serverless de Vercel */
  var VercelAPI = {
    async checkStatus() {
      try {
        var res = await fetch("/api/sync?action=status");
        if (!res.ok) return null;
        var data = await res.json();
        return data.isVercel ? data : null;
      } catch (e) {
        return null;
      }
    },

    async request(password, action, extra) {
      var body = Object.assign({ password: password, action: action }, extra || {});
      var res = await fetch("/api/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        throw new Error(data.error || ("Error " + res.status + " en el servidor de Vercel"));
      }
      return data;
    }
  };

  /* Lógica de Fusión y Restauración */
  function buildPayload() {
    var raw = localStorage.getItem(LS_KEY);
    var local = raw ? JSON.parse(raw) : {};
    var now = new Date().toISOString();

    return {
      $schemaVersion: 1,
      updatedAt: local.updatedAt || now,
      exportedAt: now,
      client: "Clasificador Semántico",
      settings: {
        primaryProvider: local.primaryProvider || "openrouter",
        model: local.model || "",
        genModel: local.genModel || "",
        googleModel: local.googleModel || "",
        googleGenModel: local.googleGenModel || "",
        dimensions: local.dimensions || "",
        mode: local.mode || "single",
        inputType: local.inputType || "text",
        autoBackup: !!local.autoBackup
      },
      apiKeys: {
        included: true,
        key: local.key || "",
        googleKey: local.googleKey || ""
      },
      categories: Array.isArray(local.categories) ? local.categories : []
    };
  }

  function smartMerge(localData, remoteData) {
    var local = localData || {};
    var remoteSettings = (remoteData && remoteData.settings) || {};
    var remoteCategories = (remoteData && remoteData.categories) || [];
    var remoteKeys = (remoteData && remoteData.apiKeys) || {};

    var catMap = new Map();

    (local.categories || []).forEach(function (c) {
      if (c && c.name) {
        catMap.set(c.name.trim().toLowerCase(), Object.assign({}, c));
      }
    });

    remoteCategories.forEach(function (rc) {
      if (!rc || !rc.name) return;
      var key = rc.name.trim().toLowerCase();
      if (catMap.has(key)) {
        var existing = catMap.get(key);
        var rProto = (rc.proto || "").trim();
        var lProto = (existing.proto || "").trim();
        if (rProto.length > lProto.length || (rc.updatedAt && (!existing.updatedAt || rc.updatedAt > existing.updatedAt))) {
          existing.proto = rc.proto;
        }
      } else {
        catMap.set(key, Object.assign({}, rc));
      }
    });

    var merged = Object.assign({}, local);
    merged.categories = Array.from(catMap.values());

    if (remoteSettings.primaryProvider) merged.primaryProvider = remoteSettings.primaryProvider;
    if (remoteSettings.model) merged.model = remoteSettings.model;
    if (remoteSettings.genModel) merged.genModel = remoteSettings.genModel;
    if (remoteSettings.googleModel) merged.googleModel = remoteSettings.googleModel;
    if (remoteSettings.googleGenModel) merged.googleGenModel = remoteSettings.googleGenModel;
    if (remoteSettings.dimensions) merged.dimensions = remoteSettings.dimensions;
    if (remoteSettings.mode) merged.mode = remoteSettings.mode;
    if (remoteSettings.inputType) merged.inputType = remoteSettings.inputType;
    if (remoteSettings.autoBackup !== undefined) merged.autoBackup = !!remoteSettings.autoBackup;

    if (remoteKeys.included) {
      if (remoteKeys.key) merged.key = remoteKeys.key;
      if (remoteKeys.googleKey) merged.googleKey = remoteKeys.googleKey;
    }

    merged.updatedAt = new Date().toISOString();
    return merged;
  }

  function forceRestore(localData, remoteData) {
    var local = localData || {};
    var remoteSettings = remoteData.settings || {};
    var remoteCategories = remoteData.categories || [];
    var remoteKeys = remoteData.apiKeys || {};

    var restored = Object.assign({}, local);
    restored.categories = remoteCategories;

    if (remoteSettings.primaryProvider) restored.primaryProvider = remoteSettings.primaryProvider;
    restored.model = remoteSettings.model || "";
    restored.genModel = remoteSettings.genModel || "";
    restored.googleModel = remoteSettings.googleModel || "";
    restored.googleGenModel = remoteSettings.googleGenModel || "";
    restored.dimensions = remoteSettings.dimensions || "";
    restored.mode = remoteSettings.mode || "single";
    restored.inputType = remoteSettings.inputType || "text";
    if (remoteSettings.autoBackup !== undefined) restored.autoBackup = !!remoteSettings.autoBackup;

    if (remoteKeys.included) {
      restored.key = remoteKeys.key || "";
      restored.googleKey = remoteKeys.googleKey || "";
    }

    restored.updatedAt = remoteData.updatedAt || new Date().toISOString();
    return restored;
  }

  /* Controlador UI */
  function PerfilSyncController(opts) {
    this.opts = opts || {};
    this.isVercel = false;
    this.vercelConfig = null;
    this.autoBackup = false;

    this.tokenInput = document.getElementById("ghToken");
    this.repoInput = document.getElementById("ghRepo");
    this.branchInput = document.getElementById("ghBranch");

    this.passwordGroup = document.getElementById("ghPasswordGroup");
    this.passwordInput = document.getElementById("ghAuthPassword");
    this.togglePasswordBtn = document.getElementById("toggleGhPassword");
    this.envNotice = document.getElementById("ghEnvNotice");
    this.autoBackupSwitch = document.getElementById("ghAutoBackupSwitch");

    this.profileCard = document.getElementById("ghProfileBadge");
    this.avatarImg = document.getElementById("ghAvatar");
    this.nameSpan = document.getElementById("ghName");
    this.loginLink = document.getElementById("ghLogin");
    this.statusBadge = document.getElementById("ghStatusBadge");
    this.statusBox = document.getElementById("ghStatusBox");
    this.statusDesc = document.getElementById("ghStatusDesc");
    this.datesBox = document.getElementById("ghDates");

    this.btnTest = document.getElementById("ghBtnTest");
    this.btnBackup = document.getElementById("ghBtnBackup");
    this.btnCheck = document.getElementById("ghBtnCheck");
    this.btnMerge = document.getElementById("ghBtnMerge");
    this.btnRestore = document.getElementById("ghBtnRestore");

    this.currentSha = null;
    this.remoteBackup = null;

    this.autoBackupTimer = null;
    this.autoBackupInterval = null;
    this.isUploading = false;

    this.init();
  }

  PerfilSyncController.prototype.init = async function () {
    var self = this;
    global.PerfilSync._activeInstance = this;
    this.loadConfig();

    if (this.autoBackupSwitch) {
      this.autoBackupSwitch.checked = this.autoBackup;
      this.autoBackupSwitch.addEventListener("change", function () {
        self.setAutoBackup(self.autoBackupSwitch.checked);
      });
    }

    window.addEventListener("beforeunload", function (e) {
      if (self.isUploading) {
        e.preventDefault();
        e.returnValue = "";
        return "";
      }
    });

    if (this.togglePasswordBtn && this.passwordInput) {
      this.togglePasswordBtn.addEventListener("click", function () {
        var isPw = self.passwordInput.type === "password";
        self.passwordInput.type = isPw ? "text" : "password";
        self.togglePasswordBtn.textContent = isPw ? "Ocultar" : "Mostrar";
      });
    }

    if (this.passwordInput) {
      var savedPass = sessionStorage.getItem(SS_PASS_KEY) || "";
      if (savedPass) this.passwordInput.value = savedPass;
      this.passwordInput.addEventListener("input", function () {
        sessionStorage.setItem(SS_PASS_KEY, self.passwordInput.value.trim());
      });
    }

    if (this.btnTest) this.btnTest.addEventListener("click", function () { self.testConnection(true); });
    if (this.btnBackup) this.btnBackup.addEventListener("click", function () { self.backupToGitHub(); });
    if (this.btnCheck) this.btnCheck.addEventListener("click", function () { self.checkRemoteStatus(true); });
    if (this.btnMerge) this.btnMerge.addEventListener("click", function () { self.executeMerge(); });
    if (this.btnRestore) this.btnRestore.addEventListener("click", function () { self.promptRestore(); });

    var saveDebounced = function () { self.saveConfig(); };
    if (this.tokenInput) this.tokenInput.addEventListener("input", saveDebounced);
    if (this.repoInput) this.repoInput.addEventListener("input", saveDebounced);
    if (this.branchInput) this.branchInput.addEventListener("input", saveDebounced);

    /* Detección de entorno Vercel */
    var status = await VercelAPI.checkStatus();
    if (status && status.isVercel) {
      this.isVercel = true;
      this.vercelConfig = status;
      this.applyVercelMode(status);
    } else {
      this.isVercel = false;
      if (this.tokenInput && this.tokenInput.value.trim() && this.repoInput && this.repoInput.value.trim()) {
        setTimeout(function () {
          self.testConnection(false);
        }, 350);
      }
    }
  };

  PerfilSyncController.prototype.setAutoBackup = function (enabled) {
    this.autoBackup = !!enabled;
    if (this.autoBackupSwitch) this.autoBackupSwitch.checked = this.autoBackup;
    try {
      var raw = localStorage.getItem(LS_KEY);
      var d = raw ? JSON.parse(raw) : {};
      d.autoBackup = this.autoBackup;
      localStorage.setItem(LS_KEY, JSON.stringify(d));
    } catch (e) { }

    if (global.showToast) {
      global.showToast(
        this.autoBackup ? "Respaldo automático activado" : "Respaldo automático desactivado",
        this.autoBackup ? "Guardará automáticamente en la nube tras 3 segundos de inactividad." : "Los respaldos volverán a ser únicamente manuales.",
        "ok"
      );
    }
  };

  PerfilSyncController.prototype.scheduleAutoBackup = function () {
    var self = this;
    if (!this.autoBackup) return;

    // Verificar si hay credenciales disponibles
    if (this.isVercel) {
      var pass = this.getPassword();
      if (!pass) return; // Si no hay contraseña ingresada, omitir auto-respaldo
    } else {
      var token = this.tokenInput ? this.tokenInput.value.trim() : "";
      var repo = this.repoInput ? cleanRepo(this.repoInput.value) : "";
      if (!token || !repo) {
        try {
          var raw = localStorage.getItem(LS_KEY);
          var d = raw ? JSON.parse(raw) : {};
          var gh = d.githubSync || {};
          if (!gh.token || !gh.repo) return;
        } catch (e) { return; }
      }
    }

    clearTimeout(this.autoBackupTimer);
    clearInterval(this.autoBackupInterval);

    var pill = ensurePill();
    var pillText = pill.querySelector(".pill-text");
    var pillIcon = pill.querySelector(".pill-icon");

    pill.className = "sync-countdown-pill";
    pillIcon.textContent = "☁";
    var secondsLeft = 3;
    pillText.textContent = "Guardando en la nube en " + secondsLeft + "s...";

    this.autoBackupInterval = setInterval(function () {
      secondsLeft--;
      if (secondsLeft > 0) {
        pillText.textContent = "Guardando en la nube en " + secondsLeft + "s...";
      } else {
        clearInterval(self.autoBackupInterval);
      }
    }, 1000);

    this.autoBackupTimer = setTimeout(async function () {
      clearInterval(self.autoBackupInterval);
      pill.className = "sync-countdown-pill syncing";
      pillIcon.textContent = "↻";
      pillText.textContent = "Subiendo respaldo a la nube...";

      try {
        self.isUploading = true;
        await self.backupToGitHub(true /* isAutoBackup */);
        pill.className = "sync-countdown-pill ok";
        pillIcon.textContent = "✓";
        pillText.textContent = "Guardado en la nube";
        setTimeout(function () {
          pill.classList.add("hidden");
        }, 2200);
      } catch (err) {
        pill.className = "sync-countdown-pill err";
        pillIcon.textContent = "✕";
        pillText.textContent = "Error al respaldar";
        setTimeout(function () {
          pill.classList.add("hidden");
        }, 3200);
      } finally {
        self.isUploading = false;
      }
    }, 3000);
  };

  PerfilSyncController.prototype.applyVercelMode = function (status) {
    if (this.envNotice) this.envNotice.hidden = false;
    if (this.passwordGroup) this.passwordGroup.hidden = false;

    if (this.tokenInput) {
      this.tokenInput.value = "";
      this.tokenInput.placeholder = "[Protegido en Vercel mediante GITHUB_TOKEN]";
      this.tokenInput.disabled = true;
      this.tokenInput.classList.add("sync-locked-field");
    }

    var toggleTokenBtn = document.getElementById("toggleGhToken");
    var copyTokenBtn = document.getElementById("copyGhToken");
    if (toggleTokenBtn) toggleTokenBtn.disabled = true;
    if (copyTokenBtn) copyTokenBtn.disabled = true;

    if (this.repoInput) {
      if (status.repo) this.repoInput.value = status.repo;
      this.repoInput.disabled = true;
      this.repoInput.classList.add("sync-locked-field");
    }

    if (this.branchInput) {
      if (status.branch) this.branchInput.value = status.branch;
      this.branchInput.disabled = true;
      this.branchInput.classList.add("sync-locked-field");
    }

    if (status.user) {
      if (this.profileCard) this.profileCard.hidden = false;
      if (this.avatarImg) this.avatarImg.src = status.user.avatar_url;
      if (this.nameSpan) this.nameSpan.textContent = status.user.name || status.user.login;
      if (this.loginLink) {
        this.loginLink.textContent = "@" + status.user.login;
        this.loginLink.href = status.user.html_url;
      }
    }

    if (this.statusBadge) {
      this.statusBadge.className = "sync-badge-status ok";
      this.statusBadge.textContent = "Modo Vercel";
    }

    if (this.statusDesc) {
      this.statusDesc.textContent = "Variables de entorno activas en Vercel. Ingresa tu contraseña para sincronizar.";
    }

    var savedPass = this.getPassword();
    if (savedPass) {
      this.checkRemoteStatus(false);
    }
  };

  PerfilSyncController.prototype.getPassword = function () {
    if (this.passwordInput && this.passwordInput.value.trim()) {
      return this.passwordInput.value.trim();
    }
    return sessionStorage.getItem(SS_PASS_KEY) || "";
  };

  PerfilSyncController.prototype.loadConfig = function () {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      var gh = d.githubSync || {};
      if (this.tokenInput && gh.token) this.tokenInput.value = gh.token;
      if (this.repoInput && gh.repo) this.repoInput.value = gh.repo;
      if (this.branchInput && gh.branch) this.branchInput.value = gh.branch;
      this.autoBackup = d ? !!d.autoBackup : false;
      if (this.autoBackupSwitch) this.autoBackupSwitch.checked = this.autoBackup;
    } catch (e) { }
  };

  PerfilSyncController.prototype.saveConfig = function () {
    try {
      var raw = localStorage.getItem(LS_KEY);
      var d = raw ? JSON.parse(raw) : {};
      d.autoBackup = this.autoBackup;
      if (!this.isVercel) {
        d.githubSync = {
          token: this.tokenInput ? this.tokenInput.value.trim() : "",
          repo: this.repoInput ? cleanRepo(this.repoInput.value) : "",
          branch: this.branchInput ? (this.branchInput.value.trim() || DEFAULT_BRANCH) : DEFAULT_BRANCH,
          path: BACKUP_FILE_PATH
        };
      }
      localStorage.setItem(LS_KEY, JSON.stringify(d));
    } catch (e) { }
  };

  PerfilSyncController.prototype.testConnection = async function (verbose) {
    if (this.isVercel) {
      var password = this.getPassword();
      if (!password) {
        if (this.passwordInput) this.passwordInput.focus();
        if (verbose && global.showToast) global.showToast("Contraseña requerida", "Ingresa tu contraseña para acceder al repositorio en Vercel.");
        return;
      }

      try {
        if (this.statusBadge) {
          this.statusBadge.className = "sync-badge-status idle";
          this.statusBadge.textContent = "Conectando...";
        }

        var res = await VercelAPI.request(password, "get_user");
        sessionStorage.setItem(SS_PASS_KEY, password);

        if (this.profileCard) this.profileCard.hidden = false;
        if (this.avatarImg) this.avatarImg.src = res.avatar_url;
        if (this.nameSpan) this.nameSpan.textContent = res.name || res.login;
        if (this.loginLink) {
          this.loginLink.textContent = "@" + res.login;
          this.loginLink.href = res.html_url;
        }

        if (this.statusBadge) {
          this.statusBadge.className = "sync-badge-status ok";
          this.statusBadge.textContent = "Conectado";
        }

        if (verbose && global.showToast) {
          global.showToast("Autenticado", "Conexión autorizada como @" + res.login, "ok");
        }

        await this.checkRemoteStatus(false);
      } catch (err) {
        if (this.statusBadge) {
          this.statusBadge.className = "sync-badge-status warn";
          this.statusBadge.textContent = "Error de acceso";
        }
        if (verbose && global.showToast) {
          global.showToast("Acceso denegado", err.message || "Verifica tu contraseña.");
        }
      }
      return;
    }

    // Modo Local
    var token = this.tokenInput ? this.tokenInput.value.trim() : "";
    var repo = this.repoInput ? cleanRepo(this.repoInput.value) : "";
    if (!token) {
      try {
        var raw = localStorage.getItem(LS_KEY);
        var d = raw ? JSON.parse(raw) : {};
        var gh = d.githubSync || {};
        token = gh.token || "";
        repo = gh.repo || "";
      } catch (e) { }
    }

    if (!token) {
      if (verbose && global.showToast) global.showToast("Token requerido", "Ingresa un Personal Access Token de GitHub.");
      return;
    }

    try {
      if (this.statusBadge) {
        this.statusBadge.className = "sync-badge-status idle";
        this.statusBadge.textContent = "Conectando...";
      }

      var user = await GitHub.getUser(token);
      if (this.profileCard) this.profileCard.hidden = false;
      if (this.avatarImg) this.avatarImg.src = user.avatar_url;
      if (this.nameSpan) this.nameSpan.textContent = user.name || user.login;
      if (this.loginLink) {
        this.loginLink.textContent = "@" + user.login;
        this.loginLink.href = user.html_url;
      }

      if (this.statusBadge) {
        this.statusBadge.className = "sync-badge-status ok";
        this.statusBadge.textContent = "Conectado";
      }

      if (verbose && global.showToast) {
        global.showToast("Conexión exitosa", "Autenticado como @" + user.login, "ok");
      }

      if (repo) {
        await this.checkRemoteStatus(false);
      }
    } catch (err) {
      if (this.statusBadge) {
        this.statusBadge.className = "sync-badge-status warn";
        this.statusBadge.textContent = "Error de conexión";
      }
      if (this.profileCard) this.profileCard.hidden = true;
      if (verbose && global.showToast) {
        global.showToast("Fallo al conectar", err.message || "Verifica tu token de GitHub.");
      }
    }
  };

  PerfilSyncController.prototype.checkRemoteStatus = async function (verbose) {
    var self = this;
    var fileData = null;

    if (this.isVercel) {
      var password = this.getPassword();
      if (!password) {
        if (this.passwordInput) this.passwordInput.focus();
        if (verbose && global.showToast) global.showToast("Contraseña requerida", "Ingresa tu contraseña para consultar la nube.");
        return;
      }

      try {
        if (this.statusDesc) this.statusDesc.textContent = "Consultando repositorio mediante Vercel...";
        var res = await VercelAPI.request(password, "get_file");
        sessionStorage.setItem(SS_PASS_KEY, password);
        fileData = res.found ? { sha: res.sha, content: res.content } : null;
      } catch (err) {
        if (this.statusDesc) this.statusDesc.textContent = "Error al consultar: " + err.message;
        if (verbose && global.showToast) global.showToast("Error de consulta", err.message);
        return;
      }
    } else {
      var token = this.tokenInput ? this.tokenInput.value.trim() : "";
      var repo = this.repoInput ? cleanRepo(this.repoInput.value) : "";
      var branch = this.branchInput ? (this.branchInput.value.trim() || DEFAULT_BRANCH) : DEFAULT_BRANCH;

      if (!token || !repo) {
        try {
          var raw = localStorage.getItem(LS_KEY);
          var d = raw ? JSON.parse(raw) : {};
          var gh = d.githubSync || {};
          token = token || gh.token || "";
          repo = repo || gh.repo || "";
          branch = branch || gh.branch || DEFAULT_BRANCH;
        } catch (e) { }
      }

      if (!token || !repo) {
        if (verbose && global.showToast) global.showToast("Configuración incompleta", "Indica el token y el repositorio (usuario/repo).");
        return;
      }

      try {
        if (this.statusDesc) this.statusDesc.textContent = "Consultando repositorio en GitHub...";
        fileData = await GitHub.getFile(token, repo, branch, BACKUP_FILE_PATH);
      } catch (err) {
        if (this.statusDesc) this.statusDesc.textContent = "Error al consultar: " + err.message;
        if (verbose && global.showToast) global.showToast("Error de consulta", err.message);
        return;
      }
    }

    var raw = localStorage.getItem(LS_KEY);
    var local = raw ? JSON.parse(raw) : {};
    var localUpdated = local.updatedAt ? new Date(local.updatedAt) : null;

    if (!fileData) {
      this.currentSha = null;
      this.remoteBackup = null;
      if (this.statusDesc) this.statusDesc.textContent = "No existe respaldo en el repositorio. Pulsa 'Respaldar en GitHub' para crearlo.";
      if (this.statusBadge) {
        this.statusBadge.className = "sync-badge-status warn";
        this.statusBadge.textContent = "Sin respaldo remoto";
      }
      if (this.btnMerge) this.btnMerge.hidden = true;
      if (this.btnRestore) this.btnRestore.hidden = true;
      if (verbose && global.showToast) global.showToast("Sin respaldo", "Aún no hay respaldo en el repositorio. Puedes crearlo ahora.", "ok");
      return;
    }

    this.currentSha = fileData.sha;
    this.remoteBackup = fileData.content;

    var remoteUpdated = fileData.content && fileData.content.updatedAt ? new Date(fileData.content.updatedAt) : null;

    var datesHtml = "";
    if (localUpdated) datesHtml += "<span>📅 Local: " + localUpdated.toLocaleString() + "</span>";
    if (remoteUpdated) datesHtml += "<span>☁ Nube: " + remoteUpdated.toLocaleString() + "</span>";
    if (this.datesBox) this.datesBox.innerHTML = datesHtml;

    /* Comparación inteligente de fechas */
    if (remoteUpdated && localUpdated && remoteUpdated > localUpdated) {
      if (this.statusDesc) this.statusDesc.textContent = "La nube contiene datos más recientes (" + remoteUpdated.toLocaleTimeString() + "). Te recomendamos fusionar los cambios.";
      if (this.statusBadge) {
        this.statusBadge.className = "sync-badge-status warn";
        this.statusBadge.textContent = "Novedades en la nube";
      }
      if (this.btnMerge) {
        this.btnMerge.hidden = false;
        this.btnMerge.className = "btn-main";
      }
      if (this.btnRestore) this.btnRestore.hidden = false;
      if (verbose && global.showToast) global.showToast("Nube más reciente", "Hay datos más nuevos en GitHub listos para fusionar.", "ok");
    } else if (remoteUpdated && localUpdated && localUpdated > remoteUpdated) {
      if (this.statusDesc) this.statusDesc.textContent = "Tienes cambios locales más recientes que la copia en la nube. Puedes subir un nuevo respaldo.";
      if (this.statusBadge) {
        this.statusBadge.className = "sync-badge-status idle";
        this.statusBadge.textContent = "Cambios locales pendientes";
      }
      if (this.btnMerge) this.btnMerge.hidden = true;
      if (this.btnRestore) this.btnRestore.hidden = false;
      if (verbose && global.showToast) global.showToast("Al día", "Tus cambios locales son más recientes que la nube.", "ok");
    } else {
      if (this.statusDesc) this.statusDesc.textContent = "La información local y la nube están sincronizadas.";
      if (this.statusBadge) {
        this.statusBadge.className = "sync-badge-status ok";
        this.statusBadge.textContent = "Sincronizado";
      }
      if (this.btnMerge) this.btnMerge.hidden = true;
      if (this.btnRestore) this.btnRestore.hidden = false;
      if (verbose && global.showToast) global.showToast("Sincronizado", "Los datos coinciden con la nube.", "ok");
    }
  };

  PerfilSyncController.prototype.backupToGitHub = async function (isAutoBackup) {
    var payload = buildPayload();

    if (this.isVercel) {
      var password = this.getPassword();
      if (!password) {
        if (!isAutoBackup && this.passwordInput) this.passwordInput.focus();
        if (!isAutoBackup && global.showToast) global.showToast("Contraseña requerida", "Ingresa tu contraseña para subir el respaldo.");
        throw new Error("Contraseña requerida.");
      }

      try {
        if (!isAutoBackup && this.btnBackup) {
          this.btnBackup.disabled = true;
          this.btnBackup.textContent = "Subiendo respaldo...";
        }

        var commitMsg = isAutoBackup
          ? "Respaldo automático (" + new Date().toLocaleString() + ")"
          : "Respaldo manual (" + new Date().toLocaleString() + ")";

        var res = await VercelAPI.request(password, "put_file", {
          payload: payload,
          sha: this.currentSha,
          message: commitMsg
        });

        sessionStorage.setItem(SS_PASS_KEY, password);
        this.currentSha = res.sha;
        this.remoteBackup = payload;

        var raw = localStorage.getItem(LS_KEY);
        var d = raw ? JSON.parse(raw) : {};
        d.updatedAt = payload.updatedAt;
        localStorage.setItem(LS_KEY, JSON.stringify(d));

        if (this.statusBadge) {
          this.statusBadge.className = "sync-badge-status ok";
          this.statusBadge.textContent = "Sincronizado";
        }
        if (this.statusDesc) {
          this.statusDesc.textContent = "Respaldo guardado exitosamente en GitHub (" + new Date().toLocaleTimeString() + ").";
        }
        if (this.btnMerge) this.btnMerge.hidden = true;
        if (this.btnRestore) this.btnRestore.hidden = false;

        if (!isAutoBackup && global.showToast) {
          global.showToast("Respaldo completado", "Información guardada en el repositorio.", "ok");
        }
      } catch (err) {
        if (!isAutoBackup && global.showToast) global.showToast("Error al respaldar", err.message);
        throw err;
      } finally {
        if (!isAutoBackup && this.btnBackup) {
          this.btnBackup.disabled = false;
          this.btnBackup.textContent = "Respaldar en GitHub";
        }
      }
      return;
    }

    // Modo Local
    var token = this.tokenInput ? this.tokenInput.value.trim() : "";
    var repo = this.repoInput ? cleanRepo(this.repoInput.value) : "";
    var branch = this.branchInput ? (this.branchInput.value.trim() || DEFAULT_BRANCH) : DEFAULT_BRANCH;

    if (!token || !repo) {
      try {
        var raw3 = localStorage.getItem(LS_KEY);
        var d3 = raw3 ? JSON.parse(raw3) : {};
        var gh = d3.githubSync || {};
        token = token || gh.token || "";
        repo = repo || gh.repo || "";
        branch = branch || gh.branch || DEFAULT_BRANCH;
      } catch (e) { }
    }

    if (!token || !repo) {
      if (!isAutoBackup && global.showToast) global.showToast("Faltan datos", "Indica el token y el repositorio (usuario/repo).");
      throw new Error("Faltan datos de token y repositorio.");
    }

    try {
      if (!isAutoBackup && this.btnBackup) {
        this.btnBackup.disabled = true;
        this.btnBackup.textContent = "Subiendo respaldo...";
      }

      if (!this.currentSha) {
        var existing = await GitHub.getFile(token, repo, branch, BACKUP_FILE_PATH).catch(function () { return null; });
        if (existing) this.currentSha = existing.sha;
      }

      var msg2 = isAutoBackup
        ? "Respaldo automático (" + new Date().toLocaleString() + ")"
        : "Respaldo manual (" + new Date().toLocaleString() + ")";

      var newSha = await GitHub.putFile(token, repo, branch, BACKUP_FILE_PATH, payload, this.currentSha, msg2);
      this.currentSha = newSha;
      this.remoteBackup = payload;

      var raw2 = localStorage.getItem(LS_KEY);
      var d2 = raw2 ? JSON.parse(raw2) : {};
      d2.updatedAt = payload.updatedAt;
      localStorage.setItem(LS_KEY, JSON.stringify(d2));

      if (this.statusBadge) {
        this.statusBadge.className = "sync-badge-status ok";
        this.statusBadge.textContent = "Sincronizado";
      }
      if (this.statusDesc) {
        this.statusDesc.textContent = "Respaldo guardado exitosamente en GitHub (" + new Date().toLocaleTimeString() + ").";
      }
      if (this.btnMerge) this.btnMerge.hidden = true;
      if (this.btnRestore) this.btnRestore.hidden = false;

      if (!isAutoBackup && global.showToast) {
        global.showToast("Respaldo completado", "Información guardada en " + repo, "ok");
      }
    } catch (err) {
      if (!isAutoBackup && global.showToast) global.showToast("Error al respaldar", err.message);
      throw err;
    } finally {
      if (!isAutoBackup && this.btnBackup) {
        this.btnBackup.disabled = false;
        this.btnBackup.textContent = "Respaldar en GitHub";
      }
    }
  };

  PerfilSyncController.prototype.executeMerge = function () {
    if (!this.remoteBackup) {
      if (global.showToast) global.showToast("Sin datos", "Primero comprueba la nube.");
      return;
    }

    try {
      var raw = localStorage.getItem(LS_KEY);
      var local = raw ? JSON.parse(raw) : {};
      var merged = smartMerge(local, this.remoteBackup);
      localStorage.setItem(LS_KEY, JSON.stringify(merged));

      if (this.statusBadge) {
        this.statusBadge.className = "sync-badge-status ok";
        this.statusBadge.textContent = "Sincronizado";
      }
      if (this.statusDesc) this.statusDesc.textContent = "Fusión completada con éxito. Se combinaron categorías y ajustes.";
      if (this.btnMerge) this.btnMerge.hidden = true;

      if (this.opts.onDataReloaded) {
        this.opts.onDataReloaded(merged);
      }

      if (global.showToast) global.showToast("Fusión exitosa", "Se actualizaron las categorías y configuraciones sin perder datos.", "ok");
    } catch (err) {
      if (global.showToast) global.showToast("Error en fusión", err.message);
    }
  };

  PerfilSyncController.prototype.promptRestore = function () {
    var self = this;
    if (!this.remoteBackup) {
      this.checkRemoteStatus(true).then(function () {
        if (self.remoteBackup) self.confirmRestore();
      });
      return;
    }
    this.confirmRestore();
  };

  PerfilSyncController.prototype.confirmRestore = function () {
    var self = this;
    var catsCount = (this.remoteBackup.categories || []).length;
    var msg = "¿Deseas forzar la restauración desde GitHub?\n\nEsto reemplazará tus categorías (" + catsCount + " en la nube) y ajustes locales con la copia remota.";

    if (window.confirm(msg)) {
      try {
        var raw = localStorage.getItem(LS_KEY);
        var local = raw ? JSON.parse(raw) : {};
        var restored = forceRestore(local, this.remoteBackup);
        localStorage.setItem(LS_KEY, JSON.stringify(restored));

        if (this.statusBadge) {
          this.statusBadge.className = "sync-badge-status ok";
          this.statusBadge.textContent = "Restaurado";
        }
        if (this.statusDesc) this.statusDesc.textContent = "Se restauró la copia remota completa.";
        if (this.btnMerge) this.btnMerge.hidden = true;

        if (this.opts.onDataReloaded) {
          this.opts.onDataReloaded(restored);
        }

        if (global.showToast) global.showToast("Restauración completada", "Datos restaurados desde la nube.", "ok");
      } catch (err) {
        if (global.showToast) global.showToast("Error al restaurar", err.message);
      }
    }
  };

  global.PerfilSync = {
    _activeInstance: null,
    init: function (opts) {
      var inst = new PerfilSyncController(opts);
      global.PerfilSync._activeInstance = inst;
      return inst;
    },
    scheduleAutoBackup: function () {
      if (global.PerfilSync._activeInstance) {
        global.PerfilSync._activeInstance.scheduleAutoBackup();
      } else {
        var inst = new PerfilSyncController();
        global.PerfilSync._activeInstance = inst;
        inst.scheduleAutoBackup();
      }
    },
    setAutoBackup: function (enabled) {
      if (global.PerfilSync._activeInstance) {
        global.PerfilSync._activeInstance.setAutoBackup(enabled);
      }
    },
    isAutoBackupEnabled: function () {
      try {
        var raw = localStorage.getItem(LS_KEY);
        var d = raw ? JSON.parse(raw) : {};
        return !!d.autoBackup;
      } catch (e) { return false; }
    },
    smartMerge: smartMerge,
    forceRestore: forceRestore
  };
})(window);
