const state = { data: null, mode: "map", query: "", mapFocus: null, mapBrowsePath: null, mapGroup: "Agentic AI", staticSite: false, githubToken: null, githubAuthPending: null };

const PRIVATE_VERCEL_HOST = /(^|\.)vercel\.app$/i.test(window.location.hostname) || (
  window.location.hostname === "vedant2100.github.io" &&
  /^\/personal-library-ui(?:\/|$)/.test(window.location.pathname)
);
const $ = (selector) => document.querySelector(selector);
const setSourceStatus = (message) => { const target = $("#source-status"); if (target) target.textContent = message; };

function esc(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[char]));
}

function allLinks(folders, output = []) {
  for (const folder of folders || []) {
    output.push(...(folder.links || []));
    allLinks(folder.folders || [], output);
  }
  return output;
}

function rootFor(folder) { return folder.path[0]?.toLowerCase() || ""; }

function folderInMode(folder) {
  if (["curated", "source", "completed"].includes(state.mode)) return true;
  if (["c1", "c2", "b1"].includes(state.mode)) return rootFor(folder) === state.mode;
  if (state.mode === "today") return Boolean(folder.todayGroup);
  return true;
}

function queryMatches(text) {
  if (!state.query) return true;
  return text.toLowerCase().includes(state.query.toLowerCase());
}

function searchTerms() {
  return state.query.toLowerCase().split(/\s+/).filter(Boolean);
}

function searchableText(link) {
  return [link.title, link.purpose, link.pageTitle, link.pageDescription, link.pageHeading, link.url, domain(link.url), ...(link.path || [])]
    .filter(Boolean).join(" ").toLowerCase();
}

function searchScore(link) {
  const terms = searchTerms();
  if (!terms.length) return 0;
  const title = `${link.title || ""} ${link.pageTitle || ""}`.toLowerCase();
  const purpose = `${link.purpose || ""} ${link.pageDescription || ""} ${link.pageHeading || ""}`.toLowerCase();
  const path = (link.path || []).join(" ").toLowerCase();
  const url = `${link.url || ""} ${domain(link.url)}`.toLowerCase();
  if (!terms.every((term) => searchableText(link).includes(term))) return -1;
  return terms.reduce((score, term) => score
    + (title === term ? 140 : title.startsWith(term) ? 80 : title.includes(term) ? 55 : 0)
    + (path.includes(term) ? 28 : 0)
    + (purpose.includes(term) ? 18 : 0)
    + (url.includes(term) ? 8 : 0), 0);
}

function searchResults() {
  const unique = new Map();
  allLinks(state.data.areaFolders).forEach((link) => {
    if (!link.completed && !unique.has(link.key)) unique.set(link.key, link);
  });
  return [...unique.values()]
    .map((link) => ({ link, score: searchScore(link) }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score || a.link.title.localeCompare(b.link.title));
}

function searchMatchContext(link) {
  const terms = searchTerms();
  const title = `${link.title || ""} ${link.pageTitle || ""}`.toLowerCase();
  const purpose = `${link.purpose || ""} ${link.pageDescription || ""}`.toLowerCase();
  const path = (link.path || []).join(" / ").toLowerCase();
  const url = `${link.url || ""} ${domain(link.url)}`.toLowerCase();
  if (terms.some((term) => title.includes(term))) return link.pageTitle || link.title || "Title";
  if (terms.some((term) => path.includes(term))) return `Folder: ${(link.path || []).join(" / ")}`;
  if (terms.some((term) => purpose.includes(term))) return link.purpose || link.pageDescription || "Saved page description";
  if (terms.some((term) => url.includes(term))) return `URL: ${domain(link.url)}`;
  return link.purpose || (link.path || []).join(" / ");
}

function renderSearchSuggestions() {
  const target = $("#search-suggestions");
  if (!state.query) { target.hidden = true; target.innerHTML = ""; return; }
  const matches = searchResults().slice(0, 8);
  target.hidden = false;
  target.innerHTML = matches.length
    ? matches.map(({ link }) => `<a role="option" href="${esc(link.url)}" target="_blank" rel="noreferrer" title="${esc(link.url)}"><strong>${esc(link.title || link.url)}</strong><span>${esc(searchMatchContext(link))}</span><small>${esc((link.path || []).join(" / "))}</small></a>`).join("")
    : `<p>No matches for “${esc(state.query)}”.</p>`;
}

function visibleLinks(folder) {
  return folder.links.filter((link) => {
    const statusMatches = state.mode === "completed" ? link.completed : !link.completed;
    return statusMatches && queryMatches(`${link.title} ${link.purpose || ""} ${link.url} ${link.path.join(" ")}`);
  });
}

function folderVisible(folder) {
  if (!folder.todayGroup && !folderInMode(folder)) return false;
  if (!state.query) return true;
  const folderText = `${folder.name} ${folder.path.join(" ")}`;
  if (queryMatches(folderText)) return true;
  if (visibleLinks(folder).length) return true;
  return folder.folders.some(folderVisible);
}

function filteredLinks(folder) {
  return (folder.todayGroup || folderInMode(folder)) ? visibleLinks(folder) : [];
}

function todayText(link) {
  return [link.group, link.area, link.route, ...(link.path || []), link.title, link.purpose,
    link.pageTitle, link.pageDescription, link.pageHeading]
    .filter(Boolean).join(" ");
}

function startOfLocalDay(value = new Date()) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function daysFromToday(date) {
  return Math.round((startOfLocalDay(date) - startOfLocalDay()) / 86400000);
}

function validFetch(link) {
  const fetched = link.fetchedAt ? new Date(link.fetchedAt) : null;
  const fresh = fetched && !Number.isNaN(fetched) && (Date.now() - fetched.getTime()) <= 45 * 86400000;
  const status = String(link.contentStatus || "");
  return fresh && (/^2\d\d$/.test(status) || status === "ok");
}

function timingLabel(context) {
  if (/deadline|\bdue\b|apply by|applications? close|submission/.test(context)) return "Deadline";
  if (/registration/.test(context)) return "Registration";
  if (/applications? open|\bopening\b|\bopens?\b/.test(context)) return "Applications open";
  return "Event";
}

function timingExcerpt(text, index, length) {
  const start = Math.max(0, index - 72);
  const end = Math.min(text.length, index + length + 92);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function classifyDateTiming(link) {
  const text = todayText(link);
  const lower = text.toLowerCase();
  const monthNames = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
    may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
    oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
  };
  const datePattern = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(20\d{2}))?\b/gi;
  const actionPattern = /deadline|\bdue\b|apply\s+(?:by|before)|applications?\s+(?:close|open)|registration|submi(?:t|ssion)|\bopening\b|\bopens?\b|\bstarts?\b|\bbegins?\b|\bevent\b|\bwebinar\b|\bconference\b|\binterview\b|\bcohort\b/;
  const stalePattern = /\bclosed\b|\barchiv(?:ed|e)\b|\b202[0-5]\b/;
  let match;
  let ambiguous = null;
  while ((match = datePattern.exec(text))) {
    const month = monthNames[match[1].toLowerCase().replace(/\.$/, "")];
    const day = Number(match[2]);
    const explicitYear = match[3] ? Number(match[3]) : null;
    const context = text.slice(Math.max(0, match.index - 120), Math.min(text.length, match.index + match[0].length + 120)).toLowerCase();
    if (!actionPattern.test(context)) continue;
    const excerpt = timingExcerpt(text, match.index, match[0].length);
    if (stalePattern.test(context)) {
      ambiguous ||= { label: "Verify timing", excerpt, reason: "The saved page mentions a date but also appears closed or historical." };
      continue;
    }
    const year = explicitYear || new Date().getFullYear();
    const date = new Date(year, month, day);
    if (date.getMonth() !== month || date.getDate() !== day) continue;
    const offset = daysFromToday(date);
    // An undated month/day is only actionable when the page was fetched recently and is near-term.
    if (!explicitYear && (!validFetch(link) || offset < 0 || offset > 120)) {
      ambiguous ||= { label: "Verify timing", excerpt, reason: "This date has no year, so it needs a quick check." };
      continue;
    }
    if (explicitYear && offset < 0) {
      ambiguous ||= { label: "Verify timing", excerpt, reason: "This saved date has passed." };
      continue;
    }
    if (!validFetch(link)) {
      ambiguous ||= { label: "Verify timing", excerpt, reason: "The page has not been fetched recently enough to trust this date." };
      continue;
    }
    if (offset > 120) continue;
    const label = timingLabel(context);
    const dateLabel = date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined });
    return {
      bucket: offset === 0 ? "Due today" : offset <= 7 ? "Due this week" : "Coming up",
      label, dateLabel, excerpt, sort: offset
    };
  }
  return ambiguous ? { bucket: "Verify timing", ...ambiguous, sort: 9999 } : null;
}

