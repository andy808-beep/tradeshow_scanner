import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { zh, productStylesText, recordedProductsText, selectedProductsText } from "@/lib/i18n/zh-cn";
import { SHELL_CACHE_NAME } from "@/lib/offline/constants";
import { buildSavedInquiryCsv, savedInquiryExportFilename } from "@/lib/saved-inquiries/csv";

const ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(tsx|ts|js)$/.test(name)) out.push(full);
  }
  return out;
}

describe("Simplified Chinese employee interface", () => {
  it("sets the document language to zh-CN", () => {
    expect(read("app/layout.tsx")).toContain('lang="zh-CN"');
    expect(read("app/global-error.tsx")).toContain('lang="zh-CN"');
    expect(read("app/manifest.ts")).toContain('lang: "zh-CN"');
  });

  it("uses 询问 for the activity, 询问单 for a record, and 询问记录 for history", () => {
    expect(zh.inquiry.currentHeading).toBe("当前询问单");
    expect(zh.nav.currentInquiry).toBe("当前询问");
    expect(zh.inquiry.historyHeading).toBe("询问记录");
    expect(zh.inquiry.detailHeading).toBe("询问单详情");
    expect(zh.inquiry.reference).toBe("询问单编号");
    expect(zh.inquiry.save).toBe("保存询问单");
    expect(zh.inquiry.savedHeading).toBe("询问单已保存");
    expect(zh.inquiry.startNext).toBe("开始下一次询问");
    expect(zh.sync.syncInquiries).toBe("同步询问记录");
    expect(zh.sync.pendingCount(2)).toBe("有 2 份询问单等待同步");
  });

  it("counts products in 款 and inquiries in 份", () => {
    expect(selectedProductsText(1)).toBe("已选择 1 款产品");
    expect(selectedProductsText(3)).toBe("已选择 3 款产品");
    expect(recordedProductsText(3)).toBe("已记录 3 款产品");
    expect(productStylesText(3)).toBe("3 款产品");
    expect(zh.sync.pendingCount(1)).toBe("有 1 份询问单等待同步");
    expect(zh.sync.pendingCount(3)).toBe("有 3 份询问单等待同步");
  });

  it("does not use 询价 in employee-facing source", () => {
    const roots = ["app", "components", "lib"].map((dir) => path.join(ROOT, dir));
    const hits = roots
      .flatMap((dir) => sourceFiles(dir))
      .filter((file) => readFileSync(file, "utf8").includes("询价"));
    expect(hits).toEqual([]);
  });

  it("keeps the Chinese CSV contract and a Latin-1 safe download name", () => {
    const csv = buildSavedInquiryCsv([
      {
        inquiryId: "inq-1",
        savedAt: "2026-10-01T08:30:00.000Z",
        customerName: 'Ada "Lovelace"',
        companyName: "Koei",
        generalNotes: "line\nnote",
        currency: "USD",
        productCode: "K10188-13",
        productName: "大方盘",
        quotedUnitPrice: "12.5",
        productNotes: "样品",
      },
    ]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain(
      "询问单编号,保存时间,客户姓名,公司名称,询问备注,币种,产品编号,产品名称,报价单价,产品备注",
    );
    expect(csv).toContain('"Ada ""Lovelace"""');
    expect(csv).not.toMatch(/quantity|grand total|line total/i);
    expect(savedInquiryExportFilename(new Date("2026-10-01T00:00:00.000Z"))).toBe(
      "询问记录-2026-10-01.csv",
    );
    expect(read("app/api/inquiries/export/route.ts")).toContain('filename="inquiries.csv"');
    expect(read("app/api/inquiries/export/route.ts")).toContain("filename*=UTF-8''");
  });

  it("bumps only the application shell cache and leaves IndexedDB names in place", () => {
    const worker = read("public/sw.js");
    expect(SHELL_CACHE_NAME).toBe("koei-shell-v2");
    expect(worker).toContain('const SHELL_CACHE = "koei-shell-v2"');
    expect(worker).not.toContain("indexedDB.deleteDatabase");
    expect(read("lib/offline/constants.ts")).toContain('CATALOGUE_DB_NAME = "koei-tradeshow"');
    expect(read("lib/supabase/inquiries.ts")).toContain("quantity: 1");
  });

  it("names the installed application in Chinese", () => {
    expect(zh.app.fullName).toBe("Koei 展会询问");
    expect(zh.app.shortName).toBe("Koei 询问");
    expect(zh.titles.login).toBe("员工登录 | Koei 展会询问");
    expect(zh.titles.search).toBe("搜索产品 | Koei 展会询问");
    expect(zh.titles.currentInquiry).toBe("当前询问 | Koei 展会询问");
    expect(zh.titles.saved).toBe("询问记录 | Koei 展会询问");
    expect(zh.titles.labels).toBe("标签 | Koei 展会询问");
  });
});
