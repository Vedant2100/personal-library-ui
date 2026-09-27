(() => {
  const CLIENT_ID = "35672175430-10n1qonbdrgc9k1ejfgv2027oluf2rq0.apps.googleusercontent.com";
  const SCOPE = "https://www.googleapis.com/auth/tasks";
  const API = "https://tasks.googleapis.com/tasks/v1";
  const URL_RE = /https?:\/\/[^\s<>\]\[\)"']+/g;
  const TRAILING = /[.,;:!?\)\]}>'"]+$/;

  function urlsFrom(text) {
    return [...new Set((String(text || "").match(URL_RE) || [])
      .map((url) => url.replace(TRAILING, ""))
      .filter(Boolean))];
  }

  async function waitForGoogle() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (window.google?.accounts?.oauth2) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("Google authorization did not load. Refresh and try again.");
  }

  async function authorize() {
    await waitForGoogle();
    return new Promise((resolve, reject) => {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPE,
        callback: (response) => {
          if (response?.access_token) resolve(response.access_token);
          else reject(new Error(response?.error_description || response?.error || "Google authorization was cancelled."));
        }
      });
      client.requestAccessToken({ prompt: "" });
    });
  }

  async function request(token, path, options = {}) {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) }
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.error?.message || `Google Tasks request failed (${response.status}).`);
    }
    return response.status === 204 ? null : response.json();
  }

  async function paginated(token, path, params = {}) {
    const items = [];
    let pageToken = "";
    do {
      const query = new URLSearchParams({ maxResults: "100", ...params });
      if (pageToken) query.set("pageToken", pageToken);
      const result = await request(token, `${path}?${query}`);
      items.push(...(result.items || []));
      pageToken = result.nextPageToken || "";
    } while (pageToken);
    return items;
  }

  window.syncGoogleTasksInBrowser = async ({ knownUrls = [] } = {}) => {
    const token = await authorize();
    const lists = await paginated(token, "/users/@me/lists");
    const candidates = [];
    for (const list of lists) {
      const listId = encodeURIComponent(list.id);
      const tasks = await paginated(token, `/lists/${listId}/tasks`, {
        showCompleted: "false", showHidden: "false", showDeleted: "false"
      });
      for (const task of tasks) {
        const urls = urlsFrom(`${task.title || ""}\n${task.notes || ""}`);
        if (urls.length) candidates.push({ task, list, urls });
      }
    }

    const seen = new Set();
    const known = new Set(knownUrls);
    const links = [];
    for (const { task, list, urls } of candidates) {
      for (const url of urls) {
        if (seen.has(url)) continue;
        seen.add(url);
        if (!known.has(url)) {
          links.push({
            key: `browser-task:${list.id}:${task.id}:${url}`,
            title: task.title || url,
            url,
            arcId: null,
            completed: false,
            path: ["Google Tasks", list.title || "Imported"],
            taskId: task.id,
            taskTitle: task.title || url,
            listTitle: list.title || "Imported"
          });
        }
      }
    }

    const completedTasks = [];
    const completionErrors = [];
    for (const { task, list } of candidates) {
      try {
        await request(token, `/lists/${encodeURIComponent(list.id)}/tasks/${encodeURIComponent(task.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "completed" })
        });
        completedTasks.push({ taskId: task.id, taskTitle: task.title || "Untitled task", listTitle: list.title || "Imported" });
      } catch (error) {
        completionErrors.push({ taskId: task.id, taskTitle: task.title || "Untitled task", error: error.message });
      }
    }

    return {
      ok: true,
      syncedAt: new Date().toISOString(),
      tasksWithUrls: candidates.length,
      urlsFound: seen.size,
      links,
      completedTasks,
      completionErrors
    };
  };
})();
