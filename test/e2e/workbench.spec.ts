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

  const stroke = page.getByRole("radiogroup", { name: "Stroke value", exact: true });
  await expect(stroke.getByRole("radio", { name: "4", exact: true })).toHaveAttribute("aria-checked", "true");
  await stroke.getByRole("radio", { name: "3", exact: true }).click();
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
  await expect(stroke.getByRole("radio", { name: "4", exact: true })).toHaveAttribute("aria-checked", "true");

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

test("appearance redraw blocks stale export and rejects invalid color drafts locally", async ({ page }) => {
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

});

test("stroke choices follow the radio keyboard pattern and expose only valid weights", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("2,658 icons", { exact: true })).toBeVisible();

  const group = page.getByRole("radiogroup", { name: "Stroke value", exact: true });
  const radios = group.getByRole("radio");
  await expect(radios).toHaveCount(4);
  await expect(radios.nth(3)).toHaveAttribute("aria-checked", "true");
  await expect(radios.nth(3)).toHaveAttribute("tabindex", "0");
  await expect(radios.nth(0)).toHaveAttribute("tabindex", "-1");

  await radios.nth(3).focus();
  await radios.nth(3).press("ArrowLeft");
  await expect(radios.nth(2)).toBeFocused();
  await expect(radios.nth(2)).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".preview-panel img")).toHaveAttribute("src", /stroke-width%3D%223%22/);

  await radios.nth(2).press("Home");
  await expect(radios.nth(0)).toBeFocused();
  await expect(radios.nth(0)).toHaveAttribute("aria-checked", "true");
  await radios.nth(0).press("End");
  await expect(radios.nth(3)).toBeFocused();
  await expect(radios.nth(3)).toHaveAttribute("aria-checked", "true");
});

test("language selection localizes navigation, identity details, and the document language", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    window.localStorage.setItem("armorial.preferences.v1", JSON.stringify({ version: 1, locale: "en" }));
  });
  await page.reload();
  // Locale persistence is a functional assertion, not a 5-second startup SLO.
  await expect(page.locator("html")).toHaveAttribute("lang", "en", { timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Abstract 121", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "a-cane", exact: true })).toBeVisible();

  await page.getByLabel("Language", { exact: true }).selectOption("zh-CN");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByRole("button", { name: "抽象图形 121", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "拐杖", exact: true })).toBeVisible();
  await expect(page.locator(".preview-meta p")).toHaveText("a-cane");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByPlaceholder("搜索图标", { exact: true })).toBeVisible();
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

test("a failed search cannot publish a stale pagination route", async ({ page }) => {
  const browseBodies: Array<Record<string, unknown>> = [];
  await page.route("**/api/browse", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    browseBodies.push(body);
    if (body.query === "injected failure") {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "injected search failure" }),
      });
      return;
    }
    await route.continue();
  });
  await page.goto("/");
  await expect(page.getByText("2,658 icons", { exact: true })).toBeVisible();

  await page.getByPlaceholder("Search icons", { exact: true }).fill("injected failure");
  await expect(page.locator(".error-banner")).toBeVisible();
  await expect(page.getByRole("button", { name: "Load more", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy for Agent", exact: true })).toBeDisabled();
  const staleOption = page.getByRole("option", { name: "a-cane", exact: true });
  await expect(staleOption).toHaveAttribute("draggable", "false");
  expect(await staleOption.evaluate((element) => {
    const transfer = new DataTransfer();
    element.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
    return [...transfer.types];
  })).toEqual([]);
  expect(browseBodies.some((body) => body.query === "injected failure" && body.offset === 60)).toBe(false);

  await page.getByPlaceholder("Search icons", { exact: true }).fill("");
  await expect(page.locator(".error-banner")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Load more", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Load more", exact: true }).click();
  await expect.poll(() => browseBodies.some((body) => body.query === "" && body.offset === 60)).toBe(true);
});