function todayFallback(link) {
  const pathText = [link.group, link.area, link.route, ...(link.path || [])].filter(Boolean).join(" ").toLowerCase();
  if (/google tasks|\bpriority\b/.test(pathText)) return "Continue";
  if ((link.group === "Agentic AI" && link.route === "Projects") || /code & projects/.test(pathText)) return "Continue";
  if (/career|open roles|employer|fellowship|phd|scholarship|admission|application submissions|graduate|\bgre\b|research program|events & programs/.test(pathText)) return "Undated opportunities";
  return null;
}

function todayFolders() {
  const names = ["Due today", "Due this week", "Coming up", "Continue", "Undated opportunities", "Verify timing"];
  const folders = names.map((name) => {
    const folder = createFolder(name, ["Today", name], 1);
    folder.todayGroup = true;
    return folder;
  });
  const byName = new Map(folders.map((folder) => [folder.name, folder]));
  const seen = new Set();
  allLinks(state.data?.areaFolders || []).forEach((link) => {
    if (!link?.key || link.completed || seen.has(link.key)) return;
    seen.add(link.key);
    const timing = classifyDateTiming(link);
    const bucket = timing?.bucket || todayFallback(link);
    if (!bucket) return;
    byName.get(bucket).links.push({ ...link, path: ["Today", bucket], todaySourcePath: link.path, todayTiming: timing });
  });
  folders.forEach((folder) => {
    folder.links.sort((a, b) => (a.todayTiming?.sort ?? 9998) - (b.todayTiming?.sort ?? 9998) || (a.title || "").localeCompare(b.title || ""));
    refreshCounts(folder);
  });
  return folders.filter((folder) => folder.total);
}

function domain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function renderStats() {
  if (state.mode === "map") {
    const roots = state.data.areaFolders || [];
    const agentic = roots.find((folder) => folder.name === "Agentic AI");
    const other = roots.find((folder) => folder.name === "Other");
    const active = allLinks(roots).filter((link) => !link.completed).length;
    $("#stats").innerHTML = [
      [agentic?.total || 0, "Agentic AI · evidence-linked"],
      [agentic?.folders?.length || 0, "Connected areas"],
      [other?.total || 0, "Other · outside scope"],
      [active, "Active URLs"]
    ].map(([number, label]) => `<div class="stat"><strong>${number}</strong><span>${esc(label)}</span></div>`).join("");
    return;
  }
  const links = allLinks(state.data.curatedFolders);
  const active = links.filter((link) => !link.completed);
  const counts = { c1: 0, c2: 0, b1: 0 };
  active.forEach((link) => { const key = link.path[0]?.toLowerCase(); if (counts[key] !== undefined) counts[key] += 1; });
  $("#stats").innerHTML = [
    [active.length, "Active URLs"],
    [links.length - active.length, "Done · hidden"],
    [counts.c1, "c1 · Attack"],
    [counts.c2, "c2 · Stamina"],
    [counts.b1, "b1 · Balance"]
  ].map(([number, label]) => `<div class="stat"><strong>${number}</strong><span>${esc(label)}</span></div>`).join("");
}

