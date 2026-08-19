import {
  DEFAULT_POLICY,
  type BrowseIconsInput,
  type BrowseIconsOutput,
} from "../core/contracts.js";
import { IconKernel } from "../core/kernel.js";
import { initializePagesProvider } from "./pages-provider.js";

let kernel: IconKernel | null = null;

async function pagesKernel(): Promise<IconKernel> {
  await initializePagesProvider();
  kernel ??= new IconKernel(DEFAULT_POLICY);
  return kernel;
}

export async function browseStandaloneIcons(input: BrowseIconsInput): Promise<BrowseIconsOutput> {
  const output = (await pagesKernel()).browse(input);
  if (output.status === "error") throw new Error(output.error.message);
  return output;
}