test("selection decisions stay disabled until the current query has a settled result", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:4178" });
  let releasePending: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    releasePending = resolve;
  });
  await page.route("**/api/browse", async (route) => {
    const body = route.request().postDataJSON() as { query?: string };
    if (body.query === "notification") await pending;
    await route.continue();
  });
  await page.goto("/");
  await expect(page.getByText("2,658 icons", { exact: true })).toBeVisible();
  await expect(page.locator(".preview-meta code")).toHaveText("icon-park:a-cane");

  const copyForAgent = page.getByRole("button", { name: "Copy for Agent", exact: true });
  const copySvg = page.getByRole("button", { name: "Copy SVG", exact: true });
  const downloadSvg = page.getByRole("button", { name: "Download", exact: true });
  const staleOption = page.getByRole("option", { name: "a-cane", exact: true });
  await page.getByPlaceholder("Search icons", { exact: true }).fill("notification");
  await expect(copyForAgent).toBeDisabled();
  await expect(copySvg).toBeDisabled();
  await expect(page.getByRole("button", { name: "Copy link", exact: true })).toBeDisabled();
  await expect(downloadSvg).toBeDisabled();
  await expect(staleOption).toHaveAttribute("draggable", "false");
  expect(await staleOption.evaluate((element) => {
    const transfer = new DataTransfer();
    element.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
    return [...transfer.types];
  })).toEqual([]);
  releasePending?.();
  await expect(page.getByRole("option", { name: "remind", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "remind", exact: true })).toHaveAttribute("draggable", "true");
  await expect(copyForAgent).toBeEnabled();
  await copyForAgent.click();
  const decision = await page.evaluate(() => navigator.clipboard.readText());
  expect(decision).toContain('"intent": "notification"');
  expect(decision).toContain('"iconId": "icon-park:remind"');

  await page.getByPlaceholder("Search icons", { exact: true }).fill("zzzxxyyqqq");
  await expect(page.getByText("No matching icons", { exact: true })).toBeVisible();
  await expect(copyForAgent).toHaveCount(0);
  await expect(page.getByRole("option")).toHaveCount(0);
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

  // `clock.install()` starts with time flowing normally. Pause only after the
  // initial catalog has loaded so runner speed cannot consume the debounce
  // window between the appearance edit and the pagination click.
  const pausedAt = await page.evaluate(() => Date.now() + 50);
  await page.clock.pauseAt(pausedAt);

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

test("a deeply loaded catalog keeps the rendered grid bounded and preserves exact keyboard position", async ({ page }) => {
  await page.goto("/");
  const listbox = page.getByRole("listbox", { name: "Icon results" });
  const loadMore = page.getByRole("button", { name: "Load more", exact: true });
  for (const expectedLoaded of [120, 180, 240, 300]) {
    await loadMore.scrollIntoViewIfNeeded();
    await loadMore.click();
    await expect(listbox).toHaveAttribute("data-loaded-count", String(expectedLoaded));
    await expect(listbox).toHaveAttribute("aria-busy", "false");
    await expect(listbox.getByRole("option").first()).toHaveAttribute("aria-posinset", expectedLoaded === 120 ? "1" : /\d+/);
  }

  const renderedOptions = listbox.getByRole("option");
  const renderedCount = await renderedOptions.count();
  expect(renderedCount).toBeLessThanOrEqual(160);
  await expect(renderedOptions.first()).toHaveAttribute("aria-setsize", "2658");

  // Focus a currently painted option, then send the key to the active element.
  // Re-resolving `.first()` after focus can target a different virtualized
  // element if the browser scrolls an overscan row into view.
  await renderedOptions.nth(Math.floor(renderedCount / 2)).focus();
  await page.keyboard.press("End");
  const lastLoaded = listbox.locator('[role="option"][aria-posinset="300"]');
  await expect(lastLoaded).toBeFocused();
  await expect(lastLoaded).toHaveAttribute("aria-selected", "true");
  expect(await page.locator(".catalog-scroll").evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.locator('[role="option"][tabindex="0"]').count()).toBe(1);
});