function renderNotice() {
  if (state.mode === "map") {
    $("#notice").innerHTML = "<strong>Area map.</strong> Agentic AI contains only links whose saved description, title, or query explicitly connects to agents, model capability, evaluation, memory, control, or systems. Every remaining URL stays under Other, with no links removed. Open folders below to select links; Shift-click selects a range, then save a local move.";
    return;
  }
  const duplicateCount = state.data.deduplicatedLinks || 0;
  const duplicateNote = duplicateCount
    ? ` ${duplicateCount} duplicate URL ${duplicateCount === 1 ? "entry is" : "entries are"} hidden here.`
    : " No duplicate URLs are visible here.";
  const base = '<strong>Curated queue.</strong> Recovery wrappers are hidden here and high-confidence links are refiled into c1/c2/b1.' + duplicateNote + ' Use Source nesting when you need the untouched Arc-derived structure.';
  const last = state.data.lastTaskSync;
  if (!last) {
    $("#notice").innerHTML = base;
    return;
  }
  const timestamp = last.syncedAt ? new Date(last.syncedAt).toLocaleString() : 'unknown time';
  const locations = (last.currentLocations || []).map((item) => {
    const title = esc(item.title || item.url);
    const path = esc((item.path || ['Review']).join(' / '));
    return '<li>' + title + ' <span class="sync-path">→ ' + path + '</span></li>';
  }).join('');
  const locationHtml = locations ? '<ul>' + locations + '</ul>' : '';
  const completionErrors = last.completionErrors || [];
  const completionHtml = completionErrors.length
    ? '<br><span class="sync-warning">Could not complete ' + completionErrors.length + ' Google Task' + (completionErrors.length === 1 ? '' : 's') + '.</span>'
    : '';
  $("#notice").innerHTML = base + '<br><strong>Last Tasks sync (' + esc(timestamp) + '):</strong> ' +
    (last.tasksWithUrls || 0) + ' tasks, ' + (last.urlsFound || 0) + ' URLs, ' +
    (last.urlsAdded || 0) + ' added, ' + (last.urlsReopened || 0) + ' reopened, ' +
    (last.urlsExisting || 0) + ' already here; ' + (last.tasksCompleted || 0) + ' Tasks completed.' +
    completionHtml + locationHtml;
}

function renderLink(link, options = {}) {
  const path = options.showPath ? `<span class="search-path">${esc((link.path || []).join(" / "))}</span>` : "";
  const timing = state.mode === "today" && link.todayTiming
    ? `<span class="link-purpose today-evidence" title="${esc(link.todayTiming.excerpt || link.todayTiming.reason || "")}">${esc([link.todayTiming.label, link.todayTiming.dateLabel || link.todayTiming.reason].filter(Boolean).join(" · "))}</span>`
    : options.showDescription
      ? `<span class="link-purpose" title="${esc(link.contentStatus || "not fetched")}">${esc(link.purpose || "Content description pending")}</span>`
      : "";
  return `<div class="link-row">
    <input class="link-select" type="checkbox" data-archive-key="${esc(link.key)}" aria-label="Archive ${esc(link.title || link.url)}">
    <a href="${esc(link.url)}" target="_blank" rel="noreferrer" title="${esc(link.url)}">${esc(link.title || link.url)}</a>
    ${timing}
    <span class="link-domain">${esc(domain(link.url))}</span>
    ${path}
  </div>`;
}

function folderTargets(folders, output = []) {
  for (const folder of folders || []) {
    if (folder.path.length > 1) output.push(folder);
    folderTargets(folder.folders || [], output);
  }
  return output;
}

function areaFolderTargets() {
  return folderTargets(state.data?.areaFolders || [])
    .sort((a, b) => a.path.join(" / ").localeCompare(b.path.join(" / ")));
}

function targetAreaPath(path) {
  let folders = state.data.areaFolders;
  let current;
  path.forEach((name, depth) => {
    current = folders.find((folder) => folder.name === name);
    if (!current) {
      current = createFolder(name, path.slice(0, depth + 1), depth);
      folders.push(current);
    }
    folders = current.folders;
  });
  return current;
}

const LOCAL_MOVES_KEY = "personal-library-area-moves-v1";

function localMoves() {
  try { return JSON.parse(localStorage.getItem(LOCAL_MOVES_KEY) || "{}"); }
  catch { return {}; }
}

function saveLocalMoves(moves) {
  localStorage.setItem(LOCAL_MOVES_KEY, JSON.stringify(moves));
}

function findAreaLink(folders, key) {
  for (const folder of folders) {
    const index = folder.links.findIndex((link) => link.key === key);
    if (index >= 0) return { folder, index, link: folder.links[index] };
    const nested = findAreaLink(folder.folders, key);
    if (nested) return nested;
  }
  return null;
}

function refreshCounts(folder) {
  const children = folder.folders || [];
  const links = folder.links || [];
  children.forEach(refreshCounts);
  folder.total = links.length + children.reduce((sum, child) => sum + child.total, 0);
  folder.active = links.filter((link) => !link.completed).length + children.reduce((sum, child) => sum + child.active, 0);
}

function createFolder(name, path, depth) {
  return { name, path, depth, total: 0, active: 0, links: [], folders: [] };
}

function targetAreaFolder(group, area, route) {
  return targetAreaPath([group, area, route]);
}

function moveAreaLinkToPath(key, path) {
  const found = findAreaLink(state.data.areaFolders, key);
  if (!found || !Array.isArray(path) || !path.length) return false;
  found.folder.links.splice(found.index, 1);
  const target = targetAreaPath(path);
  found.link.group = path[0];
  found.link.area = path[1] || path[0];
  found.link.route = path[path.length - 1];
  found.link.path = target.path.slice();
  target.links.push(found.link);
  state.data.areaFolders.forEach(refreshCounts);
  return true;
}

