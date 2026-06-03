const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
  VerticalAlign, PageNumber, Header, Footer, LevelFormat, PageBreak,
  ExternalHyperlink
} = require('docx');
const fs = require('fs');

// ── COLOURS ──────────────────────────────────────────────────
const BLACK     = "111111";
const GOLD      = "C9A84C";
const DARK_GREY = "333333";
const MID_GREY  = "666666";
const LIGHT_BG  = "F8F6F1";
const RED_BG    = "FDF0EF";
const RED_BORDER= "D94F3D";
const GREEN_BG  = "EFF7F0";
const GREEN_BDR = "2E7D4F";
const BLUE_BG   = "EEF4FB";
const BLUE_BDR  = "2563A8";
const BORDER_C  = "DDDDDD";

// ── HELPERS ───────────────────────────────────────────────────
const sp = (before=0, after=0) => ({ spacing: { before, after } });
const cellBorder = (color=BORDER_C) => {
  const b = { style: BorderStyle.SINGLE, size: 1, color };
  return { top:b, bottom:b, left:b, right:b };
};
const noBorder = () => {
  const b = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  return { top:b, bottom:b, left:b, right:b };
};

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text, font:"Arial", size:32, bold:true, color:BLACK })],
    spacing: { before:480, after:200 },
    border: { bottom: { style:BorderStyle.SINGLE, size:6, color:GOLD, space:6 } }
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text, font:"Arial", size:24, bold:true, color:DARK_GREY })],
    spacing: { before:320, after:120 }
  });
}
function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [new TextRun({ text, font:"Arial", size:22, bold:true, color:MID_GREY })],
    spacing: { before:200, after:80 }
  });
}
function body(text, opts={}) {
  return new Paragraph({
    children: [new TextRun({ text, font:"Arial", size:20, color:opts.color||DARK_GREY, bold:opts.bold||false, italics:opts.italic||false })],
    spacing: { before:40, after:40 },
    ...opts.para
  });
}
function bullet(text, color=DARK_GREY) {
  return new Paragraph({
    numbering: { reference:"bullets", level:0 },
    children: [new TextRun({ text, font:"Arial", size:20, color })],
    spacing: { before:40, after:40 }
  });
}
function flagBullet(text, type="flag") {
  const colors = { flag:"D94F3D", strength:"2E7D4F", opportunity:"2563A8" };
  const icons  = { flag:"⚑", strength:"✓", opportunity:"→" };
  return new Paragraph({
    numbering: { reference:"bullets", level:0 },
    children: [new TextRun({ text:`${icons[type]}  ${text}`, font:"Arial", size:20, color:colors[type] })],
    spacing: { before:60, after:60 }
  });
}
function pageBreak() {
  return new Paragraph({ children:[new PageBreak()] });
}
function spacer(n=1) {
  return Array(n).fill(new Paragraph({ children:[new TextRun("")], spacing:{before:0,after:0} }));
}

// ── TABLE HELPERS ─────────────────────────────────────────────
function headerRow(cells, widths, bgColor=GOLD) {
  return new TableRow({
    tableHeader: true,
    children: cells.map((text, i) => new TableCell({
      borders: cellBorder(GOLD),
      width: { size: widths[i], type: WidthType.DXA },
      shading: { fill: bgColor, type: ShadingType.CLEAR },
      margins: { top:80, bottom:80, left:120, right:120 },
      verticalAlign: VerticalAlign.CENTER,
      children: [new Paragraph({ children:[new TextRun({ text, font:"Arial", size:18, bold:true, color:"FFFFFF" })], spacing:{before:0,after:0} })]
    }))
  });
}
function dataRow(cells, widths, shade=false) {
  return new TableRow({
    children: cells.map((text, i) => new TableCell({
      borders: cellBorder(),
      width: { size: widths[i], type: WidthType.DXA },
      shading: { fill: shade ? LIGHT_BG : "FFFFFF", type: ShadingType.CLEAR },
      margins: { top:80, bottom:80, left:120, right:120 },
      children: [new Paragraph({ children:[new TextRun({ text: String(text||""), font:"Arial", size:18, color:DARK_GREY })], spacing:{before:0,after:0} })]
    }))
  });
}
function calloutBox(title, items, bgColor, borderColor, titleColor) {
  const totalW = 9360;
  return new Table({
    width: { size: totalW, type: WidthType.DXA },
    columnWidths: [totalW],
    rows: [
      new TableRow({ children: [new TableCell({
        borders: { top:{style:BorderStyle.SINGLE,size:6,color:borderColor}, bottom:{style:BorderStyle.SINGLE,size:3,color:borderColor}, left:{style:BorderStyle.SINGLE,size:6,color:borderColor}, right:{style:BorderStyle.SINGLE,size:3,color:borderColor} },
        width: { size: totalW, type: WidthType.DXA },
        shading: { fill: bgColor, type: ShadingType.CLEAR },
        margins: { top:160, bottom:160, left:200, right:200 },
        children: [
          new Paragraph({ children:[new TextRun({ text:title, font:"Arial", size:22, bold:true, color:titleColor })], spacing:{before:0,after:120} }),
          ...items.map(item => new Paragraph({
            numbering: { reference:"bullets", level:0 },
            children:[new TextRun({ text:item, font:"Arial", size:20, color:DARK_GREY })],
            spacing:{before:40,after:40}
          }))
        ]
      })] })
    ]
  });
}
function kpiCard(label, value, note="") {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [new TableRow({ children: [new TableCell({
      borders: { top:{style:BorderStyle.SINGLE,size:4,color:GOLD}, bottom:{style:BorderStyle.SINGLE,size:1,color:BORDER_C}, left:{style:BorderStyle.SINGLE,size:1,color:BORDER_C}, right:{style:BorderStyle.SINGLE,size:1,color:BORDER_C} },
      width: { size:9360, type:WidthType.DXA },
      shading: { fill:LIGHT_BG, type:ShadingType.CLEAR },
      margins: { top:80, bottom:80, left:160, right:160 },
      children: [
        new Paragraph({ children:[new TextRun({text:label,font:"Arial",size:18,color:MID_GREY})], spacing:{before:0,after:0} }),
        new Paragraph({ children:[new TextRun({text:value,font:"Arial",size:36,bold:true,color:DARK_GREY})], spacing:{before:0,after:0} }),
        ...(note ? [new Paragraph({ children:[new TextRun({text:note,font:"Arial",size:16,color:MID_GREY,italics:true})], spacing:{before:0,after:0} })] : [])
      ]
    })] })]
  });
}

