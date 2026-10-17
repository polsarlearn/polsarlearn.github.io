// Builds infi_website/data/kb.json, the knowledge base the chat widget searches.
// Run from the repo root after editing site content:  node tools/build-kb.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SITE = path.join(__dirname, "../infi_website");
const DATA_DIR = path.join(SITE, "data");
const HTML_DIR = path.join(SITE, "HTML");

const STATIC_SOURCES = [
  { file: "books.json", page: "Books.html", label: "Book" },
  { file: "technical.json", page: "Technical Paper.html", label: "Technical Paper" },
  { file: "fundamental.json", page: "Fundamental.html", label: "Fundamental Concept" },
  { file: "videos.json", page: "Videos.html", label: "Video Lecture" },
];

const JS_DATA_SOURCES = [
  { file: "career.html", varName: "companies", label: "Career/Industry Company", nameKeys: ["name"], textKeys: ["details"], linkKeys: ["link"] },
  { file: "Books.html", varName: "books", label: "Book", nameKeys: ["title"], textKeys: ["author", "desc"], linkKeys: ["link"] },
];

const PAGE_EXCLUDE = new Set([
  "login.html", "otpVerify.html", "Dashboard.html", "mobile-test.html",
  "responsive-test.html", "redirect.html", "blogwrite.html", "blogwrite_1.html",
  "post1.html", "text.html", "a.html",
]);

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

function stripTags(html) {
  return html
    .replace(/<(script|style|nav)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;/g, (m) => ENTITIES[m])
    .replace(/\s+/g, " ")
    .trim();
}

function splitLongText(text, maxLen = 700) {
  if (text.length <= maxLen) return [text];
  const parts = [];
  let current = "";
  for (const word of text.split(" ")) {
    if ((current + " " + word).trim().length > maxLen) {
      if (current) parts.push(current.trim());
      current = word;
    } else {
      current = (current + " " + word).trim();
    }
  }
  if (current) parts.push(current.trim());
  return parts;
}

function flatten(node, out) {
  if (node && typeof node === "object" && !Array.isArray(node)) {
    if (node.title) out.push(node);
    else Object.values(node).forEach((v) => flatten(v, out));
  }
  return out;
}

function staticDocs() {
  const docs = [];
  for (const src of STATIC_SOURCES) {
    const json = JSON.parse(fs.readFileSync(path.join(DATA_DIR, src.file), "utf8"));
    for (const item of flatten(json, [])) {
      const text = Object.entries(item)
        .filter(([k, v]) => k !== "title" && k !== "link" && k !== "image_link" && typeof v === "string" && v.trim())
        .map(([k, v]) => `${k}: ${v}`)
        .join(" | ");
      const link = typeof item.link === "string" && item.link.startsWith("http") ? item.link : null;
      splitLongText(text).forEach((part) =>
        docs.push({ source: src.label, title: item.title, text: part, link, page: src.page })
      );
    }
  }
  return docs;
}

function balancedArray(content, open) {
  let depth = 0;
  let str = null;
  for (let i = open; i < content.length; i++) {
    const ch = content[i];
    if (str) {
      if (ch === "\\") i++;
      else if (ch === str) str = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") str = ch;
    else if (ch === "[") depth++;
    else if (ch === "]" && --depth === 0) return content.slice(open, i + 1);
  }
  return null;
}

function embeddedDocs() {
  const docs = [];
  for (const src of JS_DATA_SOURCES) {
    const raw = fs.readFileSync(path.join(HTML_DIR, src.file), "utf8");
    const marker = `const ${src.varName} = [`;
    const at = raw.indexOf(marker);
    if (at === -1) continue;
    const literal = balancedArray(raw, at + marker.length - 1);
    if (!literal) continue;
    let items;
    try {
      items = vm.runInNewContext(`(${literal})`, {}, { timeout: 1000 });
    } catch (err) {
      console.warn(`skip ${src.file}: ${err.message}`);
      continue;
    }
    for (const item of items) {
      const title = src.nameKeys.map((k) => item[k]).find(Boolean) || "Untitled";
      const text = src.textKeys.map((k) => item[k]).filter(Boolean).join(" | ");
      const link = src.linkKeys.map((k) => item[k]).find((v) => v && v !== "#") || null;
      docs.push({ source: src.label, title, text, link, page: src.file });
    }
  }
  return docs;
}

function pageDocs() {
  const docs = [];
  for (const f of fs.readdirSync(HTML_DIR)) {
    if (!f.toLowerCase().endsWith(".html") || PAGE_EXCLUDE.has(f)) continue;
    const text = stripTags(fs.readFileSync(path.join(HTML_DIR, f), "utf8"));
    if (text.length < 80) continue;
    const title = f.replace(/\.html$/i, "").replace(/[-_]/g, " ");
    splitLongText(text).forEach((part) =>
      docs.push({ source: "Website page", title, text: part, link: null, page: f })
    );
  }
  return docs;
}

const kb = [...staticDocs(), ...embeddedDocs(), ...pageDocs()];
fs.writeFileSync(path.join(DATA_DIR, "kb.json"), JSON.stringify(kb));
console.log(`kb.json: ${kb.length} entries, ${(JSON.stringify(kb).length / 1024).toFixed(0)} KB`);
