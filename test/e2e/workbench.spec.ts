import { expect, test } from "@playwright/test";

test("standalone human can search, select, copy for Agent, copy SVG, download, and drag", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:4178" });
  await page.goto("/");
  await expect(page.getByText("2,658 icons", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Primary", { exact: true })).toHaveValue("currentColor");
  await expect(page.getByRole("region", { name: "Agent" })).toHaveCount(0);

  await page.getByPlaceholder("Search icons", { exact: true }).fill("notification");
  await expect(page.getByRole("option", { name: "remind", exact: true })).toBeVisible();
  await page.getByRole("option", { name: "remind", exact: true }).click();
  await expect(page.getByRole("heading", { name: "remind", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Copy for Agent", exact: true }).click();
  const decision = await page.evaluate(() => navigator.clipboard.readText());
  expect(decision).toContain("[icon-selection:v3]");
  expect(decision).toContain('"iconId": "icon-park:remind"');
  expect(decision).toContain('"intent": "notification"');
  expect(decision).toContain('"render"');
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

test("appearance overrides restyle exports and carry the final render into decisions", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:4178" });
  await page.goto("/");
  await expect(page.getByText("2,658 icons", { exact: true })).toBeVisible();

  await page.getByPlaceholder("Search icons", { exact: true }).fill("notification");
  await page.getByRole("option", { name: "remind", exact: true }).click();
  await expect(page.getByRole("heading", { name: "remind", exact: true })).toBeVisible();

  await page.getByLabel("Size value", { exact: true }).fill("32");
  await page.getByLabel("Size value", { exact: true }).press("Enter");
  await expect(page.locator(".preview-panel img")).toHaveAttribute("src", /width%3D%2232%22/);

  const stroke = page.getByLabel("Stroke value", { exact: true });
  await expect(stroke).toHaveValue("4");
  await stroke.fill("3");
  await stroke.press("Enter");
  await expect(page.locator(".preview-panel img")).toHaveAttribute("src", /stroke-width%3D%223%22/);

  await page.getByLabel("Primary", { exact: true }).fill("#0055ff");
  await page.getByLabel("Primary", { exact: true }).press("Enter");
  await expect(page.locator(".preview-panel img")).toHaveAttribute("src", /%230055ff/);

  await page.getByRole("button", { name: "Copy SVG", exact: true }).click();
  const svg = await page.evaluate(() => navigator.clipboard.readText());
  expect(svg).toContain('width="32"');
  expect(svg).toContain('stroke-width="3"');
  expect(svg).toContain("#0055ff");

  await page.getByRole("button", { name: "Copy for Agent", exact: true }).click();
  const decision = await page.evaluate(() => navigator.clipboard.readText());
  expect(decision).toContain("[icon-selection:v3]");
  expect(decision).toContain('"iconId": "icon-park:remind"');
  expect(decision).toContain('"size": 32');
  expect(decision).toContain('"strokeWidth": 3');
  expect(decision).toContain('"primary": "#0055ff"');
  expect(decision).not.toContain("<svg");

  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.locator(".preview-panel img")).toHaveAttribute("src", /width%3D%2224%22/);
  await expect(stroke).toHaveValue("4");

  await page.getByRole("button", { name: "Copy SVG", exact: true }).click();
  const resetSvg = await page.evaluate(() => navigator.clipboard.readText());
  expect(resetSvg).toContain('width="24"');
  expect(resetSvg).toContain('stroke-width="4"');
  expect(resetSvg).not.toContain("#0055ff");
});

test("inline color editing replaces the oversized system picker and returns focus", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("2,658 icons", { exact: true })).toBeVisible();

  const trigger = page.getByRole("button", { name: "Edit Primary color", exact: true });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();

  const editor = page.getByRole("region", { name: "Primary color editor", exact: true });
  await expect(editor).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await editor.getByRole("button", { name: "Use #2f88ff", exact: true }).click();
  await editor.getByRole("button", { name: "Apply color", exact: true }).click();

  await expect(editor).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.locator(".preview-panel img")).toHaveAttribute("src", /%232f88ff/);

  await trigger.click();
  await page.getByLabel("Primary hue", { exact: true }).press("Escape");
  await expect(page.getByRole("region", { name: "Primary color editor", exact: true })).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("range controls keep drag drafts local and render once on release", async ({ page }) => {
  const browseBodies: Array<Record<string, unknown>> = [];
  await page.route("**/api/browse", async (route) => {
    browseBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.continue();
  });
  await page.goto("/");
  await expect(page.getByText("2,658 icons", { exact: true })).toBeVisible();
  browseBodies.length = 0;

  const range = page.getByLabel("Size", { exact: true });
  await range.evaluate((element) => {
    const input = element as HTMLInputElement;
    input.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    valueSetter?.call(input, "33");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.getByLabel("Size value", { exact: true })).toHaveValue("33");
  await page.waitForTimeout(250);
  expect(browseBodies.some((body) => (body.render as { size?: number } | undefined)?.size === 33)).toBe(false);

  await range.evaluate((element) => element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })));
  await expect.poll(() => browseBodies.filter((body) => (
    (body.render as { size?: number } | undefined)?.size === 33
  )).length).toBe(1);
  await page.waitForTimeout(300);
  expect(browseBodies.filter((body) => (
    (body.render as { size?: number } | undefined)?.size === 33
  )).length).toBe(1);
});

test("appearance redraw blocks stale export and rejects invalid drafts locally", async ({ page }) => {
  await page.route("**/api/browse", async (route) => {
    const body = route.request().postDataJSON() as { render?: { size?: number } };
    if (body.render?.size === 48) {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    await route.continue();
  });
  await page.goto("/");
  await expect(page.getByText("2,658 icons", { exact: true })).toBeVisible();

  const size = page.getByLabel("Size value", { exact: true });
  await size.fill("48");
  await size.press("Enter");
  await expect(page.getByText("Rendering…", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy SVG", exact: true })).toBeDisabled();
  await expect(page.locator(".preview-panel img")).toHaveAttribute("src", /width%3D%2248%22/);
  await expect(page.getByRole("button", { name: "Copy SVG", exact: true })).toBeEnabled();

  const primary = page.getByLabel("Primary", { exact: true });
  await primary.fill("not-a-color");
  await primary.press("Enter");
  await expect(primary).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Use hex, currentColor, var(--token), or a CSS color.", { exact: true })).toBeVisible();
  await expect(page.locator(".error-banner")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy SVG", exact: true })).toBeEnabled();

  const stroke = page.getByLabel("Stroke value", { exact: true });
  await stroke.fill("2.5");
  await stroke.press("Enter");
  await expect(stroke).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Use a whole number from 1 to 4.", { exact: true })).toBeVisible();
});

test("a failed appearance redraw returns to the last usable render and can be retried", async ({ page }) => {
  let failedOnce = false;
  await page.route("**/api/browse", async (route) => {
    const body = route.request().postDataJSON() as { render?: { size?: number } };
    if (body.render?.size === 48 && !failedOnce) {
      failedOnce = true;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "injected redraw failure" }),
      });
      return;
    }
    await route.continue();
  });
  await page.goto("/");
  await expect(page.getByText("2,658 icons", { exact: true })).toBeVisible();

  const size = page.getByLabel("Size value", { exact: true });
  await size.fill("48");
  await size.press("Enter");
  await expect(page.locator(".error-banner")).toBeVisible();

  // The controls and actions must describe the still-usable asset rather than
  // leaving the workbench permanently pending after the request has failed.
  await expect(size).toHaveValue("24");
  await expect(page.getByText("Rendering…", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy SVG", exact: true })).toBeEnabled();

  await size.fill("48");
  await size.press("Enter");
  await expect(page.locator(".preview-panel img")).toHaveAttribute("src", /width%3D%2248%22/);
  await expect(page.getByRole("button", { name: "Copy SVG", exact: true })).toBeEnabled();
});

test("focus and blur without an edit leaves appearance unmodified", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("2,658 icons", { exact: true })).toBeVisible();

  const size = page.getByLabel("Size value", { exact: true });
  await size.focus();
  await size.blur();
  await expect(page.getByRole("button", { name: "Reset", exact: true })).toBeDisabled();
  await expect(page.getByText("Modified", { exact: true })).toHaveCount(0);

  const primary = page.getByLabel("Primary", { exact: true });
  await primary.focus();
  await primary.blur();
  await expect(page.getByRole("button", { name: "Reset", exact: true })).toBeDisabled();
  await expect(page.getByText("Modified", { exact: true })).toHaveCount(0);
});

test("load more during a pending appearance change keeps pages consistent", async ({ page }) => {
  await page.clock.install();
  const browseBodies: Array<Record<string, unknown>> = [];
  await page.route("**/api/browse", async (route) => {
    browseBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.continue();
  });
  await page.goto("/");
  await page.clock.fastForward(200);
  await expect(page.getByText("2,658 icons", { exact: true })).toBeVisible();

  const size = page.getByLabel("Size value", { exact: true });
  await size.fill("48");
  await size.press("Enter");
  // Advance inside the 150 ms debounce window: the restyle is pending but not sent.
  await page.clock.fastForward(100);
  await page.getByRole("button", { name: "Load more", exact: true }).click();
  await expect.poll(() => browseBodies.some((body) => body.offset === 60)).toBe(true);
  const appended = [...browseBodies].reverse().find((body) => body.offset === 60);
  expect(appended?.offset).toBe(60);
  expect(appended?.render).toBeUndefined();

  // The pending restyle still reloads the whole list with the override applied.
  await page.clock.fastForward(300);
  await expect.poll(() => browseBodies.some((body) => (
    body.offset === 0 && (body.render as { size?: number } | undefined)?.size === 48
  ))).toBe(true);
  const reloaded = [...browseBodies].reverse().find((body) => (
    body.offset === 0 && (body.render as { size?: number } | undefined)?.size === 48
  ));
  expect((reloaded?.render as { size?: number } | undefined)?.size).toBe(48);
  await expect(page.locator(".preview-panel img")).toHaveAttribute("src", /width%3D%2248%22/);
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
  // Scope to the icon listbox: the appearance selects also expose implicit options.
  const options = page.getByRole("listbox", { name: "Icon results" }).getByRole("option");
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
  // Scope to the icon listbox: the appearance selects also expose implicit options.
  const options = page.getByRole("listbox", { name: "Icon results" }).getByRole("option");
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