function moveAreaLink(key, group, area, route) {
  return moveAreaLinkToPath(key, [group, area, route].filter(Boolean));
}

function applyLocalMoves() {
  const moves = localMoves();
  Object.entries(moves).forEach(([key, move]) => {
    const path = Array.isArray(move.path) ? move.path : [move.group, move.area, move.route].filter(Boolean);
    moveAreaLinkToPath(key, path);
  });
}

const BROWSER_TASK_LINKS_KEY = "personal-library-google-task-links-v1";

function savedBrowserTaskLinks() {
  try {
    const items = JSON.parse(localStorage.getItem(BROWSER_TASK_LINKS_KEY) || "[]");
    return Array.isArray(items) ? items : [];
  } catch { return []; }
}

function saveBrowserTaskLinks(items) {
  localStorage.setItem(BROWSER_TASK_LINKS_KEY, JSON.stringify(items));
}

function ensureFolder(folders, name, path) {
  let folder = folders.find((item) => item.name === name);
  if (!folder) {
    folder = createFolder(name, path, path.length);
    folders.push(folder);
  }
  return folder;
}

function addTaskLinkToViews(link) {
  const exists = allLinks(state.data.areaFolders).some((item) => item.url === link.url);
  if (exists) return false;
  const group = link.group || "Other";
  const area = link.area || "Google Tasks";
  const route = link.route || "Resources";
  const mapTarget = targetAreaFolder(group, area, route);
  const mapLink = { ...link, group, area, route, path: mapTarget.path.slice() };
  mapTarget.links.push(mapLink);

  const curatedRoot = ensureFolder(state.data.curatedFolders, "Google Tasks", ["Google Tasks"]);
  const listName = link.listTitle || "Imported";
  const curatedTarget = ensureFolder(curatedRoot.folders, listName, ["Google Tasks", listName]);
  curatedTarget.links.push({ ...link, path: curatedTarget.path.slice() });
  refreshCounts(state.data.areaFolders);
  refreshCounts(state.data.curatedFolders);
  return true;
}

function applySavedTaskLinks() {
  const initial = [...(state.data.taskLinks || []), ...savedBrowserTaskLinks()];
  initial.forEach(addTaskLinkToViews);
}

function persistBrowserTaskLinks(links) {
  const saved = savedBrowserTaskLinks();
  const byUrl = new Map(saved.map((link) => [link.url, link]));
  links.forEach((link) => byUrl.set(link.url, link));
  saveBrowserTaskLinks([...byUrl.values()]);
  return links.filter(addTaskLinkToViews);
}

function renderFolder(folder) {
  if (!folderVisible(folder)) return "";
  const childHtml = folder.folders.map(renderFolder).join("");
  const links = filteredLinks(folder);
  const linksHtml = links.length ? `<div class="links">${links.map(renderLink).join("")}</div>` : "";
  const hasChildren = childHtml || linksHtml;
  const folderCount = state.mode === "completed" ? folder.total - folder.active : folder.active;
  const open = state.mode === "map" && state.mapBrowsePath
    ? true
    : folder.todayGroup
      ? ["Due today", "Due this week", "Coming up"].includes(folder.name)
      : folder.depth === 1 || (!["curated", "source"].includes(state.mode) && folder.depth === 2) || (state.query && queryMatches(`${folder.name} ${folder.path.join(" ")}`));
  return `<details class="folder" data-depth="${folder.depth}" data-folder-path="${esc(folder.path.join(" / "))}" ${open ? "open" : ""}>
    <summary>
      <span class="folder-name">📁 ${esc(folder.name)}</span>
      <span class="folder-count">${folderCount}</span>
      <span class="folder-path">${esc(folder.path.join(" / "))}</span>
    </summary>
    <div class="children">${hasChildren || state.query ? `${childHtml}${linksHtml}` : ""}</div>
  </details>`;
}

const MAP_PROFILES = {
  "Agentic AI": {
    labels: {
      "Models, Inference & Systems": ["01", "Models & systems", "The substrate: models, serving, inference, compute."],
      "Train Agent Capabilities": ["02", "Train capability", "Post-training, reinforcement learning, data, rewards."],
      "Planning, Reasoning & Reflection": ["03", "Plan & reason", "Decomposition, search, reflection, and long-horizon decisions."],
      "Memory & Context": ["04", "Memory & context", "Retrieval, context engineering, and persistent state."],
      "Tools, Computer Use & Environments": ["05", "Tools & environments", "MCP, tool calling, browser and computer-use action."],
      "Orchestration & Multi-Agent": ["06", "Orchestration", "Harnesses, workflows, delegation, and multi-agent coordination."],
      "Build Agents": ["07", "Agent systems", "Agent frameworks, applications, and autonomous workflows."],
      "Evaluate & Audit Agents": ["08", "Evaluate & observe", "Benchmarks, graders, traces, and reliability."],
      "Control, Alignment & Security": ["09", "Control & security", "Alignment, oversight, governance, and attack resistance."]
    },
    ordered: ["Models, Inference & Systems", "Train Agent Capabilities", "Planning, Reasoning & Reflection", "Memory & Context", "Tools, Computer Use & Environments", "Orchestration & Multi-Agent", "Build Agents", "Evaluate & Audit Agents", "Control, Alignment & Security"],
    branchOrder: ["Learning", "Projects", "Roles"]
  },
  Other: {
    labels: {
      Archive: ["01", "Archive", "Saved reference material and application history."],
      Career: ["02", "Career", "Roles, companies, applications, and career operations."],
      Research: ["03", "Research", ""],
      University: ["04", "University", "Graduate study, GRE, fellowships, and university material."],
      Engineering: ["05", "Engineering", "Software engineering, tools, and technical work."],
      Learning: ["06", "Learning", "Courses, notes, and skill development."],
      Community: ["07", "Community", "People, communities, and shared resources."],
      Personal: ["08", "Personal", "Personal administration and life resources."],
      Media: ["09", "Media", "Reading, watching, and media references."],
      Review: ["10", "Review", "Links held for later classification."]
    },
    ordered: ["Archive", "Career", "Research", "University", "Engineering", "Learning", "Community", "Personal", "Media", "Review"]
  }
};

