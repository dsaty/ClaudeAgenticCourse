const pptxgen = require("pptxgenjs");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");
const fa = require("react-icons/fa");
const JSZip = require("jszip");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// Builds documentation/Claude-Chat-Bot-Architecture.pptx.
// Run from documentation/deck:  npm install && npm run build
// Keep this deck in sync with the code: see CLAUDE.md at the repo root.

const REPO = path.resolve(__dirname, "..", "..");
const OUT = path.join(REPO, "documentation", "Claude-Chat-Bot-Architecture.pptx");

// ---- Read the real tool definitions from backend/tools.py -------------------
// The tool slides take parameter names and allowed values from the schema, and
// the build fails if a tool has no slide spec (or a spec has no tool), so a new
// or changed tool can't silently go undocumented.
function loadToolSchemas() {
  const venvPython = path.join(REPO, "backend", ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const python = fs.existsSync(venvPython) ? venvPython : "python";
  const code = "import json, tools; print(json.dumps(tools.TOOLS))";
  const out = execFileSync(python, ["-W", "ignore", "-c", code], { cwd: path.join(REPO, "backend") });
  return Object.fromEntries(JSON.parse(out.toString()).map((t) => [t.name, t]));
}

// pptxgenjs can't write theme colors, so patch them into the theme part directly.
async function applyTheme(file, theme) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  for (const name of Object.keys(zip.files).filter((n) => /^ppt\/theme\/theme\d+\.xml$/.test(n))) {
    let xml = await zip.file(name).async("string");
    for (const [slot, hex] of Object.entries(theme.colors)) {
      xml = xml.replace(new RegExp(`<a:${slot}>[\\s\\S]*?</a:${slot}>`),
        `<a:${slot}><a:srgbClr val="${hex}"/></a:${slot}>`);
    }
    xml = xml.replace(/<a:clrScheme name="[^"]*"/, `<a:clrScheme name="${theme.name}"`);
    zip.file(name, xml);
  }
  fs.writeFileSync(file, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}

const THEME = {
  name: "Chat Bot Teal",
  headFontFace: "Cambria",
  bodyFontFace: "Calibri",
  colors: {
    dk1: "1A1A1A", lt1: "FFFFFF", dk2: "0F3D3E", lt2: "EDF4F2",
    accent1: "C96442", accent2: "1F7A6D", accent3: "E0A43A",
    accent4: "5F6F6E", accent5: "2E4057", accent6: "9CC3BC",
    hlink: "1F7A6D", folHlink: "5F6F6E",
  },
};
const HEX = THEME.colors;

async function icon(name, hex = "FFFFFF") {
  const svg = ReactDOMServer.renderToStaticMarkup(
    React.createElement(fa[name], { color: "#" + hex, size: 256 })
  );
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return "image/png;base64," + buf.toString("base64");
}

(async () => {
  const TOOL_SCHEMAS = loadToolSchemas();
  const documented = new Set();
  const pres = new pptxgen();
  pres.layout = "LAYOUT_16x9"; // 10 x 5.625 in
  pres.title = "Claude Chat Bot – Architecture and Design";
  pres.author = "Sathyan Doraiswamy";
  pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
  const C = pres.SchemeColor;

  pres.defineSlideMaster({
    title: "CONTENT",
    background: { color: C.background1 },
    objects: [
      { placeholder: { options: { name: "title", type: "title", x: 0.5, y: 0.28, w: 9, h: 0.62,
          fontSize: 36, bold: true, color: C.text2, valign: "middle", align: "left", margin: 0 }, text: "" } },
      { placeholder: { options: { name: "subtitle", type: "body", x: 0.5, y: 0.92, w: 9, h: 0.42,
          fontSize: 14, italic: true, color: C.accent4, valign: "top", margin: 0 }, text: "" } },
      { text: { text: "Claude Chat Bot  ·  Agentic programming course",
          options: { x: 0.5, y: 5.25, w: 6, h: 0.25, fontSize: 10, color: C.accent4, margin: 0 } } },
    ],
    slideNumber: { x: 9.0, y: 5.25, w: 0.5, h: 0.25, fontSize: 10, color: C.accent4, align: "right" },
  });

  const ICON = {};
  for (const n of ["FaGlobe", "FaPython", "FaRobot", "FaChartLine", "FaWrench", "FaShieldAlt",
                   "FaSyncAlt", "FaStream", "FaHistory", "FaCode", "FaCheck", "FaExclamationTriangle"]) {
    ICON[n] = await icon(n);
  }

  // Motif: white icon inside a colored circle.
  function iconCircle(slide, name, x, y, d, fill, label) {
    slide.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: fill }, line: { type: "none" },
      objectName: `${label} icon circle` });
    const pad = d * 0.25;
    slide.addImage({ data: ICON[name], x: x + pad, y: y + pad, w: d - 2 * pad, h: d - 2 * pad,
      altText: label, objectName: `${label} icon` });
  }

  function card(slide, x, y, w, h, name, fill = C.background2) {
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.08,
      fill: { color: fill }, line: { color: HEX.accent6, width: 0.75 }, objectName: name });
  }

  function bullets(items, opts = {}) {
    return items.map((t, i) => ({ text: t, options: { bullet: { indent: 12 }, breakLine: i < items.length - 1, ...opts } }));
  }

  function arrow(slide, x1, y, x2, color, name) {
    // Horizontal arrow; draws right-to-left when x2 < x1.
    const flip = x2 < x1;
    slide.addShape(pres.shapes.LINE, { x: Math.min(x1, x2), y, w: Math.abs(x2 - x1), h: 0,
      flipH: flip, line: { color, width: 1.75, endArrowType: "triangle" }, objectName: name });
  }

  function arrowLabel(slide, text, x, y, w, name) {
    slide.addText(text, { x, y, w, h: 0.22, fontSize: 10, color: C.accent4, align: "center",
      margin: 0, isTextBox: true, objectName: name });
  }

  // ---------------------------------------------------------------- Slide 1
  pres.addSection({ title: "Architecture" });
  const s1 = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Architecture" });
  s1.addText("Architecture: three tiers", { placeholder: "title" });
  s1.addText("The browser never calls Claude directly. The Python backend runs the agent loop and the tools.",
    { placeholder: "subtitle" });

  const colW = 2.5, top = 1.55, fullH = 3.2;
  const xB = 0.5, xS = 3.75, xR = 7.0;

  // Browser
  card(s1, xB, top, colW, fullH, "Browser card");
  iconCircle(s1, "FaGlobe", xB + 0.2, top + 0.2, 0.5, C.accent2, "Browser");
  s1.addText([{ text: "Browser", options: { bold: true, fontSize: 16, color: C.text2, breakLine: true } },
              { text: "Vite + JavaScript", options: { fontSize: 12, color: C.accent4 } }],
    { x: xB + 0.8, y: top + 0.17, w: 1.6, h: 0.58, margin: 0, valign: "middle", isTextBox: true, objectName: "Browser header" });
  s1.addText(bullets(["Model dropdown", "Masked key + eye toggle", "Chat and tool bubbles", "Keeps the full history"]),
    { x: xB + 0.2, y: top + 0.95, w: colW - 0.35, h: 2.1, fontSize: 14, color: C.text1, valign: "top",
      paraSpaceAfter: 6, margin: 0, isTextBox: true, objectName: "Browser bullets" });

  // Backend
  card(s1, xS, top, colW, fullH, "Backend card");
  iconCircle(s1, "FaPython", xS + 0.2, top + 0.2, 0.5, C.accent1, "Backend");
  s1.addText([{ text: "Backend", options: { bold: true, fontSize: 16, color: C.text2, breakLine: true } },
              { text: "Python + FastAPI", options: { fontSize: 12, color: C.accent4 } }],
    { x: xS + 0.8, y: top + 0.17, w: 1.6, h: 0.58, margin: 0, valign: "middle", isTextBox: true, objectName: "Backend header" });
  s1.addText(bullets(["GET /api/models", "POST /api/chat", "Agent loop (app.py)", "Tools (tools.py)"]),
    { x: xS + 0.2, y: top + 0.95, w: colW - 0.35, h: 2.1, fontSize: 14, color: C.text1, valign: "top",
      paraSpaceAfter: 6, margin: 0, isTextBox: true, objectName: "Backend bullets" });

  // Claude API
  const rH = 1.5, yY = top + fullH - rH;
  card(s1, xR, top, colW, rH, "Claude card");
  iconCircle(s1, "FaRobot", xR + 0.2, top + 0.2, 0.5, C.text2, "Claude API");
  s1.addText([{ text: "Claude API", options: { bold: true, fontSize: 16, color: C.text2, breakLine: true } },
              { text: "anthropic SDK", options: { fontSize: 12, color: C.accent4 } }],
    { x: xR + 0.8, y: top + 0.17, w: 1.6, h: 0.58, margin: 0, valign: "middle", isTextBox: true, objectName: "Claude header" });
  s1.addText("Streams replies and decides when to call a tool",
    { x: xR + 0.2, y: top + 0.85, w: colW - 0.35, h: 0.55, fontSize: 14, color: C.text1, margin: 0,
      valign: "top", isTextBox: true, objectName: "Claude description" });

  // Yahoo Finance
  card(s1, xR, yY, colW, rH, "Market data card");
  iconCircle(s1, "FaChartLine", xR + 0.2, yY + 0.2, 0.5, C.accent3, "Market data");
  s1.addText([{ text: "Yahoo Finance", options: { bold: true, fontSize: 16, color: C.text2, breakLine: true } },
              { text: "via yfinance", options: { fontSize: 12, color: C.accent4 } }],
    { x: xR + 0.8, y: yY + 0.17, w: 1.6, h: 0.58, margin: 0, valign: "middle", isTextBox: true, objectName: "Market data header" });
  s1.addText("Name → ticker search, latest and historical prices",
    { x: xR + 0.2, y: yY + 0.85, w: colW - 0.35, h: 0.55, fontSize: 14, color: C.text1, margin: 0,
      valign: "top", isTextBox: true, objectName: "Market data description" });

  // Arrows: browser <-> backend
  const g1a = xB + colW + 0.08, g1b = xS - 0.08;
  arrowLabel(s1, "request", g1a, 2.42, g1b - g1a, "Request label");
  arrow(s1, g1a, 2.7, g1b, HEX.dk2, "Request arrow");
  arrowLabel(s1, "events", g1a, 3.32, g1b - g1a, "Events label");
  arrow(s1, g1b, 3.6, g1a, HEX.accent1, "Events arrow");
  // Backend <-> Claude
  const g2a = xS + colW + 0.08, g2b = xR - 0.08;
  arrowLabel(s1, "stream", g2a, 1.87, g2b - g2a, "Stream label");
  arrow(s1, g2a, 2.15, g2b, HEX.dk2, "Stream arrow");
  arrowLabel(s1, "tool_use", g2a, 2.42, g2b - g2a, "Tool use label");
  arrow(s1, g2b, 2.7, g2a, HEX.accent1, "Tool use arrow");
  // Backend <-> Yahoo
  arrowLabel(s1, "query", g2a, 3.57, g2b - g2a, "Query label");
  arrow(s1, g2a, 3.85, g2b, HEX.dk2, "Query arrow");
  arrowLabel(s1, "prices", g2a, 4.12, g2b - g2a, "Prices label");
  arrow(s1, g2b, 4.4, g2a, HEX.accent1, "Prices arrow");

  s1.addText([
    { text: "Request: ", options: { bold: true } }, { text: "{ api_key, model, messages }      " },
    { text: "Events (NDJSON): ", options: { bold: true } }, { text: "text · tool_call · tool_result · notice · error · done" },
  ], { x: 0.5, y: 4.85, w: 9, h: 0.28, fontSize: 11, color: C.accent4, margin: 0, isTextBox: true, objectName: "Protocol caption" });

  s1.addNotes(
    "Three tiers. The Vite page holds the model choice, the API key and the conversation. " +
    "Each message is POSTed to the FastAPI backend, which calls Claude through the anthropic SDK with streaming. " +
    "When Claude asks for a tool, the backend runs it against Yahoo Finance via yfinance and sends the result back to Claude. " +
    "Progress flows back to the browser as newline-delimited JSON events, so tool calls appear live."
  );

  // ---------------------------------------------------------------- Slide 2
  pres.addSection({ title: "Design" });
  const s2 = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Design" });
  s2.addText("Design: the agent loop", { placeholder: "title" });
  s2.addText("Claude decides when to use a tool; our code runs it and loops until Claude answers.",
    { placeholder: "subtitle" });

  const steps = [
    ["FaRobot", "Send the history to Claude", "messages.stream(model, system, tools, messages)", C.text2],
    ["FaStream", "Stream text to the browser", "Each text chunk becomes a { type: \"text\" } event", C.accent2],
    ["FaWrench", "Run the requested tools", "All tool_result blocks go back in one user message", C.accent1],
    ["FaHistory", "Return the full history", "No tool calls left → done event with API-format messages", C.accent3],
  ];
  const rowY0 = 1.55, rowStep = 0.8, circX = 1.0, circD = 0.55;
  steps.forEach(([ic, head, desc, color], i) => {
    const y = rowY0 + i * rowStep;
    iconCircle(s2, ic, circX, y, circD, color, `Step ${i + 1}`);
    s2.addText([{ text: `${i + 1}. ${head}`, options: { bold: true, fontSize: 15, color: C.text2, breakLine: true } },
                { text: desc, options: { fontSize: 13, color: C.accent4 } }],
      { x: circX + circD + 0.25, y: y - 0.05, w: 4.9, h: 0.65, margin: 0, valign: "middle",
        isTextBox: true, objectName: `Step ${i + 1} text` });
  });
  // Loop arrow: from step 3 back up to step 1, on the left of the circles.
  const loopX = 0.6, yStep1 = rowY0 + circD / 2, yStep3 = rowY0 + 2 * rowStep + circD / 2;
  s2.addShape(pres.shapes.LINE, { x: loopX, y: yStep3, w: circX - loopX, h: 0, flipH: true,
    line: { color: HEX.accent1, width: 1.75 }, objectName: "Loop segment bottom" });
  s2.addShape(pres.shapes.LINE, { x: loopX, y: yStep1, w: 0, h: yStep3 - yStep1,
    line: { color: HEX.accent1, width: 1.75 }, objectName: "Loop segment vertical" });
  s2.addShape(pres.shapes.LINE, { x: loopX, y: yStep1, w: circX - loopX - 0.03, h: 0,
    line: { color: HEX.accent1, width: 1.75, endArrowType: "triangle" }, objectName: "Loop segment top" });
  s2.addText("repeat while Claude calls tools", {
    x: 0.5, y: rowY0 + 3 * rowStep + 0.72, w: 5.5, h: 0.25, fontSize: 11, italic: true, color: C.accent1,
    margin: 0, isTextBox: true, objectName: "Loop caption" });

  // Guardrails card
  const gx = 6.55, gw = 2.95;
  card(s2, gx, 1.55, gw, 3.35, "Guardrails card");
  iconCircle(s2, "FaShieldAlt", gx + 0.2, 1.72, 0.45, C.text2, "Guardrails");
  s2.addText("Guardrails", { x: gx + 0.78, y: 1.72, w: 1.7, h: 0.45, fontSize: 16, bold: true, color: C.text2,
    margin: 0, valign: "middle", isTextBox: true, objectName: "Guardrails header" });
  s2.addText(bullets([
    "Max 10 tool rounds a turn",
    "Cut off mid tool call → error",
    "Refusal → fallback model",
    "Bad tool JSON → retry twice",
    "History replayed unchanged",
  ]), { x: gx + 0.2, y: 2.35, w: gw - 0.35, h: 2.4, fontSize: 14, color: C.text1, valign: "top",
        paraSpaceAfter: 6, margin: 0, isTextBox: true, objectName: "Guardrails bullets" });

  s2.addNotes(
    "The loop lives in backend/app.py. Each round sends the whole conversation to Claude with the tool definitions. " +
    "If the reply contains tool_use blocks, the backend runs every tool and returns all results in a single user message, then calls Claude again. " +
    "When Claude answers without tools, the backend sends a done event carrying the full conversation in API format; the browser sends it back unchanged next turn, " +
    "which keeps tool results and thinking blocks valid. Guardrails stop runaway loops, unsafe truncated tool calls, and malformed tool input."
  );

  // ---------------------------------------------------------------- Slide 3
  pres.addSection({ title: "Tool design" });
  const s3 = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Tool design" });
  s3.addText("Tool design: overview", { placeholder: "title" });
  s3.addText("Each tool is a schema Claude reads plus a Python function the backend runs.",
    { placeholder: "subtitle" });

  const tW = 4.35, tY = 1.55, tH = 1.8;
  const tools = [
    { x: 0.5, ic: "FaChartLine", color: C.accent2, name: "get_latest_stock_price",
      rows: [["Input", "stock_name"], ["Returns", "symbol, name, price, currency, exchange"],
             ["Example", "\"Apple\" → AAPL, 331.80 USD on NASDAQ"]] },
    { x: 5.15, ic: "FaHistory", color: C.accent1, name: "get_historical_stock_prices",
      rows: [["Input", "stock_name, interval, date_range"], ["interval", "1h · 1d · 1wk · 1mo · 3mo"],
             ["date_range", "5d … 10y · ytd · max"], ["Returns", "up to 500 closes: { date, close }"]] },
  ];
  const overviewNames = tools.map((t) => t.name).sort().join(", ");
  if (overviewNames !== Object.keys(TOOL_SCHEMAS).sort().join(", ")) {
    throw new Error(`Overview slide lists [${overviewNames}] but backend/tools.py has [${Object.keys(TOOL_SCHEMAS).sort().join(", ")}]. Update the overview slide.`);
  }
  for (const t of tools) {
    card(s3, t.x, tY, tW, tH, `${t.name} card`, C.background1);
    iconCircle(s3, t.ic, t.x + 0.2, tY + 0.18, 0.45, t.color, t.name);
    s3.addText(t.name, { x: t.x + 0.78, y: tY + 0.18, w: tW - 0.95, h: 0.45, fontFace: "Courier New",
      fontSize: 14, bold: true, color: C.text2, margin: 0, valign: "middle", isTextBox: true, objectName: `${t.name} name` });
    const runs = [];
    t.rows.forEach(([k, v], i) => {
      runs.push({ text: `${k}: `, options: { bold: true, color: C.text2 } });
      runs.push({ text: v, options: { color: C.text1, breakLine: i < t.rows.length - 1 } });
    });
    s3.addText(runs, { x: t.x + 0.2, y: tY + 0.75, w: tW - 0.35, h: tH - 0.85, fontSize: 13, margin: 0,
      valign: "top", paraSpaceAfter: 2, isTextBox: true, objectName: `${t.name} details` });
  }

  const principles = [
    ["FaCode", "Schema + function", "Claude only sees the schema; Python does the work"],
    ["FaCheck", "Validate every input", "Required fields, enum values, unknown parameters"],
    ["FaExclamationTriangle", "Errors are answers", "is_error results let Claude fix its call and retry"],
  ];
  const pY = 3.6, pW = 2.83, pH = 1.3, pGap = 0.25;
  principles.forEach(([ic, head, desc], i) => {
    const x = 0.5 + i * (pW + pGap);
    card(s3, x, pY, pW, pH, `Principle ${i + 1} card`);
    iconCircle(s3, ic, x + 0.18, pY + 0.18, 0.4, C.text2, head);
    s3.addText(head, { x: x + 0.7, y: pY + 0.18, w: pW - 0.85, h: 0.4, fontSize: 15, bold: true, color: C.text2,
      margin: 0, valign: "middle", isTextBox: true, objectName: `Principle ${i + 1} header` });
    s3.addText(desc, { x: x + 0.18, y: pY + 0.66, w: pW - 0.3, h: pH - 0.72, fontSize: 13, color: C.text1,
      margin: 0, valign: "top", isTextBox: true, objectName: `Principle ${i + 1} text` });
  });

  s3.addNotes(
    "Two tools live in backend/tools.py. Both resolve a company name or ticker through Yahoo search, so 'Apple' and 'AAPL' both work. " +
    "The historical tool uses enum values for interval and date_range so Claude can only choose valid options. " +
    "Inputs are validated against the schema in code, because with eager input streaming the API does not validate them. " +
    "Failures are returned as is_error tool results, not exceptions: for example daily prices over 'max' would be about 10,000 points, " +
    "so the tool tells Claude to pick a coarser interval and Claude retries on its own."
  );

  // ------------------------------------------------- Slides 4-5: one per tool
  // Each reads left to right: Input → Processing → Output.
  function toolDetailSlide(spec) {
    const tool = TOOL_SCHEMAS[spec.name];
    if (!tool) throw new Error(`Slide spec for '${spec.name}' but no such tool in backend/tools.py. Remove or rename the spec.`);
    const schema = tool.input_schema;
    const real = Object.keys(schema.properties).sort().join(", ");
    const described = Object.keys(spec.params).sort().join(", ");
    if (real !== described) {
      throw new Error(`Tool '${spec.name}' has parameters [${real}] but its slide describes [${described}]. Update its slide spec.`);
    }
    documented.add(spec.name);
    const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Tool design" });
    s.addText([{ text: "Tool: ", options: {} },
               { text: spec.name, options: { fontFace: "Courier New", fontSize: 26 } }], { placeholder: "title" });
    s.addText(spec.subtitle, { placeholder: "subtitle" });

    const top = 1.5, h = 3.45;
    const cols = { in: { x: 0.5, w: 2.25 }, proc: { x: 3.1, w: 3.6 }, out: { x: 7.05, w: 2.45 } };

    function column(key, label, ic, fill) {
      const { x, w } = cols[key];
      card(s, x, top, w, h, `${label} card`, key === "proc" ? C.background1 : C.background2);
      iconCircle(s, ic, x + 0.18, top + 0.16, 0.4, fill, label);
      s.addText(label, { x: x + 0.68, y: top + 0.16, w: w - 0.8, h: 0.4, fontSize: 16, bold: true,
        color: C.text2, margin: 0, valign: "middle", isTextBox: true, objectName: `${label} header` });
    }
    column("in", "Input", "FaCode", C.accent2);
    column("proc", "Processing", "FaSyncAlt", C.accent1);
    column("out", "Output", "FaCheck", C.text2);

    // Flow arrows between the columns.
    const ay = top + h / 2;
    arrow(s, cols.in.x + cols.in.w + 0.05, ay, cols.proc.x - 0.05, HEX.accent4, "Input to processing arrow");
    arrow(s, cols.proc.x + cols.proc.w + 0.05, ay, cols.out.x - 0.05, HEX.accent4, "Processing to output arrow");

    // Input: one block per parameter. Names, order and allowed values come from
    // the real schema; the spec only supplies a short label and an example.
    const inRuns = [];
    const params = Object.entries(schema.properties);
    params.forEach(([pname, prop], i) => {
      const [label, example] = spec.params[pname];
      const values = prop.enum ? prop.enum.join(" · ") : example;
      inRuns.push({ text: pname, options: { fontFace: "Courier New", bold: true, fontSize: 13, color: C.text2, breakLine: true } });
      inRuns.push({ text: label, options: { fontSize: 12, color: C.text1, breakLine: true } });
      inRuns.push({ text: values, options: { fontSize: 12, color: C.accent4, breakLine: i < params.length - 1,
        paraSpaceAfter: 8 } });
    });
    const allStrings = params.every(([, p]) => p.type === "string");
    const allRequired = params.every(([n]) => (schema.required || []).includes(n));
    const inputNote = [allStrings ? "All strings" : "Mixed types", allRequired ? "all required" : "some optional"].join(", ");
    s.addText(inRuns, { x: cols.in.x + 0.18, y: top + 0.72, w: cols.in.w - 0.3, h: h - 1.25, margin: 0,
      valign: "top", isTextBox: true, objectName: "Input parameters" });
    s.addText(inputNote, { x: cols.in.x + 0.18, y: top + h - 0.45, w: cols.in.w - 0.3, h: 0.3,
      fontSize: 11, italic: true, color: C.accent4, margin: 0, isTextBox: true, objectName: "Input note" });

    // Processing: numbered steps.
    const stepTop = top + 0.75, stepH = (h - 0.9) / spec.steps.length, nd = 0.32;
    spec.steps.forEach(([head, desc], i) => {
      const y = stepTop + i * stepH;
      s.addShape(pres.shapes.OVAL, { x: cols.proc.x + 0.2, y: y + 0.03, w: nd, h: nd, fill: { color: C.accent1 },
        line: { type: "none" }, objectName: `Step ${i + 1} marker` });
      s.addText(String(i + 1), { x: cols.proc.x + 0.2, y: y + 0.03, w: nd, h: nd, fontSize: 12, bold: true,
        color: C.background1, align: "center", valign: "middle", margin: 0, isTextBox: true, objectName: `Step ${i + 1} number` });
      s.addText([{ text: head, options: { bold: true, fontSize: 13, color: C.text2, breakLine: true } },
                 { text: desc, options: { fontSize: 12, color: C.accent4 } }],
        { x: cols.proc.x + 0.65, y, w: cols.proc.w - 0.8, h: stepH - 0.04, margin: 0, valign: "top",
          isTextBox: true, objectName: `Step ${i + 1} text` });
    });

    // Output: returned fields, then the error cases.
    const outRuns = [];
    spec.fields.forEach(([f, v]) => {
      outRuns.push({ text: f + "  ", options: { fontFace: "Courier New", bold: true, fontSize: 12, color: C.text2 } });
      outRuns.push({ text: v, options: { fontSize: 12, color: C.text1, breakLine: true } });
    });
    outRuns.push({ text: "On error (is_error: true)", options: { bold: true, fontSize: 12, color: C.accent1, breakLine: true } });
    spec.errors.forEach((e, i) => {
      outRuns.push({ text: e, options: { fontSize: 11, italic: true, color: C.accent4, bullet: { indent: 10 },
        breakLine: i < spec.errors.length - 1 } });
    });
    s.addText(outRuns, { x: cols.out.x + 0.18, y: top + 0.72, w: cols.out.w - 0.3, h: h - 0.85, margin: 0,
      valign: "top", paraSpaceAfter: 3, isTextBox: true, objectName: "Output fields and errors" });

    s.addNotes(spec.notes);
  }

  toolDetailSlide({
    name: "get_latest_stock_price",
    subtitle: "Turns a company name or ticker into its latest traded price.",
    params: { stock_name: ["Company name or ticker", "e.g. \"Apple\", \"MSFT\""] },
    steps: [
      ["Validate the input", "run_tool() checks it against the schema"],
      ["Resolve the name", "yf.Search(name) → first EQUITY or ETF"],
      ["Fetch the price", "Ticker(symbol).fast_info.last_price"],
      ["Build the result", "Round price; add exchange, UTC time"],
    ],
    fields: [["symbol", "\"AAPL\""], ["name", "\"Apple Inc.\""], ["price", "331.8"], ["currency", "\"USD\""],
             ["exchange", "\"NASDAQ\""], ["retrieved_at", "UTC time"]],
    errors: ["Missing or empty stock_name", "No stock matches the name", "No price data for the symbol"],
    notes:
      "Input: a single string, either a company name or a ticker. run_tool() validates it against the tool's schema first, " +
      "because with eager input streaming the API does not. Processing: yfinance's Search finds the best match, and we take the first result " +
      "whose quote type is EQUITY or ETF, which skips futures and options. fast_info gives the last traded price and currency. " +
      "Output: a JSON object with the resolved symbol and name, the price rounded to two decimals, the currency, the exchange and a UTC timestamp. " +
      "Any failure comes back to Claude as an is_error tool result with a readable message.",
  });

  toolDetailSlide({
    name: "get_historical_stock_prices",
    subtitle: "Returns one closing price per interval over the chosen date range.",
    params: {
      stock_name: ["Company name or ticker", "e.g. \"Tesla\", \"TSLA\""],
      interval: ["Time between closes"],      // allowed values come from the schema enum
      date_range: ["How far back from today"],
    },
    steps: [
      ["Validate the input", "Required strings; enum values only"],
      ["Check the hourly limit", "1h only with ranges up to 1 year"],
      ["Resolve the name", "yf.Search(name) → first EQUITY or ETF"],
      ["Fetch the history", "Ticker.history(period, interval)"],
      ["Check and shape", "≤ 500 rows → list of {date, close}"],
    ],
    fields: [["symbol", "\"AAPL\""], ["name", "\"Apple Inc.\""], ["currency", "\"USD\""], ["interval", "\"1wk\""], ["date_range", "\"3mo\""],
             ["count", "14"], ["closes", "[{date, close}, …]"]],
    errors: ["1h with a range over 1y", "More than 500 prices", "No stock or no data"],
    notes:
      "Input: the stock name plus two enum parameters. interval sets the spacing between closing prices and date_range how far back to go; " +
      "because both are enums in the schema, Claude can only pick values Yahoo supports. Processing: after validation we reject hourly data " +
      "for ranges longer than a year, since Yahoo only keeps about 730 days of hourly prices. Then we resolve the name, fetch the history, " +
      "and refuse empty results or more than 500 rows so the tool result stays small. Each row becomes {date, close}, with the time included for hourly data. " +
      "Output: the symbol, name, currency, the echoed parameters, a count and the list of closes. The error messages tell Claude how to fix its call, " +
      "for example asking for daily prices over 'max' returns about 10,000 rows, so Claude is told to use a coarser interval and retries on its own.",
  });

  const missing = Object.keys(TOOL_SCHEMAS).filter((n) => !documented.has(n));
  if (missing.length) {
    throw new Error(`No slide for tool(s): ${missing.join(", ")}. Add a toolDetailSlide({...}) spec for each.`);
  }

  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  console.log("wrote", OUT);
})().catch((e) => { console.error(e); process.exit(1); });