test("repeated full-catalog loading stays virtualized and End reaches the exact tail", async ({ page }, testInfo) => {
  // This is a two-cycle baseline, not a product SLO. Keep enough runner time
  // to record loaded-count/latency/DOM/depth/heap/tail measurements under a
  // busy local host.
  testInfo.setTimeout(120_000);
  type CatalogRuntimeSample = Readonly<{
    loadedCount: number;
    appendMs: number;
    renderedOptions: number;
    domElements: number;
    gridDepth: number;
    usedJSHeapBytes: number;
  }>;
  const baselines: Array<Record<string, number>> = [];
  const trends: CatalogRuntimeSample[][] = [];
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  for (let cycle = 1; cycle <= 2; cycle += 1) {
    await page.goto("/");
    const listbox = page.getByRole("listbox", { name: "Icon results" });
    await expect(listbox).toHaveAttribute("data-loaded-count", "60");
    const observeRuntime = async (loadedCount: number, appendMs: number): Promise<CatalogRuntimeSample> => {
      const [runtime, metrics] = await Promise.all([
        page.evaluate(({ loadedCount: count, appendMs: elapsed }) => {
          let gridDepth = 0;
          let node: Element | null = document.querySelector('[role="option"]');
          while (node !== null) {
            gridDepth += 1;
            node = node.parentElement;
          }
          return {
            loadedCount: count,
            appendMs: elapsed,
            renderedOptions: document.querySelectorAll('[role="option"]').length,
            domElements: document.querySelectorAll("*").length,
            gridDepth,
          };
        }, { loadedCount, appendMs }),
        cdp.send("Performance.getMetrics"),
      ]);
      return {
        ...runtime,
        usedJSHeapBytes: metrics.metrics.find(({ name }) => name === "JSHeapUsedSize")?.value ?? -1,
      };
    };
    const trend: CatalogRuntimeSample[] = [await observeRuntime(60, 0)];
    const startedAt = Date.now();
    while (await page.getByRole("button", { name: "Load more", exact: true }).count() > 0) {
      const before = Number(await listbox.getAttribute("data-loaded-count"));
      const loadMore = page.getByRole("button", { name: "Load more", exact: true });
      await loadMore.scrollIntoViewIfNeeded();
      const appendStartedAt = Date.now();
      await loadMore.click();
      await expect.poll(async () => Number(await listbox.getAttribute("data-loaded-count"))).toBeGreaterThan(before);
      await expect(listbox).toHaveAttribute("aria-busy", "false");
      const loadedCount = Number(await listbox.getAttribute("data-loaded-count"));
      trend.push(await observeRuntime(loadedCount, Date.now() - appendStartedAt));
    }
    await expect(listbox).toHaveAttribute("data-loaded-count", "2658");
    const rendered = listbox.getByRole("option");
    const renderedCount = await rendered.count();
    expect(renderedCount).toBeLessThanOrEqual(160);
    await expect(rendered.first()).toHaveAttribute("aria-setsize", "2658");

    await rendered.nth(Math.floor(renderedCount / 2)).focus();
    await page.keyboard.press("End");
    const last = listbox.locator('[role="option"][aria-posinset="2658"]');
    await expect(last).toBeFocused();
    await expect(last).toHaveAttribute("aria-selected", "true");
    expect(await page.locator('[role="option"][tabindex="0"]').count()).toBe(1);

    const scrollHeight = await page.locator(".catalog-scroll").evaluate((element) => (element as HTMLElement).scrollHeight);
    const appendLatencies = trend.slice(1).map(({ appendMs }) => appendMs).sort((left, right) => left - right);
    const heaps = trend.map(({ usedJSHeapBytes }) => usedJSHeapBytes).filter((value) => value >= 0);
    const finalRuntime = trend.at(-1)!;
    baselines.push({
      cycle,
      loadMs: Date.now() - startedAt,
      renderedOptions: renderedCount,
      domElements: finalRuntime.domElements,
      gridDepth: finalRuntime.gridDepth,
      scrollHeight,
      appends: appendLatencies.length,
      p50AppendMs: appendLatencies[Math.floor(appendLatencies.length * 0.5)] ?? -1,
      p95AppendMs: appendLatencies[Math.floor(appendLatencies.length * 0.95)] ?? -1,
      maxAppendMs: Math.max(...appendLatencies),
      initialHeapBytes: heaps[0] ?? -1,
      finalHeapBytes: heaps.at(-1) ?? -1,
      peakHeapBytes: heaps.length === 0 ? -1 : Math.max(...heaps),
      heapDeltaBytes: heaps.length === 0 ? -1 : heaps.at(-1)! - heaps[0]!,
      minDomElements: Math.min(...trend.map(({ domElements }) => domElements)),
      maxDomElements: Math.max(...trend.map(({ domElements }) => domElements)),
      minGridDepth: Math.min(...trend.map(({ gridDepth }) => gridDepth)),
      maxGridDepth: Math.max(...trend.map(({ gridDepth }) => gridDepth)),
    });
    trends.push(trend);
  }
  await testInfo.attach("full-catalog-baseline.json", {
    body: Buffer.from(JSON.stringify({ summary: baselines, trends }, null, 2)),
    contentType: "application/json",
  });
  console.log(`full-catalog-baseline ${JSON.stringify(baselines)}`);
});

test("a shared link reproduces an adjusted icon, supports another search, and follows hash navigation", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:4178" });
  await page.goto("/");
  await page.getByPlaceholder("Search icons", { exact: true }).fill("notification");
  await page.getByRole("option", { name: "remind", exact: true }).click();
  await page.getByLabel("Size value", { exact: true }).fill("32");
  await page.getByLabel("Size value", { exact: true }).press("Enter");
  await expect(page.getByRole("button", { name: "Copy link", exact: true })).toBeEnabled();
  const original = await page.locator(".preview-panel img").getAttribute("src");
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(new URL(link).hash).toContain("icon=");
  expect(link).not.toContain("context");
  const other = await context.newPage();
  await other.goto(link);
  await expect(other.locator(".preview-meta code")).toHaveText("icon-park:remind");
  await expect(other.locator(".preview-panel img")).toHaveAttribute("src", original!);
  await expect(other.getByRole("alert")).toHaveCount(0);
  await other.getByPlaceholder("Search icons", { exact: true }).fill("search");
  await other.getByRole("option", { name: "search", exact: true }).click();
  await other.getByRole("button", { name: "Copy for Agent", exact: true }).click();
  expect(await other.evaluate(() => navigator.clipboard.readText())).toContain('"intent": "search"');
  await other.getByRole("button", { name: "Copy link", exact: true }).click();
  const secondLink = await other.evaluate(() => navigator.clipboard.readText());
  await page.goto(secondLink);
  await expect(page.locator(".preview-meta code")).toHaveText("icon-park:search");
  await page.goto(link);
  await expect(page.locator(".preview-meta code")).toHaveText("icon-park:remind");
  await page.reload();
  await expect(page.locator(".preview-panel img")).toHaveAttribute("src", original!);
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.getByLabel("Size value", { exact: true })).toHaveValue("24");
  await expect(page.getByRole("button", { name: "Copy link", exact: true })).toBeEnabled();
  await other.close();
});