const MAP_PREVIEWS = {
  "Models, Inference & Systems": "Models · serving · compute",
  "Train Agent Capabilities": "RL · post-training · data",
  "Planning, Reasoning & Reflection": "Search · reflection · horizons",
  "Memory & Context": "Retrieval · context · state",
  "Tools, Computer Use & Environments": "MCP · browser · computer use",
  "Orchestration & Multi-Agent": "Workflows · delegation · teams",
  "Build Agents": "Frameworks · apps · autonomy",
  "Evaluate & Audit Agents": "Benchmarks · graders · traces",
  "Control, Alignment & Security": "Alignment · oversight · security",
  Archive: "Admissions · funding · logistics",
  Career: "Roles · employers · applications",
  Research: "",
  University: "Campus · graduate study · programs",
  Engineering: "Code · tools · systems",
  Learning: "Courses · papers · references",
  Community: "Events · programs · networks",
  Personal: "Accounts · documents · admin",
  Media: "Reading · video · social",
  Review: "Unresolved · needs review"
};

const MAP_FUNNEL_STEPS = {
  Learning: "Learn",
  Projects: "Build",
  Roles: "Apply"
};

function folderAtPath(folders, path) {
  let choices = folders || [];
  let current = null;
  for (const name of path || []) {
    current = choices.find((folder) => folder.name === name);
    if (!current) return null;
    choices = current.folders || [];
  }
  return current;
}

const MAP_ORBIT_POSITIONS_KEY = "personal-library-map-orbit-positions-v1";

function orbitPositions() {
  try { return JSON.parse(localStorage.getItem(MAP_ORBIT_POSITIONS_KEY) || "{}"); }
  catch { return {}; }
}

function orbitRotation(group) {
  const rotation = orbitPositions()?.[group]?.rotation;
  return Number.isFinite(rotation) ? rotation : 0;
}

function orbitAngle(group, area, fallback) {
  return fallback + orbitRotation(group);
}

function saveOrbitRotation(group, rotation) {
  const positions = orbitPositions();
  positions[group] = { rotation: Math.round(rotation * 10) / 10 };
  localStorage.setItem(MAP_ORBIT_POSITIONS_KEY, JSON.stringify(positions));
}

function angleOnOrbit(event, ring) {
  const bounds = ring.getBoundingClientRect();
  const x = event.clientX - bounds.left - bounds.width / 2;
  const y = event.clientY - bounds.top - bounds.height / 2;
  return (Math.atan2(y, x) * 180 / Math.PI + 90 + 360) % 360;
}

function enableOrbitDragging(target, group) {
  const ring = target.querySelector(".map-ring");
  if (!ring) return;
  const nodes = [...target.querySelectorAll("[data-map-target]")];
  nodes.forEach((node) => {
    let dragging = false;
    let moved = false;
    let lastPointerAngle = 0;
    let rotation = 0;
    node.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      dragging = true;
      moved = false;
      lastPointerAngle = angleOnOrbit(event, ring);
      rotation = orbitRotation(group);
      node.setPointerCapture(event.pointerId);
      nodes.forEach((item) => item.classList.add("dragging"));
      event.preventDefault();
    });
    node.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const pointerAngle = angleOnOrbit(event, ring);
      rotation += ((pointerAngle - lastPointerAngle + 540) % 360) - 180;
      lastPointerAngle = pointerAngle;
      nodes.forEach((item) => {
        const baseAngle = Number.parseFloat(item.dataset.baseAngle || "0");
        item.style.setProperty("--angle", `${baseAngle + rotation}deg`);
      });
      saveOrbitRotation(group, rotation);
      moved = true;
    });
    node.addEventListener("pointerup", (event) => {
      if (!dragging) return;
      dragging = false;
      nodes.forEach((item) => item.classList.remove("dragging"));
      if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
      node.dataset.dragged = moved ? "true" : "";
    });
    node.addEventListener("pointercancel", () => {
      dragging = false;
      nodes.forEach((item) => item.classList.remove("dragging"));
    });
  });
}

