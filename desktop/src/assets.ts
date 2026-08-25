import appJavaScriptFile from "../../python/isbn_zotero/static/app.js" with { type: "file" };
import indexHTMLFile from "../../python/isbn_zotero/static/index.html" with { type: "file" };
import styleCSSFile from "../../python/isbn_zotero/static/style.css" with { type: "file" };

export const STATIC_ASSETS = {
  "/": { file: indexHTMLFile as unknown as string, contentType: "text/html; charset=utf-8" },
  "/index.html": { file: indexHTMLFile as unknown as string, contentType: "text/html; charset=utf-8" },
  "/app.js": { file: appJavaScriptFile, contentType: "text/javascript; charset=utf-8" },
  "/style.css": { file: styleCSSFile, contentType: "text/css; charset=utf-8" },
} as const;
