import { expect, test } from "@playwright/test";

test("standalone human can search, select, copy for Agent, copy SVG, download, and drag", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:4178" });
  await page.goto("/");
  await expect(page.getByText("2,658 icons", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Agent" })).toHaveCount(0);

  await page.getByPlaceholder("Search icons", { exact: true }).fill("notification");
  await expect(page.getByRole("option", { name: "remind", exact: true })).toBeVisible();
  await page.getByRole("option", { name: "remind", exact: true }).click();
  await expect(page.getByRole("heading", { name: "remind", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Copy for Agent", exact: true }).click();
  const decision = await page.evaluate(() => navigator.clipboard.readText());
  expect(decision).toContain("[icon-selection:v1]");
  expect(decision).toContain('"iconId": "icon-park:remind"');
  expect(decision).toContain('"intent": "notification"');
  expect(decision).not.toContain("<svg");

  await page.getByRole("button", { name: "Copy SVG", exact: true }).click();
  const svg = await page.evaluate(() => navigator.clipboard.readText());
  expect(svg).toMatch(/<svg /);
  expect(svg).toContain('width="24"');

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("remind.svg");

  const transfer = await page.getByRole("option", { name: "remind", exact: true }).evaluate((element) => {
    const dataTransfer = new DataTransfer();
    element.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
    return {
      types: [...dataTransfer.types],
      svg: dataTransfer.getData("image/svg+xml"),
      downloadUrl: dataTransfer.getData("DownloadURL"),
    };
  });
  expect(transfer.types).toEqual(expect.arrayContaining(["image/svg+xml", "text/plain", "downloadurl"]));
  expect(transfer.svg).toMatch(/<svg /);
  expect(transfer.downloadUrl).toContain("remind.svg");
});

test("category filtering and narrow layout preserve the complete human task", async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 900 });
  await page.goto("/");
  await expect(page.getByText("2,658 icons", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Communicate 27", exact: true }).click();
  await expect(page.getByText("27 icons", { exact: true })).toBeVisible();
  await expect(page.getByRole("option").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy SVG", exact: true })).toBeVisible();
  const bodyOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(bodyOverflow).toBe(0);
});

test("low-height host keeps primary export actions reachable", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 480 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Copy SVG", exact: true })).toBeInViewport();
  await expect(page.getByRole("button", { name: "Copy for Agent", exact: true })).toBeInViewport();

  const viewportContract = await page.evaluate(() => ({
    viewportHeight: window.innerHeight,
    appHeight: document.querySelector<HTMLElement>(".app-shell")?.getBoundingClientRect().height,
    pageHeight: document.documentElement.scrollHeight,
  }));
  expect(viewportContract.appHeight).toBe(viewportContract.viewportHeight);
  expect(viewportContract.pageHeight).toBe(viewportContract.viewportHeight);
});

test("phone layout keeps selection and export in one viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  const options = page.getByRole("option");
  await expect(options).toHaveCount(60);
  await options.nth(19).click();
  await expect(options.nth(19)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Copy SVG", exact: true })).toBeInViewport();
  await expect(page.getByRole("button", { name: "Copy for Agent", exact: true })).toBeInViewport();
  const bodyOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(bodyOverflow).toBe(0);
});

test("icon listbox supports roving focus and grid keyboard navigation", async ({ page }) => {
  await page.goto("/");
  const options = page.getByRole("option");
  await expect(options).toHaveCount(60);
  await options.first().focus();
  await expect(options.first()).toBeFocused();
  await expect(options.first()).toHaveAttribute("tabindex", "0");
  expect(await page.locator('[role="option"][tabindex="0"]').count()).toBe(1);

  await options.first().press("ArrowRight");
  await expect(options.nth(1)).toBeFocused();
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");

  await options.nth(1).press("Home");
  await expect(options.first()).toBeFocused();
  const firstTop = await options.first().evaluate((element) => element.getBoundingClientRect().top);
  await options.first().press("ArrowDown");
  const focused = page.locator('[role="option"]:focus');
  await expect(focused).toHaveCount(1);
  await expect(focused).toHaveAttribute("aria-selected", "true");
  expect(await focused.evaluate((element) => element.getBoundingClientRect().top)).toBeGreaterThan(firstTop);

  await focused.press("End");
  await expect(options.last()).toBeFocused();
  await expect(options.last()).toHaveAttribute("aria-selected", "true");
  expect(await page.locator('[role="option"][tabindex="0"]').count()).toBe(1);
});
