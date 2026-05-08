const SOURCES = [
  {
    id: "chatgpt",
    name: "ChatGPT Release Notes",
    url: "https://help.openai.com/en/articles/6825453-chatgpt-release-notes",
    kind: "html",
    fallbackUrl: "https://r.jina.ai/http://r.jina.ai/http://https://help.openai.com/en/articles/6825453-chatgpt-release-notes"
  },
  {
    id: "codex",
    name: "OpenAI Codex Changelog",
    url: "https://developers.openai.com/codex/changelog",
    kind: "html"
  },
  {
    id: "openai-codex-releases",
    name: "OpenAI Codex GitHub Releases",
    url: "https://api.github.com/repos/openai/codex/releases?per_page=5",
    kind: "github"
  },
  {
    id: "claude-code-releases",
    name: "Claude Code GitHub Releases",
    url: "https://api.github.com/repos/anthropics/claude-code/releases?per_page=5",
    kind: "github"
  },
  {
    id: "claude-platform",
    name: "Claude Platform Release Notes",
    url: "https://platform.claude.com/docs/en/release-notes/overview",
    kind: "html"
  }
];

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function todayInShanghai() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function htmlToText(html) {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function sentencePreview(text, maxLength = 500) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trim()}...`;
}

function classifyScope(text, sourceId) {
  const haystack = `${sourceId} ${text}`.toLowerCase();
  const labels = [];

  if (haystack.includes("chatgpt")) labels.push("ChatGPT 客户端/Web");
  if (haystack.includes("codex")) labels.push("Codex");
  if (haystack.includes("claude code")) labels.push("Claude Code");
  if (haystack.includes("api") || haystack.includes("managed agents")) labels.push("API");
  if (haystack.includes("cli") || haystack.includes("command-line") || haystack.includes("terminal")) labels.push("CLI");
  if (haystack.includes("vscode") || haystack.includes("vs code") || haystack.includes("ide extension")) labels.push("IDE 插件");
  if (haystack.includes("plugin")) labels.push("插件系统");
  if (haystack.includes("web")) labels.push("Web");
  if (haystack.includes("macos") || haystack.includes("mac os")) labels.push("macOS 专属/相关");
  if (haystack.includes("windows") || haystack.includes("winget") || haystack.includes("powershell")) labels.push("Windows 专属/相关");
  if (haystack.includes("linux")) labels.push("Linux 专属/相关");
  if (haystack.includes("ios") || haystack.includes("android") || haystack.includes("mobile")) labels.push("移动端");

  return labels.length ? Array.from(new Set(labels)).join("；") : "平台范围未明确";
}

function makeUpdate({ product, date, sourceName, sourceUrl, title, text, official = true, sourceId }) {
  const scope = classifyScope(`${title} ${text}`, sourceId);
  const description = sentencePreview(text || title, 360);

  return {
    product,
    date,
    sourceName,
    sourceUrl,
    title,
    official,
    scope,
    description,
    impact: inferImpact(scope, product),
    action: inferAction(scope, title, description)
  };
}

function inferImpact(scope, product) {
  if (scope.includes("API")) return "开发者、自动化工作流、平台集成维护者";
  if (scope.includes("CLI") || scope.includes("IDE")) return "开发者、本地编码工作流、插件使用者";
  if (scope.includes("插件")) return "插件作者、插件使用者、团队管理员";
  if (product.includes("ChatGPT")) return "普通用户、重度 ChatGPT 用户、自动化辅助工作流";
  return "开发者、团队管理员、自动化工作流";
}

function inferAction(scope, title, description) {
  const text = `${title} ${description}`.toLowerCase();
  if (text.includes("fix") || text.includes("fixed") || text.includes("修复")) return "建议相关用户升级或验证是否已恢复。";
  if (text.includes("beta")) return "可小范围试用；生产环境谨慎接入。";
  if (scope.includes("插件")) return "插件作者建议检查 manifest/API 兼容性，普通用户可按需升级。";
  if (scope.includes("CLI") || scope.includes("IDE")) return "建议升级后观察现有工作流是否需要调整。";
  return "值得尝试；如用于固定自动化流程，建议先跑一次测试。";
}

function parseGithubReleases(source, releases) {
  const filtered = releases.filter((release) => {
    if (source.id === "openai-codex-releases") {
      return !release.prerelease && release.body && release.body.trim().length > 80;
    }
    return true;
  });

  return filtered.slice(0, 4).map((release) => makeUpdate({
    product: source.id.includes("claude") ? "Claude Code" : "Codex",
    date: (release.published_at || release.created_at || "").slice(0, 10) || "日期未明确",
    sourceName: source.name,
    sourceUrl: release.html_url || source.url,
    title: release.name || release.tag_name,
    text: release.body || release.name || release.tag_name,
    sourceId: source.id
  }));
}

function parseChatGpt(source, text) {
  const match = text.match(/(May \d{1,2}, 2026)([\s\S]*?)(April \d{1,2}, 2026|$)/i);
  if (!match) return [];
  const section = match[2];
  const headings = [
    "Memory sources and more personalized responses in ChatGPT",
    "GPT-5.5 Instant in ChatGPT",
    "ChatGPT for Excel and Google Sheets"
  ];

  return headings
    .filter((heading) => section.includes(heading))
    .map((heading, index) => {
      const nextHeading = headings[index + 1];
      const start = section.indexOf(heading);
      const end = nextHeading && section.indexOf(nextHeading) > start ? section.indexOf(nextHeading) : section.length;
      return makeUpdate({
        product: "ChatGPT",
        date: "2026-05-05",
        sourceName: source.name,
        sourceUrl: source.url,
        title: heading,
        text: section.slice(start + heading.length, end),
        sourceId: source.id
      });
    });
}

function parseClaudePlatform(source, text) {
  const match = text.match(/May 6, 2026([\s\S]*?)(April 30, 2026|$)/i);
  if (!match) return [];
  return [
    makeUpdate({
      product: "Claude Platform",
      date: "2026-05-06",
      sourceName: source.name,
      sourceUrl: source.url,
      title: "Managed Agents public beta updates",
      text: match[1],
      sourceId: source.id
    })
  ];
}

function parseCodexChangelog(source, text) {
  const updates = [];
  const pluginMatch = text.match(/2026-04-30([\s\S]*?)(2026-04-23|$)/i);
  if (pluginMatch) {
    updates.push(makeUpdate({
      product: "Codex CLI",
      date: "2026-04-30",
      sourceName: source.name,
      sourceUrl: source.url,
      title: "Codex CLI workflow and plugin updates",
      text: pluginMatch[1],
      sourceId: source.id
    }));
  }

  const gptMatch = text.match(/2026-04-23([\s\S]*?)(2026-04-20|$)/i);
  if (gptMatch) {
    updates.push(makeUpdate({
      product: "Codex",
      date: "2026-04-23",
      sourceName: source.name,
      sourceUrl: source.url,
      title: "GPT-5.5 and Codex app/plugin updates",
      text: gptMatch[1],
      sourceId: source.id
    }));
  }

  return updates;
}

async function fetchSource(source) {
  let response = await fetch(source.url, {
    headers: {
      "Accept": source.kind === "github" ? "application/vnd.github+json" : "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      "User-Agent": "Mozilla/5.0 (compatible; TaskAutomation AI updates email)"
    }
  });

  if (!response.ok && source.fallbackUrl) {
    response = await fetch(source.fallbackUrl, {
      headers: {
        "Accept": "text/plain,text/markdown",
        "User-Agent": "TaskAutomation AI updates email"
      }
    });
  }

  if (!response.ok) {
    throw new Error(`${source.name} returned HTTP ${response.status}`);
  }

  if (source.kind === "github") {
    return parseGithubReleases(source, await response.json());
  }

  const text = htmlToText(await response.text());
  if (source.id === "chatgpt") return parseChatGpt(source, text);
  if (source.id === "claude-platform") return parseClaudePlatform(source, text);
  if (source.id === "codex") return parseCodexChangelog(source, text);
  return [];
}

async function collectUpdates() {
  const settled = await Promise.allSettled(SOURCES.map(fetchSource));
  const updates = [];
  const errors = [];

  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      updates.push(...result.value);
    } else {
      errors.push(`${SOURCES[index].name}: ${result.reason.message}`);
    }
  });

  updates.sort((a, b) => b.date.localeCompare(a.date));
  return { updates, errors };
}

function buildEmail({ date, updates, errors }) {
  const checkedSources = SOURCES.map((source) => `- ${source.name}: ${source.url}`).join("\n");
  const todayUpdates = updates.filter((update) => update.date === date);
  const intro = todayUpdates.length
    ? `今天发现 ${todayUpdates.length} 条 ${date} 的官方/准官方更新。`
    : `今天未发现 ${date} 当日发布的官方更新。以下是截至今天可验证的最新官方/准官方更新。`;

  const items = updates.length
    ? updates.slice(0, 12).map((update, index) => [
        `${index + 1}. ${update.product}：${update.title}`,
        `- 更新日期：${update.date}`,
        `- 来源：${update.sourceUrl}`,
        `- 适用范围标签：${update.scope}`,
        `- 功能描述：${update.description}`,
        `- 影响范围：${update.impact}`,
        `- 实际影响：${update.description}`,
        `- 建议动作：${update.action}`
      ].join("\n")).join("\n\n")
    : "未提取到可汇总的更新条目。";

  const errorBlock = errors.length
    ? `\n\n本次检查中有来源读取失败：\n${errors.map((error) => `- ${error}`).join("\n")}`
    : "";

  return {
    subject: `今日 AI 工具更新简报｜${date}`,
    body: [
      `今日 AI 工具更新简报`,
      `日期：${date}（Asia/Shanghai）`,
      "",
      intro,
      "",
      items,
      "",
      "今日检查过的主要来源：",
      checkedSources,
      "",
      "备注：本邮件由 GitHub Actions 云端定时任务自动发送；社区传闻不会作为官方结论。"
    ].join("\n") + errorBlock
  };
}

function encodeHeader(value) {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function base64UrlEncode(value) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function getGmailAccessToken({ clientId, clientSecret, refreshToken }) {
  const body = new URLSearchParams({
    client_id: clientId,
    refresh_token: refreshToken,
    grant_type: "refresh_token"
  });

  if (clientSecret) {
    body.set("client_secret", clientSecret);
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Failed to refresh Gmail access token: ${JSON.stringify(payload)}`);
  }

  if (!payload.access_token) {
    throw new Error("Google OAuth token response did not include access_token");
  }

  return payload.access_token;
}

async function sendMailWithGmailApi({ accessToken, from, to, subject, body }) {
  const message = [
    from ? `From: ${from}` : null,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    body.replace(/\r?\n/g, "\r\n")
  ].filter(Boolean).join("\r\n");

  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ raw: base64UrlEncode(message) })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Failed to send Gmail API message: ${JSON.stringify(payload)}`);
  }

  return payload;
}

async function main() {
  const date = process.env.REPORT_DATE || todayInShanghai();
  const { updates, errors } = await collectUpdates();
  const email = buildEmail({ date, updates, errors });

  if (process.env.DRY_RUN === "1") {
    console.log(`Subject: ${email.subject}`);
    console.log(email.body);
    return;
  }

  const accessToken = await getGmailAccessToken({
    clientId: requiredEnv("GOOGLE_CLIENT_ID"),
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    refreshToken: requiredEnv("GOOGLE_REFRESH_TOKEN")
  });

  await sendMailWithGmailApi({
    accessToken,
    from: process.env.EMAIL_FROM || "",
    to: process.env.EMAIL_TO || "deng1543659807@gmail.com",
    subject: email.subject,
    body: email.body
  });

  console.log(`Sent AI updates email to ${process.env.EMAIL_TO || "deng1543659807@gmail.com"}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
