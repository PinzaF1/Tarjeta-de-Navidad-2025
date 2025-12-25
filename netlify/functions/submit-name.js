exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    const body = safeJson(event.body);
    const nombre = (body?.nombre || "").trim().slice(0, 40);
    if (!nombre) return json(400, { error: "Nombre requerido" });

    const token  = process.env.GITHUB_TOKEN;
    const owner  = process.env.GITHUB_OWNER;
    const repo   = process.env.GITHUB_REPO;
    const branch = process.env.GITHUB_BRANCH || "main";
    const filePath = process.env.GITHUB_FILE_PATH || "data/nombres.json";

    if (!token || !owner || !repo) {
      return json(500, { error: "Faltan variables: GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO" });
    }

    // ✅ Importante: NO encodear el path completo, solo por segmentos
    const safePath = filePath.split("/").map(encodeURIComponent).join("/");
    const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents/${safePath}`;

    // ✅ Fine-grained tokens: usar Bearer
    const headers = {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "User-Agent": "navidad-card"
    };

    // 1) leer archivo (si existe)
    let sha = null;
    let list = [];

    const getRes = await fetch(`${apiBase}?ref=${encodeURIComponent(branch)}`, { headers });

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
      return json(getRes.status, { error: "GitHub GET falló", details: t.slice(0, 240) });
    }

    // 2) guardar
    list.push({ nombre, created_at: new Date().toISOString() });
    if (list.length > 1500) list = list.slice(list.length - 1500);

    const newContent = Buffer.from(JSON.stringify(list, null, 2)).toString("base64");

    const putBody = {
      message: `add name: ${nombre}`,
      content: newContent,
      branch
    };
    if (sha) putBody.sha = sha;

    const putRes = await fetch(apiBase, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(putBody)
    });

    if (!putRes.ok) {
      const t = await putRes.text();
      return json(putRes.status, { error: "GitHub PUT falló", details: t.slice(0, 260) });
    }

    return json(200, { ok: true });
  } catch (e) {
    return json(500, { error: "Error interno", details: String(e).slice(0, 200) });
  }
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  };
}

function safeJson(text, fallback = {}) {
  try { return JSON.parse(text || ""); } catch { return fallback; }
}