function renderMapOverview() {
  const target = $("#map-overview");
  if (state.mode !== "map") { target.innerHTML = ""; return; }
  const roots = state.data.areaFolders || [];
  const root = roots.find((folder) => folder.name === state.mapGroup) || roots[0];
  if (!root) { target.innerHTML = ""; return; }
  state.mapGroup = root.name;
  const profile = MAP_PROFILES[root.name] || { labels: {}, ordered: [] };
  const byName = new Map((root.folders || []).map((folder) => [folder.name, folder]));
  const orderedNames = [...profile.ordered, ...[...byName.keys()].filter((name) => !profile.ordered.includes(name)).sort()];
  const available = orderedNames.map((name) => byName.get(name)).filter(Boolean);
  const active = byName.get(state.mapFocus) || available[0];
  if (!active) { target.innerHTML = ""; return; }
  state.mapFocus = active.name;
  const [, label, detail] = profile.labels[active.name] || ["", active.name, "Browse this area and its nested folders."];
  const previewLabel = MAP_PREVIEWS[active.name] ?? "Related pages";
  const branchFolders = profile.branchOrder
    ? profile.branchOrder.map((name) => active.folders.find((folder) => folder.name === name)).filter(Boolean)
    : active.folders;
  const branchMaxLinks = Math.max(...branchFolders.map((folder) => folder.total || allLinks([folder]).length), 1);
  const brushStyle = (count, index = 0, maximum = branchMaxLinks) => {
    const share = Math.sqrt(Math.max(count, 0) / maximum);
    const brushSize = Math.round(76 - share * 42);
    const opacity = (0.055 + share * 0.18).toFixed(2);
    return `--brush-angle:${(index * 31 + 7) % 70 - 35}deg;--brush-size:${brushSize}px;--brush-opacity:${opacity}`;
  };
  const stages = branchFolders.map((branch, index) => {
    const allBranchLinks = allLinks([branch]);
    const links = allBranchLinks.slice(0, 2);
    const previews = links.map((link) => `<a href="${esc(link.url)}" target="_blank" rel="noreferrer">${esc(link.title || link.url)}</a>`).join("");
    return `<section class="map-stage" style="${brushStyle(allBranchLinks.length, index)}"><strong>${esc(branch.name)}</strong><div>${previews || "<p>No links yet.</p>"}</div><button class="map-stage-all" data-stage-path="${esc(JSON.stringify(branch.path))}">View all</button></section>`;
  }).join("") || `<p class="map-empty">Open this area’s full list to explore its links.</p>`;
  const maxLinks = Math.max(...available.map((folder) => folder.total), 1);
  const textureStyle = (count, index = 0) => {
    const share = Math.sqrt(count / maxLinks);
    const brushSize = Math.round(22 - share * 11);
    const opacity = (0.10 + share * 0.28).toFixed(2);
    return `--texture-angle:${(index * 37 + 22) % 180}deg;--brush-size:${brushSize}px;--texture-opacity:${opacity}`;
  };
  const nodes = available.map((folder, index) => {
    const [, nodeLabel] = profile.labels[folder.name] || ["", folder.name];
    const fallbackAngle = index * 360 / available.length - 90;
    const angle = `${orbitAngle(root.name, folder.name, fallbackAngle)}deg`;
    return `<button class="map-node ${folder.name === active.name ? "active" : ""}" style="--angle:${angle};${textureStyle(folder.total, index)}" data-base-angle="${fallbackAngle}" data-map-target="${esc(folder.name)}" aria-pressed="${folder.name === active.name}" aria-label="${esc(nodeLabel)}: ${folder.total} links. Drag to rotate the whole orbit."><i class="map-node-texture" aria-hidden="true"></i><strong>${esc(nodeLabel)}</strong></button>`;
  }).join("");
  target.innerHTML = `<section class="map-orbit" aria-label="${esc(root.name)} area explorer"><div class="map-ring" style="--node-count:${available.length}">${nodes}<section class="map-core"><i class="map-core-texture" aria-hidden="true"></i><h3>${esc(label)}</h3><div class="map-branches"><div class="map-stages" aria-label="Learning, projects, and roles">${stages}</div></div></section></div></section>`;
  enableOrbitDragging(target, root.name);
  target.querySelectorAll("[data-map-target]").forEach((card) => card.addEventListener("click", () => {
    if (card.dataset.dragged === "true") { card.dataset.dragged = ""; return; }
    state.mapFocus = card.dataset.mapTarget;
    state.mapBrowsePath = null;
    render();
  }));
  target.querySelectorAll("[data-stage-path]").forEach((button) => button.addEventListener("click", () => {
    try { state.mapBrowsePath = JSON.parse(button.dataset.stagePath); }
    catch { return; }
    state.query = "";
    render();
    $("#tree").scrollIntoView({ behavior: "smooth", block: "start" });
  }));
}

async function changeLinkState(route, key) {
  const response = await fetch(route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keys: [key] })
  });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error || "Could not update the queue");
}

async function openLinks(links) {
  const unique = [];
  const seen = new Set();
  for (const link of links) {
    if (!link?.url || seen.has(link.url)) continue;
    seen.add(link.url);
    unique.push(link);
  }
  const limited = unique.slice(0, 20);
  if (!limited.length) return;
  if (limited.length > 5 && !window.confirm(`Open ${limited.length} tabs in Brave?`)) return;
  const response = await fetch("/api/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls: limited.map((link) => link.url) })
  });
  const payload = await response.json();
  if (payload.errors?.length) {
    alert(`Opened ${payload.opened.length} tabs. ${payload.errors.length} could not be opened.`);
  }
  if (payload.opened?.length) {
    const opened = new Set(payload.opened);
    await fetch("/api/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys: limited.filter((link) => opened.has(link.url)).map((link) => link.key) })
    });
    await load();
  }
}

function renderTree() {
  const folders = state.mode === "source" ? state.data.folders
    : state.mode === "map" ? state.data.areaFolders
    : state.mode === "today" ? todayFolders()
    : state.data.curatedFolders;
  if (state.mode === "map" && !state.query && !state.mapBrowsePath) {
    $("#tree").innerHTML = "";
    $("#library-main")?.classList.remove("has-tree");
    return;
  }
  if (state.mode === "map" && state.mapBrowsePath && !state.query) {
    const focusedFolder = folderAtPath(state.data.areaFolders, state.mapBrowsePath);
    $("#tree").innerHTML = focusedFolder ? renderFolder(focusedFolder) : `<div class="empty">That branch is no longer available.</div>`;
  } else if (state.query) {
    const results = searchResults();
    const limited = results.slice(0, 150);
    $("#tree").innerHTML = `<section class="search-results"><header><strong>${results.length} matching links</strong><span>Ranked by title, fetched page description, URL, and folder path.</span></header><div class="links">${limited.map(({ link }) => renderLink(link, { showPath: true, showDescription: true })).join("")}</div>${results.length > limited.length ? `<p>Showing the first ${limited.length}. Refine the search to narrow it.</p>` : ""}</section>` || `<div class="empty">Nothing matches “${esc(state.query)}”.</div>`;
  } else {
    const html = folders.map(renderFolder).join("");
    $("#tree").innerHTML = html || `<div class="empty">Nothing matches “${esc(state.query)}” in this view.</div>`;
  }
  $("#library-main")?.classList.toggle("has-tree", Boolean($("#tree").innerHTML));
  document.querySelectorAll("[data-archive-key]").forEach((box) => {
    box.addEventListener("change", async () => {
      if (!box.checked) return;
      box.disabled = true;
      try {
        const published = state.staticSite;
        await archiveLibraryLink(box.dataset.archiveKey);
        if (!published) await load();
      } catch (error) {
        box.checked = false;
        alert(error.message);
      } finally {
        box.disabled = false;
      }
    });
  });
}

