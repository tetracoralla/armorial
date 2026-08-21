import { expect, test } from "@playwright/test";

type Rect = {
  x: number;
  right: number;
  bottom: number;
};

function expectInsideWidth(rect: Rect, viewportWidth: number) {
  expect(rect.x).toBeGreaterThanOrEqual(-1);
  expect(rect.right).toBeLessThanOrEqual(viewportWidth + 1);
}

test("fixed-shell modes reflow without clipping and keep both scroll regions complete", async ({ page }) => {
  await page.goto("/");
  const options = page.getByRole("listbox", { name: "Icon results" }).getByRole("option");
  await expect(options).toHaveCount(60);
  await options.nth(19).click();

  for (const [width, height] of [
    [640, 360],
    [760, 360],
    [821, 720],
    [899, 720],
    [900, 720],
    [1200, 480],
    [1920, 1080],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect(page.getByText("2,658 icons", { exact: true })).toBeVisible();

    const layout = await page.evaluate(() => {
      const rect = (selector: string) => {
        const bounds = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
        return { x: bounds.x, right: bounds.right, bottom: bounds.bottom };
      };
      return {
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        pageHeight: document.documentElement.scrollHeight,
        workspace: rect(".workspace"),
        category: rect(".category-nav"),
        catalog: rect(".catalog-pane"),
        catalogScroll: rect(".catalog-scroll"),
        inspector: rect(".inspector"),
      };
    });

    expect(layout.overflowX).toBe(0);
    expect(layout.pageHeight).toBe(height);
    expect(layout.workspace.bottom).toBeCloseTo(height, 0);
    expect(layout.catalogScroll.bottom).toBeCloseTo(layout.catalog.bottom, 0);
    for (const rect of [layout.workspace, layout.category, layout.catalog, layout.inspector]) {
      expectInsideWidth(rect, width);
      expect(rect.bottom).toBeLessThanOrEqual(height + 1);
    }

    await expect(page.getByRole("button", { name: "Copy SVG", exact: true })).toBeInViewport();
    await expect(page.getByRole("button", { name: "Copy for Agent", exact: true })).toBeInViewport();

    const inspector = page.locator(".inspector");
    await inspector.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(page.getByText("Policy context", { exact: true })).toBeInViewport();
    await expect(page.getByRole("button", { name: "Copy SVG", exact: true })).toBeInViewport();
    await inspector.evaluate((element) => { element.scrollTop = 0; });
    await expect(options.nth(19)).toHaveAttribute("aria-selected", "true");
  }
});

test("compact page mode contains the full task at extreme widths and preserves selection across modes", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  const options = page.getByRole("listbox", { name: "Icon results" }).getByRole("option");
  await options.nth(19).click();

  for (const [width, height] of [
    [240, 480],
    [280, 360],
    [320, 568],
    [375, 812],
    [600, 480],
    [639, 700],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));

    const layout = await page.evaluate(() => {
      const rect = (selector: string) => {
        const bounds = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
        return { x: bounds.x, right: bounds.right, bottom: bounds.bottom };
      };
      return {
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        pageHeight: document.documentElement.scrollHeight,
        app: rect(".app-shell"),
        workspace: rect(".workspace"),
        category: rect(".category-nav"),
        catalog: rect(".catalog-pane"),
        catalogScroll: rect(".catalog-scroll"),
        inspector: rect(".inspector"),
        appearance: rect(".appearance"),
      };
    });

    expect(layout.overflowX).toBe(0);
    expect(layout.pageHeight).toBeGreaterThanOrEqual(height);
    expect(layout.app.bottom).toBeCloseTo(layout.pageHeight, 0);
    expect(layout.workspace.bottom).toBeCloseTo(layout.pageHeight, 0);
    expect(layout.inspector.bottom).toBeCloseTo(layout.pageHeight, 0);
    expect(layout.appearance.bottom).toBeCloseTo(layout.pageHeight, 0);
    expect(layout.catalogScroll.bottom).toBeCloseTo(layout.catalog.bottom, 0);
    for (const rect of [layout.app, layout.workspace, layout.category, layout.catalog, layout.inspector, layout.appearance]) {
      expectInsideWidth(rect, width);
    }

    await page.getByText("Policy context", { exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByText("Policy context", { exact: true })).toBeInViewport();
    await expect(page.getByRole("button", { name: "Copy SVG", exact: true })).toBeInViewport();
    await expect(options.nth(19)).toHaveAttribute("aria-selected", "true");
  }

  await page.setViewportSize({ width: 840, height: 720 });
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(options.nth(19)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Copy SVG", exact: true })).toBeInViewport();
});

test("Figma compact mode remains a full-height single-panel picker at narrow widths", async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 560 });
  await page.goto("/");
  await page.locator(".app-shell").evaluate((element) => element.classList.add("is-figma-compact"));

  const layout = await page.evaluate(() => {
    const rect = (selector: string) => document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
    const workspace = rect(".workspace");
    const catalog = rect(".catalog-pane");
    const catalogScroll = rect(".catalog-scroll");
    return {
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      pageHeight: document.documentElement.scrollHeight,
      workspace: { x: workspace.x, right: workspace.right, top: workspace.top, bottom: workspace.bottom },
      catalog: { x: catalog.x, right: catalog.right, top: catalog.top, bottom: catalog.bottom },
      catalogScrollBottom: catalogScroll.bottom,
      categoryDisplay: getComputedStyle(document.querySelector<HTMLElement>(".category-nav")!).display,
      inspectorDisplay: getComputedStyle(document.querySelector<HTMLElement>(".inspector")!).display,
    };
  });

  expect(layout.overflowX).toBe(0);
  expect(layout.pageHeight).toBe(560);
  expect(layout.workspace).toEqual({ x: 0, right: 520, top: 58, bottom: 560 });
  expect(layout.catalog).toEqual(layout.workspace);
  expect(layout.catalogScrollBottom).toBeCloseTo(560, 0);
  expect(layout.categoryDisplay).toBe("none");
  expect(layout.inspectorDisplay).toBe("none");
});
