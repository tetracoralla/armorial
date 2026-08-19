import {
  DEFAULT_POLICY,
  type BrowseIconsInput,
  type BrowseIconsOutput,
} from "../core/contracts.js";
import { IconKernel } from "../core/kernel.js";

const kernel = new IconKernel(DEFAULT_POLICY);

export async function browseStandaloneIcons(input: BrowseIconsInput): Promise<BrowseIconsOutput> {
  const output = kernel.browse(input);
  if (output.status === "error") throw new Error(output.error.message);
  return output;
}