function decodeGitHubContent(encoded) {
  return decodeURIComponent(Array.prototype.map.call(atob(encoded.replace(/\n/g, "")), (char) =>
    `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""));
}

function encodeGitHubContent(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

async function githubRequest(path, options = {}) {
  const response = await fetch(`https://api.github.com/repos/Vedant2100/personal-library/contents/${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${state.githubToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "GitHub could not update the library");
  return payload;
}

async function githubFile(path) {
  const payload = await githubRequest(path);
  return { sha: payload.sha, text: decodeGitHubContent(payload.content || "") };
}

async function putGitHubFile(path, text, sha, message) {
  return githubRequest(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, content: encodeGitHubContent(text), sha, branch: "main" })
  });
}

async function verifyGitHubIdentity(token) {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });
  const profile = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(profile.message || "GitHub could not verify this token.");
  if (String(profile.login || "").toLowerCase() !== "vedant2100") {
    throw new Error("This library is restricted to the Vedant2100 GitHub account.");
  }
  return token;
}

async function requestGitHubToken() {
  if (state.githubToken) return verifyGitHubIdentity(state.githubToken);
  const existing = sessionStorage.getItem("personal-library-github-token");
  if (existing) {
    try {
      state.githubToken = await verifyGitHubIdentity(existing);
      return state.githubToken;
    } catch {
      sessionStorage.removeItem("personal-library-github-token");
    }
  }
  const dialog = $("#github-auth-dialog");
  const input = $("#github-token");
  if (!dialog || !input) throw new Error("GitHub authorization form is unavailable.");
  input.value = "";
  dialog.showModal();
  input.focus();
  return new Promise((resolve, reject) => { state.githubAuthPending = { resolve, reject }; });
}

function archiveMarkdownLine(text, key, url) {
  const lines = text.split(/(?<=\n)/);
  const kept = [];
  const archived = [];
  const linkPattern = /^\s*((?:>\s*)+)-\s+\[(.*?)\]\(<(.*?)>\)/;
  for (const line of lines) {
    const match = line.match(linkPattern);
    const arcId = line.match(/arc-id:\s*([A-Za-z0-9-]+)/)?.[1];
    const lineUrl = match?.[3]?.trim();
    const lineKey = arcId || lineUrl;
    if (match && lineKey === key && lineUrl === url) {
      archived.push(`> - [${match[2]}](<${lineUrl}>)${line.slice(match[0].length)}`);
    } else {
      kept.push(line);
    }
  }
  if (archived.length !== 1) throw new Error(`GitHub found ${archived.length} matching links instead of one.`);
  let result = kept.join("").trimEnd() + "\n";
  if (!result.includes("[!note]- 📁 Archived from library")) result += "\n## Library Archive\n\n> [!note]- 📁 Archived from library\n";
  return result + archived.join("");
}

function archiveClassification(text, url) {
  const archive = { group: "Other", area: "Archive", route: "Archived" };
  let records;
  try { records = JSON.parse(text); } catch { records = []; }
  if (!Array.isArray(records)) records = [];
  const found = records.find((record) => record && record.url === url);
  if (found) Object.assign(found, archive);
  else records.push({ url, ...archive });
  return JSON.stringify(records, null, 2) + "\n";
}

function archiveOverrides(text, url) {
  let overrides;
  try { overrides = JSON.parse(text); } catch { overrides = {}; }
  if (!overrides || Array.isArray(overrides) || typeof overrides !== "object") overrides = {};
  overrides[url] = { group: "Other", area: "Archive", route: "Archived" };
  return JSON.stringify(overrides, null, 2) + "\n";
}

function removeVisibleLink(key) {
  const remove = (folders) => folders.forEach((folder) => {
    folder.links = (folder.links || []).filter((link) => link.key !== key);
    remove(folder.folders || []);
    refreshCounts(folder);
  });
  remove(state.data.areaFolders || []);
  remove(state.data.folders || []);
  remove(state.data.curatedFolders || []);
}

async function archiveToGitHub(key) {
  const link = allLinks(state.data.areaFolders).find((item) => item.key === key);
  if (!link) throw new Error("This link is no longer available.");
  await requestGitHubToken();
  const [source, overrides, classifications] = await Promise.all([
    githubFile("snapshots/Personal.md"),
    githubFile("area-overrides.json"),
    githubFile("area-classifications.json")
  ]);
  const message = `archive: ${link.title || link.url}`.slice(0, 120);
  await putGitHubFile("snapshots/Personal.md", archiveMarkdownLine(source.text, link.key, link.url), source.sha, message);
  await putGitHubFile("area-overrides.json", archiveOverrides(overrides.text, link.url), overrides.sha, message);
  await putGitHubFile("area-classifications.json", archiveClassification(classifications.text, link.url), classifications.sha, message);
  removeVisibleLink(key);
  render();
}

async function archiveLibraryLink(key) {
  if (state.staticSite) return archiveToGitHub(key);
  const response = await fetch("/api/archive", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keys: [key] })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) throw new Error(payload.error || "Could not archive this link");
  return payload;
}

