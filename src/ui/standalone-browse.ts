import {
  BrowseIconsOutputSchema,
  type BrowseIconsInput,
  type BrowseIconsOutput,
} from "../core/contracts.js";

export async function browseStandaloneIcons(input: BrowseIconsInput): Promise<BrowseIconsOutput> {
  let payload: unknown;
  try {
    const response = await fetch("/api/browse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    payload = await response.json();
  } catch {
    throw new Error("The local icon service is not responding correctly.");
  }
  const output = BrowseIconsOutputSchema.safeParse(
    (payload as Record<string, unknown> | null)?.["result"],
  );
  if (!output.success) throw new Error("The local icon service is not responding correctly.");
  if (output.data.status === "error") throw new Error(output.data.error.message);
  return output.data;
}