// ── KPI ROW TABLE (4 across) ──────────────────────────────────
function kpiRow(items) {
  const w = Math.floor(9360 / items.length);
  const widths = items.map((_,i) => i === items.length-1 ? 9360 - w*(items.length-1) : w);
  return new Table({
    width: { size:9360, type:WidthType.DXA },
    columnWidths: widths,
    rows: [new TableRow({ children: items.map((item, i) => new TableCell({
      borders: { top:{style:BorderStyle.SINGLE,size:4,color:GOLD}, bottom:{style:BorderStyle.SINGLE,size:1,color:BORDER_C}, left:{style:BorderStyle.SINGLE,size:1,color:i===0?"FFFFFF":BORDER_C}, right:{style:BorderStyle.SINGLE,size:1,color:i===items.length-1?"FFFFFF":BORDER_C} },
      width: { size:widths[i], type:WidthType.DXA },
      shading: { fill:LIGHT_BG, type:ShadingType.CLEAR },
      margins: { top:120, bottom:120, left:160, right:160 },
      children: [
        new Paragraph({ children:[new TextRun({text:item.label,font:"Arial",size:16,color:MID_GREY})], spacing:{before:0,after:0} }),
        new Paragraph({ children:[new TextRun({text:item.value,font:"Arial",size:28,bold:true,color:item.color||DARK_GREY})], spacing:{before:0,after:0} }),
        ...(item.note ? [new Paragraph({ children:[new TextRun({text:item.note,font:"Arial",size:15,color:MID_GREY,italics:true})], spacing:{before:0,after:0} })] : [])
      ]
    }))})]
  });
}

// ── BAR CHART TABLE ───────────────────────────────────────────
function barChart(data, maxVal, title) {
  const totalW = 9360;
  const cols = [2800, 1200, 1200, 4160];
  const rows = [
    new TableRow({ children: [
      new TableCell({ borders:noBorder(), width:{size:cols[0],type:WidthType.DXA}, margins:{top:40,bottom:40,left:0,right:120},
        children:[new Paragraph({children:[new TextRun({text:title||"",font:"Arial",size:17,bold:true,color:MID_GREY})],spacing:{before:0,after:0}})] }),
      new TableCell({ borders:noBorder(), width:{size:cols[1],type:WidthType.DXA}, margins:{top:40,bottom:40,left:40,right:40},
        children:[new Paragraph({children:[new TextRun({text:"Count",font:"Arial",size:17,bold:true,color:MID_GREY})],spacing:{before:0,after:0},alignment:AlignmentType.RIGHT})] }),
      new TableCell({ borders:noBorder(), width:{size:cols[2],type:WidthType.DXA}, margins:{top:40,bottom:40,left:40,right:40},
        children:[new Paragraph({children:[new TextRun({text:"%",font:"Arial",size:17,bold:true,color:MID_GREY})],spacing:{before:0,after:0},alignment:AlignmentType.RIGHT})] }),
      new TableCell({ borders:noBorder(), width:{size:cols[3],type:WidthType.DXA}, margins:{top:40,bottom:40,left:40,right:0},
        children:[new Paragraph({children:[new TextRun({text:"",font:"Arial",size:17})],spacing:{before:0,after:0}})] }),
    ]}),
    ...data.map(([label,val,pct,color],i) => {
      const barLen = Math.round((val/maxVal)*30);
      const bar = "█".repeat(Math.max(1,barLen));
      return new TableRow({ children: [
        new TableCell({ borders:noBorder(), width:{size:cols[0],type:WidthType.DXA}, shading:{fill:i%2===0?"FAFAFA":"FFFFFF",type:ShadingType.CLEAR}, margins:{top:60,bottom:60,left:0,right:120},
          children:[new Paragraph({children:[new TextRun({text:label,font:"Arial",size:19,color:DARK_GREY})],spacing:{before:0,after:0}})] }),
        new TableCell({ borders:noBorder(), width:{size:cols[1],type:WidthType.DXA}, shading:{fill:i%2===0?"FAFAFA":"FFFFFF",type:ShadingType.CLEAR}, margins:{top:60,bottom:60,left:40,right:40},
          children:[new Paragraph({children:[new TextRun({text:val,font:"Arial",size:19,bold:true,color:DARK_GREY})],spacing:{before:0,after:0},alignment:AlignmentType.RIGHT})] }),
        new TableCell({ borders:noBorder(), width:{size:cols[2],type:WidthType.DXA}, shading:{fill:i%2===0?"FAFAFA":"FFFFFF",type:ShadingType.CLEAR}, margins:{top:60,bottom:60,left:40,right:40},
          children:[new Paragraph({children:[new TextRun({text:pct,font:"Arial",size:19,color:MID_GREY})],spacing:{before:0,after:0},alignment:AlignmentType.RIGHT})] }),
        new TableCell({ borders:noBorder(), width:{size:cols[3],type:WidthType.DXA}, shading:{fill:i%2===0?"FAFAFA":"FFFFFF",type:ShadingType.CLEAR}, margins:{top:60,bottom:60,left:40,right:0},
          children:[new Paragraph({children:[new TextRun({text:bar,font:"Courier New",size:17,color:color||GOLD})],spacing:{before:0,after:0}})] }),
      ]});
    })
  ];
  return new Table({ width:{size:totalW,type:WidthType.DXA}, columnWidths:cols, rows });
}