function renderMapScopeControls() {
  const roots = new Map((state.data?.areaFolders || []).map((folder) => [folder.name, folder]));
  const maxLinks = Math.max(...[...roots.values()].map((folder) => folder.total), 1);
  document.querySelectorAll(".map-scope-nav").forEach((button) => {
    const folder = roots.get(button.dataset.mapGroup);
    button.textContent = folder ? folder.name : button.dataset.mapGroup;
    if (folder) {
      const share = Math.sqrt(folder.total / maxLinks);
      button.style.setProperty("--brush-size", `${Math.round(24 - share * 12)}px`);
      button.style.setProperty("--scope-opacity", (0.08 + share * 0.22).toFixed(2));
      button.setAttribute("aria-label", `${folder.name}: ${folder.total} links`);
    }
    const active = state.mode === "map" && state.mapGroup === button.dataset.mapGroup;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
}

function renderTodayRefresh() {
  const button = $("#refresh-today");
  if (button) button.hidden = state.mode !== "today";
}

function render() {
  if (!state.data) return;
  renderMapOverview();
  renderTree();
  renderMapScopeControls();
  renderSearchSuggestions();
  renderTodayRefresh();
  document.querySelectorAll(".mode").forEach((button) => button.classList.toggle("active", button.dataset.mode === state.mode));
}

async function load() {
  setSourceStatus("Reading Personal.md…");
  try {
    if (PRIVATE_VERCEL_HOST) {
      await requestGitHubToken();
      state.data = JSON.parse((await githubFile("library-data.json")).text);
    } else {
      let response = await fetch(`/api/library?${Date.now()}`);
      const apiContentType = response.headers.get("content-type") || "";
      if (!response.ok || !apiContentType.includes("application/json")) {
        response = await fetch(`library-data.json?${Date.now()}`);
      }
      if (!response.ok) throw new Error("Could not load the published library data.");
      state.data = await response.json();
    }
    if (state.data.error) throw new Error(state.data.error);
    state.staticSite = Boolean(state.data.staticSite);
    if (state.staticSite) {
      applySavedTaskLinks();
    }
    render();
  } catch (error) {
    setSourceStatus("Could not read Personal.md");
    $("#tree").innerHTML = `<div class="empty">${esc(error.message)}</div>`;
  }
}

document.querySelectorAll(".mode").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".mode").forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
  state.mode = button.dataset.mode;
  render();
}));
document.querySelectorAll(".map-scope-nav").forEach((button) => button.addEventListener("click", () => {
  state.mode = "map";
  state.mapGroup = button.dataset.mapGroup;
  state.mapFocus = null;
  state.mapBrowsePath = null;
  render();
}));
$("#search").addEventListener("input", (event) => { state.query = event.target.value.trim(); render(); });
$("#search").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && state.query) {
    event.preventDefault();
    $("#tree").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  if (event.key === "Escape") {
    event.currentTarget.value = "";
    state.query = "";
    render();
  }
});
$("#refresh-today").addEventListener("click", async () => {
  const button = $("#refresh-today");
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Refreshing…";
  try {
    await load();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
});

$("#sync-tasks").addEventListener("click", async () => {
  const button = $("#sync-tasks");
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Syncing Tasks…";
  try {
    let payload;
    if (state.staticSite) {
      if (typeof window.syncGoogleTasksInBrowser !== "function") throw new Error("Google Tasks authorization is still loading. Try again in a moment.");
      payload = await window.syncGoogleTasksInBrowser({ knownUrls: allLinks(state.data.areaFolders).map((link) => link.url) });
      const imported = persistBrowserTaskLinks(payload.links || []);
      payload.urlsAdded = imported.length;
      payload.urlsReopened = 0;
      payload.urlsExisting = Math.max(0, (payload.urlsFound || 0) - imported.length);
      payload.tasksCompleted = (payload.completedTasks || []).length;
      payload.addedDetails = imported.map((link) => ({ title: link.title || link.url, url: link.url, path: ["Google Tasks", link.listTitle || "Imported"] }));
      state.data.lastTaskSync = payload;
      render();
    } else {
      const response = await fetch("/api/tasks/sync", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
      });
      payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Google Tasks sync failed");
      await load();
    }
    const locationLines = (items) => items.map((item) => `• ${item.title || item.url}\n  → ${(item.path || ["Review"]).join(" / ")}\n  ${item.url}`);
    const message = [
      `Tasks scanned: ${payload.tasksWithUrls}. URLs found: ${payload.urlsFound}.`,
      `Added here: ${payload.urlsAdded || 0}. Already here: ${payload.urlsExisting || 0}.`,
      `Google Tasks completed: ${payload.tasksCompleted || 0}.`
    ];
    if ((payload.addedDetails || []).length) message.push("", "Added:", ...locationLines(payload.addedDetails));
    if ((payload.completionErrors || []).length) message.push("", "Could not complete:", ...(payload.completionErrors || []).map((item) => `• ${item.taskTitle || item.taskId || "Task"}`));
    alert(message.join("\n"));
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
});


const githubAuthDialog = $("#github-auth-dialog");
$("#github-token-submit")?.addEventListener("click", async () => {
  const token = $("#github-token")?.value.trim();
  if (!token) { $("#github-token")?.focus(); return; }
  const button = $("#github-token-submit");
  button.disabled = true;
  button.textContent = "Verifying…";
  try {
    state.githubToken = await verifyGitHubIdentity(token);
    sessionStorage.setItem("personal-library-github-token", state.githubToken);
    const pending = state.githubAuthPending;
    state.githubAuthPending = null;
    githubAuthDialog?.close();
    pending?.resolve(state.githubToken);
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Connect & archive";
  }
});
githubAuthDialog?.addEventListener("close", () => {
  const pending = state.githubAuthPending;
  if (!pending) return;
  state.githubAuthPending = null;
  pending.reject(new Error("GitHub authorization was cancelled."));
});

load();
