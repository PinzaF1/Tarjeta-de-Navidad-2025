// netlify/functions/submit-name.js

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    const body = safeJson(event.body);
    const nombre = (body?.nombre || "").trim().slice(0, 40);

    if (!nombre) return json(400, { error: "Nombre requerido" });

    // Variables de entorno (en Netlify)
    const token  = process.env.GITHUB_TOKEN;
    const owner  = process.env.GITHUB_OWNER;
    const repo   = process.env.GITHUB_REPO;
    const branch = process.env.GITHUB_BRANCH || "main";
    const path   = process.env.GITHUB_FILE_PATH || "data/nombres.json";

    if (!token || !owner || !repo) {
      return json(500, { error: "Faltan variables de entorno en Netlify" });
    }

    const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
    const headers = {
      "Authorization": `token ${token}`,
      "Accept": "application/vnd.github+json",
      "User-Agent": "navidad-card",
    };

    // 1) Leer archivo (si existe)
    let sha = null;
    let list = [];

    const getRes = await fetch(`${apiBase}?ref=${branch}`, { headers });

    if (getRes.ok) {
      const file = await getRes.json();
      sha = file.sha;

      const content = Buffer.from(file.content, "base64").toString("utf8");
      const parsed = safeJson(content, []);
      list = Array.isArray(parsed) ? parsed : [];
    } else if (getRes.status === 404) {
      list = [];
    } else {
      const t = await getRes.text();
      return json(500, { error: "No pude leer el archivo del repo", details: t.slice(0, 160) });
    }

    // 2) Anti-spam simple: no permitir mismo nombre repetido seguido
    const last = list[list.length - 1]?.nombre;
    if (last && last.toLowerCase() === nombre.toLowerCase()) {
      return json(200, { ok: true, note: "Nombre repetido (último). Igual OK." });
    }

    // 3) Agregar
    list.push({ nombre, created_at: new Date().toISOString() });

    // Limitar tamaño (por si mucha gente)
    if (list.length > 1500) list = list.slice(list.length - 1500);

    // 4) Guardar (crear/actualizar) el archivo en GitHub
    const newContent = Buffer.from(JSON.stringify(list, null, 2)).toString("base64");

    const putBody = {
      message: `add name: ${nombre}`,
      content: newContent,
      branch,
    };
    if (sha) putBody.sha = sha;

    const putRes = await fetch(apiBase, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(putBody),
    });

    if (!putRes.ok) {
      const t = await putRes.text();
      return json(500, { error: "No pude guardar en GitHub", details: t.slice(0, 200) });
    }

    return json(200, { ok: true });
  } catch (e) {
    return json(500, { error: "Error interno" });
  }
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(body),
  };
}

function safeJson(text, fallback = {}) {
  try { return JSON.parse(text || ""); } catch { return fallback; }
}