// ════════════════════════════════════════════════════════════════
// BUILD DOCUMENT
// ════════════════════════════════════════════════════════════════
const doc = new Document({
  numbering: {
    config: [{
      reference: "bullets",
      levels: [{ level:0, format:LevelFormat.BULLET, text:"•", alignment:AlignmentType.LEFT,
        style:{ paragraph:{ indent:{ left:480, hanging:240 } } } }]
    }]
  },
  styles: {
    default: { document: { run: { font:"Arial", size:20 } } },
    paragraphStyles: [
      { id:"Heading1", name:"Heading 1", basedOn:"Normal", next:"Normal", quickFormat:true,
        run:{ size:32, bold:true, font:"Arial", color:BLACK }, paragraph:{ spacing:{before:480,after:200}, outlineLevel:0 } },
      { id:"Heading2", name:"Heading 2", basedOn:"Normal", next:"Normal", quickFormat:true,
        run:{ size:24, bold:true, font:"Arial", color:DARK_GREY }, paragraph:{ spacing:{before:320,after:120}, outlineLevel:1 } },
      { id:"Heading3", name:"Heading 3", basedOn:"Normal", next:"Normal", quickFormat:true,
        run:{ size:22, bold:true, font:"Arial", color:MID_GREY }, paragraph:{ spacing:{before:200,after:80}, outlineLevel:2 } },
    ]
  },
  sections: [{
    properties: {
      page: {
        size: { width:12240, height:15840 },
        margin: { top:1080, right:1080, bottom:1080, left:1080 }
      }
    },
    headers: {
      default: new Header({ children:[
        new Paragraph({
          children:[
            new TextRun({ text:"CREATOR INTELLIGENCE REPORT  |  @aastha_sochic  |  Confidential", font:"Arial", size:16, color:MID_GREY }),
            new TextRun({ children:["\t", PageNumber.CURRENT], font:"Arial", size:16, color:MID_GREY })
          ],
          tabStops:[{ type:"right", position:9360 }],
          border:{ bottom:{style:BorderStyle.SINGLE,size:3,color:GOLD,space:4} },
          spacing:{before:0,after:80}
        })
      ]})
    },
    children: [

      // ── COVER ─────────────────────────────────────────────
      new Paragraph({
        children:[new TextRun({ text:"CREATOR INTELLIGENCE REPORT", font:"Arial", size:52, bold:true, color:BLACK })],
        spacing:{before:720,after:120}, alignment:AlignmentType.LEFT
      }),
      new Paragraph({
        children:[new TextRun({ text:"@aastha_sochic  —  Instagram Performance & Audience Audit", font:"Arial", size:26, color:GOLD, bold:true })],
        spacing:{before:0,after:80}
      }),
      new Paragraph({
        children:[new TextRun({ text:"Generated: 4 June 2026  |  Source: Instagram Graph API v21.0  |  Posts Analysed: 500  |  Date Range: Apr 2023–Jun 2026", font:"Arial", size:18, color:MID_GREY })],
        spacing:{before:0,after:600},
        border:{ bottom:{style:BorderStyle.SINGLE,size:3,color:BORDER_C,space:6} }
      }),

      // KPI strip
      kpiRow([
        { label:"Followers", value:"51,521", note:"as of Jun 2026" },
        { label:"Posts Analysed", value:"500", note:"Apr 2023–Jun 2026" },
        { label:"Total Brands Tagged", value:"736", note:"unique across 500 posts" },
        { label:"Current Eng Rate", value:"0.49%", note:"↓ from 2.47% (Jan 2025)", color:RED_BORDER }
      ]),
      ...spacer(2),

      // ── 1. PROFILE ────────────────────────────────────────
      h1("1.  Profile Overview"),

      new Table({
        width:{size:9360,type:WidthType.DXA}, columnWidths:[3200,6160],
        rows:[
          dataRow(["Full Name","Aastha Chopra  (آستا تشوبرا)"], [3200,6160], true),
          dataRow(["Handle","@aastha_sochic"], [3200,6160]),
          dataRow(["Followers","51,521"], [3200,6160], true),
          dataRow(["Following","2,764"], [3200,6160]),
          dataRow(["Total Posts (all-time)","2,040"], [3200,6160], true),
          dataRow(["Active on","Instagram  +  TikTok (@aastha_c8)"], [3200,6160]),
          dataRow(["Contact","aasthac8@gmail.com"], [3200,6160], true),
          dataRow(["Creator ID","UAE Licensed Creator — ID 1557678"], [3200,6160]),
          dataRow(["Profession","Practising Lawyer  +  Content Creator"], [3200,6160], true),
        ]
      }),
      ...spacer(1),
      body("Bio: 🇦🇪 Lawyer⚖️ || Licensed Creator 🪪 | FASHION | PREMIUM BEAUTY | LUXURY", {italic:true}),
      ...spacer(1),
      calloutBox("Key Observations", [
        "Licensed UAE creator with a legal background — dual identity almost never surfaced in content",
        "TikTok is linked in bio (not a website), suggesting TikTok may be a parallel monetisation channel",
        "Content identity has shifted significantly over 3 years: fitness (2023) → luxury fashion (2024) → beauty (2025–26)"
      ], LIGHT_BG, GOLD, DARK_GREY),

      pageBreak(),

      // ── 2. DEMOGRAPHICS ──────────────────────────────────
      h1("2.  Audience Demographics"),

      h2("2a.  Follower Geography"),
      body("38,716 of 51,521 followers tracked by country"),
      ...spacer(1),
      barChart([
        ["India",       "11,275", "29.1%", "C9A84C"],
        ["Brazil",       "8,837", "22.8%", "E8B84B"],
        ["United States","4,413", "11.4%", "4A90D9"],
        ["Iran",         "2,599",  "6.7%", "888888"],
        ["UAE",          "2,309",  "6.0%", "2E7D4F"],
        ["Bangladesh",   "1,162",  "3.0%", "888888"],
        ["Pakistan",     "1,087",  "2.8%", "888888"],
        ["Indonesia",      "984",  "2.5%", "888888"],
        ["Turkey",         "636",  "1.6%", "888888"],
        ["Nigeria",        "413",  "1.1%", "888888"],
        ["Russia",         "316",  "0.8%", "888888"],
        ["Egypt",          "273",  "0.7%", "888888"],
        ["United Kingdom", "240",  "0.6%", "888888"],
      ], 11275),
      ...spacer(1),
      calloutBox("Geographic Flags", [
        "ANOMALY: Brazil is 23% of total followers — typical of an explore-page viral spike, not an organic audience. Unlikely to convert for UAE or luxury brand campaigns.",
        "UAE is only 6% of followers despite Dubai-based positioning — her platform reach is overwhelmingly non-local",
        "India at 29% is the largest market but is generally not the target demographic for ultra-luxury UAE brands"
      ], RED_BG, RED_BORDER, RED_BORDER),

      ...spacer(2),
      h2("2b.  Follower Cities (Top 15)"),
      new Table({
        width:{size:9360,type:WidthType.DXA}, columnWidths:[5000,2200,2160],
        rows:[
          headerRow(["City","Followers","%"], [5000,2200,2160]),
          ...[ ["Dubai, UAE","1,791","18.1%"],["São Paulo, Brazil","1,107","11.2%"],["Delhi, India","776","7.8%"],
               ["Tehran, Iran","488","4.9%"],["Mumbai, India","473","4.8%"],["Istanbul, Turkey","354","3.6%"],
               ["Rio de Janeiro, Brazil","296","3.0%"],["Karachi, Pakistan","290","2.9%"],["Bangalore, India","251","2.5%"],
               ["Lahore, Pakistan","230","2.3%"],["Sharjah, UAE","216","2.2%"],["Kolkata, India","212","2.1%"],
               ["New York, USA","203","2.1%"],["Mashhad, Iran","178","1.8%"],["Jakarta, Indonesia","170","1.7%"]
             ].map((r,i) => dataRow(r, [5000,2200,2160], i%2===0))
        ]
      }),

      pageBreak(),

      h2("2c.  Age Distribution"),
      new Table({
        width:{size:9360,type:WidthType.DXA}, columnWidths:[1800,1600,1600,4360],
        rows:[
          headerRow(["Age Group","Followers","%","Distribution"], [1800,1600,1600,4360]),
          ...[ ["25–34","11,254","27.6%","████████████████████████████"],
               ["35–44","11,140","27.3%","███████████████████████████"],
               ["18–24", "7,637","18.7%","███████████████████"],
               ["45–54", "6,833","16.7%","█████████████████"],
               ["13–17", "1,932", "4.7%","████"],
               ["55–64", "1,686", "4.1%","████"],
               ["65+",     "354", "0.9%","█"]
             ].map((r,i) => dataRow(r, [1800,1600,1600,4360], i%2===0))
        ]
      }),
      ...spacer(1),
      body("25–34 and 35–44 are nearly identical at 27.6% and 27.3% — together 55% of all followers. Solidly millennial. Strong aspirational 18–24 base at 19%."),

      ...spacer(2),
      h2("2d.  Gender Split"),
      body("Of followers who declared gender:  56% Male  /  44% Female  (78% did not declare — normal for Instagram)"),
      ...spacer(1),
      body("Note: Male-majority declared audience is unusual for a fashion/beauty creator. Likely reflects broad algorithm distribution and South Asian follower base demographics.", {color:MID_GREY, italic:true}),

      ...spacer(2),
      h2("2e.  Active Reach — This Week"),
      body("Total accounts reached this week: 40,716"),
      ...spacer(1),
      barChart([
        ["India",         "36,333", "89.2%", RED_BORDER],
        ["UAE",            "3,769",  "9.3%", "2E7D4F"],
        ["United States",     "99",  "0.2%", "888888"],
        ["Pakistan",          "96",  "0.2%", "888888"],
        ["United Kingdom",    "65",  "0.2%", "888888"],
        ["Egypt",             "65",  "0.2%", "888888"],
        ["Saudi Arabia",      "45",  "0.1%", "888888"],
        ["Canada",            "36",  "0.1%", "888888"],
        ["Brazil",            "31",  "0.1%", "888888"],
      ], 36333),
      ...spacer(1),
      calloutBox("Critical Reach Insight", [
        "89% of weekly reach goes to India — content is currently hyper-concentrated to one market",
        "UAE accounts for 9% of weekly reach, showing her content does land proportionally well with her local audience",
        "Brazil has 23% of followers but <0.1% of weekly reach — confirmed ghost/inactive audience",
        "Top reached cities this week: Dubai (21%), Abu Dhabi (5%), Chennai (4.8%), Sharjah (4.7%), Ahmedabad (4.3%)"
      ], RED_BG, RED_BORDER, RED_BORDER),

      pageBreak(),

      // ── 3. CONTENT ───────────────────────────────────────
      h1("3.  Content Performance — 500 Posts"),

      h2("3a.  Category Breakdown"),
      new Table({
        width:{size:9360,type:WidthType.DXA}, columnWidths:[2800,1200,1200,1400,1400,1360],
        rows:[
          headerRow(["Category","Posts","Share","Avg Eng","Avg Likes","Avg Comments"],[2800,1200,1200,1400,1400,1360]),
          ...[ ["Luxury Fashion","264","53%","419","348","71"],
               ["Beauty","65","13%","554 ★","429","125"],
               ["Fitness / Wellness","55","11%","378","333","44"],
               ["Travel & Lifestyle","52","10%","431","349","82"],
               ["Lifestyle / Other","30","6%","486","401","84"],
               ["Food & Dining","26","5%","315","222","93"],
               ["Events & Cars","8","2%","323","212","110"]
             ].map((r,i) => dataRow(r, [2800,1200,1200,1400,1400,1360], i%2===0))
        ]
      }),
      ...spacer(1),
      calloutBox("Content Mix Insights", [
        "Fashion dominates at 53% of posts but is NOT the best-performing category by engagement",
        "Beauty returns the highest engagement (554 avg) yet only represents 13% of posts — significantly underserved",
        "Travel content spikes engagement (431 avg) — authenticity premium when she steps outside Dubai",
        "Comments are disproportionately high across food/beauty content — vocal, engaged sub-audience"
      ], BLUE_BG, BLUE_BDR, BLUE_BDR),

      ...spacer(2),
      h2("3b.  Creator Identity Evolution"),
      new Table({
        width:{size:9360,type:WidthType.DXA}, columnWidths:[1400,1200,1500,1300,1600,1200,1160],
        rows:[
          headerRow(["Year","Posts","Fashion","Beauty","Fitness","Travel","Food"],[1400,1200,1500,1300,1600,1200,1160]),
          dataRow(["2023","111","50%","3%","39% ⚑","5%","2%"], [1400,1200,1500,1300,1600,1200,1160], true),
          dataRow(["2024","162","70% ★","4%","2%","11%","4%"], [1400,1200,1500,1300,1600,1200,1160]),
          dataRow(["2025","169","44%","25% ↑","4%","11%","7%"], [1400,1200,1500,1300,1600,1200,1160], true),
          dataRow(["2026","58","36%","22%","3%","17%","10%"], [1400,1200,1500,1300,1600,1200,1160]),
        ]
      }),
      ...spacer(1),
      body("Fitness dropped from 39% of content in 2023 (43 posts) to 3% in 2026 (2 posts) — near-complete identity abandonment. Beauty is growing year-on-year and now represents the strongest engagement opportunity."),

      ...spacer(2),
      h2("3c.  Format Performance"),
      new Table({
        width:{size:9360,type:WidthType.DXA}, columnWidths:[2400,1200,1900,1800,1800,2260],
        rows:[
          headerRow(["Format","Posts","Avg Engagement","Avg Likes","Avg Comments","Avg Reach"],[2400,1200,1900,1800,1800,2260]),
          dataRow(["Video","262","557 ★","473","84","—"], [2400,1200,1900,1800,1800,2260], true),
          dataRow(["Carousel Album","232","295","221","74","230"], [2400,1200,1900,1800,1800,2260]),
          dataRow(["Static Image","6","117","93","25","24"], [2400,1200,1900,1800,1800,2260], true),
        ]
      }),
      ...spacer(1),
      body("Video outperforms carousel by 2× on engagement. She currently posts near-equal video vs carousel (262 vs 232). Shifting the ratio toward video would materially improve performance."),

      pageBreak(),

      h2("3d.  Top 20 Posts All-Time"),
      new Table({
        width:{size:9360,type:WidthType.DXA}, columnWidths:[360,1440,1800,1000,1100,900,2760],
        rows:[
          headerRow(["#","Date","Format","Likes","Comments","Eng","Caption Preview"],[360,1440,1800,1000,1100,900,2760]),
          ...[
            [1,"2024-01-17","Carousel","10,304","54","10,358","Elegance in every stitch — embroidered details..."],
            [2,"2024-05-27","Video","9,394","59","9,453","Hiking to the best view ever! Every step reveals..."],
            [3,"2025-01-21","Video","2,809","145","2,954","@be.divalicious returns with an exclusive event..."],
            [4,"2025-06-15","Carousel","2,535","72","2,607","A spicy evening @coyadubai — margaritas and..."],
            [5,"2024-10-28","Video","2,511","93","2,604","Shine Bright this Dhanteras with Kanz Jewels..."],
            [6,"2024-11-26","Video","2,500","90","2,590","Wearing @mahgulofficial — a fun fusion silhouette..."],
            [7,"2025-06-28","Video","2,486","88","2,574","Sip. Sweat. Slay. Repeat."],
            [8,"2025-06-22","Video","2,460","74","2,534","POV: When vanity is a summer moodboard..."],
            [9,"2025-07-03","Video","2,426","95","2,521","When in doubt, go blue @maybellinearabia..."],
            [10,"2024-05-24","Video","2,048","34","2,082","The joy of uninterrupted tranquility..."],
          ].map((r,i) => dataRow(r, [360,1440,1800,1000,1100,900,2760], i%2===0))
        ]
      }),
      ...spacer(1),
      body("The #1 post of all time is a Carousel (10,358 engagement) — a fashion editorial. 8 of the top 10 are Videos. All top performers are fashion or beauty content.", {italic:true}),

      pageBreak(),

      // ── 4. BRANDS ─────────────────────────────────────────
      h1("4.  Brand Partnerships"),

      h2("4a.  Brand Tier Mix"),
      kpiRow([
        { label:"Unique Brands Tagged", value:"736", note:"across 500 posts" },
        { label:"Luxury Mentions", value:"2%", note:"27 of 1,362 total", color:MID_GREY },
        { label:"Premium Beauty", value:"3.8%", note:"52 mentions" },
        { label:"Mass Market", value:"8.4%", note:"114 mentions", color:RED_BORDER },
      ]),
      ...spacer(2),

      h2("4b.  Most-Tagged Brands (Top 30)"),
      new Table({
        width:{size:9360,type:WidthType.DXA}, columnWidths:[3600,1600,4160],
        rows:[
          headerRow(["Brand","Mentions","Category"],[3600,1600,4160]),
          ...[ ["@namshi","34","Mass Market ⚑"],["@vibha_jewells","27","Regional / Mid-tier"],
               ["@be.divalicious","17","Regional / Mid-tier"],["@boulevardone","17","Regional / Mid-tier"],
               ["@hudabeauty","11","Premium Beauty"],["@houseofsa.ra","11","Regional / Mid-tier"],
               ["@neverfullydressed","11","Regional / Mid-tier"],["@nocturnearabia","11","Regional / Mid-tier"],
               ["@zara","10","Mass Market"],["@sephoramiddleeast","10","Premium Beauty"],
               ["@clubapparel","10","Mass Market"],["@saniamaskatiya","10","Regional / Mid-tier"],
               ["@mango","8","Mass Market"],["@sephora","7","Premium Beauty"],
               ["@asos","7","Mass Market"],["@acler","6","Luxury"],
               ["@hermes","5","Luxury ★"],["@dolcegabbana_beauty","5","Premium Beauty"],
               ["@revolvemena","5","Mass Market"],["@chanelofficial","4","Luxury ★"],
               ["@diorbeauty","4","Premium Beauty"],["@kikomilanoarabia","4","Premium Beauty"],
               ["@maybellinearabia","4","Mass Market"],["@celine","3","Luxury ★"],
               ["@sephoramiddleeast","3","Premium Beauty"],["@maisonvalentino","2","Luxury ★"],
               ["@jilsander","2","Luxury ★"],["@jimmychoo","2","Luxury ★"],
             ].map((r,i) => dataRow(r, [3600,1600,4160], i%2===0))
        ]
      }),
      ...spacer(1),
      calloutBox("Brand Partnership Gap", [
        "DISCONNECT: @namshi (34x) — a mass-market UAE e-commerce platform — is the most-tagged brand by far",
        "Luxury brand appearances (Hermès, Chanel, Dior, Valentino, Céline) are heavily concentrated in the last 6 months only",
        "The website's luxury-only positioning does not match 3 years of brand history",
        "A tiered partnership narrative ('curated luxury alongside everyday style') would be more credible and defensible"
      ], RED_BG, RED_BORDER, RED_BORDER),

      pageBreak(),

      // ── 5. CONTENT STRATEGY ───────────────────────────────
      h1("5.  Content Strategy Analysis"),

      h2("5a.  Hashtag Audit"),
      body("1,506 unique hashtags used across 500 posts. Top hashtags by frequency:"),
      ...spacer(1),
      new Table({
        width:{size:9360,type:WidthType.DXA}, columnWidths:[2800,1000,1200,4360],
        rows:[
          headerRow(["Hashtag","Uses","Category","Note"],[2800,1000,1200,4360]),
          ...[ ["#fashion","81","Fashion","✓ Relevant to current positioning"],
               ["#mentalhealth","75","Wellness ⚑","Legacy tag — routes to wrong audience"],
               ["#positivity","69","Wellness ⚑","Legacy tag — 2023 identity"],
               ["#gratitude","61","Wellness ⚑","Legacy tag"],
               ["#mentalhealthawareness","60","Wellness ⚑","Actively routes away from luxury audience"],
               ["#mindfulness","56","Wellness ⚑","Legacy tag"],
               ["#confidence","54","Wellness ⚑","Legacy tag"],
               ["#selflove","52","Wellness ⚑","Legacy tag"],
               ["#healing","51","Wellness ⚑","Legacy tag"],
               ["#fitmom","47","Fitness ⚑","Outdated — fitness content now 3% of posts"],
               ["#mydubai","32","Dubai ✓","Relevant"],
               ["#dubaifashion","29","Fashion ✓","Relevant"],
               ["#ootd","18","Fashion ✓","Relevant"],
             ].map((r,i) => dataRow(r, [2800,1000,1200,4360], i%2===0))
        ]
      }),
      ...spacer(1),
      calloutBox("Hashtag Strategy — Critical Issue", [
        "The majority of high-frequency hashtags are wellness/mental-health vocabulary from a 2023 content identity she has largely abandoned",
        "These tags are actively routing her luxury and beauty content to a wellness audience — wrong algorithm bucket",
        "Recommendation: Conduct a full hashtag refresh. Build 3 tag sets: luxury lifestyle, Dubai fashion, premium beauty. Retire all wellness/fitness tags immediately."
      ], RED_BG, RED_BORDER, RED_BORDER),

      ...spacer(2),
      h2("5b.  Posting Cadence & Timing"),
      kpiRow([
        { label:"Avg Posts / Month", value:"13", note:"consistent" },
        { label:"Best Day", value:"Monday", note:"avg 564 eng (+35% vs Friday)" },
        { label:"Best Time (UAE)", value:"10–11am", note:"06:00–07:00 UTC" },
        { label:"Worst Day", value:"Saturday", note:"avg 291 eng (−48% vs Monday)", color:RED_BORDER },
      ]),
      ...spacer(2),

      h2("5c.  Caption Length vs Engagement"),
      new Table({
        width:{size:9360,type:WidthType.DXA}, columnWidths:[2800,1400,2000,3160],
        rows:[
          headerRow(["Caption Length","Posts","Avg Engagement","Recommendation"],[2800,1400,2000,3160]),
          dataRow(["Short  (0–100 chars)","28","341","Use sparingly"], [2800,1400,2000,3160], true),
          dataRow(["Medium (101–300 chars)","191","496 ★","Sweet spot — use as default"], [2800,1400,2000,3160]),
          dataRow(["Long  (301–600 chars)","204","381","Overused — reduce"], [2800,1400,2000,3160], true),
          dataRow(["Very Long (600+ chars)","77","429","Occasional long-form OK"], [2800,1400,2000,3160]),
        ]
      }),
      ...spacer(1),
      body("CTA usage is extremely low across all 500 posts. No consistent calls to action (comment, DM, save, link in bio). This is the missing conversion layer for brand partnerships."),

      pageBreak(),

      // ── 6. ENGAGEMENT RATE ────────────────────────────────
      h1("6.  Engagement Rate Analysis"),
      body("Industry benchmark for a creator of this size (50K): 1.5–3% engagement rate"),
      ...spacer(1),

      h2("6a.  Monthly ER Trend (Jan 2025–Jun 2026)"),
      new Table({
        width:{size:9360,type:WidthType.DXA}, columnWidths:[1600,1000,1400,1200,4160],
        rows:[
          headerRow(["Month","Posts","Avg Eng","ER %","Trend"],[1600,1000,1400,1200,4160]),
          ...[ ["Jan 2025","11","1,270","2.47% ▲","████████████ — Peak"],
               ["Feb 2025","16","652","1.27% →","██████"],
               ["Mar 2025","14","579","1.12% →","█████"],
               ["Apr 2025","16","375","0.73% ↓","███"],
               ["May 2025","17","337","0.65% ↓","███"],
               ["Jun 2025","16","987","1.92% ▲","█████████"],
               ["Jul 2025","12","1,097","2.13% ▲","██████████"],
               ["Aug 2025","6","453","0.88% →","████"],
               ["Sep 2025","18","379","0.74% ↓","███"],
               ["Oct 2025","16","348","0.68% ↓","███"],
               ["Nov 2025","17","617","1.20% →","██████"],
               ["Dec 2025","10","532","1.03% →","█████"],
               ["Jan 2026","10","498","0.97% →","████"],
               ["Feb 2026","10","306","0.59% ↓","██"],
               ["Mar 2026","13","523","1.02% →","█████"],
               ["Apr 2026","13","320","0.62% ↓","███"],
               ["May 2026","11","255","0.49% ↓","██ — Current"],
             ].map((r,i) => dataRow(r, [1600,1000,1400,1200,4160], i%2===0))
        ]
      }),
      ...spacer(1),
      calloutBox("Engagement Rate — Key Findings", [
        "Peak ER of 2.47% in January 2025 — well above the 1.5% benchmark",
        "Current ER of 0.49% (May 2026) is BELOW the industry benchmark of 1.5%",
        "80% decline in ER over 18 months — follower count is growing but engagement is not keeping pace",
        "Most likely cause: the luxury pivot is attracting passive aspirational followers who follow but don't engage",
        "The June–July 2025 spike (ER 1.9–2.1%) suggests strong content periods exist — analysing what drove those would help reverse the trend"
      ], RED_BG, RED_BORDER, RED_BORDER),

      pageBreak(),

      // ── 7. STRATEGIC SUMMARY ──────────────────────────────
      h1("7.  Strategic Assessment"),

      h2("Red Flags"),
      calloutBox("Issues Requiring Immediate Attention", [
        "ER collapse: 2.47% → 0.49% in 18 months. The downward trajectory is clear and sustained.",
        "Brazil ghost audience: 23% of followers, <0.1% of weekly reach — inflating vanity metrics without value.",
        "Hashtag/content mismatch: wellness tags actively routing luxury content to entirely the wrong algorithm bucket.",
        "Brand positioning gap: @namshi (mass market) is the most-tagged brand across 3 years, but the website presents her as luxury-only.",
        "No CTA strategy: zero consistent calls to action across 500 posts. Engagement cannot be converted to measurable action for brand clients.",
        "Identity in flux: fitness (2023) → fashion (2024) → beauty (2025–26). Audience has not fully followed her through the transition."
      ], RED_BG, RED_BORDER, RED_BORDER),

      ...spacer(2),
      h2("Genuine Strengths"),
      calloutBox("Competitive Advantages", [
        "High comment rate relative to likes — audience is vocal and engaged, not passive scrollers. Strong community signal for brands.",
        "Beauty content is massively underrepresented (13% of posts) versus what it returns (554 avg engagement) — this is her biggest untapped lever.",
        "Travel content creates reliable engagement spikes — authenticity premium applies when she leaves Dubai.",
        "25–44 age bracket = 55% of audience. This is a premium demographic for lifestyle, fashion and beauty brands.",
        "UAE + India reach combination is uniquely valuable for brands targeting the South Asian diaspora in the Gulf — a large, underserved niche.",
        "Lawyer + creator dual identity is completely unique in the Dubai luxury creator space. Never surfaced in content — enormous untapped point of view.",
        "Strong video output (262 of 500 posts) — well-positioned for the format that already delivers 2× engagement."
      ], GREEN_BG, GREEN_BDR, GREEN_BDR),

      ...spacer(2),
      h2("Strategic Opportunities"),
      calloutBox("Recommended Actions", [
        "Lean into beauty — double posting frequency in this category. Data shows demand exists; supply is the constraint.",
        "Full hashtag refresh — retire all wellness/mental health/fitness tags immediately. Build three dedicated tag sets: luxury lifestyle (UAE), Dubai fashion, premium beauty.",
        "Surface the lawyer angle — 'law by day, luxury by lifestyle' is a genuinely differentiated creator niche in Dubai. No one else owns this.",
        "South Asian diaspora positioning — she sits at the intersection of UAE reach and Indian audience. This is a specific, monetisable audience for brands expanding into Gulf markets.",
        "Add consistent CTAs — even one CTA per post (comment, save, DM) would transform passive engagement into measurable action for brand reporting.",
        "Post Monday and Wednesday, 10–11am UAE time. Currently inconsistent on timing.",
        "Shift carousel-to-video ratio. Video is objectively 2× better — the data is unambiguous."
      ], BLUE_BG, BLUE_BDR, BLUE_BDR),

      pageBreak(),

      // ── 8. DATA NOTES ─────────────────────────────────────
      h1("8.  Data Coverage & Methodology"),
      new Table({
        width:{size:9360,type:WidthType.DXA}, columnWidths:[2800,6560],
        rows:[
          dataRow(["Source","Instagram Graph API v21.0"], [2800,6560], true),
          dataRow(["Profile data","Live as of 4 June 2026"], [2800,6560]),
          dataRow(["Posts analysed","500 (maximum via API pagination)"], [2800,6560], true),
          dataRow(["Post-level insights","Reach, impressions, saves, shares, plays per post"], [2800,6560]),
          dataRow(["Demographics","Follower + reached audience — countries, cities, age, gender"], [2800,6560], true),
          dataRow(["Not available","Story insights (requires additional permissions)"], [2800,6560]),
          dataRow(["Not available","TikTok data (separate API — not pulled)"], [2800,6560], true),
          dataRow(["Not available","Engaged audience demographics (insufficient API data window)"], [2800,6560]),
          dataRow(["Token expiry","~60 days from 4 June 2026"], [2800,6560], true),
          dataRow(["Token refresh","GET graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=TOKEN"], [2800,6560]),
        ]
      }),
      ...spacer(4),

      new Paragraph({
        children:[new TextRun({ text:"Confidential — For internal use only. Data sourced directly from Instagram Graph API.", font:"Arial", size:16, color:MID_GREY, italics:true })],
        alignment:AlignmentType.CENTER,
        border:{ top:{style:BorderStyle.SINGLE,size:3,color:BORDER_C,space:6} },
        spacing:{before:240,after:0}
      }),
    ]
  }]
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync("/Users/amitchopra/Desktop/Aastha Chopra/data/Aastha-Chopra-Creator-Audit.docx", buf);
  console.log("Written: data/Aastha-Chopra-Creator-Audit.docx");
});
