"use strict";

/* ============================================================
   Vercel Serverless Function: api/sync.js
   Custodia GITHUB_TOKEN, GITHUB_REPO, GITHUB_BRANCH y AUTH_PASSWORD.
   Sin dependencias externas.
   ============================================================ */

const DEFAULT_PATH = "backup/clasificador-data.json";
const DEFAULT_BRANCH = "main";

function utf8ToBase64(str) {
  return Buffer.from(str, "utf8").toString("base64");
}

function base64ToUtf8(b64) {
  return Buffer.from(b64.replace(/\s/g, ""), "base64").toString("utf8");
}

module.exports = async function handler(req, res) {
  // Configuración CORS para pruebas y solicitudes cruzadas
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || DEFAULT_BRANCH;
  const authPassword = process.env.AUTH_PASSWORD;

  // Endpoint de comprobación de estado de Vercel
  if (req.method === "GET") {
    const action = req.query ? req.query.action : null;
    if (action === "status") {
      let userInfo = null;
      if (token) {
        try {
          const uRes = await fetch("https://api.github.com/user", {
            headers: {
              "Authorization": "Bearer " + token,
              "Accept": "application/vnd.github+json",
              "User-Agent": "Vercel-Sync-Proxy"
            }
          });
          if (uRes.ok) {
            const uData = await uRes.json();
            userInfo = { login: uData.login, name: uData.name, avatar_url: uData.avatar_url, html_url: uData.html_url };
          }
        } catch (e) { }
      }

      return res.status(200).json({
        isVercel: true,
        configured: !!token && !!repo,
        hasPassword: !!authPassword,
        repo: repo ? repo.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "") : "",
        branch: branch,
        user: userInfo
      });
    }

    return res.status(400).json({ error: "Acción no especificada." });
  }

  if (req.method === "POST") {
    const body = req.body || {};
    const { password, action, payload, sha, message } = body;

    // Validación de contraseña de seguridad
    if (authPassword && password !== authPassword) {
      return res.status(401).json({ error: "Contraseña incorrecta. Acceso denegado al repositorio." });
    }

    if (!token || !repo) {
      return res.status(500).json({ error: "El servidor de Vercel no tiene configuradas las variables GITHUB_TOKEN o GITHUB_REPO." });
    }

    const cleanRepoName = repo.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
    const targetPath = DEFAULT_PATH;

    try {
      // 1. Obtener usuario autenticado
      if (action === "get_user") {
        const uRes = await fetch("https://api.github.com/user", {
          headers: {
            "Authorization": "Bearer " + token,
            "Accept": "application/vnd.github+json",
            "User-Agent": "Vercel-Sync-Proxy"
          }
        });
        if (!uRes.ok) {
          const errData = await uRes.json().catch(() => ({}));
          return res.status(uRes.status).json({ error: errData.message || "Error al autenticar en GitHub con GITHUB_TOKEN." });
        }
        const uData = await uRes.json();
        return res.status(200).json({
          login: uData.login,
          name: uData.name,
          avatar_url: uData.avatar_url,
          html_url: uData.html_url
        });
      }

      // 2. Obtener archivo de respaldo
      if (action === "get_file") {
        const url = `https://api.github.com/repos/${cleanRepoName}/contents/${targetPath}?ref=${encodeURIComponent(branch)}`;
        const fRes = await fetch(url, {
          headers: {
            "Authorization": "Bearer " + token,
            "Accept": "application/vnd.github+json",
            "User-Agent": "Vercel-Sync-Proxy"
          }
        });

        if (fRes.status === 404) {
          return res.status(200).json({ found: false });
        }

        if (!fRes.ok) {
          const errData = await fRes.json().catch(() => ({}));
          return res.status(fRes.status).json({ error: errData.message || "Error al consultar archivo en GitHub." });
        }

        const fData = await fRes.json();
        const text = base64ToUtf8(fData.content || "");
        const parsed = JSON.parse(text);
        return res.status(200).json({
          found: true,
          sha: fData.sha,
          content: parsed
        });
      }

      // 3. Guardar / Actualizar archivo de respaldo
      if (action === "put_file") {
        const url = `https://api.github.com/repos/${cleanRepoName}/contents/${targetPath}`;
        const commitBody = {
          message: message || "Respaldo clasificador semántico",
          content: utf8ToBase64(JSON.stringify(payload, null, 2)),
          branch: branch
        };
        if (sha) commitBody.sha = sha;

        const pRes = await fetch(url, {
          method: "PUT",
          headers: {
            "Authorization": "Bearer " + token,
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "Vercel-Sync-Proxy"
          },
          body: JSON.stringify(commitBody)
        });

        if (!pRes.ok) {
          const errData = await pRes.json().catch(() => ({}));
          return res.status(pRes.status).json({ error: errData.message || "Error al guardar archivo en GitHub." });
        }

        const pData = await pRes.json();
        return res.status(200).json({
          ok: true,
          sha: pData.content ? pData.content.sha : null
        });
      }

      return res.status(400).json({ error: "Acción no soportada: " + action });
    } catch (err) {
      return res.status(500).json({ error: err.message || "Error interno del servidor en api/sync." });
    }
  }

  return res.status(405).json({ error: "Método no permitido." });
};
