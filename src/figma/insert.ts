import { assertSafeSvgEnvelope, sha256Hex } from "../core/svg.js";
import {
  FigmaInsertRequestSchema,
  type FigmaInsertRequest,
  type FigmaInsertionReceipt,
  type FigmaLayerName,
} from "./protocol.js";

export type FigmaPlacement =
  | { kind: "click" }
  | {
    kind: "drop";
    target: BaseNode | SceneNode;
    x: number;
    y: number;
    absoluteX: number;
    absoluteY: number;
  };

function hasChildren(node: BaseNode): node is BaseNode & ChildrenMixin {
  return "appendChild" in node && typeof node.appendChild === "function";
}

function safeDropParent(target: BaseNode, createComponent: boolean): (BaseNode & ChildrenMixin) | null {
  if (!hasChildren(target)) return null;
  if (target.type === "DOCUMENT") return null;
  let ancestor: BaseNode | null = target;
  while (ancestor !== null) {
    if (ancestor.type === "INSTANCE" || ancestor.type === "COMPONENT_SET") {
      return null;
    }
    if (createComponent && ancestor.type === "COMPONENT") return null;
    ancestor = ancestor.parent;
  }
  return target;
}

function visiblePaints(value: readonly Paint[] | PluginAPI["mixed"]): readonly Paint[] {
  return Array.isArray(value) ? value.filter((paint) => paint.visible !== false) : [];
}

function hasGeometry(node: SceneNode): node is SceneNode & GeometryMixin {
  return "outlineStroke" in node && "strokes" in node && "fills" in node;
}

function outlineImportedStrokes(root: FrameNode): number {
  const withVisibleStroke = root.findAll(hasGeometry)
    .filter(hasGeometry)
    .filter((node) => visiblePaints(node.strokes).length > 0);
  const styledNodes = new Set<SceneNode>(withVisibleStroke);
  const candidates = withVisibleStroke.filter((node) => {
    let ancestor = node.parent;
    while (ancestor !== null && ancestor !== root) {
      if (styledNodes.has(ancestor as SceneNode)) return false;
      ancestor = ancestor.parent;
    }
    return true;
  });
  let outlinedCount = 0;

  for (const node of candidates) {
    if (node.parent === null) continue;
    const parent = node.parent;
    if (!hasChildren(parent)) continue;
    const index = parent.children.indexOf(node);
    const outlined = node.outlineStroke();
    if (outlined === null) continue;

    outlined.name = `${node.name || "Vector"} / Outline`;
    if (visiblePaints(node.fills).length > 0) {
      node.strokes = [];
      parent.insertChild(Math.max(0, index + 1), outlined);
    } else {
      parent.insertChild(Math.max(0, index), outlined);
      node.remove();
    }
    outlinedCount += 1;
  }
  return outlinedCount;
}

function resolvedLayerName(value: FigmaLayerName, iconName: string): string {
  return value === "icon-name" ? iconName : value;
}

function applyLayerStructure(
  figmaApi: PluginAPI,
  root: FrameNode,
  request: FigmaInsertRequest,
): void {
  const children = [...root.children];
  if (children.length === 0 || request.settings.layerStructure === "preserve") return;

  const layerName = resolvedLayerName(request.settings.layerName, request.asset.name);
  const merged = request.settings.layerStructure === "flatten"
    ? figmaApi.flatten(children, root)
    : figmaApi.union(children, root);
  merged.name = layerName;
}

function removeIfPresent(node: SceneNode | null): void {
  if (node?.parent !== null) node?.remove();
}

export function insertIconIntoFigma(
  figmaApi: PluginAPI,
  input: unknown,
  placement: FigmaPlacement,
): FigmaInsertionReceipt {
  const request = FigmaInsertRequestSchema.parse(input);
  assertSafeSvgEnvelope(request.asset.name, request.asset.svg);
  if (sha256Hex(request.asset.svg) !== request.asset.sha256) {
    throw new Error("The icon payload changed after rendering. Select the icon again.");
  }

  let root: FrameNode | null = null;
  let finalNode: SceneNode | null = null;
  try {
    root = figmaApi.createNodeFromSvg(request.asset.svg);
    // Figma imports the SVG viewport as a white-filled Frame. The viewport is
    // only a geometry container for an icon; leaving that default paint would
    // produce a visible square on non-white canvases and component instances.
    root.fills = [];
    root.strokes = [];
    root.name = resolvedLayerName(request.settings.layerName, request.asset.name);

    let parent: BaseNode & ChildrenMixin = figmaApi.currentPage;
    let x: number;
    let y: number;
    if (placement.kind === "click") {
      x = figmaApi.viewport.center.x - root.width / 2;
      y = figmaApi.viewport.center.y - root.height / 2;
    } else {
      const targetParent = safeDropParent(placement.target, request.settings.createComponent);
      if (targetParent === null) {
        x = placement.absoluteX;
        y = placement.absoluteY;
      } else {
        parent = targetParent;
        x = placement.x;
        y = placement.y;
      }
    }

    // Enter the document before any geometry or component work:
    // createNodeFromSvg returns a detached frame, while outlineStroke,
    // flatten/union, and createComponentFromNode are documented for nodes in
    // the document.
    parent.appendChild(root);
    if ("layoutMode" in parent && parent.layoutMode !== "NONE") {
      root.layoutPositioning = "ABSOLUTE";
      root.x = x;
      root.y = y;
    } else {
      root.x = x;
      root.y = y;
    }

    const outlinedNodeCount = request.settings.outlineStroke ? outlineImportedStrokes(root) : 0;
    applyLayerStructure(figmaApi, root, request);

    finalNode = request.settings.createComponent
      ? figmaApi.createComponentFromNode(root)
      : root;
    finalNode.name = request.settings.createComponent
      ? `Icon/${request.asset.name}`
      : resolvedLayerName(request.settings.layerName, request.asset.name);

    figmaApi.currentPage.selection = [finalNode];
    if (placement.kind === "click") figmaApi.viewport.scrollAndZoomIntoView([finalNode]);

    return {
      requestId: request.requestId,
      nodeId: finalNode.id,
      nodeType: finalNode.type,
      nodeName: finalNode.name,
      parentId: parent.id,
      parentName: parent.name,
      placement: placement.kind,
      component: finalNode.type === "COMPONENT",
      outlinedNodeCount,
      layerStructure: request.settings.layerStructure,
    };
  } catch (error) {
    removeIfPresent(finalNode);
    if (root !== finalNode) removeIfPresent(root);
    throw error;
  }
}