test("invalid links recover to browsing and changed shared assets are disclosed", async ({ page }) => {
  await page.goto("/#icon=search&render=invalid");
  await expect(page.getByRole("alert")).toContainText("This icon link is invalid");
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  const policy = { theme: "outline", size: 32, strokeWidth: 4, strokeLinecap: "round", strokeLinejoin: "round",
    colors: { primary: "currentColor", secondary: "#2f88ff", innerStroke: "#ffffff", innerFill: "#43ccf8" } };
  const hash = new URLSearchParams({ icon: "icon-park:search", render: JSON.stringify(policy), sha256: "a".repeat(64) });
  await page.goto(`/#${hash}`);
  await expect(page.getByRole("alert")).toContainText("differs from the shared version");
  await expect(page.locator(".preview-meta code")).toHaveText("icon-park:search");
  await expect(page.getByLabel("Size value", { exact: true })).toHaveValue("32");
  const missing = new URLSearchParams({ icon: "icon-park:not-in-the-collection", render: JSON.stringify(policy), sha256: "a".repeat(64) });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/#${missing}`);
  await expect(page.getByRole("alert")).toContainText("not in the current collection");
  await expect(page.locator(".preview-meta code")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy SVG", exact: true })).toHaveCount(0);
  expect((await page.locator(".category-nav").boundingBox())!.height).toBeLessThan(70);
  await page.getByRole("option").first().click();
  await expect(page.getByRole("button", { name: "Copy SVG", exact: true })).toBeEnabled();
});

test("a shared link selects its exact icon even when the previous selection is another returned candidate", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:4178" });
  await page.goto("/");
  await page.getByPlaceholder("Search icons", { exact: true }).fill("search");
  await page.getByRole("option", { name: "search", exact: true }).click();
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  await page.getByRole("option", { name: "find", exact: true }).click();
  await expect(page.locator(".preview-meta code")).toHaveText("icon-park:find");
  await page.goto(link);
  await expect(page.getByPlaceholder("Search icons", { exact: true })).toHaveValue("icon-park:search");
  await expect(page.locator(".preview-meta code")).toHaveText("icon-park:search");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

for (const action of ["search", "appearance"] as const) {
  test(`changing ${action} during shared-link loading does not report a false link warning`, async ({ page, request }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Copy link", exact: true })).toBeEnabled();
    const response = await request.post("/api/browse", { data: { query: "icon-park:remind", render: { size: 32 } } });
    const { result } = await response.json();
    const shared = result.items.find((item: { id: string }) => item.id === "icon-park:remind");
    const { theme, size, strokeWidth, strokeLinecap, strokeLinejoin, colors } = result.policy;
    const hash = new URLSearchParams({ icon: shared.id,
      render: JSON.stringify({ theme, size, strokeWidth, strokeLinecap, strokeLinejoin, colors }),
      sha256: shared.asset.sha256 });
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/browse", async (route) => {
      const input = route.request().postDataJSON();
      if (input.query === "icon-park:remind" && input.render?.size === 32) await held;
      await route.continue();
    });
    try {
      const started = page.waitForRequest((req) => req.url().endsWith("/api/browse")
        && req.postDataJSON()?.query === "icon-park:remind");
      await page.goto(`/#${hash}`);
      await started;
      if (action === "search") {
        await page.getByPlaceholder("Search icons", { exact: true }).fill("settings");
        await expect(page.locator(".preview-meta code")).toHaveText("icon-park:setting");
      } else {
        await page.getByLabel("Size value", { exact: true }).fill("48");
        await page.getByLabel("Size value", { exact: true }).press("Enter");
        await expect(page.locator(".preview-panel img")).toHaveAttribute("src", /width%3D%2248%22/);
      }
      await expect(page.getByRole("alert")).toHaveCount(0);
    } finally {
      release();
      await page.unrouteAll({ behavior: "wait" });
    }
  });
}
